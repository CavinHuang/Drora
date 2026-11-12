// 迁自 packages/services/src/knowledge/query/knowledgeNeighbors.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * vault_neighbors 近邻计算（specs/obsidian-vault-plugin-extraction.md §4.3，B5）。
 *
 * 纯本地一次性只读计算：种子笔记的已存 chunk 向量（chunk_vectors v5）聚合为笔记级
 * 质心向量，对其余文档 chunk 向量做余弦近邻——零出站、零新嵌入、无 run 生命周期
 * （与 querySearchPipeline 是两条不同的只读路径，共用同一 DB/源解析/端口纪律）。
 * 笔记级聚合是 N2「note 级向量聚合」的同一语义：逐 chunk 两两对比是
 * O(种子 chunk 数 × 全库 chunk 数 × 维度)，质心聚合把内循环压回与既有语义召回
 * 同量级（1 × 全库 chunk 数 × 维度），满足 N2「已索引时 ≤1s」的可及基线。
 *
 * ChunkVectorRow → KnowledgeNeighborsResult 的白名单映射收口在本文件（对应 search
 * 链的 vaultSearchProtocol.ts 收口模式）：score/sha/绝对路径在此剥除，生产方（RPC
 * 服务面与 drora-protocol 反向分发）与协议 schema（shared droraKnowledgeNeighbors*）
 * 同形。
 *
 * 契约边界（§4.3）：notePath 只做 documents.relative_path 精确等值匹配，不触文件
 * 系统、无路径遍历/日期扩权；语义不可用/种子缺向量/路径不在索引各以结构化 status
 * 显式降级，不抛业务错。
 */
import { KNOWLEDGE_EXCERPT_MAX_CHARS } from "../../platform/knowledgeEvidence.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { articleIdOf, findDocumentByPath, loadCoverage } from "../store/indexRepository.js";
import { loadVectorChunks } from "../store/vectorRepository.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import { resolveKnowledgeSource } from "../source/sourceRegistry.js";
import type {
  KnowledgeNeighborsCandidate,
  KnowledgeNeighborsResult,
} from "../knowledgeTypes.js";

/**
 * 近邻相似下限（初值 0.3）：与 lexicalRetriever 的 SEMANTIC_RECALL_FLOOR 同 bge 余弦
 * 尺度——无关联文档的「最近邻」也会有一定相似度，下限防止不相关文档混入候选。刻意
 * 独立成常量（不复用 SEMANTIC_RECALL_FLOOR 引用）：召回门与近邻门是两个校准域，
 * 后续棘轮不应互相牵连。初值待 N2/N3 真跑校准后只许上调。
 */
export const NEIGHBOR_SIMILARITY_FLOOR = 0.3;

const DEFAULT_NEIGHBOR_LIMIT = 5;
const MAX_NEIGHBOR_LIMIT = 10;

/** 候选文档的聚合态：最佳 chunk（代表候选）+ 过下限 chunk 数。 */
interface NeighborDocumentAggregate {
  documentId: number;
  relativePath: string;
  title: string;
  bestSimilarity: number;
  bestChunk: {
    headingPath: string | null;
    body: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  };
  matchedChunkCount: number;
}

/**
 * Float32Array 原位余弦：语义与 search/embeddingPort 的 cosineSimilarity 一致（零向量/
 * 维度不齐返回 0，不猜测），不复用其实现的修复依据——该签名收 number[]，内循环逐
 * chunk Array.from 装箱会在全库扫描下产生与 chunk 数同阶的临时数组分配（GC 压力把
 * ≤1s 基线打穿）；近邻内循环直接吃 Float32Array 视图零拷贝。
 */
function cosineFloat32(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index++) {
    const l = left[index]!;
    const r = right[index]!;
    dot += l * r;
    normLeft += l * l;
    normRight += r * r;
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / Math.sqrt(normLeft * normRight);
}

/** 种子笔记质心：chunk 向量求和后 L2 归一（方向代表笔记主旨；模长不入相似度）。 */
function centroidOf(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0]?.length ?? 0;
  const sum = new Float32Array(dim);
  for (const vector of vectors) {
    for (let index = 0; index < dim; index++) {
      // noUncheckedIndexedAccess 下索引访问返回 number|undefined；两侧已由循环边界
      // 保证在位，经局部变量收窄（与 cosineFloat32 同款写法）。
      const component = vector[index]!;
      sum[index] = (sum[index] ?? 0) + component;
    }
  }
  let norm = 0;
  for (let index = 0; index < dim; index++) {
    const component = sum[index]!;
    norm += component * component;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < dim; index++) {
      sum[index] = sum[index]! / norm;
    }
  }
  return sum;
}

