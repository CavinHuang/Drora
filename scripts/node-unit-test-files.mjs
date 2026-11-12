import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 保留 Drora 原生 Node 用例；Vitest 不能执行 node:test 注册的 suite。 */
export function discoverNodeUnitTestFiles(root = process.cwd()) {
  return (
    [
      // .test.ts 扩展名被 Vitest 与 node:test 双框架共用，靠内容（node:test 导入）区分归属。
      ...globSync("packages/*/test/**/*.test.ts", { cwd: root }),
      // P3（specs/obsidian-vault-phase2-true-extraction.md §1-C10/§10-P3）：knowledge/
      // obsidian 测试随实现迁入 obsidian-plugin/test（node:test 直连插件 server 模块），
      // 插件包在 apps/drora-cli 下，需第二条 glob 才能被保留集发现；vitest 套件仍靠
      // 下方内容过滤器排除。
      ...globSync("apps/drora-cli/packages/*/test/**/*.test.ts", { cwd: root }),
      // 修复原因：CUA 等真实进程/打包链用例采用 .node-test.mjs 命名约定（全仓 11 件，
      // 含 windowsCuaRuntime/windowsCuaPackaging/cuaLazyLaunchBridge），此前只被
      // *.test.ts glob 发现——vitest 工程按设计不收录 node:test 套件（见
      // vitest.config.ts 与 generate-drora-test-files.mjs 的 node:test 排除），
      // test:unit:node 又 glob 不到该后缀，导致这批用例落入全通道失执行缺口
      // （与 generate-drora-test-files.mjs 记载的 .tsx baseline-gap#3 同类）。
      ...globSync("packages/*/test/**/*.node-test.mjs", { cwd: root }),
    ]
      // Windows glob 返回反斜杠；先归一化，确保 e2e 过滤与 Vitest exclude 使用同一路径。
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !file.includes("/e2e/"))
      // 两种后缀统一按内容判定 node:test 归属：防止命名漂移的文件被 node --test
      // 以 0 用例方式空跑出假绿。
      .filter((file) =>
        /(?:from\s*|import\s*\()(["'])node:test\1/u.test(readFileSync(resolve(root, file), "utf8")),
      )
      .sort()
  );
}
