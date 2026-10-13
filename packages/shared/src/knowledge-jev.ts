/**
 * Jev 决策引擎契约常量（specs/obsidian-knowledge.md §5d.10）。
 *
 * 跨包契约键单一出处：凭据持久化键与提供商枚举只能在这里定义一次，
 * 生产方（services Host 装配）与消费方（ui 设置表单）引用同一常量。
 */

/** TypeSafe API Key 在 credentialService（加密 credentials.json）中的持久化键。 */
export const KNOWLEDGE_JEV_CREDENTIAL_KEY = "knowledge-jev:typesafe-api-key";

/** OpenRouter API Key 持久化键（OpenRouter 侧 Jev 决策端点凭据；线协议同 systemOne，见 spec §5d.10）。 */
export const KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY = "knowledge-jev:openrouter-api-key";

/** AI Gateway API Key 持久化键（各网关部署自发行凭据；部署把 {网关route}/v1/systemone 代理到 Jev，见 spec §5d.10）。 */
export const KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY = "knowledge-jev:ai-gateway-api-key";

/**
 * Jev 决策模型提供商（缺省 typesafe）。systemOne 是 Jev 全生态唯一线协议——
 * 提供商之间只有端点部署、凭据与模型别名的差异（Jev 无 OpenAI 兼容端点）；
 * openrouter / ai-gateway 的 baseURL 由发行方文档/部署方提供、必填，不做
 * 「用户自填通用兼容端点」的泛化模式；决策模型与 agent 聊天模型相互独立。
 */
export const KNOWLEDGE_JEV_PROVIDERS = ["typesafe", "openrouter", "ai-gateway"] as const;
export type KnowledgeJevProvider = (typeof KNOWLEDGE_JEV_PROVIDERS)[number];
