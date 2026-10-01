/* eslint-disable max-lines -- 远控连接、首页、任务和侧板由同一个根组件装配，避免跨组件复制 attachment 状态。 */
// 首页投影 = bootstrap/workspace-list 响应的本地投影；草稿 = composer 本地态
// （AGENTS：UI 局部状态不得当作服务端事实）。
import * as React from "react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  mobileFailureCodeFromWire,
  MobileConnectionStatusCard,
  MobileFailureCard,
} from "../ui/StatusCards.js";
import type { MobileHomeConnectionState } from "../ui/HomeShell.js";
import { HomeScreen } from "./HomeScreen.js";
import { MobileTaskShell } from "../ui/TaskShell.js";
import { IntlProvider, resolveLocale, storeLocale, useIntl } from "../ui/intl.js";
import type { InteractionAnswer } from "../ui/InteractionCards.js";
import {
  createEntryClient,
  parseEntryQuery,
  projectHomeData,
  type ProjectedWorkspace,
} from "./entry.js";
import { TaskSession, createSessionInBridge, openHomeSessionsIndexBridge } from "./taskSession.js";
import type { CollaborationMode } from "./taskSession.js";
import { TaskMoreMenu } from "./TaskMoreMenu.js";
import { NewTaskDraft } from "./NewTaskDraft.js";
// §32.12 队列面板（ui 复原件受控窄入口；git-pane 先例）。
const LazyQueuePanel = React.lazy(() =>
  import("@drora/ui/remote-queue-panel").then((m) => ({
    default: m.ConversationQueuePanel,
  })),
);
import { TaskInfoPopover } from "./TaskInfoPopover.js";
import { RemoteTerminalPane } from "./RemoteTerminalPane.js";
import { useHomeSessionsIndex } from "./useHomeSessionsIndex.js";
import { TaskComposer } from "./TaskComposer.js";
import { RemoteWorkspaceHeader } from "../ui/RemoteWorkspaceHeader.js";
import { RemoteOpenTabShell } from "../ui/RemoteOpenTabShell.js";
import { useAttachmentGitSummary } from "./attachmentGitSummary.js";
// GitPane 一期姊妹件 lazy 化（spec §28.3）：官方复原件重依赖链（useGitRepository+
// IGitService+GitPane/GitActionMenu）拆出主 chunk（P5d 体积纪律；官方 SessionPane
// 惰性 chunk 先例）。
import { DroraIntlProvider } from "@drora/ui/git-pane";
import { TooltipProvider } from "@drora/ui/git-pane";
import { PluginReferenceIconProvider } from "@drora/ui/git-pane";
import { PlatformProvider } from "@drora/ui/git-pane";
import { TabStoreProvider } from "@drora/ui/git-pane";
import { StoreProvider } from "@drora/ui/git-pane";
import { ServiceProvider } from "@drora/ui/git-pane";
import type { IBroadcastService } from "@drora/services";
const LazyRemoteGitSidePane = React.lazy(() =>
  import("./RemoteGitSidePane.js").then((m) => ({ default: m.RemoteGitSidePane })),
);
const LazyRemoteGitActionMenu = React.lazy(() =>
  import("./RemoteGitActionMenu.js").then((m) => ({ default: m.RemoteGitActionMenu })),
);
import { RemoteTaskTimeline } from "./RemoteTaskTimeline.js";
import { useTaskHistory } from "./useTaskHistory.js";
import { formatTaskRelativeTime } from "../ui/formatRelative.js";
import { WideShell } from "../ui/wide/WideShell.js";
import { useWideViewport } from "../ui/wide/useWideViewport.js";
import { EMPTY_MODEL_SELECTION_STATE } from "./conversationStore.js";
import type {
  ConversationControlState,
  ConversationQueueState,
  ModelSelectionState,
} from "./conversationStore.js";
import type {
  ConversationRow,
  ConversationSnapshot,
  PendingInteraction,
  V4ConversationFileChangesResult,
} from "@drora/shared/drora-protocol-v4";
import type { IServiceAccessor, ModelSelectionView } from "@drora/services";
import type { RelayClient } from "@drora/relay-client";
declare const __MOBILE_APP_VERSION__: string;

type Phase =
  | { kind: "loading"; step: "connecting" | "authenticating" | "waiting" | "paired" }
  | { kind: "home" }
  | { kind: "task" }
  | { kind: "failure"; wireReason: string; detail: string | null; retryable: boolean };

import { createRemoteWebPlatform } from "./remoteWebPlatform.js";

