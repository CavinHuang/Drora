/**
 * cli-persona-domain 模块清单（architecture-governance managed 模块）。
 * 层：domain。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const cliPersonaDomainModule = {
  id: "cli-persona-domain",
  requires: ["drora-cli", "shared"],
  provides: ["cli-persona-domain"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
