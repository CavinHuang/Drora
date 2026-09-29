// relay 线协议·rpc-frame 传输封装（M4b，对齐官方 encodeWebRemoteControlRpcTransportMessage /
// WebRemoteControlRpcTransportAssembler / frameShell，取证自官方 3.14.3 bundle，
// spec: mobile-web-remote.md M4b、mobile-relay-r3-frontend.md §8）。
//
// 线格式（每个物理帧一个 JSON 对象，经 relay data 帧透传）：
//   {zcode_type:"rpc-frame", bridgeSessionId, [bridgeGeneration], [recoveryId],
//    seq(物理序号), messageSeq, fragmentIndex, fragmentCount, messageBytes,
//    checksum:{algorithm:"crc32", value}, dataBase64(分片字节)}
// 确认帧：{zcode_type:"rpc-frame-ack", bridgeSessionId, [bridgeGeneration],
//   [recoveryId], ackMessageSeq}
// 限制（官方常量）：消息 ≤16MiB、分片 ≤64、dataBase64 ≤1MiB。
//
// spec D2/P2a 单一出处：原实现自 packages/desktop/src/main/desktopMobileRelayProtocol.ts
// 收敛到本文件（desktop 保留 re-export）；消费方 = desktop / relay-client / 移动页三方。
// 浏览器安全：Uint8Array + 纯 JS base64，无 node:crypto / Buffer 依赖。
import { base64ToBytes, bytesToBase64 } from "./base64.js";

export const RPC_FRAME_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const RPC_FRAME_MAX_FRAGMENTS = 64;
/** 单分片数据预算：base64 后 ~874KB + 封套 JSON 开销，稳居 1MiB 物理帧上限内。 */
export const RPC_FRAME_FRAGMENT_DATA_BYTES = 640 * 1024;

export interface RpcFrameIdentity {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
}

export interface RpcTransportFrame {
  zcode_type: "rpc-frame";
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  seq: number;
  messageSeq: number;
  fragmentIndex: number;
  fragmentCount: number;
  messageBytes: number;
  /** checksum.value 线格式：8 位小写 hex 字符串（出站）；入站兼容数值。 */
  checksum: { algorithm: "crc32"; value: string };
  dataBase64: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

/** IEEE crc32（与 node:crypto 无关的标准多项式 0xedb88320，反射入出）。 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * checksum.value 线格式为 8 位小写十六进制字符串（官方/手机端组装器以
 * /^[0-9a-f]{8}$/ 校验，数字会被判 proto.frameAssemblyMetadataMismatch 丢弃，
 * 2026-09-27 真机取证）；内部比较统一用数值。
 */
export function crc32ToWire(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** 入站 checksum.value 兼容数值与 8 位 hex 字符串两种线格式。 */
export function checksumValueFromWire(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9a-f]{8}$/.test(value)) return parseInt(value, 16);
  return null;
}

export function identityFields(identity: RpcFrameIdentity): Record<string, unknown> {
  return {
    bridgeSessionId: identity.bridgeSessionId,
    ...(identity.bridgeGeneration !== undefined
      ? { bridgeGeneration: identity.bridgeGeneration }
      : {}),
    ...(identity.recoveryId ? { recoveryId: identity.recoveryId } : {}),
  };
}

/**
 * 编码一条 rpc 消息为一个或多个物理帧（对齐官方 L3 编码器语义）。
 * 返回帧数组与推进后的物理序号。
 */
export function encodeRpcTransportMessage(params: {
  message: Uint8Array;
  identity: RpcFrameIdentity;
  firstPhysicalSeq: number;
  messageSeq: number;
}): { frames: RpcTransportFrame[]; nextPhysicalSeq: number; checksum: number } {
  const { message, identity, firstPhysicalSeq, messageSeq } = params;
  if (message.byteLength === 0) {
    throw new Error("remote.rpcFrame.emptyMessage");
  }
  if (message.byteLength > RPC_FRAME_MAX_MESSAGE_BYTES) {
    throw new Error("remote.rpcFrame.messageTooLarge");
  }
  const checksum = { algorithm: "crc32" as const, value: crc32ToWire(crc32(message)) };
  const fragmentCount = Math.max(1, Math.ceil(message.byteLength / RPC_FRAME_FRAGMENT_DATA_BYTES));
  if (fragmentCount > RPC_FRAME_MAX_FRAGMENTS) {
    throw new Error("remote.rpcFrame.fragmentLimitExceeded");
  }
  const frames: RpcTransportFrame[] = [];
  for (let index = 0; index < fragmentCount; index += 1) {
    const start = index * RPC_FRAME_FRAGMENT_DATA_BYTES;
    const end = Math.min(message.byteLength, start + RPC_FRAME_FRAGMENT_DATA_BYTES);
    const frame: RpcTransportFrame = {
      zcode_type: "rpc-frame",
      bridgeSessionId: identity.bridgeSessionId,
      ...(identity.bridgeGeneration !== undefined
        ? { bridgeGeneration: identity.bridgeGeneration }
        : {}),
      ...(identity.recoveryId ? { recoveryId: identity.recoveryId } : {}),
      seq: firstPhysicalSeq + index,
      messageSeq,
      fragmentIndex: index,
      fragmentCount,
      messageBytes: message.byteLength,
      checksum,
      dataBase64: bytesToBase64(message.subarray(start, end)),
    };
    frames.push(frame);
  }
  const checksumValue = crc32(message);
  return { frames, nextPhysicalSeq: firstPhysicalSeq + fragmentCount, checksum: checksumValue };
}

