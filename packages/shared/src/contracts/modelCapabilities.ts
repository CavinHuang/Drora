/**
 * 模型能力档案契约（specs/model-capabilities.md §3；F-1/F-3）。
 *
 * 契约键单一出处（AGENTS.md）：档案文件名、purpose 枚举、凭据键、档案 schema、
 * 旧键迁移映射只在 shared/contracts 的本常量区定义一次；生产方（services 档案服务、
 * Host 装配）与消费方（UI 设置表单、语音适配器）引用同一常量，禁止两处独立写字面量；
 * 改名任何一侧前先全链 grep 生产与消费。
 *
 * 自 knowledge-jev.ts 迁入的所有权（批次一所有权翻转，批次二收尾完成）：本文件是
 * Jev 提供商枚举/类型与档案契约的唯一出处；knowledge-jev.ts shim 与三个旧凭据常量
 * 导出名已随批次二（UI 旧表单删除）原子收尾，旧键值仅存迁移表冻结字面量。
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 持久化位置键（F-1：单一文件 ~/.drora/v2/model_capabilities.json，存 getAppConfigDir()）
// ---------------------------------------------------------------------------

/** 档案持久化文件名（存 getAppConfigDir() = ~/.drora/v2/）。 */
export const MODEL_CAPABILITIES_FILE_NAME = "model_capabilities.json";

// ---------------------------------------------------------------------------
// purpose 枚举（条目固定五类，顺序即 UI 呈现顺序）
// ---------------------------------------------------------------------------

export const MODEL_CAPABILITY_PURPOSES = [
  "decision-jev", // 知识评分（System One 线协议）
  "embedding", // 语义嵌入（V1 仅本地形态）
  "asr", // 语音识别
  "tts", // 语音合成
  "image-generation", // 图像生成（本次新增）
] as const;

export type ModelCapabilityPurpose = (typeof MODEL_CAPABILITY_PURPOSES)[number];

// ---------------------------------------------------------------------------
// Jev 决策提供商（自 knowledge-jev.ts 迁入；值不变）
// ---------------------------------------------------------------------------

/**
 * Jev 决策模型提供商（缺省 typesafe）。systemOne 是 Jev 全生态唯一线协议——
 * 提供商之间只有端点部署、凭据与模型别名的差异；openrouter / ai-gateway 的
 * baseURL 由发行方文档/部署方提供、必填。决策模型与 agent 聊天模型相互独立。
 */
