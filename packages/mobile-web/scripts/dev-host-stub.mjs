// Dev Host stub harness (spec §32.6-32.15). Real relay + fake device.
// Run: node --import tsx packages/mobile-web/scripts/dev-host-stub.mjs [--port 4431]
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import {
  computeProof,
  isDataEnvelope,
  encodeRpcTransportMessage,
  RpcFrameAssembler,
  buildRpcFrameAck,
} from "@drora/shared";
import {
  V4_WIRE_PROTOCOL_VERSION,
  conversationSnapshotSchema,
  conversationTopicWireCandidateSchema,
  sessionsIndexSnapshotSchema,
  sessionsIndexTopicWireCandidateSchema,
} from "@drora/shared/drora-protocol-v4";
import { ChannelServer, VSBuffer } from "@drora/rpc";
import {
  createRelayServer,
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
} from "../../relay-server/src/index.js";

const args = process.argv.slice(2);
const pf = args.indexOf("--port");
const PORT = pf >= 0 ? Number(args[pf + 1]) : 4431;
const ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
// --dist <dir>：静态根覆盖（§32.23 同数据双页对照——官方还原页 src/recovered 与源码页
// dist 各起一桩，同一假数据渲染，视觉差即纯实现差）。
const df = args.indexOf("--dist");
const DIST = df >= 0 ? resolve(args[df + 1]) : resolve(ROOT, "packages/mobile-web/dist");

const registry = createDeviceRegistry({
  // §32.39 双桩并行时共享注册表会互相覆盖（后启动者使先启动者的 sid→hash 失效，
  // 官方页 AUTH_FAILED 根因）——注册表按端口隔离。
  storage: createFileDeviceRegistryStorage(resolve(ROOT, `.tmp-dev-relay-${PORT}.json`)),
});
const relay = createRelayServer({
  registry, port: PORT, host: "127.0.0.1", mobileRoot: DIST,
});
const actualPort = await relay.listen();

const deviceMid = "dev-stub-" + randomUUID().slice(0, 8);
const passHash = createHash("sha256").update(deviceMid).digest("base64");
let deviceSid = "";

const NOW = () => Date.now();
const WS_PATH = "D:\\ws\\demo";
const WORKSPACES = [{ workspacePath: WS_PATH, label: "demo", kind: "local", connectionState: "connected" }];
// 字段族 = 真桌面 RelayTaskSummary（workspaceKind 非 kind；官方页 zod：unreadAt 是
// number.optional——**null 会被拒收整帧**（§32.24 帧门取证），无值时必须省略键）。
const BASE_TASKS = [
  // displayStatus：官方页 schema 的独立字段（pb：displayStatus enum，@src-dNkcRypW.js zod
  // 取证）——官方行状态读它而非 status，缺省回落「空闲」（§32.24 活体对照实证）。
  // unreadAt（§32.37 官方未读渲染面取证）：number 才会被官方投影并入。
  { taskId: "stub-task-1", title: "E2E: mode menu + more menu", status: "running", displayStatus: "running", workspacePath: WS_PATH, workspaceLabel: "demo", workspaceKind: "local", createdAt: NOW() - 3600000, updatedAt: NOW() - 60000, pinned: true, archived: false, unreadAt: NOW() - 30000 },
  { taskId: "stub-task-2", title: "completed history task", status: "completed", displayStatus: "completed", workspacePath: WS_PATH, workspaceLabel: "demo", workspaceKind: "local", createdAt: NOW() - 86400000, updatedAt: NOW() - 3600000, pinned: true, archived: false },
];
const extraTasks = [];
const tasksList = () => [...BASE_TASKS, ...extraTasks];

function row(base) { return { createdAt: NOW() - 600000, createdAtSeq: 1, visibility: "visible", ...base }; }

