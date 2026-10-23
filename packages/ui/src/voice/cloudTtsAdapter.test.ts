// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampTtsSpeed,
  createCloudTtsAdapter,
  resolveTtsEngineChoice,
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
  body: Record<string, unknown>;
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
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      const response = {
        ok: true,
        status: 200,
        blob: async () => new Blob(["fake-audio"], { type: "audio/mpeg" }),
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
    adapter,
    lastPlayback: () => playback[playback.length - 1] as FakePlayback,
  };
}

describe("createCloudTtsAdapter（mock HTTP 契约）", () => {
  beforeEach(() => {
    vi.clearAllMocks?.();
  });

  it("posts /audio/speech once per sentence with model/input/voice/speed mapping (§9.6.5-1)", async () => {
    const harness = createHarness();
    const handle = harness.adapter.speak({
      text: "第一句",
      lang: "zh-CN",
      voice: "CosyVoice2-0.5B-narrator",
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
      voice: "CosyVoice2-0.5B-narrator",
      speed: 1.5,
    });

    // 播放完成 → onDone(end)。
    harness.lastPlayback().complete("end");
    await vi.waitFor(() => {
      expect(harness.done).toEqual([{ handle, reason: "end" }]);
    });
  });

  it("omits voice when unset and maps rate out-of-range by clamping to endpoint bounds", async () => {
    const harness = createHarness();
    harness.adapter.speak({ text: "第二句", lang: "zh-CN", rate: 9 });
    await vi.waitFor(() => {
      expect(harness.requests).toHaveLength(1);
    });
    const body = harness.requests[0]?.body;
    expect(body?.voice).toBeUndefined();
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
    expect(resolveTtsEngineChoice({ engine: "system", vendorConfigComplete: false })).toBe("system");
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
