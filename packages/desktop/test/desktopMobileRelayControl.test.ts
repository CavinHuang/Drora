import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildRemoteWorkspaceConnectResultTelemetry } from "@drora/shared";
import {
  MobileRelayCredentialStore,
  buildBootstrapResult,
  buildRelayQrUrl,
  buildWorkspaceListResult,
  OFFICIAL_REMOTE_PAGE_APP_VERSION,
  deriveSelfHostedRelayEndpoints,
  deriveRelayDisplayStatus,
  calculateRelayProof,
  createRelayPassword,
  derivePassHash,
  mapTransportState,
  type RpcTransportFrame,
} from "../src/main/desktopMobileRelayProtocol.js";
import { createDesktopMobileRelayControl } from "../src/main/desktopMobileRelayControl.js";

// M4a relay 客户端测试：
// - 纯逻辑：口令派生/proof/QR URL/状态映射/bootstrap 构造/凭据存取；
// - 协议状态机：fake WebSocket 走完 注册→挑战→waiting→matched→KICKED 全链路。

const tempDirs: string[] = [];

async function makeStore(encryption?: {
  encrypt: (plain: string) => string;
  decrypt: (stored: string) => string;
}) {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-"));
  tempDirs.push(dir);
  return new MobileRelayCredentialStore(dir, encryption);
}

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("口令派生与 proof 对齐官方算法（探测复核）", () => {
  const password = createRelayPassword();
  assert.match(password, /^[A-Za-z0-9_-]{32}$/u, "24 字节 base64url");
  const passHash = derivePassHash(password);
  assert.equal(passHash, createHash("sha256").update(password).digest("base64"));
  const proof = calculateRelayProof({
    passHash,
    nonce: "D9asCP8YPc7UBpt_DnU5jvyZ",
    role: "device",
    sessionId: "d_JXF3c55BW6BM9zBbYb21SR",
  });
  assert.equal(
    proof,
    createHmac("sha256", passHash)
      .update("D9asCP8YPc7UBpt_DnU5jvyZ|device|d_JXF3c55BW6BM9zBbYb21SR")
      .digest("base64url"),
  );
});

