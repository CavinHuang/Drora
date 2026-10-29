/**
 * shared-contracts 模块清单（architecture-governance managed 模块）。
 * 层：contract。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const sharedContractsModule = {
  id: "shared-contracts",
  requires: ["shared"],
  provides: ["shared-contracts"],
  publicEntrypoints: ["contract.ts", "desktopPet.ts", "voice.ts", "persona.ts"],
} as const;
