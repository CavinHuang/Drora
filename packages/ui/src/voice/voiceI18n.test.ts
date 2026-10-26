import { describe, expect, it } from "vitest";
import enUS from "../i18n/locales/en-US.js";
import zhCN from "../i18n/locales/zh-CN.js";
import { VOICE_CONSUMED_I18N_KEYS } from "./voiceI18nKeys.js";

/**
 * voice 模块 i18n 键守护（specs/voice-agent-integration.md §6.3，EG-4；照
 * team/i18n.test.ts 三断言先例）：双语键集一致 / 消费键存在非空 / 占位符同构。
 * 缺键会让 IntlProvider 回退渲染键名本身（E2E 说的「裸键」）。
 */

function voiceKeys(dictionary: Record<string, string>): string[] {
  return Object.keys(dictionary)
    .filter((key) => key === "settings.voice.title" || key.startsWith("voice."))
    .sort();
}

function placeholders(message: string): string[] {
  const found = message.match(/\{([a-zA-Z]+)\}/g) ?? [];
  return found.map((token) => token.slice(1, -1)).sort();
}

describe("voice i18n keys", () => {
  it("keeps zh-CN and en-US voice key sets identical", () => {
    expect(voiceKeys(zhCN)).toEqual(voiceKeys(enUS));
  });

  it("has a non-empty entry for every consumed voice key in both dictionaries", () => {
    for (const key of VOICE_CONSUMED_I18N_KEYS) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });

  it("keeps placeholders identical across locales for interpolated keys", () => {
    // 带插值的键：recordingIndicatorAria 的 {session}（绑定会话名）、
    // vendor.dataHandler 的 {baseUrl}（§9.6.2 数据处理方披露）。
    const interpolated = VOICE_CONSUMED_I18N_KEYS.filter(
      (key) => placeholders(zhCN[key] ?? "").length > 0,
    );
    expect(interpolated.sort()).toEqual(
      [
        "voice.brief.prefix",
        "voice.dictation.recordingIndicatorAria",
        "voice.settings.vendor.dataHandler",
      ].sort(),
    );
    for (const key of interpolated) {
      expect(placeholders(enUS[key] ?? ""), `en-US ${key}`).toEqual(placeholders(zhCN[key] ?? ""));
    }
  });
});

describe("§9.9.4-L12 remote ASR 文案与已实现能力一致", () => {
  it("remote ASR 引擎名不含「即将支持/coming soon」（§9.6 已实现）", () => {
    // 回退即红：恢复旧文案「云引擎（即将支持）/Cloud engine (coming soon)」则本用例红。
    expect(zhCN["voice.settings.asr.engine.remote"]).toBe("云引擎");
    expect(enUS["voice.settings.asr.engine.remote"]).toBe("Cloud engine");
    // 全 voice.* 命名空间零「即将支持/coming soon」残留。
    for (const [key, message] of Object.entries(zhCN)) {
      if (key.startsWith("voice.")) {
        expect(message, `zh-CN ${key}`).not.toContain("即将支持");
      }
    }
    for (const [key, message] of Object.entries(enUS)) {
      if (key.startsWith("voice.")) {
        expect(message, `en-US ${key}`).not.toContain("coming soon");
      }
    }
  });
});