test("QR URL 参数族对齐官方 buildWebRemoteControlExternalQrUrl", () => {
  const url = buildRelayQrUrl({
    baseUrl: "https://zcode.z.ai/remote/v4",
    deviceSid: "d_abc",
    passHash: "hash==",
    timestamp: 1234,
    deviceMid: "mid-1",
    deviceName: "name-1",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://zcode.z.ai");
  assert.equal(parsed.pathname, "/remote/v4");
  assert.equal(parsed.searchParams.get("sid"), "d_abc");
  assert.equal(parsed.searchParams.get("hash"), "hash==");
  assert.equal(parsed.searchParams.get("t"), "1234");
  assert.equal(parsed.searchParams.get("mid"), "mid-1");
  assert.equal(parsed.searchParams.get("name"), "name-1");
  // app_version 固定上报还原协议版本：托管页按版本清单 404 未知版本（0.0.1 实测 404），
  // 省略参数虽走默认页但不确定，固定 3.14.3 与本仓还原的 relay 协议配套。
  assert.equal(parsed.searchParams.get("app_version"), "3.14.3");
  // 空字段不落参（对齐官方 trim 判断）；app_version 恒在。
  const minimal = new URL(buildRelayQrUrl({ deviceSid: "d_x", passHash: "h", deviceName: "  " }));
  assert.equal(minimal.searchParams.get("name"), null);
  assert.equal(minimal.searchParams.get("app_version"), "3.14.3");
});

test("传输态映射：waiting→running、paired→active、kicked→running（原版语义）", () => {
  assert.equal(mapTransportState("connecting"), "starting");
  assert.equal(mapTransportState("registering"), "starting");
  assert.equal(mapTransportState("authenticating"), "starting");
  assert.equal(mapTransportState("waiting_terminal"), "running");
  assert.equal(mapTransportState("paired"), "active");
  assert.equal(mapTransportState("kicked"), "running");
  assert.equal(mapTransportState("error"), "error");
  assert.equal(mapTransportState("idle"), "idle");
});

test("bootstrap / workspace-list 结果形状对齐原版构造函数", () => {
  const workspace = {
    workspacePath: "C:/demo",
    workspaceIdentity: "id-1",
    label: "demo",
    kind: "local" as const,
    connectionState: "connected" as const,
  };
  const tasks = [
    {
      taskId: "t1",
      title: "T",
      status: "running",
      updatedAt: 5,
      workspacePath: "C:/demo",
      workspaceLabel: "demo",
      workspaceKind: "local" as const,
      createdAt: 1,
    },
  ];
  const remoteWorkspace = {
    workspacePath: "ssh://host/remote/proj",
    workspaceIdentity: "ssh://host/remote/proj",
    label: "proj",
    kind: "remote" as const,
    connectionState: "reconnecting" as const,
  };
  const bootstrap = buildBootstrapResult({
    deviceSid: "d_1",
    appVersion: OFFICIAL_REMOTE_PAGE_APP_VERSION,
    workspaces: [remoteWorkspace],
    fallbackWorkspace: workspace,
    tasks,
    mobileViewState: { activeWorkspaceKey: "id-1", activeTaskId: "t1" },
  });
  assert.equal(bootstrap.windowControlSessionId, "d_1");
  assert.equal(bootstrap.desktopAppVersion, OFFICIAL_REMOTE_PAGE_APP_VERSION);
  // 多工作区聚合 + 运行时目标不缺席（对齐官方 getAvailableWorkspaces 语义）。
  assert.deepEqual(bootstrap.workspaces, [remoteWorkspace, workspace]);
  assert.deepEqual(bootstrap.tasks, tasks);
  assert.deepEqual(bootstrap.mobileViewState, {
    activeWorkspaceKey: "id-1",
    activeTaskId: "t1",
  });
  // 手机页 schema 必填字段（2026-09-27 真机取证）：workspace.label 与 task 的
  // workspacePath/workspaceLabel/workspaceKind/createdAt 缺一即整帧被静默丢弃。
  assert.equal(bootstrap.workspaces[0]?.label, "proj");
  assert.equal(bootstrap.workspaces[1]?.label, "demo");
  assert.equal(bootstrap.tasks[0]?.workspaceLabel, "demo");
  assert.equal(bootstrap.tasks[0]?.createdAt, 1);

  const list = buildWorkspaceListResult({
    workspaces: [remoteWorkspace],
    fallbackWorkspace: workspace,
    tasks,
    mobileViewState: { activeTaskId: "t1" },
  });
  assert.equal(list.activeWorkspaceKey, "id-1", "viewState 缺省回落工作区 key");
  assert.equal(list.activeTaskId, "t1");
  // 投影缺失时（controller 不可用）回落运行时目标单工作区。
  const fallbackOnly = buildWorkspaceListResult({
    workspaces: [],
    fallbackWorkspace: workspace,
    tasks: [],
  });
  assert.deepEqual(fallbackOnly.workspaces, [workspace]);
  assert.equal(fallbackOnly.activeWorkspaceKey, "id-1");
});

test("凭据存取：往返/清空/损坏文件容错/加密往返", async () => {
  const plain = await makeStore();
  assert.equal(await plain.load(), null);
  await plain.save({ deviceSid: "d_1", passHash: "h1" });
  assert.deepEqual(await plain.load(), { deviceSid: "d_1", passHash: "h1" });
  await plain.clear();
  assert.equal(await plain.load(), null);

  const encrypted = await makeStore({
    encrypt: (p) => `enc(${p})`,
    decrypt: (s) => s.slice(4, -1),
  });
  await encrypted.save({ deviceSid: "d_2", passHash: "secret" });
  assert.deepEqual(await encrypted.load(), { deviceSid: "d_2", passHash: "secret" });
});

// —— 协议状态机（fake WebSocket）——

interface FakeSocket {
  readyState: number;
  sent: Array<Record<string, unknown>>;
  handlers: Map<string, Array<(arg: unknown) => void>>;
}

function createFakeSocketHarness() {
  const sockets: FakeSocket[] = [];
  const emitStatus: string[] = [];
  const ctor = class {
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    handlers = new Map<string, Array<(arg: unknown) => void>>();
    constructor(public url: string) {
      sockets.push(this as unknown as FakeSocket);
    }
    on(event: string, listener: (arg: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    }
    send(data: string) {
      this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }
    close() {
      this.readyState = 3;
      this.handlers.get("close")?.forEach((fn) => fn(undefined));
    }
    // 测试驱动 API
    serverOpen() {
      this.readyState = 1;
      this.handlers.get("open")?.forEach((fn) => fn(undefined));
    }
    serverMessage(message: Record<string, unknown>) {
      this.handlers.get("message")?.forEach((fn) => fn(JSON.stringify(message)));
    }
  };
  return { ctor, sockets, emitStatus };
}

test("状态机全链路：注册→挑战→waiting→QR 就绪→matched→bootstrap 帧", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    onStatusChanged: (state) => harness.emitStatus.push(state.status),
    platformHandlers: {
      isDockerAvailable: async () => true,
      boom: async () => {
        throw new Error("kaput");
      },
    },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const startPromise = control.start({ workspacePath: "C:/demo" });
  // start 先 await 凭据读盘再建 socket；等一拍再驱动 fake 连接。
  await new Promise((r) => setTimeout(r, 10));
  const socket = harness.sockets[0]!;
  assert.ok(socket, "socket 必须已创建");
  socket.serverOpen();
  // 注册应答
  socket.serverMessage({
    type: "device_register_ack",
    device_sid: "d_test",
    server_ts: 1,
  });
  // 挑战
  socket.serverMessage({
    type: "auth_challenge",
    nonce: "nonce-1",
    server_ts: 1,
  });
  // 鉴权通过进入 waiting
  socket.serverMessage({
    type: "auth_ack",
    pair_status: "waiting",
    terminal_sid: "",
    server_ts: 1,
  });
  const started = await startPromise;
  assert.ok(started.url.startsWith("https://page.test/remote/v4?sid=d_test&"));
  assert.equal(started.sessionId, "d_test");
  assert.equal(control.runtimeState().status, "running");
  // registering/authenticating 传输态映射后同为 starting（对齐原版 mapTransportState）。
  assert.ok(
    harness.emitStatus.filter((s) => s === "starting").length >= 3,
    "connecting/registering/authenticating 三段都映射为 starting",
  );

  // waiting 态 WRONG_PARAM（对齐官方条件 paired||waiting_terminal）：只记日志，
  // 不断连、不进失败态（2026-09-27 真机取证官方 onError 接线仅 logger.warn）。
  socket.serverMessage({
    type: "error",
    code: "WRONG_PARAM",
    message: "transient rejection",
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(control.runtimeState().status, "running");
  assert.equal(control.runtimeState().failure, null);

  // 手机配对
  socket.serverMessage({
    type: "pair_status_ack",
    pair_status: "matched",
    terminal_sid: "m_1",
    server_ts: 2,
  });
  assert.equal(control.runtimeState().status, "active");
  assert.equal(control.runtimeState().connected, true);

  // paired 态 WRONG_PARAM（修复回归，2026-09-27 真机首配实锤）：手机接管/离开的
  // 过渡期 relay 会对 pair_status_query 周期性回 WRONG_PARAM。官方（3.14.3 bundle
  // handleError 取证）对该条件（paired||waiting_terminal）只 logger.warn——不断连、
  // 不停心跳、不刷新 ack；30s ack 看门狗到期自然重连自愈。此前按终态处理会把刚
  // 配对上的会话 10s 内误杀。
  socket.serverMessage({
    type: "error",
    code: "WRONG_PARAM",
    message: "pair_status_query rejected in paired state",
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(control.runtimeState().status, "active");
  assert.equal(control.runtimeState().connected, true);
  assert.equal(control.runtimeState().failure, null);

  // bootstrap 帧 → 返回带工作区的响应（任务拉取因 Host 缺失回空列表，不阻塞）
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "bootstrap-request", requestId: "r1" },
  });
  await new Promise((r) => setTimeout(r, 20));
  // 出站应用帧必须裹 {type:"data", payload} 信封——裸帧会被 relay 以 WRONG_PARAM
  // 拒收，手机页收不到响应（2026-09-27 真机取证）。
  const sentAppFrames = () =>
    socket.sent
      .filter((m) => m.type === "data" && m.payload && typeof m.payload === "object")
      .map((m) => m.payload as Record<string, unknown>);
  const bootstrapResponse = sentAppFrames().find((m) => m.zcode_type === "bootstrap-response");
  assert.ok(bootstrapResponse, "必须回应 bootstrap-response");
  assert.equal(bootstrapResponse.success, true);
  const result = bootstrapResponse.result as {
    workspaces: Array<{ workspacePath: string }>;
    windowControlSessionId: string;
  };
  assert.equal(result.windowControlSessionId, "d_test");
  assert.equal(result.workspaces[0]?.workspacePath, "C:/demo");

  // 多工作区聚合（官方 syncWebRemoteControlWorkspaces 同款）：renderer 推送后
  // bootstrap 汇总推送清单+运行时目标；paired 态下指纹变化触发
  // workspace-list-updated 广播（官方 pushWorkspaceListUpdated 语义）。
  control.syncAvailableWorkspaces([
    {
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: "ssh://host/remote/proj",
      remoteSessionId: "rs-1",
      label: "proj",
      kind: "remote",
      connectionState: "connected",
    },
  ]);
  const updatedFrame = sentAppFrames().find((m) => m.zcode_type === "workspace-list-updated");
  assert.ok(updatedFrame, "paired 态推送清单必须广播 workspace-list-updated");
  const updatedResult = updatedFrame.result as {
    workspaces: Array<{ workspacePath: string; kind: string }>;
  };
  assert.equal(updatedResult.workspaces.length, 2, "推送工作区+运行时目标");
  assert.equal(updatedResult.workspaces[0]?.workspacePath, "ssh://host/remote/proj");
  assert.equal(updatedResult.workspaces[0]?.kind, "remote");
  assert.equal(updatedResult.workspaces[1]?.workspacePath, "C:/demo");
  // 重复推送相同清单不重复广播（指纹去重）。
  const before = sentAppFrames().length;
  control.syncAvailableWorkspaces([
    {
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: "ssh://host/remote/proj",
      remoteSessionId: "rs-1",
      label: "proj",
      kind: "remote",
      connectionState: "connected",
    },
  ]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sentAppFrames().length, before, "指纹未变不得重复广播");

  // platform-request（对齐官方 q 处理器）：方法表内执行成功/失败分别回
  // platform-response 的 success true/false；未知方法回错误。
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "platform-request", requestId: "p1", method: "isDockerAvailable" },
  });
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "platform-request", requestId: "p2", method: "boom" },
  });
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "platform-request", requestId: "p3", method: "nope" },
  });
  await new Promise((r) => setTimeout(r, 20));
  const platformResponses = sentAppFrames().filter((m) => m.zcode_type === "platform-response");
  assert.equal(platformResponses.length, 3);
  const ok1 = platformResponses.find((m) => m.requestId === "p1");
  assert.equal(ok1?.success, true);
  assert.equal(ok1?.result, true);
  const failed = platformResponses.find((m) => m.requestId === "p2");
  assert.equal(failed?.success, false);
  assert.equal(failed?.error, "kaput");
  const unknown = platformResponses.find((m) => m.requestId === "p3");
  assert.equal(unknown?.success, false);

  // 桥请求（M4b）：plain node 无 electron MessageChannelMain，附着失败必须回
  // bridge-error 而不是挂起；workspaceKey 错误时按官方 FW 词汇表回
  // unexpected-error + 官方中文文案（index.js@395979 取证）。
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "r2",
      bridgeSessionId: "b1",
      workspaceKey: "C:/wrong",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const collectBridgeErrors = () =>
    socket.sent
      .filter((m) => m.type === "data" && m.payload && typeof m.payload === "object")
      .map((m) => m.payload as Record<string, unknown>)
      .filter((m) => m.zcode_type === "workspace-bridge-error");
  const notFound = collectBridgeErrors().find((m) => m.requestId === "r2");
  assert.ok(notFound, "未知工作区必须回应 bridge-error");
  // M4c reason 对齐官方 mapWorkspaceBridgeFailureReason（FW @385109）：无 code 的
  // 校验错误 → unexpected-error（手机页 i18n 只含官方 4 键）。
  assert.equal(notFound.reason, "unexpected-error");
  assert.match(String(notFound.error), /目标工作区不在当前桌面窗口中/u);
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "r3",
      bridgeSessionId: "b2",
      workspaceKey: "C:/demo",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const hostMissing = collectBridgeErrors().find((m) => m.requestId === "r3");
  assert.ok(hostMissing, "附着失败必须回应 bridge-error");
  // DESKTOP_HOST_MISSING → desktop-disconnected（官方 FW 映射，取证 index.js@385109）。
  assert.equal(hostMissing.reason, "desktop-disconnected");

  // KICKED：上报 session-conflict 失败面并重连
  socket.serverMessage({ type: "error", code: "KICKED", message: "taken over" });
  assert.equal(control.runtimeState().failure?.reason, "session-conflict");

  await control.stop();
  assert.equal(control.runtimeState().status, "idle");
});

test("persisted 凭据：直连 auth_init，不重复注册", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  await store.save({ deviceSid: "d_saved", passHash: "h_saved" });
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  const startPromise = control.start({ workspacePath: "C:/demo" });
  // start 先 await 凭据读盘再建 socket；等一拍再驱动 fake 连接。
  await new Promise((r) => setTimeout(r, 10));
  const socket = harness.sockets[0]!;
  assert.ok(socket, "socket 必须已创建");
  socket.serverOpen();
  // 首帧必须是 auth_init（persisted），而非 device_register_init
  const firstFrame = socket.sent[0];
  assert.equal(firstFrame?.type, "auth_init");
  assert.equal(firstFrame?.device_sid, "d_saved");
  socket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  socket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  const started = await startPromise;
  assert.ok(started.url.includes("sid=d_saved"));
  await control.stop();
});

// R2 page-request list 的驱动辅助：注册→配对到 matched，返回 control 与 socket。
async function startToPairedForPageRequests(options: {
  harness: ReturnType<typeof createFakeSocketHarness>;
  store: Awaited<ReturnType<typeof makeStore>>;
}) {
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: options.store,
    resolveHostChild: () => null,
    webSocketCtor: options.harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  const startPromise = control.start({ workspacePath: "C:/demo" });
  await new Promise((r) => setTimeout(r, 10));
  const socket = options.harness.sockets[0]!;
  socket.serverOpen();
  socket.serverMessage({ type: "device_register_ack", device_sid: "d_test", server_ts: 1 });
  socket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  socket.serverMessage({
    type: "auth_ack",
    pair_status: "waiting",
    terminal_sid: "",
    server_ts: 1,
  });
  await startPromise;
  socket.serverMessage({
    type: "pair_status_ack",
    pair_status: "matched",
    terminal_sid: "m_1",
    server_ts: 2,
  });
  return { control, socket };
}

