/**
 * 单次 Knowledge 检索流水线（纯组合，无 Run 生命周期所有权）。
 * 由 QueryOrchestrator 持有 run/seq/abort 并负责落定；本函数只产出候选结果补丁。
 * 源在检索前及 Jev 调用后均复验，任何 epoch/vault 切换都丢弃候选。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { loadCoverage } from "../store/indexRepository.js";
import { searchLexicalPass } from "../search/lexicalRetriever.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import { decideByPolicy, DEFAULT_DECISION_POLICY, queryHashOf } from "../decision/decisionPolicy.js";
import type { KnowledgeCoverage, KnowledgeRunView } from "../knowledgeTypes.js";
import type { KnowledgeSourceResolution } from "../source/sourceRegistry.js";
import { reorderCandidates, toDecisionCandidates, type KnowledgeDecisionContext } from "./queryDecisionBridge.js";

type SearchPatch = Partial<
  Pick<KnowledgeRunView, "status" | "reason" | "candidates" | "coverage" | "diagnostics" | "decision">
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
