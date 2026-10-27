export const moduleDefinition = {
  id: "ui-drora-extensions",
  requires: ["ui", "shared", "services"],
  provides: ["ui-drora-extensions"],
  publicEntrypoints: ["contract.ts", "WorkspaceMainView.tsx"],
} as const;
