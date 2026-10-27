export const moduleDefinition = {
  id: "desktop-drora-extensions",
  requires: ["desktop", "services", "shared"],
  provides: ["desktop-drora-extensions"],
  publicEntrypoints: ["contract.ts", "desktopPet.ts", "updateFeed.ts"],
} as const;
