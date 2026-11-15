export const agentPluginDiscoveryModule = {
  id: "agent-plugin-discovery",
  requires: ["shared", "drora-cli", "plugin-install-interaction"],
  provides: ["agent-plugin-discovery"],
  publicEntrypoints: ["contract.ts", "subscription.ts"],
} as const;
