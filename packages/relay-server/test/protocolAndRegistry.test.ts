import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createDeviceRegistry, createFileDeviceRegistryStorage } from "../src/deviceRegistry.js";
import {
  computeProof,
  isDataEnvelope,
  makeDeviceSid,
  stampServerTs,
  verifyProof,
} from "../src/protocol.js";
import { createSessionStore } from "../src/sessionStore.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function tempDbPath() {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-"));
  tempDirs.push(dir);
  return join(dir, "devices.json");
}

test("proof 计算与校验（base64url 标准 + base64 兼容）", () => {
  const params = {
    passHash: "hash==",
    nonce: "nonce-1",
    role: "device" as const,
    deviceSid: "d_1",
  };
  const proof = computeProof(params);
  assert.equal(verifyProof({ ...params, proof }), true);
  // 客户端可能用标准 base64 编码同一 digest（+/ 字符）——服务端两种都接受。
  assert.equal(
    verifyProof({ ...params, proof: proof.replace(/-/g, "+").replace(/_/g, "/") }),
    true,
  );
  assert.equal(verifyProof({ ...params, proof: "bogus" }), false);
  assert.equal(
    verifyProof({ ...params, role: "terminal", proof }),
    false,
    "role 参与摘要，换 role 必须不匹配",
  );
});

test("sid/nonce 生成形状", () => {
  const sid = makeDeviceSid();
  assert.match(sid, /^d_[A-Za-z0-9_-]+$/);
  assert.notEqual(sid, makeDeviceSid());
});

test("data 信封校验与盖章", () => {
  assert.equal(isDataEnvelope({ type: "data", payload: { zcode_type: "x" }, client_ts: 1 }), true);
  assert.equal(isDataEnvelope({ type: "data", payload: {} }), false, "缺 client_ts");
  assert.equal(isDataEnvelope({ type: "data", client_ts: 1 }), false, "缺 payload");
  const stamped = stampServerTs({ type: "data", payload: { zcode_type: "x" }, client_ts: 1 }, 99);
  assert.deepEqual(stamped, {
    type: "data",
    payload: { zcode_type: "x" },
    client_ts: 1,
    server_ts: 99,
  });
});

test("registry：注册/查询/同 mid 淘汰最旧/持久化往返", async () => {
  const db = await tempDbPath();
  const registry = createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(db),
    maxLiveSidsPerDeviceMid: 2,
  });
  const first = await registry.register({ deviceMid: "mid-1", passHash: "h1", now: 100 });
  const second = await registry.register({ deviceMid: "mid-1", passHash: "h2", now: 200 });
  assert.notEqual(first.deviceSid, second.deviceSid);
  assert.ok(await registry.getBySid(first.deviceSid), "未超限前旧 sid 保留");

  const third = await registry.register({ deviceMid: "mid-1", passHash: "h3", now: 300 });
  assert.equal(await registry.getBySid(first.deviceSid), undefined, "超过上限淘汰最旧");
  assert.ok(await registry.getBySid(second.deviceSid));
  assert.ok(await registry.getBySid(third.deviceSid));

  registry.touch(second.deviceSid, 999);
  // 重新挂载同一文件：持久化往返。
  const reloaded = createDeviceRegistry({ storage: createFileDeviceRegistryStorage(db) });
  const record = await reloaded.getBySid(third.deviceSid);
  assert.ok(record);
  assert.equal(record.deviceMid, "mid-1");
  assert.equal(record.passHash, "h3");
  await rm(db, { force: true });
});

test("registry：空/损坏文件容错", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-relay-"));
  tempDirs.push(dir);
  const bad = join(dir, "bad.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(bad, "{not-json", "utf8");
  const registry = createDeviceRegistry({ storage: createFileDeviceRegistryStorage(bad) });
  assert.equal(await registry.getBySid("d_x"), undefined);
  const record = await registry.register({ deviceMid: "m", passHash: "h" });
  assert.ok(registry.getBySid(record.deviceSid));
  // 文件内容可读回（原子写不残留损坏状态）。
  const raw = JSON.parse(await readFile(bad, "utf8")) as unknown[];
  assert.equal(raw.length, 1);
});

test("sessionStore：waiting↔matched、踢旧顺序、迟到 close 不拆新挂载", () => {
  const store = createSessionStore();
  const device = { connectionId: 1, sid: "d_1" };

  assert.deepEqual(store.view("d_1").status, "waiting", "无会话默认 waiting");
  assert.deepEqual(store.attachDevice("d_1", device), {
    status: "waiting",
    kickedConnectionId: null,
    statusChanged: false,
  });

  // 第一个 terminal → matched（无踢除）。
  const firstAttach = store.attachTerminal("d_1", { connectionId: 2, sid: "t_1" });
  assert.deepEqual(firstAttach, {
    status: "matched",
    kickedConnectionId: null,
    kickedEndpoint: null,
    statusChanged: true,
  });
  assert.equal(store.peer("d_1", "terminal")?.connectionId, 1, "terminal 的 peer 是 device");
  assert.equal(store.self("d_1", "terminal")?.sid, "t_1");

  // 第二个 terminal → 踢旧（返回旧 endpoint），新端接管，状态仍 matched。
  const secondAttach = store.attachTerminal("d_1", { connectionId: 3, sid: "t_2" });
  assert.equal(secondAttach.kickedEndpoint?.connectionId, 2, "必须返回被踢旧 terminal");
  assert.equal(secondAttach.status, "matched");
  assert.equal(secondAttach.statusChanged, false);
  assert.equal(store.self("d_1", "terminal")?.connectionId, 3);

  // 被踢旧 terminal（connectionId 2）的迟到 close：不匹配现挂载 → 忽略，
  // 新 terminal（t_2）必须原封不动（多 terminal 接管竞态，真机实锤）。
  assert.deepEqual(store.detach("d_1", 2), {
    status: null,
    statusChanged: false,
    detachedRole: null,
  });
  assert.equal(store.self("d_1", "terminal")?.sid, "t_2");

  // 新 terminal 真正断开 → waiting（statusChanged，device 需要被通知）。
  const terminalDetach = store.detach("d_1", 3);
  assert.deepEqual(terminalDetach, {
    status: "waiting",
    statusChanged: true,
    detachedRole: "terminal",
  });

  // device 断开 → terminal 仍在（DEVICE_OFFLINE 由 server 层发送），双空才销毁。
  store.attachTerminal("d_1", { connectionId: 4, sid: "t_3" });
  store.detach("d_1", 1);
  assert.equal(store.self("d_1", "terminal")?.sid, "t_3", "device 掉线不应清 terminal");
  store.detach("d_1", 4);
  assert.deepEqual(store.view("d_1"), { device: null, terminal: null, status: "waiting" });
});
