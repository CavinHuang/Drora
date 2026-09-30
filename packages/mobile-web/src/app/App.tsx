/* eslint-disable max-lines -- 远控连接、首页和任务面由同一个根组件装配，状态面板只接入现有订阅镜像。 */
// R3 P2a/P3 应用装配：四步卡 → 首页（HomeScreen，应用帧数据）→ 任务面（服务面流式）→ 失败卡。
// 状态所有者：连接/配对 = RelaySession；会话行/交互/模型/用量 = conversation store 派生；
// 首页投影 = bootstrap/workspace-list 响应的本地投影；草稿 = composer 本地态
// （AGENTS：UI 局部状态不得当作服务端事实）。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  mobileFailureCodeFromWire,
  MobileConnectionStatusCard,
  MobileFailureCard,
} from "../ui/StatusCards.js";
import type { MobileHomeConnectionState } from "../ui/HomeShell.js";
import { HomeScreen } from "./HomeScreen.js";
import { MobileTaskShell } from "../ui/TaskShell.js";
import { IntlProvider, resolveLocale, storeLocale } from "../ui/intl.js";
import type { InteractionAnswer } from "../ui/InteractionCards.js";
import {
  createEntryClient,
  parseEntryQuery,
  projectHomeData,
  type ProjectedWorkspace,
} from "./entry.js";
import { TaskSession, openHomeSessionsIndexBridge } from "./taskSession.js";
import { useHomeSessionsIndex } from "./useHomeSessionsIndex.js";
import { TaskComposer } from "./TaskComposer.js";
import { RemoteWorkspaceHeader } from "../ui/RemoteWorkspaceHeader.js";
import { RemoteTaskTimeline } from "./RemoteTaskTimeline.js";
import { useTaskHistory } from "./useTaskHistory.js";
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
import type { ModelSelectionView } from "@drora/services";
import type { RelayClient } from "@drora/relay-client";
declare const __MOBILE_APP_VERSION__: string;

type Phase =
  | { kind: "loading"; step: "connecting" | "authenticating" | "waiting" | "paired" }
  | { kind: "home" }
  | { kind: "task" }
  | { kind: "failure"; wireReason: string; detail: string | null; retryable: boolean };

function AppBody() {
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
  const clientRef = useRef<RelayClient | null>(null);
  const taskRef = useRef<TaskSession | null>(null);
  const { loadingOlder, loadOlder, resetOlder } = useTaskHistory(taskRef);
  const storeUnsubscribeRef = useRef<(() => void) | null>(null);
  // P5b 宽视口（spec §19）：官方断点 (max-width: 767px) 取反——≥768px 交 WideShell
  // 全壳（侧栏+主区），<768px 维持既有单列壳（零回归）。
  const wideViewport = useWideViewport();
  const openHomeBridge = useCallback((workspacePath: string, workspaceIdentity?: string) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("relay client is not connected"));
    return openHomeSessionsIndexBridge(client, workspacePath, workspaceIdentity);
  }, []);
  const liveWorkspaces = useHomeSessionsIndex(workspaces, openHomeBridge);

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
          setTaskRows([...session.rows]);
          setTaskTotalCount(session.totalRowCount);
          setStatusSnapshot(session.getStatusSnapshot());
          setControlState(session.getControlState());
          setPendingInteractions(session.getPendingInteractions());
          setQueueState(session.getQueueState());
          setModelState(session.getModelSelectionState());
          // P6 composer 深面：官方 mode.label.glm.{mode} 的 mode 值（snapshot.config.mode）。
          setConfigMode(statusSnapshot?.config.mode ?? null);
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

  const backHome = useCallback(() => {
    storeUnsubscribeRef.current?.();
    storeUnsubscribeRef.current = null;
    taskRef.current?.close();
    taskRef.current = null;
    setControlState(null);
    setStatusSnapshot(null);
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
  const composer =
    taskTarget && selectedTaskId ? (
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
      />
    ) : null;

  const timeline =
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
        interactions={pendingInteractions}
        answering={answering}
        onResolve={(interactionId, answer) => void resolveInteraction(interactionId, answer)}
        fileChanges={fileChanges}
        canLoadOlder={taskRef.current?.canLoadOlder ?? false}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        bottomDock={composer}
      />
    ) : null;

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
  const taskShell =
    phase.kind === "task" ? (
      <MobileTaskShell
        onBack={backHome}
        timelineOwnsScroll
        timeline={timeline}
        workspaceHeader={
          taskTarget ? (
            <RemoteWorkspaceHeader title={taskTitle} workspacePath={taskTarget.path} />
          ) : null
        }
      />
    ) : null;

  // P5b 宽壳：≥768px 侧栏+主区（主区 = 已选任务宽容器 / 问候空态）；数据与回调全部
  // 复用既有 state/动作，本处只做接线。
  if (wideViewport) {
    return (
      <WideShell
        connection={connection}
        workspaces={liveWorkspaces}
        selectedTaskId={selectedTaskId}
        isRefreshing={false}
        taskSurface={taskShell}
        onTaskOpen={(task, workspace) => void openTask(workspace, task.sessionId, task.title)}
        onRefresh={() => void refresh()}
        onThemePress={toggleTheme}
        onLanguagePress={toggleLanguage}
        onReconnect={() => clientRef.current?.connect()}
      />
    );
  }

  if (phase.kind === "task") {
    return taskShell;
  }

  return (
    <HomeScreen
      connection={connection}
      workspaces={liveWorkspaces}
      selectedTaskId={selectedTaskId}
      isRefreshing={false}
      onTaskOpen={(task, workspace) => void openTask(workspace, task.sessionId, task.title)}
      onRefresh={() => void refresh()}
      onThemePress={toggleTheme}
      onLanguagePress={toggleLanguage}
      onReconnect={() => clientRef.current?.connect()}
    />
  );
}

export function App() {
  return (
    <IntlProvider>
      <AppBody />
    </IntlProvider>
  );
}
