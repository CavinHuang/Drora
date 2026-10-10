/**
 * 词法检索 + 候选融合（W02 / spec §5b.5–5b.6）。
 *
 * - FTS5 `MATCH ?` 严格参数化：表达式只来自 tokenizer 产物；
 * - bm25() 升序（更负 = 更相关）；
 * - 候选隔离：JOIN documents 后按 (vaultId, sourceEpoch) 过滤；
 * - 文章级去重聚合：同文档多 chunk 合并为一条候选（最佳 chunk 代表 + 命中数）；
 * - AND 无命中 → 同规则 OR 降级重试一次（至多一次扩搜，工作单 6/A11 的 W02 部分）。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { articleIdOf } from "../store/indexRepository.js";
import { buildMatchExpression } from "./tokenizer.js";
import { cosineSimilarity, type KnowledgeSemanticContext } from "./embeddingPort.js";
import type { KnowledgeArticleCandidate, KnowledgeSearchDiagnostics } from "../knowledgeTypes.js";

const EXCERPT_MAX_CHARS = 240;
const CANDIDATE_CHUNK_POOL = 64;
const DEFAULT_CANDIDATE_LIMIT = 5;
const MAX_CANDIDATE_LIMIT = 20;

export interface LexicalSearchResult {
  candidates: KnowledgeArticleCandidate[];
  diagnostics: KnowledgeSearchDiagnostics;
  status: "ready" | "partial" | "empty";
}

interface ChunkHit {
  documentId: number;
  chunkId: number;
  relativePath: string;
  title: string;
  sha256: string;
  chunkSha256: string;
  headingPath: string | null;
  body: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  score: number;
}

function searchChunks(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  matchExpression: string,
  limit: number,
): ChunkHit[] {
  return db.raw
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, c.heading_path AS headingPath, c.body,
              c.start_line AS startLine, c.end_line AS endLine, c.start_offset AS startOffset,
              c.end_offset AS endOffset, c.sha256 AS chunkSha256,
              d.relative_path AS relativePath, d.title, d.sha256,
              bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? AND d.vault_id = ? AND d.source_epoch = ?
       ORDER BY score
       LIMIT ?`,
    )
    .all(matchExpression, source.vaultId, source.sourceEpoch, limit) as unknown as ChunkHit[];
}

function excerptOf(body: string): string {
  const compact = body.replace(/\s+/gu, " ").trim();
  return compact.length > EXCERPT_MAX_CHARS ? `${compact.slice(0, EXCERPT_MAX_CHARS)}…` : compact;
}

/** chunk 命中 → 文章候选（去重聚合，保持 bm25 名次）。 */
export function fuseChunkHitsToArticles(
  source: { vaultId: string },
  hits: ChunkHit[],
  limit: number,
): KnowledgeArticleCandidate[] {
  const byArticle = new Map<string, { hit: ChunkHit; count: number; bestScore: number }>();
  for (const hit of hits) {
    const articleId = articleIdOf(source.vaultId, hit.relativePath);
    const entry = byArticle.get(articleId);
    if (entry) {
      entry.count += 1;
      // 更负 = 更相关；代表 chunk 取名次最前（hits 已按 score 升序）。
      continue;
    }
    byArticle.set(articleId, { hit, count: 1, bestScore: hit.score });
  }
  return [...byArticle.values()].slice(0, limit).map((entry, index) => ({
    articleId: articleIdOf(source.vaultId, entry.hit.relativePath),
    title: entry.hit.title,
    relativePath: entry.hit.relativePath,
    matchedHeading: entry.hit.headingPath,
    excerpt: excerptOf(entry.hit.body),
    quote: {
      startLine: entry.hit.startLine,
      endLine: entry.hit.endLine,
      startOffset: entry.hit.startOffset,
      endOffset: entry.hit.endOffset,
    },
    fileSha256: entry.hit.sha256,
    chunkSha256: entry.hit.chunkSha256,
    rank: index + 1,
    score: entry.bestScore,
    matchedChunkCount: entry.count,
    evidenceStatus: "unverified" as const,
  }));
}

/**
 * 本地混合检索主入口：词法必做；语义端口可用时对词法池做余弦重排（§5b.5）。
 * 返回结构化状态：partial 来自 coverage.partial（由调用方传入）。
 */
export async function searchKnowledgeLexical(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  query: string,
  options: {
    semantic: KnowledgeSemanticContext;
    partial: boolean;
    limit?: number;
  },
): Promise<LexicalSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1), MAX_CANDIDATE_LIMIT);
  let diagnostics: KnowledgeSearchDiagnostics = {
    semantic: "skipped",
    semanticReason: null,
    lexicalChunkHits: 0,
    lexicalCandidates: 0,
    matchRelaxedToOr: false,
  };

  let hits: ChunkHit[] = [];
  const andExpression = buildMatchExpression(query, false);
  hits = searchChunks(db, source, andExpression.expression, CANDIDATE_CHUNK_POOL);
  if (hits.length === 0 && andExpression.tokenCount > 1) {
    const orExpression = buildMatchExpression(query, true);
    hits = searchChunks(db, source, orExpression.expression, CANDIDATE_CHUNK_POOL);
    diagnostics = { ...diagnostics, matchRelaxedToOr: true };
  }

  let pool = hits;
  if (options.semantic.port) {
    try {
      const vectors = await options.semantic.port.embed([query, ...hits.map((hit) => hit.body)]);
      const queryVector = vectors?.[0];
      if (!vectors || !queryVector || vectors.length !== hits.length + 1) {
        diagnostics = {
          ...diagnostics,
          semantic: "unavailable",
          semanticReason: `embed_failed:${options.semantic.port.id}`,
        };
      } else {
        pool = rankBySemantic(hits, queryVector, vectors.slice(1));
        diagnostics = { ...diagnostics, semantic: "applied", semanticReason: null };
      }
    } catch (error) {
      diagnostics = {
        ...diagnostics,
        semantic: "unavailable",
        semanticReason: `embed_threw:${error instanceof Error ? error.name : "unknown"}`,
      };
    }
  } else {
    diagnostics = { ...diagnostics, semantic: "unavailable", semanticReason: "port_not_configured" };
  }

  const candidates = fuseChunkHitsToArticles(source, pool, limit);
  const resolvedDiagnostics: KnowledgeSearchDiagnostics = {
    ...diagnostics,
    lexicalChunkHits: hits.length,
    lexicalCandidates: pool.length,
  };
  return {
    candidates,
    diagnostics: resolvedDiagnostics,
    status: candidates.length === 0 ? "empty" : options.partial ? "partial" : "ready",
  };
}

/**
 * 语义重排：对词法命中池按余弦相似度降序稳定重排（相似度并列保持 bm25 名次）。
 * score 字段仍为 bm25 值——语义只影响排序，不伪造第二套分数。
 */
function rankBySemantic(hits: ChunkHit[], queryVector: number[], chunkVectors: number[][]): ChunkHit[] {
  if (hits.length === 0 || hits.length !== chunkVectors.length) return hits;
  const decorated = hits.map((hit, index) => ({
    hit,
    similarity: cosineSimilarity(queryVector, chunkVectors[index] ?? []),
    bm25Order: index,
  }));
  decorated.sort((left, right) => {
    if (right.similarity !== left.similarity) return right.similarity - left.similarity;
    return left.bm25Order - right.bm25Order;
  });
  return decorated.map((entry) => entry.hit);
}

export { cosineSimilarity };
