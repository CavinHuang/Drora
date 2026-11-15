// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOfficialServerAsrAdapter,
  mapOfficialServerAsrErrorCode,
  resolveOfficialAsrLanguage,
  type OfficialServerAsrEngineHandle,
  type OfficialServerAsrEvent,
} from "./officialServerAsrAdapter.js";
import type { PcmStreamHandle } from "./pcmStreamCapture.js";
import { VoiceAsrError } from "./voiceAsrPort.js";

/**
 * §11 收编适配器纯逻辑面守护（specs/voice-agent-integration.md §11.3）：
 * 桥接映射（官方事件 → VoiceAsrPort 通道）、事件转写（result 快照→partial、
 * completed→onFinal 恰一次、错误归类 §11.2 映射表）、stop 结算（空串防双交付 +
 * 尾块 remainder 上行先于 finish + settle 超时 network 出腿）、abort/权限预检
 * fail-closed。全部经注入 fake 句柄与 fake 采集（pcmStreamCapture 形状）消费，
 * 零真实官方链路依赖、零真麦。
 */

interface FakeHandle {
  handle: OfficialServerAsrEngineHandle;
  emit(event: OfficialServerAsrEvent): void;
  calls: {
    start: Array<{ attemptId: string; language: "zh-CN" | "en-US" }>;
    sendAudio: Array<{ attemptId: string; chunk: Uint8Array }>;
    finish: Array<{ attemptId: string }>;
    cancel: Array<{ attemptId: string }>;
  };
  currentAttemptId(): string;
}

function createFakeHandle(): FakeHandle {
  const listeners = new Set<(event: OfficialServerAsrEvent) => void>();
  const calls: FakeHandle["calls"] = { start: [], sendAudio: [], finish: [], cancel: [] };
  return {
    handle: {
      async start(params) {
        calls.start.push(params);
      },
      async sendAudio(params) {
        calls.sendAudio.push(params);
      },
      async finish(params) {
        calls.finish.push(params);
      },
      async cancel(params) {
        calls.cancel.push(params);
      },
      onEvent(listener) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    emit(event) {
      for (const listener of Array.from(listeners)) listener(event);
    },
    calls,
    currentAttemptId() {
      const last = calls.start.at(-1);
      if (!last) throw new Error("no attempt started");
      return last.attemptId;
    },
  };
}

interface FakeCapture {
  /** 与 officialServerAsrAdapter 的 startCapture DI 对齐（pcmStreamCapture 形状）。 */
  factory: (onChunk: (chunk: ArrayBuffer) => void) => Promise<PcmStreamHandle>;
  state: { factoryCalls: number; stopCalls: number };
  /** stop 返回的尾块字节数（0=无尾块；置数断言 remainder 上行先于 finish）。 */
  remainderBytes: number;
  emitChunk(bytes: number): void;
}

function createFakeCapture(): FakeCapture {
  const state = { factoryCalls: 0, stopCalls: 0 };
  const control = { remainderBytes: 0 };
  let onChunk: ((chunk: ArrayBuffer) => void) | null = null;
  const factory = (chunkListener: (chunk: ArrayBuffer) => void): Promise<PcmStreamHandle> => {
    state.factoryCalls += 1;
    onChunk = chunkListener;
    return Promise.resolve({
      onChunk: () => undefined,
      stop() {
        state.stopCalls += 1;
        return { remainder: new ArrayBuffer(control.remainderBytes) };
      },
    });
  };
  return {
    factory,
    state,
    get remainderBytes() {
      return control.remainderBytes;
    },
    set remainderBytes(bytes: number) {
      control.remainderBytes = bytes;
    },
    emitChunk(bytes: number) {
      onChunk?.(new ArrayBuffer(bytes));
    },
  };
}

/** crypto.randomUUID 补桩（jsdom 老版本缺席时固定序号；存在则零动作）。 */
let uuidSeq = 0;
beforeEach(() => {
  uuidSeq = 0;
  if (typeof crypto.randomUUID !== "function") {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => `attempt-${++uuidSeq}`,
    });
  }
});