function buildRows(session) {
  const now = NOW();
  if (session.id === "stub-task-2") {
    return [
      row({ rowId: 1, turnId: "t1", kind: "turnHeader", entityId: "e-t1", state: "completedSuccess", origin: "userInput", startedAt: now - 3600000 }),
      row({ rowId: 2, turnId: "t1", kind: "userInput", origin: "realUser", text: "history task." }),
      row({ rowId: 3, turnId: "t1", kind: "assistantText", entityId: "e-a1", state: "complete", text: "done." }),
    ];
  }
  return [
    row({ rowId: 1, turnId: "t1", kind: "turnHeader", entityId: "e-t1", state: "completedSuccess", origin: "userInput", startedAt: now - 600000 }),
    row({ rowId: 2, turnId: "t1", kind: "userInput", origin: "realUser", entityId: "e-u1", text: "demo: switch mode + rename." }),
    row({ rowId: 3, turnId: "t1", kind: "reasoning", state: "complete", text: "acceptance run.", durationMs: 4000 }),
    row({ rowId: 4, turnId: "t1", kind: "assistantText", entityId: "e-a1", assistantResponseId: "ar-1", state: "complete", text: "ok. current mode is build." }),
    row({ rowId: 5, turnId: "t1", kind: "toolCall", entityId: "e-a1", assistantResponseId: "ar-1", toolCallId: "tc-1", toolName: "terminal", status: "success", inputText: "node -v", output: { text: "v22" }, startedAt: now - 470000 }),
    row({ rowId: 6, turnId: "t2", kind: "turnHeader", entityId: "e-t2", state: "running", origin: "userInput", startedAt: now - 130000 }),
    row({ rowId: 7, turnId: "t2", kind: "userInput", origin: "realUser", entityId: "e-u2", text: "continue." }),
    row({ rowId: 8, turnId: "t2", kind: "assistantText", entityId: "e-a2", assistantResponseId: "ar-2", state: "streaming", text: "streaming reply" }),
  ];
}

function snapshotFor(session) {
  const rows = buildRows(session);
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: session.id,
    logEpoch: "epoch-1",
    seq: session.seq,
    revision: session.revision,
    control: {
      phase: session.phase,
      sessionEnded: false,
      canStop: session.phase === "running",
      stopState: session.phase === "running" ? "stoppable" : "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: true },
    },
    inputRouting: { mode: "startNow" },
    meta: { title: session.title, titleSource: session.titleSource || "generated" },
    modelTransition: null,
    workspaceHookAdmission: null,
    config: {
      provider: "stub",
      model: "stub-model",
      thought: "high",
      thoughtLevels: ["low", "high"],
      followupMode: "queue",
      mode: session.mode,
    },
    usage: {
      contextWindow: { usedTokens: 123456, maxTokens: 1000000, autoCompactThresholdTokens: null },
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
  });
}

const sessions = new Map([
  ["stub-task-1", { id: "stub-task-1", title: "E2E: mode menu + more menu", phase: "running", mode: "build", seq: 12, revision: 5, titleSource: "generated" }],
  ["stub-task-2", { id: "stub-task-2", title: "completed history task", phase: "completedSuccess", mode: "build", seq: 4, revision: 2, titleSource: "generated" }],
]);

