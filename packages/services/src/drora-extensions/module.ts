export const moduleDefinition = {
  id: "services-drora-extensions",
  requires: ["services", "shared"],
  provides: ["services-drora-extensions"],
  publicEntrypoints: ["contract.ts", "cuaAgentEnvironment.ts", "knowledgeHost.ts"],
} as const;
