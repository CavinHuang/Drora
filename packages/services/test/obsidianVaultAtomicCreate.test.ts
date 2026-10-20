import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeTextFileAtomic } from "../src/obsidian-vault/atomic.js";
import { createVaultFileSystem } from "../src/obsidian-vault/vault-fs.js";

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
