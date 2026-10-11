/**
 * Jev 决策引擎契约常量（specs/obsidian-knowledge.md §5d.10）。
 *
 * 跨包契约键单一出处：凭据持久化键只能在这里定义一次，
 * 生产方（services Host 装配）与消费方（ui 设置表单）引用同一常量。
 */

/** TypeSafe API Key 在 credentialService（加密 credentials.json）中的持久化键。 */
export const KNOWLEDGE_JEV_CREDENTIAL_KEY = "knowledge-jev:typesafe-api-key";
