// 迁自 packages/services/src/knowledge/index/insightsAggregator.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * 洞察聚合纯函数（spec §5g.2/§5g.4/§5g.5）。
 *
 * 输入全部是已落库的行数据与进程内快照，输出洞察 DTO——不做任何 IO，可脱离 DB 单测。
 * 结构口径（tags/双链）从 chunk body 以阶段一同款抽取函数重提取：frontmatter 单独成
 * chunk（markdownChunker §5b.4），body 恒在而 FTS meta 是 tokenizer 产物（无法区分
 * tags/links、v4 前旧数据恒空串），body 重提取对全部存量索引立即生效且与索引快照一致。
 */
import type {
  KnowledgeDecisionTelemetryInsights,
  KnowledgeIndexJobView,
  KnowledgeInsightsJobEntry,
} from "../knowledgeTypes.js";
import { extractWikilinkTargets, parseFrontmatterChunkTags } from "./markdownChunker.js";
import type { DecisionTelemetrySnapshot } from "../decision/decisionTelemetry.js";

/** 单文档 chunk 行（调用方按 document 分组后逐文档喂入）。 */
export interface InsightDocumentChunkRow {
  /** 0 = frontmatter chunk（若存在）；spec §5b.4。 */
  ordinal: number;
  body: string;
}

export interface DocumentStructureAggregate {
  /** frontmatter tags 非空。 */
  tagged: boolean;
  /** 该文档的 wikilink 目标数（chunk 内去重、跨 chunk 累计）。 */
  wikilinkCount: number;
}

/** 单文档结构聚合（spec §5g.2）：调用方跨文档累加 wikilinkCount、按 tagged 计文档数。 */
export function aggregateDocumentStructure(
  rows: Iterable<InsightDocumentChunkRow>,
): DocumentStructureAggregate {
  let tagged = false;
  let wikilinkCount = 0;
  for (const row of rows) {
    if (row.ordinal === 0 && parseFrontmatterChunkTags(row.body).length > 0) tagged = true;
    wikilinkCount += extractWikilinkTargets(row.body).length;
  }
  return { tagged, wikilinkCount };
}

/** job 视图 → 洞察条目：时长 = 终态差值；进行中为 null（不预估剩余时间）。 */
export function toInsightJobEntries(jobs: KnowledgeIndexJobView[]): KnowledgeInsightsJobEntry[] {
  return jobs.map((job) => ({
    kind: job.kind,
    status: job.status,
    startedAtMs: job.startedAtMs,
    finishedAtMs: job.finishedAtMs,
    durationMs:
      job.finishedAtMs !== null && job.finishedAtMs >= job.startedAtMs
        ? job.finishedAtMs - job.startedAtMs
        : null,
    indexedFiles: job.indexedFiles,
    indexedChunks: job.indexedChunks,
    reason: job.reason,
  }));
}

/**
 * telemetry 快照 → RPC 投影（spec §5g.5）：latencySamplesMs 不出 RPC 面（无逐样本
 * 用途，避免无界数组过线）；进程内事实，UI 注明「重启后清零」。
 */
export function toDecisionInsights(
  snapshot: DecisionTelemetrySnapshot,
): KnowledgeDecisionTelemetryInsights {
  return {
    outboundCountTotal: snapshot.outboundCountTotal,
    cacheHitCountTotal: snapshot.cacheHitCountTotal,
    fallbackCountTotal: snapshot.fallbackCountTotal,
    scoredCountTotal: snapshot.scoredCountTotal,
    inputTokensTotal: snapshot.inputTokensTotal,
    outputTokensTotal: snapshot.outputTokensTotal,
  };
}
