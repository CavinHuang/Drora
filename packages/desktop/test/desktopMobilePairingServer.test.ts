import assert from "node:assert/strict";
import { after, test } from "node:test";
import WebSocket from "ws";
import { createDesktopMobilePairingServer } from "../src/main/desktopMobilePairingServer.js";

// 配对服务协议级测试（plain node，无 electron 运行时）：
// 覆盖 启动→错误令牌拒绝→正确配对→会话令牌恢复→桥接缺失时的错误帧→停服。
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

test("配对服务：错误令牌拒绝、正确配对、resume 恢复、桥接缺失错误帧、停服", async () => {
  const server = createDesktopMobilePairingServer({
    logger: { info: () => {}, warn: () => {} },
  });
  after(() => server.stop("test-end"));

  const started = await server.start({
    workspacePath: "C:/demo",
    hostChild: { postMessage: () => {} } as never,
  });
  assert.ok(started.url.includes("/p/"), "URL 必须携带配对路径");
  assert.ok(started.port > 0);
  assert.equal(server.phase(), "awaiting-pair");

  // 1. 错误令牌 → error + 断开
  const bad = await connect(started.url);
  bad.ws.send(JSON.stringify({ type: "hello", pairToken: "f".repeat(32) }));
  const badFrame = await bad.next();
  assert.equal(badFrame.type, "error");
  assert.equal(badFrame.code, "unknown-token");

  // 2. 正确令牌 → paired + 会话令牌；紧随其后收到初始 taskList 相关帧或桥接错误帧
  const good = await connect(started.url);
  good.ws.send(JSON.stringify({ type: "hello", pairToken: started.pairToken }));
  const paired = await good.next();
  assert.equal(paired.type, "paired");
  assert.equal(paired.workspacePath, "C:/demo");
  assert.ok(typeof paired.sessionToken === "string");
  assert.equal(server.phase(), "paired");
  assert.ok(server.connected());

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
  assert.equal(server.phase(), "idle");

  for (const ws of testApi.sockets) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
});
