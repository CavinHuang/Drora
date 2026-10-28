// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAsrAdapter,
  mapLanguage,
  resolveRemoteAsrErrorCode,
  type MediaRecorderLike,
  type MediaStreamLike,
  type RemoteAsrVendorConfig,
  type ResponseLike,
} from "./remoteAsrAdapter.js";
import { VoiceAsrError } from "./voiceAsrPort.js";

/**
 * 远程 ASR 适配器契约守护（specs/voice-agent-integration.md §9.6.4 / §9.6.8-S2，mock HTTP
 * 不发真实厂商请求）：恰好一次 POST {baseUrl}/audio/transcriptions（multipart file+model+
 * language/prompt，Bearer 来自注入凭据）；响应 {text} 经 onFinal 交付一次；零 partial；
 * 网络失败/非 2xx → onError("network")；abort 丢弃式零上传零 final（§5.3）。
 */

class FakeRecorder extends EventTarget implements MediaRecorderLike {
  readonly mimeType: string;
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;

  constructor(mimeType?: string) {
    super();
    this.mimeType = mimeType ?? "audio/webm";
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.call(this, { data: new Blob(["fake-audio"], { type: this.mimeType }) });
    this.dispatchEvent(new Event("stop"));
  }
}

const stream: MediaStreamLike = { getTracks: () => [{ stop: () => undefined }] };

interface HttpExpectation {
  url: string;
  method: string;
  authorization: string;
  contentTypeContains: string;
  body: FormData;
}

function createHarness(options?: {
  config?: Partial<RemoteAsrVendorConfig>;
  fetchImpl?: (input: string, init: RequestInit) => Promise<ResponseLike>;
}) {
  const config: RemoteAsrVendorConfig = {
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "FunAudioLLM/SenseVoiceSmall",
    apiKey: "sk-test-key",
    ...options?.config,
  };
  const requests: HttpExpectation[] = [];
  const fetchImpl =
    options?.fetchImpl ??
    (async () => ({ ok: true, status: 200, json: async () => ({ text: "识别文本" }) }));
  const adapter = createRemoteAsrAdapter({
    getVendorConfig: () => config,
    getUserMedia: async () => stream,
    createMediaRecorder: (s, mediaOptions) => new FakeRecorder(mediaOptions?.mimeType),
    fetch: async (input, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const body = init.body as FormData;
      requests.push({
        url: input,
        method: init.method ?? "",
        authorization: headers.Authorization ?? "",
        contentTypeContains:
          typeof headers["Content-Type"] === "string" ? headers["Content-Type"] : "multipart",
        body,
      });
      return fetchImpl(input, init);
    },
    stopSettleTimeoutMs: 500,
  });
  return { adapter, requests, config };
}

async function startSession(
  harness: ReturnType<typeof createHarness>,
  lang = "zh-CN",
  hints: string[] = [],
) {
  const session = await harness.adapter.start({ lang, hints });
  // jsdom 无 MediaRecorder 构造路径（fake 注入），会话开始即收集态。
  return session;
}

