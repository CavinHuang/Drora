// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampTtsSpeed,
  createCloudTtsAdapter,
  resolveTtsEngineChoice,
  type CloudTtsFetch,
  type CloudTtsPlaybackHandle,
  type ResponseLike,
} from "./cloudTtsAdapter.js";
import type { VoiceTtsDoneReason, VoiceTtsHandle } from "./voiceTtsPort.js";

/**
 * 云 TTS 适配器契约守护（specs/voice-agent-integration.md §9.6.5 / §9.6.8-S4，mock HTTP
 * 不发真实厂商请求）：恰好一次 POST {baseUrl}/audio/speech（JSON model/input/voice/speed
 * 映射，Bearer 注入凭据）；播放完成 → onDone(end)、请求/播放失败 → onDone(error)+warn；
 * 连续 3 句失败 → onConsecutiveFailures 一次（wiring 据此中止本轮回 AnnIdle + 会话内回落
 * speechSynthesis）；cancel → 全停在途句结算 cancelled（§2.3）。
 */

class FakePlayback implements CloudTtsPlaybackHandle {
  private resolveFn: ((outcome: "end" | "error") => void) | null = null;
  readonly completed = new Promise<"end" | "error">((resolve) => {
    this.resolveFn = resolve;
  });
  stopped = false;

  complete(outcome: "end" | "error" = "end"): void {
    this.resolveFn?.(outcome);
  }

  stop(): void {
    this.stopped = true;
    this.complete("end");
  }
}

interface SpeechRequest {
  url: string;
  method: string;
  authorization: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  rawText: string;
}

interface Harness {
  spoken: VoiceTtsHandle[];
  requests: SpeechRequest[];
  playback: FakePlayback[];
  failCount: { value: number };
  done: Array<{ handle: VoiceTtsHandle; reason: VoiceTtsDoneReason }>;
  consecutiveFailures: { fired: number };
  setConfig(config: { baseUrl: string; model: string; apiKey: string } | null): void;
  setFetchError(error: Error | null): void;
  /** 火山分支用：覆盖下一次 fetch 的响应（NDJSON 文本 / 非 ok 状态）。 */
  setRawResponse(response: { ok?: boolean; status?: number; text?: string }): void;
  adapter: ReturnType<typeof createCloudTtsAdapter>;
  lastPlayback(): FakePlayback;
}

function createHarness(threshold = 3): Harness {
  const spoken: VoiceTtsHandle[] = [];
  const requests: SpeechRequest[] = [];
  const playback: FakePlayback[] = [];
  const failCount = { value: 0 };
  const done: Array<{ handle: VoiceTtsHandle; reason: VoiceTtsDoneReason }> = [];
  const consecutiveFailures = { fired: 0 };
  let config: { baseUrl: string; model: string; apiKey: string } | null = {
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "CosyVoice2-0.5B",
    apiKey: "sk-test-key",
  };
  let fetchError: Error | null = null;
  let rawResponse: { ok?: boolean; status?: number; text?: string } | null = null;

  const adapter = createCloudTtsAdapter({
    getVendorConfig: async () => config,
    fetch: async (input, init) => {
      if (fetchError) {
        throw fetchError;
      }
      requests.push({
        url: input,
        method: init.method ?? "",
        authorization: ((init.headers ?? {}) as Record<string, string>).Authorization ?? "",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        rawText: String(init.body),
      });
      const response = {
        ok: rawResponse?.ok ?? true,
        status: rawResponse?.status ?? 200,
        blob: async () => new Blob(["fake-audio"], { type: "audio/mpeg" }),
        text: async () => rawResponse?.text ?? "",
      };
      return response as unknown as ResponseLike;
    },
    playBlob: (blob) => {
      void blob;
      const handle = new FakePlayback();
      playback.push(handle);
      return handle;
    },
    consecutiveFailuresThreshold: threshold,
  });
  adapter.onDone((handle, reason) => {
    if (reason === "error") {
      failCount.value += 1;
    }
    done.push({ handle, reason });
  });
  adapter.onConsecutiveFailures(() => {
    consecutiveFailures.fired += 1;
  });

  return {
    spoken,
    requests,
    playback,
    failCount,
    done,
    consecutiveFailures,
    setConfig: (next) => {
      config = next;
    },
    setFetchError: (error) => {
      fetchError = error;
    },
    setRawResponse: (response) => {
      rawResponse = response;
    },
    adapter,
    lastPlayback: () => playback[playback.length - 1] as FakePlayback,
  };
}

