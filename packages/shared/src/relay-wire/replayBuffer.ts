// relay 线协议·发送侧流控与重放缓冲（M4c，对齐官方 AcknowledgedRelayProtocol）。
//
// 取证：官方 chunk-C6VCYWB4.js 类体 @8551、常量表 @6729。官方语义：每条完整消息一个
// messageSeq；发送侧记录 {messageSeq→帧组, outerBytes, queuedAt}；收到
// rpc-frame-ack{ackMessageSeq} → releaseThrough 释放 ≤ack 的批次并减
// unacknowledgedByteCount；unacked 越过高水位置 saturated（宿主背压触发面），ack
// 回落到 ≤低水位置 drained；future-ack（ack > 已发最高 seq）→ enterDegraded（终态）；
// 缓冲超限 / 最旧未确认批次超过 grace → enterDegraded（终态）。
//
// spec D2/P2a 单一出处：水位常量（constants.ts）与本类原实现自
// packages/desktop/src/main/desktopMobileRelayProtocol.ts 收敛到本文件（desktop 保留
// re-export）；消费方 = desktop / relay-client / 移动页三方同源。
import {
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
} from "./constants.js";
import type { RpcTransportFrame } from "./rpcFrame.js";

/** 终态降级原因码（对齐官方 fault.reasonCode 字面量族）。 */
export const RELAY_REPLAY_DEGRADED_ACK_GRACE = "remote.rpcFrame.ackGraceExceeded";
export const RELAY_REPLAY_DEGRADED_FUTURE_ACK = "remote.rpcFrame.futureAck";
export const RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED = "remote.rpcFrame.replayBufferExceeded";
/**
 * 发送侧超限（官方 Q 的 sendFrame 取证 index.js@397000 附近）：出站物理帧超过
 * maxPhysicalFrameBytes 时官方显式抛 Error("remote.rpcFrame.envelopeTooLarge")，
 * 协议侧捕获 → enterDegraded 终态——不再静默丢帧（手机页 sendFrame 同款，
 * 托管页取证 @6084714）。
 */
export const RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE = "remote.rpcFrame.envelopeTooLarge";

/** 重放缓冲参数（缺省 = 官方常量；测试可注入缩短 graceMs / 缩小水位）。 */
export interface RelayReplayBufferOptions {
  highWaterMarkBytes?: number;
  lowWaterMarkBytes?: number;
  maxBytes?: number;
  graceMs?: number;
  /** 时间源（测试注入；默认 Date.now）。 */
  now?: () => number;
}

export interface RelayReplayReserveResult {
  /** 入队将使未确认字节超过缓冲上限：批次被拒（官方 replayBufferExceeded → enterDegraded）。 */
  overflow: boolean;
  /** 入队后的饱和状态（false→true 转变沿即官方 onSaturated 触发面）。 */
  saturated: boolean;
}

export interface RelayReplayAckResult {
  /** releaseThrough 释放的字节数；0 = 落后/重复 ack（官方 `ack<=lastAcked` 无操作）。 */
  releasedBytes: number;
  /** ack 超过已完整发送的最高 messageSeq（官方 futureAck → enterDegraded 终态）。 */
  futureAck: boolean;
  /** 本次 ack 使饱和回落到 ≤ 低水位（官方 onDrained 触发面）。 */
  drained: boolean;
}

interface RelayReplayBatch {
  messageSeq: number;
  outerBytes: number;
  frames: RpcTransportFrame[];
  queuedAt: number;
}

/**
 * 发送侧重放缓冲（纯逻辑，可独立单测）：官方 AcknowledgedRelayProtocol 的出站簿记
 * 子集。批次按 reserve 顺序保存（控制层保证 messageSeq 单调递增），ack 为累计确认
 * （releaseThrough 释放 ≤ack 的全部批次）。字节口径由调用方决定，控制层用出站
 * data 信封字节数（对齐官方 measureFrameBytes 计量最终信封）。
 */
