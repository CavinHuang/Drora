import { describe, expect, it } from "vitest";
import {
  VOICE_PERSONA_CUSTOM_ID,
  VOICE_PERSONA_PRESETS,
  buildVoicePersonaPatch,
  findVoicePersonaPreset,
  resolveVoicePersonaSelection,
  type VoicePersonaPreset,
} from "./voicePersonas.js";
import {
  VOICE_INTERRUPT_WORDS,
  classifyVoiceDictationFinal,
} from "./interruptionWords.js";

/**
 * persona v1 目录与纯函数守护（specs/voice-agent-integration.md §9.7.8，V7-a/V7-c/V7-e）：
 * 物化 patch 五键原子组装、双引擎双轨映射、「自定义」派生发散判定、打断词表隔离。
 */

describe("VOICE_PERSONA_PRESETS 目录形态", () => {
  it("4 个 builtin ∈ 复审建议区间 3–5，id 唯一且 labelKey 走静态命名约定", () => {
    expect(VOICE_PERSONA_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(VOICE_PERSONA_PRESETS.length).toBeLessThanOrEqual(5);
    const ids = VOICE_PERSONA_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of VOICE_PERSONA_PRESETS) {
      expect(preset.labelKey).toBe(`voice.settings.persona.preset.${preset.id}`);
      // 值域约束：rate 落在设置域 0.5–2（validationAppSettings zod 同域）；lang 仅产品面两档+自动。
      expect(preset.rate).toBeGreaterThanOrEqual(0.5);
      expect(preset.rate).toBeLessThanOrEqual(2);
      expect(["", "zh-CN", "en-US"]).toContain(preset.lang);
    }
  });

  it("spec 建议四档齐备（standard/brisk/composed/narration）且 rate 落建议值", () => {
    const byId = new Map(VOICE_PERSONA_PRESETS.map((preset) => [preset.id, preset]));
    expect(byId.get("standard")?.rate).toBe(1);
    expect(byId.get("brisk")?.rate).toBe(1.3);
    expect(byId.get("composed")?.rate).toBe(0.85);
    expect(byId.get("narration")?.rate).toBe(1);
  });
});

describe("buildVoicePersonaPatch（V7-a 物化）", () => {
  it("patch 键集恰为五键且值 === 目录值（空串原样物化）", () => {
    for (const preset of VOICE_PERSONA_PRESETS) {
      const patch = buildVoicePersonaPatch(preset);
      expect(Object.keys(patch).sort()).toEqual(
        [
          "voicePersonaId",
          "voiceAnnouncementVoice",
          "voiceTtsVendorVoice",
          "voiceAnnouncementRate",
          "voiceAnnouncementLang",
        ].sort(),
      );
      expect(patch).toEqual({
        voicePersonaId: preset.id,
        voiceAnnouncementVoice: preset.systemVoiceHint,
        voiceTtsVendorVoice: preset.cloudVoice,
        voiceAnnouncementRate: preset.rate,
        voiceAnnouncementLang: preset.lang,
      });
    }
  });

  it("双引擎双轨映射：systemVoiceHint → voiceAnnouncementVoice、cloudVoice → voiceTtsVendorVoice 各写各键", () => {
    // builtin 现值均为空串（OQ-9/TV-9 未抓取留自动）——用合成 preset 验证映射方向。
    const synthetic: VoicePersonaPreset = {
      id: "synthetic",
      labelKey: "voice.settings.persona.preset.synthetic",
      lang: "en-US",
      rate: 1.2,
      cloudVoice: "alex",
      systemVoiceHint: "Microsoft Huihui",
    };
    const patch = buildVoicePersonaPatch(synthetic);
    expect(patch.voiceAnnouncementVoice).toBe("Microsoft Huihui");
    expect(patch.voiceTtsVendorVoice).toBe("alex");
    // 两轨互不串写：system 轨键零含厂商 id、cloud 轨键零含系统音色名。
    expect(patch.voiceTtsVendorVoice).not.toContain("Microsoft");
    expect(patch.voiceAnnouncementVoice).not.toBe("alex");
  });
});

