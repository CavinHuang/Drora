// relay-wire 纯逻辑单测（spec D2：线协议收敛 shared，三方同源）。
// HMAC 对照 RFC 4231 标准向量 + node:crypto 权威实现交叉（对齐
// packages/relay-server/test/phonePageCrypto.test.ts 的既有方法学：具体向量值
// 以 node:crypto 锚定，避免凭记忆写错）；另覆盖 proof 格式串、data 信封校验、
// transportId 字符集与流控/重放常量值断言。
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  RELAY_PROOF_ROLES,
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
  TRANSPORT_ID_PATTERN,
  buildRelayProofMessage,
  bytesToBase64Url,
  computeProof,
  hmacSha256Bytes,
  isDataEnvelope,
  sha256Bytes,
  stampServerTs,
  utf8Bytes,
} from "../src/relay-wire/index.js";

function nodeHmacHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("SHA-256 空串（FIPS 180-4 标准摘要）", () => {
  assert.equal(
    toHex(sha256Bytes([])),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("SHA-256 与 node:crypto 交叉（含 >55 字节双块消息）", () => {
  for (const s of ["abc", "a".repeat(55), "b".repeat(56), "c".repeat(119), "d".repeat(120)]) {
    assert.equal(toHex(sha256Bytes(utf8Bytes(s))), createHash("sha256").update(s).digest("hex"));
  }
});

test('RFC 4231 用例 1：key=0x0b×20，data="Hi There"', () => {
  // 向量值以 node:crypto 锚定（RFC 4231 TC1 的权威复算）。
  const key = String.fromCharCode(0x0b).repeat(20);
  assert.equal(
    nodeHmacHex(key, "Hi There"),
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  );
  assert.equal(toHex(hmacSha256Bytes(key, "Hi There")), nodeHmacHex(key, "Hi There"));
});

test('RFC 4231 用例 2：key=Jefe，data="what do ya want for nothing?"', () => {
  const key = "Jefe";
  const data = "what do ya want for nothing?";
  assert.equal(
    nodeHmacHex(key, data),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
  assert.equal(toHex(hmacSha256Bytes(key, data)), nodeHmacHex(key, data));
});

test("RFC 4231 用例 6 形状：长 key（>64 字节，key 先摘要）", () => {
  const key = "a".repeat(131);
  const data = "Test Using Larger Than Block-Size Key - Hash Key First";
  assert.equal(toHex(hmacSha256Bytes(key, data)), nodeHmacHex(key, data));
});

test("utf8Bytes：多字节字符与 node Buffer UTF-8 一致", () => {
  for (const s of ["中文nonce✓", "emoji🀄x", "plainascii"]) {
    assert.deepEqual(utf8Bytes(s), Array.from(Buffer.from(s, "utf-8")));
  }
});

test("bytesToBase64Url：无 padding，与 node base64url 逐字节一致", () => {
  for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
    const bytes = Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256);
    assert.equal(bytesToBase64Url(bytes), Buffer.from(bytes).toString("base64url"));
  }
});

test('buildRelayProofMessage：格式串 "<nonce>|<role>|<device_sid>"', () => {
  assert.equal(
    buildRelayProofMessage({ nonce: "n", role: "terminal", deviceSid: "d_1" }),
    "n|terminal|d_1",
  );
  assert.equal(
    buildRelayProofMessage({ nonce: "a|b", role: "device", deviceSid: "d_x" }),
    "a|b|device|d_x",
  );
});

test("RELAY_PROOF_ROLES：官方角色字面量族（线协议兼容键）", () => {
  assert.deepEqual([...RELAY_PROOF_ROLES], ["device", "terminal"]);
});

test("computeProof：与 node:crypto HMAC（同格式串）交叉一致（含中文与长输入）", () => {
  const cases = [
    {
      passHash: "R3el8LhN54Hl5u2PTyKuFKyfIM0dnmKuM4J7P33AUw4=",
      nonce: "n0nce",
      role: "device",
      deviceSid: "d_abc",
    },
    { passHash: "abc+123==", nonce: "中文nonce✓", role: "terminal", deviceSid: "d_中文" },
    {
      passHash: "x".repeat(80),
      nonce: "FhFyGFqsPJMIVPhLNxAVjg",
      role: "terminal",
      deviceSid: "d_DGH5Qp6fJfGrxMECQs3rsg",
    },
  ];
  for (const c of cases) {
    const proof = computeProof(c);
    assert.match(proof, /^[0-9a-zA-Z_-]+$/);
    assert.equal(
      proof,
      createHmac("sha256", c.passHash).update(buildRelayProofMessage(c)).digest("base64url"),
    );
  }
});

test("isDataEnvelope：接受/拒绝矩阵（对齐服务端既有语义）", () => {
  assert.equal(isDataEnvelope({ type: "data", payload: { zcode_type: "x" }, client_ts: 1 }), true);
  assert.equal(isDataEnvelope({ type: "data", payload: {} }), false, "缺 client_ts");
  assert.equal(isDataEnvelope({ type: "data", client_ts: 1 }), false, "缺 payload");
  assert.equal(
    isDataEnvelope({ type: "data", payload: null, client_ts: 1 }),
    false,
    "payload null",
  );
  assert.equal(isDataEnvelope({ type: "other", payload: {}, client_ts: 1 }), false, "type 不符");
  assert.equal(isDataEnvelope(null), false);
  assert.equal(isDataEnvelope("data"), false);
});

test("stampServerTs：不改入参，追加 server_ts", () => {
  const envelope = { type: "data", payload: { zcode_type: "x" }, client_ts: 1 };
  const stamped = stampServerTs(envelope, 99);
  assert.deepEqual(stamped, {
    type: "data",
    payload: { zcode_type: "x" },
    client_ts: 1,
    server_ts: 99,
  });
  assert.deepEqual(envelope, { type: "data", payload: { zcode_type: "x" }, client_ts: 1 });
});

test("TRANSPORT_ID_PATTERN：bridgeSessionId 字符集 [A-Za-z0-9._~-]{1,64}", () => {
  assert.equal(TRANSPORT_ID_PATTERN.test("b-ab_c.d~1"), true);
  assert.equal(TRANSPORT_ID_PATTERN.test("a".repeat(64)), true, "64 位上界");
  assert.equal(TRANSPORT_ID_PATTERN.test("a".repeat(65)), false, "65 位越界");
  assert.equal(TRANSPORT_ID_PATTERN.test(""), false, "空串");
  assert.equal(TRANSPORT_ID_PATTERN.test("含中文"), false);
  assert.equal(TRANSPORT_ID_PATTERN.test("space inside"), false);
  assert.equal(TRANSPORT_ID_PATTERN.test("slash/inside"), false);
});

test("流控/重放常量：对齐官方常量值（1MiB/256KiB/8MiB/45s）", () => {
  assert.equal(RELAY_SATURATION_HIGH_WATER_MARK_BYTES, 1024 * 1024);
  assert.equal(RELAY_SATURATION_LOW_WATER_MARK_BYTES, 256 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_GRACE_MS, 45_000);
});
