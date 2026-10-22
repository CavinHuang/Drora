import { describe, expect, it } from "vitest";
import {
  isVoiceAnnouncementEnabledInSettings,
  isVoiceComposerEntryVisibleInSettings,
  isVoicePrivacyAcknowledged,
  resolveVoiceComposerEntryView,
  resolveVoiceAnnouncementVoiceConfig,
  resolveVoiceDictationLang,
} from "./voiceComposerEntryState.js";

/**
 * 语音 composer 入口门控纯函数守护（specs/voice-agent-integration.md §6.1 / §9.2 验收
 * 「isWebRemoteControl 或 isSupported()=false 或入口隐藏 → mic 入口不渲染」+ FD-5 reader）。
 */
describe("resolveVoiceComposerEntryView", () => {
  const visibleInputs = {
    isWebRemoteControl: false,
    asrSupported: true,
    hiddenBySettings: false,
  };

  it("renders when supported, not remote, and not hidden", () => {
    expect(resolveVoiceComposerEntryView(visibleInputs)).toEqual({
      visible: true,
      tooltipMessageId: "voice.entry.mic.tooltip",
    });
  });

  it("does not render on the web remote control shell (§8.3)", () => {
    expect(
      resolveVoiceComposerEntryView({ ...visibleInputs, isWebRemoteControl: true }).visible,
    ).toBe(false);
  });

  it("does not render when the ASR engine is unsupported", () => {
    expect(
      resolveVoiceComposerEntryView({ ...visibleInputs, asrSupported: false }).visible,
    ).toBe(false);
  });

  it("does not render when hidden by settings (default hidden)", () => {
    expect(
      resolveVoiceComposerEntryView({ ...visibleInputs, hiddenBySettings: true }).visible,
    ).toBe(false);
  });
});

describe("settings readers (§6.1 / FD-5 两入口共用)", () => {
  it("keeps the composer entry hidden unless explicitly false", () => {
    expect(isVoiceComposerEntryVisibleInSettings(null)).toBe(false);
    expect(isVoiceComposerEntryVisibleInSettings(undefined)).toBe(false);
    expect(isVoiceComposerEntryVisibleInSettings({ voiceComposerEntryHidden: true })).toBe(false);
    expect(isVoiceComposerEntryVisibleInSettings({ voiceComposerEntryHidden: false })).toBe(true);
  });

  it("keeps the announcement off unless explicitly true", () => {
    expect(isVoiceAnnouncementEnabledInSettings(null)).toBe(false);
    expect(isVoiceAnnouncementEnabledInSettings({ voiceAnnouncementEnabled: true })).toBe(true);
  });

  it("treats privacy disclosure as unacknowledged unless explicitly true (FD-5)", () => {
    expect(isVoicePrivacyAcknowledged(null)).toBe(false);
    expect(isVoicePrivacyAcknowledged(undefined)).toBe(false);
    expect(isVoicePrivacyAcknowledged({ voicePrivacyDisclosureAcknowledged: false })).toBe(false);
    expect(isVoicePrivacyAcknowledged({ voicePrivacyDisclosureAcknowledged: true })).toBe(true);
  });
});

describe("resolveVoiceDictationLang", () => {
  it("follows the current locale when unconfigured", () => {
    expect(resolveVoiceDictationLang(null, "zh-CN")).toBe("zh-CN");
    expect(resolveVoiceDictationLang({ voiceDictationLang: "" }, "en-US")).toBe("en-US");
    expect(resolveVoiceDictationLang({ voiceDictationLang: "  " }, "en-US")).toBe("en-US");
  });

  it("uses the configured language when set (不硬编码)", () => {
    expect(resolveVoiceDictationLang({ voiceDictationLang: "zh-CN" }, "en-US")).toBe("zh-CN");
  });
});

describe("resolveVoiceAnnouncementVoiceConfig", () => {
  it("defaults to system voice and rate 1", () => {
    expect(resolveVoiceAnnouncementVoiceConfig(null)).toEqual({ rate: 1 });
    expect(
      resolveVoiceAnnouncementVoiceConfig({ voiceAnnouncementVoice: "", voiceAnnouncementRate: 1 }),
    ).toEqual({ rate: 1 });
  });

  it("passes configured voice and clamps invalid rates back to 1", () => {
    expect(
      resolveVoiceAnnouncementVoiceConfig({
        voiceAnnouncementVoice: " 晓琳 ",
        voiceAnnouncementRate: 1.5,
      }),
    ).toEqual({ voice: "晓琳", rate: 1.5 });
    expect(
      resolveVoiceAnnouncementVoiceConfig({ voiceAnnouncementVoice: "", voiceAnnouncementRate: 9 }),
    ).toEqual({ rate: 1 });
  });
});
