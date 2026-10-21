export const moduleDefinition = {
  id: "ui-drora-extensions",
  requires: ["ui", "shared", "services", "web-remote-control-ui"], // RemoteControlDialog 包装 v3.16.1 新远控模块
  provides: ["ui-drora-extensions"],
  publicEntrypoints: ["contract.ts", "RemoteControlDialog.tsx", "WorkspaceMainView.tsx"],
} as const;
