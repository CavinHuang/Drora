import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 保留 Drora 原生 Node 用例；Vitest 不能执行 node:test 注册的 suite。 */
export function discoverNodeUnitTestFiles(root = process.cwd()) {
  return (
    globSync("packages/*/test/**/*.test.ts", { cwd: root })
      // Windows glob 返回反斜杠；先归一化，确保 e2e 过滤与 Vitest exclude 使用同一路径。
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !file.includes("/e2e/"))
      .filter((file) =>
        /(?:from\s*|import\s*\()(["'])node:test\1/u.test(readFileSync(resolve(root, file), "utf8")),
      )
      .sort()
  );
}
