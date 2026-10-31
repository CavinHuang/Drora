import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 修复：本包用例拉起真实 App/Protocol/SQLite 与插件缓存物化，满载并行下 5s 默认
    // 超时不够（隔离实测单例 ~2s，整包并行时可超 5s 成片超时）；放宽到 20s 只改
    // 时间预算，不改任何断言。
    testTimeout: 20_000,
  },
});
