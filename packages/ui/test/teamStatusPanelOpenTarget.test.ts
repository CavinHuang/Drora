// @vitest-environment jsdom
/**
 * M16 面板级回归（specs/agents-team.md §19 契约 6，强度对齐 teamStatusPanelHalt.test.tsx）：
 * 渲染 SessionPane（真实 ConversationStatusPanel），点击状态面板团队行（status-panel-team-row），
 * 断言 TeamNavigationProvider 的 onOpen 收到与消息流卡同一形态的 target——
 * workspaceIdentity/remoteSessionId 随行。若 handler 回退为旧的两字段对象
 * （workspacePath+parentSessionId），本测试失败（纯函数测试只锁形态，锁不住调用点）。
 *
 * SessionPane 的 mock 集照 teamSessionPaneCardRouting.test.ts（SSR 版）；本文件为
 * client render + fireEvent，ConversationStatusPanel 不打桩（团队行真实渲染）。
 */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { TeamNavigationProvider } from "@/team/TeamNavigation.js";
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

const shareStoreState = vi.hoisted(() => ({
  draft: undefined as unknown,
}));

vi.mock("@/store/conversationShareSelectionStore.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/store/conversationShareSelectionStore.js")>();
  const fakeState = () => ({
    drafts: shareStoreState.draft ? { "lead-session": shareStoreState.draft } : {},
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

vi.mock("@/v4/V4ConversationContext.js", () => {
  // 引用必须稳定：每次渲染 new 一个 context 对象会让依赖 [layer] 的 effect
  // 每轮都重跑并 setState，React 直接判「Too many re-renders」——工厂内建单例。
  const conversation = {
    attachmentPut: () => undefined,
    // SessionPane 挂载期会 layer.acquire 并在 lease.store 上挂多个监听/刷新调用
    //（onOnlineModelTransition / refreshPlans / …，逐个补桩是无底洞）——用 Proxy 把
    // store 任意属性都放行为「返回退订函数的函数」，挂载期调用全部安全空转。
    layer: {
      acquire: () => ({
        release: () => undefined,
        store: new Proxy({}, { get: () => () => () => undefined }) as unknown as Record<
          string,
          () => () => () => undefined
        >,
      }),
    },
    sendCommand: () => undefined,
  };
  return { useV4Conversation: () => conversation };
});

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

// client render（fireEvent）下 SessionPane 的 mount effect 会真实执行：highspeed
// 卡快照 effect（SessionPane highspeedCardService.getSnapshot）与 BotGroupDelivery
// 的 useBotGroupTask（botsService.getBotStates + broadcastService.onMessage）都打在
// useServices 解构结果上——SSR 版 mock 集只给两个 service 即不够，这里补齐 stub
// （评审二轮反馈的确定性失败点；方法面只盖 mount 期会触达的调用）。
vi.mock("@/hooks/useServices.js", () => {
  // 同上：useServices 的返回对象也必须跨渲染稳定，否则依赖它的 effect 会自激重渲染。
  const services = {
    botsService: {
      getConfig: async () => ({ bots: [] }),
      getBotStates: async () => [],
    },
    broadcastService: {
      onMessage: () => ({ dispose: () => {} }),
    },
    conversationShareService: {},
    highspeedCardService: {
      getSnapshot: async () => ({ card: null }),
    },
    modelSelectionService: {},
    usageStatsService: {},
    droraSessionService: {
      updateProviderRegistry: () => undefined,
    },
    droraTaskService: {
      restartWorkspaceProcess: () => undefined,
    },
  };
  return {
    useComposerClientNamespace: () => "desktop",
    useOptionalServices: () => null,
    useServices: () => services,
  };
});

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

// useWorkflowRunJournalSummaries 经 useV4Conversation() 取 workflowRuns（dwf run 枚举），
// 本测试只验证状态面板 open target、不挂传输上下文——挂载期该 hook 会以 undefined 调用
// 抛 TypeError（评审二轮补的 useServices stub 盖不到传输层），这里按无关面直接置空。
vi.mock("@/hooks/useWorkflowRunJournalSummaries.js", () => ({
  useWorkflowRunJournalSummaries: () => null,
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
    ConversationTimeline: () => React.createElement("div", { "data-testid": "mock-timeline" }),
  };
});

vi.mock("@/v4/ConversationHeader.js", async () => {
  const React = await import("react");
  return {
    ConversationHeader: () => React.createElement("div", { "data-testid": "mock-header" }),
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

// 团队行的一键停止/恢复走 useConfirmDialog——真实实现依赖 Dialog context，照
// teamStatusPanelHalt.test.tsx 打桩（本用例不触发，仅防挂载期依赖）。
vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => () => Promise.resolve(true),
}));

function makeSnapshot(): ConversationSnapshot {
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
    team: createTeamFixture(),
  };
}

beforeEach(() => {
  // jsdom 无 ResizeObserver/IntersectionObserver（面板内组件按需观测尺寸）。
  window.ResizeObserver =
    window.ResizeObserver ??
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
  window.IntersectionObserver =
    window.IntersectionObserver ??
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    } as unknown as typeof IntersectionObserver);
});

afterEach(cleanup);

describe("状态面板团队行 open 入口 target 形态（§19 契约 6 / M16）", () => {
  it("点击团队行 → TeamNavigation.onOpen 收到身份字段随行的完整 target", async () => {
    projectionState.current = {
      lastError: null,
      loadingOlder: false,
      optimisticCommands: [],
      snapshot: makeSnapshot(),
      status: "live",
      subscriptionId: "sub-1",
    };
    const onOpen = vi.fn();
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          TooltipProvider,
          null,
          createElement(
            TeamNavigationProvider,
            { onOpen },
            createElement(SessionPane, {
              paneId: "pane-1",
              sessionId: "lead-session",
              workspacePath: "/workspace",
              workspaceIdentity: "identity://virtual/team",
              remoteSessionId: "remote-1",
              onOpenWorkflowRun: () => {},
            }),
          ),
        ),
      ),
    );

    const row = await screen.findByTestId("status-panel-team-row");
    expect((row as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(row);

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onOpen).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      workspaceIdentity: "identity://virtual/team",
      remoteSessionId: "remote-1",
      parentSessionId: "lead-session",
    });
  });
});
