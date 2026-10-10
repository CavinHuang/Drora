/**
 * 索引仓储（W02）：documents/chunks/chunks_fts/index_jobs/coverage 的唯一读写口。
 *
 * FTS rowid 纪律：chunks_fts.rowid === chunks.id，插入/删除与 chunks 同事务；
 * 检索一律 JOIN 回 documents 按 (vaultId, sourceEpoch) 过滤——FTS 表本身不带源身份，
 * 候选隔离靠关系过滤完成（spec §5b.6）。
 */
import { createHash } from "node:crypto";
import type { KnowledgeDatabase } from "./knowledgeDatabase.js";
import type { MarkdownChunk } from "../index/markdownChunker.js";
import { tokenizeForIndex } from "../search/tokenizer.js";
import type {
  KnowledgeCoverage,
  KnowledgeIndexJobKind,
  KnowledgeIndexJobStatus,
  KnowledgeIndexJobView,
} from "../knowledgeTypes.js";

export interface DocumentIndexRow {
  id: number;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  mtimeMs: number;
  chunkCount: number;
  truncated: number;
}

export interface ReplaceDocumentInput {
  vaultId: string;
  sourceEpoch: number;
  relativePath: string;
  title: string;
  sha256: string;
  sizeBytes: number;
  mtimeMs: number;
  chunks: MarkdownChunk[];
  truncated: boolean;
  indexedAtMs: number;
}

/** 删除文档行 + 对应 FTS 行（调用方必须已在短事务内并完成 fence 校验）。 */
export function deleteDocumentRows(
  tx: KnowledgeDatabase,
  vaultId: string,
  sourceEpoch: number,
  relativePath: string,
): void {
  tx.raw
    .prepare(
      `DELETE FROM chunks_fts WHERE rowid IN (
         SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE d.vault_id = ? AND d.source_epoch = ? AND d.relative_path = ?
       )`,
    )
    .run(vaultId, sourceEpoch, relativePath);
  tx.raw
    .prepare(
      `DELETE FROM documents WHERE vault_id = ? AND source_epoch = ? AND relative_path = ?`,
    )
    .run(vaultId, sourceEpoch, relativePath);
}

