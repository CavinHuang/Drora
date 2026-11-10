/** 只登记现有入口；实现位置与调用链保持不变。 */
export const marketingTouchControllerModule = {
  id: "marketing-touch-controller",
  requires: ["services", "shared", "ui"],
  provides: ["marketing-touch-controller"],
  // 模块根相对名（检查器按 roots 归一成 repo 相对后与 policy 比对；marketingTouchController
  // 落在第二个 file-root，用相对首个 root 的 ../ 路径表达）。
  publicEntrypoints: [
    "../components/marketing-touch/marketingTouchController.ts",
    "contract.ts",
  ],
} as const;
