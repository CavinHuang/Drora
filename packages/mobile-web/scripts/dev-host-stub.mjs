// dev Host stub harness (spec 32.6). Real relay-server in-process + fake device.
// Run: node --import tsx packages/mobile-web/scripts/dev-host-stub.mjs [--port 4431]
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const portFlag = args.indexOf("--port");
const PORT = portFlag >= 0 ? Number(args[portFlag + 1]) : 4431;
const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");
const DIST = resolve(ROOT, "packages/mobile-web/dist");

const registry = createDeviceRegistry({
  storage: createFileDeviceRegistryStorage(
    resolve(ROOT, ".tmp-dev-relay-devices.json"),
  ),
});
const relay = createRelayServer({
  registry,
  port: PORT,
  host: "127.0.0.1",
  mobileRoot: DIST,
  log: { info: () => {}, warn: (...a) => console.warn("[relay]", ...a) },
});
const actualPort = await relay.listen();

const deviceMid = "dev-stub-" + randomUUID().slice(0, 8);
const passHash = createHash("sha256").update(deviceMid).digest("base64");
let deviceSid = "";

const NOW = () => Date.now();
const WS_PATH = "D:\\ws\\demo";
const WORKSPACES = [
  {
    workspacePath: WS_PATH,
    label: "demo",
    kind: "local",
    connectionState: "connected",
  },
];
const BASE_TASKS = [
  {
    taskId: "stub-task-1",
    title: "E2E: mode menu + more menu",
    status: "running",
    workspacePath: WS_PATH,
    workspaceLabel: "demo",
    kind: "local",
    createdAt: NOW() - 3600000,
    updatedAt: NOW() - 60000,
  },
  {
    taskId: "stub-task-2",
    title: "completed history task",
    status: "completed",
    workspacePath: WS_PATH,
    workspaceLabel: "demo",
    kind: "local",
    createdAt: NOW() - 86400000,
    updatedAt: NOW() - 3600000,
  },
];
const extraTasks = [];
const tasksList = () => [...BASE_TASKS, ...extraTasks];

function row(base) {
  return {
    createdAt: NOW() - 600000,
    createdAtSeq: 1,
    visibility: "visible",
    ...base,
  };
}

function baseRows(now) {
  return [
    row({ rowId: 1, turnId: "t1", kind: "turnHeader", entityId: "e-t1", state: "completedSuccess", origin: "userInput", startedAt: now - 600000, endedAt: now - 480000, activeMs: 120000 }),
    row({ rowId: 2, turnId: "t1", kind: "userInput", origin: "realUser", entityId: "e-u1", text: "demo: switch mode to full access, then rename via the more menu." }),
    row({ rowId: 3, turnId: "t1", kind: "reasoning", state: "complete", text: "acceptance: mode switch + rename chain.", durationMs: 4000 }),
    row({ rowId: 4, turnId: "t1", kind: "assistantText", entityId: "e-a1", assistantResponseId: "ar-1", state: "complete", text: "ok. current mode is **build**; use the mode trigger in the composer." }),
    row({ rowId: 5, turnId: "t1", kind: "toolCall", entityId: "e-a1", assistantResponseId: "ar-1", toolCallId: "tc-1", toolName: "terminal", status: "success", inputText: "node scripts/check-workspace-freshness.mjs", output: { text: "[freshness] ok: main synced with origin/main" }, startedAt: now - 470000, endedAt: now - 469000 }),
  ];
}

