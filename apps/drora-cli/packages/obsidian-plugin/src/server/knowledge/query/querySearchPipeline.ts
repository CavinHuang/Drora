// 迁自 packages/services/src/knowledge/query/querySearchPipeline.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * 单次 Knowledge 检索流水线（纯组合，无 Run 生命周期所有权）。
 * 由 QueryOrchestrator 持有 run/seq/abort 并负责落定；本函数只产出候选结果补丁。
 * 源在检索前及 Jev 调用后均复验，任何 epoch/vault 切换都丢弃候选。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { loadCoverage } from "../store/indexRepository.js";
import { searchLexicalPass } from "../search/lexicalRetriever.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import {
  decideByPolicy,
  DEFAULT_DECISION_POLICY,
  queryHashOf,
} from "../decision/decisionPolicy.js";
import type { KnowledgeCoverage, KnowledgeRunView } from "../knowledgeTypes.js";
import type { KnowledgeSourceResolution } from "../source/sourceRegistry.js";
import {
  reorderCandidates,
  toDecisionCandidates,
  type KnowledgeDecisionContext,
} from "./queryDecisionBridge.js";

type SearchPatch = Partial<
  Pick<
    KnowledgeRunView,
    "status" | "reason" | "candidates" | "coverage" | "diagnostics" | "decision"
  >
>;

export async function executeKnowledgeSearch(params: {
  db: KnowledgeDatabase;
  semantic: KnowledgeSemanticContext;
  sourceRef: { vaultId: string; sourceEpoch: number } | null;
  runId: string;
  query: string;
  decisionConsentId?: string;
  decision: KnowledgeDecisionContext | null;
  signal: AbortSignal;
  resolveSource: () => Promise<KnowledgeSourceResolution>;
  sourceChangedSince: () => Promise<boolean>;
}): Promise<SearchPatch> {
  const { db, semantic, sourceRef, runId, query, decision, signal } = params;
  const source = await params.resolveSource();
  if (!source.configured || source.sourceEpoch === null || !source.summary) {
    return { status: "source_stale", reason: "vault_not_configured", decision: null };
  }
  if (
    !sourceRef ||
    source.summary.vaultId !== sourceRef.vaultId ||
    source.sourceEpoch !== sourceRef.sourceEpoch
  ) {
    return { status: "source_stale", reason: "source_epoch_changed", decision: null };
  }

  const coverage = loadCoverage(db, source.summary.vaultId, source.sourceEpoch);
  const sharedOptions = { semantic, partial: coverage?.partial ?? false } as const;

  // 先 AND 检索；词元满足扩展资格且无结果时，按策略最多放宽一次。
  let pass = await searchLexicalPass(db, sourceRef, query, { ...sharedOptions, relaxed: false });
  let expanded = false;
  let canExpand = pass.candidates.length === 0 && pass.canRelax;
  const policy = decideByPolicy({
    candidates: toDecisionCandidates(pass.candidates),
    outcomes: [],
    canExpand,
    expanded,
    config: decision?.config ?? DEFAULT_DECISION_POLICY,
  });
  if (policy.shouldExpand) {
    pass = await searchLexicalPass(db, sourceRef, query, { ...sharedOptions, relaxed: true });
    expanded = true;
    canExpand = false;
  }

  const stage = decision
    ? await decision.pipeline.runStage({
        runId,
        vaultId: sourceRef.vaultId,
        sourceEpoch: sourceRef.sourceEpoch,
        query,
        queryHash: queryHashOf(query),
        candidates: toDecisionCandidates(pass.candidates),
        consentId: params.decisionConsentId ?? null,
        canExpand,
        expanded,
        signal,
      })
    : null;

  // 出站阶段可能很慢；复验确保其间撤权/切库不会把旧结果标记为可信。
  if (await params.sourceChangedSince()) {
    return {
      status: "source_stale",
      reason: "source_epoch_changed",
      candidates: [],
      coverage: null,
      diagnostics: pass.diagnostics,
      decision: stage?.diagnostics ?? null,
    };
  }
  const finalCoverage: KnowledgeCoverage = coverage ?? EMPTY_COVERAGE;
  return {
    status: pass.status,
    candidates: stage
      ? reorderCandidates(pass.candidates, stage.policy.fusedRankByCandidateId)
      : pass.candidates,
    coverage: finalCoverage,
    diagnostics: pass.diagnostics,
    decision: stage?.diagnostics ?? null,
    reason: null,
  };
}

const EMPTY_COVERAGE: KnowledgeCoverage = {
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
};
