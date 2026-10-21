// @vitest-environment jsdom
/**
 * SessionPane composer 插入请求的消费门测试（缺口9 消费门，2026-10-21 修复）。
 *
 * 修复背景：externalTextInsertRequest 此前按 `focused && sessionId === null` 只对聚焦
 * 草稿 composer 下发——团队面板「回对话修改/在主会话中引用」随行 lead 会话
 * （tab.parentSessionId）作 targetSessionId 定向，lead 会话聚焦（主场景）时其 composer
 * 必须消费该请求；此前请求被丢弃、按钮等效无效。消费门改为
 * `(targetSessionId ?? null) === (sessionId ?? null)` 匹配：
 * - 指定 sessionId → 该会话的 composer 消费（主/辅 pane 可同时 focused，按会话定向
 *   保证单一消费者，不双插）；
 * - 缺席 → 草稿 composer（建议 prompt / 插件 mention 等既有生产方语义不变）。
 *
 * 断言落在 SessionPane 真正传给 ConversationComposer 的 externalTextInsertRequest prop 上
 * （SSR 渲染不执行插入 effect，门是纯 prop 表达式；模式照 v4SessionPaneReadOnly.test.ts）。
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { SessionPane } from "@/v4/SessionPane.js";
import type { ComposerTextInsertRequest } from "@/store/droraSessionStoreTypes.js";

const sessionPaneSource = readFileSync("packages/ui/src/v4/SessionPane.tsx", "utf8");

const projectionState = vi.hoisted(() => ({
  current: null as {
    status: "live";
    snapshot: ConversationSnapshot;
    subscriptionId: string;
    lastError: string | null;
    optimisticCommands: readonly [];
    loadingOlder: boolean;
  } | null,
}));

const composerState = vi.hoisted(() => ({
  externalTextInsertRequest: undefined as unknown,
}));

/** workspace store 的可配置插入请求（其余 workspace 字段按 selector 触达面给缺省）。 */
const workspaceState = vi.hoisted(() => ({
  composerTextInsertRequest: null as ComposerTextInsertRequest | null,
}));

vi.mock("@/store/droraSessionStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/droraSessionStore.js")>();
  const { getDefaultWorkspaceState } = await import("@/store/droraSessionStoreTypes.js");
  const { getWorkspaceState: selectWorkspaceState } =
    await import("@/store/droraSessionStoreSelectors.js");
  // SSR 不执行 effect；照 v4SessionPaneReadOnly.test.ts 的 share store 桩模式，
  // 只替换 hook 与 getState。底座用真实默认 workspace 态 + 声明式覆写插入请求，
  // 让 useSlashCommands 等经真实 selector 的读取也走到同一份事实。
  const fakeState = () => {
    const state = {
      workspaces: {
        "/workspace": {
          ...getDefaultWorkspaceState(),
          composerTextInsertRequest: workspaceState.composerTextInsertRequest,
        },
      },
    };
    return {
      ...state,
      getWorkspaceState: (workspacePath: string, workspaceIdentity?: string) =>
        selectWorkspaceState(
          state as Parameters<typeof selectWorkspaceState>[0],
          workspacePath,
          workspaceIdentity,
        ),
      clearComposerTextInsertRequest: vi.fn(),
    };
  };
  const hook = ((selector: (state: unknown) => unknown) =>
    selector(fakeState())) as typeof actual.useDroraSessionStore;
  return {
    ...actual,
    useDroraSessionStore: Object.assign(hook, { getState: fakeState }),
  };
});

vi.mock("@/v4/ConversationComposer.js", async () => {
  const React = await import("react");
  return {
    ConversationComposer: (props: Record<string, unknown>) => {
      composerState.externalTextInsertRequest = props.externalTextInsertRequest;
      return React.createElement("div", { "data-testid": "mock-composer" }, "composer");
    },
  };
});

vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => projectionState.current,
}));

vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({
    attachmentPut: vi.fn(),
    layer: { acquire: vi.fn() },
    sendCommand: vi.fn(),
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useDroraStoreWithDefault: (_selector: unknown, fallback: unknown) => fallback,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    error: null,
    loading: false,
    refresh: vi.fn(async () => {}),
    settings: { droraInteractionBehavior: "queue" },
    update: vi.fn(async () => {}),
  }),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useComposerClientNamespace: () => "desktop",
  useOptionalServices: () => null,
  useServices: () => ({
    droraSessionService: {
      updateProviderRegistry: vi.fn(),
    },
    droraTaskService: {
      restartWorkspaceProcess: vi.fn(),
    },
  }),
}));

vi.mock("@/v4/composer/useDraftConfigControl.js", () => ({
  buildDraftCreateConfigPayload: () => ({}),
  // 草稿 pane 的诊断面会读 resolveInitialDraftConfig（SessionPane.tsx:4787）。
  resolveInitialDraftConfig: () => undefined,
  useDraftConfigControl: () => ({
    modelSelectionRead: { state: { status: "loading" }, reload: vi.fn() },
    captureAcceptedModelSelection: () => vi.fn(),
    draftConfigRef: { current: {} },
    resolveInitialDraftConfig: () => undefined,
    handleDraftSelectModel: vi.fn(),
    handleDraftSelectThought: vi.fn(),
    handleDraftSwitchMode: vi.fn(),
  }),
}));

vi.mock("@/v4/composer/useDraftSessionPrewarm.js", () => ({
  useDraftSessionPrewarm: () => ({
    binding: null,
  }),
}));

vi.mock("@/v4/ConversationDraftSuggestedPromptsContainer.js", async () => {
  const React = await import("react");
  // 草稿 pane 的建议 prompt 容器依赖 PlatformProvider（usePlatform）；本测试只考察
  // 消费门，不考察建议面。
  return {
    ConversationDraftSuggestedPromptsContainer: () =>
      React.createElement("div", { "data-testid": "mock-suggested-prompts" }),
  };
});

vi.mock("@/v4/ConversationTimeline.js", async () => {
  const React = await import("react");
  // composer 挂在 timeline 的 bottomDock 槽位：mock 必须把 bottomDock 渲染出来，
  // 否则 ConversationComposer 不挂载、props 捕获不到（readOnly 测试同款模式）。
  return {
    ConversationTimeline: ({ bottomDock }: { bottomDock?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-timeline" }, bottomDock ?? null),
  };
});

vi.mock("@/v4/ConversationHeader.js", async () => {
  const React = await import("react");
  return {
    ConversationHeader: () => React.createElement("div", { "data-testid": "mock-header" }),
  };
});

vi.mock("@/v4/ConversationStatusPanel.js", async () => {
  const React = await import("react");
  return {
    ConversationStatusPanel: () => React.createElement("div", { "data-testid": "mock-status" }),
  };
});

vi.mock("@/v4/ConversationQueuePanel.js", async () => {
  const React = await import("react");
  return {
    ConversationQueuePanel: () => React.createElement("div", { "data-testid": "mock-queue" }),
  };
});

vi.mock("@/v4/V4InteractionDialogs.js", async () => {
  const React = await import("react");
  return {
    V4InteractionDialogs: () => React.createElement("div", { "data-testid": "mock-interactions" }),
  };
});

vi.mock("@/request-security-edition/V4ProviderRuntimeHeadersController.js", async () => {
  const React = await import("react");
  return {
    V4ProviderRuntimeHeadersController: () =>
      React.createElement("div", { "data-testid": "mock-runtime-headers" }),
  };
});

function makeSnapshot(sessionId: string): ConversationSnapshot {
  return {
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      queueEdit: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
      sendQueuedNow: { allowed: true },
      setFollowupMode: { allowed: true },
      switchModelConfig: { allowed: true },
    },
    backgroundWorks: [],
    config: { followupMode: "queue", model: "", provider: "", thought: "" },
    control: {
      activeWorks: [],
      apiRetry: null,
      canStop: false,
      lastError: null,
      phase: "completedSuccess",
      sessionEnded: true,
      stopState: "idle",
      stopTargetKind: "unknown",
    },
    goal: null,
    inputRouting: { mode: "startNow" },
    logEpoch: "epoch-1",
    meta: { title: "Lead", titleSource: "generated" },
    pendingCommands: [],
    pendingInteractions: [],
    plan: null,
    protocolVersion: 1,
    queue: { autoDrain: true, items: [] },
    revision: 1,
    rows: { firstRowId: null, totalCount: 0, window: [] },
    seq: 1,
    sessionId,
    usage: {
      contextWindow: null,
      cumulative: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    },
  };
}

function renderPane({
  sessionId,
  request,
  focused = true,
}: {
  sessionId: string | null;
  request: ComposerTextInsertRequest | null;
  focused?: boolean;
}): unknown {
  workspaceState.composerTextInsertRequest = request;
  projectionState.current = {
    lastError: null,
    loadingOlder: false,
    optimisticCommands: [],
    snapshot: makeSnapshot(sessionId ?? "lead-session-1"),
    status: "live",
    subscriptionId: "sub-1",
  };
  composerState.externalTextInsertRequest = undefined;
  renderToStaticMarkup(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SessionPane, {
        paneId: "pane-1",
        readOnly: false,
        sessionId,
        focused,
        workspacePath: "/workspace",
      }),
    ),
  );
  return composerState.externalTextInsertRequest;
}

