/**
 * Jev 决策引擎契约常量（specs/obsidian-knowledge.md §5d.10）。
 *
 * 跨包契约键单一出处：凭据持久化键与提供商枚举只能在这里定义一次，
 * 生产方（services Host 装配）与消费方（ui 设置表单）引用同一常量。
 */

/** TypeSafe API Key 在 credentialService（加密 credentials.json）中的持久化键。 */
export const KNOWLEDGE_JEV_CREDENTIAL_KEY = "knowledge-jev:typesafe-api-key";

/** OpenRouter API Key 持久化键（openrouter.ai，自带协议：Bearer + vendor/model slug）。 */
export const KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY = "knowledge-jev:openrouter-api-key";

/** AI Gateway（Vercel）API Key 持久化键（ai-gateway.vercel.sh，自带协议：AI Gateway Key）。 */
export const KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY = "knowledge-jev:ai-gateway-api-key";

/**
 * Jev 决策模型提供商（缺省 typesafe）。每个具名提供商有各自的协议适配
 * （规范端点/鉴权/模型空间），不做「用户自填通用兼容端点」的泛化模式；
 * 决策模型与 agent 聊天模型相互独立。
 */
export const KNOWLEDGE_JEV_PROVIDERS = ["typesafe", "openrouter", "ai-gateway"] as const;
export type KnowledgeJevProvider = (typeof KNOWLEDGE_JEV_PROVIDERS)[number];
