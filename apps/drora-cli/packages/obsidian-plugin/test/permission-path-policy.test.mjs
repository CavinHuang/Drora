// W01 权限路径策略单测（specs/obsidian-knowledge.md §6 K-POL-1..5）：
// 覆盖 Windows UNC/相对 cwd/Unicode/大小写/软链与 junction/路径穿越/缺失坏配置。
// 经 dist 消费（CI 先 build 再 test；本地需先 pnpm run build）。node:test 风格，
// 可直接 `node test/permission-path-policy.test.mjs` 或 `node --import tsx --test` 运行。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  loadAgentVaultAccess,
  resolveAuthorizedVaultWritePath,
} from "../dist/lib/agent-access.js";
import { isPlainVaultMarkdownPath } from "../dist/lib/paths.js";

const IS_WIN = process.platform === "win32";

function makeVault(overrides = {}) {
  const base = mkdtempSync(join(tmpdir(), "drora-obsidian-path-policy-"));
  const vault = join(base, "vault");
  const dataDir = join(base, "data");
  mkdirSync(join(vault, "notes"), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(vault, "notes", "a.md"), "# A\n");
  writeFileSync(
    join(dataDir, "vault-config.json"),
    JSON.stringify({
      rootPath: vault,
      displayName: "Policy Vault",
      inboxPath: "Inbox",
      allowAgentWrites: true,
      configuredAt: Date.now(),
      ...overrides,
    }),
  );
  return { base, vault, dataDir };
}

function trySymlink(target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    // 无软链权限的平台（Windows 非开发者模式）跳过对应用例。
    return false;
  }
}

// ---- isPlainVaultMarkdownPath：纯形状策略（K-POL-1/K-POL-2） ----

test("策略：根内普通 .md 路径放行（含嵌套/中文/.MD 大写后缀）", () => {
  assert.equal(isPlainVaultMarkdownPath("notes/a.md"), true);
  assert.equal(isPlainVaultMarkdownPath("a.md"), true);
  assert.equal(isPlainVaultMarkdownPath("NOTES/README.MD"), true);
  assert.equal(isPlainVaultMarkdownPath("docs/sub/note.Md"), true);
  assert.equal(isPlainVaultMarkdownPath("中文目录/会议笔记.md"), true);
  assert.equal(isPlainVaultMarkdownPath("notes/ünïcodé-Ω.md"), true);
});

test("策略：隐藏目录/点文件/非 Markdown/空段/穿越/空串全部拒绝", () => {
  assert.equal(isPlainVaultMarkdownPath(".obsidian/workspace.json"), false);
  assert.equal(isPlainVaultMarkdownPath(".obsidian/note.md"), false);
  assert.equal(isPlainVaultMarkdownPath(".hidden/x.md"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/.hidden/a.md"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/.hidden.md"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/a.txt"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/a"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/a.md.bak"), false);
  assert.equal(isPlainVaultMarkdownPath(""), false);
  assert.equal(isPlainVaultMarkdownPath("   "), false);
  assert.equal(isPlainVaultMarkdownPath("notes//a.md"), false);
  assert.equal(isPlainVaultMarkdownPath("notes/../a.md"), false);
  assert.equal(isPlainVaultMarkdownPath("../a.md"), false);
  assert.equal(isPlainVaultMarkdownPath("."), false);
  assert.equal(isPlainVaultMarkdownPath(".."), false);
  assert.equal(isPlainVaultMarkdownPath("notes/"), false);
  // Windows 尾点/尾空格会在 Win32 层被剥掉造成别名，形状层保守拒绝（交回问询）。
  assert.equal(isPlainVaultMarkdownPath("notes/a.md."), false);
  assert.equal(isPlainVaultMarkdownPath("notes/a.md "), false);
  // NTFS ADS 语义（file:stream）不以 .md 结尾，同样不自动授权。
  assert.equal(isPlainVaultMarkdownPath("notes/a.md:hidden"), false);
});

test("策略：非字符串输入拒绝（防御性）", () => {
  assert.equal(isPlainVaultMarkdownPath(undefined), false);
  assert.equal(isPlainVaultMarkdownPath(null), false);
  assert.equal(isPlainVaultMarkdownPath(42), false);
});

// ---- resolveAuthorizedVaultWritePath：防逃逸解析（K-POL-3/K-POL-4） ----

test("解析：根内绝对路径 → 放行且返回相对 realpath 根的 / 分隔路径", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    const result = await resolveAuthorizedVaultWritePath(access.rootPath, undefined, join(vault, "notes", "a.md"));
    assert.ok(result);
    assert.equal(result.relativePath, "notes/a.md");
    assert.ok(isAbsolute(result.absolutePath));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：相对路径 + 根内 cwd → 放行；正反斜杠混用等价", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    const forward = await resolveAuthorizedVaultWritePath(access.rootPath, vault, "notes/b.md");
    assert.ok(forward && forward.relativePath === "notes/b.md");
    const mixed = await resolveAuthorizedVaultWritePath(access.rootPath, vault, "notes\\sub\\b.md");
    assert.ok(mixed && mixed.relativePath === "notes/sub/b.md");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：相对路径 + 缺失/空白 cwd → 静默（异常交回问询）", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, undefined, "notes/a.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, "", "notes/a.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, "   ", "notes/a.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, 42, "notes/a.md"), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：相对路径 + 根外 cwd → 静默", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, base, "escape.md"), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：`..` 穿越（含混合分隔符）与根本身 → 静默", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join("notes", "..", "..", "escape.md")), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "..\\..\\escape.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, vault), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：根外绝对路径与非法输入 → 静默", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join(base, "outside.md")), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, ""), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "a\0b.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, 42), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, null), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

