// Drora Relay Server · 线协议纯逻辑（无 IO，可独立单测）。
// 协议规范与官方对齐依据见 specs/mobile-web-remote.md M4 段（含原版证据索引）
// 与 specs/mobile-relay-server.md §3/§5。
// spec D2 同源化：跨包线协议纯逻辑（proof 构造、data 信封校验、transportId 字符集）
// 单一出处收敛到 @drora/shared 的 relay-wire 区；本文件保留 node:crypto 专属面
// （verifyProof 的常量时比较、sid/nonce 生成）并对既有消费者 re-export shared 出处。
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  TRANSPORT_ID_PATTERN,
  computeProof,
  isDataEnvelope,
  stampServerTs,
  type IncomingDataEnvelope,
  type RelayWireRole,
} from "@drora/shared";

export { TRANSPORT_ID_PATTERN, computeProof, isDataEnvelope, stampServerTs };
export type { IncomingDataEnvelope };

/** 单条 WS 消息硬上限（对齐官方 maxPhysicalFrameBytes=1MiB，取证 et 常量表）。 */
export const MAX_WS_PAYLOAD_BYTES = 1024 * 1024;

/** 注册限速（次/分钟/IP）与单 device_mid 存活 sid 上限。 */
export const REGISTER_RATE_PER_MINUTE = 10;
export const MAX_LIVE_SIDS_PER_DEVICE_MID = 8;

export type RelayRole = RelayWireRole;

export interface DeviceRecord {
  deviceSid: string;
  deviceMid: string;
  passHash: string;
  createdAt: number;
  lastSeenAt: number;
}

// computeProof 现出自 @drora/shared relay-wire（格式串单一出处 buildRelayProofMessage）。

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
