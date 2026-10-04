// relay 线协议·proof 构造（挑战应答鉴权，spec: mobile-relay-server.md §3）：
//   proof = HMAC-SHA256(passHash, "<nonce>|<role>|<device_sid>", base64url)
// 格式串单一出处 = buildRelayProofMessage。三方现格式核对结论（2026-09-29 逐字比对）：
//   - desktop calculateRelayProof（desktopMobileRelayProtocol.ts）："${nonce}|${role}|${sessionId}"
//   - relay-server computeProof（protocol.ts）："${nonce}|${role}|${deviceSid}"
//   - R2 页内嵌 computeProof（phonePage.ts PHONE_PAGE_CRYPTO_JS）：nonce + "|terminal|" + deviceSid
//   三者拼接规则一致（role 参数化 vs 页面硬编码 "terminal" 是调用差异不是格式差异），
//   与官方 createNodeWebRemoteControlRelayAuthProvider 的线格式一致。
// 本文件为纯 JS 实现（浏览器可用）；node 侧可用 createHmac 走快路径，但消息必须经
// buildRelayProofMessage 构造（desktop 即此用法）。
import { bytesToBase64Url, hmacSha256Bytes } from "./hmacSha256.js";

/** proof 消息里的 role 字面量族（auth_init{role} 线协议字段，官方兼容键，保持原名不 Drora 化）。 */
export const RELAY_PROOF_ROLES = ["device", "terminal"] as const;

export type RelayWireRole = (typeof RELAY_PROOF_ROLES)[number];

export interface RelayProofParams {
  /** 设备口令的 SHA-256 base64 摘要（注册时上送一次，之后只参与本地 HMAC）。 */
  passHash: string;
  /** 服务端 challenge 下发的一次性 nonce。 */
  nonce: string;
  /** 接入角色：device（桌面）或 terminal（手机）。 */
  role: string;
  /** 鉴权会话 id（device 角色即 device_sid）。 */
  deviceSid: string;
}

/** proof 消息精确拼接格式（单一出处，禁止调用方手写拼接）。 */
export function buildRelayProofMessage(params: {
  nonce: string;
  role: string;
  deviceSid: string;
}): string {
  return `${params.nonce}|${params.role}|${params.deviceSid}`;
}

/** proof = HMAC-SHA256(passHash, "<nonce>|<role>|<device_sid>", base64url)（纯 JS，浏览器可用）。 */
export function computeProof(params: RelayProofParams): string {
  return bytesToBase64Url(hmacSha256Bytes(params.passHash, buildRelayProofMessage(params)));
}
