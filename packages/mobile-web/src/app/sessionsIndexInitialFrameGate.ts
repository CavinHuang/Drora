// 首页 sessions-index 订阅首帧闸门（specs/mobile-relay-r3-frontend.md §20）。
// CLI 允许 initial snapshot 早于 subscribe ACK；订阅归属只能在 ACK 后确定。
// 本模块仅暂存未认领 wire 候选，不保存业务摘要；实际解码/水位由 sessionsIndexStore 所有。

const DEFAULT_MAX_STAGED_WIRES = 1_024;
const DEFAULT_MAX_STAGED_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();

interface WireCandidate {
  kind?: unknown;
  topic?: unknown;
  subscriptionId?: unknown;
}

export interface InitialFrameGateOptions {
  topic: string;
  onOwnedFrame(candidate: unknown): void;
  maxStagedWires?: number;
  maxStagedBytes?: number;
}

export interface InitialFrameGate {
  accept(candidate: unknown): void;
  /** ACK 后认领暂存帧；null 表示曾超界，调用方应退订且不应用任何暂存帧。 */
  claim(subscriptionId: string): unknown[] | null;
  clear(): void;
}

function candidateBytes(candidate: unknown): number {
  try {
    const encoded = JSON.stringify(candidate);
    return encoded === undefined ? Number.POSITIVE_INFINITY : encoder.encode(encoded).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createInitialFrameGate(options: InitialFrameGateOptions): InitialFrameGate {
  const maxWires = options.maxStagedWires ?? DEFAULT_MAX_STAGED_WIRES;
  const maxBytes = options.maxStagedBytes ?? DEFAULT_MAX_STAGED_BYTES;
  let staged: unknown[] = [];
  let stagedBytes = 0;
  let overflowed = false;
  let activeSubscriptionId: string | null = null;

  return {
    accept(candidate): void {
      if (typeof candidate !== "object" || candidate === null) return;
      const wire = candidate as WireCandidate;
      if (wire.kind !== "complete" && wire.kind !== "fragment") return;
      if (wire.topic !== options.topic || typeof wire.subscriptionId !== "string") return;
      if (activeSubscriptionId !== null) {
        if (wire.subscriptionId === activeSubscriptionId) options.onOwnedFrame(candidate);
        return;
      }
      if (overflowed) return;
      const bytes = candidateBytes(candidate);
      if (staged.length + 1 > maxWires || bytes > maxBytes || stagedBytes + bytes > maxBytes) {
        // 修复依据：截断分片头部会把 snapshot 留成不可恢复的残帧；超界整批作废。
        staged = [];
        stagedBytes = 0;
        overflowed = true;
        return;
      }
      staged.push(candidate);
      stagedBytes += bytes;
    },
    claim(subscriptionId): unknown[] | null {
      if (overflowed) {
        staged = [];
        stagedBytes = 0;
        return null;
      }
      activeSubscriptionId = subscriptionId;
      const owned = staged.filter(
        (candidate) => (candidate as WireCandidate).subscriptionId === subscriptionId,
      );
      staged = [];
      stagedBytes = 0;
      return owned;
    },
    clear(): void {
      staged = [];
      stagedBytes = 0;
      overflowed = false;
      activeSubscriptionId = null;
    },
  };
}
