/**
 * ui-drora-persona 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const moduleDefinition = {
  id: "ui-drora-persona",
  requires: ["ui", "shared", "services"],
  provides: ["ui-drora-persona"],
  publicEntrypoints: [
    "contract.ts",
    "PersonaSettingsSection.tsx",
    "usePersonaControlAvailability.ts",
  ],
} as const;
