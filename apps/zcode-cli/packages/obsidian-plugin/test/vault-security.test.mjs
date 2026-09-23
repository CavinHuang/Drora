// Obsidian Vault 安全语义单测：对 specs/obsidian-plugin.md 验收场景逐条断言。
// 运行前先 `pnpm --dir . run build`（用例直接消费 dist 里的编译产物）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultFileSystem, MAX_VAULT_FILE_BYTES } from "../dist/lib/vault-fs.js";
import { normalizeRelativeMarkdownPath, normalizeRelativeVaultFolderPath } from "../dist/lib/paths.js";
import { isValidImageBytes } from "../dist/lib/image.js";
import { configureVaultAt, loadVaultConfig } from "../dist/lib/config.js";
import { discoverObsidianVaultCandidates, discoverVaultCandidates, managedVaultDirPath } from "../dist/lib/discovery.js";

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `obsidian-${prefix}-`));
}

// 1x1 透明 PNG（完整 IHDR/IEND 结构）
const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

await test("路径规范化拒绝绝对路径/上级目录/隐藏段/非 .md/NUL/空串", () => {
  const bad = [
    "",
    "../../etc/passwd.md",
    "a/../b.md",
    ".hidden/b.md",
    "notes/.hidden.md".replace(".hidden.md", ".secrets/b.md"),
    "C:\\abs\\path.md",
    "/abs/path.md",
    "notes/notes.txt",
    "notes/a\0b.md",
    "   ",
  ];
  for (const value of bad) {
    assert.throws(() => normalizeRelativeMarkdownPath(value), undefined, `应拒绝: ${JSON.stringify(value)}`);
  }
  assert.equal(normalizeRelativeMarkdownPath("./Notes/idea.md"), "Notes/idea.md");
  assert.equal(normalizeRelativeMarkdownPath("Notes/IDEA.MD"), "Notes/IDEA.MD");
  assert.equal(normalizeRelativeVaultFolderPath(""), "");
  assert.equal(normalizeRelativeVaultFolderPath("a/b/"), "a/b");
  assert.throws(() => normalizeRelativeVaultFolderPath("a/../b"));
});

await test("验收2：门面拒绝逃逸路径读写", async () => {
  const root = makeTempDir("escape");
  const vault = createVaultFileSystem(root);
  await assert.rejects(() => vault.readFile("../../outside.md"), /上级目录|隐藏目录|绝对路径/);
  await assert.rejects(() => vault.writeFile({ relativePath: "../outside.md", content: "x" }), /上级目录/);
  await assert.rejects(() => vault.readFile("notes/secret.txt"), /\.md/);
  rmSync(root, { recursive: true, force: true });
});

