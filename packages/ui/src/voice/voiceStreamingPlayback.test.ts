// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createStreamingPlayback, type VoiceStreamingPlaybackDeps } from "./voiceStreamingPlayback.js";
import { makeFrame } from "./voiceMp3FrameBuffer.test-utils.js";


/**
 * 流式渐进播放器契约（specs/model-capabilities.md §16.3，fake deps 全链）：
 * 分片喂入 → 帧切分攒批 → decodeAudioData 批次解码 → 顺序 schedule；完成/失败/
 * 中断语义对齐整段路径（error 无音频→error、有音频宽容播完→end、interrupt→end）。
 */

interface FakeSource {
  buffer: { duration: number } | null;
  startAt: number | null;
  stopped: boolean;
  duration: number;
  onended: (() => void) | null;
  fireEnded(): void;
}

function makeDeps(overrides?: Partial<VoiceStreamingPlaybackDeps> & {
  decodeDelayMs?: number;
  decodeReject?: boolean;
}) {
  let currentTime = 100;
  const sources: FakeSource[] = [];
  const decodedBatches: number[] = [];
  const ctx = {
    currentTime,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    decodeAudioData: (data: ArrayBuffer) => {
      if (overrides?.decodeReject) {
        return Promise.reject(new Error("decode failed"));
      }
      const bytes = data.byteLength;
      decodedBatches.push(bytes);
      const duration = bytes / 1000; // 确定性时长：1KB = 1s
      return Promise.resolve({ duration });
    },
    createBufferSource: () => {
      const src: FakeSource = {
        buffer: null,
        startAt: null,
        stopped: false,
        duration: 0,
        onended: null,
        fireEnded() {
          src.onended?.();
        },
      };
      Object.assign(src, {
        connect: () => undefined,
        start: (at: number) => {
          src.startAt = at;
        },
        stop: () => {
          src.stopped = true;
        },
      });
      sources.push(src);
      return src;
    },
  };
  const deps: VoiceStreamingPlaybackDeps = {
    // fake 形状与 PlaybackAudioContext 结构一致；跨文件类型未导出，用结构断言。
    createContext: () => ctx as never,
    minBatchBytes: overrides?.minBatchBytes,
    decodeAudio: overrides?.decodeAudio,
  };
  return { deps, sources, decodedBatches, ctx };
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("createStreamingPlayback（§16.3）", () => {
  it("分片喂入 → 帧切分攒批解码 → 顺序 schedule，finish 后播完结算 end", async () => {
    const { deps, sources, decodedBatches } = makeDeps({ minBatchBytes: 800 }); // > 单帧 417、< 两帧 834 → append 两帧后攒一批
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    // 两帧 = 834 字节 ≥ 阈值 → 攒成一批解码。
    player.appendChunk(b64(makeFrame()));
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1));
    expect(decodedBatches[0]).toBe(834);
    await vi.waitFor(() => expect(sources.length).toBe(1));
    // 单调推进：首节点 startAt = currentTime + 0.02。
    expect(sources[0]!.startAt).toBeCloseTo(100.02, 5);
    player.finish();
    sources[0]!.fireEnded();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("end"));
  });

  it("跨片帧（一片半帧）→ 尾巴留缓冲，补齐后正确切分", async () => {
    const { deps, decodedBatches } = makeDeps({ minBatchBytes: 10 });
    const player = createStreamingPlayback(deps);
    const frame = makeFrame();
    const half = 200;
    player.appendChunk(b64(frame.slice(0, half))); // 不足一帧 → 不解码
    player.appendChunk(b64(frame.slice(half))); // 补齐 → 解码一帧
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1));
    expect(decodedBatches[0]).toBe(frame.length);
  });

  it("error 帧且从未播出 → completed error（句 error 进回落计数）", async () => {
    const { deps } = makeDeps();
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.fail(new Error("upstream 401"));
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("error"));
  });

  it("已播出后上游失败 → 宽容播完已收部分结算 end", async () => {
    const { deps, sources, decodedBatches } = makeDeps({ minBatchBytes: 10 });
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1));
    player.fail(new Error("stream broken"));
    sources[0]!.fireEnded();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("end"));
  });

  it("interrupt → 立即停全部节点 + end（cancelled 语义由 adapter 统一发）", async () => {
    const { deps, sources, decodedBatches } = makeDeps({ minBatchBytes: 10 });
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1));
    player.handle.interrupt();
    expect(sources[0]!.stopped).toBe(true);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("end"));
    // interrupt 后再喂分片被忽略。
    player.appendChunk(b64(makeFrame()));
    expect(decodedBatches.length).toBe(1);
  });

  it("解码失败 → fail-closed 结算 error", async () => {
    const { deps } = makeDeps({ decodeReject: true, minBatchBytes: 10 });
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("error"));
  });

  it("finish 时解码在途 → 不提前结算，等末批 schedule+播完才 end（§16 审查修复叠播回归）", async () => {
    // decode 手动放行：append 一帧触发 flush（decode 发起后挂起）→ finish → 不得结算。
    let releaseDecode: () => void = () => {};
    const decodeGate = new Promise<{ duration: number }>((resolve) => {
      releaseDecode = () => resolve({ duration: 1 });
    });
    const { deps, sources, decodedBatches } = makeDeps({ minBatchBytes: 10 });
    deps.decodeAudio = (_ctx, bytes) => {
      decodedBatches.push(bytes.byteLength);
      return decodeGate;
    };
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1)); // decode 已发起（在途）
    player.finish();
    await new Promise((r) => setTimeout(r, 20));
    expect(outcome).not.toHaveBeenCalled(); // 解码在途：不结算（修复前此处提前 "end" → 叠播）
    releaseDecode();
    await vi.waitFor(() => expect(sources.length).toBe(1));
    sources[0]!.fireEnded();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("end"));
  });

  it("failNow（硬失败原语）→ 无条件停播 + settle error，即使已播出（§16 二审：断号 fail-closed 回归防线）", async () => {
    const { deps, sources, decodedBatches } = makeDeps({ minBatchBytes: 10 });
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.appendChunk(b64(makeFrame()));
    await vi.waitFor(() => expect(decodedBatches.length).toBe(1));
    player.failNow(new Error("voice vendor proxy stream out of order"));
    expect(sources[0]!.stopped).toBe(true);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("error"));
    // 结算后 append/finish 被忽略（不得改写已定的 error 结算）。
    player.appendChunk(b64(makeFrame()));
    player.finish();
    expect(decodedBatches.length).toBe(1);
    expect(outcome).toHaveBeenCalledWith("error");
  });

  it("finish 但无任何音频 → error（与整段「无音频分片」语义一致）", async () => {
    const { deps } = makeDeps();
    const player = createStreamingPlayback(deps);
    const outcome = vi.fn();
    void player.handle.completed.then(outcome);
    player.finish();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("error"));
  });
});
