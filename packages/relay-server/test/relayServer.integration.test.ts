import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";
import { createDeviceRegistry, createFileDeviceRegistryStorage } from "../src/index.js";
import { computeProof } from "../src/protocol.js";
import { createRelayServer } from "../src/relayServer.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

interface WsClient {
  ws: WebSocket;
  send(message: Record<string, unknown>): void;
  next(): Promise<Record<string, unknown>>;
  raw: Record<string, unknown>[];
  close(): Promise<void>;
}

function connect(url: string): Promise<WsClient> {
  const ws = new WebSocket(url);
  const queue: Record<string, unknown>[] = [];
  const raw: Record<string, unknown>[] = [];
  const pending: ((value: Record<string, unknown>) => void)[] = [];
  ws.on("message", (data) => {
    const parsed = JSON.parse(String(data)) as Record<string, unknown>;
    raw.push(parsed);
    const resolver = pending.shift();
    if (resolver) resolver(parsed);
    else queue.push(parsed);
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      resolve({
        ws,
        send(message) {
          ws.send(JSON.stringify(message));
        },
        next(timeoutMs = 3000) {
          const queued = queue.shift();
          if (queued) return Promise.resolve(queued);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("message timeout")), timeoutMs);
            pending.push((message) => {
              clearTimeout(timer);
              resolve(message);
            });
          });
        },
        raw,
        close() {
          return new Promise((resolve) => {
            ws.once("close", resolve);
            ws.close();
          });
        },
      });
    });
    ws.once("error", reject);
  });
}

function passHashOf(password: string): string {
  return createHash("sha256").update(password).digest("base64");
}

