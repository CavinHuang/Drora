/**
 * 词法检索 + 候选融合（W02 引入；W05 拆出单轮检索 `searchLexicalPass`）。
 *
 * - FTS5 `MATCH ?` 严格参数化：表达式只来自 tokenizer 产物；
 * - bm25() 升序（更负 = 更相关）；列权重 tokens/title/meta = 1.0/3.0/2.0（实验初值，
 *   spec §5b.5）——MATCH 不限列，标题/标签/链接词可命中，权重只体现排序主次；
 * - 候选隔离：JOIN documents 后按 (vaultId, sourceEpoch) 过滤；
 * - 文章级去重聚合：同文档多 chunk 合并为一条候选（最佳 chunk 代表 + 命中数）；
 * - 扩搜（AND 无命中 → OR 降级）的上限一次：W05 起由本地 DecisionPolicy 裁决
 *   （编排器先跑 AND 轮，policy 判 EXPAND_ONCE 后再跑 OR 轮；`searchKnowledgeLexical`
 *   保留为等价复合入口，供既有调用方与评测基线使用）。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { articleIdOf } from "../store/indexRepository.js";
import { loadVectorChunks } from "../store/vectorRepository.js";
import { buildMatchExpression, extractQueryTerms } from "./tokenizer.js";
import { cosineSimilarity, type KnowledgeSemanticContext } from "./embeddingPort.js";
import type { KnowledgeArticleCandidate, KnowledgeSearchDiagnostics } from "../knowledgeTypes.js";

/** bge-zh 查询侧指令前缀（模型卡要求；仅查询加，索引侧不加——spec §5b.9）。 */
export const QUERY_EMBEDDING_INSTRUCTION = "为这个句子生成表示以用于检索相关文章：";

const EXCERPT_MAX_CHARS = 240;
/** 命中位置前的引导上下文（可读性；窗口仍受 EXCERPT_MAX_CHARS 总长约束）。 */
const EXCERPT_CONTEXT_LEAD = 48;
/** 每词元最多统计的正文出现次数（防超长单段落退化；窗口选择只需局部密度）。 */
const MAX_OCCURRENCES_PER_TERM = 8;
const CANDIDATE_CHUNK_POOL = 64;
const DEFAULT_CANDIDATE_LIMIT = 5;
const MAX_CANDIDATE_LIMIT = 20;

/**
 * bm25 列权重（spec §5b.5，schema v4 三列 tokens/title/meta）：正文 1.0 / 标题 3.0 /
 * meta(tags+links) 2.0。实验初值——标题表达文档主旨应压过正文长尾，结构化信号次之；
 * 待 W05 评测数据集校准。MATCH 不限列：三列都参与命中，权重只体现排序主次。
 */
const BM25_COLUMN_WEIGHTS = "1.0, 3.0, 2.0";

export interface LexicalSearchResult {
  candidates: KnowledgeArticleCandidate[];
  diagnostics: KnowledgeSearchDiagnostics;
  status: "ready" | "partial" | "empty";
}

