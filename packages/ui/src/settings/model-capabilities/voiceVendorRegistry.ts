/**
 * 语音供应商模板注册表（specs/model-capabilities.md §15）。
 *
 * 社区成熟 UX（Open WebUI/LobeChat/SillyTavern/Cherry Studio 同构）：语音配置阶段
 * 直接选供应商 + 内置对应厂商音色。存储层维持 §13——模板只是供应商卡的**策展视图**
 * （matchHost 反查现有卡；缺卡自动建，Key 经 persistProviderApiKey 单点落卡）。
 *
 * 音色/模型预设全部取自官方文档原文（不凭记忆编造 ID，LobeChat 同构的厂商矩阵）：
 * - 火山引擎：docs.volcengine.com/docs/doubao-voice/tone-list-3（2026-11-05 查证），
 *   只取 moon_bigtts（1.0）与 uranus（2.0）两族——与 cloudTtsAdapter 的
 *   inferVolcanoResourceId 推断规则严格对齐；mars/jupiter 等其他族不收录。
 * - SiliconFlow：docs.siliconflow.cn text-to-speech（2026-11-05 查证），CosyVoice2
 *   官方八音色，value 为接口要求的完整「模型:音色」形态。
 * - OpenAI：platform.openai.com TTS 指南（2026-11-05 查证），tts-1/tts-1-hd/
 *   gpt-4o-mini-tts × 11 音色（6 经典 + ash/ballad/coral/sage/verse）。
 * - Groq：console.groq.com/docs/text-to-speech + speech-to-text（2026-11-05 经官方
 *   文档与多镜像交叉查证），playai-tts 音色 `<Name>-PlayAI` 形态（仅英文/阿拉伯语）；
 *   ASR whisper-large-v3(-turbo) 支持多语言。
 * - ElevenLabs：OpenAI 兼容 /v1/audio/speech（2026-11-05 查证，eleven_flash_v2_5
 *   等），**官方默认音色 ID（Rachel 等）已退役/限期下线**——不内置任何音色 ID，
 *   音色行保持自由填 Voice ID（控制台 Voice Library 获取）。
 */

import { VOICE_VENDOR_HOST_VOLCANO } from "@drora/shared";

/** 音色预设（value = 出站请求用的厂商原始 id；label = 下拉友好名）。 */
export interface VoiceVendorVoicePreset {
  id: string;
  label: string;
}

export type VoiceVendorApiKind = "tts" | "asr";

export interface VoiceVendorTemplate {
  vendorId: string;
  nameMap: Record<"zh-CN" | "en-US", string>;
  /** 无命中卡时程序化建卡的 baseUrl。 */
  canonicalBaseUrl: string;
  /** 卡 baseUrl 的 host 精确匹配（照 isVolcanoTtsEndpoint 口径）。 */
  matchHost: string;
  /** 该厂商 API Key 形态提示的 i18n 键。 */
  credentialHintKey: string;
  /** 该厂商适用的语音能力子集（火山 ASR 是另一条产品线协议，不适用）。 */
  apiKinds: ReadonlyArray<VoiceVendorApiKind>;
  voices: ReadonlyArray<VoiceVendorVoicePreset>;
  models: ReadonlyArray<string>;
  /** ASR 模型预设（OpenAI 兼容 /audio/transcriptions；火山 ASR 是另一条产品线协议 → 恒空）。 */
  asrModels: ReadonlyArray<string>;
}

