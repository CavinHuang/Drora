/**
 * 模型能力档案契约（specs/model-capabilities.md §3；F-1/F-3）。
 *
 * 契约键单一出处（AGENTS.md）：档案文件名、purpose 枚举、凭据键、档案 schema、
 * 旧键迁移映射只在 shared/contracts 的本常量区定义一次；生产方（services 档案服务、
 * Host 装配）与消费方（UI 设置表单、语音适配器）引用同一常量，禁止两处独立写字面量；
 * 改名任何一侧前先全链 grep 生产与消费。
 *
 * P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C11，D8 建议值先行）：
 * decision-jev（知识评分）与 embedding（本地语义嵌入）两个 purpose 随 knowledge 栈
 * 迁插件拆除——插件侧配置走 userConfig 静态注入（android 先例；接线待 D8 终裁后的
 * 补批）。旧档案文件中的这两键由 schema 解析侧 strip（未知键），不做迁移映射；
 * 旧 AppSettings 的 Jev 系列 7 键与语义开关 1 键的键值**丢弃**（迁移注记：
 * 终裁若选「映射 userConfig」，由插件首启迁移补批按本注记落点补齐）。
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 持久化位置键（F-1：单一文件 ~/.drora/v2/model_capabilities.json，存 getAppConfigDir()）
// ---------------------------------------------------------------------------

/** 档案持久化文件名（存 getAppConfigDir() = ~/.drora/v2/）。 */
export const MODEL_CAPABILITIES_FILE_NAME = "model_capabilities.json";

// ---------------------------------------------------------------------------
// purpose 枚举（P7 后固定三类，顺序即 UI 呈现顺序）
// ---------------------------------------------------------------------------

export const MODEL_CAPABILITY_PURPOSES = [
  "asr", // 语音识别
  "tts", // 语音合成
  "image-generation", // 图像生成
] as const;

export type ModelCapabilityPurpose = (typeof MODEL_CAPABILITY_PURPOSES)[number];

// ---------------------------------------------------------------------------
// 凭据键（F-1：apiKey 一律走 ICredentialService 加密，绝不进档案文件）
// ---------------------------------------------------------------------------
// P7（spec §1-C11）：decision-jev 凭据键 builder（model-capabilities:decision-jev:*
// 与旧 knowledge-jev:* 键）随 Jev 能力节点拆除——插件侧凭据走 userConfig sensitive
// 注入（D8）；asr/tts/image-generation 的 apiKey 复用官方供应商卡（§13），本域已无
// 自含凭据键。

// ---------------------------------------------------------------------------
// 档案 schema（spec §3.2：zod 在 shared 定义，services 持久化时校验）
// ---------------------------------------------------------------------------

/**
 * 档案文件 schema。非敏感字段（baseUrl、modelId、engine、enabled）进档案文件明文；
 * apiKey 一律不进档案文件，只在 credentialService。
 *
 * - 条件必填（asr engine=remote 时 baseUrl 必填、image-generation enabled 时
 *   baseUrl/modelId 必填等）不在 schema 展开——由消费方按 fail-closed 语义校验
 *   （与现 jevAssembly「缺必填即禁用」一致）。
 */
export const modelCapabilitiesFileSchema = z.object({
  schemaVersion: z.literal(2),
  // P7（spec §1-C11）：decision-jev/embedding 两节点删除；旧档案文件残留的这两键按
  // 未知键 strip（zod object 非严格对象默认透传丢弃），不做迁移映射（见文件头注记）。
  capabilities: z.object({
    // §13 引用式条目：供应商卡（官方模型管理）持有 baseUrl+apiKey，条目只存路由
    // （providerRef=providerId）与模型选择；baseUrlOverride 留空继承供应商卡
    // （手填覆盖优先，spec §13.4），网关分域名边缘用。
    asr: z.object({
      engine: z.enum(["webSpeech", "remote"]).default("webSpeech"),
      providerRef: z.string().default(""), // engine=remote 时必填（指向 provider_config 的 providerId）
      modelId: z.string().default(""),
      baseUrlOverride: z.string().default(""),
    }),
    tts: z.object({
      engine: z.enum(["system", "cloud"]).default("system"),
      providerRef: z.string().default(""),
      modelId: z.string().default(""),
      voice: z.string().default(""),
      baseUrlOverride: z.string().default(""),
    }),
    "image-generation": z.object({
      enabled: z.boolean().default(false),
      providerRef: z.string().default(""), // enabled=true 时必填
      modelId: z.string().default(""), // enabled=true 时必填（如 cogview-4-flash、dall-e-3）
      baseUrlOverride: z.string().default(""),
    }),
  }),
  /** 旧 AppSettings 14 键 + 旧凭据 5 键一次性迁移标记（spec §3.3；true = 已迁移，跳过）。 */
  migratedFromLegacySettings: z.boolean().default(false),
  /** §13 供应商引用式迁移标记：true = 旧自含键已自动建卡并转 providerRef。 */
  migratedToProviderRef: z.boolean().default(false),
});

