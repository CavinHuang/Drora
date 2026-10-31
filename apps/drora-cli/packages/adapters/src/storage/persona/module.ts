/**
 * cli-persona-store 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const cliPersonaStoreModule = {
  id: "cli-persona-store",
  requires: ["shared", "sqlite-migrations"],
  provides: ["cli-persona-store"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
