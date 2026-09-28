// G1 验收（specs/mobile-relay-server.md §10）：用真实桌面客户端
// （desktopMobileRelayControl）连自建 relay 服务端，跑通
// 注册→鉴权→waiting→QR→terminal 配对 matched→bootstrap 双向→KICKED→恢复。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import {
  calculateRelayProof,
  MobileRelayCredentialStore,
} from "../src/main/desktopMobileRelayProtocol.js";
import { createDesktopMobileRelayControl } from "../src/main/desktopMobileRelayControl.js";
import {
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
  createRelayServer,
} from "@drora/relay-server";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

interface TerminalClient {
  send(message: Record<string, unknown>): void;
  next(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function connectTerminal(url: string): Promise<TerminalClient> {
  const ws = new WebSocket(url);
  const queue: Record<string, unknown>[] = [];
  const pending: ((value: Record<string, unknown>) => void)[] = [];
  ws.on("message", (data) => {
    const parsed = JSON.parse(String(data)) as Record<string, unknown>;
    const resolver = pending.shift();
    if (resolver) resolver(parsed);
    else queue.push(parsed);
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      resolve({
        send(message) {
          ws.send(JSON.stringify(message));
        },
        next(timeoutMs = 5000) {
          const queued = queue.shift();
          if (queued) return Promise.resolve(queued);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("terminal message timeout")),
              timeoutMs,
            );
            pending.push((message) => {
              clearTimeout(timer);
              resolve(message);
            });
          });
        },
        close() {
          // 服务端可能已先行关闭（如 KICKED 后断开）——此时 close 事件已错过。
          return new Promise((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) return resolve();
            ws.once("close", resolve);
            ws.close();
          });
        },
      });
    });
    ws.once("error", reject);
  });
}

test("G1：真桌面客户端 × 自建 relay 服务端 全链路", async () => {
  const home = await mkdtemp(join(tmpdir(), "drora-relay-g1-"));
  tempDirs.push(home);
  const registry = createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(join(home, "devices.json")),
  });
  const server = createRelayServer({ registry, port: 0 });
  const port = await server.listen();

  const credentialStore = new MobileRelayCredentialStore(home);

  // 桌面客户端用 ws 库连真实 loopback（非 fake socket）；harness 仅收集状态。
  const control = createDesktopMobileRelayControl({
    logger: { info: () => {}, warn: () => {} },
    deviceMid: "mid-g1",
    credentialStore,
    resolveHostChild: () => null,
    onStatusChanged: () => {},
    // 真实 WS：relayServerOptions.webSocketCtor 不注入时桌面客户端懒加载 ws 包。
    relayWsUrl: `ws://127.0.0.1:${port}/ws`,
    remotePageUrl: "https://page.test/remote/v4",
  });

  const started = await control.start({ workspacePath: "C:/g1" });
  assert.equal(control.runtimeState().status, "running", "注册+鉴权完成，进入 waiting");
  const qrUrl = new URL(started.url);
  const deviceSid = qrUrl.searchParams.get("sid") as string;
  const passHash = qrUrl.searchParams.get("hash") as string;
  assert.match(deviceSid, /^d_/);

  // 手机（terminal 角色）按官方流程配对：auth_init → challenge → auth_response。
  const terminal = await connectTerminal(`ws://127.0.0.1:${port}/ws`);
  terminal.send({
    type: "auth_init",
    role: "terminal",
    device_sid: deviceSid,
    meta: { platform: "web", name: "mobile-browser" },
    client_ts: Date.now(),
  });
  const challengeOrError = await terminal.next();
  const challenge = challengeOrError;
  assert.equal(challenge.type, "auth_challenge");
  const nonce = challenge.nonce as string;
  // 与桌面客户端同一 proof 算法（base64url HMAC）——但注意参数名是 sessionId。
  const proof = calculateRelayProof({ passHash, nonce, role: "terminal", sessionId: deviceSid });
  terminal.send({ type: "auth_response", device_sid: deviceSid, proof, client_ts: Date.now() });
  const authAck = await terminal.next();
  assert.equal(authAck.type, "auth_ack");
  assert.equal(authAck.pair_status, "matched", "terminal 配对成功");
  assert.equal(authAck.type, "auth_ack");
  assert.equal(authAck.pair_status, "matched", "terminal 配对成功");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(control.runtimeState().status, "active", "桌面侧感知 matched");
  assert.equal(control.runtimeState().connected, true);

  // 手机 bootstrap-request → 桌面回应 → 手机收到（协议兼容核心证据）。
  terminal.send({
    type: "data",
    payload: { zcode_type: "bootstrap-request", requestId: "g1" },
    client_ts: Date.now(),
  });
  const bootstrapResponse = await terminal.next();
  assert.equal(bootstrapResponse.type, "data");
  const payload = bootstrapResponse.payload as { zcode_type: string; success: boolean };
  assert.equal(payload.zcode_type, "bootstrap-response");
  assert.equal(payload.success, true);

  // 单会话接管：第二个 terminal 配对 → 第一个收 KICKED；桌面经重连恢复 waiting。
  const kickedPromise = terminal.next();
  const terminal2 = await connectTerminal(`ws://127.0.0.1:${port}/ws`);
  terminal2.send({
    type: "auth_init",
    role: "terminal",
    device_sid: deviceSid,
    client_ts: Date.now(),
  });
  const challenge2 = await terminal2.next();
  const proof2 = calculateRelayProof({
    passHash,
    nonce: challenge2.nonce as string,
    role: "terminal",
    sessionId: deviceSid,
  });
  terminal2.send({
    type: "auth_response",
    device_sid: deviceSid,
    proof: proof2,
    client_ts: Date.now(),
  });
  assert.equal((await terminal2.next()).pair_status, "matched");
  const kicked = await kickedPromise;
  assert.equal(kicked.code, "KICKED");

  // 手机页动作帧路由（R2）：drora-page-request → 服务调用 → drora-page-response。
  // 本测试环境无窗口 Host，attacher 失败 → ok:false 结果帧（证明路由与错误面可达）。
  terminal2.send({
    type: "data",
    client_ts: Date.now(),
    payload: {
      zcode_type: "drora-page-request",
      requestId: "pg1",
      frame: { type: "list" },
    },
  });
  const pageResponse = await terminal2.next();
  assert.equal(pageResponse.type, "data");
  const pagePayload = pageResponse.payload as {
    zcode_type: string;
    requestId: string;
    success: boolean;
  };
  assert.equal(pagePayload.zcode_type, "drora-page-response");
  assert.equal(pagePayload.requestId, "pg1");
  assert.equal(pagePayload.success, false);
  await terminal.close();
  await terminal2.close();

  // 桌面侧 KICKED → session-conflict 失败面 + 自动重连；terminal2 关闭后回到
  // waiting（重连竞态下可能先短暂 active——terminal2 尚未关闭，轮询至终态）。
  let recoveredToWaiting = false;
  for (let i = 0; i < 25; i += 1) {
    if (control.runtimeState().status === "running") {
      recoveredToWaiting = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(
    recoveredToWaiting,
    `KICKED 重连后桌面应回到 waiting，实际 ${control.runtimeState().status}`,
  );

  await control.stop();
  await server.close();
  void credentialStore;
});
