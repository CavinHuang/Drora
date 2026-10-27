// @vitest-environment jsdom
/**
 * M14/M16 回归（specs/agents-team.md §10 增补五 / §19 契约 6）：
 * - M14：SessionPane 把团队卡**同一节点**同时喂 ConversationTimeline 的 teamCardSlot
 *   （锚定轮轮内）与 footerSlot（无锚定轮兜底钉底）——此前只传 teamCardSlot，
 *   TeamSpawn 轮滚出视口/折叠后卡彻底消失，违反增补五「诚实兜底而非消失」。
 *   两条路由由 Timeline 互斥（锚在场时抑制 footer），同一时刻只挂载一份。
 * - M16：状态面板团队行 open 入口的 target 与消息流卡同一形态（workspaceIdentity/
 *   remoteSessionId 随行）——此前只传 workspacePath，identity≠path 的工作区会与卡片
 *   入口铸出两个不同结构化 id 的 team tab。
 *
 * SessionPane 用 SSR 静态渲染 + mock ConversationTimeline 捕获 props（模式照
 * v4SessionPaneReadOnly.test.ts）；M16 直接测导出的纯函数 resolveTeamStatusPanelOpenTarget。
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { resolveTeamStatusPanelOpenTarget, SessionPane } from "@/v4/SessionPane.js";
import { createTeamFixture } from "./fixtures/agents-team.fixture.js";

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

const timelineProps = vi.hoisted(() => ({
  teamCardSlot: null as ReactNode | undefined,
  footerSlot: null as ReactNode | undefined,
}));

// SSR 渲染不执行 effect，zustand getServerSnapshot 看不到真实 store 写入——直接替换
// store（照 v4SessionPaneReadOnly.test.ts 的既有模式）。
const shareStoreState = vi.hoisted(() => ({
  draft: undefined as unknown,
}));

vi.mock("@/store/conversationShareSelectionStore.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/store/conversationShareSelectionStore.js")>();
  const fakeState = () => ({
    drafts: shareStoreState.draft ? { "child-session": shareStoreState.draft } : {},
    dockStates: {},
    closeShare: vi.fn(),
    confirmSelectionEdit: vi.fn(),
    beginSelectionEdit: vi.fn(),
    cancelSelectionEdit: vi.fn(),
    togglePendingRow: vi.fn(),
    setAllPendingRows: vi.fn(),
    deselectProductTurn: vi.fn(),
    updateDockState: vi.fn(),
    setAccessMode: vi.fn(),
    syncAvailableTurns: vi.fn(),
  });
  const hook = (selector: (state: unknown) => unknown) => selector(fakeState());
  return {
    ...actual,
    useConversationShareSelectionStore: Object.assign(hook, { getState: fakeState }),
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
  useDraftConfigControl: () => ({
    modelSelectionRead: { state: { status: "loading" }, reload: vi.fn() },
    captureAcceptedModelSelection: () => vi.fn(),
    draftConfigRef: { current: {} },
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

vi.mock("@/v4/ConversationComposer.js", async () => {
  const React = await import("react");
  return {
    ConversationComposer: () =>
      React.createElement("div", { "data-testid": "mock-composer" }, "composer"),
  };
});

vi.mock("@/v4/ConversationTimeline.js", async () => {
  const React = await import("react");
  return {
    ConversationTimeline: (props: Record<string, unknown>) => {
      timelineProps.teamCardSlot = props.teamCardSlot as ReactNode | undefined;
      timelineProps.footerSlot = props.footerSlot as ReactNode | undefined;
      return React.createElement("div", { "data-testid": "mock-timeline" });
    },
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

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
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
    meta: { title: "Team", titleSource: "generated" },
    pendingCommands: [],
    pendingInteractions: [],
    plan: null,
    protocolVersion: 1,
    queue: { autoDrain: true, items: [] },
    revision: 1,
    rows: { firstRowId: null, totalCount: 0, window: [] },
    seq: 1,
    sessionId: "lead-session",
    usage: {
      contextWindow: null,
      cumulative: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    },
    ...overrides,
  };
}

function renderPane({
  snapshot,
  readOnly = false,
}: {
  snapshot: ConversationSnapshot;
  readOnly?: boolean;
}): string {
  projectionState.current = {
    lastError: null,
    loadingOlder: false,
    optimisticCommands: [],
    snapshot,
    status: "live",
    subscriptionId: "sub-1",
  };
  return renderToStaticMarkup(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SessionPane, {
        paneId: "pane-1",
        readOnly,
        sessionId: "lead-session",
        workspacePath: "/workspace",
        ...(readOnly ? {} : { onOpenWorkflowRun: () => {} }),
      }),
    ),
  );
}

afterEach(() => {
  timelineProps.teamCardSlot = null;
  timelineProps.footerSlot = null;
});

describe("SessionPane 团队卡双路由喂给（§10 增补五 / M14）", () => {
  it("团队在场：teamCardSlot 与 footerSlot 是同一张卡（同一节点），卡可渲染出摘要 testid", () => {
    const html = renderPane({ snapshot: makeSnapshot({ team: createTeamFixture() }) });

    expect(html).toContain('data-testid="mock-timeline"');
    expect(timelineProps.teamCardSlot).not.toBeNull();
    // M14 核心：兜底路由拿到的是同一节点——Timeline 锚定/兜底互斥下同一时刻只挂载一份。
    expect(timelineProps.footerSlot).toBe(timelineProps.teamCardSlot);
    const slotHtml = renderToStaticMarkup(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        timelineProps.teamCardSlot as ReactNode,
      ),
    );
    expect(slotHtml).toContain('data-testid="team-conversation-summary"');
  });

  it("守卫反例：无团队投影 → 两条路由都不喂（slot 为 null，不出空壳兜底）", () => {
    renderPane({ snapshot: makeSnapshot() });
    expect(timelineProps.teamCardSlot).toBeNull();
    expect(timelineProps.footerSlot).toBeNull();
  });

  it("守卫反例：readOnly 面板不喂卡（与既有 teamCardSlot 守卫同源）", () => {
    renderPane({ snapshot: makeSnapshot({ team: createTeamFixture() }), readOnly: true });
    expect(timelineProps.teamCardSlot).toBeNull();
    expect(timelineProps.footerSlot).toBeNull();
  });
});

describe("resolveTeamStatusPanelOpenTarget（§19 契约 6 / M16）", () => {
  it("身份字段在场即随行——与消息流卡 target（SessionPane 卡片四元组）同一形态", () => {
    expect(
      resolveTeamStatusPanelOpenTarget({
        workspacePath: "/workspace",
        workspaceIdentity: "identity://virtual/team",
        remoteSessionId: "remote-1",
        parentSessionId: "lead-session",
      }),
    ).toEqual({
      workspacePath: "/workspace",
      workspaceIdentity: "identity://virtual/team",
      remoteSessionId: "remote-1",
      parentSessionId: "lead-session",
    });
  });

  it("身份字段缺席/null → 不下发键（exactOptionalPropertyTypes 条件展开语义）", () => {
    const target = resolveTeamStatusPanelOpenTarget({
      workspacePath: "/workspace",
      workspaceIdentity: null,
      remoteSessionId: undefined,
      parentSessionId: "lead-session",
    });
    expect(target).toEqual({
      workspacePath: "/workspace",
      parentSessionId: "lead-session",
    });
    expect(Object.prototype.hasOwnProperty.call(target, "workspaceIdentity")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(target, "remoteSessionId")).toBe(false);
  });
});
