/**
 * Vault 面板纯模型测试（P5 gate，specs/obsidian-vault-phase2-true-extraction.md §2
 * 行为等价基准）：树模型/wikilink 解析/N2-N3 建议/lookup 横幅/草稿与 openWith 载荷
 * 解析——语义对照 HEAD v4/vault 纯函数件（vault-tree-model/vault-wikilinks/
 * knowledgeConnectionsModel/knowledgeAskModel），webview 版在 src/ui/model.ts 重建。
 *
 * 运行：node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/vaultPanelModel.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVaultTree,
  deriveLookupBanners,
  extractWikiLinks,
  formatHandoffText,
  getFolderAncestors,
  isNoteLinkedFromContent,
  parseDraft,
  parseOpenWithPayload,
  resolveVaultWikiLink,
  splitLinkSuggestions,
  wikilinkTargetOf,
  type ObsidianVaultTreeEntry,
} from "../src/ui/model.js";

test("树模型：文件夹嵌套 + 文件挂父目录（HEAD vault-tree-model 语义）", () => {
  const entries: ObsidianVaultTreeEntry[] = [
    { kind: "folder", relativePath: "notes", name: "notes" },
    { kind: "folder", relativePath: "notes/sub", name: "sub" },
    { kind: "file", relativePath: "notes/a.md", name: "a.md", size: 10, modifiedAt: 1 },
    { kind: "file", relativePath: "notes/sub/b.md", name: "b.md", size: 20, modifiedAt: 2 },
    { kind: "file", relativePath: "root.md", name: "root.md", size: 5, modifiedAt: 3 },
  ];
  const tree = buildVaultTree(entries);
  assert.deepEqual([...tree.folders.keys()], ["notes"]);
  assert.equal(tree.files.length, 1);
  const notes = tree.folders.get("notes")!;
  assert.equal(notes.files.length, 1);
  assert.ok(notes.folders.get("sub")!.files[0]!.name === "b.md");
  assert.deepEqual(getFolderAncestors("notes/sub/b.md"), ["notes", "notes/sub"]);
  assert.deepEqual(getFolderAncestors("root.md"), []);
});

test("wikilink 解析：根精确 > 当前目录 > 唯一后缀；不解析 #/^/:（HEAD resolveVaultWikiLink 语义）", () => {
  const files = ["notes/alpha.md", "docs/alpha.md", "notes/beta.md", "readme.md"];
  assert.equal(resolveVaultWikiLink("notes/alpha", "other/x.md", files), "notes/alpha.md");
  // 裸名跨两目录不唯一（根/当前目录/唯一后缀三段都不命中）→ null（不猜）。
  assert.equal(resolveVaultWikiLink("alpha", "other/x.md", files), null);
  // 当前目录命中优先于跨目录唯一后缀。
  assert.equal(resolveVaultWikiLink("alpha", "docs/intro.md", files), "docs/alpha.md");
  // 唯一后缀兜底：去掉 docs/alpha 后裸名可唯一解析。
  const uniqueFiles = ["notes/alpha.md", "notes/beta.md", "readme.md"];
  assert.equal(resolveVaultWikiLink("alpha", "other/x.md", uniqueFiles), "notes/alpha.md");
  // 相对路径形态。
  assert.equal(resolveVaultWikiLink("./beta", "notes/x.md", files), "notes/beta.md");
  // 边界字符直接拒绝。
  assert.equal(resolveVaultWikiLink("alpha#heading", "notes/x.md", files), null);
  assert.equal(resolveVaultWikiLink("alpha^block", "notes/x.md", files), null);
});

test("N2/N3 建议过滤：已链接判定（完整路径/.md/basename 三形态）+ 建议 = 近邻 − 已链接", () => {
  const content = "见 [[notes/alpha]] 与 [[beta|别名]]，以及 [[gamma#标题]]。\n";
  assert.equal(isNoteLinkedFromContent(content, "notes/alpha.md"), true);
  assert.equal(isNoteLinkedFromContent(content, "notes/alpha"), true);
  assert.equal(isNoteLinkedFromContent(content, "notes/beta.md"), true);
  assert.equal(isNoteLinkedFromContent(content, "notes/delta.md"), false);
  assert.equal(wikilinkTargetOf("notes/beta.md"), "notes/beta");

  const split = splitLinkSuggestions(
    [
      {
        articleId: "a1",
        relativePath: "notes/alpha.md",
        title: "Alpha",
        matchedHeading: null,
        excerpt: "…",
        quote: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 10 },
        rank: 1,
        matchedChunkCount: 1,
      },
      {
        articleId: "a2",
        relativePath: "notes/delta.md",
        title: "Delta",
        matchedHeading: null,
        excerpt: "…",
        quote: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 10 },
        rank: 2,
        matchedChunkCount: 1,
      },
    ],
    content,
  );
  assert.equal(split.linked.length, 1);
  assert.equal(split.suggested.length, 1);
  assert.equal(split.suggested[0]!.target, "notes/delta");
  // 正文不可读（null）按未链接处理（HEAD 同口径：宁多勿漏）。
  const nullSplit = splitLinkSuggestions(
    [
      {
        articleId: "a1",
        relativePath: "notes/alpha.md",
        title: "Alpha",
        matchedHeading: null,
        excerpt: "…",
        quote: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 10 },
        rank: 1,
        matchedChunkCount: 1,
      },
    ],
    null,
  );
  assert.equal(nullSplit.suggested.length, 1);
});

test("行内 wikilink 提取：|别名 取目标段", () => {
  const links = extractWikiLinks("a [[notes/alpha|显示名]] b [[beta]] c");
  assert.deepEqual(
    links.map((link) => link.target),
    ["notes/alpha", "beta"],
  );
  assert.equal(links[0]!.raw, "[[notes/alpha|显示名]]");
});

test("lookup 横幅派生（HEAD knowledgeAskModel 状态条语义的 lookup 子集）", () => {
  const indexStatus = {
    configured: true,
    coverage: { indexedFiles: 0, indexedChunks: 0, partial: false },
    semantic: "unavailable",
    job: null,
  } as Parameters<typeof deriveLookupBanners>[0]["indexStatus"];
  assert.deepEqual(deriveLookupBanners({ run: null, indexStatus }), [
    "indexMissing",
    "semanticUnavailable",
  ]);
  const building = { ...indexStatus, job: { status: "running", kind: "reconcile" } } as never;
  assert.deepEqual(deriveLookupBanners({ run: null, indexStatus: building }), [
    "indexing",
    "semanticUnavailable",
  ]);
  const ready = {
    configured: true,
    coverage: { indexedFiles: 2, indexedChunks: 4, partial: false },
    semantic: "available",
    job: null,
  } as never;
  assert.deepEqual(deriveLookupBanners({ run: null, indexStatus: ready }), []);
  assert.deepEqual(
    deriveLookupBanners({
      run: { status: "empty", candidates: [] } as never,
      indexStatus: ready,
    }),
    ["noAnswer"],
  );
  assert.deepEqual(
    deriveLookupBanners({
      run: { status: "no_source", candidates: [] } as never,
      indexStatus: ready,
    }),
    ["noVault"],
  );
});

test("草稿解析：逐字段回退，坏形状零值（widgetState 恢复面）", () => {
  assert.deepEqual(parseDraft(undefined), {});
  assert.deepEqual(parseDraft("junk"), {});
  assert.deepEqual(parseDraft(null), {});
  const draft = parseDraft({
    view: "ask",
    openNotePath: "notes/a.md",
    queryDraft: "检索词",
    expandedFolders: ["notes", 42, null],
    extra: "ignored",
  });
  assert.deepEqual(draft, {
    view: "ask",
    openNotePath: "notes/a.md",
    queryDraft: "检索词",
    expandedFolders: ["notes"],
  });
  assert.deepEqual(parseDraft({ view: "bogus" }), {});
});

test("openWith 载荷：只认 citation；其余忽略", () => {
  assert.deepEqual(parseOpenWithPayload({ kind: "citation", receiptId: "r-1" }), {
    kind: "citation",
    receiptId: "r-1",
  });
  assert.equal(parseOpenWithPayload({ kind: "citation", receiptId: "" }), null);
  assert.equal(parseOpenWithPayload({ kind: "other" }), null);
  assert.equal(parseOpenWithPayload(null), null);
  assert.equal(parseOpenWithPayload("text"), null);
});

test("handoff 文本：语言中立来源清单（路径/标题路径/行号 + 摘录）", () => {
  const text = formatHandoffText([
    {
      title: "Alpha",
      relativePath: "notes/alpha.md",
      heading: "第一章",
      startLine: 3,
      endLine: 5,
      excerpt: "关键  摘录\n跨行",
    },
  ]);
  assert.equal(
    text,
    "- Alpha（notes/alpha.md > 第一章，L3-L5）\n  > 关键 摘录 跨行",
  );
});