/** 档案文件（解析后；所有 default 已物化）。 */
export type ModelCapabilitiesFile = z.infer<typeof modelCapabilitiesFileSchema>;

/** 档案能力面（capabilities 子对象；UI 与消费方读的快照形状）。 */
export type ModelCapabilities = ModelCapabilitiesFile["capabilities"];

/** 全默认档案（文件缺失/损坏降级与迁移基线共用同一出处；所有字段显式物化）。 */
export function defaultModelCapabilitiesFile(): ModelCapabilitiesFile {
  return {
    schemaVersion: 2,
    capabilities: {
      asr: { engine: "webSpeech", providerRef: "", modelId: "", baseUrlOverride: "" },
      tts: { engine: "system", providerRef: "", modelId: "", voice: "", baseUrlOverride: "" },
      "image-generation": { enabled: false, providerRef: "", modelId: "", baseUrlOverride: "" },
    },
    migratedFromLegacySettings: false,
    migratedToProviderRef: false,
  };
}

// ---------------------------------------------------------------------------
// update(patch) 补丁形状（spec §4：写路径唯一 update；浅合并到对应 purpose 条目）
// ---------------------------------------------------------------------------

/** 单条目浅合并补丁：字段缺省 = 不改动该字段。 */
export type ModelCapabilityEntriesPatch = {
  [K in ModelCapabilityPurpose]?: Partial<ModelCapabilities[K]>;
};

// P7（spec §1-C11）：凭据补丁面随 decision-jev 凭据键拆除——本域已无自含凭据键
//（asr/tts/image-generation 走官方供应商卡，§13）。
export interface ModelCapabilitiesUpdate {
  capabilities?: ModelCapabilityEntriesPatch;
}

// ---------------------------------------------------------------------------
// 旧键迁移映射（spec §3.3，F-7 一次性；迁移后旧键删除，不做降级兼容）
// ---------------------------------------------------------------------------

/**
 * 旧 AppSettings 键清单（P7 后仅剩 voice 6 键；此清单是迁移与删键的唯一出处）。
 * knowledgeJev* 7 键与 knowledgeSemanticEnabled 已随 Jev/embedding 能力节点拆除
 * （spec §1-C11）：旧键值按 D8 注记丢弃，不再列入迁移/删键清单——setting.json 中的
 * 残留键由 appSettings schema 的 strip 语义在下次任意设置写盘时一并物理清除。
 */
export const MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS = [
  "voiceAsrEngine",
  "voiceVendorBaseUrl",
  "voiceAsrVendorModel",
  "voiceTtsEngine",
  "voiceTtsVendorModel",
  "voiceTtsVendorVoice",
] as const;

/**
 * 旧凭据键 → 新凭据键映射（P7 后仅剩 voice 单键双写 asr+tts 与 §13 自含三键）。
 *
 * 冻结字面量（迁移表唯一出处；不作为运行时凭据键导出）。
 */
export const MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS = {
  // P7（spec §1-C11）：decision-jev 三旧凭据键（knowledge-jev:*）随 Jev 节点拆除——
  // 键值丢弃（D8 注记：终裁选映射 userConfig 时由插件首启迁移补批处理）。
  /** 原 VOICE_VENDOR_CREDENTIAL_KEY（contracts/voice.ts，随 voice 契约收窄删除导出）。 */
  voiceVendor: "voice:vendor:api-key",
  /**
   * §13 前的自含凭据键（v1 档案时代，asr/tts/image-generation 各一键）。迁移器按条目
   * baseUrl 自动建供应商卡时把值导入卡片，随后删除这些键；此处为迁移表冻结字面量。
   */
  selfContained: {
    asr: "model-capabilities:asr:api-key",
    tts: "model-capabilities:tts:api-key",
    imageGeneration: "model-capabilities:image-generation:api-key",
  },
} as const;