// 活跃 accessor（module 级单例——App 单根；AppBody 渲染期写，Tower 渲染期读）。
const activeAccessorRef: { current: IServiceAccessor | null } = { current: null };
const APP_PLATFORM = createRemoteWebPlatform();
const MOCK_APP_BROADCAST: IBroadcastService = {
  send: () => Promise.resolve(),
  acquireClaim: () => Promise.resolve({ status: "unavailable" } as never),
  commitClaim: () => Promise.resolve(),
  releaseClaim: () => Promise.resolve(),
  tryClaim: () => Promise.resolve(false),
  onMessage: Object.assign(() => ({ dispose: () => {} }), {}) as never,
};

/** App 级 Provider 塔（spec §30.9）：恒包 ServiceProvider（value=module ref——
 * AppBody 渲染期已写），覆盖 lazy chunk 全部 useServices 消费。 */
function AppTower({ children }: { children: ReactNode }) {
  return (
    <PlatformProvider platform={APP_PLATFORM}>
      <DroraIntlProvider initialLocale={resolveLocale()}>
        <TooltipProvider delayDuration={0}>
          <PluginReferenceIconProvider value={null}>
            <TabStoreProvider>
              <StoreProvider broadcastService={MOCK_APP_BROADCAST}>
                <ServiceProvider services={activeAccessorRef.current ?? ({} as never)}>
                  {children}
                </ServiceProvider>
              </StoreProvider>
            </TabStoreProvider>
          </PluginReferenceIconProvider>
        </TooltipProvider>
      </DroraIntlProvider>
    </PlatformProvider>
  );
}

