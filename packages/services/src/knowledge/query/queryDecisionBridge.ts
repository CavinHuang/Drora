/**
 * 决策阶段与 run 生命周期的桥接（W05 / spec §5d.6–§5d.7）。
 *
 * 从 QueryOrchestrator 拆出的纯辅助：候选映射/融合重排/授权授予（绑定 run 事实）。
 * 不持有状态；授权账本与缓存由 KnowledgeDecisionContext（服务工厂持有）提供。
 */
import { queryHashOf } from "../decision/decisionPolicy.js";
import type { DecisionConsentRegistry } from "../decision/decisionConsent.js";
import type { DecisionCache } from "../decision/decisionCache.js";
import type { DecisionTelemetry } from "../decision/decisionTelemetry.js";
import type { DecisionPipeline } from "../decision/decisionPipeline.js";
import type {
  KnowledgeDecisionCandidate,
  KnowledgeDecisionConsentGrantResult,
  KnowledgeDecisionPolicyConfig,
  KnowledgeDecisionProvider,
} from "../decision/decisionTypes.js";
import type { KnowledgeRunView } from "../knowledgeTypes.js";

/** W05 决策上下文：provider 为 null 即功能关闭（默认）——管线仍产出 off 诊断（A23 断言面）。 */
export interface KnowledgeDecisionContext {
  provider: KnowledgeDecisionProvider | null;
  pipeline: DecisionPipeline;
  registry: DecisionConsentRegistry;
  cache: DecisionCache;
  telemetry: DecisionTelemetry;
  config: KnowledgeDecisionPolicyConfig;
}

/** 文章候选 → 决策候选（名次归一在 policy 侧口径内完成）。 */
export function toDecisionCandidates(
  candidates: KnowledgeRunView["candidates"],
): KnowledgeDecisionCandidate[] {
  const mapped = candidates.map((candidate, index) => ({
    candidateId: candidate.articleId,
    chunkSha256: candidate.chunkSha256,
    title: candidate.title,
    headingPath: candidate.matchedHeading,
    excerpt: candidate.excerpt,
    localRank: index + 1,
    localScore: 0,
  }));
  normalizeLocalScoresInPlace(mapped);
  return mapped;
}

/** 名次归一（∈(0,1]）：bm25 跨查询量纲不可比，名次单调鲁棒。 */
function normalizeLocalScoresInPlace(candidates: KnowledgeDecisionCandidate[]): void {
  const total = candidates.length;
  for (const candidate of candidates) {
    candidate.localScore = total > 0 ? (total - candidate.localRank + 1) / total : 0;
  }
}

/** 融合名次 → 重排后的文章候选（rank 重编号，事实字段原样——A26 只改次序不改事实）。 */
export function reorderCandidates(
  candidates: KnowledgeRunView["candidates"],
  fusedRank: Map<string, number>,
): KnowledgeRunView["candidates"] {
  return [...candidates]
    .sort(
      (left, right) => (fusedRank.get(left.articleId) ?? 0) - (fusedRank.get(right.articleId) ?? 0),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * 授予本次出站授权（spec §5d.6）：绑定授予时刻的 provider/vaultId/sourceEpoch/
 * queryHash(=sha256(规范化 query))/candidateHashes/TTL（单 query）。追问/新 Query
 * 是新 run，必须重新授权。run 未落定/无候选/关闭时拒绝。
 */
export function grantDecisionConsentForRun(params: {
  decision: KnowledgeDecisionContext;
  run: { view: KnowledgeRunView; sourceRef: { vaultId: string; sourceEpoch: number } | null } | null;
  candidateIds?: string[];
  nowMs: number;
}): KnowledgeDecisionConsentGrantResult {
  const { decision, run, nowMs } = params;
  if (!decision.provider) return { granted: false, reason: "disabled" };
  if (!run || run.view.status === "retrieving") return { granted: false, reason: "run_not_settled" };
  if (!["ready", "partial", "empty"].includes(run.view.status)) {
    return { granted: false, reason: "run_not_settled" };
  }
  if (!run.sourceRef) return { granted: false, reason: "no_source" };
  const requested = run.view.candidates;
  if (requested.length === 0) return { granted: false, reason: "no_candidates" };
  const requestedIds = Array.isArray(params.candidateIds) ? params.candidateIds : null;
  const selected =
    requestedIds && requestedIds.length > 0
      ? requested.filter((candidate) => requestedIds.includes(candidate.articleId))
      : requested;
  if (selected.length === 0) return { granted: false, reason: "no_candidates" };
  const consent = decision.registry.grant({
    providerId: decision.provider.id,
    vaultId: run.sourceRef.vaultId,
    sourceEpoch: run.sourceRef.sourceEpoch,
    queryHash: queryHashOf(run.view.query),
    candidateHashes: new Set(selected.map((candidate) => candidate.chunkSha256)),
    grantedAtMs: nowMs,
    expiresAtMs: nowMs + decision.config.consentTtlMs,
  });
  return {
    granted: true,
    consentId: consent.consentId,
    expiresAtMs: consent.expiresAtMs,
    boundCandidateCount: selected.length,
  };
}
