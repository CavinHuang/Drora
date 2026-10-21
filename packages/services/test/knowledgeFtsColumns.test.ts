/**
 * FTS 多列（tokens/title/meta，schema v4）与列权重（spec §5b.4/§5b.5）。
 *
 * - 迁移：v1 单列 chunks_fts 旧库打开自动升级到 v4，旧数据 tokens/title 重填后可检索，
 *   meta 如实为空（旧数据未经结构抽取，随文件变更/重建自然补齐）；
 * - 列权重：bm25(chunks_fts, 1.0, 3.0, 2.0)——标题命中排名高于仅正文命中；
 * - meta 列：chunker 结构抽取产物（frontmatter tags 文档级 + 逐 chunk wikilinks）进
 *   meta，标签词可命中正文 chunk（§5b.1 不变：tags 不做查询语法，只参与命中与加权）。
 *
 * 运行：node --import tsx --test packages/services/test/knowledgeFtsColumns.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { KNOWLEDGE_MIGRATIONS } from "../src/knowledge/store/migrations.js";
import {
  openKnowledgeDatabase,
  type KnowledgeDatabase,
} from "../src/knowledge/store/knowledgeDatabase.js";
import {
  replaceDocumentInTransaction,
  type ReplaceDocumentInput,
} from "../src/knowledge/store/indexRepository.js";
import { searchLexicalPass } from "../src/knowledge/search/lexicalRetriever.js";
import { createSemanticContext } from "../src/knowledge/search/embeddingPort.js";
import { buildMatchExpression, tokenizeForIndex } from "../src/knowledge/search/tokenizer.js";
import type { MarkdownChunk } from "../src/knowledge/index/markdownChunker.js";

/** 旧 schema 夹具：真实 v1 语句建库并落版本号 1（v2–v4 由打开路径自动升级）。 */
function createLegacyV1Database(dbPath: string): DatabaseSync {
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode=WAL");
  const v1 = KNOWLEDGE_MIGRATIONS.find((migration) => migration.version === 1);
  assert.ok(v1, "迁移阶梯应含 v1");
  // schema_version 由 runKnowledgeMigrations 负责（v1 语句清单之外），真实旧库必有此表。
  raw.exec("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)");
  for (const statement of v1.statements) {
    raw.exec(statement);
  }
  raw.exec("INSERT INTO schema_version(version) VALUES (1)");
  return raw;
}

/** 按旧写法种入单文档（无 tags/links 概念，FTS 只写 tokens 单列）。 */
function seedLegacyDocument(
  raw: DatabaseSync,
  doc: { relativePath: string; title: string; chunks: string[] },
): void {
  const insertDoc = raw.prepare(
    `INSERT INTO documents(vault_id, source_epoch, relative_path, title, sha256, size_bytes, mtime_ms,
       chunk_count, truncated, indexed_at_ms)
     VALUES ('vault-a', 1, ?, ?, 'sha-doc', 100, 0, ?, 0, 0)`,
  );
  const docResult = insertDoc.run(doc.relativePath, doc.title, doc.chunks.length);
  const documentId = Number(docResult.lastInsertRowid);
  const insertChunk = raw.prepare(
    `INSERT INTO chunks(document_id, ordinal, heading_path, level, start_line, end_line,
       start_offset, end_offset, sha256, body)
     VALUES (?, ?, NULL, 0, 1, 1, 0, 0, 'sha-chunk', ?)`,
  );
  const insertFts = raw.prepare(`INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)`);
  doc.chunks.forEach((body, ordinal) => {
    const chunkResult = insertChunk.run(documentId, ordinal, body);
    insertFts.run(Number(chunkResult.lastInsertRowid), tokenizeForIndex(body));
  });
}

function makeChunk(
  partial: Partial<MarkdownChunk> & Pick<MarkdownChunk, "ordinal" | "text">,
): MarkdownChunk {
  return {
    headingPath: null,
    level: 0,
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    endOffset: partial.text.length,
    sha256: `sha-${partial.ordinal}`,
    ...partial,
  };
}

function replaceDocument(
  db: KnowledgeDatabase,
  input: Omit<ReplaceDocumentInput, "indexedAtMs">,
): void {
  db.transaction((tx) => replaceDocumentInTransaction(tx, { ...input, indexedAtMs: 1 }));
}