function buildRows(session) {
  const now = NOW();
  if (session.id === "stub-task-2") {
    return [
      row({ rowId: 1, turnId: "t1", kind: "turnHeader", entityId: "e-t1", state: "completedSuccess", origin: "userInput", startedAt: now - 3600000, endedAt: now - 3540000, activeMs: 60000 }),
      row({ rowId: 2, turnId: "t1", kind: "userInput", origin: "realUser", text: "history task with a completed turn." }),
      row({ rowId: 3, turnId: "t1", kind: "assistantText", entityId: "e-a1", state: "complete", text: "done. markdown check: **bold**, `code`, list 1. a 2. b" }),
    ];
  }
  const rows = baseRows(now);
  if (session.phase === "running") {
    rows.push(
      row({ rowId: 6, turnId: "t2", kind: "turnHeader", entityId: "e-t2", state: "running", origin: "userInput", startedAt: now - 130000 }),
      row({ rowId: 7, turnId: "t2", kind: "userInput", origin: "realUser", entityId: "e-u2", text: "continue: show queue placeholder and stop button." }),
      row({ rowId: 8, turnId: "t2", kind: "reasoning", state: "streaming", text: "generating comparison..." }),
      row({ rowId: 9, turnId: "t2", kind: "assistantText", entityId: "e-a2", assistantResponseId: "ar-2", state: "streaming", text: "streaming reply" }),
    );
  }
  return rows;
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
    meta: { title: session.title, titleSource: session.titleSource },
    modelTransition: null,
    workspaceHookAdmission: null,
    config: {
      provider: "stub-provider",
      model: "stub-model",
      thought: "high",
      thoughtLevels: ["low", "medium", "high"],
      followupMode: "queue",
      mode: session.mode,
    },
    usage: {
      contextWindow: {
        usedTokens: 123456,
        maxTokens: 1000000,
        autoCompactThresholdTokens: null,
      },
      cumulative: {
        inputTokens: 120000,
        outputTokens: 3456,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: session.id === 'stub-task-1'
      ? {
          items: [
            {
              sourceCommandId: 'cmd-q1',
              queueItemId: 'q1',
              clientId: 'drora-mobile-stub-task-1',
              kind: 'sendText',
              text: 'Queued follow-up number one',
              delivery: { requested: 'queue', admitted: 'queue' },
              order: { admissionSeq: 1 },
              steer: { state: 'notRequested' },
              dispatch: { state: 'queued' },
              admittedAt: NOW() - 60000,
            },
          ],
          autoDrain: true,
        }
      : { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: {
      items: [
        { id: "p1", content: "compare home screens", status: "completed" },
        { id: "p2", content: "accept mode menu", status: "inProgress" },
        { id: "p3", content: "accept more menu rename", status: "pending" },
      ],
      updatedAt: NOW(),
    },
    rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
  });
}

const sessions = new Map([
  ["stub-task-1", { id: "stub-task-1", title: "E2E: mode menu + more menu", phase: "running", mode: "build", seq: 12, revision: 5, titleSource: "generated" }],
  ["stub-task-2", { id: "stub-task-2", title: "completed history task", phase: "completedSuccess", mode: "build", seq: 4, revision: 2, titleSource: "generated" }],
]);

// manual IMessagePassingProtocol pair: side.send delivers to peer.listener.
function manualPair() {
  const mkSide = () => {
    const side = {
      listener: null,
      peer: null,
      send(buffer) {
        side.peer.listener(buffer);
      },
      onMessage(l) {
        side.listener = l;
        return { dispose: () => (side.listener = null) };
      },
      fire(buffer) {
        side.listener(buffer);
      },
    };
    return side;
  };
  const a = mkSide();
  const b = mkSide();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

const siListeners = new Set();

function fireSessionsIndex(workspaceId) {
  try {
  const snapshot = sessionsIndexSnapshotSchema.parse({
    protocolVersion: 1,
    workspaceId,
    logEpoch: "epoch-1",
    sessions: tasksList().map((task) => ({
      sessionId: task.taskId,
      workspaceId,
      title: task.title,
      phase: task.status === "running" ? "running" : "completedSuccess",
      sessionEnded: task.status !== "running",
      hasBackgroundWork: false,
      lastActivityAt: task.updatedAt,
      createdAt: task.createdAt,
      lastAssistantPreview: "stub preview text.",
    })),
  });
  const candidate = sessionsIndexTopicWireCandidateSchema.parse({
    kind: "complete",
    deliveryKind: "initial",
    logicalFrameId: "lf-si-1",
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
      payload: { kind: "snapshot", snapshot },
    },
  });
  for (const listener of siListeners) listener(candidate);
  } catch (error) {
    console.warn("[dbg] fireSessionsIndex failed:", String(error).slice(0, 300));
  }
}

function makeAgentChannel() {
  const frameListeners = new Set();
  const frameEvent = (listener) => {
    frameListeners.add(listener);
    return { dispose: () => frameListeners.delete(listener) };
  };
  let lfCounter = 0;

  function fireConversationFrame(session, payload, deliveryKind) {
    try {
    const candidate = conversationTopicWireCandidateSchema.parse({
      kind: "complete",
      deliveryKind,
      logicalFrameId: "lf-" + ++lfCounter,
      logicalFrameOrdinal: lfCounter,
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
    console.log("[dbg] fire conv", session.id, payload && payload.kind, "rows=", payload && payload.snapshot ? payload.snapshot.rows.window.length : "?", "seq=", session.seq, "ordinal=", lfCounter);
    for (const listener of frameListeners) listener(candidate);
    } catch (error) {
      console.warn("[dbg] fireConversationFrame failed:", String(error).slice(0, 300));
    }
  }

  function pushSnapshot(session, deliveryKind) {
    const kind = deliveryKind || "online";
    session.seq += 1;
    const payload = { kind: "snapshot", snapshot: snapshotFor(session) };
    console.log(
      "[dbg] push rows=",
      payload.snapshot.rows.window.length,
      "phase=",
      session.phase,
    );
    fireConversationFrame(session, payload, kind);
  }

  function handleCommand(session, envelope) {
  console.log(String("[dbg] cmd type=" + (envelope && envelope.type) + " sid=" + (envelope && envelope.sessionId) + " base=" + (envelope && envelope.baseRevision)).slice(0, 200));
    const ack = (status, extra) => ({
      commandId: envelope.commandId || "",
      status,
      revisionAtDecision: session.revision,
      ...(extra || {}),
    });
    switch (envelope.type) {
      case "sendText":
        session.phase = "running";
        setImmediate(() => pushSnapshot(session));
        return ack("accepted");
      case "stop":
        session.phase = "completedSuccess";
        setImmediate(() => pushSnapshot(session));
        return ack("accepted");
      case "switchCollaborationMode":
        console.log(String("[dbg] mode cmd base=" + envelope.baseRevision + " server=" + session.revision + " payload=" + JSON.stringify(envelope.payload)).slice(0, 200));
        if (envelope.baseRevision !== session.revision) return ack("stale");
        session.mode = (envelope.payload && envelope.payload.mode) || "build";
        session.revision += 1;
        setImmediate(() => pushSnapshot(session));
        return ack("accepted");
      case "renameSession":
        session.title = String((envelope.payload && envelope.payload.title) || session.title);
        session.titleSource = "custom";
        session.revision += 1;
        setImmediate(() => pushSnapshot(session));
        return ack("accepted");
      case "createSession": {
        const id = "stub-task-" + (sessions.size + 1);
        sessions.set(id, {
          id,
          title: "new stub task",
          phase: "draft",
          mode: session.mode,
          seq: 1,
          revision: 1,
          titleSource: "default",
        });
        extraTasks.push({
          taskId: id,
          title: "new stub task",
          status: "completed",
          workspacePath: WS_PATH,
          workspaceLabel: "demo",
          kind: "local",
          createdAt: NOW(),
          updatedAt: NOW(),
        });
        setImmediate(() => fireSessionsIndex(WS_PATH));
        return ack("accepted", { sessionId: id, title: "new stub task" });
      }
      default:
        return ack("accepted");
    }
  }

  const realCall = async (_ctx, command, arg) => {
    console.log("[dbg] call wrapped enter " + command);
    try {
      const result = await innerCall(_ctx, command, arg);
      console.log("[dbg] call wrapped resolved " + command);
      return result;
    } catch (error) {
      console.log("[dbg] call wrapped rejected " + command + " " + String(error && error.message).slice(0, 120));
      throw error;
    }
  };
  const innerCall = async (_ctx, command, rawArg) => {
      // RPC 传输层把参数包成数组下行（桌面由 exposeOnChannelServer 解包，桩内自解）。
      const arg = Array.isArray(rawArg) ? (rawArg[0] || {}) : (rawArg || {});
      const params = arg || {};
      console.log(String("[dbg] call " + command + " " + JSON.stringify(arg)).slice(0, 200));
      switch (command) {
        case "helloConversationV4":
          return {
            kind: "hello",
            protocolVersion: V4_WIRE_PROTOCOL_VERSION,
            connectionId: "stub-conn-1",
            clientMode: "web-remote-replayable",
            deliveryProfile: "replayable",
            serverTime: NOW(),
            capabilities: {},
            auth: {},
          };
        case "initializeConversationV4":
          return undefined;
        case "subscribeConversationV4": {
          const rawArg = arg && typeof arg === "object" ? arg : {};
          const flat = Array.isArray(rawArg) ? (rawArg[0] || {}) : rawArg;
          const sessionId = String(flat.sessionId || "");
          console.log(String("[dbg] conv subscribe sid=" + JSON.stringify(flat.sessionId)).slice(0, 200));
          const session = sessions.get(sessionId);
          if (!session) {
            throw new Error(
              "stub: unknown conversation dbg2=" +
              JSON.stringify({ isArray: Array.isArray(rawArg), sid: flat.sessionId, keysArg: Object.keys(rawArg) })
            );
          }
          setImmediate(() => pushSnapshot(session, "initial"));
          return {
            ack: {
              subscriptionId: "sub-" + session.id,
              mode: "snapshot",
              logEpoch: "epoch-1",
            },
          };
        }
        case "unsubscribeConversationV4":
          return undefined;
        case "resyncConversationV4": {
          const sessionId = String(params.subscriptionId || "").replace("sub-", "");
          const session = sessions.get(sessionId);
          if (session) setImmediate(() => pushSnapshot(session, "recovery"));
          return {
            ack: {
              subscriptionId: params.subscriptionId,
              mode: "snapshot",
              logEpoch: "epoch-1",
            },
          };
        }
        case "conversationRowsRangeV4":
          return {
            rows: [],
            atSeq: (sessions.get(params.sessionId) || {}).seq || 0,
            atLogEpoch: "epoch-1",
          };
        case "conversationFileChangesV4":
          return {
            files: 2,
            additions: 9,
            deletions: 3,
            items: [
              { path: "src/app/App.tsx", additions: 8, deletions: 2, writeCount: 2, toolNames: ["edit"], patches: [] },
              { path: "src/app/taskSession.ts", additions: 1, deletions: 1, writeCount: 1, toolNames: ["edit"], patches: [] },
            ],
          };
        case "sendConversationCommandV4": {
          console.log("[dbg] sendConv argEnvSid=", arg && arg.envelope ? String(arg.envelope.sessionId) : "no-arg-env", "type=", arg && arg.envelope ? String(arg.envelope.type) : "?");
          const envelope = (arg && arg.envelope) || {};
          const session = sessions.get(envelope.sessionId);
          if (!session) {
            return {
              commandId: envelope.commandId || "",
              status: "rejected",
              revisionAtDecision: 0,
              reasonCode: "not_found",
            };
          }
          return handleCommand(session, envelope);
        }
        case "subscribeSessionsIndexV4": {
          const topic = (params.params && params.params.topic) || "";
          const workspaceId = String(params.workspaceId || (topic ? topic.replace("sessions-index/", "") : "") || WS_PATH);
          console.log(String("[dbg] si subscribe: " + JSON.stringify(arg)).slice(0, 240));
          console.log("[dbg] si subscribe topic:", JSON.stringify(topic));
          setImmediate(() => fireSessionsIndex(workspaceId));
          return { ack: { subscriptionId: "sub-si", mode: "snapshot", logEpoch: "epoch-1" } };
        }
        case "unsubscribeSessionsIndexV4":
          return undefined;
        default:
          console.warn("[stub] unhandled agent call:", command);
          throw new Error("stub channel: unsupported method " + command);
      }
    };
    const agentListen = (_ctx, event) => {
      if (event === "onDynamicConversationFrame") return frameEvent;
      if (event === "onDynamicSessionsIndexFrame") {
        const eventFn = (listener) => {
          siListeners.add(listener);
          return { dispose: () => siListeners.delete(listener) };
        };
        return eventFn;
      }
      console.warn("[stub] unhandled agent listen:", event);
      return () => ({ dispose: () => {} });
    };
    return { call: realCall, listen: agentListen };
  };


// bridge lifecycle: workspace-bridge-open -> ChannelServer over manual pair.
const bridges = new Map();

function openBridge(identity) {
  const [clientSide, serverSide] = manualPair();
  const bridge = {
    identity,
    assembler: new RpcFrameAssembler(identity),
    clientSide,
    serverSide,
    physicalSeq: 0,
    messageSeq: 0,
  };
  // outbound encoder MUST be registered before ChannelServer construction:
  // the server sends Initialize in its constructor (deferInit=false), and a
  // late-registered listener would silently drop that handshake.
  clientSide.onMessage((vsbuffer) => {
    console.log("[dbg] rpc out", vsbuffer.buffer && vsbuffer.buffer.byteLength);
    bridge.messageSeq += 1;
    const encoded = encodeRpcTransportMessage({
      message: vsbuffer.buffer,
      identity,
      firstPhysicalSeq: bridge.physicalSeq + 1,
      messageSeq: bridge.messageSeq,
    });
    bridge.physicalSeq = encoded.nextPhysicalSeq - 1;
    for (const frame of encoded.frames) sendData(frame);
  });
  // deferInit=true：页面只在 workspace-bridge-ready 经 relay 往返回来后才装
  // bridge.onMessage；构造即发的 Initialize 会被静默丢掉，页面 ChannelClient
  // 从此永远等不到初始化（hello 永久排队）。延迟 300ms 再 ready；重复 Initialize
  // 对客户端幂等无害。
  const loggedServerSide = {
    send: (buffer) => {
      console.log("[dbg] server.send", buffer && buffer.buffer && buffer.buffer.byteLength);
      serverSide.send(buffer);
    },
    onMessage: serverSide.onMessage,
  };
  const server = new ChannelServer(loggedServerSide, "stub-ctx", 20000, true);
  setTimeout(() => server.ready(), 300);
  server.registerChannel("drora-agent", makeAgentChannel());
  // fake terminal channel (32.14): ITerminalService over the bridge.
  const termListeners = new Set();
  server.registerChannel("terminal", {
    async call(_ctx, command, arg) {
      if (command === "create") {
        setImmediate(() => {
          termListeners.forEach((fn) => fn("PowerShell 7.6.6\r\nPS D:\\ws\\demo> "));
        });
        return { id: "term-1", shell: "PowerShell", fontFamily: "monospace" };
      }
      if (command === "write") {
        const data = (arg && arg.data) || "";
        setImmediate(() => {
          termListeners.forEach((fn) => fn(data + "\r\n"));
        });
        return undefined;
      }
      return undefined;
    },
    listen(_ctx, event) {
      if (event === "onDynamicData") {
        return (listener) => {
          termListeners.add(listener);
          return { dispose: () => termListeners.delete(listener) };
        };
      }
      return () => ({ dispose: () => {} });
    },
  });

  // fake git channel (32.11): refresh returns a summary with branchName.
  server.registerChannel("git", {
    async call(_ctx, command) {
      if (command === "refresh") {
        return {
          summary: {
            workspacePath: WS_PATH,
            repoRoot: WS_PATH,
            workspaceInRepoPath: "",
            autoRefreshWatchPaths: [],
            branchName: "main",
            trackingBranchName: "main",
            headRefType: "branch",
            ahead: 0,
            behind: 0,
            isDirty: true,
            isGitAvailable: true,
            isRepository: true,
          },
          identity: null,
          unstagedChanges: [],
          stagedChanges: [],
          branchComparison: null,
        };
      }
      return null;
    },
    listen() {
      return () => ({ dispose: () => {} });
    },
  });

  server.registerChannel("model-selection", {
    async call() {
      return null;
    },
    listen() {
      return () => ({ dispose: () => {} });
    },
  });
  bridges.set(identity.bridgeSessionId, bridge);
  return bridge;
}

function send(obj) {
  ws.send(JSON.stringify(obj));
}

function sendData(payload) {
  send({ type: "data", payload, client_ts: Date.now() });
}

async function onAppFrame(frame) {
  if (!frame || typeof frame !== "object") return;
  console.log("[dbg] frame", frame.zcode_type, frame.bridgeSessionId || "");
  switch (frame.zcode_type) {
    case "bootstrap-request":
      sendData({
        zcode_type: "bootstrap-response",
        requestId: frame.requestId,
        success: true,
        result: {
          windowControlSessionId: deviceSid,
          desktopAppVersion: "3.14.3",
          workspaces: WORKSPACES,
          tasks: tasksList(),
          mobileViewState: { activeWorkspaceKey: WS_PATH },
        },
      });
      return;
    case "workspace-list-request":
      sendData({
        zcode_type: "workspace-list-response",
        requestId: frame.requestId,
        success: true,
        result: {
          workspaces: WORKSPACES,
          tasks: tasksList(),
          activeWorkspaceKey: WS_PATH,
        },
      });
      return;
    case "workspace-bridge-open": {
      const identity = {
        bridgeSessionId: String(frame.bridgeSessionId),
        ...(typeof frame.bridgeGeneration === "number"
          ? { bridgeGeneration: frame.bridgeGeneration }
          : {}),
      };
      openBridge(identity);
      sendData({
        zcode_type: "workspace-bridge-ready",
        requestId: frame.requestId,
        ...identity,
        workspacePath: WS_PATH,
        kind: "local",
        ...(typeof frame.taskId === "string" ? { initialTaskId: frame.taskId } : {}),
      });
      return;
    }
    case "rpc-frame": {
      const bridge = bridges.get(frame.bridgeSessionId);
      if (!bridge) return;
      const assembled = bridge.assembler.accept(frame);
      if (!assembled) return;
      sendData(
        buildRpcFrameAck({
          identity: bridge.identity,
          ackMessageSeq: assembled.messageSeq,
        }),
      );
      console.log("[dbg] rpc in", assembled.message.byteLength);
      bridge.serverSide.fire(VSBuffer.wrap(assembled.message));
      return;
    }
    case "rpc-frame-ack":
    case "mobile-view-state-update":
    case "telemetry-report":
    case "mobile-diagnostic":
    case "workspace-reconnect-request":
      return;
    default:
      console.warn("[stub] unhandled app frame:", frame.zcode_type);
  }
}

const ws = new WebSocket("ws://127.0.0.1:" + actualPort + "/ws");
let pendingNonce = "";

ws.onopen = () => {
  send({
    type: "device_register_init",
    device_mid: deviceMid,
    pass_hash: passHash,
  });
};

ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.type === "data") {
    console.log("[dbg] raw data zcode_type =", message.payload && message.payload.zcode_type);
  }
  switch (message.type) {
    case "device_register_ack":
      deviceSid = message.device_sid;
      send({ type: "auth_init", role: "device", device_sid: deviceSid });
      break;
    case "auth_challenge":
      pendingNonce = message.nonce;
      send({
        type: "auth_response",
        proof: computeProof({
          passHash,
          nonce: pendingNonce,
          role: "device",
          deviceSid,
        }),
      });
      break;
    case "auth_ack": {
      const url =
        "http://127.0.0.1:" +
        actualPort +
        "/remote/v4?sid=" +
        encodeURIComponent(deviceSid) +
        "&hash=" +
        encodeURIComponent(passHash) +
        "&t=" +
        Date.now() +
        "&mid=" +
        encodeURIComponent(deviceMid) +
        "&name=DEV-STUB&app_version=3.14.3";
      console.log("[stub] device attached. pair URL:");
      writeFileSync(new URL("../../.tmp-dev-pair-url.txt", import.meta.url), url);
      console.log(url);
      break;
    }
    case "data":
      if (isDataEnvelope(message)) void onAppFrame(message.payload);
      break;
    case "pair_status_ack":
      break;
    case "error":
      console.warn("[stub] relay error:", message.code, message.message);
      break;
    default:
      break;
  }
};

ws.onerror = (event) => {
  console.error("[stub] ws error:", String(event.message ?? event));
  process.exit(1);
};
