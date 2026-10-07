// Drora Relay Client · rpc-frame 通道（桥内 v4 RPC 传输，M4b/M4c 手机端镜像）。
// 语义与桌面 desktopMobileRelayProtocol/desktopMobileRelayControl 逐项对齐：
// - 发送：encodeRpcTransportMessage（shared 单一出处）分片 + messageSeq 单调递增，
//   发送后 reserve 重放缓冲（字节口径 = 出站 data 信封，对齐官方 measureFrameBytes）；
//   饱和沿/排空沿回调宿主。
// - 接收：组装器按 messageSeq 聚组，完整消息回 ack（桌面流控依赖）后上抛。
// - 入站 ack：RelayReplayBuffer.ack（releaseThrough 语义）；future-ack → 终态降级；
//   最旧未确认批次超 grace → 终态降级（看门狗由 session 挂载）。
// - 终态降级（degraded）：所有后续帧静默丢弃（对齐官方 acceptPayload degraded 早退），
//   桥重建前不可恢复——桌面同款。
import {
  RELAY_REPLAY_DEGRADED_ACK_GRACE,
  RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED,
  RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE,
  RELAY_REPLAY_DEGRADED_FUTURE_ACK,
  RelayReplayBuffer,
  RpcFrameAssembler,
  buildRpcFrameAck,
  encodeRpcTransportMessage,
  parseRpcTransportFrame,
  type RpcFrameIdentity,
  type RpcTransportFrame,
} from "@drora/shared";
import { MAX_PHYSICAL_FRAME_BYTES } from "./clock.js";

export interface RpcFrameChannelOptions {
  identity: RpcFrameIdentity;
  /** data 应用帧出站口（rpc-frame 物理帧作为 zcode_type:"rpc-frame" 应用帧上线）。 */
  sendAppFrame(payload: Record<string, unknown>): void;
  /** data 信封字节计量（重放缓冲与物理帧上限口径，见 appFrameChannel.measureAppFrameEnvelope）。 */
  measureEnvelopeBytes(payload: Record<string, unknown>): number;
  now(): number;
  /** 首个物理序号（桥生命周期内单调；重连重放沿用既有计数，官方 seq 不回退）。 */
  firstPhysicalSeq?: number;
  /** 重放缓冲参数（缺省官方常量；测试注入）。 */
  replay?: ConstructorParameters<typeof RelayReplayBuffer>[0];
  /** 单条物理 WS 消息上限（缺省 1MiB，官方 maxPhysicalFrameBytes）。 */
  maxEnvelopeBytes?: number;
}

/** 完整消息入站交货（已重组+校验，字节为 ChannelClient 序列化流）。 */
export type RpcMessageHandler = (message: Uint8Array, messageSeq: number) => void;

/** 降级/饱和观察面（页面据此渲染队列状态与终态卡）。 */
export interface RpcFrameChannelEvents {
  onDegraded?(reasonCode: string): void;
  onSaturationChange?(saturated: boolean): void;
  /** 每次重放缓冲进出后回调（最旧未确认批次入队时刻；null = 解除 grace 看门狗）。 */
  onGraceDeadline?(oldestQueuedAtMs: number | null): void;
}

/**
 * rpc-frame 通道实例：一次 workspace-bridge-open 一个。桥重建（重开）时丢弃重建，
 * 不跨桥复用（identity 含 recoveryId/bridgeGeneration，官方语义）。
 */
export class RpcFrameChannel {
  private readonly replay: RelayReplayBuffer;
  private readonly assembler: RpcFrameAssembler;
  private physicalSeq: number;
  private messageSeq = 0;
  private degradedState: string | null = null;
  private readonly maxEnvelopeBytes: number;

  constructor(
    private readonly options: RpcFrameChannelOptions,
    private readonly events: RpcFrameChannelEvents = {},
  ) {
    this.replay = new RelayReplayBuffer({ ...options.replay, now: options.now });
    this.assembler = new RpcFrameAssembler(options.identity);
    this.physicalSeq = options.firstPhysicalSeq ?? 0;
    this.maxEnvelopeBytes = options.maxEnvelopeBytes ?? MAX_PHYSICAL_FRAME_BYTES;
  }

  get identity(): RpcFrameIdentity {
    return this.options.identity;
  }

  get degraded(): string | null {
    return this.degradedState;
  }

  get unacknowledgedBytes(): number {
    return this.replay.unacknowledgedBytes;
  }

  get saturated(): boolean {
    return this.replay.saturated;
  }

  get graceMs(): number {
    return this.replay.graceMs;
  }