describe("mapOfficialServerAsrErrorCode（§11.2 错误映射单一出处）", () => {
  it("网络/服务族统一 network（保留已注入文本语义）", () => {
    for (const code of [
      "network",
      "proxy",
      "rate_limited",
      "unavailable",
      "upstream_timeout",
      "failed",
    ]) {
      expect(mapOfficialServerAsrErrorCode(code)).toBe("network");
    }
  });
  it("unauthorized → service-not-allowed（登录/token 失效归权限族）", () => {
    expect(mapOfficialServerAsrErrorCode("unauthorized")).toBe("service-not-allowed");
  });
  it("audio_limit_exceeded → aborted；audio_too_short → no-speech（静音族）", () => {
    expect(mapOfficialServerAsrErrorCode("audio_limit_exceeded")).toBe("aborted");
    expect(mapOfficialServerAsrErrorCode("audio_too_short")).toBe("no-speech");
  });
  it("未知码（上游新增）兜底 network，不误报权限", () => {
    expect(mapOfficialServerAsrErrorCode("some_future_code")).toBe("network");
  });
});

describe("resolveOfficialAsrLanguage（官方服务双值枚举映射）", () => {
  it("zh 前缀 → zh-CN；其余（含第三语言）→ en-US（镜像官方 hook 映射）", () => {
    expect(resolveOfficialAsrLanguage("zh-CN")).toBe("zh-CN");
    expect(resolveOfficialAsrLanguage("zh-TW")).toBe("zh-CN");
    expect(resolveOfficialAsrLanguage("en-US")).toBe("en-US");
    expect(resolveOfficialAsrLanguage("ja-JP")).toBe("en-US");
  });
});

