// ZCode Relay Client · data 应用帧通道（relay 数据面上的 zcode_type 应用帧族）。
// 出站统一带 client_ts（真机取证：缺 client_ts 的裸帧被 WRONG_PARAM 拒收；有 type
// 缺 client_ts 被静默丢弃——desktopMobileRelayControl 取证注释），入站把 data.payload
// 分派给上层；requestId 关联的请求-响应助手覆盖 bootstrap/workspace-list 等回声协议。
import { MAX_PHYSICAL_FRAME_BYTES } from "./clock.js";
import type { RelayPayloadSendResult } from "./types.js";

/** 出站信封（线格式；type/client_ts 为 relay 线协议键，官方兼容键不 ZCode 化）。 */
export interface RelayDataEnvelope {
  type: "data";
  payload: Record<string, unknown>;
  client_ts: number;
}

interface AppFrameChannelOptions {
  now(): number;
  sendText(text: string): void;
  /** 物理帧硬上限（缺省 1MiB，官方 maxPhysicalFrameBytes）。 */
  maxFrameBytes?: number;
}

/**
 * 出站应用帧的最终信封字节计量（对齐官方 measureFrameBytes：以序列化后的
 * 完整 data 信封为准，而不是裸 payload）。
 */
export function measureAppFrameEnvelope(
  payload: Record<string, unknown>,
  clientTs: number,
): number {
  const envelope: RelayDataEnvelope = { type: "data", payload, client_ts: clientTs };
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

/** 应用帧通道：一个 relay 会话一个实例（会话销毁即失效）。 */
export class AppFrameChannel {
  private nextRequestId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve(payload: Record<string, unknown> | null): void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly maxFrameBytes: number;

  constructor(private readonly options: AppFrameChannelOptions) {
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_PHYSICAL_FRAME_BYTES;
  }

  /** 发送一条应用帧（不等待响应）。超上限返回 oversize；socket 未就绪返回 unavailable。 */
  send(payload: Record<string, unknown>): RelayPayloadSendResult {
    const clientTs = this.options.now();
    const bytes = measureAppFrameEnvelope(payload, clientTs);
    if (bytes > this.maxFrameBytes) {
      return { kind: "oversize", bytes, maxBytes: this.maxFrameBytes };
    }
    const envelope: RelayDataEnvelope = { type: "data", payload, client_ts: clientTs };
    this.options.sendText(JSON.stringify(envelope));
    return { kind: "sent", bytes };
  }

  /**
   * 请求-响应：payload 注入递增 requestId，桌面端回声同 requestId 的响应帧 resolve。
   * 超时不 reject 而是回 null（页面按各自失败面降级，对齐官方 sendPayload 语义）。
   */
  request(
    payload: Record<string, unknown>,
    timeoutMs: number,
    setTimeoutFn: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>,
  ): { requestId: string; response: Promise<Record<string, unknown> | null> } {
    const requestId = `mc_${++this.nextRequestId}_${this.options.now().toString(36)}`;
    const frame = { ...payload, requestId };
    return {
      requestId,
      response: new Promise((resolve) => {
        const entry: {
          resolve(p: Record<string, unknown> | null): void;
          timer?: ReturnType<typeof setTimeout>;
        } = { resolve };
        this.pending.set(requestId, entry);
        entry.timer = setTimeoutFn(() => {
          // 超时清理；迟到响应静默丢弃（桌面端不重试，页面自降级）。
          if (this.pending.get(requestId) === entry) this.pending.delete(requestId);
          resolve(null);
        }, timeoutMs);
        const sent = this.send(frame);
        if (sent.kind !== "sent") {
          if (entry.timer) clearTimeout(entry.timer);
          this.pending.delete(requestId);
          resolve(null);
        }
      }),
    };
  }

  /** 入站分派：先查 requestId 关联，未关联交 onFrame（含服务端主动推送）。 */
  acceptIncoming(payload: Record<string, unknown>): void {
    const requestId = payload.requestId;
    if (typeof requestId === "string") {
      const entry = this.pending.get(requestId);
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(requestId);
        entry.resolve(payload);
        return;
      }
    }
    this.onFrame?.(payload);
  }

  /** 上层入站分派钩子（服务端主动推送 / 未关联响应）。 */
  onFrame: ((payload: Record<string, unknown>) => void) | undefined;

  /** 会话销毁/重连清空：全部 pending 以 null 结算（重连后 requestId 失效）。 */
  failAllPending(): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(null);
    }
    this.pending.clear();
  }
}