function sentDroraPageResponses(socket: FakeSocket) {
  return socket.sent
    .filter((m) => m.type === "data" && m.payload && typeof m.payload === "object")
    .map((m) => m.payload as Record<string, unknown>)
    .filter((m) => m.zcode_type === "drora-page-response");
}

test("R2 list 响应：workspaces 聚合推送清单+运行时目标，空推送不清空（2026-09-29 回归锚）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const { control, socket } = await startToPairedForPageRequests({ harness, store });
  after(() => void control.stop());

  // renderer 推送跨工作区清单（含远程工作区）。
  control.syncAvailableWorkspaces([
    {
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: "ssh://host/remote/proj",
      remoteSessionId: "rs-1",
      label: "proj",
      kind: "remote",
      connectionState: "connected",
    },
  ]);
  control.syncAvailableTasks([
    {
      taskId: "t-1",
      title: "hello",
      updatedAt: 1,
      createdAt: 1,
      workspacePath: "C:/demo",
    },
  ]);

  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "drora-page-request", requestId: "l1", frame: { type: "list" } },
  });
  await new Promise((r) => setTimeout(r, 20));
  const listResponse = sentDroraPageResponses(socket).find((m) => m.requestId === "l1");
  assert.ok(listResponse, "list 必须有应答");
  assert.equal(listResponse.success, true);
  const listFrame = listResponse.frame as {
    type: string;
    tasks: Array<{ taskId: string }>;
    workspaces: Array<{ workspacePath: string; kind: string }>;
  };
  assert.equal(listFrame.type, "taskList");
  assert.deepEqual(
    listFrame.workspaces.map((w) => w.workspacePath),
    ["ssh://host/remote/proj", "C:/demo"],
    "list 响应 = 推送清单 + 运行时目标（merge 后）",
  );
  assert.equal(listFrame.tasks[0]?.taskId, "t-1", "list 响应带任务清单");

  // 空推送防护：renderer 重载窗口推送空快照，运行中不得清空清单
  // （实锤：workspaces:0 回归——空推送把 syncedWorkspaces 抹掉后手机页分组消失）。
  control.syncAvailableWorkspaces([]);
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "drora-page-request", requestId: "l2", frame: { type: "list" } },
  });
  await new Promise((r) => setTimeout(r, 20));
  const listResponse2 = sentDroraPageResponses(socket).find((m) => m.requestId === "l2");
  assert.ok(listResponse2, "第二次 list 必须有应答");
  const listFrame2 = listResponse2.frame as { workspaces: Array<{ workspacePath: string }> };
  assert.deepEqual(
    listFrame2.workspaces.map((w) => w.workspacePath),
    ["ssh://host/remote/proj", "C:/demo"],
    "空推送后清单保持（防护生效）",
  );

  // 非空推送仍为 replace 语义（官方同步语义不回退）。
  control.syncAvailableWorkspaces([
    {
      workspacePath: "D:/other",
      label: "other",
      kind: "local",
    },
  ]);
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "drora-page-request", requestId: "l3", frame: { type: "list" } },
  });
  await new Promise((r) => setTimeout(r, 20));
  const listResponse3 = sentDroraPageResponses(socket).find((m) => m.requestId === "l3");
  const listFrame3 = listResponse3?.frame as { workspaces: Array<{ workspacePath: string }> };
  assert.deepEqual(
    listFrame3.workspaces.map((w) => w.workspacePath),
    ["D:/other", "C:/demo"],
    "非空推送 replace + fallback merge",
  );

  await control.stop();
});

test("WebSocket 构造器不可用：start 快速失败（不拖 QR 就绪 30s 超时）", async () => {
  const store = await makeStore();
  const statusPushes: Array<{ status: string; failure: { message: string } | null }> = [];
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    onStatusChanged: (state) => statusPushes.push({ status: state.status, failure: state.failure }),
    // 显式 null = 生产 require("ws") 失败形态（connect() 快速失败分支）。
    webSocketCtor: null,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  const beganAt = Date.now();
  await assert.rejects(
    control.start({ workspacePath: "C:/demo" }),
    /WebSocket constructor unavailable/u,
    "start 必须以构造器缺失的真实原因失败",
  );
  // 快速失败契约：远小于 QR_READY_TIMEOUT_MS=30s。回归保护 start 内
  // 「QR 等待器先于 connect() 挂载」的顺序——若顺序回退，这里会拖满 30s 超时。
  const elapsed = Date.now() - beganAt;
  assert.ok(elapsed < 5_000, `start 应秒级失败，实际耗时 ${elapsed}ms`);
  // 失败面经状态推送可见（弹层错误态）；stop 后 runtimeFailure 复位，只能看推送。
  // transition("error") 沿先于 runtimeFailure 赋值，取携带 failure 的那条推送。
  const errorPush = statusPushes.find((push) => push.status === "error" && push.failure !== null);
  assert.equal(errorPush?.failure?.message, "WebSocket constructor unavailable");
  await control.stop();
}, 10_000);

test("重启自动恢复：上下文工作区在推送清单中才恢复，手动 stop 清除后不恢复", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  let persisted: { workspacePath: string; workspaceIdentity?: string } | null = null;
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    startupRestoreStorage: {
      load: async () => persisted,
      save: async (context) => {
        persisted = context;
      },
      clear: async () => {
        persisted = null;
      },
    },
    resolveHostChild: () => null,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  // start 成功 → 上下文已保存
  const startPromise = control.start({ workspacePath: "C:/demo" });
  await new Promise((r) => setTimeout(r, 10));
  const socket = harness.sockets[0]!;
  socket.serverOpen();
  socket.serverMessage({ type: "device_register_ack", device_sid: "d_r", server_ts: 1 });
  socket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  socket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  await startPromise;
  // transport 一并记录（specs/mobile-relay-server.md §12.4 恢复语义）；缺省 cloud。
  assert.deepEqual(persisted, { workspacePath: "C:/demo", transport: "cloud" });
  await control.stop();
  // 手动 stop → 上下文清除（官方 manual-stop 才 clear）
  assert.equal(persisted, null);

  // 上下文缺失 → 不恢复
  assert.equal(
    await control.restorePreviouslyEnabled([
      {
        workspacePath: "C:/demo",
        label: "demo",
        kind: "local",
        connectionState: "connected",
      },
    ]),
    false,
  );

  // 上下文存在且工作区在推送清单中 → 恢复成功，且本次运行至多一次
  persisted = { workspacePath: "C:/demo" };
  const restorePromise = control.restorePreviouslyEnabled([
    {
      workspacePath: "C:/other",
      label: "other",
      kind: "local",
      connectionState: "connected",
    },
    { workspacePath: "C:/demo", label: "demo", kind: "local", connectionState: "connected" },
  ]);
  // 恢复内部的 start 会建新 socket；驱动它走到 QR-ready。
  await new Promise((r) => setTimeout(r, 10));
  const socket2 = harness.sockets[1]!;
  socket2.serverOpen();
  socket2.serverMessage({ type: "device_register_ack", device_sid: "d_r2", server_ts: 1 });
  socket2.serverMessage({ type: "auth_challenge", nonce: "n2", server_ts: 1 });
  socket2.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  assert.equal(await restorePromise, true);
  assert.equal(control.isRunning(), true);
  assert.equal(
    await control.restorePreviouslyEnabled([
      { workspacePath: "C:/demo", label: "demo", kind: "local", connectionState: "connected" },
    ]),
    false,
    "已恢复过/运行中不得重复恢复",
  );

  // 工作区不在推送清单中 → 不恢复（官方"工作区不匹配不恢复"）
  const control2 = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    startupRestoreStorage: {
      load: async () => ({ workspacePath: "C:/gone" }),
      save: async () => {},
      clear: async () => {},
    },
    resolveHostChild: () => null,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control2.stop());
  assert.equal(
    await control2.restorePreviouslyEnabled([
      { workspacePath: "C:/demo", label: "demo", kind: "local", connectionState: "connected" },
    ]),
    false,
  );
});

test("reset 轮换凭据：清存后重走注册", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  await store.save({ deviceSid: "d_old", passHash: "h_old" });
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  const first = control.start({ workspacePath: "C:/demo" });
  await new Promise((r) => setTimeout(r, 10));
  let socket = harness.sockets[0]!;
  assert.ok(socket, "socket 必须已创建");
  socket.serverOpen();
  socket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  socket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  await first;

  const resetPromise = control.reset();
  await new Promise((r) => setTimeout(r, 10));
  socket = harness.sockets[1]!;
  assert.ok(socket, "重置后必须新建 socket");
  socket.serverOpen();
  // 重置后必须走 device_register_init（凭据已轮换）
  assert.equal(socket.sent[0]?.type, "device_register_init");
  socket.serverMessage({ type: "device_register_ack", device_sid: "d_new", server_ts: 1 });
  socket.serverMessage({ type: "auth_challenge", nonce: "n2", server_ts: 1 });
  socket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  const reset = await resetPromise;
  assert.ok(reset.url.includes("sid=d_new"));
  const savedCredential = await store.load();
  assert.ok(savedCredential, "重置后新凭据必须落盘");
  assert.equal(savedCredential.deviceSid, "d_new");
  assert.notEqual(savedCredential.passHash, "h_old", "passHash 必须随轮换更换");
  await control.stop();
});