describe("createOfficialServerAsrAdapter 桥接链路", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("权限预检 denied → start throw not-allowed 且不建官方会话不开麦（fail-closed）", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      ensureMicAccess: async () => "denied",
      startCapture: capture.factory,
    });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({
      code: "not-allowed",
    });
    expect(fake.calls.start).toHaveLength(0);
    expect(capture.state.factoryCalls).toBe(0); // 采集工厂未被调用。
  });

  it("正常起录：官方 start（zh-CN 映射）→ 采集块按 attemptId 上行（started 前音频由官方服务缓存）", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
    });
    const session = await adapter.start({ lang: "zh-CN" });
    expect(fake.calls.start).toHaveLength(1);
    expect(fake.calls.start[0]!.language).toBe("zh-CN");
    capture.emitChunk(3_200);
    capture.emitChunk(3_200);
    expect(fake.calls.sendAudio).toHaveLength(2);
    expect(fake.calls.sendAudio[0]!.attemptId).toBe(fake.currentAttemptId());
    session.abort();
  });

  it("result 快照只进 onPartial（§5.1 partial 永不进正文）；completed 终稿恰一次走 onFinal，stop 恒空串（防双交付）", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
    });
    const partials: string[] = [];
    adapter.onPartial((text) => partials.push(text));
    const session = await adapter.start({ lang: "zh-CN" });
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    const attemptId = fake.currentAttemptId();
    fake.emit({ attemptId, type: "result", text: "半句" });
    fake.emit({ attemptId, type: "result", text: "" });
    fake.emit({ attemptId: "other", type: "result", text: "他路" });
    expect(partials).toEqual(["半句"]);
    // stop：尾块（remainder）先于 finish 上行（官方链路同语义）。
    capture.remainderBytes = 1_600;
    const stopPromise = session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls.finish).toHaveLength(1);
    expect(fake.calls.sendAudio.at(-1)?.chunk.byteLength).toBe(1_600);
    fake.emit({ attemptId, type: "completed", text: "  终稿文本  " });
    expect(await stopPromise).toEqual({ final: "" });
    expect(finals).toEqual(["终稿文本"]); // trim 后恰一次。
    // 结算后再发 completed/error：settled 守卫丢弃（不双交付、不复活）。
    fake.emit({ attemptId, type: "completed", text: "迟到终稿" });
    fake.emit({ attemptId, type: "error", code: "network" });
    expect(finals).toEqual(["终稿文本"]);
  });

  it("completed 空文本 → 不发 onFinal（静音族语义），stop 空串结算", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
    });
    const session = await adapter.start({ lang: "zh-CN" });
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    const stopPromise = session.stop();
    await vi.advanceTimersByTimeAsync(0);
    fake.emit({ attemptId: fake.currentAttemptId(), type: "completed", text: "   " });
    expect(await stopPromise).toEqual({ final: "" });
    expect(finals).toEqual([]);
  });

  it("录音中官方 error → onError 映射码出腿 + 丢弃式停采集 + 官方 cancel；此后事件丢弃", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
    });
    const partials: string[] = [];
    adapter.onPartial((text) => partials.push(text));
    const session = await adapter.start({ lang: "zh-CN" });
    const errors: string[] = [];
    session.onError((error) => errors.push(error.code));
    const attemptId = fake.currentAttemptId();
    fake.emit({ attemptId, type: "result", text: "错误前快照" });
    fake.emit({ attemptId, type: "error", code: "unauthorized" });
    expect(errors).toEqual(["service-not-allowed"]);
    expect(capture.state.stopCalls).toBe(1);
    expect(fake.calls.cancel).toHaveLength(1);
    // settled 后迟到 result 被会话守卫丢弃，不再进 partial。
    fake.emit({ attemptId, type: "result", text: "迟到" });
    expect(partials).toEqual(["错误前快照"]);
  });

  it("stop 终稿等待超时 → network 出腿 + 空串结算（停止链不悬挂）", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
      stopSettleTimeoutMs: 50,
    });
    const session = await adapter.start({ lang: "zh-CN" });
    const errors: string[] = [];
    session.onError((error) => errors.push(error.code));
    const stopPromise = session.stop();
    await vi.advanceTimersByTimeAsync(0);
    // completed 不来：50ms 短窗耗尽。
    await vi.advanceTimersByTimeAsync(50);
    expect(await stopPromise).toEqual({ final: "" });
    expect(errors).toEqual(["network"]);
    expect(fake.calls.cancel).toHaveLength(1);
  });

  it("abort → 官方 cancel、不产生 final；此后 stop 直接空串", async () => {
    const fake = createFakeHandle();
    const capture = createFakeCapture();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: capture.factory,
    });
    const session = await adapter.start({ lang: "zh-CN" });
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    session.abort();
    expect(fake.calls.cancel).toHaveLength(1);
    expect(capture.state.stopCalls).toBe(1);
    fake.emit({ attemptId: fake.currentAttemptId(), type: "completed", text: "迟到终稿" });
    expect(finals).toEqual([]);
    expect(await session.stop()).toEqual({ final: "" });
  });

  it("采集 getUserMedia 失败 → 官方会话撤回（cancel）+ start 按 getUserMedia 错误归类上抛", async () => {
    const fake = createFakeHandle();
    const adapter = createOfficialServerAsrAdapter({
      handle: fake.handle,
      startCapture: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    await expect(adapter.start({ lang: "zh-CN" })).rejects.toMatchObject({ code: "not-allowed" });
    expect(fake.calls.cancel).toHaveLength(1);
  });

  it("isSupported：句柄在场即支持（装配点已过可用性判定）", () => {
    const fake = createFakeHandle();
    const adapter = createOfficialServerAsrAdapter({ handle: fake.handle });
    expect(adapter.isSupported()).toBe(true);
  });

  it("VoiceAsrError 形状：code/message（消费方 useVoiceDictation 按 §5.3 处置）", () => {
    const error = new VoiceAsrError("service-not-allowed");
    expect(error).toBeInstanceOf(VoiceAsrError);
    expect(error.code).toBe("service-not-allowed");
    expect(error.name).toBe("VoiceAsrError");
  });
});
