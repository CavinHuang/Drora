import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pageRoot = join(root, "upstream", "remote", "v4");
const recoveredRoot = join(root, "src", "recovered", "remote", "v4");
const runFile = promisify(execFile);

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

test("frozen 3.14.3 entry references a complete local asset set", async () => {
  const html = await readFile(join(pageRoot, "index.html"), "utf8");
  assert.equal(html.includes("window.__wsLog"), false, "diagnostic WebSocket hook must be absent");
  assert.equal(html.includes("selfhost2"), false, "diagnostic cache buster must be absent");
  const localReferences = new Set(
    [...html.matchAll(/\/remote\/v4\/3\.14\.3\/assets\/([\w.-]+)/gu)].map((match) => match[1]),
  );
  const installed = new Set(await readdir(join(pageRoot, "3.14.3", "assets")));
  assert.ok(localReferences.size > 40, "the entry must declare its preload graph");
  for (const asset of localReferences) assert.ok(installed.has(asset), `missing ${asset}`);
});

test("all reachable versioned asset references resolve locally or are absent upstream", async () => {
  const assetDir = join(pageRoot, "3.14.3", "assets");
  const installed = new Set(await readdir(assetDir));
  const expectedUpstream404 = new Set(["docx_wasm_bg.js", "duke_sheets_wasm_bg.js"]);
  const referencePattern =
    /(?:\.\/|\/remote\/v4\/3\.14\.3\/assets\/)([A-Za-z0-9._-]+\.(?:js|css|svg|png|webp|woff2?|wasm))/gu;
  const sources = [await readFile(join(pageRoot, "index.html"), "utf8")];
  for (const name of installed) {
    if (name.endsWith(".js") || name.endsWith(".css")) {
      sources.push(await readFile(join(assetDir, name), "utf8"));
    }
  }
  const referenced = new Set(
    sources.flatMap((source) => [...source.matchAll(referencePattern)].map((match) => match[1])),
  );
  const missing = [...referenced].filter((name) => !installed.has(name));
  assert.deepEqual(missing.sort(), [...expectedUpstream404].sort());
});

test("recovered source retains the complete asset graph and builds without transformation", async () => {
  const assetPath = join("3.14.3", "assets");
  const snapshotNames = (await readdir(join(pageRoot, assetPath))).sort();
  const recoveredNames = (await readdir(join(recoveredRoot, assetPath))).sort();
  assert.deepEqual(recoveredNames, snapshotNames);

  const main = await readFile(join(recoveredRoot, assetPath, "index-NjWRUABD.js"), "utf8");
  assert.match(main, /^\/\/ 还原自发行 bundle/u);
  assert.ok(main.split("\n").length > 1000, "entry JS must be readable rather than minified");
  assert.equal(
    digest(await readFile(join(recoveredRoot, "index.html"))),
    digest(await readFile(join(pageRoot, "index.html"))),
  );

  // R3 P2a（spec §13.4）：dist = 源码应用产物；快照构建输出到 .tmp 目录逐字节对照，
  // 不再写 dist（--out 注入，build.mjs 拒绝无参调用防止覆盖源码产物）。
  const snapshotOut = join(root, ".tmp-snapshot-build");
  await runFile(process.execPath, [join(root, "scripts", "build.mjs"), "--out", snapshotOut]);
  const builtRoot = join(snapshotOut, "remote", "v4");
  for (const name of recoveredNames) {
    const source = await readFile(join(recoveredRoot, assetPath, name));
    const output = await readFile(join(builtRoot, assetPath, name));
    assert.equal(digest(output), digest(source), `build modified ${name}`);
  }
});

test("frozen snapshot bytes match the SHA256SUMS.txt integrity manifest", async () => {
  // 该清单是冻结快照的完整性锚点：2026-09-29 CDN 逐字节重取后重建（全仓 oxfmt 事故），
  // 2026-10-01 按完整闭包抓取补全 78 文件（KaTeX ttf / pdf-viewer 栈 / bot 渠道图标 /
  // material-icons 46 枚，spec §32.17），2620 = 快照全部文件。
  // 逐条复算 sha256：readFile 不带 encoding 返回 Buffer，二进制安全（wasm/woff2/png）。
  const manifest = await readFile(join(root, "upstream", "SHA256SUMS.txt"), "utf8");
  const lines = manifest.split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, 2620, "manifest must cover every upstream snapshot file");
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (remote\/v4\/.+)$/u.exec(line);
    assert.ok(match, `malformed manifest line: ${line}`);
    const [, expected, relativePath] = match;
    const content = await readFile(join(root, "upstream", relativePath));
    assert.equal(digest(content), expected, `frozen snapshot drift: ${relativePath}`);
  }
});
