import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "../..");
const assetPath = "apps/drora-cli/packages/visualize-plugin/skills/visualize/assets";
const source = join(repository, assetPath);

async function filesUnder(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

test("autocrlf checkout preserves pinned Gen UI resources and license bytes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "drora-gen-ui-checkout-"));
  try {
    const destination = join(temporary, assetPath);
    await mkdir(destination, { recursive: true });
    await cp(source, destination, { recursive: true });
    await cp(join(repository, ".gitattributes"), join(temporary, ".gitattributes"));
    const git = (...args) => execute("git", ["-C", temporary, "-c", "core.autocrlf=true", ...args]);
    await git("init", "--quiet");
    await git("add", ".gitattributes", assetPath);
    // 重新 materialize index 才会经过 checkout 的 CRLF 转换；不会创建仓库 worktree 或修改用户文件。
    await rm(destination, { recursive: true });
    await git("checkout-index", "--all", "--force");

    const manifest = JSON.parse(await readFile(join(destination, "vendor/manifest.json"), "utf8"));
    for (const resource of manifest.resources) {
      for (const [file, expected] of [
        [resource.file, resource.sha256],
        [resource.licenseFile, resource.licenseSha256],
      ]) {
        const bytes = await readFile(join(destination, "vendor", file));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, file);
      }
    }
    for (const file of await filesUnder(source)) {
      assert.deepEqual(
        await readFile(join(destination, file)),
        await readFile(join(source, file)),
        file,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
