// 迁自 packages/services/test/obsidianVaultAtomicCreate.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeTextFileAtomic } from "../src/server/vault/atomic.js";
import { createVaultFileSystem } from "../src/server/vault/vault-fs.js";

test("createOnly 原子发布：已存在或竞争创建的文件绝不被覆盖且临时文件清除", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-exclusive-create-"));
  try {
    const file = join(root, "existing.md");
    await writeFile(file, "external edit");
    await assert.rejects(writeTextFileAtomic(file, "proposal", { createOnly: true }), {
      code: "EEXIST",
    });
    assert.equal(await readFile(file, "utf8"), "external edit");
    const results = await Promise.allSettled(
      ["first", "second"].map((content) =>
        createVaultFileSystem(root).writeFile({
          relativePath: "new.md",
          content,
          createOnly: true,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.ok(["first", "second"].includes(await readFile(join(root, "new.md"), "utf8")));
    assert.deepEqual((await readdir(root)).sort(), ["existing.md", "new.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