function manualPair() {
  const mk = () => {
    const s = { listener: null, peer: null };
    return {
      send(buf) { s.peer.listener(buf); },
      onMessage(l) { s.listener = l; return { dispose: () => { s.listener = null; } }; },
      fire(buf) { s.listener(buf); },
    };
  };
  const a = mk();
  const b = mk();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const siListeners = new Set();
// §32.32 视图状态回声链：吸收页面 mobile-view-state-update（activeTaskId）。
let lastMobileViewState = { activeWorkspaceKey: undefined, updatedAt: 0 };

function fireSessionsIndex(workspaceId) {
  const snap = sessionsIndexSnapshotSchema.parse({
    protocolVersion: 1,
    workspaceId,
    logEpoch: "epoch-1",
    sessions: tasksList().map((t) => ({
      sessionId: t.taskId,
      workspaceId,
      title: t.title,
      phase: t.status === "running" ? "running" : "completedSuccess",
      sessionEnded: t.status !== "running",
      hasBackgroundWork: false,
      lastActivityAt: t.updatedAt,
      createdAt: t.createdAt,
      lastAssistantPreview: "stub",
    })),
  });
  const cand = sessionsIndexTopicWireCandidateSchema.parse({
    kind: "complete",
    deliveryKind: "initial",
    logicalFrameId: "lf-si",
    logicalFrameOrdinal: 1,
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    topic: "sessions-index/" + workspaceId,
    subscriptionId: "sub-si",
    frame: {
      topic: "sessions-index/" + workspaceId,
      subscriptionId: "sub-si",
      fromSeq: 0,
      toSeq: 1,
      sentAt: NOW(),
      payload: { kind: "snapshot", snapshot: snap },
    },
  });
  siListeners.forEach((fn) => fn(cand));
}

function makeAgentChannel() {
  const frameListeners = new Set();
  const frameEvent = (fn) => { frameListeners.add(fn); return { dispose: () => frameListeners.delete(fn) }; };
  let lf = 0;
  function fireConv(session, payload, kind) {
    console.log("[stub] fireConv sid=" + session.id + " kind=" + payload.kind + " rows=" + (payload.snapshot ? payload.snapshot.rows.window.length : "-") + " seq=" + session.seq + " delivery=" + (kind || "online"));
    const cand = conversationTopicWireCandidateSchema.parse({
      kind: "complete",
      deliveryKind: kind || "online",
      logicalFrameId: "lf-" + (++lf),
      // 修复原因：spec §32.6 关键点 4——logicalFrameOrdinal 必须全局递增（精简版
      // 写死 1，store 装配器判定乱序静默丢弃，症状：rpc 全通但时间线恒空）。
      logicalFrameOrdinal: lf,
      wireVersion: V4_WIRE_PROTOCOL_VERSION,
      topic: "conversation/" + session.id,
      subscriptionId: "sub-" + session.id,
      frame: {
        topic: "conversation/" + session.id,
        subscriptionId: "sub-" + session.id,
        fromSeq: 0,
        toSeq: session.seq,
        sentAt: NOW(),
        payload,
      },
    });
    frameListeners.forEach((fn) => fn(cand));
  }
  function pushSnap(session, kind) {
    session.seq += 1;
    fireConv(session, { kind: "snapshot", snapshot: snapshotFor(session) }, kind || "online");
  }
  function handleCmd(session, env) {
    const ack = (st, ex) => ({ commandId: env.commandId || "", status: st, revisionAtDecision: session.revision, ...(ex || {}) });
    switch (env.type) {
      case "sendText":
        session.phase = "running";
        setImmediate(() => pushSnap(session));
        return ack("accepted");
      case "stop":
        session.phase = "completedSuccess";
        setImmediate(() => pushSnap(session));
        return ack("accepted");
      case "switchCollaborationMode":
        if (env.baseRevision !== session.revision) return ack("stale");
        session.mode = (env.payload || {}).mode || "build";
        session.revision += 1;
        setImmediate(() => pushSnap(session));
        return ack("accepted");
      case "renameSession":
        session.title = String((env.payload || {}).title || session.title);
        session.titleSource = "custom";
        session.revision += 1;
        setImmediate(() => pushSnap(session));
        return ack("accepted");
      case "createSession": {
        const id = "stub-task-" + (sessions.size + 1);
        sessions.set(id, { id, title: "new task", phase: "draft", mode: session.mode, seq: 1, revision: 1, titleSource: "default" });
        extraTasks.push({ taskId: id, title: "new task", status: "completed", workspacePath: WS_PATH, workspaceLabel: "demo", kind: "local", createdAt: NOW(), updatedAt: NOW() });
        setImmediate(() => fireSessionsIndex(WS_PATH));
        return ack("accepted", { sessionId: id, title: "new task" });
      }
      default:
        return ack("accepted");
    }
  }

  return {
    async call(_ctx, cmd, arg) {
      console.log("[stub] call:", cmd, JSON.stringify(arg ?? null).slice(0, 260));
      // 修复原因：rpc 线协议的方法参数是位置参数数组下行（spec §32.6 关键点 3；
      // 桌面由 exposeOnChannelServer 解包，桩内须自解——精简版丢了这层，所有
      // handler 读到的 params 恒 undefined → "unknown conv"/空 topic）。
      const params = Array.isArray(arg) ? (arg[0] || {}) : (arg || {});
      switch (cmd) {
        case "helloConversationV4":
          // capabilities 必填四键（§32.24 官方页任务面 zod 取证：nativeDialogs/localTerminal/
          // binaryFrames 布尔 + compression ∈ none|permessage-deflate，缺任一即整帧拒收
          // 并落错误面板）。
          return { kind: "hello", protocolVersion: V4_WIRE_PROTOCOL_VERSION, connectionId: "stub-1", clientMode: "web-remote-replayable", deliveryProfile: "replayable", serverTime: NOW(), capabilities: { nativeDialogs: false, localTerminal: false, binaryFrames: false, compression: "none" }, auth: {} };
        case "initializeConversationV4":
          return undefined;
        case "subscribeConversationV4": {
          // 页面参数形状 = {...workspace, sessionId, visibility}（顶层 sessionId，
          // 无 params.params.topic 嵌套——精简版误读嵌套层导致恒 unknown conv）。
          const sid = String(params.sessionId ?? "");
          const session = sessions.get(sid);
          if (!session) throw new Error("unknown conv " + sid);
          setImmediate(() => pushSnap(session, "initial"));
          return { ack: { subscriptionId: "sub-" + sid, mode: "snapshot", logEpoch: "epoch-1" } };
        }
        case "unsubscribeConversationV4":
          return undefined;
        case "resyncConversationV4": {
          const sid = String(params.subscriptionId || "").replace("sub-", "");
          const session = sessions.get(sid);
          if (session) setImmediate(() => pushSnap(session, "recovery"));
          return { ack: { subscriptionId: params.subscriptionId, mode: "snapshot", logEpoch: "epoch-1" } };
        }
        case "conversationRowsRangeV4": {
          // 修复原因：真 Host 的 range 响应带尾窗真实行；恒空 rows + atSeq==seq 会触发
          // 页面 store.replaceRows 的同水位整包替换，把已应用快照的行清空（§32.8
          // "时间线首进为空"挂账的真因——竞态：快照先到被清、range 先到则幸存）。
          const s = sessions.get(params.sessionId);
          return { rows: s ? buildRows(s) : [], atSeq: s ? s.seq : 0, atLogEpoch: "epoch-1" };
        }
        case "conversationFileChangesV4":
          return {
            files: 2, additions: 9, deletions: 3,
            items: [
              { path: "src/app.ts", additions: 8, deletions: 2, writeCount: 2, toolNames: ["edit"], patches: [] },
              { path: "src/task.ts", additions: 1, deletions: 1, writeCount: 1, toolNames: ["edit"], patches: [] },
            ],
          };
        case "sendConversationCommandV4": {
          const env = params.envelope || {};
          const session = sessions.get(env.sessionId);
          if (!session) return { commandId: env.commandId || "", status: "rejected", revisionAtDecision: 0, reasonCode: "not_found" };
          return handleCmd(session, env);
        }
        case "readSession": {
          // §32.31 官方任务绑定源（bundle UTe/WTe @701541/@701600 取证）：readSession
          // 响应 = {session:{sessionId,title,workspace:{workspacePath},createdAt,updatedAt,
          // mode}, settings:{thoughtLevel:{current}}, projection, messages}——title 取
          // session.title（官方任务视图标题/绑定经 QTe→UTe 由此而来，缺它回落新建任务）。
          const sid = String(params.sessionId ?? "");
          const t = tasksList().find((x) => x.taskId === sid);
          return {
            session: {
              sessionId: sid,
              title: t ? t.title : "",
              workspace: { workspacePath: WS_PATH },
              createdAt: t ? t.createdAt : NOW(),
              updatedAt: t ? t.updatedAt : NOW(),
              mode: "build",
            },
            settings: { thoughtLevel: { current: "high" } },
            projection: {},
            messages: [],
          };
        }
        case "subscribeSessionsIndexV4": {
          // 页面参数形状 = {workspacePath, workspaceIdentity?, visibility, ...}（顶层，
          // 无 params.params.topic 嵌套）；真 Host 按 workspacePath/identity 派生 topic。
          // 精简版读嵌套 topic 得空 wid → "sessions-index/" 裸前缀过不了 zod 校验。
          const wid = String(params.workspacePath ?? "").trim() || WS_PATH;
          setImmediate(() => fireSessionsIndex(wid));
          return { ack: { subscriptionId: "sub-si", mode: "snapshot", logEpoch: "epoch-1" } };
        }
        case "unsubscribeSessionsIndexV4":
          return undefined;
        default:
          // §32.29 官方页协议面宽于源码页（readSession/getTaskSessionFilePath/
          // conversationPlansV4 等）——抛错会在官方客户端打断装载链（标题回落/
          // 菜单项隐藏），改温和 null（官方按缺数据源隐藏，不臆造）。
          console.warn("[stub] unhandled:", cmd);
          return null;
      }
    },
    listen(_ctx, event) {
      if (event === "onDynamicConversationFrame") return frameEvent;
      if (event === "onDynamicSessionsIndexFrame") {
        return (fn) => { siListeners.add(fn); return { dispose: () => siListeners.delete(fn) }; };
      }
      return () => ({ dispose: () => {} });
    },
  };
}

const bridges = new Map();
function openBridge(identity) {
  // 修复原因：HEAD 3e203607 精简时把 manualPair 改成了闭包态 mk()——peer 接线
  // （clientSide.peer = serverSide）落在返回对象上，而 send() 读闭包里的 s.peer
  // （恒 null）→ null.listener 抛错 → 被 ChannelServer.send 的 try/catch 静默吞掉
  // → Initialize 永远发不出去（症状：bridge-open 正常、零 rpc-frame、时间线恒空，
  // 25a3e214 旧脚本实测同 dist 全链跑通锁定回归在脚本）。恢复"返回对象即状态"形态。
  const mkSide = () => {
    const side = {
      listener: null,
      peer: null,
      send(buffer) { side.peer.listener(buffer); },
      onMessage(l) { side.listener = l; return { dispose: () => { side.listener = null; } }; },
      fire(buffer) { side.listener(buffer); },
    };
    return side;
  };
  const clientSide = mkSide();
  const serverSide = mkSide();
  clientSide.peer = serverSide;
  serverSide.peer = clientSide;
  // 修复原因：HEAD 3e203607 精简脚本时丢了 spec §32.6 关键点 2——页面只在
  // workspace-bridge-ready 经 relay 往返后才装 bridge.onMessage，ChannelServer
  // 构造即发的 Initialize 会被静默丢（症状：bridge-open 重试、零 rpc-frame、
  // 时间线恒空）。deferInit=true 并延迟 300ms 再 ready，对客户端幂等无害。
  const server = new ChannelServer(serverSide, "stub", 20000, true);
  setTimeout(() => server.ready(), 300);
  // §32.24 双页对照：全通道调用日志（官方页协议面取证——哪些方法被调、桩答了什么）。
  const origRegister = server.registerChannel.bind(server);
  server.registerChannel = (name, impl) => {
    if (impl && typeof impl.call === "function") {
      const origCall = impl.call.bind(impl);
      impl.call = async (ctx, cmd, arg) => {
        const result = await origCall(ctx, cmd, arg);
        console.log(`[stub] ch:${name} call:`, cmd, "->", JSON.stringify(result ?? null).slice(0, 160));
        return result;
      };
    }
    return origRegister(name, impl);
  };
  server.registerChannel("drora-agent", makeAgentChannel());
  // §32.24 官方页 ServiceChannels（bundle src chunk @308654 字节取证）：ZCodeAgent=`zcode-agent`、
  // ZCodeTask=`zcode-task`、ZCodeSession=`zcode-session`——官方还原页按官方名开通道；
  // ChannelServer 对未知通道的请求是无限排队（不报错不超时），必须注册官方名别名。
  server.registerChannel("zcode-agent", makeAgentChannel());
  server.registerChannel("zcode-task", makeAgentChannel());
  server.registerChannel("zcode-session", makeAgentChannel());
  server.registerChannel("model-selection", {
    // §32.24 官方页契约：getView 必须返回 {revision, providers}（null → 页面读
    // r.revision 即崩 TypeError unhandled）。最小合法 view 即可（§32.6 桩语义）。
    async call() { return { revision: 1, providers: [] }; },
    listen() { return () => ({ dispose: () => {} }); },
  });
  // §32.27 官方页首启面抑制（bundle aLn @5828277 取证）：settingsSyncService.getChannel
  // 'settings-sync'——getFirstRunPromptState 未 handled 且 detect 抛错（桩 null → r.agents
  // 读取崩）即开「欢迎使用 ZCode」迁移弹窗。桩回 handled=true + detect 空 agents，
  // 官方还原页按非首启设备渲染，解锁菜单面交互对照。
  server.registerChannel("settings-sync", {
    async call(_ctx, cmd) {
      if (cmd === "getFirstRunPromptState") return { handled: true };
      if (cmd === "detect") return { agents: [] };
      if (cmd === "markFirstRunPromptHandled") return { ok: true };
      return null;
    },
    listen() { return () => ({ dispose: () => {} }); },
  });
  // §32.24 官方页启动期会拉 setting 通道（未注册 → Channel name 'setting' timed out 20s
  // → unhandled rejection）；get() 必须返回带 locale 的对象（IntlProvider 读 n.locale，
  // null → TypeError unhandled）。§32.26 升级为进程内有状态 KV：set 持久合并回 get
  // （官方首启向导的完成态走服务端 settings——桩场景下向导无法落定，见 spec 边界记录；
  // 有状态 set 为未来补齐 settings 形状后抑制首启面预留）。
  const settingStore = { locale: "zh-CN", localePreference: "system" };
  server.registerChannel("setting", {
    async call(_ctx, cmd, arg) {
      const patch = Array.isArray(arg) ? arg[0] : arg;
      if (cmd === "get") return { ...settingStore };
      if (cmd === "set" && patch && typeof patch === "object") {
        Object.assign(settingStore, patch);
        return { ...settingStore };
      }
      return null;
    },
    listen() { return () => ({ dispose: () => {} }); },
  });
  server.registerChannel("git", {
    async call(_ctx, cmd) {
      if (cmd === "refresh") {
        // 变更种子（spec §32.18 活体验收）：GitPaneChangeCard 走 ui 包 fileDisplay
        // 还原件渲染 material-icons 类型图标——多扩展名覆盖图标映射面。
        const change = (repoRelativePath, kind, section, added, removed) => ({
          // GitFileChange.path 必填（GitPane resolveChangePath 直接 isAbsoluteFilePath(change.path)）
          path: `${WS_PATH}/${repoRelativePath}`,
          repoRelativePath, workspaceRelativePath: repoRelativePath, kind, section,
          added, removed, isStaged: section === "staged", isUntracked: false, isConflicted: false,
        });
        return {
          summary: { workspacePath: WS_PATH, repoRoot: WS_PATH, workspaceInRepoPath: "", autoRefreshWatchPaths: [], branchName: "main", trackingBranchName: "main", headRefType: "branch", ahead: 0, behind: 0, isDirty: true, isGitAvailable: true, isRepository: true },
          identity: null,
          unstagedChanges: [
            change("src/app.ts", "modified", "unstaged", 8, 2),
            change("scripts/run.py", "added", "unstaged", 30, 0),
            change("package.json", "modified", "unstaged", 1, 1),
          ],
          stagedChanges: [change("docs/guide.md", "modified", "staged", 12, 4)],
          branchComparison: null,
        };
      }
      return null;
    },
    listen() { return () => ({ dispose: () => {} }); },
  });
  // 假 file 通道（spec §32.17 活体验收）：searchWorkspaceFiles 种子覆盖多种扩展名，
  // 供文件搜索结果行的 material-icons 类型图标实拍（与假 git 通道同模式）。
  server.registerChannel("file", {
    async call(_ctx, cmd, arg) {
      const params = Array.isArray(arg) ? (arg[0] || {}) : (arg || {});
      if (cmd === "searchWorkspaceFiles") {
        const root = String(params.rootPath ?? "") || WS_PATH;
        const query = String(params.query ?? "").toLowerCase();
        const seeds = [
          { name: "index.tsx", path: root + "/src/index.tsx", relativePath: "src/index.tsx", type: "file" },
          { name: "app.py", path: root + "/scripts/app.py", relativePath: "scripts/app.py", type: "file" },
          { name: "README.md", path: root + "/README.md", relativePath: "README.md", type: "file" },
          { name: "package.json", path: root + "/package.json", relativePath: "package.json", type: "file" },
          { name: "logo.png", path: root + "/assets/logo.png", relativePath: "assets/logo.png", type: "file" },
          { name: "notes", path: root + "/docs/notes", relativePath: "docs/notes", type: "directory" },
        ];
        const hits = seeds.filter((e) => e.relativePath.toLowerCase().includes(query));
        return hits.slice(0, Number(params.limit ?? 8));
      }
      return null;
    },
    listen() { return () => ({ dispose: () => {} }); },
  });
  const bridge = { identity, assembler: new RpcFrameAssembler(identity), clientSide, serverSide, physicalSeq: 0, messageSeq: 0 };
  clientSide.onMessage((buf) => {
    bridge.messageSeq += 1;
    const enc = encodeRpcTransportMessage({
      message: buf.buffer, identity,
      firstPhysicalSeq: bridge.physicalSeq + 1, messageSeq: bridge.messageSeq,
    });
    bridge.physicalSeq = enc.nextPhysicalSeq - 1;
    for (const f of enc.frames) sendData(f);
  });
  bridges.set(identity.bridgeSessionId, bridge);
}

function send(obj) { ws.send(JSON.stringify(obj)); }
function sendData(payload) { send({ type: "data", payload, client_ts: Date.now() }); }

function onAppFrame(frame) {
  if (!frame || typeof frame !== "object") return;
  console.log("[stub] app-frame:", frame.zcode_type, frame.zcode_type === "rpc-frame" ? ("bsid=" + frame.bridgeSessionId + " seq=" + frame.messageSeq) : "");
  if (frame.zcode_type === "mobile-diagnostic") {
    console.log("[stub] diagnostic:", JSON.stringify(frame));
  }
  switch (frame.zcode_type) {
    case "bootstrap-request":
      console.log("[stub] bootstrap-request full:", JSON.stringify(frame).slice(0, 400));
      sendData({
        zcode_type: "bootstrap-response", requestId: frame.requestId, success: true,
        result: {
          windowControlSessionId: deviceSid, desktopAppVersion: "3.14.3",
          workspaces: WORKSPACES, tasks: tasksList(),
          // 真桌面双键同指（buildBootstrapResult）；官方页 gb schema 里 updatedAt 是
          // 必填 finite number（§32.24 zod 取证）——缺它整帧拒收。
          initialViewState: { activeWorkspaceKey: WS_PATH, updatedAt: NOW() },
          mobileViewState: { activeWorkspaceKey: WS_PATH, updatedAt: NOW() },
        },
      });
      return;
    case "workspace-list-request":
      sendData({
        zcode_type: "workspace-list-response", requestId: frame.requestId, success: true,
        result: { workspaces: WORKSPACES, tasks: tasksList(), activeWorkspaceKey: WS_PATH },
      });
      return;
    case "workspace-bridge-open": {
      const id = { bridgeSessionId: String(frame.bridgeSessionId) };
      if (typeof frame.bridgeGeneration === "number") id.bridgeGeneration = frame.bridgeGeneration;
      openBridge(id);
      // 官方 schema（§32.24 zod 取证）：桥信息在嵌套 bridge 子对象（local 变体必填
      // workspaceKey），顶层另带 bridgeSessionId/bridgeGeneration——真桌面 toExternalBridge 同形。
      const workspaceKey = typeof frame.workspaceKey === "string" && frame.workspaceKey ? frame.workspaceKey : WS_PATH;
      sendData({
        zcode_type: "workspace-bridge-ready",
        requestId: frame.requestId,
        ...id,
        bridge: {
          ...id,
          kind: "local",
          workspaceKey,
          workspacePath: WS_PATH,
          ...(typeof frame.taskId === "string" ? { initialTaskId: frame.taskId } : {}),
        },
      });
      return;
    }
    case "rpc-frame": {
      const br = bridges.get(frame.bridgeSessionId);
      if (!br) return;
      const assembled = br.assembler.accept(frame);
      if (!assembled) return;
      sendData(buildRpcFrameAck({ identity: br.identity, ackMessageSeq: assembled.messageSeq }));
      // 修复原因：入站 rpc 字节必须 fire 给 serverSide（ChannelServer 在构造时
      // 订阅的 listener）；精简版误 fire 给 clientSide（出站编码器），会把页面发来
      // 的消息原样回显而不是交给服务端处理（spec §32.6 关键点 3）。
      br.serverSide.fire(VSBuffer.wrap(assembled.message));
      return;
    }
    case "rpc-frame-ack":
    case "mobile-view-state-update": {
      // §32.32 官方视图状态回声链（@6086352：页面开任务即上报 activeTaskId）：
      // 真桌面处理后经 workspace-list-updated 推回（官方分发器 @6084839 消费该帧，
      // result 含 mobileViewState.activeTaskId——任务头标题/绑定疑由此驱动）。
      // 桩回声：吸收上报 → 立即推 workspace-list-updated 携带最新 viewState。
      if (frame.viewState && typeof frame.viewState === "object") {
        lastMobileViewState = {
          activeWorkspaceKey: frame.viewState.activeWorkspaceKey ?? WS_PATH,
          ...(typeof frame.viewState.activeTaskId === "string" && frame.viewState.activeTaskId
            ? { activeTaskId: frame.viewState.activeTaskId }
            : {}),
          updatedAt: NOW(),
        };
        sendData({
          zcode_type: "workspace-list-updated",
          result: {
            workspaces: WORKSPACES,
            tasks: tasksList(),
            activeWorkspaceKey: lastMobileViewState.activeWorkspaceKey,
            ...(lastMobileViewState.activeTaskId ? { activeTaskId: lastMobileViewState.activeTaskId } : {}),
            mobileViewState: { ...lastMobileViewState },
            initialViewState: { ...lastMobileViewState },
          },
        });
      }
      return;
    }
    case "telemetry-report":
    case "mobile-diagnostic":
    case "workspace-reconnect-request":
      return;
    default:
      // §32.23 双页对照：官方还原页的协议面宽于源码页——未知帧全量落日志，
      // 静默丢弃会掩盖官方客户端正在等待的应答。
      console.log("[stub] UNKNOWN app-frame:", frame.zcode_type, JSON.stringify(frame).slice(0, 220));
      return;
  }
}

const ws = new WebSocket("ws://127.0.0.1:" + actualPort + "/ws");
let nonce = "";
ws.onopen = () => send({ type: "device_register_init", device_mid: deviceMid, pass_hash: passHash });
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  switch (msg.type) {
    case "device_register_ack":
      deviceSid = msg.device_sid;
      send({ type: "auth_init", role: "device", device_sid: deviceSid });
      break;
    case "auth_challenge":
      nonce = msg.nonce;
      send({ type: "auth_response", proof: computeProof({ passHash, nonce, role: "device", deviceSid }) });
      break;
    case "auth_ack": {
      const url = "http://127.0.0.1:" + actualPort + "/remote/v4?sid=" + encodeURIComponent(deviceSid) + "&hash=" + encodeURIComponent(passHash) + "&t=" + Date.now() + "&mid=" + encodeURIComponent(deviceMid) + "&name=DEV-STUB&app_version=3.14.3";
      console.log("[stub] pair URL:\n" + url);
      writeFileSync(resolve(ROOT, "packages/.tmp-dev-pair-url.txt"), url);
      break;
    }
    case "data":
      if (isDataEnvelope(msg)) onAppFrame(msg.payload);
      break;
    case "pair_status_ack":
      break;
    case "error":
      console.warn("[stub] error:", msg.code);
      break;
    default:
      // §32.23：relay 级未知帧也落日志（官方客户端可能有桩未应答的传输层帧）。
      console.log("[stub] UNKNOWN ws msg:", msg.type, JSON.stringify(msg).slice(0, 200));
      break;
  }
};
ws.onerror = () => {
  console.error("[stub] ws error");
  process.exit(1);
};