function AppBody() {
  const intl = useIntl();
  const [phase, setPhase] = useState<Phase>({ kind: "loading", step: "connecting" });
  const [connection, setConnection] = useState<MobileHomeConnectionState>("connecting");
  const [workspaces, setWorkspaces] = useState<ProjectedWorkspace[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [taskRows, setTaskRows] = useState<ConversationRow[]>([]);
  const [taskTotalCount, setTaskTotalCount] = useState(0);
  const [statusSnapshot, setStatusSnapshot] = useState<ConversationSnapshot | null>(null);
  const [taskTarget, setTaskTarget] = useState<{ path: string; identity?: string } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [controlState, setControlState] = useState<ConversationControlState | null>(null);
  const [pendingInteractions, setPendingInteractions] = useState<readonly PendingInteraction[]>([]);
  const [queueState, setQueueState] = useState<ConversationQueueState | null>(null);
  const [fileChanges, setFileChanges] = useState<V4ConversationFileChangesResult | null>(null);
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelView, setModelView] = useState<ModelSelectionView | null>(null);
  const [modelState, setModelState] = useState<ModelSelectionState | null>(null);
  // P6 composer 深面：官方 mode.label.glm.{mode} 的 mode 值（snapshot.config.mode）。
  const [configMode, setConfigMode] = useState<string | null>(null);
  // 官方侧板按钮先显示标签启动器；Git 审查由状态面板独立打开。
  const [sidePaneMode, setSidePaneMode] = useState<"launcher" | "git" | "terminal" | null>(null);
  // 32.9 draft surface target: + opens the draft (no session yet);
  // the first send creates the session (createSession -> sendText).
  const [draftTarget, setDraftTarget] = useState<{
    workspaceKey: string;
    path: string;
    name: string;
  } | null>(null);
  // §32.11 会话活动时刻（客户端跟踪：store 每次变更即活动，用于信息弹层「最近活动」行）。
  const [taskActivityAtMs, setTaskActivityAtMs] = useState<number | null>(null);
  // 32.11 task info popover open state (folder button anchor).
  const [infoOpen, setInfoOpen] = useState(false);
  // §32.3 更多菜单开合（菜单渲染在 header 触发按钮锚点，内容归 TaskMoreMenu）。
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const clientRef = useRef<RelayClient | null>(null);
  const taskRef = useRef<TaskSession | null>(null);
  const { loadingOlder, loadOlder, resetOlder } = useTaskHistory(taskRef);
  const storeUnsubscribeRef = useRef<(() => void) | null>(null);
  // P5b 宽视口（spec §19）：官方断点 (max-width: 767px) 取反——≥768px 交 WideShell
  // 全壳（侧栏+主区），<768px 维持既有单列壳（零回归）。
  const wideViewport = useWideViewport();
  // P6 文件域（spec §29.5 解封）：首页桥 accessor 记录（TaskSearchPanel 文件搜索供给）。
  const homeBridgeAccessorRef = useRef<IServiceAccessor | null>(null);
  // 渲染期同步（module ref 赋值非 state，不触发渲染）。
  activeAccessorRef.current =
    (phase.kind === "task" ? taskRef.current?.accessor : null) ?? homeBridgeAccessorRef.current;
  const openHomeBridge = useCallback((workspacePath: string, workspaceIdentity?: string) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("relay client is not connected"));
    return openHomeSessionsIndexBridge(client, workspacePath, workspaceIdentity).then(
      (bridge) => {
        homeBridgeAccessorRef.current = bridge.accessor;
        return bridge;
      },
    );
  }, []);
  const liveWorkspaces = useHomeSessionsIndex(workspaces, openHomeBridge);

  const attachedTask =
    phase.kind === "task" &&
    taskRef.current?.target.sessionId === selectedTaskId &&
    (taskRef.current.target.workspaceIdentity?.trim() || taskRef.current.target.workspacePath) ===
      (taskTarget?.identity?.trim() || taskTarget?.path)
      ? taskRef.current
      : null;
  const gitStatus = useAttachmentGitSummary({
    gitService: attachedTask?.accessor.gitService ?? null,
    workspacePath: attachedTask?.target.workspacePath ?? null,
    workspaceIdentity: attachedTask?.target.workspaceIdentity,
    activeTaskId: attachedTask?.target.sessionId ?? null,
  });

  // §32.3 重命名回流：v4 renameSession 后新标题经快照 meta 帧到达（titleSource=custom
  // 抑制自动标题）；标题唯一所有者是服务端快照，本地只在帧到达时跟随。
  const metaTitle = statusSnapshot?.meta?.title;
  useEffect(() => {
    if (metaTitle) setTaskTitle(metaTitle);
  }, [metaTitle]);

  const fail = useCallback((wireReason: string, detail: string | null, retryable: boolean) => {
    setPhase({ kind: "failure", wireReason, detail, retryable });
  }, []);

  // —— 连接生命周期（一次装配；重连沿走 session 内部退避） ——
  useEffect(() => {
    const query = parseEntryQuery(window.location.search);
    if (!query) {
      fail("invalid-mobile-connection", "missing sid/hash query", false);
      return;
    }
    const client = createEntryClient(query, window.location, {
      diagnostics: (diagnostic) => {
        // 手机端状态机事件上送（桌面只记日志，白名单见 desktopMobileRelayControl）。
        client.reportDiagnostic({ event: "state-transition", ...diagnostic });
      },
      onFailure: (failure) => {
        fail(failure.reason, failure.message ?? null, false);
      },
    });
    clientRef.current = client;
    // 挂起恢复（官方 suspended 语义）：UI 监听可见性驱动 session。
    const onVisibility = () => {
      if (document.visibilityState === "hidden") client.session.notifyHidden();
      else client.session.notifyVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    client.connect();
    let cancelled = false;
    void (async () => {
      try {
        await client.whenPaired();
        if (cancelled) return;
        setPhase({ kind: "loading", step: "paired" });
        const bootstrap = await client.bootstrap(20_000);
        if (cancelled) return;
        if (!bootstrap || bootstrap.success === false) {
          fail(
            "desktop-bootstrap-timeout",
            bootstrap && typeof bootstrap.error === "string" ? bootstrap.error : null,
            true,
          );
          return;
        }
        const home = projectHomeData(bootstrap.result);
        setWorkspaces(home.workspaces);
        setSelectedTaskId(home.activeTaskId);
        setConnection("connected");
        setPhase({ kind: "home" });
      } catch (error) {
        if (cancelled) return;
        const failure = error as { reason?: string; message?: string };
        fail(failure.reason ?? "unexpected-error", failure.message ?? null, false);
      }
    })();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      client.disconnect();
      clientRef.current = null;
    };
  }, [fail]);

  // —— 动作 ——

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const listing = await client.listWorkspaces(20_000);
    if (!listing || listing.success === false) {
      client.reportDiagnostic({ event: "workspace-list-refresh", reason: "unavailable" });
      return;
    }
    setWorkspaces(projectHomeData(listing.result).workspaces);
  }, []);

  const openTask = useCallback(
    async (workspace: { workspaceKey: string; path: string }, sessionId: string, title: string) => {
      const client = clientRef.current;
      if (!client) return;
      setSelectedTaskId(sessionId);
      setTaskTitle(title);
      setTaskRows([]);
      setTaskTotalCount(0);
      setStatusSnapshot(null);
      setSidePaneMode(null);
      setMoreMenuOpen(false);
      setTaskActivityAtMs(null);
      resetOlder();
      setTaskTarget({
        path: workspace.path,
        ...(workspace.workspaceKey !== workspace.path ? { identity: workspace.workspaceKey } : {}),
      });
      setPhase({ kind: "task" });
      try {
        const session = await TaskSession.open(
          client,
          {
            workspacePath: workspace.path,
            ...(workspace.workspaceKey !== workspace.path
              ? { workspaceIdentity: workspace.workspaceKey }
              : {}),
            sessionId,
          },
          __MOBILE_APP_VERSION__,
        );
        taskRef.current = session;
        // P3a/P3b：store 订阅驱动（快照/增量帧到达即同步行、composer 状态与交互卡）。
        const syncFromStore = () => {
          // 订阅回调会持有旧渲染闭包；面板与 mode 必须读取同一帧快照，不能从 React state 反读。
          const snapshot = session.getStatusSnapshot();
          setTaskRows([...session.rows]);
          setTaskTotalCount(session.totalRowCount);
          setStatusSnapshot(snapshot);
          setControlState(session.getControlState());
          setPendingInteractions(session.getPendingInteractions());
          setQueueState(session.getQueueState());
          setModelState(session.getModelSelectionState());
          // P6 composer 深面：官方 mode.label.glm.{mode} 的 mode 值（snapshot.config.mode）。
          setConfigMode(snapshot?.config.mode ?? null);
          // §32.11 会话活动时刻（帧到达即活动；信息弹层「最近活动」行）。
          setTaskActivityAtMs(Date.now());
        };
        syncFromStore();
        storeUnsubscribeRef.current?.();
        storeUnsubscribeRef.current = session.subscribe(syncFromStore);
        // P3b：文件变更统计（打开任务面拉取一次，发送后刷新）；P3c：模型清单视图。
        void session.fetchFileChanges().then((changes) => setFileChanges(changes));
        setModelLoading(true);
        void session
          .getModelSelectionView()
          .then((view) => setModelView(view))
          .finally(() => setModelLoading(false));
        client.reportViewState({
          activeWorkspaceKey: workspace.workspaceKey,
          activeTaskId: sessionId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // bridge-error reason 已在 message 里（openWorkspaceBridge 抛出）。
        const reason = message.startsWith("workspace bridge error: ")
          ? message.slice("workspace bridge error: ".length)
          : "unexpected-error";
        fail(reason, message, true);
      }
    },
    [fail, resetOlder],
  );

  // P6 新建任务解封（spec §30，capability 第四例）：createSession → ACK sessionId →
  // 打开新任务面（桌面同语义：空会话，首输走 composer）。
  const handleNewTask = useCallback(
    (workspace?: { workspaceKey: string; path: string }) => {
      const accessor = homeBridgeAccessorRef.current;
      const ws = workspace ?? liveWorkspaces[0];
      if (!accessor || !ws) return;
      activeAccessorRef.current = accessor;
      void createSessionInBridge(accessor, ws.path, ws.workspaceKey)
        .then(({ sessionId, title }) =>
          openTask({ workspaceKey: ws.workspaceKey, path: ws.path }, sessionId, title),
        )
        .catch(() => {});
    },
    [liveWorkspaces, openTask],
  );
  const backHome = useCallback(() => {
    storeUnsubscribeRef.current?.();
    storeUnsubscribeRef.current = null;
    taskRef.current?.close();
    taskRef.current = null;
    setControlState(null);
    setStatusSnapshot(null);
    setSidePaneMode(null);
    setMoreMenuOpen(false);
    setInfoOpen(false);
    setTaskActivityAtMs(null);
    setTaskTarget(null);
    resetOlder();
    setPendingInteractions([]);
    setQueueState(null);
    setFileChanges(null);
    setModelMenuOpen(false);
    setModelState(null);
    setConfigMode(null);
    setModelView(null);
    setPhase({ kind: "home" });
    void refresh();
  }, [refresh, resetOlder]);

  const sendDraft = useCallback(async () => {
    const session = taskRef.current;
    const text = draft.trim();
    if (!session || !text || sending) return;
    setSending(true);
    try {
      await session.sendText(text);
      setDraft("");
      // 用户回显与助手响应经订阅帧到达（P3a 流式）；文件变更随发送刷新。
      void session.fetchFileChanges().then((changes) => setFileChanges(changes));
    } finally {
      setSending(false);
    }
  }, [draft, sending]);

  // 阻塞交互应答（P3b）：resolveInteraction 命令；快照更新经订阅帧回灌。
  const resolveInteraction = useCallback(
    async (interactionId: string, answer: InteractionAnswer) => {
      const session = taskRef.current;
      if (!session || answering) return;
      setAnswering(true);
      try {
        await session.resolveInteraction(interactionId, answer);
      } finally {
        setAnswering(false);
      }
    },
    [answering],
  );

  // 停止生成（v4 stop 命令；expectedForegroundExecutionId 由 store 从 control.activeWorks 取）。
  const stopGeneration = useCallback(async () => {
    const session = taskRef.current;
    if (!session || stopping) return;
    setStopping(true);
    try {
      await session.sendStop();
    } finally {
      setStopping(false);
    }
  }, [stopping]);

  // §32.9 草稿首输：createSession → openTask → sendText（首条输入随建会话入局）。
  const handleDraftSend = useCallback(
    (ws: { workspaceKey: string; path: string; name?: string } | null, text: string) => {
      if (!ws) return;
      setDraftTarget(null);
      void (async () => {
        const created = await createSessionInBridge(
          homeBridgeAccessorRef.current as IServiceAccessor,
          ws.path,
          ws.workspaceKey,
        );
        await openTask(
          { workspaceKey: ws.workspaceKey, path: ws.path },
          created.sessionId,
          created.title,
        );
        await taskRef.current?.sendText(text);
      })().catch(() => {});
    },
    [openTask],
  );

  // §32.3 协作模式切换（v4 switchCollaborationMode CAS）；标签由 config.mode 快照回流。
  const handleModeSelect = useCallback((mode: CollaborationMode) => {
    void taskRef.current?.switchMode(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    const dark = document.documentElement.classList.toggle("dark");
    setTheme(dark ? "dark" : "light");
    try {
      localStorage.setItem("drora-mobile-theme", dark ? "dark" : "light");
    } catch {
      // 快照失败不影响本次切换。
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    const next = resolveLocale() === "zh-CN" ? "en-US" : "zh-CN";
    storeLocale(next);
    window.location.reload();
  }, []);

  // —— 渲染 ——

  // P3a/P3b：富时间线 + 交互卡（权限/问答置顶）+ 文件变更统计条。
  // P6 骨架对齐（spec §23.10）：官方窄壳 composer 实挂 [conversation-bottom-dock-
  // transition] 双层 grid（同格叠放动画 buffer）；UI 包链路为 wide 版
  // data-v4-composer-dock 透明层（D6 冻结域不动）——grid 外壳在 mobile-web 侧包。
  const composer =
    taskTarget && selectedTaskId ? (
      <div data-testid="conversation-bottom-dock-transition" className="grid w-full">
        <div
          data-testid="conversation-bottom-dock-transition-layer"
          className="col-start-1 row-start-1 w-full min-w-0"
        >
          {/* §32.12 队列面板（官方 composer 上方逐条卡片；ui 复原件受控窄入口）。 */}
          {statusSnapshot?.queue && statusSnapshot.queue.items.length > 0 ? (
            <React.Suspense fallback={null}>
              <DroraIntlProvider initialLocale={resolveLocale()}>
                <TooltipProvider delayDuration={0}>
                  <LazyQueuePanel
                    queue={statusSnapshot.queue}
                    onDeleteItem={(queueItemId) =>
                      void taskRef.current?.queueDeleteItem(queueItemId)
                    }
                    onEditItem={async (queueItemId) => {
                      const item = statusSnapshot.queue?.items.find(
                        (q) => q.queueItemId === queueItemId,
                      );
                      if (!item) return;
                      const result = await taskRef.current?.queueDeleteItem(queueItemId);
                      if (result?.ok) setDraft(item.text);
                    }}
                    onSendNow={(queueItemId) =>
                      void taskRef.current?.queueSendNow(queueItemId)
                    }
                    onMoveItem={(queueItemId, beforeQueueItemId) =>
                      void taskRef.current?.queueReorderItem(queueItemId, beforeQueueItemId)
                    }
                    onResume={() => {
                      void taskRef.current?.setQueueAutoDrain(true);
                    }}
                  />
                </TooltipProvider>
              </DroraIntlProvider>
            </React.Suspense>
          ) : null}
          <TaskComposer
        draft={draft}
        sending={sending}
        stopping={stopping}
        controlState={controlState}
        queueState={queueState}
        modelState={modelState ?? EMPTY_MODEL_SELECTION_STATE}
        modelView={modelView}
        modelLoading={modelLoading}
        modelMenuOpen={modelMenuOpen}
        configMode={configMode}
        onDraftChange={setDraft}
        onSend={() => void sendDraft()}
        onStop={() => void stopGeneration()}
        onToggleModelMenu={() => {
          const session = taskRef.current;
          if (!session) return;
          setModelMenuOpen((open) => !open);
          if (!modelMenuOpen) {
            setModelLoading(true);
            void session
              .getModelSelectionView()
              .then((view) => setModelView(view))
              .finally(() => setModelLoading(false));
          }
        }}
        onModelSelect={(selection) => {
          setModelMenuOpen(false);
          const session = taskRef.current;
          if (session) void session.switchModel(selection);
        }}
        onCloseModelMenu={() => setModelMenuOpen(false)}
        onModeSelect={handleModeSelect}
      />
        </div>
      </div>
    ) : null;

  const timelineContent =
    taskTarget && selectedTaskId ? (
      <RemoteTaskTimeline
        rows={taskRows}
        totalCount={taskTotalCount}
        sessionKey={selectedTaskId}
        workspacePath={taskTarget.path}
        workspaceIdentity={taskTarget.identity}
        locale={resolveLocale()}
        theme={theme}
        sessionPhase={controlState?.phase ?? undefined}
        modelSelectionView={modelView}
        statusSnapshot={statusSnapshot}
        gitSummary={gitStatus.summary}
        gitDirtyFileCount={gitStatus.dirtyFileCount}
        gitWorktreeChangeSummary={gitStatus.changeSummary}
        onRefreshGit={gitStatus.refresh}
        onOpenGitReview={() => setSidePaneMode("git")}
        onPauseGoal={() => {
          const session = taskRef.current;
          if (session?.target.sessionId === selectedTaskId) void session.pauseGoal();
        }}
        onResumeGoal={() => {
          const session = taskRef.current;
          if (session?.target.sessionId === selectedTaskId) void session.resumeGoal();
        }}
        onCancelBackgroundWork={(workId) => {
          const session = taskRef.current;
          if (session?.target.sessionId === selectedTaskId) {
            void session.cancelBackgroundWork(workId);
          }
        }}
        interactions={pendingInteractions}
        answering={answering}
        onResolve={(interactionId, answer) => void resolveInteraction(interactionId, answer)}
        fileChanges={fileChanges}
        canLoadOlder={taskRef.current?.canLoadOlder ?? false}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        bottomDock={composer}
        onFeedbackChange={(target, feedback) =>
          taskRef.current?.setAssistantFeedback(target.rowId, target.entityId, feedback)
        }
        onFork={(target) => void taskRef.current?.forkAssistant(target.rowId, target.entityId)}
      />
    ) : null;
  // AppTower 的初始 fallback accessor 不会随 AppBody 的 task state 重渲染；
  // Git 状态行中的 GitBranchSwitcher/GitActionMenu 必须读取当前 attachment 的服务。
  const timeline = attachedTask ? (
    <ServiceProvider services={attachedTask.accessor}>{timelineContent}</ServiceProvider>
  ) : (
    timelineContent
  );

  if (phase.kind === "loading") {
    const doneCount = ["connecting", "authenticating", "waiting", "paired"].indexOf(phase.step);
    return (
      <MobileConnectionStatusCard
        phase={phase.step}
        doneCount={doneCount}
        activeCount={doneCount + 1}
      />
    );
  }

  if (phase.kind === "failure") {
    return (
      <MobileFailureCard
        code={mobileFailureCodeFromWire(phase.wireReason)}
        detail={phase.detail}
        onAction={phase.retryable ? () => window.location.reload() : undefined}
      />
    );
  }

  // P5b：任务面装配提前为元素常量（宽壳主区容器与窄壳全屏壳同源复用；仅元素构造，
  // 渲染由下方分支决定）。
  // 侧板模式由 App 持有；Git 审查只从状态面板打开，普通开关显示官方标签启动壳。
  const sidePane =
    phase.kind === "task" && taskTarget && attachedTask && sidePaneMode === "git" ? (
      <React.Suspense fallback={null}>
      <LazyRemoteGitSidePane
        key={`${taskTarget.identity?.trim() || taskTarget.path}:${selectedTaskId}`}
        open
        onClose={() => setSidePaneMode("launcher")}
        workspacePath={taskTarget.path}
        workspaceIdentity={taskTarget.identity}
        remoteSessionId={null}
        accessor={attachedTask.accessor}
        activeTaskId={selectedTaskId}
        onRefreshGit={gitStatus.refresh}
      />
      </React.Suspense>
    ) : phase.kind === "task" && taskTarget && sidePaneMode === "launcher" ? (
      <RemoteOpenTabShell
        onClose={() => setSidePaneMode(null)}
        onOpenReview={attachedTask ? () => setSidePaneMode("git") : undefined}
        items={
          attachedTask
            ? [
                {
                  id: "terminal",
                  label: intl.formatMessage({ id: "chat.statusPanel.terminals" }),
                  onOpen: () => setSidePaneMode("terminal"),
                },
              ]
            : []
        }
      />
    ) : phase.kind === "task" && taskTarget && sidePaneMode === "terminal" && attachedTask ? (
      <aside
        aria-label={intl.formatMessage({ id: "chat.statusPanel.terminals" })}
        className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-[85%] flex-col border-l border-border bg-background shadow-lg"
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-ui-sm font-medium text-foreground">
            {intl.formatMessage({ id: "chat.statusPanel.terminals" })}
          </span>
          <button
            type="button"
            aria-label={intl.formatMessage({ id: "common.cancel" })}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setSidePaneMode(null)}
          >
            ✕
          </button>
        </div>
        <RemoteTerminalPane
          terminal={attachedTask.accessor.terminalService}
          workspacePath={taskTarget.path}
        />
      </aside>
    ) : null;

  const taskShell =
    phase.kind === "task" ? (
      <MobileTaskShell
        onBack={backHome}
        onThemePress={toggleTheme}
        timelineOwnsScroll
        timeline={timeline}
        workspaceHeader={
          taskTarget ? (
            <RemoteWorkspaceHeader
              onPathClick={attachedTask ? () => setInfoOpen((open) => !open) : undefined}
              infoSlot={
                attachedTask && taskTarget ? (
                  <TaskInfoPopover
                    open={infoOpen}
                    onClose={() => setInfoOpen(false)}
                    name={taskTarget.path.split(/[\\/]/).filter(Boolean).pop() ?? taskTarget.path}
                    workspacePath={taskTarget.path}
                    branchName={gitStatus.summary?.branchName ?? null}
                    lastActivityText={
                      taskActivityAtMs
                        ? formatTaskRelativeTime(taskActivityAtMs, intl)
                        : undefined
                    }
                  />
                ) : null
              }
              title={taskTitle}
              workspacePath={taskTarget.path}
              onToggleSidePane={attachedTask ? () => setSidePaneMode((mode) => mode ? null : "launcher") : undefined}
              sidePaneOpen={sidePaneMode !== null}
              // §32.3 更多菜单一期（重命名/复制路径/复制会话 ID）；菜单锚在 ⋯ 触发按钮。
              onMoreMenu={attachedTask ? () => setMoreMenuOpen((open) => !open) : undefined}
              moreMenuSlot={
                attachedTask ? (
                  <TaskMoreMenu
                    open={moreMenuOpen}
                    onClose={() => setMoreMenuOpen(false)}
                    workspacePath={taskTarget.path}
                    sessionId={selectedTaskId ?? ""}
                    title={taskTitle}
                    onRename={(next) => attachedTask.renameSession(next)}
                    loadMembership={() =>
                      Promise.all([
                        attachedTask.accessor.droraTaskService.listPinnedTaskIds(),
                        attachedTask.accessor.droraTaskService.listArchivedTasks({
                          workspacePath: taskTarget.path,
                          workspaceIdentity: taskTarget.identity,
                        }),
                      ]).then(([pinnedIds, archived]) => ({
                        pinned: pinnedIds.includes(selectedTaskId ?? ""),
                        archived: archived.some(
                          (meta) => String(meta.taskId) === (selectedTaskId ?? ""),
                        ),
                      }))
                    }
                    onTogglePinned={(pinned) =>
                      attachedTask.accessor.droraTaskService
                        .setTaskPinned({
                          taskId: selectedTaskId ?? "",
                          workspacePath: taskTarget.path,
                          workspaceIdentity: taskTarget.identity,
                          pinned,
                        })
                        .then(() => true)
                        .catch(() => false)
                    }
                    onArchive={() =>
                      attachedTask.accessor.droraTaskService
                        .archiveTask({
                          taskId: selectedTaskId ?? "",
                          workspacePath: taskTarget.path,
                          workspaceIdentity: taskTarget.identity,
                        })
                        .then(() => true)
                        .catch(() => false)
                    }
                    onMarkUnread={() =>
                      attachedTask.accessor.droraTaskService
                        .setTaskUnread({
                          taskId: selectedTaskId ?? "",
                          workspacePath: taskTarget.path,
                          workspaceIdentity: taskTarget.identity,
                          unread: true,
                        })
                        .then(() => true)
                        .catch(() => false)
                    }
                  />
                ) : null
              }
              // P6 commit-dialog 一期（spec §27.1）：官方「提交或推送」入口（GitActionMenu
              // 复原件；协议面 IGitService generateCommitMessage/commit 100% 既有）。
              // GitActionMenu 跨 chunk Context 双实例崩暂回退（spec §30.2）：useServices
              // 拷贝在 lazy chunk，Provider 塔同 chunk 仍崩——根因待专项（rolldown ui 包
              // 双入口解析）。新建任务主功能保通（点新建→createSession→新任务面）。
              gitAction={
                attachedTask ? (
                  <React.Suspense fallback={null}>
                    <LazyRemoteGitActionMenu
                      workspacePath={taskTarget.path}
                      workspaceIdentity={taskTarget.identity}
                      accessor={attachedTask.accessor}
                      gitSummary={gitStatus.summary}
                      onRefreshGit={gitStatus.refresh}
                    />
                  </React.Suspense>
                ) : null
              }
            />
          ) : null
        }
      />
    ) : null;

  // P5b 宽壳：≥768px 侧栏+主区（主区 = 已选任务宽容器 / 问候空态）；数据与回调全部
  // 复用既有 state/动作，本处只做接线。
  if (wideViewport) {
    return (
      <div className="relative h-dvh w-full">
      <WideShell
        connection={connection}
        workspaces={liveWorkspaces}
        selectedTaskId={selectedTaskId}
        isRefreshing={false}
        taskSurface={taskShell}
        onTaskOpen={(task, workspace) => void openTask(workspace, task.sessionId, task.title)}
        onNewTask={handleNewTask}
        onDraftSend={(text) =>
          handleDraftSend(
            liveWorkspaces[0]
              ? {
                  workspaceKey: liveWorkspaces[0].workspaceKey,
                  path: liveWorkspaces[0].path,
                  name: liveWorkspaces[0].name,
                }
              : null,
            text,
          )
        }
        draftSending={sending}
        onSearchFiles={(query) => {
          const accessor = homeBridgeAccessorRef.current;
          if (!accessor) return Promise.resolve([]);
          return accessor.fileService.searchWorkspaceFiles({
            rootPath: liveWorkspaces[0]?.path ?? "",
            workspaceIdentity: liveWorkspaces[0]?.workspaceKey,
            query,
            limit: 8,
          });
        }}
        onFileSelect={(entry) => {
          setDraft((draft) => (draft && !draft.endsWith(" ") ? draft + " " : draft) + "@" + entry.relativePath);
        }}
        onRefresh={() => void refresh()}
        onThemePress={toggleTheme}
        onLanguagePress={toggleLanguage}
        onReconnect={() => clientRef.current?.connect()}
      />
      {sidePane}
      </div>
    );
  }

  // §32.9 草稿面（窄壳；宽壳维持 §30 直建语义）。§32.16 多工作区下拉切换项目。
  if (draftTarget && phase.kind === "home") {
    const draftWorkspaces = liveWorkspaces.map((ws) => ({
      workspaceKey: ws.workspaceKey,
      path: ws.path,
      name: ws.name,
    }));
    const selected =
      draftWorkspaces.find((ws) => ws.workspaceKey === draftTarget.workspaceKey) ?? draftTarget;
    return (
      <NewTaskDraft
        workspaceName={selected.name}
        workspaces={draftWorkspaces}
        onBack={() => setDraftTarget(null)}
        onThemePress={toggleTheme}
        sending={sending}
        onSend={(text, ws) => handleDraftSend(ws ?? selected, text)}
      />
    );
  }

  if (phase.kind === "task") {
    return (
      <div className="relative h-dvh w-full">
        {taskShell}
        {sidePane}
      </div>
    );
  }

  return (
    <HomeScreen
      connection={connection}
      workspaces={liveWorkspaces}
      selectedTaskId={selectedTaskId}
      isRefreshing={false}
      onTaskOpen={(task, workspace) => void openTask(workspace, task.sessionId, task.title)}
      onWorkspaceNewTask={(workspace) =>
        setDraftTarget({
          workspaceKey: workspace.workspaceKey,
          path: workspace.path,
          name: workspace.name ?? workspace.path,
        })}
      onSearchFiles={(query) => {
        const accessor = homeBridgeAccessorRef.current;
        if (!accessor) return Promise.resolve([]);
        return accessor.fileService.searchWorkspaceFiles({
          rootPath: liveWorkspaces[0]?.path ?? "",
          workspaceIdentity: liveWorkspaces[0]?.workspaceKey,
          query,
          limit: 8,
        });
      }}
      onFileSelect={(entry) => {
        setDraft((draft) => (draft && !draft.endsWith(" ") ? draft + " " : draft) + "@" + entry.relativePath);
      }}
      onRefresh={() => void refresh()}
      onThemePress={toggleTheme}
      onLanguagePress={toggleLanguage}
      onReconnect={() => clientRef.current?.connect()}
    />
  );
}



export function App() {
  // accessor 动态组合（spec §30.2）：任务桥优先，回退首页 sessions-index 桥——
  // module 级 ref（AppBody 渲染期同步写入；App 单根实例安全）。
  return (
    <AppTower>
      <IntlProvider>
        <AppBody />
      </IntlProvider>
    </AppTower>
  );
}
