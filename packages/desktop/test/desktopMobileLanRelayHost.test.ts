// 内嵌 LAN relay 宿主测试（specs/mobile-relay-server.md §12）：
// - 生命周期：listen（随机端口）/stop 幂等、重启换端口、registry 落盘；
// - 凭据 origin 路由纯逻辑：文件名派生、云端 origin 解析、LAN 稳定 origin；
// - 进程内一致性（G1 的 LAN 形态）：真 desktopMobileRelayControl × 真内嵌
//   relayServer 全配对流（注册→鉴权→waiting→QR→terminal 配对 matched→data 双向
//   →stop 语义），装配形状（prepare→resolveEndpoints 固定注入）与 index.ts 同构。
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import {
  LAN_EMBEDDED_RELAY_ORIGIN,
  buildLanRemotePageUrl,
  createDesktopMobileLanRelayHost,
  credentialFileNameForOrigin,
  resolveCloudRelayOrigin,
  resolveLocalMobileWebRoot,
} from "../src/main/desktopMobileLanRelayHost.js";
import {
  calculateRelayProof,
  MobileRelayCredentialStore,
  OFFICIAL_RELAY_WS_URL,
} from "../src/main/desktopMobileRelayProtocol.js";
import { createDesktopMobileRelayControl } from "../src/main/desktopMobileRelayControl.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

const silentLogger = { info: () => {}, warn: () => {} };

function connectTerminal(url: string): Promise<{
  send(message: Record<string, unknown>): void;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}> {
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

test("内嵌宿主生命周期：随机端口监听/幂等/stop 后重启换端口/registry 落盘", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-lan-host-"));
  tempDirs.push(dir);
  const registryPath = join(dir, "nested", "registry.json");
  const host = createDesktopMobileLanRelayHost({
    logger: silentLogger,
    registryFilePath: registryPath,
  });

  // 启动：port=0 → 系统分配有效端口；重复 ensureStarted 幂等同端口。
  const first = await host.ensureStarted();
  assert.ok(first.port > 0 && first.port < 65536, "随机端口必须有效");
  const again = await host.ensureStarted();
  assert.equal(again.port, first.port, "幂等：已监听时复用同一端口");
  assert.equal(host.currentPort(), first.port);
  assert.equal(host.isRunning(), true);

  // LAN 内嵌服务优先由独立 mobile-web 包离线供给 v4 入口和版本资产。
  assert.ok(await resolveLocalMobileWebRoot());
  const entry = await fetch(`http://127.0.0.1:${first.port}/remote/v4`);
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /3\.14\.3\/assets\/index-/u);
  const bundle = await fetch(
    `http://127.0.0.1:${first.port}/remote/v4/3.14.3/assets/index-NjWRUABD.js`,
  );
  assert.equal(bundle.status, 200);
  assert.doesNotMatch(await bundle.text(), /`wss:\/\/zcode\.z\.ai\/ws`/u);

  // 真实可达：WS 入口在同一端口应答注册。
  const probe = await connectTerminal(`ws://127.0.0.1:${first.port}/ws`);
  probe.send({
    type: "device_register_init",
    device_mid: "mid-host",
    pass_hash: "h",
    client_ts: Date.now(),
  });
  assert.equal((await probe.next()).type, "device_register_ack");
  await probe.close();

  // 注册触发 registry 落盘（嵌套目录自动创建）。
  const persisted = JSON.parse(await readFile(registryPath, "utf8")) as unknown[];
  assert.ok(Array.isArray(persisted) && persisted.length >= 1, "registry 必须持久化到注入路径");

  // stop：幂等；未运行时 stop 直接返回；重启换新端口（port:0 语义）。
  await host.stop();
  assert.equal(host.isRunning(), false);
  assert.equal(host.currentPort(), null);
  await host.stop();
  const restarted = await host.ensureStarted();
  assert.ok(restarted.port > 0);
  await host.stop();
});

test("凭据 origin 路由纯逻辑：文件名 sha8 派生、云端 origin、LAN 稳定 origin", () => {
  // 文件名 = mobile-relay-device-<sha8(origin)>.json；不同 origin 必不同文件。
  const cloud = credentialFileNameForOrigin("wss://zcode.z.ai");
  const selfHosted = credentialFileNameForOrigin("ws://relay.lan:4430");
  const lan = credentialFileNameForOrigin(LAN_EMBEDDED_RELAY_ORIGIN);
  assert.match(cloud, /^mobile-relay-device-[0-9a-f]{8}\.json$/u);
  assert.notEqual(cloud, selfHosted);
  assert.notEqual(cloud, lan);
  assert.equal(credentialFileNameForOrigin("wss://zcode.z.ai"), cloud, "同 origin 稳定");

  // 云端路由键取 relayWsUrl origin（官方 vs 自建互不通用）；非法 URL 回落原串。
  assert.equal(resolveCloudRelayOrigin("wss://zcode.z.ai/ws"), "wss://zcode.z.ai");
  assert.equal(resolveCloudRelayOrigin("ws://relay.lan:4430/ws"), "ws://relay.lan:4430");
  assert.equal(resolveCloudRelayOrigin("not-a-url"), "not-a-url");
  // 缺省（未配置自建）= 官方端点 origin。
  assert.equal(resolveCloudRelayOrigin(OFFICIAL_RELAY_WS_URL), "wss://zcode.z.ai");

  // LAN 稳定 origin 不含端口：端口随机重启变化，registry.json 才是身份域（§12.2）。
  assert.equal(LAN_EMBEDDED_RELAY_ORIGIN, "ws://127.0.0.1");
  assert.doesNotMatch(LAN_EMBEDDED_RELAY_ORIGIN, /:\d+$/u);
});

