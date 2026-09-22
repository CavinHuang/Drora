// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// helper broker 鉴权：一次性 token 的 timing-safe 比较。
import { createHash, timingSafeEqual } from "node:crypto";

export var BROKER_TOKEN_ENV = "ZCODE_CUA_PERMISSION_BROKER_TOKEN";
export function tokensMatch(expected, provided) {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  return timingSafeEqual(sha256(expected), sha256(provided));
}
export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest();
}
