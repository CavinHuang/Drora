export const moduleDefinition = {
  id: "services-drora-extensions",
  // P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C7）：
  // knowledgeHost / hostComponentsPresence 随本体 knowledge 栈拆除，本模块只剩
  // webhook / CUA agent env 两个自研扩展件。
  requires: ["services", "shared"],
  provides: ["services-drora-extensions"],
  publicEntrypoints: ["contract.ts", "cuaAgentEnvironment.ts", "webhookSecret.ts"],
} as const;
