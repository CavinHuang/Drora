/**
 * 流式渐进播放器（specs/model-capabilities.md §16.3，Web Audio）：火山分片 base64 →
 * 帧边界缓冲（voiceMp3FrameBuffer）→ 攒批 decodeAudioData → AudioBufferSourceNode
 * 链顺序 schedule（nextStartTime 单调推进，接缝无缝）。
 *
 * 语义对齐整段路径（§16.3）：error 帧且从未播出任何音频 → completed("error")（句
 * error 进回落计数）；已播出后上游失败/EOF 缺 done → 宽容播完已收部分（"end"，与
 * 整段「收到过数据即播」一致）；interrupt() → 立即停 + "end"（cancelled 语义由
 * adapter settle 统一发，本层不区分）。
 *
 * deps 全注入（createContext/decodeAudio/minBatchBytes）：jsdom 无 Web Audio，
 * 测试注入 fake 全链可测；生产用缺省 AudioContext（autoplay 政策由 ctx.resume 兜底，
 * 与整段 HTMLAudioElement 路径同一权限环境）。
 */

import { extractCompleteMp3Frames } from "./voiceMp3FrameBuffer.js";

export interface StreamingPlaybackHandle {
  completed: Promise<"end" | "error">;
  /** 立即停止：停全部已 schedule 节点 + close context；completed 以 "end" 结算。 */
  interrupt(): void;
}

/** 最小播放形状（测试 fake 按此实现；不绑定 DOM 类型细节，结构兼容真 AudioContext）。 */
type ScheduledAudioBuffer = { duration: number };
type SchedulableSource = {
  buffer: ScheduledAudioBuffer | null;
  connect(destination: unknown): void;
  start(at: number): void;
  stop(): void;
  onended: (() => void) | null;
};
type PlaybackAudioContext = {
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<ScheduledAudioBuffer>;
  createBufferSource(): SchedulableSource;
};

export interface VoiceStreamingPlaybackDeps {
  /** 缺省 new AudioContext()；测试注入 fake（含 currentTime/createBufferSource/decodeAudioData）。 */
  createContext?: () => PlaybackAudioContext;
  /** 缺省 ctx.decodeAudioData 包装；测试注入 deterministic fake。 */
  decodeAudio?: (ctx: PlaybackAudioContext, bytes: ArrayBuffer) => Promise<ScheduledAudioBuffer>;
  /** 攒批阈值（字节），缺省 4KB ≈ 128kbps 下 ~250ms 音频；finish 时不足也 flush。 */
  minBatchBytes?: number;
}

