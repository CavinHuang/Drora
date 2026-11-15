// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  resolveOfficialVoiceButtonVisible,
  resolveVoiceComposerEntryView,
} from "./voiceComposerEntryState.js";
import { resolveAsrEngineChoice } from "./resolveAsrAdapter.js";

/**
 * §11 收编互斥门守护（specs/voice-agent-integration.md §11.2/§11.3，D6 升级）：
 * 官方 VoiceInputButton 渲染谓词（ConversationComposer 消费
 * resolveOfficialVoiceButtonVisible 单一出处）——自研 voice 入口可见时官方按钮
 * 不渲染；自研入口隐藏（默认态）时官方按钮照常渲染。
 *
 * E2E 兼容静态断言：官方 wdio 17 例（composer-voice-input.test.ts）运行在默认
 * 设置（voiceComposerEntryHidden=true，!== false 判定）——本测试钉住「默认态下
 * 自研入口不可见 → 门为真 → 官方按钮渲染条件成立」，任何使默认态门为假的改动
 * 都会先红在这里而不是 wdio 全量。
 */
describe("resolveOfficialVoiceButtonVisible（§11 收编互斥门谓词）", () => {
  it("自研入口可见 → 官方按钮不渲染（单入口：自研 mic 承载双引擎）", () => {
    expect(
      resolveOfficialVoiceButtonVisible({ officialAvailable: true, selfVoiceEntryVisible: true }),
    ).toBe(false);
  });

  it("自研入口隐藏且官方链路可用 → 官方按钮渲染", () => {
    expect(
      resolveOfficialVoiceButtonVisible({ officialAvailable: true, selfVoiceEntryVisible: false }),
    ).toBe(true);
  });

  it("官方链路不可用 → 恒不渲染（互斥门不改变既有可用性门）", () => {
    expect(
      resolveOfficialVoiceButtonVisible({ officialAvailable: false, selfVoiceEntryVisible: true }),
    ).toBe(false);
    expect(
      resolveOfficialVoiceButtonVisible({ officialAvailable: false, selfVoiceEntryVisible: false }),
    ).toBe(false);
  });
});

describe("互斥门输入派生（与自研入口共用 resolveVoiceComposerEntryView 单一派生）", () => {
  it("E2E 基线：默认设置（hidden=true → hiddenBySettings）+ 引擎可用 → 自研入口不可见 → 官方按钮渲染条件成立", () => {
    const view = resolveVoiceComposerEntryView({
      isWebRemoteControl: false,
      asrSupported: true,
      hiddenBySettings: true, // voiceComposerEntryHidden !== false（§6.1 开关 1 默认）
    });
    expect(view.visible).toBe(false);
    expect(
      resolveOfficialVoiceButtonVisible({
        officialAvailable: true,
        selfVoiceEntryVisible: view.visible,
      }),
    ).toBe(true);
  });

  it("用户开启自研入口（hidden=false）+ 引擎可用 → 自研可见 → 官方按钮让位", () => {
    const view = resolveVoiceComposerEntryView({
      isWebRemoteControl: false,
      asrSupported: true,
      hiddenBySettings: false,
    });
    expect(view.visible).toBe(true);
    expect(
      resolveOfficialVoiceButtonVisible({
        officialAvailable: true,
        selfVoiceEntryVisible: view.visible,
      }),
    ).toBe(false);
  });

  it("engine=official 且官方链路可用 → asrSupported 成立 → 自研入口可见（承载桥接引擎）", () => {
    // 与 useVoiceEntrySupport 同一解析入口：officialSupported=true 时 official 引擎
    // 不再回落，入口可见性按 official 判定（§11.2）。
    expect(
      resolveAsrEngineChoice({
        engine: "official",
        vendorConfigComplete: false,
        remoteSupported: false,
        webSpeechSupported: false,
        officialSupported: true,
      }),
    ).toBe("official");
    const view = resolveVoiceComposerEntryView({
      isWebRemoteControl: false,
      asrSupported: true,
      hiddenBySettings: false,
    });
    expect(view.visible).toBe(true);
    expect(
      resolveOfficialVoiceButtonVisible({
        officialAvailable: true,
        selfVoiceEntryVisible: view.visible,
      }),
    ).toBe(false);
  });

  it("engine=official 但官方链路不可用 → 回落 webSpeech（webSpeech 在场时入口仍在）", () => {
    expect(
      resolveAsrEngineChoice({
        engine: "official",
        vendorConfigComplete: false,
        remoteSupported: false,
        webSpeechSupported: true,
        officialSupported: false,
      }),
    ).toBe("webSpeech");
  });
});
