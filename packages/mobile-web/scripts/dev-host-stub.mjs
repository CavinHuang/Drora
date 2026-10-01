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
const DIST = resolve(ROOT, "packages/mobile-web/dist");

const registry = createDeviceRegistry({
  storage: createFileDeviceRegistryStorage(resolve(ROOT, ".tmp-dev-relay.json")),
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
const BASE_TASKS = [
  { taskId: "stub-task-1", title: "E2E: mode menu + more menu", status: "running", workspacePath: WS_PATH, workspaceLabel: "demo", kind: "local", createdAt: NOW() - 3600000, updatedAt: NOW() - 60000 },
  { taskId: "stub-task-2", title: "completed history task", status: "completed", workspacePath: WS_PATH, workspaceLabel: "demo", kind: "local", createdAt: NOW() - 86400000, updatedAt: NOW() - 3600000 },
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
    const cand = conversationTopicWireCandidateSchema.parse({
      kind: "complete",
      deliveryKind: kind || "online",
      logicalFrameId: "lf-" + (++lf),
      logicalFrameOrdinal: 1,
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
      const params = arg || {};
      switch (cmd) {
        case "helloConversationV4":
          return { kind: "hello", protocolVersion: V4_WIRE_PROTOCOL_VERSION, connectionId: "stub-1", clientMode: "web-remote-replayable", deliveryProfile: "replayable", serverTime: NOW(), capabilities: {}, auth: {} };
        case "initializeConversationV4":
          return undefined;
        case "subscribeConversationV4": {
          const sid = ((params.params || {}).topic || "").replace("conversation/", "");
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
        case "conversationRowsRangeV4":
          return { rows: [], atSeq: (sessions.get(params.sessionId) || {}).seq || 0, atLogEpoch: "epoch-1" };
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
        case "subscribeSessionsIndexV4": {
          const topic = (params.params || {}).topic || "";
          const wid = topic.replace("sessions-index/", "");
          setImmediate(() => fireSessionsIndex(wid));
          return { ack: { subscriptionId: "sub-si", mode: "snapshot", logEpoch: "epoch-1" } };
        }
        case "unsubscribeSessionsIndexV4":
          return undefined;
        default:
          console.warn("[stub] unhandled:", cmd);
          throw new Error("unsupported " + cmd);
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
  const mk = () => {
    const s = { listener: null, peer: null };
    return {
      send(buf) { s.peer.listener(buf); },
      onMessage(l) { s.listener = l; return { dispose: () => { s.listener = null; } }; },
      fire(buf) { s.listener(buf); },
    };
  };
  const clientSide = mk();
  const serverSide = mk();
  clientSide.peer = serverSide;
  serverSide.peer = clientSide;
  const server = new ChannelServer(serverSide, "stub");
  server.registerChannel("drora-agent", makeAgentChannel());
  server.registerChannel("model-selection", {
    async call() { return null; },
    listen() { return () => ({ dispose: () => {} }); },
  });
  server.registerChannel("git", {
    async call(_ctx, cmd) {
      if (cmd === "refresh") {
        return {
          summary: { workspacePath: WS_PATH, repoRoot: WS_PATH, workspaceInRepoPath: "", autoRefreshWatchPaths: [], branchName: "main", trackingBranchName: "main", headRefType: "branch", ahead: 0, behind: 0, isDirty: true, isGitAvailable: true, isRepository: true },
          identity: null, unstagedChanges: [], stagedChanges: [], branchComparison: null,
        };
      }
      return null;
    },
    listen() { return () => ({ dispose: () => {} }); },
  });
  const bridge = { identity, assembler: new RpcFrameAssembler(identity), clientSide, physicalSeq: 0, messageSeq: 0 };
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
  switch (frame.zcode_type) {
    case "bootstrap-request":
      sendData({
        zcode_type: "bootstrap-response", requestId: frame.requestId, success: true,
        result: {
          windowControlSessionId: deviceSid, desktopAppVersion: "3.14.3",
          workspaces: WORKSPACES, tasks: tasksList(),
          mobileViewState: { activeWorkspaceKey: WS_PATH },
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
      const ready = { zcode_type: "workspace-bridge-ready", requestId: frame.requestId, ...id, workspacePath: WS_PATH, kind: "local" };
      if (typeof frame.taskId === "string") ready.initialTaskId = frame.taskId;
      sendData(ready);
      return;
    }
    case "rpc-frame": {
      const br = bridges.get(frame.bridgeSessionId);
      if (!br) return;
      const assembled = br.assembler.accept(frame);
      if (!assembled) return;
      sendData(buildRpcFrameAck({ identity: br.identity, ackMessageSeq: assembled.messageSeq }));
      br.clientSide.fire(VSBuffer.wrap(assembled.message));
      return;
    }
    case "rpc-frame-ack":
    case "mobile-view-state-update":
    case "telemetry-report":
    case "mobile-diagnostic":
    case "workspace-reconnect-request":
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
  }
};
ws.onerror = () => { console.error("[stub] ws error"); process.exit(1); };
