export const teamUiModule = {
  id: "ui-team",
  requires: ["ui", "shared", "services"], // workspace-config-catalog-sync 订阅 Host 装配事实
  provides: ["agents-team-panel"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