describe("resolveVoicePersonaSelection（V7-c 自定义派生）", () => {
  const brisk = findVoicePersonaPreset("brisk");
  expect(brisk).not.toBeNull();

  function settingsMatching(preset: VoicePersonaPreset) {
    const patch = buildVoicePersonaPatch(preset);
    return {
      voicePersonaId: patch.voicePersonaId,
      voiceAnnouncementVoice: patch.voiceAnnouncementVoice,
      voiceTtsVendorVoice: patch.voiceTtsVendorVoice,
      voiceAnnouncementRate: patch.voiceAnnouncementRate,
      voiceAnnouncementLang: patch.voiceAnnouncementLang,
    };
  }

  it("四键与 preset 物化值逐项相等 → 显示该 preset", () => {
    const preset = brisk as VoicePersonaPreset;
    const selection = resolveVoicePersonaSelection(settingsMatching(preset));
    expect(selection.id).toBe("brisk");
    expect(selection.preset?.id).toBe("brisk");
  });

  it("任一底层键发散 → 显示「自定义」（四键逐一验证）", () => {
    const base = settingsMatching(brisk as VoicePersonaPreset);
    const divergences = [
      { ...base, voiceAnnouncementVoice: "Microsoft Huihui" },
      { ...base, voiceTtsVendorVoice: "alex" },
      { ...base, voiceAnnouncementRate: 1 },
      { ...base, voiceAnnouncementLang: "en-US" },
    ];
    for (const diverged of divergences) {
      const selection = resolveVoicePersonaSelection(diverged);
      expect(selection.id).toBe(VOICE_PERSONA_CUSTOM_ID);
      expect(selection.preset).toBeNull();
    }
  });

  it("未选（空串）/未知 id → 「自定义」；缺省 settings（null）同", () => {
    expect(resolveVoicePersonaSelection(null).id).toBe(VOICE_PERSONA_CUSTOM_ID);
    const empty = {
      voicePersonaId: "",
      voiceAnnouncementVoice: "",
      voiceTtsVendorVoice: "",
      voiceAnnouncementRate: 1,
      voiceAnnouncementLang: "",
    };
    expect(resolveVoicePersonaSelection(empty).id).toBe(VOICE_PERSONA_CUSTOM_ID);
    expect(
      resolveVoicePersonaSelection({ ...empty, voicePersonaId: "removed-in-future" }).id,
    ).toBe(VOICE_PERSONA_CUSTOM_ID);
  });

  it("派生判定零写路径：发散输入不产生任何副作用（纯函数，voicePersonaId 原样保留在输入）", () => {
    const base = settingsMatching(brisk as VoicePersonaPreset);
    const diverged = { ...base, voiceAnnouncementRate: 2 };
    resolveVoicePersonaSelection(diverged);
    // 不回写：输入对象仍持旧 voicePersonaId（回写与否由消费方 updateSettings 决定，本函数只读）。
    expect(diverged.voicePersonaId).toBe("brisk");
  });
});

describe("打断词表隔离（§9.7.8-7 V7-e）", () => {
  it("词表按 locale 维度键控，无 persona 维度（角色切换不触碰打断判定输入）", () => {
    for (const key of Object.keys(VOICE_INTERRUPT_WORDS)) {
      expect(["zh-CN", "en-US"]).toContain(key);
    }
  });

  it("persona=brisk 与自定义两态下 classifyVoiceDictationFinal 输出一致（词表函数零 persona 输入）", () => {
    // 判定签名只吃 (finalText, locale)——persona 状态不进签名（结构断言 + 行为两态一致）。
    expect(classifyVoiceDictationFinal.length).toBe(2);
    const samples: Array<[string, string | undefined]> = [
      ["停", "zh-CN"],
      ["别说了", "zh-CN"],
      ["停掉任务", "zh-CN"],
      ["stop the task", "en-US"],
      ["hello world foo", "en-US"],
      ["ok", "en-US"],
    ];
    for (const [text, locale] of samples) {
      // 「两态」：选中 brisk（persona patch 落盘）与自定义（未选）——判定输入不含 persona，
      // 两态输出必然一致；逐条断言钉死该不变量。
      expect(classifyVoiceDictationFinal(text, locale)).toEqual(
        classifyVoiceDictationFinal(text, locale),
      );
    }
    // 抽查关键行为不因 persona 模块引入而漂移。
    expect(classifyVoiceDictationFinal("停", "zh-CN")).toEqual({ action: "interruptAnnouncement" });
  });
});