export const KNOWLEDGE_JEV_PROVIDERS = ["typesafe", "openrouter", "ai-gateway"] as const;
export type KnowledgeJevProvider = (typeof KNOWLEDGE_JEV_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// 凭据键（F-1：apiKey 一律走 ICredentialService 加密，绝不进档案文件）
// ---------------------------------------------------------------------------

/**
 * 凭据键（spec §13 重构后仅剩 decision-jev：线协议不适用供应商卡，维持自含）。
 * asr/tts/image-generation 的 apiKey 自 §13 起复用官方供应商卡（provider_config.json
 * 经 providerSettingsFacade 读取），不再有独立凭据键；旧键仅存迁移表冻结字面量。
 */
export const modelCapabilityCredentialKey = {
  decisionJev: (providerKind: KnowledgeJevProvider) =>
    `model-capabilities:decision-jev:${providerKind}:api-key`,
} as const;

// ---------------------------------------------------------------------------
// 档案 schema（spec §3.2：zod 在 shared 定义，services 持久化时校验）
// ---------------------------------------------------------------------------

/**
 * 档案文件 schema。非敏感字段（baseUrl、modelId、engine、enabled）进档案文件明文；
 * apiKey 一律不进档案文件，只在 credentialService。
 *
 * - providerKind 带 catch：坏值降级 typesafe 而非整文件判废；
 * - embedding.mode 仅 local（"remote" 为 schema 预留，V1 解析 fail-closed 拒绝）；
 * - 条件必填（asr engine=remote 时 baseUrl 必填、image-generation enabled 时
 *   baseUrl/modelId 必填等）不在 schema 展开——由消费方按 fail-closed 语义校验
 *   （与现 jevAssembly「缺必填即禁用」一致）。
 */
export const modelCapabilitiesFileSchema = z.object({
  schemaVersion: z.literal(2),
  capabilities: z.object({
    "decision-jev": z.object({
      enabled: z.boolean().default(false),
      providerKind: z.enum(KNOWLEDGE_JEV_PROVIDERS).catch("typesafe"),
      // 三供应商共用一对可选字段；解析时按 providerKind 取（与现 jevAssembly 语义一致）：
      // typesafe: baseUrl（空=官方默认 https://api.typesafe.ai）
      // openrouter / ai-gateway: baseUrl（空=内置默认）+ modelId 必填
      baseUrl: z.string().default(""),
      modelId: z.string().default(""),
    }),
    embedding: z.object({
      enabled: z.boolean().default(false),
      mode: z.literal("local"), // "remote" 为 schema 预留，V1 解析器 fail-closed 拒绝
      localModelId: z.literal("local-bge-small-zh-v1.5-int8"),
    }),
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
      "decision-jev": { enabled: false, providerKind: "typesafe", baseUrl: "", modelId: "" },
      embedding: { enabled: false, mode: "local", localModelId: "local-bge-small-zh-v1.5-int8" },
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

/** 凭据补丁（§13 后仅 decision-jev）：value 为 null（或空串，ApiKeyRow「留空保存即删除」语义）= 删除该键。 */
interface ModelCapabilitiesCredentialPatch {
  /** decision-jev 按 providerKind 分键写删。 */
  decisionJev?: { providerKind: KnowledgeJevProvider; value: string | null };
}

export interface ModelCapabilitiesUpdate {
  capabilities?: ModelCapabilityEntriesPatch;
  credentials?: ModelCapabilitiesCredentialPatch;
}

// ---------------------------------------------------------------------------
// 旧键迁移映射（spec §3.3，F-7 一次性；迁移后旧键删除，不做降级兼容）
// ---------------------------------------------------------------------------

/** 旧 AppSettings 键全集（14 键；批次二随 schema 删除，此清单是迁移与删键的唯一出处）。 */
export const MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS = [
  "knowledgeJevEnabled",
  "knowledgeJevProvider",
  "knowledgeJevBaseUrl",
  "knowledgeJevOpenrouterModel",
  "knowledgeJevOpenrouterBaseUrl",
  "knowledgeJevAiGatewayModel",
  "knowledgeJevAiGatewayBaseUrl",
  "knowledgeSemanticEnabled",
  "voiceAsrEngine",
  "voiceVendorBaseUrl",
  "voiceAsrVendorModel",
  "voiceTtsEngine",
  "voiceTtsVendorModel",
  "voiceTtsVendorVoice",
] as const;

/**
 * 旧凭据键 → 新凭据键映射（decision-jev 三键一一对应；voice 单键双写 asr+tts）。
 *
 * 批次二收尾（spec §3.3）：旧 AppSettings 14 键与旧凭据键（含 voice:vendor:api-key）
 * 已从运行时消费面删除，此处键值降级为冻结字面量（迁移表唯一出处；不再作为
 * 运行时凭据键导出——生产/消费一律走 modelCapabilityCredentialKey 新键）。
 */
export const MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS = {
  decisionJev: {
    /** 原 KNOWLEDGE_JEV_CREDENTIAL_KEY（knowledge-jev.ts 三键，批次一翻转迁入后随批次二删除导出）。 */
    typesafe: "knowledge-jev:typesafe-api-key",
    openrouter: "knowledge-jev:openrouter-api-key",
    "ai-gateway": "knowledge-jev:ai-gateway-api-key",
  },
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
