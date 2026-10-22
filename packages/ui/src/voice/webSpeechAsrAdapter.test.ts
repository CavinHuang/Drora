import { describe, expect, it } from "vitest";
import {
  createWebSpeechAsrAdapter,
  type WebSpeechRecognitionAlternativeLike,
  type WebSpeechRecognitionErrorEventLike,
  type WebSpeechRecognitionEventLike,
  type WebSpeechRecognitionLike,
  type WebSpeechRecognitionResultLike,
} from "./webSpeechAsrAdapter.js";
import { VoiceAsrError, type VoiceAsrSession } from "./voiceAsrPort.js";
import { VOICE_ASR_STOP_SETTLE_TIMEOUT_MS } from "./voiceTuning.js";

/**
 * Web Speech ASR 适配器守护（specs/voice-agent-integration.md §2.3 / §5.3 / §9.2）：
 * AEC/NS/AGC 显式约束、lang 不硬编码、错误码映射（§5.3）、partial/final 双通道分离
 * （partial 只进预览条——正文通道只消费 final）、stop 整段结算不与逐句 final 重复、
 * 错误后不自动重启。
 */

class FakeRecognition extends EventTarget implements WebSpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  abort(): void {
    this.abortCalls += 1;
  }

  emitResult(results: WebSpeechRecognitionResultLike[], resultIndex = 0): void {
    // 结果列表形状：数字下标 + length；逐项装配避免对象展开与 length 键冲突。
    const resultList: Record<number, WebSpeechRecognitionResultLike | undefined> & {
      length: number;
    } = { length: results.length };
    results.forEach((item, index) => {
      resultList[index] = item;
    });
    const event = Object.assign(new Event("result"), {
      resultIndex,
      results: resultList,
    }) as unknown as WebSpeechRecognitionEventLike;
    this.dispatchEvent(event);
  }

  emitError(code: string): void {
    const event = Object.assign(new Event("error"), {
      error: code,
    }) as unknown as WebSpeechRecognitionErrorEventLike;
    this.dispatchEvent(event);
  }

  emitEnd(): void {
    this.dispatchEvent(new Event("end"));
  }
}

function result(transcript: string, isFinal: boolean): WebSpeechRecognitionResultLike {
  const alternative: WebSpeechRecognitionAlternativeLike = { transcript };
  return { isFinal, length: 1, 0: alternative };
}

interface Harness {
  adapter: ReturnType<typeof createWebSpeechAsrAdapter>;
  recognition: FakeRecognition;
  stoppedTracks: string[];
  start(): Promise<VoiceAsrSession>;
}