test("迁移 v4：旧单列 FTS 库打开自动升级，旧数据 tokens/title 重填后可检索（meta 如实为空）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-knowledge-fts-"));
  try {
    const dbPath = join(dir, "knowledge-index.sqlite");
    const legacy = createLegacyV1Database(dbPath);
    seedLegacyDocument(legacy, {
      relativePath: "notes/quantum.md",
      // 「汇编」只出现在标题，正文从不出现 → 重填 title 列的直接检索证据。
      title: "会议纪要汇编",
      chunks: ["# 无关标题\n\n正文提到量子纠缠一次。"],
    });
    seedLegacyDocument(legacy, {
      relativePath: "notes/other.md",
      title: "无关合集",
      chunks: ["# 无关标题\n\n量子纠缠的推导放在这里。"],
    });
    legacy.close();

    const db = openKnowledgeDatabase(dbPath);
    try {
      const versionRow = db.raw
        .prepare("SELECT MAX(version) AS version FROM schema_version")
        .get() as { version: number };
      assert.ok(versionRow.version >= 4, "打开即应升级到 v4+（v5 向量表随阶梯推进）");
      // 三列存在（缺任一列此查询直接抛错）。
      assert.ok(db.raw.prepare("SELECT tokens, title, meta FROM chunks_fts LIMIT 1").get());

      // tokens 重填：正文词在两份旧文档均可检索（AND 零命中不降级——两文档都命中）。
      const bodyPass = await searchLexicalPass(
        db,
        { vaultId: "vault-a", sourceEpoch: 1 },
        "量子纠缠",
        {
          semantic: createSemanticContext(null),
          partial: false,
        },
      );
      assert.ok(
        bodyPass.candidates.length >= 2,
        `正文 token 重填后两文档应命中，实得 ${bodyPass.candidates.length}`,
      );

      // title 重填：仅存在于旧文档标题的词也可检索。
      const titlePass = await searchLexicalPass(
        db,
        { vaultId: "vault-a", sourceEpoch: 1 },
        "汇编",
        {
          semantic: createSemanticContext(null),
          partial: false,
        },
      );
      assert.ok(
        titlePass.candidates.some((candidate) => candidate.relativePath === "notes/quantum.md"),
        "仅标题含有的词应经 title 列命中",
      );

      // 旧数据未经结构抽取：meta 如实为空串，不编造产物。
      const metaRows = db.raw.prepare("SELECT meta FROM chunks_fts").all() as Array<{
        meta: string;
      }>;
      assert.ok(metaRows.length >= 2);
      for (const row of metaRows) assert.equal(row.meta, "");
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runKnowledgeMigrations：全新空库按阶梯推进到 v4 且重填循环对零行安全", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-knowledge-fts-"));
  try {
    const db = openKnowledgeDatabase(join(dir, "knowledge-index.sqlite"));
    try {
      const versionRow = db.raw
        .prepare("SELECT MAX(version) AS version FROM schema_version")
        .get() as { version: number };
      assert.ok(versionRow.version >= 4, "空库阶梯推进到 v4+");
      // 无 chunks 数据时重填循环零次，drop/rename 仍完整执行。
      assert.equal(
        (db.raw.prepare("SELECT COUNT(*) AS n FROM chunks_fts").get() as { n: number }).n,
        0,
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("列权重：标题命中排名高于仅正文命中（bm25 1.0/3.0/2.0，spec §5b.5）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-knowledge-fts-"));
  try {
    const db = openKnowledgeDatabase(join(dir, "knowledge-index.sqlite"));
    try {
      const padding = "无关的铺垫内容。";
      // 文档 A：查询词在标题/heading（title 列 + tokens 列都命中）。
      replaceDocument(db, {
        vaultId: "vault-a",
        sourceEpoch: 1,
        relativePath: "标题命中.md",
        title: "量子纠缠",
        sha256: "sha-a",
        sizeBytes: 10,
        mtimeMs: 1,
        truncated: false,
        chunks: [
          makeChunk({
            ordinal: 0,
            headingPath: "量子纠缠",
            level: 1,
            text: `# 量子纠缠\n${padding}`,
          }),
        ],
      });
      // 文档 B：查询词只在正文（仅 tokens 列命中，title 列无关）；块长与 A 相当。
      replaceDocument(db, {
        vaultId: "vault-a",
        sourceEpoch: 1,
        relativePath: "正文命中.md",
        title: "无关合集",
        sha256: "sha-b",
        sizeBytes: 10,
        mtimeMs: 1,
        truncated: false,
        chunks: [
          makeChunk({
            ordinal: 0,
            headingPath: "无关标题",
            level: 1,
            text: `# 无关标题\n${padding}正文里出现量子纠缠的概念。`,
          }),
        ],
      });

      const pass = await searchLexicalPass(db, { vaultId: "vault-a", sourceEpoch: 1 }, "量子纠缠", {
        semantic: createSemanticContext(null),
        partial: false,
      });
      assert.ok(pass.candidates.length >= 2, "两文档都应命中");
      assert.equal(pass.candidates[0]?.relativePath, "标题命中.md", "标题命中应排在仅正文命中之前");
      assert.equal(pass.candidates[1]?.relativePath, "正文命中.md");
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("meta 列：tags 文档级 + wikilinks 进 meta，标签词可命中正文 chunk（spec §5b.4/§5b.5）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drora-knowledge-fts-"));
  try {
    const db = openKnowledgeDatabase(join(dir, "knowledge-index.sqlite"));
    try {
      const documentTags = ["项目/atlas", "zettel"];
      replaceDocument(db, {
        vaultId: "vault-a",
        sourceEpoch: 1,
        relativePath: "notes/tagged.md",
        title: "项目笔记",
        sha256: "sha-t",
        sizeBytes: 10,
        mtimeMs: 1,
        truncated: false,
        chunks: [
          makeChunk({
            ordinal: 0,
            text: "---\ntags: [项目/atlas, zettel]\n---",
            tags: documentTags,
            links: [],
          }),
          makeChunk({
            ordinal: 1,
            headingPath: "背景",
            level: 2,
            startLine: 3,
            text: "## 背景\n\n链到 [[决策记录]]，正文无 atlas 字样。",
            tags: documentTags,
            links: ["决策记录"],
          }),
        ],
      });

      // meta 列直查：正文 chunk 的 meta = tags+links 的 token 产物（tags 文档级继承）。
      const metaRows = db.raw
        .prepare(
          `SELECT c.ordinal AS ordinal, f.meta AS meta FROM chunks_fts f
           JOIN chunks c ON c.id = f.rowid
           JOIN documents d ON d.id = c.document_id
           WHERE d.relative_path = 'notes/tagged.md' ORDER BY c.ordinal`,
        )
        .all() as Array<{ ordinal: number; meta: string }>;
      assert.equal(metaRows.length, 2);
      for (const row of metaRows) {
        assert.ok(row.meta.includes("atlas"), `ordinal=${row.ordinal} meta 应含 tag 产物`);
        assert.ok(row.meta.includes("zettel"));
      }
      const sectionMeta = metaRows.find((row) => row.ordinal === 1)?.meta ?? "";
      assert.ok(sectionMeta.includes("决策"), "wikilink 目标应进 meta");

      // 标签词命中：正文 chunk（「背景」节）文本无 atlas，仅凭 meta 列命中。
      const matchExpression = buildMatchExpression("atlas", false).expression;
      const hitRows = db.raw
        .prepare(
          `SELECT c.heading_path AS headingPath FROM chunks_fts
           JOIN chunks c ON c.id = chunks_fts.rowid
           JOIN documents d ON d.id = c.document_id
           WHERE chunks_fts MATCH ? AND d.relative_path = 'notes/tagged.md'`,
        )
        .all(matchExpression) as Array<{ headingPath: string | null }>;
      assert.ok(
        hitRows.some((row) => row.headingPath === "背景"),
        "正文 chunk 应凭 meta 列命中标签词",
      );
      // RPC 面不变（§5b.1）：常规检索路径同样返回该文章。
      const pass = await searchLexicalPass(db, { vaultId: "vault-a", sourceEpoch: 1 }, "atlas", {
        semantic: createSemanticContext(null),
        partial: false,
      });
      assert.ok(pass.candidates.some((candidate) => candidate.relativePath === "notes/tagged.md"));
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