// —— M4b：rpc-frame 编解码 ——

test("rpc-frame 编解码往返：crc32 校验、分片重组、字段形状", async () => {
  const {
    RpcFrameAssembler,
    crc32,
    encodeRpcTransportMessage,
    buildRpcFrameAck,
    parseRpcTransportFrame,
    toExternalBridge,
  } = await import("../src/main/desktopMobileRelayProtocol.js");
  const identity = { bridgeSessionId: "b-1", bridgeGeneration: 3, recoveryId: "r-9" };
  const message = new Uint8Array(1_500_000);
  for (let i = 0; i < message.length; i += 1) message[i] = i % 251;
  const encoded = encodeRpcTransportMessage({
    message,
    identity,
    firstPhysicalSeq: 1,
    messageSeq: 1,
  });
  // 1.5MiB / 640KiB → 3 片；物理序号推进 = 1+3
  assert.equal(encoded.frames.length, 3);
  assert.equal(encoded.nextPhysicalSeq, 4);
  assert.equal(encoded.checksum, crc32(message));
  const first = encoded.frames[0]!;
  assert.equal(first.zcode_type, "rpc-frame");
  assert.equal(first.bridgeSessionId, "b-1");
  assert.equal(first.bridgeGeneration, 3);
  assert.equal(first.recoveryId, "r-9");
  assert.equal(first.messageBytes, message.byteLength);
  assert.equal(first.checksum.algorithm, "crc32");
  // checksum.value 线格式必须是 8 位小写 hex 字符串——手机端组装器以
  // /^[0-9a-f]{8}$/ 校验，数字会被判 proto.frameAssemblyMetadataMismatch 丢弃
  // （2026-09-27 真机取证）。
  assert.match(first.checksum.value, /^[0-9a-f]{8}$/);
  assert.equal(parseInt(first.checksum.value, 16), crc32(message));

  // 重组往返
  const assembler = new RpcFrameAssembler(identity);
  let assembled: { message: Uint8Array; messageSeq: number } | null = null;
  for (const frame of encoded.frames) {
    const result = assembler.accept(frame);
    if (result) assembled = result;
  }
  assert.ok(assembled);
  assert.equal(assembled.messageSeq, 1);
  assert.equal(crc32(assembled.message), encoded.checksum);
  assert.deepEqual(Buffer.from(assembled.message), Buffer.from(message));

  // 解析器拒绝异构帧
  assert.equal(parseRpcTransportFrame({ zcode_type: "rpc-frame-ack" }), null);
  assert.equal(parseRpcTransportFrame({ zcode_type: "rpc-frame", bridgeSessionId: 1 }), null);

  // identity 不匹配的帧被丢弃
  const foreign = new RpcFrameAssembler({ bridgeSessionId: "other" });
  assert.equal(foreign.accept(encoded.frames[0]!), null);

  // ack 形状
  assert.deepEqual(buildRpcFrameAck({ identity, ackMessageSeq: 7 }), {
    zcode_type: "rpc-frame-ack",
    bridgeSessionId: "b-1",
    bridgeGeneration: 3,
    recoveryId: "r-9",
    ackMessageSeq: 7,
  });

  // toExternalBridge 形状（对齐官方）
  assert.deepEqual(
    toExternalBridge({
      identity: { bridgeSessionId: "b-2" },
      workspaceKey: "C:/demo",
      workspacePath: "C:/demo",
      kind: "local",
    }),
    { bridgeSessionId: "b-2", workspaceKey: "C:/demo", workspacePath: "C:/demo", kind: "local" },
  );
});

test("超限消息被拒：空消息与超 16MiB", async () => {
  const { encodeRpcTransportMessage, RPC_FRAME_MAX_MESSAGE_BYTES } =
    await import("../src/main/desktopMobileRelayProtocol.js");
  assert.throws(
    () =>
      encodeRpcTransportMessage({
        message: new Uint8Array(0),
        identity: { bridgeSessionId: "b" },
        firstPhysicalSeq: 1,
        messageSeq: 1,
      }),
    /emptyMessage/u,
  );
  assert.throws(
    () =>
      encodeRpcTransportMessage({
        message: new Uint8Array(RPC_FRAME_MAX_MESSAGE_BYTES + 1),
        identity: { bridgeSessionId: "b" },
        firstPhysicalSeq: 1,
        messageSeq: 1,
      }),
    /messageTooLarge/u,
  );
});

test("通道名别名推导：drora-* → zcode-*，其余不衍生", async () => {
  const { toOfficialRpcChannelAlias } = await import("@drora/shared");
  assert.equal(toOfficialRpcChannelAlias("drora-task"), "zcode-task");
  assert.equal(toOfficialRpcChannelAlias("drora-session"), "zcode-session");
  assert.equal(toOfficialRpcChannelAlias("window-controller"), null);
  assert.equal(toOfficialRpcChannelAlias("drora-"), "zcode-");
});

test("deriveSelfHostedRelayEndpoints：自建 relay 端点推导（spec §8）", () => {
  const http = deriveSelfHostedRelayEndpoints("http://relay.lan:4430");
  assert.equal(http?.relayWsUrl, "ws://relay.lan:4430/ws");
  assert.equal(http?.remotePageUrl, "http://relay.lan:4430/remote/v4");

  const https = deriveSelfHostedRelayEndpoints("https://relay.example.com/");
  assert.equal(https?.relayWsUrl, "wss://relay.example.com/ws");
  assert.equal(https?.remotePageUrl, "https://relay.example.com/remote/v4");

  assert.equal(deriveSelfHostedRelayEndpoints(""), undefined);
  assert.equal(deriveSelfHostedRelayEndpoints("not a url"), undefined);
});

// —— M4c：发送侧流控与重放（createRelayReplayBuffer 纯逻辑 + 桥接线）——
// 常量与语义取证自官方 chunk-C6VCYWB4.js（常量表 @6729、AcknowledgedRelayProtocol @8551）。

const makeRpcFrame = (messageSeq: number, seq: number): RpcTransportFrame => ({
  zcode_type: "rpc-frame",
  bridgeSessionId: "b-flow",
  seq,
  messageSeq,
  fragmentIndex: 0,
  fragmentCount: 1,
  messageBytes: 4,
  checksum: { algorithm: "crc32", value: "00000000" },
  dataBase64: "AAAA",
});

test("重放缓冲常量逐项对齐官方常量表（1MiB/256KiB/8MiB/45s）", async () => {
  const {
    RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
    RELAY_SATURATION_LOW_WATER_MARK_BYTES,
    RELAY_REPLAY_BUFFER_MAX_BYTES,
    RELAY_REPLAY_BUFFER_GRACE_MS,
  } = await import("../src/main/desktopMobileRelayProtocol.js");
  assert.equal(RELAY_SATURATION_HIGH_WATER_MARK_BYTES, 1024 * 1024);
  assert.equal(RELAY_SATURATION_LOW_WATER_MARK_BYTES, 256 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_GRACE_MS, 45_000);
});

test("重放缓冲：reserve/ack 释放未确认字节、饱和→排空水位沿（官方 processAck）", async () => {
  const { createRelayReplayBuffer } = await import("../src/main/desktopMobileRelayProtocol.js");
  let now = 1_000;
  const buffer = createRelayReplayBuffer({
    now: () => now,
    highWaterMarkBytes: 100,
    lowWaterMarkBytes: 40,
    maxBytes: 10_000,
  });
  assert.equal(buffer.unacknowledgedBytes, 0);
  assert.equal(buffer.saturated, false);

  // 低于高水位：不饱和
  assert.deepEqual(buffer.reserve(1, 60, [makeRpcFrame(1, 1)]), {
    overflow: false,
    saturated: false,
  });
  assert.equal(buffer.unacknowledgedBytes, 60);
  // 越过（>）高水位：饱和沿（官方 updateSaturationAfterReserve）
  assert.deepEqual(buffer.reserve(2, 50, [makeRpcFrame(2, 2)]), {
    overflow: false,
    saturated: true,
  });
  assert.equal(buffer.saturated, true);
  // ack(2) 累计释放两条 → 未确认归零 → 回落 ≤ 低水位：drained 沿
  assert.deepEqual(buffer.ack(2), { releasedBytes: 110, futureAck: false, drained: true });
  assert.equal(buffer.unacknowledgedBytes, 0);
  assert.equal(buffer.saturated, false);

  // 部分释放：ack 只释放 ≤ack 的前缀批次
  buffer.reserve(3, 30, [makeRpcFrame(3, 3)]);
  buffer.reserve(4, 20, [makeRpcFrame(4, 4)]);
  assert.equal(buffer.ack(3).releasedBytes, 30);
  assert.equal(buffer.unacknowledgedBytes, 20);
  assert.equal(buffer.highestSentMessageSeq, 4);
});