/** rpc-frame-ack 确认帧（每条完整消息都必须回执，否则对端流控降级）。 */
export function buildRpcFrameAck(params: {
  identity: RpcFrameIdentity;
  ackMessageSeq: number;
}): Record<string, unknown> {
  return {
    zcode_type: "rpc-frame-ack",
    ...identityFields(params.identity),
    ackMessageSeq: params.ackMessageSeq,
  };
}

/** 入站 rpc-frame 帧的运行时校验（形状级；语义校验在 Assembler）。 */
export function parseRpcTransportFrame(value: unknown): RpcTransportFrame | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.zcode_type !== "rpc-frame") return null;
  if (typeof record.bridgeSessionId !== "string") return null;
  if (record.bridgeGeneration !== undefined && typeof record.bridgeGeneration !== "number")
    return null;
  if (record.recoveryId !== undefined && typeof record.recoveryId !== "string") return null;
  if (typeof record.seq !== "number" || typeof record.messageSeq !== "number") return null;
  if (
    typeof record.fragmentIndex !== "number" ||
    typeof record.fragmentCount !== "number" ||
    typeof record.messageBytes !== "number"
  ) {
    return null;
  }
  const checksum = record.checksum as { algorithm?: unknown; value?: unknown } | undefined;
  if (
    !checksum ||
    checksum.algorithm !== "crc32" ||
    // 入站兼容数值与 8 位 hex 字符串两种线格式（手机端发送侧为 hex 字符串）。
    checksumValueFromWire(checksum.value) === null ||
    typeof record.dataBase64 !== "string"
  ) {
    return null;
  }
  return record as unknown as RpcTransportFrame;
}

/**
 * 入站帧重组器（宽松版官方 Assembler：按 messageSeq 聚组分片）。
 * 完整消息返回 {message, messageSeq}；未齐或校验失败返回 null 并由调用方丢弃。
 */
export class RpcFrameAssembler {
  private readonly pending = new Map<number, Map<number, RpcTransportFrame>>();

  constructor(private readonly identity: RpcFrameIdentity) {}

  accept(frame: RpcTransportFrame): { message: Uint8Array; messageSeq: number } | null {
    if (frame.bridgeSessionId !== this.identity.bridgeSessionId) return null;
    if (frame.bridgeGeneration !== this.identity.bridgeGeneration) return null;
    if ((frame.recoveryId ?? undefined) !== (this.identity.recoveryId || undefined)) return null;
    if (frame.fragmentIndex >= frame.fragmentCount) return null;
    if (frame.messageBytes > RPC_FRAME_MAX_MESSAGE_BYTES) return null;
    if (frame.fragmentCount > RPC_FRAME_MAX_FRAGMENTS) return null;
    let group = this.pending.get(frame.messageSeq);
    if (!group) {
      group = new Map();
      this.pending.set(frame.messageSeq, group);
    }
    group.set(frame.fragmentIndex, frame);
    if (group.size < frame.fragmentCount) return null;
    this.pending.delete(frame.messageSeq);
    const assembled = new Uint8Array(frame.messageBytes);
    let offset = 0;
    const frameChecksum = checksumValueFromWire(frame.checksum.value);
    for (let index = 0; index < frame.fragmentCount; index += 1) {
      const piece = group.get(index);
      if (!piece) return null;
      if (
        piece.messageBytes !== frame.messageBytes ||
        checksumValueFromWire(piece.checksum.value) !== frameChecksum
      ) {
        return null;
      }
      const chunk = base64ToBytes(piece.dataBase64);
      if (offset + chunk.byteLength > assembled.byteLength) return null;
      assembled.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const message = assembled;
    if (message.byteLength !== frame.messageBytes) return null;
    if (frameChecksum === null || crc32(message) !== frameChecksum) return null;
    return { message, messageSeq: frame.messageSeq };
  }

  /** 丢弃某 messageSeq 的未齐分组（桥重建时清理）。 */
  drop(messageSeq: number): void {
    this.pending.delete(messageSeq);
  }

  clear(): void {
    this.pending.clear();
  }
}