export const VOICE_VENDOR_REGISTRY: ReadonlyArray<VoiceVendorTemplate> = [
  {
    vendorId: "volcano",
    nameMap: { "zh-CN": "火山引擎（豆包语音）", "en-US": "Volcano Engine (Doubao Voice)" },
    // §15.8：host 字面量单一出处（代理白名单/协议识别/建卡 canonical 同源派生），
    // 禁止独立写字面量。
    canonicalBaseUrl: `https://${VOICE_VENDOR_HOST_VOLCANO}`,
    matchHost: VOICE_VENDOR_HOST_VOLCANO,
    credentialHintKey: "settings.modelCapability.vendor.credentialHint.volcano",
    apiKinds: ["tts"],
    voices: [
      { id: "zh_female_wanwanxiaohe_moon_bigtts", label: "湾湾小何（台湾腔·女）" },
      { id: "zh_female_xiaohe_uranus_bigtts", label: "小何 2.0（女·多语种）" },
      { id: "zh_female_shuangkuaisisi_moon_bigtts", label: "爽快思思（女·中英）" },
      { id: "zh_female_shuangkuaisisi_uranus_bigtts", label: "爽快思思 2.0（女）" },
      { id: "zh_female_tianmeixiaoyuan_moon_bigtts", label: "甜美小源（女）" },
      { id: "zh_female_qingchezizi_moon_bigtts", label: "清澈梓梓（女）" },
      { id: "zh_female_qinqienv_uranus_bigtts", label: "亲切女声 2.0（女）" },
      { id: "zh_female_linjianvhai_uranus_bigtts", label: "邻家女孩 2.0（女）" },
      { id: "zh_male_taocheng_uranus_bigtts", label: "小天 2.0（男）" },
      { id: "zh_male_m191_uranus_bigtts", label: "云舟 2.0（男）" },
    ],
    // 火山协议的 speaker 即音色（条目 modelId 承载），无独立模型轴。
    models: [],
    asrModels: [],
  },
  {
    vendorId: "siliconflow",
    nameMap: { "zh-CN": "SiliconFlow（硅基流动）", "en-US": "SiliconFlow" },
    canonicalBaseUrl: "https://api.siliconflow.cn/v1",
    matchHost: "api.siliconflow.cn",
    credentialHintKey: "settings.modelCapability.vendor.credentialHint.siliconflow",
    apiKinds: ["tts", "asr"],
    voices: [
      { id: "FunAudioLLM/CosyVoice2-0.5B:alex", label: "Alex（沉稳男声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:benjamin", label: "Benjamin（低沉男声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:charles", label: "Charles（磁性男声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:david", label: "David（欢快男声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:anna", label: "Anna（沉稳女声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:bella", label: "Bella（激情女声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:claire", label: "Claire（温柔女声）" },
      { id: "FunAudioLLM/CosyVoice2-0.5B:diana", label: "Diana（欢快女声）" },
    ],
    models: ["FunAudioLLM/CosyVoice2-0.5B", "fnlp/MOSS-TTSD-v0.5"],
    asrModels: ["FunAudioLLM/SenseVoiceSmall", "TeleAI/TeleSpeechASR"],
  },
  {
    vendorId: "openai",
    nameMap: { "zh-CN": "OpenAI", "en-US": "OpenAI" },
    canonicalBaseUrl: "https://api.openai.com/v1",
    matchHost: "api.openai.com",
    credentialHintKey: "settings.modelCapability.vendor.credentialHint.openai",
    apiKinds: ["tts", "asr"],
    voices: [
      { id: "alloy", label: "Alloy（中性）" },
      { id: "ash", label: "Ash（温暖）" },
      { id: "ballad", label: "Ballad" },
      { id: "coral", label: "Coral（清亮）" },
      { id: "echo", label: "Echo（低沉）" },
      { id: "fable", label: "Fable（叙事）" },
      { id: "onyx", label: "Onyx（浑厚）" },
      { id: "nova", label: "Nova（明快）" },
      { id: "sage", label: "Sage（沉静）" },
      { id: "shimmer", label: "Shimmer" },
      { id: "verse", label: "Verse" },
    ],
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    asrModels: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  },
  {
    vendorId: "groq",
    nameMap: { "zh-CN": "Groq", "en-US": "Groq" },
    canonicalBaseUrl: "https://api.groq.com/openai/v1",
    matchHost: "api.groq.com",
    credentialHintKey: "settings.modelCapability.vendor.credentialHint.groq",
    apiKinds: ["tts", "asr"],
    voices: [
      { id: "Fritz-PlayAI", label: "Fritz（英语）" },
      { id: "Aaliyah-PlayAI", label: "Aaliyah（英语）" },
      { id: "Arista-PlayAI", label: "Arista（英语）" },
      { id: "Atlas-PlayAI", label: "Atlas（英语）" },
      { id: "Celeste-PlayAI", label: "Celeste（英语）" },
      { id: "Gail-PlayAI", label: "Gail（英语）" },
      { id: "Quinn-PlayAI", label: "Quinn（英语）" },
      { id: "Basil-PlayAI", label: "Basil（英语）" },
      { id: "Ahmad-PlayAI", label: "Ahmad（阿拉伯语）" },
      { id: "Amira-PlayAI", label: "Amira（阿拉伯语）" },
    ],
    models: ["playai-tts"],
    asrModels: ["whisper-large-v3", "whisper-large-v3-turbo"],
  },
  {
    vendorId: "elevenlabs",
    nameMap: { "zh-CN": "ElevenLabs", "en-US": "ElevenLabs" },
    canonicalBaseUrl: "https://api.elevenlabs.io/v1",
    matchHost: "api.elevenlabs.io",
    credentialHintKey: "settings.modelCapability.vendor.credentialHint.elevenlabs",
    // OpenAI 兼容端点仅 TTS（/audio/speech）；transcriptions 兼容性未核实故不登记 asr。
    apiKinds: ["tts"],
    // 官方默认音色 ID（Rachel 等）退役/限期下线——不内置任何 ID，音色行自由填
    // Voice ID（控制台 Voice Library 获取）。
    voices: [],
    models: ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5"],
    asrModels: [],
  },
];

/** 卡 baseUrl host 反查厂商模板（host 精确匹配，未命中返回 null = 自定义端点卡）。 */
export function resolveVoiceVendorForCard(
  baseUrl: string | null | undefined,
): VoiceVendorTemplate | null {
  if (!baseUrl) {
    return null;
  }
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return null;
  }
  return VOICE_VENDOR_REGISTRY.find((template) => template.matchHost === host) ?? null;
}

/** 模板本地化名（locale 缺失回落 en-US，再回落 vendorId）。 */
export function resolveVendorLocaleName(template: VoiceVendorTemplate, locale: string): string {
  return template.nameMap[locale as keyof typeof template.nameMap] ?? template.nameMap["en-US"];
}
