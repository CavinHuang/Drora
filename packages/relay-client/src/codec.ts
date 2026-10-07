// Drora Relay Client · 默认线编解码（浏览器/node 双端可用）。
// proof 与信封校验单一出处 = @drora/shared relay-wire（spec D2/P1 收口）；
// 本文件只是端口装配：parseFrame 宽松入站（非法帧返回 null 静默丢弃，对齐官方），
// serializeFrame 直出 JSON。terminal 角色的 proof 用纯 JS computeProof
// （纯 HTTP/非 secure context 下无 window.crypto.subtle，页内只能走纯 JS 实现）。
import { computeProof } from "@drora/shared";
import type { RelayWireFrame } from "./types.js";
import type { RelayWireCodecPort } from "./ports.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 入站帧宽松校验：type 是已知线帧之一且必备字段形状正确，否则 null。 */
export function parseRelayWireFrame(raw: string): RelayWireFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "auth_challenge":
      return typeof value.nonce === "string" ? (value as unknown as RelayWireFrame) : null;
    case "auth_ack":
      return isRecord(value) &&
        (value.pair_status === "waiting" || value.pair_status === "matched") &&
        typeof value.device_sid === "string" &&
        typeof value.terminal_sid === "string"
        ? (value as unknown as RelayWireFrame)
        : null;
    case "pair_status_ack":
      return isRecord(value) && (value.pair_status === "waiting" || value.pair_status === "matched")
        ? (value as unknown as RelayWireFrame)
        : null;
    case "data":
      return isRecord(value) && isRecord(value.payload) && typeof value.client_ts === "number"
        ? (value as unknown as RelayWireFrame)
        : null;
    case "error":
      return typeof value.code === "string" ? (value as unknown as RelayWireFrame) : null;
    default:
      return null;
  }
}

/** 默认编解码端口（生产装配缺省；测试可注入以捕获出站帧）。 */
export function createJsonWireCodec(): RelayWireCodecPort {
  return {
    computeProof(params) {
      return computeProof(params);
    },
    parseFrame(raw) {
      return parseRelayWireFrame(raw);
    },
    serializeFrame(frame) {
      return JSON.stringify(frame);
    },
  };
}
