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
 */
import {
  KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS,
} from "@drora/shared";
import type { DatabaseSync } from "node:sqlite";

/** 仅供类型标注：DatabaseSync 已具备 prepare/exec，这里统一收口类型引用。 */
export type KnowledgeDatabaseRaw = DatabaseSync;

interface Migration {
  version: number;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
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
];

export function runKnowledgeMigrations(raw: KnowledgeDatabaseRaw): void {
  raw.exec("CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL)");
  const row = raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as {
    version?: number;
  } | undefined;
  const current = row?.version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    raw.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        raw.exec(statement);
      }
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
