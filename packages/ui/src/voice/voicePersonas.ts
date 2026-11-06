/**
 * 播报角色（persona）v1 builtin 目录（specs/voice-agent-integration.md §9.7.8）。
 *
 * 机制（冻结；模型能力收敛后双存储形态）：4 个 builtin 预设 + 「自定义」派生档；
 * 选择角色 = 成对物化写——appSettings 四行为键（音色/语速/播报语言 + voicePersonaId）
 * + 模型能力档案 tts.voice（云音色，specs/model-capabilities.md §5.2）；
 * `voicePersonaId` 仅作设置面显示当前选择，运行时零读路径（消费链只读底层键）；
 * 双引擎双轨音色（systemVoiceHint → voiceAnnouncementVoice、cloudVoice → 档案
 * tts.voice）；角色不影响打断词表。
 *
 * 目录内容（建议，待拍板——spec §9.7.8-2）：rate/lang 按 spec 建议落值；systemVoiceHint
 * /cloudVoice 现均为空串 = 自动（system=系统默认音色、cloud=厂商默认音色）——系统音色
 * 名需目标平台实测枚举（TV-9 真机矩阵未执行，miss 即走既有失配回落，hint 语义=尽力
 * 匹配），cloud 音色 id 依赖厂商音色枚举抓取（OQ-9，默认厂商 SiliconFlow 音色集），
 * 抓取前相关字段留空串=自动（spec 明示的落地口径）。名称走 i18n 静态键
 * voice.settings.persona.preset.<id>（EG-4 静态清单模式，不做动态键）。
 */

import type { AppSettings } from "@drora/shared";

/** 目录条目形状（§9.7.8-1）。 */
export interface VoicePersonaPreset {
  readonly id: string;
  readonly labelKey: string;
  /** "" = 自动（跟随 UI locale）；显式值 = persona 定档语言。 */
  readonly lang: "" | "zh-CN" | "en-US";
  readonly rate: number;
  /** 云轨厂商音色 id；"" = 厂商默认音色。 */
  readonly cloudVoice: string;
  /** system 轨系统音色名（尽力匹配，miss 走失配回落）；"" = 系统默认音色。 */
  readonly systemVoiceHint: string;
}

/** 4 个 builtin ∈ 复审建议区间 3–5（§9.7.8-2）。 */
export const VOICE_PERSONA_PRESETS: readonly VoicePersonaPreset[] = [
  {
    id: "standard",
    labelKey: "voice.settings.persona.preset.standard",
    lang: "",
    rate: 1,
    cloudVoice: "",
    systemVoiceHint: "",
  },
  {
    id: "brisk",
    labelKey: "voice.settings.persona.preset.brisk",
    lang: "",
    rate: 1.3,
    cloudVoice: "",
    systemVoiceHint: "",
  },
  {
    id: "composed",
    labelKey: "voice.settings.persona.preset.composed",
    lang: "",
    rate: 0.85,
    cloudVoice: "",
    systemVoiceHint: "",
  },
  {
    id: "narration",
    labelKey: "voice.settings.persona.preset.narration",
    // 「讲述」定档中文（spec 建议「lang 定档」未拍板具体语言；本仓主 locale zh-CN，
    // 待拍板后此处单行可改）。
    lang: "zh-CN",
    rate: 1,
    cloudVoice: "",
    systemVoiceHint: "",
  },
];

/** 「自定义」派生档哨兵——UI 本地显示值，绝不写入 voicePersonaId（落盘只会是 builtin id 或 ""）。 */
export const VOICE_PERSONA_CUSTOM_ID = "custom";

export function findVoicePersonaPreset(id: string | null | undefined): VoicePersonaPreset | null {
  if (!id) {
    return null;
  }
  return VOICE_PERSONA_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * 行为偏好物化 patch（§9.7.8-3 / V7-a；appSettings 四键）：点选 builtin P 时与
 * buildVoicePersonaCapabilityPatch（档案 tts.voice）成对调用；空串原样物化（= 自动）。
 * 空串清写即「重置该轨为自动」——「自定义」不清底层键由不调用本函数保证（派生档不可点选）。
 *
 * 模型能力收敛（specs/model-capabilities.md §3.3/§5.2，批次二）：云音色
 * voiceTtsVendorVoice 旧键删除，cloud 轨物化迁至模型能力档案 tts.voice
 * （buildVoicePersonaCapabilityPatch）；本 patch 只写 appSettings 行为偏好键。
 */
export function buildVoicePersonaPatch(preset: VoicePersonaPreset): {
  voicePersonaId: string;
  voiceAnnouncementVoice: string;
  voiceAnnouncementRate: number;
  voiceAnnouncementLang: string;
} {
  return {
    voicePersonaId: preset.id,
    // system 轨音色留 appSettings（行为偏好）；cloud 轨见 capability patch。
    voiceAnnouncementVoice: preset.systemVoiceHint,
    voiceAnnouncementRate: preset.rate,
    voiceAnnouncementLang: preset.lang,
  };
}

/** cloud 轨物化 patch（模型能力档案 tts.voice；与 buildVoicePersonaPatch 成对调用）。 */
export function buildVoicePersonaCapabilityPatch(preset: VoicePersonaPreset): {
  tts: { voice: string };
} {
  return { tts: { voice: preset.cloudVoice } };
}

/** 显示派生结果：id = 命中 builtin id 或「自定义」哨兵；preset 仅命中时非空。@lintignore */
export interface VoicePersonaSelection {
  readonly id: string;
  readonly preset: VoicePersonaPreset | null;
}

/**
 * 「自定义」派生判定（§9.7.8-4 / V7-c）：voicePersonaId 命中 builtin 且四底层键与该
 * preset 物化值逐项相等 → 显示该 preset；否则（未选/未知 id/任一键发散）→ 「自定义」。
 * 只读不写——发散不回写 voicePersonaId（各底层键控件保持 persona 无感知，零耦合）。
 *
 * 云音色腿读模型能力档案 tts.voice（specs/model-capabilities.md §5.2，经
 * useModelCapabilities 注入；AppSettings 旧键已删除）。
 */
export function resolveVoicePersonaSelection(
  settings:
    | Pick<
        AppSettings,
        | "voicePersonaId"
        | "voiceAnnouncementVoice"
        | "voiceAnnouncementRate"
        | "voiceAnnouncementLang"
      >
    | null
    | undefined,
  ttsVendorVoice: string | null | undefined,
): VoicePersonaSelection {
  const preset = findVoicePersonaPreset(settings?.voicePersonaId);
  if (!preset) {
    return { id: VOICE_PERSONA_CUSTOM_ID, preset: null };
  }
  const materialized = buildVoicePersonaPatch(preset);
  const diverged =
    (settings?.voiceAnnouncementVoice ?? "") !== materialized.voiceAnnouncementVoice ||
    (ttsVendorVoice ?? "") !== preset.cloudVoice ||
    (settings?.voiceAnnouncementRate ?? 1) !== materialized.voiceAnnouncementRate ||
    (settings?.voiceAnnouncementLang ?? "") !== materialized.voiceAnnouncementLang;
  if (diverged) {
    return { id: VOICE_PERSONA_CUSTOM_ID, preset: null };
  }
  return { id: preset.id, preset };
}
