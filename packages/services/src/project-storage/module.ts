/**
 * project-storage 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const projectStorageModule = {
  id: "project-storage",
  requires: ["shared", "sqlite-migrations", "services", "session", "task-groups"],
  provides: ["project-storage"],
  // S8 对齐上游 v3.18.0 policy：tasksDatabase 根下的迁移与预编译语句是模块公开入口
  // （清单条目按模块根相对名，检查器对多根逐一根解析后与 policy 全路径比对）。
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "startup.ts",
    "startup-entry.ts",
    "migrations.ts",
    "prepared.ts",
  ],
} as const;
