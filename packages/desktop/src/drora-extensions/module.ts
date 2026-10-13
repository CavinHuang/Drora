export const moduleDefinition = {
  id: "desktop-drora-extensions",
  requires: ["desktop", "services", "shared", "relay-server"],
  provides: ["desktop-drora-extensions"],
  publicEntrypoints: ["contract.ts", "remoteControl.ts", "desktopPet.ts", "updateFeed.ts"],
} as const;
