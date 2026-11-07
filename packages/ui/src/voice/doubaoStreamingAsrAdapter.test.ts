// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createDoubaoStreamingAsrAdapter,
  type DoubaoAsrStreamPort,
} from "./doubaoStreamingAsrAdapter.js";
import type {
  VoiceAsrStreamStateFrame,
  VoiceAsrStreamTranscriptFrame,
} from "@drora/shared";

/**
 * §9.6.10 豆包流式适配器（fake 流端口 + fake PCM 抓取经 pcmDeps 注入）：
 * partial→预览 / definite→逐句 final / stop 尾句结算 / abort 清理 / 凭据 fail-closed。
 */

function makeStreamPort() {
  const transcripts = new Set<(frame: VoiceAsrStreamTranscriptFrame) => void>();
  const states = new Set<(frame: VoiceAsrStreamStateFrame) => void>();
  const sentAudio: Array<{ pcm: ArrayBuffer; isLast: boolean }> = [];
  const port: DoubaoAsrStreamPort = {
    start: vi.fn(async () => ({ streamId: "asr-1" })),
    sendAudio: (chunk) => sentAudio.push({ pcm: chunk.pcm, isLast: chunk.isLast }),
    onTranscript: (handler) => {
      transcripts.add(handler);
      return () => transcripts.delete(handler);
    },
    onState: (handler) => {
      states.add(handler);
      return () => states.delete(handler);
    },
    abort: vi.fn(async () => undefined),
  };
  return {
    port,
    sentAudio,
    emitTranscript: (frame: VoiceAsrStreamTranscriptFrame) => transcripts.forEach((cb) => cb(frame)),
    emitState: (frame: VoiceAsrStreamStateFrame) => states.forEach((cb) => cb(frame)),
  };
}

/** fake PCM 抓取：不抓真麦，块由测试手动驱动（onChunk 在 start 时被注册）。 */
function fakePcmDeps() {
  let chunkSink: ((chunk: ArrayBuffer) => void) | null = null;
  return {
    deps: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
      createAudioContext: vi.fn(() => ({ sampleRate: 48000, createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }), createScriptProcessor: () => ({ connect: () => undefined, disconnect: () => undefined, onaudioprocess: null }), createGain: () => ({ gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined }), destination: {}, close: async () => undefined }) as unknown as AudioContext),
    },
    captureHooks: {
      setSink: (sink: (chunk: ArrayBuffer) => void) => {
        chunkSink = sink;
      },
      emitChunk: (chunk: ArrayBuffer) => chunkSink?.(chunk),
    },
  };
}

const CONFIG = async () => ({
  baseUrl: "https://openspeech.bytedance.com",
  model: "volc.seedasr.sauc.duration",
  apiKey: "single-key-1",
});

describe("createDoubaoStreamingAsrAdapter（§9.6.10）", () => {
  it("凭据空 → start throw not-allowed（fail-closed 零出站）；复合旧形态不再要求冒号", async () => {
    const { port } = makeStreamPort();
    const adapter = createDoubaoStreamingAsrAdapter({
      stream: port,
      getVendorConfig: async () => ({ baseUrl: "https://openspeech.bytedance.com", model: "m", apiKey: "  " }),
    });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({ code: "not-allowed" });
    expect(port.start).not.toHaveBeenCalled();
  });

  it("流转：partial→onPartial；definite→onFinal 逐句；stop 尾句结算", async () => {
    const { port, emitTranscript } = makeStreamPort();
    const partials: string[] = [];
    const finals: string[] = [];
    const fake = fakePcmDeps();
    const adapter = createDoubaoStreamingAsrAdapter({
      stream: port,
      getVendorConfig: CONFIG,
      pcmDeps: fake.deps,
      stopSettleTimeoutMs: 5000,
    });
    adapter.onPartial((text) => partials.push(text));
    const session = await adapter.start({ lang: "zh-CN" });
    session.onFinal((text) => finals.push(text));
    emitTranscript({ streamId: "asr-1", text: "实时预", isFinal: false });
    emitTranscript({ streamId: "asr-1", text: "第一句。", isFinal: true });
    expect(partials).toEqual(["实时预"]);
    expect(finals).toEqual(["第一句。"]);
    // stop：尾句（stop 后到达的 final）进 stop resolve 的 final 而非再注入。
    const stopPromise = session.stop();
    emitTranscript({ streamId: "asr-1", text: "尾句。", isFinal: true });
    await expect(stopPromise).resolves.toEqual({ final: "第一句。 尾句。" });
    expect(finals).toEqual(["第一句。"]);
  });

  it("会话 error 状态 → onError(network)（§5.3 映射）", async () => {
    const { port, emitState } = makeStreamPort();
    const adapter = createDoubaoStreamingAsrAdapter({ stream: port, getVendorConfig: CONFIG, pcmDeps: fakePcmDeps().deps });
    const session = await adapter.start({ lang: "zh-CN" });
    const errors: string[] = [];
    session.onError((error) => errors.push(error.code));
    emitState({ streamId: "asr-1", status: "error", errorMessage: "quota" });
    expect(errors).toEqual(["network"]);
  });

  it("abort：断订阅/停抓取/上行 abort（幂等）", async () => {
    const { port, emitTranscript } = makeStreamPort();
    const adapter = createDoubaoStreamingAsrAdapter({ stream: port, getVendorConfig: CONFIG, pcmDeps: fakePcmDeps().deps });
    const session = await adapter.start({ lang: "zh-CN" });
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    session.abort();
    // abort 后到达的帧被忽略。
    emitTranscript({ streamId: "asr-1", text: "迟到句", isFinal: true });
    expect(finals).toEqual([]);
    expect(port.abort).toHaveBeenCalledWith({ streamId: "asr-1" });
  });

  it("modelId #duplex 后缀 → endpointMode duplex 透传", async () => {
    const { port } = makeStreamPort();
    const adapter = createDoubaoStreamingAsrAdapter({
      stream: port,
      getVendorConfig: async () => ({
        baseUrl: "https://openspeech.bytedance.com",
        model: "volc.seedasr.sauc.duration#duplex",
        apiKey: "single-key-1",
      }),
      pcmDeps: fakePcmDeps().deps,
    });
    await adapter.start({ lang: "zh-CN" });
    expect(port.start).toHaveBeenCalledWith(
      expect.objectContaining({ endpointMode: "duplex", resourceId: "volc.seedasr.sauc.duration" }),
    );
    port.abort
  });
});
