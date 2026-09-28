import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { PHONE_PAGE_CRYPTO_JS } from "../src/phonePage.js";

// 页面内联加密 JS 在 node 中执行（同一份代码），对照 node:crypto 与 RFC 4231 向量。
const factory = new Function(
  `${PHONE_PAGE_CRYPTO_JS}
return { __strBytes, __sha256Bytes, __hmacSha256Bytes, __bytesB64url, computeProof };`,
);
const pageCrypto = factory();

function nodeHmacB64url(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("base64url");
}

test("SHA-256 空串（标准摘要 e3b0c442…）", () => {
  const digest = pageCrypto
    .__sha256Bytes([])
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("RFC 4231 用例 2 形状：key=Jefe（与 node:crypto 交叉对照）", () => {
  const key = "Jefe";
  const data = "what do ya wanna know for free?";
  const page = pageCrypto
    .__hmacSha256Bytes(key, data)
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");
  const node = createHmac("sha256", key).update(data).digest("hex");
  assert.equal(page, node);
  // 64 位十六进制摘要（具体值由 node:crypto 这一权威实现锚定，避免凭记忆写错向量）。
  assert.match(page, /^[0-9a-f]{64}$/);
});

test("RFC 4231 用例 6 形状：长 key（>64 字节，需 key 分块预处理）", () => {
  const key = "a".repeat(131);
  const data = "Test Using Larger Than Block-Size Key - Hash Key First";
  const page = pageCrypto
    .__hmacSha256Bytes(key, data)
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");
  const node = createHmac("sha256", key).update(data).digest("hex");
  assert.equal(page, node);
  assert.match(page, /^[0-9a-f]{64}$/);
});

test("computeProof 与服务端 verifyProof 交叉一致（含中文与长输入）", () => {
  const cases = [
    {
      passHash: "R3el8LhN54Hl5u2PTyKuFKyfIM0dnmKuM4J7P33AUw4=",
      nonce: "n0nce",
      deviceSid: "d_abc",
    },
    { passHash: "abc+123==", nonce: "中文nonce✓", deviceSid: "d_中文" },
    {
      passHash: "x".repeat(80),
      nonce: "FhFyGFqsPJMIVPhLNxAVjg",
      deviceSid: "d_DGH5Qp6fJfGrxMECQs3rsg",
    },
  ];
  for (const c of cases) {
    const proof = pageCrypto.computeProof(c.passHash, c.nonce, c.deviceSid);
    assert.match(proof, /^[0-9a-zA-Z_-]+$/);
    const nodeExpected = nodeHmacB64url(c.passHash, `${c.nonce}|terminal|${c.deviceSid}`);
    assert.equal(proof, nodeExpected, "页面 proof 必须等于 node HMAC");
  }
});