test("重放缓冲：future-ack 终态标记、落后/重复 ack 无操作", async () => {
  const { createRelayReplayBuffer } = await import("../src/main/desktopMobileRelayProtocol.js");
  const buffer = createRelayReplayBuffer();
  buffer.reserve(1, 10, [makeRpcFrame(1, 1)]);
  buffer.reserve(2, 10, [makeRpcFrame(2, 2)]);
  assert.deepEqual(buffer.ack(1), { releasedBytes: 10, futureAck: false, drained: false });
  // 落后/重复 ack：无操作（官方 `ack<=lastAcked → return`）
  assert.deepEqual(buffer.ack(1), { releasedBytes: 0, futureAck: false, drained: false });
  assert.equal(buffer.unacknowledgedBytes, 10);
  // future-ack（3 > 已发最高 2）：终态降级标记（官方 futureAck → enterDegraded）
  assert.deepEqual(buffer.ack(3), { releasedBytes: 0, futureAck: true, drained: false });
  // 从未发送任何消息时任何 ack 都是 future-ack（官方 highestFullySentMessageSeq=0）
  const empty = createRelayReplayBuffer();
  assert.equal(empty.ack(1).futureAck, true);
});

test("重放缓冲：replayFrames 返回全部未确认帧组，释放前缀后仅剩未确认", async () => {
  const { createRelayReplayBuffer } = await import("../src/main/desktopMobileRelayProtocol.js");
  const buffer = createRelayReplayBuffer();
  const f1 = [makeRpcFrame(1, 1), makeRpcFrame(1, 2)]; // 一条消息多个物理帧
  const f2 = [makeRpcFrame(2, 3)];
  const f3 = [makeRpcFrame(3, 4)];
  buffer.reserve(1, 10, f1);
  buffer.reserve(2, 10, f2);
  buffer.reserve(3, 10, f3);
  assert.deepEqual(buffer.replayFrames(), [...f1, ...f2, ...f3]);
  buffer.ack(2); // 释放前缀 1..2
  assert.deepEqual(buffer.replayFrames(), f3);
  buffer.ack(3);
  assert.deepEqual(buffer.replayFrames(), []);
  // clear（终态降级/桥销毁路径）后缓冲为空、水位归零
  buffer.reserve(4, 10, [makeRpcFrame(4, 5)]);
  buffer.clear();
  assert.deepEqual(buffer.replayFrames(), []);
  assert.equal(buffer.unacknowledgedBytes, 0);
});

test("重放缓冲：grace 超时按最旧未确认批次判定（官方 deadline 语义）", async () => {
  const { createRelayReplayBuffer } = await import("../src/main/desktopMobileRelayProtocol.js");
  let now = 10_000;
  const buffer = createRelayReplayBuffer({ now: () => now, graceMs: 1_000 });
  assert.equal(buffer.graceExceeded(), false, "无未确认批次不超时");
  buffer.reserve(1, 10, [makeRpcFrame(1, 1)]);
  now = 11_000;
  assert.equal(buffer.graceExceeded(), false, "恰好 graceMs 不算超时");
  now = 11_001;
  assert.equal(buffer.graceExceeded(), true);
  buffer.ack(1);
  assert.equal(buffer.graceExceeded(), false, "释放后回到无批次");
  // 旧批次未确认、新批次后到：按最旧入队时刻判定
  now = 20_000;
  buffer.reserve(2, 10, [makeRpcFrame(2, 2)]);
  now = 20_500;
  buffer.reserve(3, 10, [makeRpcFrame(3, 3)]);
  now = 21_001;
  assert.equal(buffer.graceExceeded(), true);
});

test("重放缓冲：超上限拒收并标记 overflow（官方 replayBufferExceeded）", async () => {
  const { createRelayReplayBuffer } = await import("../src/main/desktopMobileRelayProtocol.js");
  const buffer = createRelayReplayBuffer({ maxBytes: 100 });
  buffer.reserve(1, 60, [makeRpcFrame(1, 1)]);
  const result = buffer.reserve(2, 50, [makeRpcFrame(2, 2)]);
  assert.equal(result.overflow, true);
  assert.equal(buffer.unacknowledgedBytes, 60, "超限批次不入队、不累计");
  assert.deepEqual(buffer.replayFrames(), [makeRpcFrame(1, 1)]);
  assert.equal(
    buffer.reserve(3, 40, [makeRpcFrame(3, 3)]).overflow,
    false,
    "恰好等于上限允许（官方 `>maxBytes` 判定）",
  );
});

// —— M4c 桥接线（注入 fake 桥端口：plain node 无 electron MessageChannelMain）——

interface FakeBridgePort {
  received: Buffer[];
  closed: boolean;
  /** 测试驱动：Host 侧向控制发二进制（走 forwardHostBytesToPhone → rpc-frame 出站）。 */
  hostEmits(bytes: Uint8Array): void;
}

function createFakeBridgePort(): FakeBridgePort {
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const port = {
    received: [] as Buffer[],
    closed: false,
    on(_event: "message", listener: (event: { data: unknown }) => void) {
      listeners.push(listener);
    },
    start() {},
    close() {
      port.closed = true;
    },
    postMessage(data: unknown) {
      port.received.push(data as Buffer);
    },
    hostEmits(bytes: Uint8Array) {
      for (const listener of listeners) listener({ data: bytes });
    },
  };
  return port;
}

/** 收集经 data 信封出站的应用帧（按 zcode_type 过滤由用例自行完成）。 */
function collectAppFrames(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent
    .filter((m) => m.type === "data" && m.payload && typeof m.payload === "object")
    .map((m) => m.payload as Record<string, unknown>);
}

/** 驱动 fake socket：注册→挑战→waiting→start 返回→matched（桥用例公共前缀）。
 * 返回已创建的 socket（start 建连发生在内部等待之后，调用方必须使用返回值）。 */
async function driveRelayToMatched(
  control: ReturnType<typeof createDesktopMobileRelayControl>,
  harness: ReturnType<typeof createFakeSocketHarness>,
  deviceSid: string,
): Promise<FakeSocket> {
  const startPromise = control.start({ workspacePath: "C:/demo" });
  // start 先 await 凭据读盘再建 socket；等一拍再取 fake 连接。
  await new Promise((r) => setTimeout(r, 10));
  const socket = harness.sockets[0];
  assert.ok(socket, "socket 必须已创建");
  socket.serverOpen();
  socket.serverMessage({ type: "device_register_ack", device_sid: deviceSid, server_ts: 1 });
  socket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  socket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  await startPromise;
  socket.serverMessage({
    type: "pair_status_ack",
    pair_status: "matched",
    terminal_sid: "m_1",
    server_ts: 2,
  });
  return socket;
}

function openBridge(socket: FakeSocket): void {
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rb",
      bridgeSessionId: "b-flow",
      workspaceKey: "C:/demo",
    },
  });
}

test("桥流控：ack 释放后 grace 不降级、发送继续；future-ack → 终态降级拒绝发送", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const warns: string[] = [];
  const control = createDesktopMobileRelayControl({
    logger: {
      info: () => {},
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 40 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_fc");
  assert.equal(control.runtimeState().status, "active");

  // 开桥：plain node 下 warmup 的 electron 依赖缺失走 catch 继续，附着用注入端口
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(
    collectAppFrames(socket).some((m) => m.zcode_type === "workspace-bridge-ready"),
    "注入端口后桥必须成功打开",
  );

  // Host → 手机一条消息：发送后 reserve，出站 rpc-frame 带递增 messageSeq
  const rpcFrames = () => collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame");
  bridgePort.hostEmits(new Uint8Array([1, 2, 3]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 1);
  assert.equal(rpcFrames()[0]?.messageSeq, 1);

  // 手机 ack(1)：未确认字节释放、grace 看门狗解除 → 超过 grace 也不降级
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "rpc-frame-ack", ackMessageSeq: 1 },
  });
  await new Promise((r) => setTimeout(r, 90)); // > graceMs 40
  assert.equal(
    warns.some((w) => w.includes("终态降级")),
    false,
    "ack 释放后 grace 看门狗必须解除",
  );

  // 释放后发送继续、messageSeq 推进
  bridgePort.hostEmits(new Uint8Array([4]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 2);
  assert.equal(rpcFrames()[1]?.messageSeq, 2);

  // future-ack（9 > 已发最高 2）→ 终态降级；后续 sendFrame 拒绝
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "rpc-frame-ack", ackMessageSeq: 9 },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    warns.some((w) => w.includes("终态降级")),
    true,
    "future-ack 必须终态降级",
  );
  bridgePort.hostEmits(new Uint8Array([5]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 2, "降级后出站 rpc-frame 必须被拒绝");

  await control.stop();
});

test("桥流控：grace 超时未确认 → 终态降级；降级后出站拒绝、入站帧丢弃", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const warns: string[] = [];
  const control = createDesktopMobileRelayControl({
    logger: {
      info: () => {},
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 40 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_grace");
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));

  // 健康路径基线：手机 rpc-frame → 回 rpc-frame-ack 并向 Host 端口投递
  const { encodeRpcTransportMessage } = await import("../src/main/desktopMobileRelayProtocol.js");
  const inbound = encodeRpcTransportMessage({
    message: new Uint8Array([9, 9]),
    identity: { bridgeSessionId: "b-flow" },
    firstPhysicalSeq: 1,
    messageSeq: 7,
  });
  socket.serverMessage({ type: "data", payload: inbound.frames[0] });
  await new Promise((r) => setTimeout(r, 10));
  const acked = collectAppFrames(socket).find((m) => m.zcode_type === "rpc-frame-ack");
  assert.equal(acked?.ackMessageSeq, 7);
  assert.equal(bridgePort.received.length, 1);

  // Host → 手机一条消息（reserve 后无任何 ack）→ grace(40ms) 超时 → 终态降级
  const rpcFrames = () => collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame");
  bridgePort.hostEmits(new Uint8Array([1]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 1);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    warns.some((w) => w.includes("终态降级")),
    true,
    "grace 超时必须终态降级",
  );
  const degradeCount = warns.filter((w) => w.includes("终态降级")).length;

  // 降级后：出站拒绝；入站 rpc-frame 丢弃（不回 ack、不投递端口）；降级只发生一次
  bridgePort.hostEmits(new Uint8Array([2]));
  const lateInbound = encodeRpcTransportMessage({
    message: new Uint8Array([8]),
    identity: { bridgeSessionId: "b-flow" },
    firstPhysicalSeq: 2,
    messageSeq: 8,
  });
  socket.serverMessage({ type: "data", payload: lateInbound.frames[0] });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 1, "降级后出站 rpc-frame 必须被拒绝");
  assert.equal(
    collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame-ack").length,
    1,
    "降级后不再回 ack",
  );
  assert.equal(bridgePort.received.length, 1, "降级后不再向 Host 端口投递");
  assert.equal(warns.filter((w) => w.includes("终态降级")).length, degradeCount, "降级只发生一次");

  await control.stop();
});

