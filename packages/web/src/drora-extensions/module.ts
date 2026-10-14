export const moduleDefinition = {
  id: "web-drora-extensions",
  requires: ["web"],
  provides: ["web-drora-extensions"],
  publicEntrypoints: ["contract.ts", "remoteEndpoint.ts"],
} as const;