/** 单文档替换（调用方必须已在短事务内并完成 fence 校验）：删旧 chunk+FTS → 插新。 */
export function replaceDocumentInTransaction(tx: KnowledgeDatabase, input: ReplaceDocumentInput): number {
  deleteDocumentRows(tx, input.vaultId, input.sourceEpoch, input.relativePath);

  const docResult = tx.raw
    .prepare(
      `INSERT INTO documents(vault_id, source_epoch, relative_path, title, sha256, size_bytes, mtime_ms,
         chunk_count, truncated, indexed_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.vaultId,
      input.sourceEpoch,
      input.relativePath,
      input.title,
      input.sha256,
      input.sizeBytes,
      input.mtimeMs,
      input.chunks.length,
      input.truncated ? 1 : 0,
      input.indexedAtMs,
    );
  const documentId = Number(docResult.lastInsertRowid);

  const insertChunk = tx.raw.prepare(
    `INSERT INTO chunks(document_id, ordinal, heading_path, level, start_line, end_line,
       start_offset, end_offset, sha256, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = tx.raw.prepare(`INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)`);
  for (const chunk of input.chunks) {
    const chunkResult = insertChunk.run(
      documentId,
      chunk.ordinal,
      chunk.headingPath,
      chunk.level,
      chunk.startLine,
      chunk.endLine,
      chunk.startOffset,
      chunk.endOffset,
      chunk.sha256,
      chunk.text,
    );
    insertFts.run(Number(chunkResult.lastInsertRowid), tokenizeForIndex(chunk.text));
  }
  return documentId;
}

export function deleteDocumentInTransaction(
  tx: KnowledgeDatabase,
  vaultId: string,
  sourceEpoch: number,
  relativePath: string,
): void {
  deleteDocumentRows(tx, vaultId, sourceEpoch, relativePath);
}

export function listDocuments(
  db: KnowledgeDatabase,
  vaultId: string,
  sourceEpoch: number,
): DocumentIndexRow[] {
  return db.raw
    .prepare(
      `SELECT id, relative_path AS relativePath, sha256, size_bytes AS sizeBytes, mtime_ms AS mtimeMs,
              chunk_count AS chunkCount, truncated
       FROM documents WHERE vault_id = ? AND source_epoch = ?`,
    )
    .all(vaultId, sourceEpoch) as unknown as DocumentIndexRow[];
}

export function countDocuments(db: KnowledgeDatabase, vaultId: string, sourceEpoch: number): number {
  const row = db.raw
    .prepare(`SELECT COUNT(*) AS n FROM documents WHERE vault_id = ? AND source_epoch = ?`)
    .get(vaultId, sourceEpoch) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

export interface CoverageCounters {
  hidden: number;
  symlink: number;
  notMarkdown: number;
  overSize: number;
  overQuota: number;
  depth: number;
  truncatedFiles: number;
}

export function saveCoverageInTransaction(
  tx: KnowledgeDatabase,
  vaultId: string,
  sourceEpoch: number,
  counters: CoverageCounters,
  indexedFiles: number,
  indexedChunks: number,
  nowMs: number,
): KnowledgeCoverage {
  tx.raw
    .prepare(
      `INSERT INTO coverage(vault_id, source_epoch, hidden, symlink, not_markdown, over_size, over_quota,
         depth, truncated_files, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vault_id, source_epoch) DO UPDATE SET hidden=excluded.hidden, symlink=excluded.symlink,
         not_markdown=excluded.not_markdown, over_size=excluded.over_size, over_quota=excluded.over_quota,
         depth=excluded.depth, truncated_files=excluded.truncated_files, updated_at_ms=excluded.updated_at_ms`,
    )
    .run(
      vaultId,
      sourceEpoch,
      counters.hidden,
      counters.symlink,
      counters.notMarkdown,
      counters.overSize,
      counters.overQuota,
      counters.depth,
      counters.truncatedFiles,
      nowMs,
    );
  const partial =
    counters.hidden > 0 ||
    counters.symlink > 0 ||
    counters.notMarkdown > 0 ||
    counters.overSize > 0 ||
    counters.overQuota > 0 ||
    counters.depth > 0 ||
    counters.truncatedFiles > 0;
  return {
    indexedFiles,
    indexedChunks,
    excludedHidden: counters.hidden,
    excludedSymlink: counters.symlink,
    excludedNotMarkdown: counters.notMarkdown,
    excludedOverSize: counters.overSize,
    excludedOverQuota: counters.overQuota,
    excludedDepth: counters.depth,
    truncatedFiles: counters.truncatedFiles,
    partial,
  };
}

export function loadCoverage(
  db: KnowledgeDatabase,
  vaultId: string,
  sourceEpoch: number,
): KnowledgeCoverage | null {
  const row = db.raw
    .prepare(
      `SELECT c.hidden, c.symlink, c.not_markdown, c.over_size, c.over_quota, c.depth, c.truncated_files,
              (SELECT COUNT(*) FROM documents d WHERE d.vault_id = c.vault_id AND d.source_epoch = c.source_epoch) AS indexed_files,
              (SELECT COALESCE(SUM(d.chunk_count), 0) FROM documents d WHERE d.vault_id = c.vault_id AND d.source_epoch = c.source_epoch) AS indexed_chunks
       FROM coverage c WHERE c.vault_id = ? AND c.source_epoch = ?`,
    )
    .get(vaultId, sourceEpoch) as
    | {
        hidden: number;
        symlink: number;
        not_markdown: number;
        over_size: number;
        over_quota: number;
        depth: number;
        truncated_files: number;
        indexed_files: number;
        indexed_chunks: number;
      }
    | undefined;
  if (!row) return null;
  const partial =
    row.hidden > 0 ||
    row.symlink > 0 ||
    row.not_markdown > 0 ||
    row.over_size > 0 ||
    row.over_quota > 0 ||
    row.depth > 0 ||
    row.truncated_files > 0;
  return {
    indexedFiles: row.indexed_files,
    indexedChunks: row.indexed_chunks,
    excludedHidden: row.hidden,
    excludedSymlink: row.symlink,
    excludedNotMarkdown: row.not_markdown,
    excludedOverSize: row.over_size,
    excludedOverQuota: row.over_quota,
    excludedDepth: row.depth,
    truncatedFiles: row.truncated_files,
    partial,
  };
}

// ---------------------------------------------------------------------------
// index_jobs
// ---------------------------------------------------------------------------

export function insertJobInTransaction(
  tx: KnowledgeDatabase,
  job: {
    id: string;
    vaultId: string;
    sourceEpoch: number;
    kind: KnowledgeIndexJobKind;
    generation: number;
    fence: number;
    nowMs: number;
  },
): void {
  tx.raw
    .prepare(
      `INSERT INTO index_jobs(id, vault_id, source_epoch, kind, status, generation, fence, requested_at_ms, started_at_ms)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .run(job.id, job.vaultId, job.sourceEpoch, job.kind, job.generation, job.fence, job.nowMs, job.nowMs);
}

export function updateJobInTransaction(
  tx: KnowledgeDatabase,
  jobId: string,
  patch: {
    status?: KnowledgeIndexJobStatus;
    finishedAtMs?: number | null;
    reason?: string | null;
    indexedFiles?: number;
    indexedChunks?: number;
    fence?: number;
  },
): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.finishedAtMs !== undefined) {
    sets.push("finished_at_ms = ?");
    values.push(patch.finishedAtMs);
  }
  if (patch.reason !== undefined) {
    sets.push("reason = ?");
    values.push(patch.reason);
  }
  if (patch.indexedFiles !== undefined) {
    sets.push("indexed_files = ?");
    values.push(patch.indexedFiles);
  }
  if (patch.indexedChunks !== undefined) {
    sets.push("indexed_chunks = ?");
    values.push(patch.indexedChunks);
  }
  if (patch.fence !== undefined) {
    sets.push("fence = ?");
    values.push(patch.fence);
  }
  if (sets.length === 0) return;
  values.push(jobId);
  tx.raw.prepare(`UPDATE index_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getJob(db: KnowledgeDatabase, jobId: string): KnowledgeIndexJobView | null {
  const row = db.raw.prepare(`SELECT * FROM index_jobs WHERE id = ?`).get(jobId) as
    | {
        id: string;
        kind: KnowledgeIndexJobKind;
        status: KnowledgeIndexJobStatus;
        generation: number;
        fence: number;
        source_epoch: number;
        started_at_ms: number;
        finished_at_ms: number | null;
        reason: string | null;
        indexed_files: number;
        indexed_chunks: number;
      }
    | undefined;
  if (!row) return null;
  return {
    jobId: row.id,
    kind: row.kind,
    status: row.status,
    generation: row.generation,
    fence: row.fence,
    sourceEpoch: row.source_epoch,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    reason: row.reason,
    indexedFiles: row.indexed_files,
    indexedChunks: row.indexed_chunks,
  };
}

/** 最近一条任务（任意状态，任意 epoch——查看旧任务也属于诚实呈现）。 */
export function getLatestJob(db: KnowledgeDatabase): KnowledgeIndexJobView | null {
  const row = db.raw
    .prepare(`SELECT id FROM index_jobs ORDER BY requested_at_ms DESC, rowid DESC LIMIT 1`)
    .get() as { id: string } | undefined;
  return row ? getJob(db, row.id) : null;
}

/** 文章级候选 id：sha256(vaultId + relativePath)，不含根路径，可安全出站。 */
export function articleIdOf(vaultId: string, relativePath: string): string {
  return createHash("sha256").update(`${vaultId}\n${relativePath}`, "utf-8").digest("hex");
}
