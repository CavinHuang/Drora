import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// 修复原因（2026-11-13，v3.18.0 S4 段门 test:upstream-cli 实证）：esbuild（0.25.12 与
// 0.27.7 均复现）把 `using` 声明降层为函数级 var 的 _error/_hasError 追踪，循环内
// 「某次迭代抛错、后续迭代成功 return」的形态会把陈旧异常在 finally 的 __callDispose
// 里重抛——target-completion-verification 的 verifier busy 重试与 provider-builtin-tool-rounds
// 的丢弃流恢复用例全量假失败（native Node 语义正确，最小复现：es2022=exhausted /
// esnext=ok-2）。Node 运行面由 mise 钉 24.14.0（原生支持 using），测试变换以 esnext
// 直通原生语义，绕开降层缺陷；产品代码零改动。
//
// testTimeout=15000（同轮实证）：上游 5s 默认按 POSIX 快 shell 假设；Windows Git Bash
// 用例每只读冷快照 ~1.7s（fork 风暴修复后）+ 登录 shell spawn，全量并行 CPU 争用下
// 5s 边缘超时（串行单跑全绿、整包并行必超），15s 对齐串行通过形态。
//
// cacheDir→系统临时盘（第 4 轮实证）：D: 长期 100%（<300MB）导致 vitest 变换缓存
// 重建/追加写 ENOSPC，bootstrap/core 整包文件级收集失败（241/304、217/337）；
// 缓存挪到 tmpdir 所在盘（C:，清理后 GB 级），与仓库盘解耦。
export default defineConfig({
  esbuild: {
    target: "esnext",
  },
  cacheDir: join(tmpdir(), "drora-vitest-cache", import.meta.dirname?.split(/[\/]/).at(-1) ?? "pkg"),
  // 修复（2026-11-14，v3.18.0 S4 段门复跑归因）：testTimeout 属于 vitest 的 test 配置段，
  // 此前写在根级被静默忽略（探针实证：6s 用例按 5s 默认超时），台账 25 声称的 15s
  // 从未生效——整包并行下的 5s 边缘超时族（bootstrap/core 大面积 "Test timed out in
  // 5000ms"）即由此而来。移入 test 段后 15s 真正生效。
  test: {
    testTimeout: 15_000,
  },
});