test("进程内一致性：真 desktopMobileRelayControl × 真内嵌 relayServer 全配对流（LAN 形态）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-lan-e2e-"));
  tempDirs.push(dir);
  const host = createDesktopMobileLanRelayHost({
    logger: silentLogger,
    registryFilePath: join(dir, "registry.json"),
  });
  // 装配形状与 index.ts prepareMobileRelayTransport 同构：ensureStarted → 固定注入。
  const { port } = await host.ensureStarted();
  let preparedEndpoints: { relayWsUrl: string; remotePageUrl: string } | null = {
    relayWsUrl: `ws://127.0.0.1:${port}/ws`,
    // 手机页地址按 LAN IPv4 构造（同 buildLanRemotePageUrl 形状；测试网段必有地址）。
    remotePageUrl: buildLanRemotePageUrl({ port }),
  };
  assert.match(
    preparedEndpoints.remotePageUrl,
    /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/remote\/v4$/u,
    "QR 页地址必须指向手机可达的 LAN IPv4 上的官方 v4 托管页（§12.9，离线 302 回退 R2 页）",
  );

  // 凭据仓：LAN 稳定 origin 路由（§12.2，路由文件名与装配一致）。
  const credentialStore = new MobileRelayCredentialStore(
    dir,
    undefined,
    credentialFileNameForOrigin(LAN_EMBEDDED_RELAY_ORIGIN),
  );

  const control = createDesktopMobileRelayControl({
    logger: silentLogger,
    deviceMid: "mid-lan",
    credentialStore,
    resolveHostChild: () => null,
    onStatusChanged: () => {},
    resolveEndpoints: async () => preparedEndpoints,
  });

  const started = await control.start({ workspacePath: "C:/lan", transport: "lan" });
  assert.equal(control.runtimeState().status, "running", "注册+鉴权完成，进入 waiting");
  assert.equal(control.runtimeState().transport, "lan", "状态携带 transport=lan");

  // QR：sid+hash 形态（与云中继同构造），baseUrl = 注入的本机页地址。
  const qr = new URL(started.url);
  assert.equal(qr.origin, new URL(preparedEndpoints.remotePageUrl).origin);
  assert.equal(qr.pathname, "/remote/v4");
  const deviceSid = qr.searchParams.get("sid") as string;
  const passHash = qr.searchParams.get("hash") as string;
  assert.match(deviceSid, /^d_/);

  // 手机（terminal）经局域网入口配对：auth_init → challenge → proof → matched。
  const terminal = await connectTerminal(`ws://127.0.0.1:${port}/ws`);
  terminal.send({
    type: "auth_init",
    role: "terminal",
    device_sid: deviceSid,
    client_ts: Date.now(),
  });
  const challenge = await terminal.next();
  assert.equal(challenge.type, "auth_challenge");
  terminal.send({
    type: "auth_response",
    device_sid: deviceSid,
    proof: calculateRelayProof({
      passHash,
      nonce: challenge.nonce as string,
      role: "terminal",
      sessionId: deviceSid,
    }),
    client_ts: Date.now(),
  });
  const authAck = await terminal.next();
  assert.equal(authAck.type, "auth_ack");
  assert.equal(authAck.pair_status, "matched");
  assert.equal(authAck.device_sid, deviceSid, "terminal ack 携带 device_sid（E2E #2）");

  // 桌面侧感知 matched（≤120ms 推送窗口）。
  for (let i = 0; i < 20 && control.runtimeState().status !== "active"; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(control.runtimeState().status, "active");
  assert.equal(control.runtimeState().connected, true);

  // 终端心跳（E2E #1 P0）：terminal query 受理，回 matched + terminal_sid:""。
  terminal.send({ type: "pair_status_query", device_sid: deviceSid, client_ts: Date.now() });
  const heartbeat = await terminal.next();
  assert.equal(heartbeat.type, "pair_status_ack");
  assert.equal(heartbeat.pair_status, "matched");
  assert.equal(heartbeat.terminal_sid, "");

  // data 双向：terminal bootstrap-request → 桌面回应；桌面 workspace-list 广播路径存在。
  terminal.send({
    type: "data",
    payload: { zcode_type: "bootstrap-request", requestId: "lan1" },
    client_ts: Date.now(),
  });
  const bootstrapResponse = await terminal.next();
  assert.equal(bootstrapResponse.type, "data");
  const payload = bootstrapResponse.payload as { zcode_type: string; success: boolean };
  assert.equal(payload.zcode_type, "bootstrap-response");
  assert.equal(payload.success, true);

  // stop 语义（§12.1）：control.stop + host.stop 后内嵌端口不可达。
  await control.stop();
  await host.stop();
  const stopped = await connectTerminal(`ws://127.0.0.1:${port}/ws`).then(
    () => "reachable",
    () => "unreachable",
  );
  assert.equal(stopped, "unreachable", "LAN stop 必须同时停内嵌服务端");

  // 凭据按 LAN origin 路由落盘（跨重启可复用同 registry 鉴权）。
  const persistedCredential = await credentialStore.load();
  assert.ok(persistedCredential, "LAN 凭据必须落盘到 origin 路由文件");
  assert.equal(persistedCredential.deviceSid, deviceSid);
});
