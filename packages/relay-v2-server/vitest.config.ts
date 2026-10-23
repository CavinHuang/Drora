import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 只收集源码测试，避免 root `tsc -b` 产物 dist 下的编译副本被重复执行
    // （对照 drora-server-cli 的同款裁决）；contract.test.ts 是模块根上的治理五件套之一。
    include: ["test/**/*.test.ts", "contract.test.ts"],
    // 关闭文件级并行：本包全部是「真实 loopback 服务器 + 真实定时器」的集成测试
    // （评审修复实测：文件并行时 CPU 竞争会让背压泵帧等时序用例在满负载下顶超时，
    // 隔离跑 1.8s 的用例并行曾 20s+）。文件间并行只省几秒，确定性优先；
    // 文件间隔离（每文件独立进程/端口）由 vitest 默认行为保留。
    fileParallelism: false,
  },
});
