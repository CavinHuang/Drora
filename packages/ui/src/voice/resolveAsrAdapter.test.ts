// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isVoiceVendorConfigComplete, resolveAsrEngineChoice } from "./resolveAsrAdapter.js";

/**
 * ASR 引擎选型纯函数守护（specs/voice-agent-integration.md §9.6.6 回退树 / §9.6.8-S3）：
 * engine=webSpeech → 现状路径零变化；engine=remote 且档完整且能力可用 → remote；
 * 档不完整/能力缺席 → webSpeech（调用方记 voice.asr info）。
 */
describe("resolveAsrEngineChoice", () => {
  const completeRemote = {
    engine: "remote" as const,
    vendorConfigComplete: true,
    remoteSupported: true,
    webSpeechSupported: true,
  };

  it("keeps the webSpeech path unchanged for engine=webSpeech (默认行为完全不变)", () => {
    expect(resolveAsrEngineChoice({ ...completeRemote, engine: "webSpeech" })).toBe("webSpeech");
  });

  it("selects remote when engine=remote, vendor complete and supported", () => {
    expect(resolveAsrEngineChoice(completeRemote)).toBe("remote");
  });

  it("falls back to webSpeech when any vendor field is incomplete (§9.6.8-S3)", () => {
    expect(resolveAsrEngineChoice({ ...completeRemote, vendorConfigComplete: false })).toBe(
      "webSpeech",
    );
  });

  it("falls back to webSpeech when the remote capability is absent", () => {
    expect(resolveAsrEngineChoice({ ...completeRemote, remoteSupported: false })).toBe("webSpeech");
  });
});

describe("isVoiceVendorConfigComplete", () => {
  it("requires baseUrl+model+apiKey all non-blank (§9.6.2-5)", () => {
    expect(isVoiceVendorConfigComplete({ baseUrl: "https://x", model: "m", apiKey: "k" })).toBe(
      true,
    );
    expect(isVoiceVendorConfigComplete({ baseUrl: " ", model: "m", apiKey: "k" })).toBe(false);
    expect(isVoiceVendorConfigComplete({ baseUrl: "https://x", model: null, apiKey: "k" })).toBe(
      false,
    );
    expect(
      isVoiceVendorConfigComplete({ baseUrl: "https://x", model: "m", apiKey: undefined }),
    ).toBe(false);
  });
});

it("remote remains available without SpeechRecognition, missing fallback fails closed (§9.8)", () => {
  const inputs = {
    engine: "remote" as const,
    vendorConfigComplete: true,
    remoteSupported: true,
    webSpeechSupported: false,
  };
  expect(resolveAsrEngineChoice(inputs)).toBe("remote");
  expect(resolveAsrEngineChoice({ ...inputs, vendorConfigComplete: false })).toBeNull();
  expect(resolveAsrEngineChoice({ ...inputs, remoteSupported: false })).toBeNull();
  expect(resolveAsrEngineChoice({ ...inputs, engine: "webSpeech" })).toBeNull();
});
