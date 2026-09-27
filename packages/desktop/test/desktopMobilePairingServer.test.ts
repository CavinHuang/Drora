import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createDesktopMobilePairingServer } from "../src/main/desktopMobilePairingServer.js";

// 配对服务协议级测试（plain node，无 electron 运行时）：
// 覆盖 启动→错误令牌拒绝→正确配对→会话令牌恢复→桥接缺失时的错误帧→重置配对踢除→停服。
// 桥接层（AttachServicePort/ChannelClient）依赖 electron UtilityProcess，
// 在本测试中表现为 bridge-call-failed 错误帧，这条路径本身也是被测行为。

const testApi = { sockets: [] as WebSocket[] };

function connect(
  url: string,
): Promise<{ ws: WebSocket; next: () => Promise<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const wsUrl = `ws://${parsed.host}/ws`;
    const ws = new WebSocket(wsUrl);
    const queue: Record<string, unknown>[] = [];
    const waiters: Array<(v: Record<string, unknown>) => void> = [];
    testApi.sockets.push(ws);
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
    ws.on("open", () => {
      const next = (timeoutMs = 3000) =>
        new Promise<Record<string, unknown>>((res, rej) => {
          const queued = queue.shift();
          if (queued) {
            res(queued);
            return;
          }
          const timer = setTimeout(() => rej(new Error("frame timeout")), timeoutMs);
          waiters.push((frame) => {
            clearTimeout(timer);
            res(frame);
          });
        });
      resolve({ ws, next });
    });
    ws.on("error", reject);
  });
}

// plain node 下没有 electron 运行时；fake hostChild 让 ensureServiceChannels 走到
// MessageChannelMain require 失败的桥接错误路径（与桌面运行时的差异仅此一处）。
const fakeHostChild = { pid: 1234, postMessage: () => {} } as never;

test("配对服务：错误令牌拒绝、正确配对、resume 恢复、桥接缺失错误帧、停服", async () => {
  const statusLog: string[] = [];
  const server = createDesktopMobilePairingServer({
    logger: { info: () => {}, warn: () => {} },
    onStatusChanged: (state) => statusLog.push(state.status),
  });
  after(() => server.stop("test-end"));

  const started = await server.start({
    workspacePath: "C:/demo",
    resolveHostChild: () => fakeHostChild,
  });
  assert.ok(started.url.includes("/p/"), "URL 必须携带配对路径");
  assert.ok(started.port > 0);
  assert.equal(server.runtimeState().status, "running");
  assert.ok(statusLog.includes("starting"), "启动期必须先经过 starting 状态");

  // 1. 错误令牌 → error + 断开；WS 建立即进入 connecting 过渡态（对齐原版六态）
  const bad = await connect(started.url);
  assert.ok(statusLog.includes("connecting"), "WS 建立后必须经过 connecting 状态");
  bad.ws.send(JSON.stringify({ type: "hello", pairToken: "f".repeat(32) }));
  const badFrame = await bad.next();
  assert.equal(badFrame.type, "error");
  assert.equal(badFrame.code, "unknown-token");

  // 2. 正确令牌 → paired + 会话令牌；状态转 active；紧随其后收到桥接错误帧
  const good = await connect(started.url);
  good.ws.send(JSON.stringify({ type: "hello", pairToken: started.pairToken }));
  const paired = await good.next();
  assert.equal(paired.type, "paired");
  assert.equal(paired.workspacePath, "C:/demo");
  assert.ok(typeof paired.sessionToken === "string");
  assert.equal(server.runtimeState().status, "active");
  assert.ok(server.runtimeState().connected);

  // 3. 桥接在 plain node 下不可用 → error 帧（bridge-call-failed），而不是挂死
  good.ws.send(JSON.stringify({ type: "list" }));
  const listError = await good.next();
  assert.equal(listError.type, "error");

  // 4. resume：新连接凭会话令牌恢复
  const resumed = await connect(started.url);
  resumed.ws.send(JSON.stringify({ type: "resume", sessionToken: paired.sessionToken }));
  const resumedFrame = await resumed.next();
  assert.equal(resumedFrame.type, "paired");

  // 5. 停服后端口关闭，状态归零
  server.stop("test");
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!server.isRunning());
  assert.equal(server.runtimeState().status, "idle");

  for (const ws of testApi.sockets) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
});

