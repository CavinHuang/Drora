/** 只登记现有入口；实现位置与调用链保持不变。 */
export const embeddedBrowserPermissionModule = {
  id: "embedded-browser-permission",
  requires: ["desktop", "shared"],
  provides: ["embedded-browser-permission"],
  // 模块根相对名（policy 文件 root 用 ../ 相对首个 root 表达）。
  publicEntrypoints: [
    "../embeddedBrowserPermissionPolicy.ts",
    "contract.ts",
  ],
} as const;