test("桥流控：桥销毁（stop/dispose）清 grace 看门狗与重放缓冲", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const warns: string[] = [];
  const control = createDesktopMobileRelayControl({
    logger: {
      info: () => {},
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 40 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_dispose");
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  const rpcFrames = () => collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame");
  bridgePort.hostEmits(new Uint8Array([1])); // reserve，看门狗挂上
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 1);

  // 桥销毁（stop → disposeBridge）：看门狗与缓冲同清，超 grace 后不得再触发降级
  await control.stop();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    warns.some((w) => w.includes("终态降级")),
    false,
    "桥销毁后看门狗不得再触发",
  );
  assert.equal(bridgePort.closed, true, "桥销毁必须关闭附着端口");
});

/** 桥端口收到的 connection-flow-v1 sideband（flow-state 走附着端口，不进 relay 数据面）。 */
function collectFlowStates(port: FakeBridgePort): Array<Record<string, unknown>> {
  return port.received.flatMap((item) =>
    item instanceof Buffer
      ? []
      : typeof item === "object" && item !== null && "__droraRpcControl" in item
        ? [item as Record<string, unknown>]
        : [],
  );
}

/** 官方 connection-flow-v1 线格式（恰好 2 键；本仓判别键 __droraRpcControl）。 */
function flowControl(state: string): Record<string, unknown> {
  return { __droraRpcControl: "connection-flow-v1", state };
}

test("宿主背压：越过水位沿发 flow-state saturated，ack 回落沿发 drained（connection-flow-v1 sideband）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    // 缩小水位（生产缺省 = 官方 1MiB/256KiB）：注入面仅测试用。
    replayBufferOptions: { graceMs: 5_000, highWaterMarkBytes: 200, lowWaterMarkBytes: 100 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_flow");
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  const rpcFrames = () => collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame");

  // 单条消息信封 >200B：reserve 后越过高水位 → saturated 沿发 Host 附着端口
  bridgePort.hostEmits(new Uint8Array(64));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 1);
  assert.deepEqual(collectFlowStates(bridgePort), [flowControl("saturated")]);

  // 已饱和态再发：无新沿、不重复发 flow-state
  bridgePort.hostEmits(new Uint8Array(64));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rpcFrames().length, 2);
  assert.equal(collectFlowStates(bridgePort).length, 1, "饱和态沿不重复触发");

  // ack(1) 释放批次 1：未确认仍 ≈ 一条消息量 > 低水位 → 不发 drained
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "rpc-frame-ack", ackMessageSeq: 1 },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(collectFlowStates(bridgePort).length, 1);

  // ack(2) 全部释放：回落 ≤ 低水位 → drained 沿（Host 恢复出站）
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "rpc-frame-ack", ackMessageSeq: 2 },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(collectFlowStates(bridgePort), [
    flowControl("saturated"),
    flowControl("drained"),
  ]);

  // sideband 只进附着端口，不得混入 relay 数据面（data 信封里没有 flow 对象）
  assert.equal(
    collectAppFrames(socket).some((m) => "__droraRpcControl" in m),
    false,
    "flow-state 不得作为应用帧进 relay",
  );
  await control.stop();
});

test("onSendReady 重放：设备重连后 matched 触发未确认帧全量重发，messageSeq/编码保持", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 60_000 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_replay");
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  // 首次配对（gen=1）不触发重放：bridge-ready 后无 rpc-frame
  assert.equal(collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame").length, 0);

  // 未确认消息（手机不 ack）→ 断线重连
  bridgePort.hostEmits(new Uint8Array([1, 2, 3]));
  await new Promise((r) => setTimeout(r, 10));
  const original = collectAppFrames(socket).find((m) => m.zcode_type === "rpc-frame");
  assert.ok(original, "重连前必须有未确认出站帧");
  socket.close();

  // 重连（RECONNECT_DELAY_MS=1s）：persisted 直连 auth_init → waiting（stale 路径）
  // → matched（跨代 = reconnected-socket）→ onSendReady 重放
  await new Promise((r) => setTimeout(r, 1_150));
  const socket2 = harness.sockets[1];
  assert.ok(socket2, "重连后必须有新 socket");
  socket2.serverOpen();
  socket2.serverMessage({ type: "auth_challenge", nonce: "n2", server_ts: 1 });
  socket2.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  socket2.serverMessage({ type: "pair_status_ack", pair_status: "matched", server_ts: 2 });
  await new Promise((r) => setTimeout(r, 10));

  const replayed = collectAppFrames(socket2).filter((m) => m.zcode_type === "rpc-frame");
  assert.equal(replayed.length, 1, "onSendReady 必须重发未确认帧");
  assert.equal(replayed[0]?.messageSeq, original.messageSeq, "messageSeq 保持不变");
  assert.equal(replayed[0]?.seq, original.seq, "物理 seq 保持不变");
  assert.equal(replayed[0]?.dataBase64, original.dataBase64, "载荷编码保持不变");
  assert.deepEqual(replayed[0]?.checksum, original.checksum, "checksum 保持不变");
  await control.stop();
}, 15_000);

test("onSendReady：无活跃桥/缓冲已空不触发重放，重发沿只按未确认批次", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 60_000 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_noreplay");

  // 无活跃桥时同 socket 重新 matched（same-socket 沿）：不得发任何 rpc 帧
  socket.serverMessage({ type: "pair_status_ack", pair_status: "matched", server_ts: 3 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    collectAppFrames(socket).filter((m) => m.zcode_type.startsWith("rpc-frame")).length,
    0,
    "无桥重配对不得产生 rpc 帧",
  );

  // 开桥发一条并 ack（缓冲清空）→ 断线重连 matched：重放无未确认批次 = 无帧
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  bridgePort.hostEmits(new Uint8Array([7]));
  await new Promise((r) => setTimeout(r, 10));
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "rpc-frame-ack", ackMessageSeq: 1 },
  });
  await new Promise((r) => setTimeout(r, 10));
  socket.close();
  await new Promise((r) => setTimeout(r, 1_150));
  const socket2 = harness.sockets[1];
  assert.ok(socket2, "重连后必须有新 socket");
  socket2.serverOpen();
  socket2.serverMessage({ type: "auth_challenge", nonce: "n2", server_ts: 1 });
  socket2.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  socket2.serverMessage({ type: "pair_status_ack", pair_status: "matched", server_ts: 2 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    collectAppFrames(socket2).filter((m) => m.zcode_type === "rpc-frame").length,
    0,
    "缓冲已空的重放沿不得重发任何帧",
  );
  assert.equal(collectFlowStates(bridgePort).length, 0, "未越水位不得发 flow-state");
  await control.stop();
}, 15_000);

// —— M4c：workspace-reconnect-request 与远程工作区开桥 ——

test("workspace-reconnect-request：委托成功回 success:true，失败回 error 消息（官方 lt 语义）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const reconnectCalls: string[] = [];
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    reconnectWorkspace: async (workspaceKey) => {
      reconnectCalls.push(workspaceKey);
      if (workspaceKey === "ssh://host/gone") {
        throw new Error("远程 workspace 不在当前窗口中，无法重连: ssh://host/gone");
      }
    },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_reconnect");
  // 成功路径：requestId/workspaceKey 必须回显（手机页按两者匹配响应，托管页 @6086587）。
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-reconnect-request",
      requestId: "wr1",
      workspaceKey: "ssh://host/proj",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const responses = () =>
    collectAppFrames(socket).filter((m) => m.zcode_type === "workspace-reconnect-response");
  const ok = responses().find((m) => m.requestId === "wr1");
  assert.ok(ok, "重连成功必须回应 workspace-reconnect-response");
  assert.equal(ok.success, true);
  assert.equal(ok.workspaceKey, "ssh://host/proj");
  assert.deepEqual(reconnectCalls, ["ssh://host/proj"]);

  // 失败路径：success:false + error=委托 rejection 消息（官方无独立 reason 字段）。
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-reconnect-request",
      requestId: "wr2",
      workspaceKey: "ssh://host/gone",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const failed = responses().find((m) => m.requestId === "wr2");
  assert.ok(failed, "重连失败必须回应 workspace-reconnect-response");
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /无法重连/u);

  // 未注入委托：按重连失败回应（错误面明示不可用，不再回 M4c 占位文案）。
  const bareStore = await makeStore();
  const bare = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: bareStore,
    resolveHostChild: () => null,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void bare.stop());
  // start 会等 QR 就绪：先驱动 fake 连接再等 start 完成（避免 30s 超时）。
  const bareStart = bare.start({ workspacePath: "C:/demo" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  const bareSocket = harness.sockets.at(-1)!;
  bareSocket.serverOpen();
  bareSocket.serverMessage({ type: "device_register_ack", device_sid: "d_bare", server_ts: 1 });
  bareSocket.serverMessage({ type: "auth_challenge", nonce: "n", server_ts: 1 });
  bareSocket.serverMessage({ type: "auth_ack", pair_status: "waiting", server_ts: 1 });
  await bareStart;
  bareSocket.serverMessage({ type: "pair_status_ack", pair_status: "matched", server_ts: 2 });
  await new Promise((r) => setTimeout(r, 10));
  bareSocket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-reconnect-request",
      requestId: "wr3",
      workspaceKey: "ssh://host/x",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const unavailable = collectAppFrames(bareSocket).find(
    (m) => m.zcode_type === "workspace-reconnect-response" && m.requestId === "wr3",
  );
  assert.ok(unavailable, "未注入委托也必须回应");
  assert.equal(unavailable.success, false);
  await control.stop();
  await bare.stop();
}, 15_000);