/** 单轮检索结果：附该轮 MATCH 表达式信息（policy 的 EXPAND_ONCE 依据）。 */
export interface LexicalPassResult extends LexicalSearchResult {
  /** 本轮 MATCH 的词元数（诊断口径）。 */
  tokenCount: number;
  /** 本轮是否降级轮（OR 形态）。 */
  relaxed: boolean;
  /** strict 形态下判定：降级形态确会产生不同表达式（§5b.5 扩搜资格）。 */
  canRelax: boolean;
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
              bm25(chunks_fts, ${BM25_COLUMN_WEIGHTS}) AS score
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE chunks_fts MATCH ? AND d.vault_id = ? AND d.source_epoch = ?
       ORDER BY score
       LIMIT ?`,
    )
    .all(matchExpression, source.vaultId, source.sourceEpoch, limit) as unknown as ChunkHit[];
}

/**
 * 向量召回（spec §5b.9 混合召回）：查询向量 vs 当前源全量 chunk_vectors 的余弦 top-K。
 * 返回的 hit 不带 bm25 分（score=0，天然排在词法命中之后），由既有语义余弦重排接管
 * 最终次序。端口缺席/查询嵌入失败/库无向量 → 空数组（该层独立降级）。
 */
async function recallByVector(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  port: NonNullable<KnowledgeSemanticContext["port"]>,
  query: string,
): Promise<ChunkHit[]> {
  try {
    const vectors = await port.embed([QUERY_EMBEDDING_INSTRUCTION + query]);
    const queryVector = vectors?.[0];
    if (!queryVector || queryVector.length === 0) return [];
    const rows = loadVectorChunks(db, source, port.id);
    const dim = queryVector.length;
    const scored = rows
      .filter((row) => row.vector.length === dim)
      .map((row) => ({ row, similarity: cosineSimilarity(queryVector, Array.from(row.vector)) }));
    scored.sort(
      (left, right) => right.similarity - left.similarity || left.row.chunkId - right.row.chunkId,
    );
    return scored.slice(0, CANDIDATE_CHUNK_POOL).map(({ row }) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      relativePath: row.relativePath,
      title: row.title,
      sha256: row.docSha256,
      chunkSha256: row.chunkSha256,
      headingPath: row.headingPath,
      body: row.body,
      startLine: row.startLine,
      endLine: row.endLine,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      score: 0,
    }));
  } catch {
    return [];
  }
}

function excerptOf(body: string): string {
  const compact = body.replace(/\s+/gu, " ").trim();
  return compact.length > EXCERPT_MAX_CHARS ? `${compact.slice(0, EXCERPT_MAX_CHARS)}…` : compact;
}

/**
 * 命中感知摘要（spec §5b.5）：逐字滑窗选取覆盖最多不同查询词元的窗口（并列取最早），
 * 窗口两侧截断以「…」标注。词元以子串形态在正文中查找（英文小写化比对；bigram/
 * 前缀词按索引构造必然出现在命中文本里）；无任何词元命中时回落正文开头（兜底，
 * 正常词法命中不可达）。摘要是逐字切片，不引入任何非原文内容。
 */
export function matchAwareExcerpt(body: string, terms: readonly string[]): string {
  const lower = body.toLowerCase();
  const occurrences: Array<{ position: number; termIndex: number }> = [];
  for (let termIndex = 0; termIndex < terms.length; termIndex++) {
    const term = terms[termIndex];
    if (!term) continue;
    const needle = term.toLowerCase();
    let found = 0;
    let index = lower.indexOf(needle);
    while (index !== -1 && found < MAX_OCCURRENCES_PER_TERM) {
      occurrences.push({ position: index, termIndex });
      found += 1;
      index = lower.indexOf(needle, index + needle.length);
    }
  }
  if (occurrences.length === 0) return excerptOf(body);

  // 候选窗口左界：每个出现位置回退固定引导上下文；取覆盖不同词元数最多者（并列最早）。
  let bestStart = -1;
  let bestCovered = -1;
  const starts = [
    ...new Set(occurrences.map((occurrence) => Math.max(0, occurrence.position - EXCERPT_CONTEXT_LEAD))),
  ].sort((left, right) => left - right);
  for (const start of starts) {
    const end = start + EXCERPT_MAX_CHARS;
    const covered = new Set<number>();
    for (const occurrence of occurrences) {
      if (occurrence.position >= start && occurrence.position < end) covered.add(occurrence.termIndex);
    }
    if (covered.size > bestCovered) {
      bestCovered = covered.size;
      bestStart = start;
    }
  }
  if (bestStart < 0) return excerptOf(body);

  const sliceEnd = Math.min(body.length, bestStart + EXCERPT_MAX_CHARS);
  const compact = body.slice(bestStart, sliceEnd).replace(/\s+/gu, " ").trim();
  const prefix = bestStart > 0 ? "…" : "";
  const suffix = sliceEnd < body.length ? "…" : "";
  return `${prefix}${compact}${suffix}`;
}

/** chunk 命中 → 文章候选（去重聚合，保持 bm25 名次）；terms 供命中感知摘要（spec §5b.5）。 */
export function fuseChunkHitsToArticles(
  source: { vaultId: string },
  hits: ChunkHit[],
  limit: number,
  terms: readonly string[] = [],
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
    excerpt: matchAwareExcerpt(entry.hit.body, terms),
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
 * 单轮检索（W05 拆分）：`relaxed=false` 为 AND 轮，`true` 为 OR 扩搜轮。
 * 词法必做；语义端口可用时对词法池做余弦重排（§5b.5）。
 */
export async function searchLexicalPass(
  db: KnowledgeDatabase,
  source: { vaultId: string; sourceEpoch: number },
  query: string,
  options: {
    semantic: KnowledgeSemanticContext;
    partial: boolean;
    limit?: number;
    relaxed: boolean;
  },
): Promise<LexicalPassResult> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1), MAX_CANDIDATE_LIMIT);
  const expression = buildMatchExpression(query, options.relaxed);
  let diagnostics: KnowledgeSearchDiagnostics = {
    semantic: "skipped",
    semanticReason: null,
    lexicalChunkHits: 0,
    lexicalCandidates: 0,
    matchRelaxedToOr: options.relaxed && expression.canRelax,
  };

  let hits = searchChunks(db, source, expression.expression, CANDIDATE_CHUNK_POOL);
  // 混合召回（spec §5b.9）：向量 top-K 与词法命中按 chunkId 去重合并；向量独有命中
  // score=0 排在词法之后，语义余弦重排再按相似度接管全池次序。
  const embeddingPort = options.semantic.port;
  const vectorOnlyHits = embeddingPort === null ? [] : await recallByVector(db, source, embeddingPort, query);
  if (vectorOnlyHits.length > 0) {
    const lexicalIds = new Set(hits.map((hit) => hit.chunkId));
    const recalled = vectorOnlyHits.filter((hit) => !lexicalIds.has(hit.chunkId));
    if (recalled.length > 0) hits = [...hits, ...recalled];
    diagnostics = { ...diagnostics, semanticRecalled: recalled.length };
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

  const candidates = fuseChunkHitsToArticles(source, pool, limit, extractQueryTerms(query));
  const resolvedDiagnostics: KnowledgeSearchDiagnostics = {
    ...diagnostics,
    lexicalChunkHits: hits.length,
    lexicalCandidates: pool.length,
  };
  return {
    candidates,
    diagnostics: resolvedDiagnostics,
    status: candidates.length === 0 ? "empty" : options.partial ? "partial" : "ready",
    tokenCount: expression.tokenCount,
    relaxed: options.relaxed,
    canRelax: expression.canRelax,
  };
}

/**
 * 本地混合检索复合入口（W02 行为保持）：AND 无命中且降级形态确会不同（canRelax，
 * §5b.5）时执行唯一一次降级轮（扩搜上限一次）。新编排路径走 `searchLexicalPass` +
 * DecisionPolicy。
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
  const andPass = await searchLexicalPass(db, source, query, { ...options, relaxed: false });
  if (andPass.candidates.length === 0 && andPass.canRelax) {
    const orPass = await searchLexicalPass(db, source, query, { ...options, relaxed: true });
    return {
      candidates: orPass.candidates,
      diagnostics: orPass.diagnostics,
      status: orPass.status,
    };
  }
  return andPass;
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
