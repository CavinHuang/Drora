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
import {
  IntlProvider,
  resolveLocale,
  storeLocale,
  useIntl,
  type MobileLocale,
} from "../ui/intl.js";
import { TaskTimeline } from "../ui/TaskTimeline.js";
import { InteractionCards, type InteractionAnswer } from "../ui/InteractionCards.js";
import { FileChangesBar } from "../ui/FileChangesBar.js";
import {
  createEntryClient,
  parseEntryQuery,
  projectHomeData,
  type ProjectedWorkspace,
} from "./entry.js";
import { TaskSession } from "./taskSession.js";
import { TaskComposer } from "./TaskComposer.js";
import { EMPTY_MODEL_SELECTION_STATE } from "./conversationStore.js";
import type {
  ConversationControlState,
  ConversationQueueState,
  ModelSelectionState,
} from "./conversationStore.js";
import type {
  ConversationRow,
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
  const [controlState, setControlState] = useState<ConversationControlState | null>(null);
  const [pendingInteractions, setPendingInteractions] = useState<readonly PendingInteraction[]>([]);
  const [queueState, setQueueState] = useState<ConversationQueueState | null>(null);
  const [fileChanges, setFileChanges] = useState<V4ConversationFileChangesResult | null>(null);
  const [answering, setAnswering] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelView, setModelView] = useState<ModelSelectionView | null>(null);
  const [modelState, setModelState] = useState<ModelSelectionState | null>(null);
  const clientRef = useRef<RelayClient | null>(null);
  const taskRef = useRef<TaskSession | null>(null);
  const storeUnsubscribeRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
          setControlState(session.getControlState());
          setPendingInteractions(session.getPendingInteractions());
          setQueueState(session.getQueueState());
          setModelState(session.getModelSelectionState());
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
    [fail],
  );

  const backHome = useCallback(() => {
    storeUnsubscribeRef.current?.();
    storeUnsubscribeRef.current = null;
    taskRef.current?.close();
    taskRef.current = null;
    setControlState(null);
    setPendingInteractions([]);
    setQueueState(null);
    setFileChanges(null);
    setModelMenuOpen(false);
    setModelState(null);
    setModelView(null);
    setPhase({ kind: "home" });
    void refresh();
  }, [refresh]);

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
  const timeline = (
    <div>
      <InteractionCards
        interactions={pendingInteractions}
        busy={answering}
        onResolve={(interactionId, answer) => void resolveInteraction(interactionId, answer)}
      />
      <FileChangesBar
        files={fileChanges?.files ?? null}
        additions={fileChanges?.additions ?? null}
        deletions={fileChanges?.deletions ?? null}
        className="px-3 pt-1"
      />
      <TaskTimeline rows={taskRows} now={Date.now()} />
    </div>
  );

  useEffect(() => {
    // stick-to-bottom（行变化即贴底；流式期间随帧重渲染跟随）。
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [taskRows]);

  if (phase.kind === "loading") {
    const stepToPhase = {
      connecting: { phase: "connecting", done: 0, active: 1 },
      authenticating: { phase: "authenticating", done: 1, active: 2 },
      waiting: { phase: "waiting", done: 2, active: 3 },
      paired: { phase: "paired", done: 3, active: 4 },
    } as const;
    const copy = stepToPhase[phase.step];
    return (
      <MobileConnectionStatusCard
        phase={copy.phase}
        doneCount={copy.done}
        activeCount={copy.active}
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

  if (phase.kind === "task") {
    return (
      <MobileTaskShell
        title={taskTitle}
        onBack={backHome}
        timelineScrollRef={scrollRef}
        timeline={timeline}
        composer={
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
        }
      />
    );
  }

  return (
    <HomeScreen
      connection={connection}
      workspaces={workspaces}
      selectedTaskId={selectedTaskId}
      isRefreshing={isRefreshing}
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