export async function executeKnowledgeNeighbors(params: {
  db: KnowledgeDatabase;
  semantic: KnowledgeSemanticContext;
  pluginDataDir: string;
  /** vault 相对路径；精确等值匹配（§4.3 契约边界，不在此形态上做任何扩权解释）。 */
  notePath: string;
  limit?: number;
}): Promise<KnowledgeNeighborsResult> {
  const { db, semantic, pluginDataDir, notePath } = params;
  const limit = Math.min(
    Math.max(Math.trunc(params.limit ?? DEFAULT_NEIGHBOR_LIMIT), 1),
    MAX_NEIGHBOR_LIMIT,
  );

  // 源解析与 search 同源（vault-config.json 唯一事实源）；本地同步计算无出站阶段，
  // 无需 search 管线的阶段后复验。
  const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
  if (!source.configured || source.summary === null || source.sourceEpoch === null) {
    return { status: "no_source", reason: "vault_not_configured", candidates: [] };
  }
  const sourceRef = { vaultId: source.summary.vaultId, sourceEpoch: source.sourceEpoch };

  const seed = findDocumentByPath(db, sourceRef.vaultId, sourceRef.sourceEpoch, notePath);
  if (!seed) {
    return { status: "note_not_found", reason: "note_not_indexed", candidates: [] };
  }

  // 近邻是向量固有语义：端口关闭（用户关/未装本地模型）即显式降级，不静默回退词法。
  const modelId = semantic.port?.id ?? null;
  if (!modelId) {
    return { status: "semantic_unavailable", reason: "semantic_port_disabled", candidates: [] };
  }

  const vectors = loadVectorChunks(db, sourceRef, modelId);
  const seedVectors = vectors.filter((row) => row.documentId === seed.id);
  if (seedVectors.length === 0) {
    // 种子笔记已索引但向量未回填（换模型后回填滞后）——如实降级，不用零向量猜。
    return {
      status: "semantic_unavailable",
      reason: "note_vectors_missing",
      candidates: [],
    };
  }
  const seedCentroid = centroidOf(seedVectors.map((row) => row.vector));

  const byDocument = new Map<number, NeighborDocumentAggregate>();
  for (const row of vectors) {
    if (row.documentId === seed.id) continue;
    const similarity = cosineFloat32(seedCentroid, row.vector);
    if (similarity < NEIGHBOR_SIMILARITY_FLOOR) continue;
    const aggregate = byDocument.get(row.documentId);
    if (!aggregate) {
      byDocument.set(row.documentId, {
        documentId: row.documentId,
        relativePath: row.relativePath,
        title: row.title,
        bestSimilarity: similarity,
        bestChunk: {
          headingPath: row.headingPath,
          body: row.body,
          startLine: row.startLine,
          endLine: row.endLine,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
        },
        matchedChunkCount: 1,
      });
      continue;
    }
    aggregate.matchedChunkCount += 1;
    if (similarity > aggregate.bestSimilarity) {
      aggregate.bestSimilarity = similarity;
      aggregate.bestChunk = {
        headingPath: row.headingPath,
        body: row.body,
        startLine: row.startLine,
        endLine: row.endLine,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      };
    }
  }

  if (byDocument.size === 0) {
    return { status: "empty", reason: null, candidates: [] };
  }

  // 排序确定性：相似度降序，平分按相对路径字典序（同分不因 Map 迭代序漂移）。
  const ranked = [...byDocument.values()].sort((left, right) =>
    left.bestSimilarity !== right.bestSimilarity
      ? right.bestSimilarity - left.bestSimilarity
      : left.relativePath < right.relativePath
        ? -1
        : 1,
  );

  // 白名单映射（单一收口）：score 止步于排序，excerpt 逐字节选有界截断，不添省略号
  // 造形（与 search 候选 excerpt 的 verbatim 纪律一致）。
  const candidates: KnowledgeNeighborsCandidate[] = ranked.slice(0, limit).map((entry, index) => ({
    articleId: articleIdOf(sourceRef.vaultId, entry.relativePath),
    relativePath: entry.relativePath,
    title: entry.title,
    matchedHeading: entry.bestChunk.headingPath,
    excerpt: entry.bestChunk.body.slice(0, KNOWLEDGE_EXCERPT_MAX_CHARS),
    quote: {
      startLine: entry.bestChunk.startLine,
      endLine: entry.bestChunk.endLine,
      startOffset: entry.bestChunk.startOffset,
      endOffset: entry.bestChunk.endOffset,
    },
    rank: index + 1,
    matchedChunkCount: entry.matchedChunkCount,
  }));

  // coverage 截断如实呈现（§5b.4 同语义）：部分索引下的近邻可能漏掉未收录文档。
  const coverage = loadCoverage(db, sourceRef.vaultId, sourceRef.sourceEpoch);
  return {
    status: coverage?.partial ? "partial" : "ready",
    reason: null,
    candidates,
  };
}
