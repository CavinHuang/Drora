/**
 * knowledge-index.sqlite schema migrations（W02/W03）。
 *
 * v1（初始）：
 * - sources：源身份 + 当前 sourceEpoch（fingerprint 变化 → epoch+1，见 sourceRegistry）；
 * - documents/chunks：按 (vaultId, sourceEpoch) 隔离的可重建缓存；
 * - chunks_fts：独立 FTS5 表，rowid === chunks.id（工作单"FTS index/rowid"），
 *   插入/删除与 chunks 行同事务同步；
 * - index_jobs / index_lease / coverage。
 *
 * v2（W03 EvidenceReceipt）：
 * - evidence_receipts：opaque 引用账本（specs/obsidian-knowledge.md §5.1）。DDL 列清单
 *   以 @drora/shared knowledge-evidence 常量为单一出处——CLI Runtime gate 以只读连接
 *   消费同一张表，两侧禁止手写第二份字面量。
 *
 * v3（W06 审核写入账本，specs/obsidian-knowledge.md §5e）：
 * - review_proposals / review_approvals / review_operations / review_operation_files：
 *   L2 治理提案、批准绑定（revision+changesHash+sourceEpoch）、Operation ledger
 *   （operationId 唯一约束，prepared→applying→applied/conflict/uncertain）与写前快照。
 *   这四张表是**持久账本**：索引可重建（documents/chunks/chunks_fts/index_jobs/coverage
 *   可被 prune/rebuild 清除），审核账本绝不在任何清除路径上。
 *
 * v4（FTS 多列 + 结构抽取，specs/obsidian-knowledge.md §5b.4/§5b.5）：
 * - chunks_fts 由单列 (tokens) 重建为 (tokens, title, meta)。FTS5 不能 ALTER，
 *   迁移 = 建 chunks_fts_v4 → 按 chunks+documents 重填（复用 tokenizer 同步执行，
 *   prepared 语句复用，循环只做纯计算）→ drop 旧表 → rename，与版本号推进同事务。
 *   旧数据未经结构抽取，meta 重填为空串（tokens/title 如实重填可检索）；新抽取产物
 *   随文件变更/重建自然补齐（与 §5b.4 尺寸切分同一迁移语义，不做迁移期全库重读）。
 */
import {
  KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS,
} from "@drora/shared";
import type { DatabaseSync } from "node:sqlite";
import { tokenizeForIndex } from "../search/tokenizer.js";

/** 仅供类型标注：DatabaseSync 已具备 prepare/exec，这里统一收口类型引用。 */
export type KnowledgeDatabaseRaw = DatabaseSync;

interface Migration {
  version: number;
  statements: string[];
  /**
   * statements 之后、版本号推进之前在同一事务内执行的重填步骤（v4 FTS 重建用）：
   * DDL 表达不了的数据搬运（需要 JS 侧 tokenizer 计算）走这里，不做任何外部 IO。
   */
  refill?: (raw: KnowledgeDatabaseRaw) => void;
}