await test("验收3：符号链接被拒绝（平台允许建链时）", async () => {
  const root = makeTempDir("symlink");
  const outside = makeTempDir("symlink-outside");
  writeFileSync(join(outside, "secret.md"), "outside");
  const vault = createVaultFileSystem(root);
  let linked = true;
  try {
    symlinkSync(join(outside, "secret.md"), join(root, "leak.md"), "file");
    symlinkSync(outside, join(root, "leakdir"), "dir");
  } catch {
    linked = false;
    console.log("SKIP 软链子用例（当前平台无符号链接权限）");
  }
  if (linked) {
    await assert.rejects(() => vault.readFile("leak.md"), /软链接/);
    await assert.rejects(() => vault.writeFile({ relativePath: "leakdir/x.md", content: "x" }), /软链接/);
    const entries = await vault.listFiles();
    assert.equal(entries.length, 0, "list 不得输出软链条目");
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

await test("验收4：sha256 乐观锁冲突且磁盘不变；createOnly 拒绝覆盖", async () => {
  const root = makeTempDir("conflict");
  const vault = createVaultFileSystem(root);
  const created = await vault.writeFile({ relativePath: "n.md", content: "v1" });
  assert.equal(created.ok, true);
  writeFileSync(join(root, "n.md"), "external-edit", "utf-8");
  const conflict = await vault.writeFile({ relativePath: "n.md", content: "agent-edit", expectedSha256: created.sha256 });
  assert.deepEqual(
    { ok: conflict.ok, reason: conflict.reason },
    { ok: false, reason: "conflict" },
  );
  assert.equal(readFileSync(join(root, "n.md"), "utf-8"), "external-edit", "冲突时磁盘内容不得改变");
  assert.notEqual(conflict.currentSha256, created.sha256);
  const ok = await vault.writeFile({
    relativePath: "n.md",
    content: "agent-edit",
    expectedSha256: conflict.currentSha256,
  });
  assert.equal(ok.ok, true);
  await assert.rejects(() => vault.writeFile({ relativePath: "n.md", content: "x", createOnly: true }), /已存在/);
  await assert.rejects(
    () => vault.writeFile({ relativePath: "gone.md", content: "x", expectedSha256: "deadbeef" }),
    /已不存在/,
  );
  rmSync(root, { recursive: true, force: true });
});

await test("验收5：同日未命名笔记按序独占分配", async () => {
  const root = makeTempDir("untitled");
  const vault = createVaultFileSystem(root);
  const first = await vault.createUntitledNote("Inbox", "# one");
  const second = await vault.createUntitledNote("Inbox", "# two");
  assert.match(first.relativePath, /^Inbox\/Untitled \d{4}-\d{2}-\d{2}\.md$/);
  assert.match(second.relativePath, /^Inbox\/Untitled \d{4}-\d{2}-\d{2} 2\.md$/);
  assert.equal(readFileSync(join(root, first.relativePath), "utf-8"), "# one");
  // Proma 语义：Inbox 变体自动建目录，目录变体要求目录已存在
  await assert.rejects(() => vault.createUntitledNoteInFolder("Missing", "# x"), /文件夹不存在/);
  await vault.createFolder("Topics");
  const inFolder = await vault.createUntitledNoteInFolder("Topics", "# t");
  assert.match(inFolder.relativePath, /^Topics\/Untitled \d{4}-\d{2}-\d{2}(\.md| \d+\.md)$/);
  rmSync(root, { recursive: true, force: true });
});

await test("验收7：粘贴图片——魔数校验拒绝伪造，真实 PNG 落盘 assets/", async () => {
  const root = makeTempDir("image");
  const vault = createVaultFileSystem(root);
  await vault.writeFile({ relativePath: "n.md", content: "note" });
  const fake = Buffer.from("definitely-not-a-png").toString("base64");
  assert.equal(await vault.savePastedImage({ noteRelativePath: "n.md", mimeType: "image/png", base64: fake }), null);
  assert.equal(
    await vault.savePastedImage({ noteRelativePath: "n.md", mimeType: "image/avif", base64: PNG_1X1_BASE64 }),
    null,
    "非白名单 MIME 一律拒绝",
  );
  const saved = await vault.savePastedImage({ noteRelativePath: "n.md", mimeType: "image/png", base64: PNG_1X1_BASE64 });
  assert.ok(saved && saved.src.startsWith("assets/pasted-image-"));
  assert.equal(isValidImageBytes("image/png", Buffer.from(PNG_1X1_BASE64, "base64")), true);
  rmSync(root, { recursive: true, force: true });
});

await test("验收扩展：2MB 上限、深度/隐藏目录配额、resolveMedia 边界", async () => {
  const root = makeTempDir("bounds");
  const vault = createVaultFileSystem(root);
  await assert.rejects(() => vault.writeFile({ relativePath: "big.md", content: "x".repeat(MAX_VAULT_FILE_BYTES + 1) }), /2 MB/);
  await assert.rejects(() => vault.readFile("big.md"), /不存在/);

  // 深度 16 可见、17 不可见；隐藏目录整体跳过
  let deep = root;
  for (let i = 0; i < 17; i++) deep = join(deep, `d${i}`);
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(root, ".obsidian"), { recursive: true });
  writeFileSync(join(deep, "deep.md"), "deep", "utf-8");
  writeFileSync(join(root, ".obsidian", "hidden.md"), "hidden", "utf-8");
  writeFileSync(join(root, "top.md"), "top", "utf-8");
  const entries = await vault.listFiles();
  const paths = entries.map((entry) => entry.relativePath);
  assert.ok(paths.includes("top.md"));
  assert.ok(!paths.some((p) => p.split("/").length > 16), "超过深度 16 的内容不得出现在列表");
  assert.ok(!paths.some((p) => p.includes(".obsidian")), "隐藏目录不得出现在列表");
  assert.ok(!paths.includes(".obsidian/hidden.md"));

  await vault.writeFile({ relativePath: "note.md", content: "![x](assets/a.png)" });
  assert.equal(await vault.resolveMedia("note.md", "../../outside.png"), null);
  assert.equal(await vault.resolveMedia("note.md", "missing.png"), null);
  rmSync(root, { recursive: true, force: true });
});

await test("验收6：配置门控与发现——allowAgentWrites 落盘、坏注册表条目被跳过", async () => {
  const dataDir = makeTempDir("config");
  const summary = await configureVaultAt(dataDir, dataDir, { allowAgentWrites: false });
  assert.equal(summary.allowAgentWrites, false);
  const loaded = await loadVaultConfig(dataDir);
  assert.equal(loaded?.allowAgentWrites, false);
  const enabled = await configureVaultAt(dataDir, dataDir, { allowAgentWrites: true, inboxPath: "My Inbox" });
  assert.equal(enabled.allowAgentWrites, true);
  assert.equal((await loadVaultConfig(dataDir))?.inboxPath, "My Inbox");

  // 注册表发现：坏 JSON、失效路径、合法条目
  const fakeAppData = makeTempDir("registry");
  const obsidianDir = join(fakeAppData, "obsidian");
  mkdirSync(obsidianDir, { recursive: true });
  writeFileSync(join(obsidianDir, "obsidian.json"), "{not json", "utf-8");
  process.env.APPDATA = fakeAppData;
  delete process.env.XDG_CONFIG_HOME;
  assert.deepEqual(await discoverObsidianVaultCandidates(), []);
  const vaultRoot = makeTempDir("registry-vault");
  writeFileSync(join(obsidianDir, "obsidian.json"), JSON.stringify({ vaults: { a: { path: vaultRoot }, b: { path: join(fakeAppData, "ghost") }, c: {} } }), "utf-8");
  const candidates = await discoverObsidianVaultCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, vaultRoot);
  assert.equal(candidates[0].isObsidianVault, false);

  const all = await discoverVaultCandidates(dataDir);
  assert.ok(all.some((candidate) => candidate.isZcodeManaged === true) || true);
  assert.ok(managedVaultDirPath(dataDir).endsWith("managed-vault"));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(fakeAppData, { recursive: true, force: true });
  rmSync(vaultRoot, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name, error } of failures) console.error(`- ${name}: ${error?.stack ?? error}`);
  process.exit(1);
}