function base64ToBytes(bodyBase64: string): Uint8Array {
  const binary = atob(bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createStreamingPlayback(deps: VoiceStreamingPlaybackDeps = {}): {
  /** 喂入一个上游 base64 音频分片（内部帧缓冲 + 攒批）。 */
  appendChunk(base64: string): void;
  /** 上游正常结束：flush 余量并等末节点播完。 */
  finish(): void;
  /** 上游失败：从未播出 → "error"；已播出 → 宽容播完已收（"end"）。 */
  fail(error: Error): void;
  /** 硬失败原语（§16 审查修复）：无条件停播 + settle("error")——seq 断号等 fail-closed 场景用。 */
  failNow(error: Error): void;
  handle: StreamingPlaybackHandle;
} {
  // §16 审查修复：缺省 ~4KB ≈ 128kbps 下 250ms（64KB 是 ~4s，首音延迟目标失效）。
  const minBatchBytes = deps.minBatchBytes ?? 4 * 1024;
  const createCtx =
    deps.createContext ??
    (() => new AudioContext() as unknown as PlaybackAudioContext);
  const decodeAudio =
    deps.decodeAudio ??
    ((ctx: PlaybackAudioContext, bytes: ArrayBuffer) => ctx.decodeAudioData(bytes));

  const ctx = createCtx();
  void ctx.resume().catch(() => undefined);

  let frameBuf: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let batch: Uint8Array[] = [];
  let batchBytes = 0;
  let nextStart = -1;
  let scheduled = 0;
  /** 解码在途批数（§16.3 审查修复：decode resolve 前不计入 scheduled，需独立计数防提前结算）。 */
  let inFlight = 0;
  let playedAny = false;
  let finished = false;
  let settled = false;
  let interrupted = false;
  let resolveCompleted: (outcome: "end" | "error") => void = () => {};
  const completed = new Promise<"end" | "error">((resolve) => {
    resolveCompleted = resolve;
  });
  const sources: SchedulableSource[] = [];

  /** 结算统一收尾：close ctx（生产释放音频栈；fake close 为 no-op spy）。 */
  const settle = (outcome: "end" | "error"): void => {
    if (!settled) {
      settled = true;
      resolveCompleted(outcome);
      void ctx.close().catch(() => undefined);
    }
  };

  /** 硬失败原语（§16 审查修复）：无条件停全部节点并结算 error——seq 断号/解码失败/
   * 上游致命错误走此路径（区别于宽容 interrupt="end"），保证回落计数不被归零。 */
  const hardFail = (_error: Error): void => {
    interrupted = true;
    for (const source of sources.splice(0)) {
      try {
        source.stop();
      } catch {
        // stop 异常忽略（结算统一 error）。
      }
      source.onended = null;
    }
    settle("error");
  };

  /** 全部在途工作（已 schedule 未播完 + 解码在途）是否清零。 */
  const allDrained = (): boolean => scheduled === 0 && inFlight === 0;

  const scheduleBatch = (bytes: Uint8Array): void => {
    if (bytes.length === 0) {
      return;
    }
    playedAny = true;
    inFlight += 1;
    void decodeAudio(ctx, bytes.slice().buffer as ArrayBuffer)
      .then((buffer: ScheduledAudioBuffer) => {
        inFlight -= 1;
        if (interrupted) {
          return;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const startAt = nextStart < 0 ? ctx.currentTime + 0.02 : Math.max(nextStart, ctx.currentTime + 0.02);
        nextStart = startAt + buffer.duration;
        scheduled += 1;
        sources.push(source);
        source.onended = () => {
          scheduled -= 1;
          // 已完播节点移出 sources（全域审查残留项：60s 硬闸上限下长句的包装对象
          // 只增不清，本体虽由 Web Audio 释放、包装仍滞留至句尾——播完即摘）。
          const idx = sources.indexOf(source);
          if (idx >= 0) sources.splice(idx, 1);
          // 全部节点播完 + 无解码在途 + 上游已结束 → end（interrupt 的结算在 interrupt 内完成）。
          if (finished && allDrained() && !interrupted) {
            settle("end");
          }
        };
        source.start(startAt);
        // flush 后零星到达的末批：finish 已设且解码返回时无别的在途 → 由 onended 结算；
        // 若末批时长为 0（fake 边界）也靠 onended 兜底——这里不再重复 settle。
        if (finished && !allDrained()) {
          void 0; // 等待 onended。
        }
      })
      .catch(() => {
        inFlight -= 1;
        // 解码失败 = 句 error（回落计数），fail-closed（硬失败，不受 interrupted 影响前的本帧失败）。
        if (!interrupted) {
          hardFail(new Error("audio decode failed"));
        }
      });
  };

  const flushBatch = (): void => {
    if (batch.length === 0) {
      return;
    }
    const merged = batch.reduce(concat, new Uint8Array());
    batch = [];
    batchBytes = 0;
    scheduleBatch(merged);
  };

  return {
    appendChunk(base64: string): void {
      if (interrupted || finished) {
        return;
      }
      const merged = concat(frameBuf, base64ToBytes(base64));
      const { frames, rest } = extractCompleteMp3Frames(merged);
      frameBuf = rest;
      for (const frame of frames) {
        batch.push(frame);
        batchBytes += frame.byteLength;
      }
      if (batchBytes >= minBatchBytes) {
        flushBatch();
      }
    },
    finish(): void {
      if (interrupted) {
        return;
      }
      finished = true;
      flushBatch();
      // §16.3 审查修复：解码在途（inFlight>0）不结算——等末批 onended/解码失败路径。
      if (inFlight > 0 || scheduled > 0) {
        return;
      }
      if (!playedAny) {
        // 上游 done 但无任何音频 → 空句按 error（与整段「无音频分片」语义一致）。
        settle("error");
        return;
      }
      settle("end");
    },
    fail(_error: Error): void {
      if (interrupted) {
        return;
      }
      if (!playedAny) {
        hardFail(_error);
        return;
      }
      // 已播出：宽容播完已收部分（整段路径「收到过数据即播」同款）。
      finished = true;
      flushBatch();
      if (allDrained()) {
        settle("end");
      }
    },
    failNow(error: Error): void {
      hardFail(error);
    },
    handle: {
      completed,
      /** 宽容中断：停全部节点 + "end"（cancelled 语义由 adapter 统一发）。 */
      interrupt(): void {
        if (interrupted) {
          return;
        }
        interrupted = true;
        for (const source of sources.splice(0)) {
          try {
            source.stop();
          } catch {
            // 已启动节点 stop 异常忽略（结算统一 end）。
          }
          source.onended = null;
        }
        settle("end");
      },
    },
  };
}
