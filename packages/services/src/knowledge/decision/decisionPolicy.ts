/**
 * 本地 DecisionPolicy（W05 / spec §5d.5）。
 *
 * 纯函数、无 IO：裁决五动作（硬条件优先，Jev 不可越权）、执行扩搜一次上限、
 * 单调融合。noul 数值绝不作为正确率展示（score 只进折叠 trace）。
 */
import { createHash } from "node:crypto";
import type {
  KnowledgeDecisionAction,
  KnowledgeDecisionCandidate,
  KnowledgeDecisionOutcome,
  KnowledgeDecisionPolicyConfig,
} from "./decisionTypes.js";

/** 策略版本：融合权重/阈值变化时递增，决策缓存键随之失效（spec §5d.7）。 */
export const DECISION_POLICY_VERSION = "w05-p0.1";

/** 实验初值（JEV_DETAIL §0C.3/§0C.4；离线评测标定前不作为承诺指标）。 */
export const DEFAULT_DECISION_POLICY: Readonly<KnowledgeDecisionPolicyConfig> = Object.freeze({
  maxCandidates: 20,
  concurrency: 4,
  perCallTimeoutMs: 3000,
  stageBudgetMs: 6000,
  rateLimitRetries: 1,
  rateLimitBackoffMs: 250,
  directThreshold: 0.75,
  abstainThreshold: 0.45,
  ambiguityBand: 0.08,
  weightLocal: 0.35,
  weightJev: 0.65,
  consentTtlMs: 60_000,
  cacheMaxEntries: 500,
});

export function resolvePolicyConfig(
  overrides?: Partial<KnowledgeDecisionPolicyConfig>,
): KnowledgeDecisionPolicyConfig {
  return { ...DEFAULT_DECISION_POLICY, ...overrides };
}

/** 规范化查询：折叠空白后 trim（queryHash 的规范化口径；W05 决策专用，不改检索原样查询）。 */
export function normalizeQueryForHash(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

export function queryHashOf(query: string): string {
  return createHash("sha256").update(normalizeQueryForHash(query), "utf8").digest("hex");
}

/** 名次归一：bm25 跨查询量纲不可比，名次单调鲁棒（spec §5d.5）。 */
export function normalizeLocalScores(candidates: KnowledgeDecisionCandidate[]): void {
  const total = candidates.length;
  for (const candidate of candidates) {
    candidate.localScore = total > 0 ? (total - candidate.localRank + 1) / total : 0;
  }
}

export interface DecisionPolicyInput {
  /** 本轮检索是否为 OR 扩搜产物。 */
  expanded: boolean;
  /** 第一轮 AND 无命中且查询存在多词元（具备扩搜前提）。 */
  canExpand: boolean;
  candidates: KnowledgeDecisionCandidate[];
  /** 已校验合法的决策产出（无/部分/全部）。 */
  outcomes: KnowledgeDecisionOutcome[];
  config: KnowledgeDecisionPolicyConfig;
}

export interface DecisionPolicyDecision {
  action: KnowledgeDecisionAction;
  /** action=EXPAND_ONCE 时为 true：编排器据此执行唯一一次 OR 扩搜。 */
  shouldExpand: boolean;
  /** 融合后的名次（candidateId → 新名次，1 起始）；无决策产出时与本地名次一致。 */
  fusedRankByCandidateId: Map<string, number>;
  /** 融合分（仅供折叠 trace；不是正确率）。 */
  fusedScoreByCandidateId: Map<string, number>;
}

/**
 * 五动作裁决（spec §5d.5 顺序）：
 * 1. 可扩搜且未扩过（首轮空且词元 ≥2）→ EXPAND_ONCE（同一 query/scope/硬过滤，OR
 *    降级一次）——先于空候选终态判定，否则不可达；
 * 2. 无候选 → NO_RELIABLE_MATCH（Jev 不能补召回）；
 * 3. top noul ≥ directThreshold → PREPARE_EVIDENCE_FOR_AGENT（仅建议，不自动签发 receipt）；
 * 4. top noul < abstainThreshold 且存在中段分数，或前两名分差 ≤ ambiguityBand →
 *    ASK_CLARIFICATION（不确定，可能是这几篇；不强选）；
 * 5. 其余 → SHOW_CANDIDATES。
 */
export function decideByPolicy(input: DecisionPolicyInput): DecisionPolicyDecision {
  const { candidates, outcomes, expanded, canExpand, config } = input;
  if (candidates.length === 0 && !expanded && canExpand) {
    return {
      action: "EXPAND_ONCE",
      shouldExpand: true,
      fusedRankByCandidateId: new Map(),
      fusedScoreByCandidateId: new Map(),
    };
  }
  if (candidates.length === 0) {
    return {
      action: "NO_RELIABLE_MATCH",
      shouldExpand: false,
      fusedRankByCandidateId: new Map(),
      fusedScoreByCandidateId: new Map(),
    };
  }

  const scored = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.status === "scored" && isLegalNoul(outcome.noul)) {
      scored.set(outcome.candidateId, outcome.noul as number);
    }
  }

  let action: KnowledgeDecisionAction = "SHOW_CANDIDATES";
  if (scored.size > 0) {
    const noulDescending = [...scored.values()].sort((left, right) => right - left);
    const top = noulDescending[0] as number;
    const second = noulDescending[1];
    const midBand = noulDescending.some(
      (value) => value >= 0.2 && value < config.abstainThreshold,
    );
    if (top >= config.directThreshold) {
      // 硬条件由调用方保证：候选与片段已存在，receipt 签发永远走 §5.1 复验。
      action = "PREPARE_EVIDENCE_FOR_AGENT";
    } else if (
      (top < config.abstainThreshold && midBand) ||
      (second !== undefined && top - second <= config.ambiguityBand)
    ) {
      action = "ASK_CLARIFICATION";
    }
  }

  const fused = fuseScores(candidates, scored, config);
  return {
    action,
    shouldExpand: false,
    fusedRankByCandidateId: rankOf(candidates, fused),
    fusedScoreByCandidateId: fused,
  };
}

function isLegalNoul(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 融合：weightLocal×local + weightJev×noul（实验起始 0.35/0.65）；回退候选只取本地项（相对名次保持）。 */
function fuseScores(
  candidates: KnowledgeDecisionCandidate[],
  noulByCandidateId: Map<string, number>,
  config: KnowledgeDecisionPolicyConfig,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const candidate of candidates) {
    const noul = noulByCandidateId.get(candidate.candidateId);
    const localTerm = config.weightLocal * candidate.localScore;
    fused.set(candidate.candidateId, noul === undefined ? localTerm : localTerm + config.weightJev * noul);
  }
  return fused;
}

/** 融合分降序名次（并列保持本地名次稳定）。 */
function rankOf(candidates: KnowledgeDecisionCandidate[], scores: Map<string, number>): Map<string, number> {
  const ordered = [...candidates].sort((left, right) => {
    const diff = (scores.get(right.candidateId) ?? 0) - (scores.get(left.candidateId) ?? 0);
    if (diff !== 0) return diff;
    return left.localRank - right.localRank;
  });
  const ranks = new Map<string, number>();
  ordered.forEach((candidate, index) => ranks.set(candidate.candidateId, index + 1));
  return ranks;
}