function createHarness(
  overrides?: Partial<{
    recognition: FakeRecognition;
    getUserMedia: () => Promise<{ getTracks(): { stop(): void }[] }>;
  }>,
): Harness {
  const recognition = overrides?.recognition ?? new FakeRecognition();
  const stoppedTracks: string[] = [];
  const adapter = createWebSpeechAsrAdapter({
    createRecognition: () => recognition,
    getUserMedia:
      overrides?.getUserMedia ??
      (async (constraints) => {
        expect(constraints.audio).toEqual({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        return { getTracks: () => [{ stop: () => stoppedTracks.push("mic") }] };
      }),
    stopSettleTimeoutMs: VOICE_ASR_STOP_SETTLE_TIMEOUT_MS,
  });
  return {
    adapter,
    recognition,
    stoppedTracks,
    start: () => adapter.start({ lang: "zh-CN" }),
  };
}

describe("createWebSpeechAsrAdapter", () => {
  it("reports support from the recognition factory", () => {
    expect(
      createWebSpeechAsrAdapter({ createRecognition: () => new FakeRecognition() }).isSupported(),
    ).toBe(true);
    expect(createWebSpeechAsrAdapter({ createRecognition: () => null }).isSupported()).toBe(false);
  });

  it("rejects start with service-not-allowed when unsupported", async () => {
    const adapter = createWebSpeechAsrAdapter({ createRecognition: () => null });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({
      code: "service-not-allowed",
    });
  });

  it("maps getUserMedia permission denial to not-allowed before the engine starts", async () => {
    const recognition = new FakeRecognition();
    const adapter = createWebSpeechAsrAdapter({
      createRecognition: () => recognition,
      getUserMedia: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({ code: "not-allowed" });
    expect(recognition.startCalls).toBe(0);
  });

  it("maps device errors to audio-capture", async () => {
    const adapter = createWebSpeechAsrAdapter({
      createRecognition: () => new FakeRecognition(),
      getUserMedia: async () => {
        throw new DOMException("busy", "NotReadableError");
      },
    });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({ code: "audio-capture" });
  });

  it("configures lang from params (no hardcoded en-US) and continuous interim mode", async () => {
    const h = createHarness();
    await h.start();
    expect(h.recognition.lang).toBe("zh-CN");
    expect(h.recognition.continuous).toBe(true);
    expect(h.recognition.interimResults).toBe(true);
    expect(h.recognition.startCalls).toBe(1);
  });

  it("keeps the partial (preview) and final (composer) channels separate", async () => {
    const h = createHarness();
    const partials: string[] = [];
    const unsubscribe = h.adapter.onPartial((text) => partials.push(text));
    const session = await h.start();
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));

    h.recognition.emitResult([result("正在说", false)]);
    h.recognition.emitResult([result("正在说的一句", true)]);

    // §5.1：partial 只进预览条（端口 partial 通道），final 只经逐句 final 通道，
    // 两通道零交叉——正文注入方只消费 final。
    expect(partials).toEqual(["正在说"]);
    expect(finals).toEqual(["正在说的一句"]);
    unsubscribe();
    h.recognition.emitResult([result("后续 partial", false)]);
    expect(partials).toEqual(["正在说"]);
  });

  it("resolves stop with only the post-stop flush, without repeating emitted finals", async () => {
    const h = createHarness();
    const session = await h.start();
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));

    h.recognition.emitResult([result("第一句", true)]);
    const stopPromise = session.stop();
    // stop() 之后引擎 flush 出的收尾段：
    h.recognition.emitResult([result("收尾句", true)]);
    h.recognition.emitEnd();

    await expect(stopPromise).resolves.toEqual({ final: "收尾句" });
    expect(finals).toEqual(["第一句"]);
    expect(h.stoppedTracks).toEqual(["mic"]);
  });

  it("resolves stop with an empty final on silence (§5.3 同静音超时处理)", async () => {
    const h = createHarness();
    const session = await h.start();
    const stopPromise = session.stop();
    h.recognition.emitEnd();
    await expect(stopPromise).resolves.toEqual({ final: "" });
  });

  it("maps engine error codes onto the port enum and closes the session (§5.3)", async () => {
    const h = createHarness();
    const session = await h.start();
    const errors: VoiceAsrError[] = [];
    session.onError((error) => errors.push(error));

    h.recognition.emitError("network");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("network");
    expect(h.stoppedTracks).toEqual(["mic"]);
    // 错误后判死：不再产生 final，stop 安全返回空。
    h.recognition.emitResult([result("迟到", true)]);
    await expect(session.stop()).resolves.toEqual({ final: "" });
  });

  it("does not restart automatically after an engine end without stop (§5.3)", async () => {
    const h = createHarness();
    await h.start();
    h.recognition.emitEnd();
    expect(h.recognition.startCalls).toBe(1);
  });

  it("aborts without producing a final and releases the mic", async () => {
    const h = createHarness();
    const session = await h.start();
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    session.abort();
    h.recognition.emitResult([result("丢弃", true)]);
    expect(finals).toEqual([]);
    expect(h.stoppedTracks).toEqual(["mic"]);
    expect(h.recognition.abortCalls).toBe(1);
  });

  it("aborts the previous session when a new one starts (端口内单会话防御)", async () => {
    const h = createHarness();
    await h.start();
    await h.start();
    expect(h.recognition.abortCalls).toBe(1);
    // 旧会话的麦克风轨已释放；新会话的流仍在录（随其 stop/abort 释放）。
    expect(h.stoppedTracks).toEqual(["mic"]);
  });
});
