import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeClipboardImageReader } from "../src/clipboard-image.js";

test("image clipboard reader uses the Drora storage root for native temp files", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "drora-clipboard-storage-root-"));
  const imagePaths: string[] = [];
  const readClipboardImage = createNodeClipboardImageReader({
    platform: "darwin",
    processEnv: {
      ...process.env,
      DRORA_STORAGE_DIR: storageRoot,
    },
    runCommand: async (_file, args) => {
      const scriptLine = args.find((arg) => arg.includes("clipboard.png")) ?? "";
      const match = scriptLine.match(/POSIX file "([^"]+)"/);
      // Windows 兼容：appleScriptString 会把路径里的 "\" 与 '"' 转义成 AppleScript
      // 字面量形式（\\\\、\\"），测试侧提取后必须反向转义，否则双反斜杠路径与
      // 本机路径正则永远不匹配。POSIX 路径不含这些字符，行为不变。
      const imagePath = match?.[1]?.replace(/\\(.)/g, "$1");
      if (!imagePath) {
        return { exitCode: 1, stdout: Buffer.alloc(0) };
      }
      imagePaths.push(imagePath);
      await writeFile(imagePath, Buffer.from("png-data"));
      return { exitCode: 0, stdout: Buffer.alloc(0) };
    },
  });

  try {
    const image = await readClipboardImage();
    assert.equal(image?.mediaType, "image/png");
    assert.match(
      imagePaths[0] ?? "",
      new RegExp(`^${escapeRegExp(join(storageRoot, "clipboard", "drora-clipboard-"))}`),
    );
    assert.deepEqual(await readdir(join(storageRoot, "clipboard")), []);
  } finally {
    await rm(storageRoot, { force: true, recursive: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