beforeEach(() => {
  // jsdom 无 ResizeObserver（SessionPane 子树按需观测尺寸）。
  window.ResizeObserver =
    window.ResizeObserver ??
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
});

afterEach(() => {
  workspaceState.composerTextInsertRequest = null;
});

describe("SessionPane composer 插入请求消费门（缺口9）", () => {
  it("lead 会话聚焦：targetSessionId 匹配的请求下发给该会话 composer（主场景闭环）", () => {
    const received = renderPane({
      sessionId: "lead-session-1",
      request: {
        requestId: 7,
        text: "要调整什么？",
        targetSessionId: "lead-session-1",
      },
    });
    expect(received).toMatchObject({ requestId: 7, text: "要调整什么？" });
  });

  it("lead 会话聚焦：无 targetSessionId 的草稿定向请求不被会话 composer 劫持", () => {
    const received = renderPane({
      sessionId: "lead-session-1",
      request: { requestId: 8, text: "draft prompt" },
    });
    expect(received).toBeNull();
  });

  it("targetSessionId 指向别的会话：本会话 composer 不消费（单一消费者）", () => {
    const received = renderPane({
      sessionId: "lead-session-1",
      request: { requestId: 9, text: "x", targetSessionId: "other-session" },
    });
    expect(received).toBeNull();
  });

  it("草稿 pane：无 targetSessionId 的请求仍下发给草稿 composer（既有语义不回归）", () => {
    const received = renderPane({
      sessionId: null,
      request: { requestId: 10, text: "draft prompt" },
    });
    expect(received).toMatchObject({ requestId: 10 });
  });

  it("草稿 pane：targetSessionId 定向到会话的请求不下发给草稿 composer", () => {
    const received = renderPane({
      sessionId: null,
      request: { requestId: 11, text: "x", targetSessionId: "lead-session-1" },
    });
    expect(received).toBeNull();
  });

  it("非聚焦 pane 即使目标匹配也不消费（等聚焦后再应用）", () => {
    const received = renderPane({
      sessionId: "lead-session-1",
      request: { requestId: 12, text: "x", targetSessionId: "lead-session-1" },
      focused: false,
    });
    expect(received).toBeNull();
  });

  it("消费门源码形态：按 targetSessionId 与 sessionId 归一匹配（防回归到 sessionId === null 门）", () => {
    const gateStart = sessionPaneSource.indexOf("externalTextInsertRequest={");
    expect(gateStart).toBeGreaterThanOrEqual(0);
    const gate = sessionPaneSource.slice(gateStart, sessionPaneSource.indexOf("}", gateStart));
    expect(gate).toContain(
      "(composerTextInsertRequest?.targetSessionId ?? null) === (sessionId ?? null)",
    );
  });
});