test("relay 全流程：注册→鉴权→waiting→terminal 配对 matched→双向 data→KICKED→离线", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-it-"));
  tempDirs.push(dir);
  const db = join(dir, "devices.json");
  const registry = createDeviceRegistry({ storage: createFileDeviceRegistryStorage(db) });
  const server = createRelayServer({ registry, port: 0, pingIntervalMs: 250 });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}/ws`;

  // 1) device 注册 → ack 携带 sid；持久化文件落盘。
  const device = await connect(url);
  const password = "unit-test-password";
  const passHash = passHashOf(password);
  device.send({
    type: "device_register_init",
    device_mid: "mid-it",
    pass_hash: passHash,
    meta: { platform: "linux", version: "0.0.1", name: "it" },
    client_ts: Date.now(),
  });
  const registerAck = await device.next();
  assert.equal(registerAck.type, "device_register_ack");
  const deviceSid = registerAck.device_sid as string;
  assert.match(deviceSid, /^d_/);
  const persisted = JSON.parse(await readFile(db, "utf8")) as Array<{
    device_sid?: string;
    deviceSid?: string;
  }>;
  assert.ok(persisted.length >= 1);

  // 2) device 鉴权（HMAC 挑战应答）→ auth_ack waiting。
  device.send({ type: "auth_init", role: "device", device_sid: deviceSid, client_ts: Date.now() });
  const challenge = await device.next();
  assert.equal(challenge.type, "auth_challenge");
  assert.ok(typeof challenge.nonce === "string");
  const proof = computeProof({
    passHash,
    nonce: challenge.nonce as string,
    role: "device",
    deviceSid,
  });
  device.send({ type: "auth_response", device_sid: deviceSid, proof, client_ts: Date.now() });
  const authAck = await device.next();
  assert.equal(authAck.type, "auth_ack");
  assert.equal(authAck.pair_status, "waiting");

  // 3) 心跳：waiting 态查询 → ack waiting。
  device.send({ type: "pair_status_query", device_sid: deviceSid, client_ts: Date.now() });
  assert.equal((await device.next()).type, "pair_status_ack");

  // 4) matched 前的 data：无 terminal 可转发 → 对端不存在，静默（无帧）。
  device.send({ type: "data", payload: { zcode_type: "x" }, client_ts: Date.now() });

  // 5) terminal 鉴权（QR 里的 sid+hash）→ matched：terminal 收 auth_ack matched，
  //    device 主动收 pair_status_ack matched（≤心跳周期，这里即时）。
  const terminal = await connect(url);
  terminal.send({
    type: "auth_init",
    role: "terminal",
    device_sid: deviceSid,
    client_ts: Date.now(),
  });
  const terminalChallenge = await terminal.next();
  assert.equal(terminalChallenge.type, "auth_challenge");
  const terminalProof = computeProof({
    passHash,
    nonce: terminalChallenge.nonce as string,
    role: "terminal",
    deviceSid,
  });
  terminal.send({
    type: "auth_response",
    device_sid: deviceSid,
    proof: terminalProof,
    client_ts: Date.now(),
  });
  const terminalAuthAck = await terminal.next();
  assert.equal(terminalAuthAck.type, "auth_ack");
  assert.equal(terminalAuthAck.pair_status, "matched");
  assert.match(terminalAuthAck.terminal_sid as string, /^t_/);
  const matchedPush = await device.next();
  assert.equal(matchedPush.type, "pair_status_ack");
  assert.equal(matchedPush.pair_status, "matched");

  // 6) matched 态 query → ack matched（自建服务端语义：不产生 WRONG_PARAM 循环）。
  device.send({ type: "pair_status_query", device_sid: deviceSid, client_ts: Date.now() });
  const matchedQueryAck = await device.next();
  assert.deepEqual(matchedQueryAck, {
    type: "pair_status_ack",
    pair_status: "matched",
    server_ts: matchedQueryAck.server_ts,
  });

  // 7) 双向 data：device→terminal 与 terminal→device，均带 server_ts 盖章。
  device.send({
    type: "data",
    payload: { zcode_type: "bootstrap-request", requestId: "r1" },
    client_ts: Date.now(),
  });
  const toTerminal = await terminal.next();
  assert.equal(toTerminal.type, "data");
  assert.equal((toTerminal.payload as { zcode_type: string }).zcode_type, "bootstrap-request");
  assert.equal(typeof toTerminal.server_ts, "number");
  assert.equal(toTerminal.client_ts, toTerminal.client_ts as number, "client_ts 透传");

  terminal.send({
    type: "data",
    payload: { zcode_type: "rpc-frame", seq: 1 },
    client_ts: Date.now(),
  });
  const toDevice = await device.next();
  assert.equal(toDevice.type, "data");
  assert.equal((toDevice.payload as { zcode_type: string }).zcode_type, "rpc-frame");

  // 8) 缺 client_ts 的 data → 静默丢弃（对端收不到、无错误帧）。
  const receivedBeforeDrop = terminal.raw.length;
  device.send({ type: "data", payload: { zcode_type: "should-drop" } });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(terminal.raw.length, receivedBeforeDrop, "缺 client_ts 的帧必须被静默丢弃");
  // 9) matched 态 query → ack matched（官方桌面在 paired 下持续心跳，必须稳定应答）。
  device.send({ type: "pair_status_query", device_sid: deviceSid, client_ts: Date.now() });
  assert.equal((await device.next()).pair_status, "matched");

  // 10) 第二个 terminal 接管：旧 terminal 先收 KICKED，新 terminal matched。
  const oldTerminal = terminal;
  const kickedPromise = oldTerminal.next();
  const second = await connect(url);
  second.send({
    type: "auth_init",
    role: "terminal",
    device_sid: deviceSid,
    client_ts: Date.now(),
  });
  const secondChallenge = await second.next();
  const secondProof = computeProof({
    passHash,
    nonce: secondChallenge.nonce as string,
    role: "terminal",
    deviceSid,
  });
  second.send({
    type: "auth_response",
    device_sid: deviceSid,
    proof: secondProof,
    client_ts: Date.now(),
  });
  const secondAuthAck = await second.next();
  assert.equal(secondAuthAck.pair_status, "matched");
  const kickedFrame = await kickedPromise;
  assert.equal(kickedFrame.type, "error");
  assert.equal(kickedFrame.code, "KICKED");
  await oldTerminal.close();

  // 11) device 死亡 → terminal 收 DEVICE_OFFLINE（先于断开）。
  const offlinePromise = second.next();
  await device.close();
  const offlineFrame = await offlinePromise;
  assert.equal(offlineFrame.type, "error");
  assert.equal(offlineFrame.code, "DEVICE_OFFLINE");
  await second.close();

  // 12) 凭据持久化：服务重启（同 db 重建）后旧 sid 鉴权成功。
  await server.close();
  const registry2 = createDeviceRegistry({ storage: createFileDeviceRegistryStorage(db) });
  const server2 = createRelayServer({ registry: registry2, port: 0 });
  const port2 = await server2.listen();
  const url2 = `ws://127.0.0.1:${port2}/ws`;
  const device2 = await connect(url2);
  device2.send({ type: "auth_init", role: "device", device_sid: deviceSid, client_ts: Date.now() });
  const challenge2 = await device2.next();
  const proof2 = computeProof({
    passHash,
    nonce: challenge2.nonce as string,
    role: "device",
    deviceSid,
  });
  device2.send({
    type: "auth_response",
    device_sid: deviceSid,
    proof: proof2,
    client_ts: Date.now(),
  });
  assert.equal((await device2.next()).pair_status, "waiting", "重启后旧凭据鉴权成功");
  await device2.close();
  await server2.close();
});

