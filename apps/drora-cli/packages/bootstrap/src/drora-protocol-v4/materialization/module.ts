export const conversationMaterializationModule = {
  id: "cli-conversation-materialization",
  requires: ["shared", "drora-cli"],
  provides: ["cli-conversation-materialization"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