if (IS_WIN) {
  test("解析（win32）：UNC 形式目标 → 静默（不落根内规范形，交回问询）", async () => {
    const { base, vault, dataDir } = makeVault();
    try {
      const access = await loadAgentVaultAccess(dataDir);
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "\\\\server\\share\\x.md"), null);
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "\\\\?\\UNC\\server\\share\\x.md"), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("解析（win32）：\\\\?\\ 扩展路径即使指向根内也保守静默（不做前缀展开）", async () => {
    const { base, vault, dataDir } = makeVault();
    try {
      const access = await loadAgentVaultAccess(dataDir);
      const extended = `\\\\?\\${vault}\\notes\\a.md`;
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, extended), null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("解析（win32）：大小写不敏感——NOTES/A.MD 命中已存在 notes/a.md", async () => {
    const { base, vault, dataDir } = makeVault();
    try {
      const access = await loadAgentVaultAccess(dataDir);
      const result = await resolveAuthorizedVaultWritePath(access.rootPath, vault, join(vault, "NOTES", "A.MD"));
      assert.ok(result);
      assert.equal(result.relativePath.toLowerCase(), "notes/a.md");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}

test("解析：Unicode 中文目录与文件名原样保留", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const access = await loadAgentVaultAccess(dataDir);
    const result = await resolveAuthorizedVaultWritePath(access.rootPath, vault, "中文目录/会议笔记.md");
    assert.ok(result);
    assert.equal(result.relativePath, "中文目录/会议笔记.md");
    assert.ok(result.absolutePath.includes("会议笔记.md"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：根内隐藏目录与非 .md 即使落在授权根内也不自动授权", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(vault, ".hidden"), { recursive: true });
    writeFileSync(join(vault, ".obsidian", "workspace.json"), "{}");
    writeFileSync(join(vault, "notes", "a.txt"), "x");
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join(vault, ".obsidian", "workspace.json")), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, ".hidden/x.md"), null);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join(vault, "notes", "a.txt")), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：已存在目录冒充 x.md → 静默；新文件/新目录 → 放行（原生 Write 允许新建）", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    mkdirSync(join(vault, "notes", "x.md"), { recursive: true });
    const access = await loadAgentVaultAccess(dataDir);
    assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join(vault, "notes", "x.md")), null);
    const created = await resolveAuthorizedVaultWritePath(access.rootPath, vault, join("notes", "sub", "new.md"));
    assert.ok(created && created.relativePath === "notes/sub/new.md");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("解析：根内符号链接文件/目录指向外部 → 静默（平台允许建链时；目录用 junction 补 Windows 覆盖）", async () => {
  const { base, vault, dataDir } = makeVault();
  try {
    const outsideDir = join(base, "outside-dir");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.md"), "secret\n");
    writeFileSync(join(base, "outside.md"), "secret\n");
    const access = await loadAgentVaultAccess(dataDir);

    if (trySymlink(join(base, "outside.md"), join(vault, "link.md"))) {
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "link.md"), null);
    }
    // Windows junction 不需要开发者模式，保证目录逃逸用例在 CI 可复现。
    const dirLinkType = IS_WIN ? "junction" : "dir";
    if (trySymlink(outsideDir, join(vault, "link-dir"), dirLinkType)) {
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, join("link-dir", "secret.md")), null);
      assert.equal(await resolveAuthorizedVaultWritePath(access.rootPath, vault, "link-dir"), null);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---- 缺失/坏配置（K-POL-5） ----

test("解析：根被删除/根是文件/配置指向不存在路径 → 全部静默", async () => {
  const { base, vault, dataDir } = makeVault();
  rmSync(vault, { recursive: true, force: true });
  try {
    assert.equal(await resolveAuthorizedVaultWritePath(vault, undefined, join(vault, "notes", "a.md")), null);
    const fileRoot = join(base, "root-file.txt");
    writeFileSync(fileRoot, "not a dir");
    assert.equal(await resolveAuthorizedVaultWritePath(fileRoot, undefined, "a.md"), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("配置：env 未设/空白/配置损坏 → loadAgentVaultAccess 未授权", async () => {
  const base = mkdtempSync(join(tmpdir(), "drora-obsidian-path-policy-"));
  try {
    assert.equal(await loadAgentVaultAccess(undefined), null);
    assert.equal(await loadAgentVaultAccess("  "), null);
    const dataDir = join(base, "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "vault-config.json"), "{broken");
    assert.equal(await loadAgentVaultAccess(dataDir), null);
    assert.equal(await loadAgentVaultAccess(join(base, "missing")), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
