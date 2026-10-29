/**
 * cli-persona-service 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const cliPersonaServiceModule = {
  id: "cli-persona-service",
  requires: ["cli-persona-domain", "cli-persona-store", "drora-cli", "shared"],
  provides: ["cli-persona-service"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