describe("createRemoteAsrAdapter（mock HTTP 契约）", () => {
  it("uploads exactly once on stop and delivers {text} through onFinal once", async () => {
    const harness = createHarness();
    const session = await startSession(harness);
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));

    const stopPromise = session.stop();
    await expect(stopPromise).resolves.toEqual({ final: "" });
    // 交付契约：批量 final 只走 onFinal 一次（stop 恒空串防双交付，见适配器头注）。
    expect(finals).toEqual(["识别文本"]);

    // §9.6.8-S2：恰好一次 POST，multipart（file+model+language），Bearer 来自注入凭据。
    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0];
    expect(request?.url).toBe("https://api.siliconflow.cn/v1/audio/transcriptions");
    expect(request?.method).toBe("POST");
    expect(request?.authorization).toBe("Bearer sk-test-key");
    expect(request?.body instanceof FormData).toBe(true);
    expect(request?.body.get("model")).toBe("FunAudioLLM/SenseVoiceSmall");
    expect(request?.body.get("language")).toBe("zh");
    expect(request?.body.get("file")).toBeInstanceOf(Blob);
    // Content-Type 由 fetch/FormData 注入 multipart boundary；适配器不得手写覆盖。
    expect(request?.contentTypeContains).not.toContain("application/json");
  });

  it("maps lang to the endpoint language parameter and joins hints as prompt", async () => {
    const harness = createHarness();
    const session = await startSession(harness, "en-US", ["stop", "quiet"]);
    const stopPromise = session.stop();
    await stopPromise;
    expect(harness.requests[0]?.body.get("language")).toBe("en");
    expect(harness.requests[0]?.body.get("prompt")).toBe("stop quiet");
  });

  it("never emits partial (§9.6.4-2)", async () => {
    const harness = createHarness();
    const onPartial = vi.fn();
    const unsubscribe = harness.adapter.onPartial(onPartial);
    const session = await startSession(harness);
    const stopPromise = session.stop();
    await stopPromise;
    expect(onPartial).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("maps non-2xx to onError(network) and resolves stop with empty final (§5.3)", async () => {
    const harness = createHarness({
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    const session = await startSession(harness);
    const errors: VoiceAsrError[] = [];
    session.onError((error) => errors.push(error));
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));

    await expect(session.stop()).resolves.toEqual({ final: "" });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("network");
    expect(finals).toEqual([]);
  });

  it("maps a fetch rejection to onError(network) (§9.6.6 回退树 onError 分支)", async () => {
    const harness = createHarness({
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const session = await startSession(harness);
    const errors: VoiceAsrError[] = [];
    session.onError((error) => errors.push(error));
    await expect(session.stop()).resolves.toEqual({ final: "" });
    expect(errors[0]?.code).toBe("network");
  });

  it("abort discards the recording: no upload, no final (§2.3 丢弃式停止)", async () => {
    const harness = createHarness();
    const session = await startSession(harness);
    const finals: string[] = [];
    session.onFinal((text) => finals.push(text));
    session.abort();
    // 零上传：无请求发生；无 final。
    expect(harness.requests).toHaveLength(0);
    expect(finals).toEqual([]);
  });

  it("empty recording resolves empty final without uploading (静音同 §5.3 静音超时)", async () => {
    // 零吐数据 recorder：ondataavailable 不触发 → 零字节 blob。
    class SilentRecorder extends EventTarget implements MediaRecorderLike {
      readonly mimeType = "audio/webm";
      state: "inactive" | "recording" | "paused" = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
        // 静音：不吐任何 data，直接 stop 事件。
        this.dispatchEvent(new Event("stop"));
      }
    }
    const requests: string[] = [];
    const adapter = createRemoteAsrAdapter({
      getVendorConfig: () => ({
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "FunAudioLLM/SenseVoiceSmall",
        apiKey: "sk-test-key",
      }),
      getUserMedia: async () => stream,
      createMediaRecorder: () => new SilentRecorder(),
      fetch: async (input) => {
        requests.push(input);
        return { ok: true, status: 200, json: async () => ({ text: "should-not-happen" }) };
      },
      stopSettleTimeoutMs: 500,
    });
    const session = await adapter.start({ lang: "zh-CN" });
    const stopPromise = session.stop();
    await expect(stopPromise).resolves.toEqual({ final: "" });
    expect(requests).toHaveLength(0);
  });

  it("treats an incomplete vendor config mid-recording as network (§9.6.6 回退树)", async () => {
    const harness = createHarness();
    const session = await startSession(harness);
    harness.config.baseUrl = "   ";
    const errors: VoiceAsrError[] = [];
    session.onError((error) => errors.push(error));
    await expect(session.stop()).resolves.toEqual({ final: "" });
    expect(errors[0]?.code).toBe("network");
  });

  it("isSupported reflects MediaRecorder/FormData presence (浏览器能力面)", () => {
    // 当前 jsdom 环境的 MediaRecorder/FormData 可用性即为断言值（缺席环境由选型函数回退 webSpeech）。
    const expected = typeof MediaRecorder !== "undefined" && typeof FormData !== "undefined";
    expect(createRemoteAsrAdapter({ getVendorConfig: () => null }).isSupported()).toBe(expected);
  });
});

describe("mapLanguage", () => {
  it("maps BCP-47 to the endpoint primary subtag", () => {
    expect(mapLanguage("zh-CN")).toBe("zh");
    expect(mapLanguage("en-US")).toBe("en");
    expect(mapLanguage(" yue-HK ")).toBe("yue");
  });

  it("returns null for empty or unmappable values (省略 → 模型自判定)", () => {
    expect(mapLanguage("")).toBeNull();
    expect(mapLanguage("  ")).toBeNull();
    expect(mapLanguage("123")).toBeNull();
  });
});

describe("resolveRemoteAsrErrorCode", () => {
  it("passes through VoiceAsrError codes and defaults unknown failures to network", () => {
    expect(resolveRemoteAsrErrorCode(new VoiceAsrError("audio-capture"))).toBe("audio-capture");
    expect(resolveRemoteAsrErrorCode(new TypeError("x"))).toBe("network");
  });
});

// §9.8.1：Esc/卸载可以打断已经开始结算的 remote 录音。
it("abort during recorder settlement prevents upload and releases tracks", async () => {
  const stopTrack = vi.fn();
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: "late" }),
  }));
  const adapter = createRemoteAsrAdapter({
    getVendorConfig: () => ({ baseUrl: "https://voice.example.test", model: "m", apiKey: "test" }),
    getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }),
    createMediaRecorder: () => new FakeRecorder(),
    fetch,
  });
  const session = await adapter.start({ lang: "zh-CN" });
  const final = vi.fn();
  session.onFinal(final);
  const pending = session.stop();
  session.abort();
  await pending;
  expect(fetch).not.toHaveBeenCalled();
  expect(final).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it("abort during upload aborts HTTP and suppresses late final", async () => {
  let respond: ((value: ResponseLike) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  const harness = createHarness({
    fetchImpl: async (_input, init) => {
      signal = init.signal;
      return new Promise((resolve) => {
        respond = resolve;
      });
    },
  });
  const session = await startSession(harness);
  const final = vi.fn();
  session.onFinal(final);
  const pending = session.stop();
  await Promise.resolve();
  session.abort();
  expect(signal?.aborted).toBe(true);
  respond?.({ ok: true, status: 200, json: async () => ({ text: "late" }) });
  await pending;
  expect(final).not.toHaveBeenCalled();
});
