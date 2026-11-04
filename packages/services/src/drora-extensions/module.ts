export const moduleDefinition = {
  id: "services-drora-extensions",
  // services-model-capabilities：knowledgeHost 的 Jev/语义数据源切模型能力档案
  // （specs/model-capabilities.md §9 批次一），经其公共入口 index.ts 消费。
  requires: ["services", "shared", "services-model-capabilities"],
  provides: ["services-drora-extensions"],
  publicEntrypoints: [
    "contract.ts",
    "cuaAgentEnvironment.ts",
    "knowledgeHost.ts",
    "webhookSecret.ts",
  ],
} as const;