const REMOTE_WORKSPACE = {
  workspacePath: "ssh://host/remote/proj",
  workspaceIdentity: "ssh-id-1",
  remoteSessionId: "rs-1",
  label: "proj",
  kind: "remote" as const,
  connectionState: "connected" as const,
};

test("远程工作区开桥：remote-scoped attach 成功回 kind=remote ready（官方 toExternalBridge）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const attachCalls: Array<{
    remoteSessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
  }> = [];
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    attachRemoteBridgePort: (params) => {
      attachCalls.push(params);
      return { port: createFakeBridgePort() as never, remoteKind: "ssh" };
    },
    replayBufferOptions: { graceMs: 60_000 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_remotebridge");
  control.syncAvailableWorkspaces([REMOTE_WORKSPACE]);
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rb-r",
      bridgeSessionId: "b-remote",
      bridgeGeneration: 3,
      workspaceKey: "ssh-id-1",
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(attachCalls, [
    {
      remoteSessionId: "rs-1",
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: "ssh-id-1",
    },
  ]);
  const ready = collectAppFrames(socket).find((m) => m.zcode_type === "workspace-bridge-ready");
  assert.ok(ready, "远程可桥工作区必须成功开桥");
  const bridgeShape = ready.bridge as Record<string, unknown>;
  // 外形对齐官方 toExternalBridge（zW @386100）：kind=remote 必带 identity+remoteSessionId。
  assert.equal(bridgeShape.kind, "remote");
  assert.equal(bridgeShape.workspaceIdentity, "ssh-id-1");
  assert.equal(bridgeShape.remoteSessionId, "rs-1");
  assert.equal(bridgeShape.bridgeGeneration, 3);
  await control.stop();
}, 15_000);

test("远程工作区开桥拒绝面：未连接（缺 remoteSessionId）→ unexpected-error + 官方文案", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  let attachRemoteCalls = 0;
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachRemoteBridgePort: () => {
      attachRemoteCalls += 1;
      return { port: createFakeBridgePort() as never, remoteKind: "ssh" };
    },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_remdeny");
  // 断连的远程条目：renderer 推送不再携带 remoteSessionId（isBridgeableRemoteTarget
  // 即官方 pl @385786 的"已连接代理"）。
  control.syncAvailableWorkspaces([
    {
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: "ssh-id-1",
      label: "proj",
      kind: "remote",
      connectionState: "disconnected",
    },
  ]);
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rb-off",
      bridgeSessionId: "b-off",
      workspaceKey: "ssh-id-1",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  const error = collectAppFrames(socket).find((m) => m.zcode_type === "workspace-bridge-error");
  assert.ok(error, "未连接远程必须回应 bridge-error");
  // 无 code 校验错误 → unexpected-error（官方 FW 词汇表；文案取官方原文 @395979）。
  assert.equal(error.reason, "unexpected-error");
  assert.match(String(error.error), /尚未连接.*重连/u);
  assert.equal(attachRemoteCalls, 0, "可桥判定拒绝后不得触达 remote attach");
  await control.stop();
}, 15_000);

test("开桥 superseded：更新请求取代后，旧请求回 superseded 错误且端口被释放", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  // 第一请求的附着挂起（对齐官方异步 attach 的 superseded 窗口，index.js@396694）。
  let releaseFirstAttach: ((port: never) => void) | null = null;
  const firstAttachPort = createFakeBridgePort();
  const firstAttach = new Promise<never>((resolve) => {
    releaseFirstAttach = (port) => resolve(port);
  });
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: (() => {
      let calls = 0;
      return () => {
        calls += 1;
        return calls === 1 ? firstAttach : (createFakeBridgePort() as never);
      };
    })() as never,
    replayBufferOptions: { graceMs: 60_000 },
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_super");
  // 旧请求进入挂起的附着；随后同 socket 到达新请求（官方页面自增 bridgeGeneration）。
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rb-old",
      bridgeSessionId: "b-old",
      bridgeGeneration: 1,
      workspaceKey: "C:/demo",
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rb-new",
      bridgeSessionId: "b-new",
      bridgeGeneration: 2,
      workspaceKey: "C:/demo",
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  // 新请求先行完成：ready 只属于新请求。
  const readies = collectAppFrames(socket).filter((m) => m.zcode_type === "workspace-bridge-ready");
  assert.equal(readies.length, 1);
  assert.equal(readies[0]?.requestId, "rb-new");
  assert.equal(readies[0]?.bridgeGeneration, 2);
  // 释放旧请求的附着：superseded 校验二生效——旧请求回错误、其端口被释放。
  releaseFirstAttach?.(firstAttachPort as never);
  await new Promise((r) => setTimeout(r, 30));
  const errors = collectAppFrames(socket).filter((m) => m.zcode_type === "workspace-bridge-error");
  const stale = errors.find((m) => m.requestId === "rb-old");
  assert.ok(stale, "被取代的旧请求必须收到错误响应");
  assert.equal(stale.reason, "unexpected-error");
  assert.match(String(stale.error), /superseded/u);
  assert.equal(firstAttachPort.closed, true, "旧请求的附着端口必须被释放");
  // 新桥不受影响：数据面仍可用。
  const newBridgePortReady = collectAppFrames(socket).some(
    (m) => m.zcode_type === "workspace-bridge-ready",
  );
  assert.ok(newBridgePortReady);
  await control.stop();
}, 15_000);

test("发送侧超限：物理帧超过上限 → envelopeTooLarge 终态降级（官方 sendFrame 语义）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const bridgePort = createFakeBridgePort();
  const warns: string[] = [];
  const control = createDesktopMobileRelayControl({
    logger: {
      info: () => {},
      warn: (message: unknown) => {
        warns.push(String(message));
      },
    },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => bridgePort as never,
    replayBufferOptions: { graceMs: 60_000 },
    // 注入极小的应用帧上限，使单条 rpc-frame 物理帧必然超限（官方 maxPhysicalFrameBytes
    // 语义下 sendFrame 抛 envelopeTooLarge → enterDegraded）。
    maxAppFrameBytes: 300,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_oversize");
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  const ready = collectAppFrames(socket).find((m) => m.zcode_type === "workspace-bridge-ready");
  assert.ok(ready, "小上限下 bootstrap/ready 帧仍可发出");
  // Host → 手机：消息编码后的首个物理帧超过 300B 上限 → 终态降级。
  bridgePort.hostEmits(new Uint8Array(64).fill(9));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame").length,
    0,
    "超限帧不得上线",
  );
  assert.equal(
    warns.some((w) => w.includes("终态降级")),
    true,
    "超限必须触发终态降级",
  );
  // 降级后出站继续拒绝：后续 Host 消息不产生 rpc 帧。
  bridgePort.hostEmits(new Uint8Array([1]));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(collectAppFrames(socket).filter((m) => m.zcode_type === "rpc-frame").length, 0);
  await control.stop();
}, 15_000);

/** 遥测事件捕获（reportUsageEvent 注入收集器）。 */
type CapturedUsageEvent = {
  elementName: string;
  eventRegion: string;
  eventType: string;
  eventExtraDetail: Record<string, string>;
};

