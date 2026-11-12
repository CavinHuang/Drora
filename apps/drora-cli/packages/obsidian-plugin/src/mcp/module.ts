/**
 * obsidian-plugin-server 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const obsidianPluginServerModule = {
  id: "obsidian-plugin-server",
  // P5：src/ui/host.ts 引用 mcp-apps 契约常量（g9 方法名/widgetState/theme-locale 键）。
  requires: ["rpc", "shared", "mcp-apps-protocol"],
  provides: ["obsidian-plugin-server"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
