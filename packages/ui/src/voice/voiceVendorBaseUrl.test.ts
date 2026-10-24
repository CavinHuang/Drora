import { describe, expect, it } from "vitest";
import { validateVoiceVendorBaseUrl } from "./voiceVendorBaseUrl.js";

/**
 * 语音厂商档 baseUrl 校验守护（修复轮 S1：实现审查「baseUrl 无 https 强制」）：
 * https 强制 + localhost/127.0.0.1/[::1]/*.localhost 明文例外（自托管 OpenAI 兼容
 * 网关场景，spec §9.6.1 备选②）；空串 ok（档「未配置」语义归
 * isVoiceVendorConfigComplete 三元非空判定）。
 */
describe("validateVoiceVendorBaseUrl", () => {
  it("accepts https URLs", () => {
    expect(validateVoiceVendorBaseUrl("https://api.siliconflow.cn/v1").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("https://localhost/v1").ok).toBe(true);
  });

  it("allows plain http only for loopback hosts (自托管网关明文例外)", () => {
    expect(validateVoiceVendorBaseUrl("http://localhost:8080/v1").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("http://127.0.0.1:9800").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("http://[::1]:9800").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("http://my-gateway.localhost/v1").ok).toBe(true);
  });

  it("rejects plain http for non-loopback hosts (明文远程 → insecure-remote)", () => {
    const result = validateVoiceVendorBaseUrl("http://api.example.com/v1");
    expect(result).toEqual({ ok: false, reason: "insecure-remote" });
  });

  it("rejects unparseable values (unparseable)", () => {
    expect(validateVoiceVendorBaseUrl("api.example.com/v1")).toEqual({
      ok: false,
      reason: "unparseable",
    });
    expect(validateVoiceVendorBaseUrl("not a url")).toEqual({ ok: false, reason: "unparseable" });
  });

  it("treats empty/blank as ok (档未配置语义由三元非空判定负责)", () => {
    expect(validateVoiceVendorBaseUrl("").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("   ").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl(null).ok).toBe(true);
  });
});
