import { describe, expect, it } from "vitest";
import {
  isVoiceAnnouncementEnabledInSettings,
  isVoiceComposerEntryVisibleInSettings,
  isVoicePrivacyAcknowledged,
  resolveVoiceComposerEntryView,
  resolveVoiceAnnouncementLang,
  nextExternalIndicatorActive,
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
    expect(resolveVoiceComposerEntryView({ ...visibleInputs, asrSupported: false }).visible).toBe(
      false,
    );
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
  // 模型能力收敛（specs/model-capabilities.md §5.2）：云音色第二参数注入（模型能力
  // 档案 tts.voice），AppSettings 旧键 voiceTtsVendorVoice 已删除。
  it("defaults to system voice and rate 1", () => {
    expect(resolveVoiceAnnouncementVoiceConfig(null, null)).toEqual({ rate: 1 });
    expect(
      resolveVoiceAnnouncementVoiceConfig(
        { voiceAnnouncementVoice: "", voiceAnnouncementRate: 1 },
        undefined,
      ),
    ).toEqual({ rate: 1 });
  });

  it("passes configured voice and clamps invalid rates back to 1", () => {
    expect(
      resolveVoiceAnnouncementVoiceConfig(
        {
          voiceAnnouncementVoice: " 晓琳 ",
          voiceAnnouncementRate: 1.5,
        },
        "",
      ),
    ).toEqual({ voice: "晓琳", rate: 1.5 });
    expect(
      resolveVoiceAnnouncementVoiceConfig(
        { voiceAnnouncementVoice: "", voiceAnnouncementRate: 9 },
        null,
      ),
    ).toEqual({ rate: 1 });
  });

  it("returns vendorVoice on the cloud track independently (§9.7.3 双轨)", () => {
    // 云音色非空：双轨同返回（speak 路由后适配器各取各轨）。
    expect(
      resolveVoiceAnnouncementVoiceConfig(
        {
          voiceAnnouncementVoice: "晓琳",
          voiceAnnouncementRate: 1,
        },
        " alex ",
      ),
    ).toEqual({ voice: "晓琳", vendorVoice: "alex", rate: 1 });
    // 云音色空/缺省：vendorVoice 字段缺省（= 厂商默认音色），system 轨零影响。
    expect(resolveVoiceAnnouncementVoiceConfig({ voiceAnnouncementVoice: "晓琳" }, "")).toEqual({
      voice: "晓琳",
      rate: 1,
    });
  });
});

describe("resolveVoiceAnnouncementLang (§9.7.5)", () => {
  it("follows the current UI locale when unconfigured（缺省语义零变化）", () => {
    expect(resolveVoiceAnnouncementLang(null, "zh-CN")).toBe("zh-CN");
    expect(resolveVoiceAnnouncementLang({ voiceAnnouncementLang: "" }, "en-US")).toBe("en-US");
    expect(resolveVoiceAnnouncementLang({ voiceAnnouncementLang: "  " }, "en-US")).toBe("en-US");
  });

  it("prefers the explicit value over the UI locale", () => {
    expect(resolveVoiceAnnouncementLang({ voiceAnnouncementLang: "en-US" }, "zh-CN")).toBe("en-US");
  });
});

describe("nextExternalIndicatorActive（§5.5 双模路由渲染侧）", () => {
  it("流式 recording 起点按主窗前台冻结：前台=窗口内浮层（不抑制），非前台=外置条", () => {
    // 前台起录：外置条不激活（窗口内浮层承载）。
    expect(
      nextExternalIndicatorActive({
        inputLeg: "recording",
        prevLeg: "requestingMic",
        isVolcanoStreaming: true,
        documentHasFocus: true,
        prev: false,
      }),
    ).toBe(false);
    // 非前台起录（对其他 App 听写）：外置条激活。
    expect(
      nextExternalIndicatorActive({
        inputLeg: "recording",
        prevLeg: "requestingMic",
        isVolcanoStreaming: true,
        documentHasFocus: false,
        prev: false,
      }),
    ).toBe(true);
  });

  it("腿中途焦点变化不切换（起点冻结语义）；idle 复位；非流式引擎恒不激活", () => {
    // 非前台起录后回前台（同腿重入）：冻结保持外置条（v1 简化）。
    expect(
      nextExternalIndicatorActive({
        inputLeg: "recording",
        prevLeg: "recording",
        isVolcanoStreaming: true,
        documentHasFocus: true,
        prev: true,
      }),
    ).toBe(true);
    // idle 复位。
    expect(
      nextExternalIndicatorActive({
        inputLeg: "idle",
        prevLeg: "recording",
        isVolcanoStreaming: true,
        documentHasFocus: true,
        prev: true,
      }),
    ).toBe(false);
    // 非流式（批量/混合预览）引擎：外置条不参与，prev 语义透传但 recording+非流式=prev。
    expect(
      nextExternalIndicatorActive({
        inputLeg: "recording",
        prevLeg: "requestingMic",
        isVolcanoStreaming: false,
        documentHasFocus: false,
        prev: false,
      }),
    ).toBe(false);
  });
});
