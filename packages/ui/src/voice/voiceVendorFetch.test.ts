// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceVendorFetch } from "./voiceVendorFetch.js";

/**
 * §15.8 厂商出站 fetch 路由契约（specs/model-capabilities.md §15.8）：白名单 host +
 * 桌面平台方法 → 代理（载荷透传 + base64 响应还原 ResponseLike）；非白名单 host /
 * 平台方法缺席 → 直连 fetch（现状路径零变化）；AbortSignal 竞速中止。
 */

/** base64("audio-bytes") 预计算。 */
const AUDIO_B64 = Buffer.from("audio-bytes", "utf8").toString("base64");

const PROXY_RESPONSE = {
  ok: true,
  status: 200,
  contentType: "audio/mpeg",
  bodyBase64: AUDIO_B64,
};

describe("createVoiceVendorFetch 路由矩阵（§15.8）", () => {
  const directFetch = vi.fn();

  beforeEach(() => {
    directFetch.mockReset();
    vi.stubGlobal("fetch", directFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("白名单 host + 平台方法 → 代理：载荷透传、ResponseLike 按 base64 还原", async () => {
    const proxyFetch = vi.fn().mockResolvedValue(PROXY_RESPONSE);
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    const response = await vendorFetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
      method: "POST",
      headers: { "X-Api-Key": "k1", "Content-Type": "application/json" },
      body: '{"req_params":{"text":"你好"}}',
    });
    expect(directFetch).not.toHaveBeenCalled();
    expect(proxyFetch).toHaveBeenCalledWith({
      url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      headers: { "X-Api-Key": "k1", "Content-Type": "application/json" },
      body: '{"req_params":{"text":"你好"}}',
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    // text = utf8 解码（火山 NDJSON 分支消费）。
    await expect(response.text?.()).resolves.toBe("audio-bytes");
    // blob = 字节 + contentType（OpenAI 兼容分支消费）。
    const blob = await response.blob();
    expect(blob.type).toBe("audio/mpeg");
    await expect(blob.text()).resolves.toBe("audio-bytes");
  });

  it("非白名单 host → 直连（代理方法不被调用）", async () => {
    directFetch.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() });
    const proxyFetch = vi.fn();
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    await vendorFetch("https://api.openai.com/v1/audio/speech", { method: "POST", body: "{}" });
    expect(proxyFetch).not.toHaveBeenCalled();
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it("platform 缺席（Web/手机）或方法缺席 → 恒直连", async () => {
    directFetch.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() });
    const url = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
    await createVoiceVendorFetch({ platform: null })(url, { method: "POST", body: "{}" });
    await createVoiceVendorFetch({})(url, { method: "POST", body: "{}" });
    await createVoiceVendorFetch({ platform: {} })(url, { method: "POST", body: "{}" });
    expect(directFetch).toHaveBeenCalledTimes(3);
  });

  it("signal 已中止 → 直接 reject 不发起代理请求", async () => {
    const proxyFetch = vi.fn();
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      vendorFetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it("signal 中途中止 → race 提前 reject（不等待代理 Promise 结算）", async () => {
    const controller = new AbortController();
    const proxyFetch = vi.fn(
      () => new Promise<typeof PROXY_RESPONSE>(() => undefined), // 永不结算
    );
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    const pending = vendorFetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("载荷形状不符（Headers 实例/非 string body）→ 保守直连，不发代理（§15.8 审查修复）", async () => {
    const proxyFetch = vi.fn().mockResolvedValue(PROXY_RESPONSE);
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    const url = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
    const headersInstance = new Headers({ "Content-Type": "application/json" });
    directFetch.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() });
    await vendorFetch(url, { method: "POST", headers: headersInstance, body: "{}" });
    await vendorFetch(url, {
      method: "POST",
      headers: { "X-Api-Key": 123 } as unknown as HeadersInit,
      body: "{}",
    });
    await vendorFetch(url, { method: "POST", body: new Blob(["x"]) });
    expect(proxyFetch).not.toHaveBeenCalled();
    expect(directFetch).toHaveBeenCalledTimes(3);
  });

  it("IPC 错误剥壳：main throw 的通道名包装不外泄，还原真实消息（§15.8 审查修复）", async () => {
    const proxyFetch = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'drora:voice-vendor-proxy-fetch': Error: url host not in vendor proxy allowlist",
        ),
      );
    const vendorFetch = createVoiceVendorFetch({
      platform: { voiceVendorProxyFetch: proxyFetch },
    });
    await expect(
      vendorFetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("url host not in vendor proxy allowlist");
  });
});
