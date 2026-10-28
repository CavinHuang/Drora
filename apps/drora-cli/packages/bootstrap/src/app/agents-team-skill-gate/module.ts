/**
 * agents-team-skill-gate 模块清单（architecture-governance managed 模块）。
 * 层：app（包装 skillPort 端口的纯装饰器，自身不做 IO）。修改 requires 时同步更新
 * architecture-policy.yaml（检查器会校验两者一致）。
 */
export const agentsTeamSkillGateModule = {
  // @drora/contracts 在 CLI 树内的依赖归属是 drora-cli（检查器推断，与 ui 树的 shared 不同）。
  id: "agents-team-skill-gate",
  requires: ["drora-cli"],
  provides: ["agents-team-skill-gate"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