  /**
   * 发送一条完整 rpc 消息。返回是否上线（degraded/编码超限/缓冲溢出均不上线，
   * 对齐官方 sendPayload 判别；envelopeTooLarge/replayBufferExceeded → 终态降级）。
   */
  send(message: Uint8Array): boolean {
    if (this.degradedState) return false;
    let frames: RpcTransportFrame[];
    try {
      ({ frames } = encodeRpcTransportMessage({
        message,
        identity: this.options.identity,
        firstPhysicalSeq: this.physicalSeq,
        messageSeq: this.messageSeq + 1,
      }));
    } catch {
      // 官方 sendFrame 抛 envelopeTooLarge → enterDegraded 终态（不再静默丢帧）。
      this.enterDegraded(RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE);
      return false;
    }
    // 水位口径 = 全部物理帧信封字节求和（P1-3 修复：与 desktop
    // desktopMobileRelayControl `outerBytes += dispatched.bytes` @777 同式；官方
    // measureFrameBytes 以最终信封计量，多分片消息按批累计记账——取 Math.max 会
    // 少记分片字节，grace 看门狗与饱和水位随之失真）。单帧超限仍按帧判定（官方
    // sendFrame 逐物理帧上限，640KiB 分片预算 + 封套开销稳居 1MiB 内）。
    let outerBytes = 0;
    for (const frame of frames) {
      const frameBytes = this.options.measureEnvelopeBytes(
        frame as unknown as Record<string, unknown>,
      );
      if (frameBytes > this.maxEnvelopeBytes) {
        this.enterDegraded(RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE);
        return false;
      }
      outerBytes += frameBytes;
    }
    this.messageSeq += 1;
    for (const frame of frames) {
      this.options.sendAppFrame(frame as unknown as Record<string, unknown>);
    }
    this.physicalSeq += frames.length;
    const reserved = this.replay.reserve(this.messageSeq, outerBytes, frames);
    if (reserved.overflow) {
      // 批次已上线但缓冲拒收：官方在发送前检查，本仓为发送后 reserve（桌面同款顺序），
      // ack 将被忽略 → 终态降级。
      this.enterDegraded(RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED);
      return false;
    }
    if (reserved.saturated) this.events.onSaturationChange?.(true);
    this.emitGraceDeadline();
    return true;
  }

  /**
   * 入站 rpc-frame：组装 → 完整消息回 ack → 上抛。degraded 时静默丢弃
   * （官方 acceptPayload degraded 早退）。
   */
  acceptFrame(payload: unknown): void {
    if (this.degradedState) return;
    const frame = parseRpcTransportFrame(payload);
    if (!frame) return;
    const assembled = this.assembler.accept(frame);
    if (!assembled) return;
    this.options.sendAppFrame(
      buildRpcFrameAck({ identity: this.options.identity, ackMessageSeq: assembled.messageSeq }),
    );
    this.onMessage?.(assembled.message, assembled.messageSeq);
  }

  /** 入站 rpc-frame-ack（桌面对我方出站的累计确认）：releaseThrough + 饱和回落。 */
  acceptAck(payload: Record<string, unknown>): void {
    if (this.degradedState) return;
    const ackMessageSeq = payload.ackMessageSeq;
    if (typeof ackMessageSeq !== "number" || !Number.isSafeInteger(ackMessageSeq)) return;
    const result = this.replay.ack(ackMessageSeq);
    if (result.futureAck) {
      this.enterDegraded(RELAY_REPLAY_DEGRADED_FUTURE_ACK);
      return;
    }
    if (result.drained) this.events.onSaturationChange?.(false);
    this.emitGraceDeadline();
  }

  /** 最旧未确认批次入队时刻（grace 看门狗数据源；无批次 = null 解除）。 */
  oldestQueuedAt(): number | null {
    return this.replay.oldestQueuedAt();
  }

  graceExceeded(nowMs?: number): boolean {
    return this.replay.graceExceeded(nowMs);
  }

  /**
   * ack-grace 终态降级（P1-2）：宿主看门狗（RelayClient 按 onGraceDeadline 挂载，
   * 桌面 armBridgeGraceTimer 同语义）到点复核 graceExceeded 成立后调用。
   */
  degradeAckGrace(): void {
    this.enterDegraded(RELAY_REPLAY_DEGRADED_ACK_GRACE);
  }

  /** 设备重连/重新配对后的重放：全量重发未确认帧（不重新 reserve，桌面 onSendReady 同款）。 */
  replayUnacknowledged(): number {
    if (this.degradedState) return 0;
    const frames = this.replay.replayFrames();
    for (const frame of frames) {
      this.options.sendAppFrame(frame as unknown as Record<string, unknown>);
    }
    return frames.length;
  }

  /** 完整消息入站交货钩子（协议适配层消费）。 */
  onMessage: RpcMessageHandler | undefined;

  /** 桥销毁：清缓冲与未齐分组（终态后不再有进出）。 */
  dispose(): void {
    this.replay.clear();
    this.assembler.clear();
  }

  /** 终态降级（桥销毁前不可恢复；与桌面 enterBridgeDegraded 同语义）。 */
  private enterDegraded(reasonCode: string): void {
    if (this.degradedState) return;
    this.degradedState = reasonCode;
    this.events.onDegraded?.(reasonCode);
  }

  private emitGraceDeadline(): void {
    this.events.onGraceDeadline?.(this.oldestQueuedAt());
  }
}
