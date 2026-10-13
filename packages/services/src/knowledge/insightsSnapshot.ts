/**
 * 洞察快照装载（spec §5g；从 knowledgeServices 拆出收口 max-lines 门禁）。
 *
 * 聚合纯查询：结构口径（tags/双链）从 chunk body 流式重提取（逐行 iterate，按
 * document 分组喂纯函数，不整表物化）；向量覆盖 additive（§5b.9 准确性可观测，
 * modelId 口径——换模型后旧向量不计入，直至回填/重建追上）；job 列表与 telemetry
 * 为既有事实的直接投影，不预估、不读 vault 文件。
 */
import type { DecisionTelemetrySnapshot } from "./decision/decisionTelemetry.js";
import type { KnowledgeDatabase } from "./store/knowledgeDatabase.js";
import { listRecentJobs, loadCoverage } from "./store/indexRepository.js";
import { loadVectorCoverage } from "./store/vectorRepository.js";
import { resolveKnowledgeSource } from "./source/sourceRegistry.js";
import {
  aggregateDocumentStructure,
  toDecisionInsights,
  toInsightJobEntries,
  type InsightDocumentChunkRow,
} from "./index/insightsAggregator.js";
import type {
  KnowledgeInsightsSnapshot,
} from "./knowledgeTypes.js";

const INSIGHTS_RECENT_JOB_LIMIT = 5;

const EMPTY_COVERAGE = Object.freeze({
  indexedFiles: 0,
  indexedChunks: 0,
  excludedHidden: 0,
  excludedSymlink: 0,
  excludedNotMarkdown: 0,
  excludedOverSize: 0,
  excludedOverQuota: 0,
  excludedDepth: 0,
  truncatedFiles: 0,
  partial: false,
});

/** 装载洞察快照（纯查询聚合；未配置源返回诚实空态）。 */
export async function loadInsightsSnapshot(deps: {
  db: KnowledgeDatabase;
  pluginDataDir: string;
  /** 语义端口标识（向量覆盖口径）；null = 语义关闭（不统计覆盖）。 */
  semanticPortId: string | null;
  decisionTelemetry: DecisionTelemetrySnapshot;
}): Promise<KnowledgeInsightsSnapshot> {
  const { db, pluginDataDir, semanticPortId, decisionTelemetry } = deps;
  const recentJobs = toInsightJobEntries(listRecentJobs(db, INSIGHTS_RECENT_JOB_LIMIT));
  const decisionInsights = toDecisionInsights(decisionTelemetry);

  const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
  if (!source.configured || source.summary === null || source.sourceEpoch === null) {
    return {
      configured: false,
      source: null,
      inventory: { documents: 0, chunks: 0, taggedDocuments: 0, wikilinkCount: 0 },
      coverage: { ...EMPTY_COVERAGE },
      recentJobs,
      decision: decisionInsights,
    };
  }

  const coverage =
    loadCoverage(db, source.summary.vaultId, source.sourceEpoch) ?? { ...EMPTY_COVERAGE };
  // 向量覆盖（spec §5b.9 准确性可观测）：语义端口在场才统计（modelId 口径）。
  const vectorCoverage =
    semanticPortId === null
      ? undefined
      : {
          modelId: semanticPortId,
          ...loadVectorCoverage(
            db,
            { vaultId: source.summary.vaultId, sourceEpoch: source.sourceEpoch },
            semanticPortId,
          ),
        };

  let taggedDocuments = 0;
  let wikilinkCount = 0;
  let currentDocumentId: number | null = null;
  let documentRows: InsightDocumentChunkRow[] = [];
  const flushDocument = (): void => {
    if (documentRows.length === 0) return;
    const aggregate = aggregateDocumentStructure(documentRows);
    if (aggregate.tagged) taggedDocuments += 1;
    wikilinkCount += aggregate.wikilinkCount;
    documentRows = [];
  };
  const chunkStatement = db.raw.prepare(
    `SELECT c.document_id AS documentId, c.ordinal AS ordinal, c.body AS body
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.vault_id = ? AND d.source_epoch = ?
     ORDER BY c.document_id, c.ordinal`,
  );
  const rows = chunkStatement.iterate(source.summary.vaultId, source.sourceEpoch) as Iterable<{
    documentId: number;
    ordinal: number;
    body: string;
  }>;
  for (const row of rows) {
    if (row.documentId !== currentDocumentId) {
      flushDocument();
      currentDocumentId = row.documentId;
    }
    documentRows.push({ ordinal: row.ordinal, body: row.body });
  }
  flushDocument();

  return {
    configured: true,
    source: {
      vaultId: source.summary.vaultId,
      sourceEpoch: source.sourceEpoch,
      displayName: source.summary.displayName,
    },
    inventory: {
      documents: coverage.indexedFiles,
      chunks: coverage.indexedChunks,
      taggedDocuments,
      wikilinkCount,
      ...(vectorCoverage !== undefined ? { vectorCoverage } : {}),
    },
    coverage,
    recentJobs,
    decision: decisionInsights,
  };
}

