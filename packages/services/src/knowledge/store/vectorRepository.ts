/**
 * 向量存储仓库函数（schema v5 / spec §5b.9）。
 *
 * 从 indexRepository 拆出收口 max-lines 门禁：查询侧全量加载、回填 keyset 分页
 * 与批量写入。短事务纪律与 fence 校验由调用方（协调器）承担，本层只做纯 DB。
 */
import type { KnowledgeDatabase } from "./knowledgeDatabase.js";

/** 向量检索行：chunk 事实字段 + 向量（spec §5b.9 混合召回的池成员）。 */
export interface ChunkVectorRow {
  chunkId: number;
  documentId: number;
  relativePath: string;
  title: string;
  docSha256: string;
  chunkSha256: string;
  headingPath: string | null;
  body: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  vector: Float32Array;
}

/** 加载一个源（vaultId+epoch）下指定模型的全部 chunk 向量（查询侧混合召回用）。 */
export function loadVectorChunks(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  modelId: string,
): ChunkVectorRow[] {
  const rows = db.raw
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.heading_path AS headingPath,
              c.body, c.start_line AS startLine, c.end_line AS endLine,
              c.start_offset AS startOffset, c.end_offset AS endOffset, c.sha256 AS chunkSha256,
              d.relative_path AS relativePath, d.title AS title, d.sha256 AS docSha256,
              v.vector AS vector
       FROM chunk_vectors v
       JOIN chunks c ON c.id = v.chunk_id
       JOIN documents d ON d.id = c.document_id
       WHERE v.model_id = ? AND d.vault_id = ? AND d.source_epoch = ?`,
    )
    .all(modelId, source.vaultId, source.sourceEpoch) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const blob = row.vector as Buffer;
    return {
      chunkId: row.chunkId as number,
      documentId: row.documentId as number,
      relativePath: row.relativePath as string,
      title: row.title as string,
      docSha256: row.docSha256 as string,
      chunkSha256: row.chunkSha256 as string,
      headingPath: (row.headingPath as string | null) ?? null,
      body: row.body as string,
      startLine: row.startLine as number,
      endLine: row.endLine as number,
      startOffset: row.startOffset as number,
      endOffset: row.endOffset as number,
      vector: new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4)),
    };
  });
}

/** 当前源缺向量的 chunk 数（回填判据：模型 id 匹配口径）。 */
export function countMissingVectors(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  modelId: string,
): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS n FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE d.vault_id = ? AND d.source_epoch = ?
         AND NOT EXISTS (SELECT 1 FROM chunk_vectors v WHERE v.chunk_id = c.id AND v.model_id = ?)`,
    )
    .get(source.vaultId, source.sourceEpoch, modelId) as { n: number };
  return row.n;
}

/** keyset 分页加载缺向量的 chunk（回填阶段按批嵌入；id 升序保证推进稳定）。 */
export function loadChunksMissingVectors(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  modelId: string,
  limit: number,
  afterId: number,
): Array<{ id: number; body: string }> {
  return db.raw
    .prepare(
      `SELECT c.id AS id, c.body AS body FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE d.vault_id = ? AND d.source_epoch = ? AND c.id > ?
         AND NOT EXISTS (SELECT 1 FROM chunk_vectors v WHERE v.chunk_id = c.id AND v.model_id = ?)
       ORDER BY c.id LIMIT ?`,
    )
    .all(source.vaultId, source.sourceEpoch, afterId, modelId, limit) as Array<{
    id: number;
    body: string;
  }>;
}

/** 回填批量写向量（调用方已在短事务内并完成 fence 校验）。 */
export function insertVectorsInTransaction(
  tx: KnowledgeDatabase,
  modelId: string,
  rows: Array<{ chunkId: number; vector: number[] }>,
): void {
  const insert = tx.raw.prepare(
    `INSERT INTO chunk_vectors(chunk_id, model_id, dim, vector) VALUES (?, ?, ?, ?)`,
  );
  for (const row of rows) {
    if (row.vector.length === 0) continue;
    const float32 = new Float32Array(row.vector);
    insert.run(row.chunkId, modelId, float32.length, Buffer.from(float32.buffer));
  }
}

/** 向量覆盖统计（spec §5b.9 准确性可观测）：当前源 chunk 总数 vs 有该模型向量的数量。 */
export function loadVectorCoverage(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  modelId: string,
): { chunksWithVectors: number; totalChunks: number } {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN v.chunk_id IS NOT NULL THEN 1 ELSE 0 END) AS covered
       FROM chunks c JOIN documents d ON d.id = c.document_id
       LEFT JOIN chunk_vectors v ON v.chunk_id = c.id AND v.model_id = ?
       WHERE d.vault_id = ? AND d.source_epoch = ?`,
    )
    .get(modelId, source.vaultId, source.sourceEpoch) as {
    total: number;
    covered: number | null;
  };
  return { chunksWithVectors: row.covered ?? 0, totalChunks: row.total };
}
