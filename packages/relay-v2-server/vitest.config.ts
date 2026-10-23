import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 只收集源码测试，避免 root `tsc -b` 产物 dist 下的编译副本被重复执行
    // （对照 drora-server-cli 的同款裁决）；contract.test.ts 是模块根上的治理五件套之一。
    include: ["test/**/*.test.ts", "contract.test.ts"],
  },
});