/** 迁移阶梯（导出供测试构造旧 schema 夹具；生产消费只经 runKnowledgeMigrations）。 */
export const KNOWLEDGE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS meta(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sources(
        vault_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        current_epoch INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS documents(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        relative_path TEXT NOT NULL,
        title TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        indexed_at_ms INTEGER NOT NULL,
        UNIQUE(vault_id, source_epoch, relative_path)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_documents_epoch ON documents(vault_id, source_epoch)`,
      `CREATE TABLE IF NOT EXISTS chunks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        heading_path TEXT,
        level INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        body TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)`,
      // 独立 FTS5 表：rowid 即 chunks.id；tokens 列存 tokenizer 产物（中文 bigram + 英文词）。
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(tokens)`,
      `CREATE TABLE IF NOT EXISTS index_jobs(
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        generation INTEGER NOT NULL,
        fence INTEGER NOT NULL,
        requested_at_ms INTEGER NOT NULL,
        started_at_ms INTEGER,
        finished_at_ms INTEGER,
        reason TEXT,
        indexed_files INTEGER NOT NULL DEFAULT 0,
        indexed_chunks INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS index_lease(
        name TEXT PRIMARY KEY,
        owner TEXT,
        epoch INTEGER NOT NULL DEFAULT 0,
        expires_at_ms INTEGER NOT NULL DEFAULT 0,
        heartbeat_at_ms INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS coverage(
        vault_id TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        symlink INTEGER NOT NULL DEFAULT 0,
        not_markdown INTEGER NOT NULL DEFAULT 0,
        over_size INTEGER NOT NULL DEFAULT 0,
        over_quota INTEGER NOT NULL DEFAULT 0,
        depth INTEGER NOT NULL DEFAULT 0,
        truncated_files INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(vault_id, source_epoch)
      )`,
    ],
  },
  {
    version: 2,
    statements: [...KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS review_proposals(
        proposal_id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        revision INTEGER NOT NULL,
        changes_hash TEXT NOT NULL,
        changes_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        rejected_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS review_approvals(
        proposal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        changes_hash TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        approved_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        PRIMARY KEY(proposal_id, revision)
      )`,
      `CREATE TABLE IF NOT EXISTS review_operations(
        operation_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        vault_id TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER,
        reconciled_at_ms INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_review_operations_proposal
        ON review_operations(proposal_id)`,
      `CREATE TABLE IF NOT EXISTS review_operation_files(
        operation_id TEXT NOT NULL REFERENCES review_operations(operation_id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        relative_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_sha256 TEXT,
        next_sha256 TEXT,
        next_content TEXT,
        snapshot_content TEXT,
        snapshot_sha256 TEXT,
        status TEXT NOT NULL,
        error TEXT,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(operation_id, ordinal)
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      // FTS5 不能 ALTER：先建新形表，重填后 drop 旧表再 rename（spec §5b.5）。
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts_v4 USING fts5(tokens, title, meta)`,
    ],
    refill: rebuildChunksFtsColumns,
  },
];

/**
 * v4 重填（spec §5b.5）：chunks+documents → chunks_fts_v4 三列。
 * - tokens：chunk 正文 token 产物（与旧单列同口径）；
 * - title：文档标题 + heading 路径的 token 产物（`>` 非词元，tokenizer 自然丢弃）；
 * - meta：旧数据未经结构抽取，如实置空——新产物随文件变更/重建自然补齐。
 * 同步执行：prepared 语句循环复用，循环体只有纯计算，无任何外部 IO（§5b.3 纪律）。
 * 逐行流式（iterate）：读游标与写入不同表（chunks/documents → chunks_fts_v4），同一
 * 连接上游标推进边插边安全——不把全库 chunks（含 body）一次性物化进内存
 * （独立复核发现2：大索引一次性迁移的内存峰值应 O(1) 行而非 O(全库)）。
 */
function rebuildChunksFtsColumns(raw: KnowledgeDatabaseRaw): void {
  const rows = raw
    .prepare(
      `SELECT c.id AS id, c.body AS body, c.heading_path AS headingPath, d.title AS title
       FROM chunks c JOIN documents d ON d.id = c.document_id`,
    )
    .iterate() as IterableIterator<{ id: number; body: string; headingPath: string | null; title: string }>;
  const insert = raw.prepare(
    `INSERT INTO chunks_fts_v4(rowid, tokens, title, meta) VALUES (?, ?, ?, ?)`,
  );
  for (const row of rows) {
    const titleSource = row.headingPath ? `${row.title} ${row.headingPath}` : row.title;
    insert.run(row.id, tokenizeForIndex(row.body), tokenizeForIndex(titleSource), "");
  }
  raw.exec("DROP TABLE chunks_fts");
  raw.exec("ALTER TABLE chunks_fts_v4 RENAME TO chunks_fts");
}

export function runKnowledgeMigrations(raw: KnowledgeDatabaseRaw): void {
  raw.exec("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)");
  const row = raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as {
    version?: number;
  } | undefined;
  const current = row?.version ?? 0;
  for (const migration of KNOWLEDGE_MIGRATIONS) {
    if (migration.version <= current) continue;
    raw.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        raw.exec(statement);
      }
      migration.refill?.(raw);
      raw.exec("DELETE FROM schema_version");
      raw.prepare("INSERT INTO schema_version(version) VALUES (?)").run(migration.version);
      raw.exec("COMMIT");
    } catch (error) {
      try {
        raw.exec("ROLLBACK");
      } catch {
        // 连接级失败时保留原始错误。
      }
      throw error;
    }
  }
}