test("错误面：未知 sid AUTH_FAILED / 坏 proof AUTH_FAILED / 未知类型 WRONG_PARAM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-err-"));
  tempDirs.push(dir);
  const registry = createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(join(dir, "db.json")),
  });
  const server = createRelayServer({ registry, port: 0 });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}/ws`;

  const c1 = await connect(url);
  c1.send({ type: "auth_init", role: "device", device_sid: "d_missing", client_ts: Date.now() });
  assert.equal((await c1.next()).code, "AUTH_FAILED");

  // 注册真凭据后用坏 proof 鉴权。
  const passHash = passHashOf("pw");
  c1.send({
    type: "device_register_init",
    device_mid: "m",
    pass_hash: passHash,
    client_ts: Date.now(),
  });
  const ack = await c1.next();
  const sid = ack.device_sid as string;
  c1.send({ type: "auth_init", role: "device", device_sid: sid, client_ts: Date.now() });
  await c1.next();
  c1.send({ type: "auth_response", device_sid: sid, proof: "bad", client_ts: Date.now() });
  assert.equal((await c1.next()).code, "AUTH_FAILED");

  c1.send({ type: "nonsense", client_ts: Date.now() });
  assert.equal((await c1.next()).code, "WRONG_PARAM");

  await c1.close();
  await server.close();
});

test("注册限速：超限连接被断开（1013）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-rl-"));
  tempDirs.push(dir);
  const registry = createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(join(dir, "db.json")),
  });
  const server = createRelayServer({ registry, port: 0, registerRatePerMinute: 3 });
  const port = await server.listen();

  // 同一 IP 连续注册超过限速：第 4 次（新连接同 IP）被断开。
  for (let i = 0; i < 3; i += 1) {
    const c = await connect(`ws://127.0.0.1:${port}/ws`);
    c.send({
      type: "device_register_init",
      device_mid: `m${i}`,
      pass_hash: "h",
      client_ts: Date.now(),
    });
    const ack = await c.next();
    assert.equal(ack.type, "device_register_ack");
    await c.close();
  }
  const limited = await connect(`ws://127.0.0.1:${port}/ws`);
  const closedCode = await new Promise<number>((resolve) => {
    limited.ws.once("close", (code) => resolve(code));
    limited.send({
      type: "device_register_init",
      device_mid: "m3",
      pass_hash: "h",
      client_ts: Date.now(),
    });
  });
  assert.equal(closedCode, 1013);
  await server.close();
});

test("自建手机页托管：/m/index.html 返回页面 HTML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-page-"));
  tempDirs.push(dir);
  const registry = createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(join(dir, "db.json")),
  });
  const server = createRelayServer({ registry, port: 0 });
  const port = await server.listen();
  const page = await fetch(`http://127.0.0.1:${port}/m/index.html`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("drora-page-request"), "页面必须使用共享页面协议帧");
  assert.ok(html.includes("computeProof"), "页面必须内嵌 HMAC proof 计算");
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  const missing = await fetch(`http://127.0.0.1:${port}/nope`);
  assert.equal(missing.status, 404);
  await server.close();
});
