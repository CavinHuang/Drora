/**
 * ui-mate 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const uiMateModule = {
  id: "ui-mate",
  requires: ["services", "shared", "ui"],
  provides: ["ui-mate"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