export class RelayReplayBuffer {
  private readonly batches: RelayReplayBatch[] = [];
  private unacknowledgedByteCount = 0;
  private saturatedState = false;
  private highestFullySentMessageSeq = 0;
  private lastAckedMessageSeq = 0;
  /** 宽限期（ms）：控制层据此计算 grace 看门狗延迟。 */
  readonly graceMs: number;
  private readonly highWaterMarkBytes: number;
  private readonly lowWaterMarkBytes: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: RelayReplayBufferOptions = {}) {
    this.highWaterMarkBytes = options.highWaterMarkBytes ?? RELAY_SATURATION_HIGH_WATER_MARK_BYTES;
    this.lowWaterMarkBytes = options.lowWaterMarkBytes ?? RELAY_SATURATION_LOW_WATER_MARK_BYTES;
    this.maxBytes = options.maxBytes ?? RELAY_REPLAY_BUFFER_MAX_BYTES;
    this.graceMs = options.graceMs ?? RELAY_REPLAY_BUFFER_GRACE_MS;
    this.now = options.now ?? Date.now;
  }

  /** 未确认字节水位（官方 unacknowledgedBytes getter）。 */
  get unacknowledgedBytes(): number {
    return this.unacknowledgedByteCount;
  }

  /** 饱和状态（官方 saturated 字段；状态转变沿即 saturated/drained 事件）。 */
  get saturated(): boolean {
    return this.saturatedState;
  }

  /** 已完整发送的最高 messageSeq（future-ack 判定基准，官方 highestFullySentMessageSeq）。 */
  get highestSentMessageSeq(): number {
    return this.highestFullySentMessageSeq;
  }

  /**
   * 入队一个已发送批次并累计未确认字节。超上限时拒收（不累计、不保存）——官方
   * 在发送前检查并 enterDegraded(replayBufferExceeded)；本仓控制层为"发送后
   * reserve"顺序，据 overflow 标记走终态降级（批次已上线，但 ack 将被忽略）。
   */
  reserve(
    messageSeq: number,
    outerBytes: number,
    frames: RpcTransportFrame[],
  ): RelayReplayReserveResult {
    if (this.unacknowledgedByteCount + outerBytes > this.maxBytes) {
      return { overflow: true, saturated: this.saturatedState };
    }
    this.batches.push({ messageSeq, outerBytes, frames, queuedAt: this.now() });
    this.unacknowledgedByteCount += outerBytes;
    if (messageSeq > this.highestFullySentMessageSeq) {
      this.highestFullySentMessageSeq = messageSeq;
    }
    // 官方 updateSaturationAfterReserve：越过（>）高水位置饱和。
    if (!this.saturatedState && this.unacknowledgedByteCount > this.highWaterMarkBytes) {
      this.saturatedState = true;
    }
    return { overflow: false, saturated: this.saturatedState };
  }

  /** 累计确认（官方 processAck）：释放 ≤ackMessageSeq 的批次并减未确认水位。 */
  ack(ackMessageSeq: number): RelayReplayAckResult {
    // 落后/重复 ack：无操作（官方 `e<=lastAckedMessageSeq → return`）。
    if (ackMessageSeq <= this.lastAckedMessageSeq) {
      return { releasedBytes: 0, futureAck: false, drained: false };
    }
    // future-ack：ack 超过已完整发送的最高 seq → 终态降级标记（官方 futureAck）。
    if (ackMessageSeq > this.highestFullySentMessageSeq) {
      return { releasedBytes: 0, futureAck: true, drained: false };
    }
    let releasedBytes = 0;
    let releasedCount = 0;
    while (releasedCount < this.batches.length) {
      const batch = this.batches[releasedCount];
      if (!batch || batch.messageSeq > ackMessageSeq) break;
      releasedBytes += batch.outerBytes;
      releasedCount += 1;
    }
    if (releasedCount > 0) this.batches.splice(0, releasedCount);
    this.unacknowledgedByteCount = Math.max(0, this.unacknowledgedByteCount - releasedBytes);
    this.lastAckedMessageSeq = ackMessageSeq;
    // 官方 drained：饱和态回落到 ≤ 低水位时清饱和并触发事件。
    let drained = false;
    if (this.saturatedState && this.unacknowledgedByteCount <= this.lowWaterMarkBytes) {
      this.saturatedState = false;
      drained = true;
    }
    return { releasedBytes, futureAck: false, drained };
  }

  /** 全部未确认帧组（重连后重发的数据源；官方 resetReplay + flushPendingFrames）。 */
  replayFrames(): RpcTransportFrame[] {
    const frames: RpcTransportFrame[] = [];
    for (const batch of this.batches) {
      for (const frame of batch.frames) frames.push(frame);
    }
    return frames;
  }

  /** 最旧未确认批次的入队时刻；无批次返回 null（官方 deadline 的 oldestData）。 */
  oldestQueuedAt(): number | null {
    const oldest = this.batches[0];
    return oldest ? oldest.queuedAt : null;
  }

  /**
   * grace 超时判定（官方 deadline）：最旧未确认批次超过宽限期。官方判定式
   * `now > queuedAt+graceMs+1` 的 +1 是整数毫秒边界细节，与 `now > queuedAt+graceMs`
   * 语义等价。
   */
  graceExceeded(nowMs: number = this.now()): boolean {
    const oldest = this.batches[0];
    return oldest !== undefined && nowMs > oldest.queuedAt + this.graceMs;
  }

  /** 清空（终态降级 / 桥销毁）：水位与饱和态归零；终态后不再有 reserve/ack 进入。 */
  clear(): void {
    this.batches.length = 0;
    this.unacknowledgedByteCount = 0;
    this.saturatedState = false;
    this.highestFullySentMessageSeq = 0;
    this.lastAckedMessageSeq = 0;
  }
}

/** 官方 createAcknowledgedWebRemoteControlRelayProtocol 的缓冲构造入口（可注入参数）。 */
export function createRelayReplayBuffer(options?: RelayReplayBufferOptions): RelayReplayBuffer {
  return new RelayReplayBuffer(options);
}
