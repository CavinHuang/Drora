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
