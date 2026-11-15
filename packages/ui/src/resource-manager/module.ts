/** 资源管理器现有 Host 采样与 UI 展示边界；不创建新的运行时 owner。 */
export const resourceManagerModule = {
  id: "resource-manager",
  requires: ["shared", "ui"],
  provides: ["resource-manager"],
  // S8 对齐上游 v3.18.0 policy：processResourceSampler.ts 是本模块的跨根公开入口
  // （第二根为该文件本身，检查器按根相对名解析，../ 回退到 services/src/process/）。
  publicEntrypoints: [
    "ResourceManagerApp.tsx",
    "contract.ts",
    "resourceUsageView.ts",
    "../processResourceSampler.ts",
  ],
} as const;