describe("createCloudTtsAdapter（mock HTTP 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks?.();
  });

  it("posts /audio/speech once per sentence with model/input/vendorVoice/speed mapping (§9.6.5-1 云 voice 子句由 §9.7.3 取代)", async () => {
    const harness = createHarness();
    const handle = harness.adapter.speak({
      text: "第一句",
      lang: "zh-CN",
      vendorVoice: "alex",
      rate: 1.5,
    });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
    });
    const request = harness.requests[0];
    expect(request?.url).toBe("https://api.siliconflow.cn/v1/audio/speech");
    expect(request?.method).toBe("POST");
    expect(request?.authorization).toBe("Bearer sk-test-key");
    expect(request?.body).toEqual({
      model: "CosyVoice2-0.5B",
      input: "第一句",
      voice: "alex",
      speed: 1.5,
    });

    // 播放完成 → onDone(end)。
    harness.lastPlayback().complete("end");
    await vi.waitFor(() => {
      expect(harness.done).toEqual([{ handle, reason: "end" }]);
    });
  });

  it("omits voice when vendorVoice unset and never reads u.voice (§9.7.3 双轨隔离)", async () => {
    const harness = createHarness();
    // u.voice 是 system 命名空间音色名，cloud 请求体零消费（V2-b 跨命名空间冲突消除）。
    harness.adapter.speak({ text: "第二句", lang: "zh-CN", voice: "Microsoft Huihui", rate: 9 });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
    });
    const body = harness.requests[0]?.body;
    expect(body?.voice).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Microsoft Huihui");
    expect(body?.speed).toBe(4); // 0.25–4 上界钳制。
  });

  it("maps a synthesis request failure to onDone(error) + warn and skips the sentence (§9.6.5-3)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = createHarness();
    harness.setFetchError(new TypeError("Failed to fetch"));
    harness.adapter.speak({ text: "坏句", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.done).toEqual([expect.objectContaining({ reason: "error" })]);
    });
    // 失败发生在 mock fetch push 之前：requests 记录为空是 mock 语义，不是适配器缺陷。
    expect(harness.requests).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("fires onConsecutiveFailures once at the threshold (§9.6.5-3 连续 3 句失败)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = createHarness(3);
    harness.setFetchError(new TypeError("down"));
    for (let i = 0; i < 3; i += 1) {
      harness.adapter.speak({ text: `句${i}`, lang: "zh-CN" });
    }
    await vi.waitFor(() => {
      expect(harness.done.filter((entry) => entry.reason === "error")).toHaveLength(3);
    });
    expect(harness.consecutiveFailures.fired).toBe(1);
    // 阈值触发后计数清零：再来一句失败重新累计（回落由 wiring 执行，不再重复 fire）。
    harness.adapter.speak({ text: "句3", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.failCount.value).toBe(4);
    });
    expect(harness.consecutiveFailures.fired).toBe(1);
    warnSpy.mockRestore();
  });

  it("resets the consecutive counter after a natural end", async () => {
    const harness = createHarness(3);
    harness.setFetchError(new TypeError("down"));
    harness.adapter.speak({ text: "坏1", lang: "zh-CN" });
    harness.adapter.speak({ text: "坏2", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.done.filter((entry) => entry.reason === "error")).toHaveLength(2);
    });
    harness.setFetchError(null); // 好句走成功路径。
    const good = harness.adapter.speak({ text: "好句", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.playback).toHaveLength(1); // 好句已到播放段（坏句走失败路径不进播放）。
    });
    harness.lastPlayback().complete("end");
    await vi.waitFor(() => {
      expect(harness.done.some((entry) => entry.handle === good && entry.reason === "end")).toBe(
        true,
      );
    });
    // 好句已把连败计数清零：坏3 是清零后第 1 连败，未达阈值、不重复 fire。
    harness.setFetchError(new TypeError("down"));
    harness.adapter.speak({ text: "坏3", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.failCount.value).toBe(3);
    });
    expect(harness.consecutiveFailures.fired).toBe(0);
  });

  it("cancels in-flight synthesis/playback and settles cancelled (§2.3 全停)", async () => {
    const harness = createHarness();
    const handle = harness.adapter.speak({ text: "长句", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
      expect(harness.playback).toHaveLength(1); // 已到播放段（cancel 停播路径）。
    });
    harness.adapter.cancel();
    expect(harness.done).toEqual([{ handle, reason: "cancelled" }]);
    // 播放已开始（本用例 fetch 即回）→ stop 被调用停掉播放。
    expect(harness.playback[0]?.stopped).toBe(true);
  });

  it("skips the sentence when the vendor record becomes incomplete mid-session", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = createHarness();
    harness.setConfig(null);
    harness.adapter.speak({ text: "无档句", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(harness.done).toEqual([expect.objectContaining({ reason: "error" })]);
    });
    expect(harness.requests).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

describe("resolveTtsEngineChoice（§9.6.5-2 引擎解析）", () => {
  it("keeps speechSynthesis for engine=system (未配置/默认行为完全不变)", () => {
    expect(resolveTtsEngineChoice({ engine: "system", vendorConfigComplete: true })).toBe("system");
    expect(resolveTtsEngineChoice({ engine: "system", vendorConfigComplete: false })).toBe(
      "system",
    );
  });

  it("selects cloud only when engine=cloud and the TTS vendor record is complete", () => {
    expect(resolveTtsEngineChoice({ engine: "cloud", vendorConfigComplete: true })).toBe("cloud");
    expect(resolveTtsEngineChoice({ engine: "cloud", vendorConfigComplete: false })).toBe("system");
  });
});

describe("clampTtsSpeed", () => {
  it("clamps to the endpoint 0.25–4 range and defaults to 1 (§9.6.5-1)", () => {
    expect(clampTtsSpeed(1.5)).toBe(1.5);
    expect(clampTtsSpeed(9)).toBe(4);
    expect(clampTtsSpeed(0.1)).toBe(0.25);
    expect(clampTtsSpeed(undefined)).toBe(1);
    expect(clampTtsSpeed(Number.NaN)).toBe(1);
  });
});

describe("火山引擎 TTS 协议分支（specs/model-capabilities.md §14）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const VOLCANO_BASE = "https://openspeech.bytedance.com";
  const VOLCANO_CONFIG = {
    baseUrl: VOLCANO_BASE,
    model: "zh_female_wanwanxiaohe_moon_bigtts",
    apiKey: "1234567890:my-access-token",
  };

  function ndjson(lines: Array<Record<string, unknown>>): string {
    return lines.map((line) => JSON.stringify(line)).join("\n");
  }

  it("端点识别：openspeech host 命中火山分支，路径与 v3 一致", async () => {
    const harness = createHarness();
    harness.setConfig(VOLCANO_CONFIG);
    harness.setRawResponse({
      text: ndjson([
        { code: 0, data: Buffer.from("hi").toString("base64") },
        { code: 20000000, message: "success" },
      ]),
    });
    const handle = harness.adapter.speak({ text: "你好", lang: "zh-CN", rate: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const last = harness.requests[harness.requests.length - 1]!;
    expect(last.url).toBe(`${VOLCANO_BASE}/api/v3/tts/unidirectional`);
    void handle;
  });

  it("请求形状：v3 headers（AppID/AccessKey/ResourceId）与 req_params body", async () => {
    const harness = createHarness();
    harness.setConfig(VOLCANO_CONFIG);
    harness.setRawResponse({
      text: ndjson([
        { code: 0, data: Buffer.from("hi").toString("base64") },
        { code: 20000000, message: "success" },
      ]),
    });
    const handle = harness.adapter.speak({ text: "你好", lang: "zh-CN", rate: 1.2 });
    await vi.advanceTimersByTimeAsync(0);
    const request = harness.requests[harness.requests.length - 1]!;
    expect(request.headers["X-Api-App-Id"]).toBe("1234567890");
    expect(request.headers["X-Api-Access-Key"]).toBe("my-access-token");
    // moon_bigtts 不含 uranus → seed-tts-1.0（§14 推断规则）
    expect(request.headers["X-Api-Resource-Id"]).toBe("seed-tts-1.0");
    expect(request.body).toMatchObject({
      req_params: {
        text: "你好",
        speaker: "zh_female_wanwanxiaohe_moon_bigtts",
        audio_params: { format: "mp3", speech_rate: 0 },
      },
    });
    void handle;
  });

  it("NDJSON 响应：base64 分片拼接为 mp3 Blob 并正常播报", async () => {
    const harness = createHarness();
    harness.setConfig(VOLCANO_CONFIG);
    harness.setRawResponse({
      text: ndjson([
        { code: 0, data: Buffer.from("chunk1").toString("base64") },
        { code: 0, data: Buffer.from("chunk2").toString("base64") },
        { code: 20000000, message: "success" },
      ]),
    });
    const handle = harness.adapter.speak({ text: "你好", lang: "zh-CN" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(harness.lastPlayback()).toBeTruthy();
    });
    expect(harness.playback.length).toBe(1);
    void handle;
  });

  it("业务错误码（code 非 0/20000000）→ 单句 error 进回落计数，零播放", async () => {
    const harness = createHarness();
    harness.setConfig(VOLCANO_CONFIG);
    harness.setRawResponse({
      text: ndjson([{ code: 3001, message: "voice not found" }]),
    });
    const handle = harness.adapter.speak({ text: "你好", lang: "zh-CN" });
    await vi.advanceTimersByTimeAsync(0);
    expect(handle).toBeTruthy();
    expect(harness.playback.length).toBe(0);
    expect(harness.failCount.value).toBe(1);
  });

  it("凭据双形态：复合键 → 旧版双头；单值键 → 新版 X-Api-Key（§14.2/§15）", async () => {
    // 新版单 Key：X-Api-Key 出站，无 App-Id/Access-Key 双头
    const single = createHarness();
    single.setConfig({
      baseUrl: VOLCANO_BASE,
      model: "zh_female_wanwanxiaohe_moon_bigtts",
      apiKey: "tlk-new-console-key",
    });
    single.setRawResponse({
      text: ndjson([
        { code: 0, data: Buffer.from("hi").toString("base64") },
        { code: 20000000, message: "success" },
      ]),
    });
    const singleHandle = single.adapter.speak({ text: "你好", lang: "zh-CN" });
    await vi.advanceTimersByTimeAsync(0);
    const singleRequest = single.requests[single.requests.length - 1]!;
    expect(singleRequest.headers["X-Api-Key"]).toBe("tlk-new-console-key");
    expect(singleRequest.headers["X-Api-App-Id"]).toBeUndefined();
    expect(singleRequest.headers["X-Api-Access-Key"]).toBeUndefined();
    expect(single.playback.length).toBe(1);
    void singleHandle;

    // 空白串 → fail-closed 零出站
    const empty = createHarness();
    empty.setConfig({ baseUrl: VOLCANO_BASE, model: "m", apiKey: "   " });
    empty.setRawResponse({ text: "" });
    const emptyHandle = empty.adapter.speak({ text: "你好", lang: "zh-CN" });
    await vi.advanceTimersByTimeAsync(0);
    expect(empty.playback.length).toBe(0);
    expect(empty.failCount.value).toBe(1);
    void emptyHandle;
  });

  it("资源 ID 推断：uranus → 2.0；S_ → 复刻；moon_bigtts → 1.0", async () => {
    const cases: Array<[string, string]> = [
      ["zh_female_xiaohe_uranus_bigtts", "seed-tts-2.0"],
      ["S_9W2ToNVW1", "seed-icl-1.0"],
      ["zh_female_wanwanxiaohe_moon_bigtts", "seed-tts-1.0"],
    ];
    for (const [model, expected] of cases) {
      const harness = createHarness();
      harness.setConfig({ baseUrl: VOLCANO_BASE, model, apiKey: "1:2" });
      harness.setRawResponse({
        text: ndjson([
          { code: 0, data: "" },
          { code: 20000000, message: "success" },
        ]),
      });
      const handle = harness.adapter.speak({ text: "x", lang: "zh-CN" });
      await vi.advanceTimersByTimeAsync(0);
      const request = harness.requests[harness.requests.length - 1]!;
      expect(request.headers["X-Api-Resource-Id"]).toBe(expected);
      void handle;
    }
  });

  it("isVolcanoTtsEndpoint：host 精确识别 + 非法串返回 false", async () => {
    const { isVolcanoTtsEndpoint } = await import("./cloudTtsAdapter.js");
    expect(isVolcanoTtsEndpoint("https://openspeech.bytedance.com")).toBe(true);
    expect(isVolcanoTtsEndpoint("https://openspeech.bytedance.com.evil.example")).toBe(false);
    expect(isVolcanoTtsEndpoint("https://api.siliconflow.cn/v1")).toBe(false);
    expect(isVolcanoTtsEndpoint("not a url")).toBe(false);
  });
});

describe("synthesizeOnce（specs/model-capabilities.md §15 试听）", () => {
  const VOLCANO_BASE = "https://openspeech.bytedance.com";

  function ndjson(lines: Array<Record<string, unknown>>): string {
    return lines.map((line) => JSON.stringify(line)).join("\n");
  }

  function fakeFetch(response: { ok?: boolean; status?: number; text?: string; blob?: Blob }): {
    fetch: CloudTtsFetch;
    requests: Array<{ url: string; headers: Record<string, string>; body: unknown }>;
  } {
    const requests: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const doFetch: CloudTtsFetch = async (input, init) => {
      requests.push({
        url: input,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init.body ?? "{}")),
      });
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        blob: async () => response.blob ?? new Blob(["audio"], { type: "audio/mpeg" }),
        text: async () => response.text ?? "",
      };
    };
    return { fetch: doFetch, requests };
  }

  it("火山卡：分派 v3 协议，新版单 Key 发 X-Api-Key", async () => {
    const { synthesizeOnce } = await import("./cloudTtsAdapter.js");
    const { fetch, requests } = fakeFetch({
      text: ndjson([
        { code: 0, data: Buffer.from("hi").toString("base64") },
        { code: 20000000, message: "success" },
      ]),
    });
    const blob = await synthesizeOnce(
      { baseUrl: VOLCANO_BASE, model: "zh_female_wanwanxiaohe_moon_bigtts", apiKey: "tlk-single" },
      "试听",
      { fetch },
    );
    expect(requests[0]?.url).toBe(`${VOLCANO_BASE}/api/v3/tts/unidirectional`);
    expect(requests[0]?.headers["X-Api-Key"]).toBe("tlk-single");
    expect((await blob.text()).length).toBeGreaterThan(0);
  });

  it("OpenAI 兼容卡：/audio/speech + Bearer + voice 透传", async () => {
    const { synthesizeOnce } = await import("./cloudTtsAdapter.js");
    const { fetch, requests } = fakeFetch({});
    const blob = await synthesizeOnce(
      {
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "FunAudioLLM/CosyVoice2-0.5B",
        apiKey: "sk-x",
      },
      "试听",
      { fetch, voice: "FunAudioLLM/CosyVoice2-0.5B:anna" },
    );
    expect(requests[0]?.url).toBe("https://api.siliconflow.cn/v1/audio/speech");
    expect(requests[0]?.headers.Authorization).toBe("Bearer sk-x");
    expect(requests[0]?.body).toMatchObject({
      model: "FunAudioLLM/CosyVoice2-0.5B",
      voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
    });
    expect((await blob.text()).length).toBeGreaterThan(0);
  });

  it("非 2xx → throw（消息含 status，供表单 toast 直显）", async () => {
    const { synthesizeOnce } = await import("./cloudTtsAdapter.js");
    const { fetch } = fakeFetch({ ok: false, status: 401 });
    await expect(
      synthesizeOnce(
        { baseUrl: "https://api.siliconflow.cn/v1", model: "m", apiKey: "sk-x" },
        "试听",
        { fetch },
      ),
    ).rejects.toThrow("401");
  });
});