test("重置配对（对齐原版 resetPairing）：踢除已连手机并换发票据，旧令牌作废", async () => {
  const server = createDesktopMobilePairingServer({
    logger: { info: () => {}, warn: () => {} },
  });
  after(() => server.stop("test-end"));

  const started = await server.start({
    workspacePath: "C:/demo",
    resolveHostChild: () => fakeHostChild,
  });

  // 手机 A 完成配对
  const phoneA = await connect(started.url);
  phoneA.ws.send(JSON.stringify({ type: "hello", pairToken: started.pairToken }));
  const pairedA = await phoneA.next();
  assert.equal(pairedA.type, "paired");
  // 配对成功后 Main 自动发起初始 list；plain node 桥接不可用先回一帧桥接错误帧，先排干。
  const initialBridgeError = await phoneA.next();
  assert.equal(initialBridgeError.type, "error");

  // 重置：A 必须先收到 kicked 错误帧（对齐 relay KICKED 失败面），票据换发
  const reset = await server.resetPairing();
  assert.notEqual(reset.pairToken, started.pairToken, "重置必须换发配对令牌");
  assert.notEqual(reset.url, started.url);
  assert.ok(server.isRunning(), "重置不重启服务，端口保持不变");
  assert.equal(reset.port, started.port);

  const kickedFrame = await phoneA.next();
  assert.equal(kickedFrame.type, "error");
  assert.equal(kickedFrame.code, "kicked");

  // 旧令牌已作废：新连接用它 hello 必须被拒
  const stale = await connect(reset.url);
  stale.ws.send(JSON.stringify({ type: "hello", pairToken: started.pairToken }));
  const staleFrame = await stale.next();
  assert.equal(staleFrame.type, "error");
  assert.equal(staleFrame.code, "unknown-token");

  // 新令牌可正常配对（旧连接已被踢，不产生并存）
  const phoneB = await connect(reset.url);
  phoneB.ws.send(JSON.stringify({ type: "hello", pairToken: reset.pairToken }));
  const pairedB = await phoneB.next();
  assert.equal(pairedB.type, "paired");
  assert.equal(server.runtimeState().status, "active");
});

test("运行中重复 start（对齐原版 start 接管语义）：旧服务被替换、旧会话失效", async () => {
  const server = createDesktopMobilePairingServer({
    logger: { info: () => {}, warn: () => {} },
  });
  after(() => server.stop("test-end"));

  const first = await server.start({
    workspacePath: "C:/demo",
    resolveHostChild: () => fakeHostChild,
  });
  const phone = await connect(first.url);
  phone.ws.send(JSON.stringify({ type: "hello", pairToken: first.pairToken }));
  await phone.next();
  // 排干配对后自动 list 的桥接错误帧（plain node 无 electron 桥）。
  await phone.next();

  // 换工作区再次 start：不抛"already running"，而是重启并踢除旧手机
  const second = await server.start({
    workspacePath: "C:/other",
    resolveHostChild: () => fakeHostChild,
  });
  assert.ok(second.url.includes("/p/"));
  assert.equal(server.runtimeState().status, "running");

  const kickedFrame = await phone.next();
  assert.equal(kickedFrame.type, "error");
  assert.equal(kickedFrame.code, "kicked");
});

test("窗口关闭停服（对齐原版 disposeWindow）：手机收到 workspace-closed 终态帧", async () => {
  const server = createDesktopMobilePairingServer({
    logger: { info: () => {}, warn: () => {} },
  });
  after(() => server.stop("test-end"));

  const started = await server.start({
    workspacePath: "C:/demo",
    resolveHostChild: () => fakeHostChild,
  });
  const phone = await connect(started.url);
  phone.ws.send(JSON.stringify({ type: "hello", pairToken: started.pairToken }));
  await phone.next();
  // 排干配对后自动 list 的桥接错误帧（plain node 无 electron 桥）。
  await phone.next();

  // 承载工作区的窗口关闭：stop 原因映射为 workspace-closed（对齐原版失败面），
  // 而非手动停止的 desktop-stopped。
  server.stop("window-closed");
  const closedFrame = await phone.next();
  assert.equal(closedFrame.type, "error");
  assert.equal(closedFrame.code, "workspace-closed");
  assert.ok(!server.isRunning());
});
