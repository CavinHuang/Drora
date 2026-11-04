/**
 * cli-persona-service 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 * provider＝评测 harness（tests/persona/eval/model-access.ts）手搭 ProviderRegistry 的
 * 真实链路依赖（spec §13 第十四批），随 eval 测试目录归属本模块一并声明。
 */
export const cliPersonaServiceModule = {
  id: "cli-persona-service",
  requires: ["cli-persona-domain", "cli-persona-store", "drora-cli", "provider", "shared"],
  provides: ["cli-persona-service"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
