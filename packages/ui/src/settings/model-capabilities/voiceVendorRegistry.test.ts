import { describe, expect, it } from "vitest";
import {
  resolveVendorLocaleName,
  resolveVoiceVendorForCard,
  VOICE_VENDOR_REGISTRY,
} from "./voiceVendorRegistry.js";

/** 语音供应商模板注册表契约（specs/model-capabilities.md §15）。 */
describe("语音供应商模板注册表（specs/model-capabilities.md §15）", () => {
  it("host 反查：火山/SiliconFlow 命中，仿冒域/方舟域/非法串不命中", () => {
    expect(resolveVoiceVendorForCard("https://openspeech.bytedance.com")?.vendorId).toBe("volcano");
    expect(resolveVoiceVendorForCard("https://openspeech.bytedance.com/")?.vendorId).toBe(
      "volcano",
    );
    expect(resolveVoiceVendorForCard("https://api.siliconflow.cn/v1")?.vendorId).toBe(
      "siliconflow",
    );
    expect(resolveVoiceVendorForCard("https://openspeech.bytedance.com.evil.example")).toBeNull();
    // 方舟（Ark）是聊天线，≠ 语音线（openspeech）——不得命中。
    expect(
      resolveVoiceVendorForCard("https://ark.cn-beijing.volces.com/api/compatible"),
    ).toBeNull();
    expect(resolveVoiceVendorForCard(null)).toBeNull();
    expect(resolveVoiceVendorForCard("")).toBeNull();
    expect(resolveVoiceVendorForCard("not a url")).toBeNull();
  });

  it("能力子集：火山仅 tts（ASR 是另一条产品线协议）；SiliconFlow tts+asr", () => {
    const volcano = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "volcano");
    const siliconflow = VOICE_VENDOR_REGISTRY.find(
      (template) => template.vendorId === "siliconflow",
    );
    expect(volcano?.apiKinds).toEqual(["tts"]);
    expect(siliconflow?.apiKinds).toContain("tts");
    expect(siliconflow?.apiKinds).toContain("asr");
  });

  it("ASR 模型预设：SiliconFlow 提供（SenseVoice/TeleSpeech）；火山恒空（§15.2）", () => {
    const volcano = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "volcano");
    const siliconflow = VOICE_VENDOR_REGISTRY.find(
      (template) => template.vendorId === "siliconflow",
    );
    expect(volcano?.asrModels).toEqual([]);
    expect(siliconflow?.asrModels).toContain("FunAudioLLM/SenseVoiceSmall");
    expect(siliconflow?.asrModels).toContain("TeleAI/TeleSpeechASR");
  });

  it("火山音色预设只含 moon_bigtts/uranus 两族（与 inferVolcanoResourceId 推断规则对齐）且含湾湾小何", () => {
    const volcano = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "volcano");
    const voices = volcano?.voices ?? [];
    expect(voices.length).toBeGreaterThan(0);
    for (const voice of voices) {
      expect(voice.id.includes("moon_bigtts") || voice.id.includes("uranus")).toBe(true);
    }
    expect(voices.some((voice) => voice.id === "zh_female_wanwanxiaohe_moon_bigtts")).toBe(true);
  });

  it("音色/模型 id 各厂商内唯一（datalist/Select key 冲突防线）", () => {
    for (const template of VOICE_VENDOR_REGISTRY) {
      const voiceIds = template.voices.map((voice) => voice.id);
      expect(new Set(voiceIds).size).toBe(voiceIds.length);
      expect(new Set(template.models).size).toBe(template.models.length);
    }
  });

  it("SiliconFlow 音色为官方「模型:音色」完整形态", () => {
    const siliconflow = VOICE_VENDOR_REGISTRY.find(
      (template) => template.vendorId === "siliconflow",
    );
    for (const voice of siliconflow?.voices ?? []) {
      expect(voice.id.startsWith("FunAudioLLM/CosyVoice2-0.5B:")).toBe(true);
    }
  });

  it("本地化名：zh-CN 命中，未知 locale 回落 en-US", () => {
    const volcano = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "volcano");
    expect(resolveVendorLocaleName(volcano!, "zh-CN")).toContain("火山");
    expect(resolveVendorLocaleName(volcano!, "fr-FR")).toBe(volcano!.nameMap["en-US"]);
  });

  it("能力预设不变量：tts 厂商必有模型轴或音色预设；asr 厂商必有 asrModels（§15.2 厂商矩阵）", () => {
    // LobeChat 同构厂商矩阵：火山（音色轴）/ SiliconFlow / OpenAI / Groq / ElevenLabs。
    const vendorIds = VOICE_VENDOR_REGISTRY.map((template) => template.vendorId);
    expect(vendorIds).toEqual(
      expect.arrayContaining(["volcano", "siliconflow", "openai", "groq", "elevenlabs"]),
    );
    for (const template of VOICE_VENDOR_REGISTRY) {
      if (template.apiKinds.includes("tts")) {
        expect(
          template.models.length > 0 || template.voices.length > 0,
          `${template.vendorId} tts 需要模型轴或音色预设`,
        ).toBe(true);
      }
      if (template.apiKinds.includes("asr")) {
        expect(template.asrModels.length > 0, `${template.vendorId} asr 需要 asrModels`).toBe(true);
      }
    }
    // ElevenLabs：默认音色 ID 退役 → 不内置音色，tts 走模型轴。
    const elevenlabs = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "elevenlabs");
    expect(elevenlabs?.voices).toEqual([]);
    expect(elevenlabs?.apiKinds).toEqual(["tts"]);
    // OpenAI：11 音色 + 3 模型 + 3 ASR 模型（官方文档 2026-11-05 查证）。
    const openai = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "openai");
    expect(openai?.voices.map((voice) => voice.id)).toEqual(
      expect.arrayContaining(["alloy", "ash", "coral", "fable", "nova", "verse"]),
    );
    expect(openai?.models).toContain("gpt-4o-mini-tts");
    expect(openai?.asrModels).toContain("whisper-1");
    // Groq：playai-tts 音色 `-PlayAI` 后缀形态；ASR whisper 系。
    const groq = VOICE_VENDOR_REGISTRY.find((template) => template.vendorId === "groq");
    for (const voice of groq?.voices ?? []) {
      expect(voice.id.endsWith("-PlayAI")).toBe(true);
    }
    expect(groq?.models).toEqual(["playai-tts"]);
    expect(groq?.asrModels).toContain("whisper-large-v3");
  });
});
