import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { discoverNodeUnitTestFiles } from "../node-unit-test-files.mjs";

test("Node 用例发现为跨平台 runner 返回排序路径并排除 e2e", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-node-discovery-"));
  try {
    const files = {
      "packages/mobile-web/test/z.test.ts": 'import test from "node:test";',
      "packages/mobile-web/test/a.test.ts": 'const { test } = await import("node:test");',
      "packages/ui/test/view.test.ts": 'import { test } from "vitest";',
      "packages/desktop/test/e2e/window.test.ts": 'import test from "node:test";',
    };
    for (const [relativePath, source] of Object.entries(files)) {
      const file = join(root, relativePath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }

    assert.deepEqual(discoverNodeUnitTestFiles(root), [
      "packages/mobile-web/test/a.test.ts",
      "packages/mobile-web/test/z.test.ts",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 回归：CUA 等真实链路用例采用 .node-test.mjs 命名约定，此前不被任何执行通道
// 发现（vitest 工程按设计排除 node:test 套件、test:unit:node 只 glob *.test.ts），
// 修复后必须由 test:unit:node 收录；同时锁定“命名≠内容”——未导入 node:test 的
// 同名文件不得被 node --test 以 0 用例空跑出假绿。
test("Node 用例发现收录 .node-test.mjs 命名约定且仍按内容判定归属", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-node-discovery-suffix-"));
  try {
    const files = {
      "packages/services/test/windowsCuaRuntime.node-test.mjs": 'import { test } from "node:test";',
      "packages/desktop/test/server-remote-host.node-test.mjs": 'import test from "node:test";',
      "packages/services/test/fake.node-test.mjs": 'import { test } from "vitest";',
      "packages/services/test/plain.test.mjs": 'import { test } from "node:test";',
    };
    for (const [relativePath, source] of Object.entries(files)) {
      const file = join(root, relativePath);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }

    assert.deepEqual(discoverNodeUnitTestFiles(root), [
      "packages/desktop/test/server-remote-host.node-test.mjs",
      "packages/services/test/windowsCuaRuntime.node-test.mjs",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
