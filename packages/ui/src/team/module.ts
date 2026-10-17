export const teamUiModule = {
  id: "ui-team",
  requires: ["ui", "shared"],
  provides: ["agents-team-panel"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