test("遥测事件族：信封 eventRegion=web_remote_control、start/pair/bridge 维度对齐官方 ctor", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const events: CapturedUsageEvent[] = [];
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    reportUsageEvent: (event) => events.push(event),
    attachBridgePort: () => createFakeBridgePort() as never,
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_telemetry");

  // 信封对齐官方 Af 构造（chunk-GJUBRD53.js@741857）：eventRegion 恒
  // "web_remote_control"（2026-09-28 修正：此前误写 "result"）。
  for (const event of events) {
    assert.equal(event.eventRegion, "web_remote_control");
    assert.equal(event.eventType, "result");
  }

  // start_result success（本地启动：官方 runStartOperation index.js@658465）。
  const startOk = events.find((e) => e.elementName === "web_remote_control_start_result");
  assert.ok(startOk, "start 成功必须上报 start_result");
  assert.deepEqual(startOk.eventExtraDetail, {
    result: "success",
    error_category: "",
    workspace_kind: "local",
    remote_kind: "",
  });

  // 首次配对 pair_kind=initial（官方 nI paired 沿 emit 时 hasEverPaired 尚未置位，
  // index.js@401972；修复此前 wasPaired 先置位导致的恒 "reconnect"）。
  const pairOk = events.find((e) => e.elementName === "web_remote_control_pair_result");
  assert.ok(pairOk, "首次配对必须上报 pair_result");
  assert.deepEqual(pairOk.eventExtraDetail, {
    result: "success",
    error_category: "",
    pair_kind: "initial",
    workspace_kind: "local",
    remote_kind: "",
  });

  // 开桥成功 → bridge_result：本地目标 remote_kind 恒空串（官方 lee 构造 ctor
  // 对 undefined 落空串，chunk-GJUBRD53.js@742684）。
  openBridge(socket);
  await new Promise((r) => setTimeout(r, 30));
  const bridgeOk = events.find((e) => e.elementName === "web_remote_control_bridge_result");
  assert.ok(bridgeOk, "开桥成功必须上报 bridge_result");
  assert.deepEqual(bridgeOk.eventExtraDetail, {
    result: "success",
    error_category: "",
    workspace_kind: "local",
    remote_kind: "",
    entry_kind: "home",
  });

  // KICKED → pair failure（官方 nI kicked 分支 errorCategory="relay"，pair_kind
  // 取 hasEverPaired 活值=已有配对史 → "reconnect"）。
  socket.serverMessage({ type: "error", code: "KICKED", message: "kicked by new page" });
  await new Promise((r) => setTimeout(r, 10));
  const pairFail = events.filter((e) => e.elementName === "web_remote_control_pair_result").at(-1);
  assert.ok(pairFail, "KICKED 必须上报 pair_result failure");
  assert.deepEqual(pairFail.eventExtraDetail, {
    result: "failure",
    error_category: "relay",
    pair_kind: "reconnect",
    workspace_kind: "local",
    remote_kind: "",
  });
  await control.stop();
}, 15_000);

test("start_result 失败面：终态错误上报 failure + error 沿 pair failure（官方 runStartOperation catch）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const events: CapturedUsageEvent[] = [];
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => null,
    reportUsageEvent: (event) => events.push(event),
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  // QR 等待期间 relay 回非 KICKED/AUTH_FAILED/WRONG_PARAM/INTERNAL 的终态错误 →
  // handleRelayError 终态分支 → start 拒绝（快速失败，不拖 QR 超时）。
  const startPromise = control.start({ workspacePath: "C:/demo" }).then(
    () => {
      throw new Error("start 应当失败");
    },
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  await new Promise((r) => setTimeout(r, 10));
  const socket = harness.sockets[0];
  assert.ok(socket, "socket 必须已创建");
  socket.serverOpen();
  socket.serverMessage({ type: "error", code: "RELAY_DOWN", message: "relay exploded" });
  assert.equal(await startPromise, "relay exploded");

  // start_result failure（官方 runStartOperation catch index.js@658475：失败面
  // 也上报，errorCategory 走 classifyRemoteUsageError 低基数枚举）。
  const startFail = events.find((e) => e.elementName === "web_remote_control_start_result");
  assert.ok(startFail, "start 失败必须上报 start_result failure");
  assert.equal(startFail.eventExtraDetail.result, "failure");
  assert.equal(startFail.eventExtraDetail.workspace_kind, "local");
  assert.match(
    startFail.eventExtraDetail.error_category,
    /^(auth|connect|deploy|host_start|attach|relay|unknown)$/u,
  );

  // 终态 error 状态沿同时上报 pair failure（官方 nI error 分支 index.js@402465：
  // errorCategory="relay"，首次启动尚未配对 → pair_kind="initial"）。
  const pairFail = events.find((e) => e.elementName === "web_remote_control_pair_result");
  assert.ok(pairFail, "终态 error 必须上报 pair_result failure");
  assert.deepEqual(pairFail.eventExtraDetail, {
    result: "failure",
    error_category: "relay",
    pair_kind: "initial",
    workspace_kind: "local",
    remote_kind: "",
  });
});

test("bridge_result remote_kind：attach 结果优先、identity 解析兜底（官方 resolveRemoteKind）", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  const events: CapturedUsageEvent[] = [];
  // identity 可解析为 ssh，attach 返回 wsl——断言 attach 结果优先（官方
  // resolveRemoteKind index.js@387052：`attach?.remoteKind ?? parse(identity)?.kind`）。
  const sshIdentity = "remote:ssh:host:22:u:/proj";
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    credentialStore: store,
    resolveHostChild: () => ({ pid: 4321 }) as never,
    attachBridgePort: () => createFakeBridgePort() as never,
    attachRemoteBridgePort: () => ({
      port: createFakeBridgePort() as never,
      remoteKind: "wsl",
    }),
    replayBufferOptions: { graceMs: 60_000 },
    reportUsageEvent: (event) => events.push(event),
    webSocketCtor: harness.ctor as never,
    relayWsUrl: "wss://relay.test/ws",
    remotePageUrl: "https://page.test/remote/v4",
  });
  after(() => void control.stop());

  const socket = await driveRelayToMatched(control, harness, "d_remotekind");
  control.syncAvailableWorkspaces([
    {
      workspacePath: "ssh://host/remote/proj",
      workspaceIdentity: sshIdentity,
      remoteSessionId: "rs-9",
      label: "proj",
      kind: "remote" as const,
      connectionState: "connected" as const,
    },
  ]);
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rk-r",
      bridgeSessionId: "b-remotekind",
      workspaceKey: sshIdentity,
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  const ready = collectAppFrames(socket).find((m) => m.zcode_type === "workspace-bridge-ready");
  assert.ok(ready, "远程可桥工作区必须成功开桥");
  const bridgeOk = events
    .filter((e) => e.elementName === "web_remote_control_bridge_result")
    .at(-1);
  assert.ok(bridgeOk, "远程开桥成功必须上报 bridge_result");
  // attach 结果优先：identity 解析是 ssh，上报 attach 的 wsl。
  assert.equal(bridgeOk.eventExtraDetail.workspace_kind, "remote");
  assert.equal(bridgeOk.eventExtraDetail.remote_kind, "wsl");

  // 未连接拒绝面（attach 未发生）：remote_kind 走 identity 解析兜底。
  control.syncAvailableWorkspaces([
    {
      workspacePath: "docker://box/proj",
      workspaceIdentity: "remote:docker:box:/proj",
      label: "box",
      kind: "remote" as const,
    },
  ]);
  socket.serverMessage({
    type: "data",
    payload: {
      zcode_type: "workspace-bridge-open",
      requestId: "rk-x",
      bridgeSessionId: "b-remotekind-x",
      workspaceKey: "remote:docker:box:/proj",
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  const rejected = collectAppFrames(socket).find(
    (m) => m.zcode_type === "workspace-bridge-error" && m.requestId === "rk-x",
  );
  assert.ok(rejected, "未连接远程必须回 bridge-error");
  const bridgeFail = events
    .filter((e) => e.elementName === "web_remote_control_bridge_result")
    .at(-1);
  assert.ok(bridgeFail, "拒绝面必须上报 bridge_result failure");
  assert.equal(bridgeFail.eventExtraDetail.result, "failure");
  assert.equal(bridgeFail.eventExtraDetail.workspace_kind, "remote");
  assert.equal(bridgeFail.eventExtraDetail.remote_kind, "docker");
  await control.stop();
}, 15_000);

test("remote_workspace_connect_result ctor 形状对齐官方 aee（eventRegion=remote_workspace）", () => {
  // 官方 ctor aee（chunk-GJUBRD53.js@741913）：eventRegion 独立为 "remote_workspace"，
  // 成功时 error_category 空串、失败缺省 "unknown"；connect_trigger 枚举
  // new|reconnect|restore（官方赋值点 index.js@665263：非 reconnect/restore 缺省 new）。
  // 手机重连链路（renderer connectTrigger:"reconnect" → ConnectRemote handler）经
  // 此构造上报——官方同点位（重连委托 qb/lt 无遥测，index.js@399799/409793）。
  const ok = buildRemoteWorkspaceConnectResultTelemetry({
    result: "success",
    remoteKind: "ssh",
    connectTrigger: "reconnect",
  });
  assert.deepEqual(ok, {
    elementName: "remote_workspace_connect_result",
    eventRegion: "remote_workspace",
    eventType: "result",
    eventExtraDetail: {
      result: "success",
      remote_kind: "ssh",
      connect_trigger: "reconnect",
      error_category: "",
    },
  });
  const failed = buildRemoteWorkspaceConnectResultTelemetry({
    result: "failure",
    remoteKind: "docker",
    connectTrigger: "new",
    errorCategory: "auth",
  });
  assert.equal(failed.eventExtraDetail.error_category, "auth");
  const unknownCategory = buildRemoteWorkspaceConnectResultTelemetry({
    result: "failure",
    remoteKind: "server",
    connectTrigger: "restore",
  });
  assert.equal(unknownCategory.eventExtraDetail.error_category, "unknown");
});

test("§33.6 displayStatus 映射：本仓状态词表 → 官方页行状态枚举（缺省 idle）", () => {
  // 官方 pb schema @261533：displayStatus enum[idle,running,completed,error].optional，
  // 行状态徽标读它而非 status；本仓词表 = DroraTaskMeta["status"]。
  assert.equal(deriveRelayDisplayStatus("running"), "running");
  assert.equal(deriveRelayDisplayStatus("completed"), "completed");
  assert.equal(deriveRelayDisplayStatus("error"), "error");
  assert.equal(deriveRelayDisplayStatus(undefined), "idle");
  assert.equal(deriveRelayDisplayStatus(""), "idle");
  assert.equal(deriveRelayDisplayStatus("waiting"), "idle");
});
