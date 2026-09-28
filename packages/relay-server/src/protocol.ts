// Drora Relay Server · 线协议纯逻辑（无 IO，可独立单测）。
// 协议规范与官方对齐依据见 specs/mobile-web-remote.md M4 段（含原版证据索引）
// 与 specs/mobile-relay-server.md §3/§5。
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 单条 WS 消息硬上限（对齐官方 maxPhysicalFrameBytes=1MiB，取证 et 常量表）。 */
export const MAX_WS_PAYLOAD_BYTES = 1024 * 1024;

/** 注册限速（次/分钟/IP）与单 device_mid 存活 sid 上限。 */
export const REGISTER_RATE_PER_MINUTE = 10;
export const MAX_LIVE_SIDS_PER_DEVICE_MID = 8;

/** transportId（bridgeSessionId 等）字符集白名单（取证手机页 transportEnvelopeIdMaxChars schema）。 */
export const TRANSPORT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/u;

export type RelayRole = "device" | "terminal";

export interface DeviceRecord {
  deviceSid: string;
  deviceMid: string;
  passHash: string;
  createdAt: number;
  lastSeenAt: number;
}

/** proof = HMAC-SHA256(passHash, "<nonce>|<role>|<deviceSid>", base64url)。 */
export function computeProof(params: {
  passHash: string;
  nonce: string;
  role: RelayRole;
  deviceSid: string;
}): string {
  return createHmac("sha256", params.passHash)
    .update(`${params.nonce}|${params.role}|${params.deviceSid}`)
    .digest("base64url");
}

/**
 * proof 校验。base64url 为标准编码（桌面客户端发送形态）；同时接受标准 base64，
 * 兼容不同客户端编码器（服务器宁可在校验层宽松、保持错误码语义）。
 */
export function verifyProof(params: {
  passHash: string;
  nonce: string;
  role: RelayRole;
  deviceSid: string;
  proof: string;
}): boolean {
  const expected = computeProof(params);
  for (const candidate of [params.proof, params.proof.replace(/-/g, "+").replace(/_/g, "/")]) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function makeDeviceSid(): string {
  return `d_${randomBytes(16).toString("base64url")}`;
}

export function makeTerminalSid(): string {
  return `t_${randomBytes(12).toString("base64url")}`;
}

export function makeNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** 入站消息的运行时形状校验（协议级；业务校验在端侧）。 */
export interface IncomingDataEnvelope {
  type: "data";
  payload: Record<string, unknown>;
  client_ts: number;
}

export function isDataEnvelope(value: unknown): value is IncomingDataEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "data" &&
    typeof record.payload === "object" &&
    record.payload !== null &&
    typeof record.client_ts === "number"
  );
}

/** 转发前盖章：官方手机页入站信封含 server_ts（schema 取证），由服务端在转发时写入。 */
export function stampServerTs<T extends Record<string, unknown>>(
  envelope: T,
  ts: number,
): T & { server_ts: number } {
  return { ...envelope, server_ts: ts };
}
