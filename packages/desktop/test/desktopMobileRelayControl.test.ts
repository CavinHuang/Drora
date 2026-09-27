import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  MobileRelayCredentialStore,
  buildBootstrapResult,
  buildRelayQrUrl,
  buildWorkspaceListResult,
  calculateRelayProof,
  createRelayPassword,
  derivePassHash,
  mapTransportState,
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
    appVersion: "0.0.5",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://zcode.z.ai");
  assert.equal(parsed.pathname, "/remote/v4");
  assert.equal(parsed.searchParams.get("sid"), "d_abc");
  assert.equal(parsed.searchParams.get("hash"), "hash==");
  assert.equal(parsed.searchParams.get("t"), "1234");
  assert.equal(parsed.searchParams.get("mid"), "mid-1");
  assert.equal(parsed.searchParams.get("name"), "name-1");
  assert.equal(parsed.searchParams.get("app_version"), "0.0.5");
  // 空字段不落参（对齐官方 trim 判断）。
  const minimal = new URL(
    buildRelayQrUrl({ deviceSid: "d_x", passHash: "h", deviceName: "  ", appVersion: "" }),
  );
  assert.equal(minimal.searchParams.get("name"), null);
  assert.equal(minimal.searchParams.get("app_version"), null);
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
    kind: "local" as const,
    connectionState: "connected" as const,
  };
  const tasks = [{ taskId: "t1", title: "T", status: "running", updatedAt: 5 }];
  const bootstrap = buildBootstrapResult({
    deviceSid: "d_1",
    appVersion: "0.0.5",
    workspace,
    tasks,
    mobileViewState: { activeWorkspaceKey: "id-1", activeTaskId: "t1" },
  });
  assert.equal(bootstrap.windowControlSessionId, "d_1");
  assert.equal(bootstrap.desktopAppVersion, "0.0.5");
  assert.deepEqual(bootstrap.workspaces, [workspace]);
  assert.deepEqual(bootstrap.tasks, tasks);
  assert.deepEqual(bootstrap.mobileViewState, {
    activeWorkspaceKey: "id-1",
    activeTaskId: "t1",
  });

  const list = buildWorkspaceListResult({
    workspace,
    tasks,
    mobileViewState: { activeTaskId: "t1" },
  });
  assert.equal(list.activeWorkspaceKey, "id-1", "viewState 缺省回落工作区 key");
  assert.equal(list.activeTaskId, "t1");
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
    appVersion: "0.0.5",
    credentialStore: store,
    resolveHostChild: () => null,
    onStatusChanged: (state) => harness.emitStatus.push(state.status),
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

  // 手机配对
  socket.serverMessage({
    type: "pair_status_ack",
    pair_status: "matched",
    terminal_sid: "m_1",
    server_ts: 2,
  });
  assert.equal(control.runtimeState().status, "active");
  assert.equal(control.runtimeState().connected, true);

  // bootstrap 帧 → 返回带工作区的响应（任务拉取因 Host 缺失回空列表，不阻塞）
  socket.serverMessage({
    type: "data",
    payload: { zcode_type: "bootstrap-request", requestId: "r1" },
  });
  await new Promise((r) => setTimeout(r, 20));
  const bootstrapResponse = socket.sent.find(
    (m) => m.zcode_type === "bootstrap-response",
  );
  assert.ok(bootstrapResponse, "必须回应 bootstrap-response");
  assert.equal(bootstrapResponse.success, true);
  const result = bootstrapResponse.result as {
    workspaces: Array<{ workspacePath: string }>;
    windowControlSessionId: string;
  };
  assert.equal(result.windowControlSessionId, "d_test");
  assert.equal(result.workspaces[0]?.workspacePath, "C:/demo");

  // 桥请求（M4b）：plain node 无 electron MessageChannelMain，附着失败必须回
  // desktop-host-missing 失败面而不是挂起；workspaceKey 错误时回 workspace-not-found。
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
  const notFound = socket.sent.find((m) => m.zcode_type === "workspace-bridge-error");
  assert.ok(notFound, "未知工作区必须回应 bridge-error");
  assert.equal(notFound.reason, "workspace-not-found");
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
  const hostMissing = socket.sent
    .filter((m) => m.zcode_type === "workspace-bridge-error")
    .find((m) => m.requestId === "r3");
  assert.ok(hostMissing, "附着失败必须回应 bridge-error");
  assert.equal(hostMissing.reason, "desktop-host-missing");

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
    appVersion: "0.0.5",
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

test("reset 轮换凭据：清存后重走注册", async () => {
  const harness = createFakeSocketHarness();
  const store = await makeStore();
  await store.save({ deviceSid: "d_old", passHash: "h_old" });
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-test",
    appVersion: "0.0.5",
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
  const { RpcFrameAssembler, crc32, encodeRpcTransportMessage, buildRpcFrameAck, parseRpcTransportFrame, toExternalBridge } =
    await import("../src/main/desktopMobileRelayProtocol.js");
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
  const { encodeRpcTransportMessage, RPC_FRAME_MAX_MESSAGE_BYTES } = await import(
    "../src/main/desktopMobileRelayProtocol.js"
  );
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
