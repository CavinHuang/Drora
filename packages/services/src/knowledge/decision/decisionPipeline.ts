/**
 * 决策管线（W05 / spec §5d.1、§5d.6–§5d.7）。
 *
 * 编排：授权门 → 缓存分层 → provider → 结果校验 → policy 五动作/融合 → 诊断。
 * - 默认关闭：不注入 provider 时恒走 off 分支（outboundCount=0，A23）；
 * - 授权门：consent 缺失/过期/撤销/范围不匹配 → denied（本地候选照常，fail-closed）；
 * - 结果校验：只接受输入候选清单中的 ID；未知 ID 丢弃并计为 unknown_candidate；
 * - 缓存只存合法 scored 产出；撤权经 revokeConsentAndInvalidate 清除关联条目。
 */
import type {
  KnowledgeDecisionCandidate,
  KnowledgeDecisionDiagnostics,
  KnowledgeDecisionOutcome,
  KnowledgeDecisionPolicyConfig,
  KnowledgeDecisionProvider,
  KnowledgeDecisionRequest,
  KnowledgeDecisionResult,
  KnowledgeDecisionFallbackReason,
} from "./decisionTypes.js";
import type { DecisionConsentRegistry } from "./decisionConsent.js";
import { decisionCacheKeyOf, type DecisionCache } from "./decisionCache.js";
import type { DecisionTelemetry } from "./decisionTelemetry.js";
import { DECISION_POLICY_VERSION, decideByPolicy, type DecisionPolicyDecision } from "./decisionPolicy.js";

export interface DecisionPipelineOptions {
  /** null = 功能关闭（默认）；注入即代表 Host 侧已完成 flag + 凭证配置。 */
  provider: KnowledgeDecisionProvider | null;
  config: KnowledgeDecisionPolicyConfig;
  consentRegistry: DecisionConsentRegistry;
  cache: DecisionCache;
  telemetry: DecisionTelemetry;
}

export interface DecisionStageInput {
  runId: string;
  vaultId: string;
  sourceEpoch: number;
  query: string;
  queryHash: string;
  /** 本地名次候选（localScore 已名次归一）。 */
  candidates: KnowledgeDecisionCandidate[];
  consentId: string | null;
  /** 第一轮 AND 无命中且查询具备扩搜前提（policy 的 EXPAND_ONCE 依据）。 */
  canExpand: boolean;
  /** 本轮是否已是 OR 扩搜产物。 */
  expanded: boolean;
  signal: AbortSignal;
}

export interface DecisionStageOutput {
  diagnostics: KnowledgeDecisionDiagnostics;
  /** 校验后的产出（缓存命中 + provider 新产出 + 回退补齐；仅覆盖出站池）。 */
  outcomes: KnowledgeDecisionOutcome[];
  policy: DecisionPolicyDecision;
}

export class DecisionPipeline {
  constructor(private readonly options: DecisionPipelineOptions) {}

  /** 撤权：账本撤销 + 清除该授权绑定查询的缓存条目（spec §5d.7）。 */
  revokeConsentAndInvalidate(consentId: string): boolean {
    const consent = this.options.consentRegistry.get(consentId);
    if (!consent) return false;
    this.options.cache.invalidate((_, entry) =>
      entry.vaultId === consent.vaultId &&
      entry.sourceEpoch === consent.sourceEpoch &&
      entry.queryHash === consent.queryHash,
    );
    return this.options.consentRegistry.revoke(consentId);
  }

  async runStage(input: DecisionStageInput): Promise<DecisionStageOutput> {
    const { options } = this;
    const startedAtMs = Date.now();
    const localOnly = (outcomes: KnowledgeDecisionOutcome[]) =>
      decideByPolicy({
        candidates: input.candidates,
        outcomes,
        canExpand: input.canExpand,
        expanded: input.expanded,
        config: options.config,
      });

    // ① 功能关闭（默认路径）：零出站，本地排序（A23）。policy 仍做本地五动作裁决。
    if (!options.provider) {
      const policy = localOnly([]);
      return {
        diagnostics: assembleDiagnostics({
          status: "off",
          reason: "disabled_no_provider",
          providerId: null,
          modelVersion: null,
          outboundCount: 0,
          outcomes: [],
          cacheHitCount: 0,
          latencyMs: Date.now() - startedAtMs,
          action: policy.action,
        }),
        outcomes: [],
        policy,
      };
    }

    // ② 授权门（fail-closed）：缺失/过期/撤销/范围不匹配 → denied，本地候选照常。
    const gate = options.consentRegistry.verifyBinding({
      consentId: input.consentId ?? "",
      providerId: options.provider.id,
      vaultId: input.vaultId,
      sourceEpoch: input.sourceEpoch,
      queryHash: input.queryHash,
      nowMs: Date.now(),
    });
    if (!gate.ok) {
      const policy = localOnly([]);
      return {
        diagnostics: assembleDiagnostics({
          status: "denied",
          reason: gate.reason,
          providerId: options.provider.id,
          modelVersion: options.provider.modelId,
          outboundCount: 0,
          outcomes: [],
          cacheHitCount: 0,
          latencyMs: Date.now() - startedAtMs,
          action: policy.action,
        }),
        outcomes: [],
        policy,
      };
    }

    // ③ 缓存分层：命中条目直接采用，只把未命中子集交给出站 provider（命中不计出站）。
    const pool = input.candidates.slice(0, options.config.maxCandidates);
    const cacheHitOutcomes: KnowledgeDecisionOutcome[] = [];
    const pending: KnowledgeDecisionCandidate[] = [];
    for (const candidate of pool) {
      const entry = options.cache.get(cacheKey(options, input, candidate.chunkSha256));
      if (entry) {
        for (const outcome of entry.outcomes) {
          if (outcome.candidateId === candidate.candidateId) cacheHitOutcomes.push(outcome);
        }
      } else {
        pending.push(candidate);
      }
    }

    let fresh: KnowledgeDecisionResult | null = null;
    let stageReason: KnowledgeDecisionFallbackReason | null = null;
    if (pending.length > 0) {
      const request: KnowledgeDecisionRequest = {
        queryId: input.runId,
        vaultId: input.vaultId,
        sourceEpoch: input.sourceEpoch,
        query: input.query,
        queryHash: input.queryHash,
        candidates: pending,
        maxCandidates: options.config.maxCandidates,
        consent: gate.consent,
        signal: input.signal,
      };
      try {
        fresh = await options.provider.decide(request);
      } catch {
        stageReason = "provider_error";
      }
    }

    // ④ 结果校验：未知候选 ID 一律丢弃（unknown_candidate）；重复 ID 保留首个；
    // 合法 scored 产出入缓存（瞬态失败不入缓存，spec §5d.7）。
    const freshOutcomes: KnowledgeDecisionOutcome[] = [];
    const pendingIds = new Set(pending.map((candidate) => candidate.candidateId));
    if (fresh) {
      const seenIds = new Set<string>();
      for (const outcome of fresh.outcomes) {
        if (!pendingIds.has(outcome.candidateId)) {
          stageReason = stageReason ?? "unknown_candidate";
          continue;
        }
        if (seenIds.has(outcome.candidateId)) continue;
        seenIds.add(outcome.candidateId);
        freshOutcomes.push(outcome);
        if (outcome.status === "scored") {
          const candidate = pending.find((entry) => entry.candidateId === outcome.candidateId);
          if (candidate) {
            options.cache.set(cacheKey(options, input, candidate.chunkSha256), {
              outcomes: [outcome],
              modelVersion: fresh.modelVersion,
              createdAtMs: Date.now(),
              vaultId: input.vaultId,
              sourceEpoch: input.sourceEpoch,
              queryHash: input.queryHash,
            });
          }
        }
      }
    }

    // ⑤ 回退补齐：出站池内未覆盖候选按统一规则本地回退（本地候选永远完整，A25）。
    const outcomes = [...cacheHitOutcomes, ...freshOutcomes];
    const coveredIds = new Set(outcomes.map((outcome) => outcome.candidateId));
    const residualReason: KnowledgeDecisionFallbackReason = input.signal.aborted
      ? "cancelled"
      : (firstFallbackReason(freshOutcomes) ?? stageReason ?? "provider_error");
    for (const candidate of pool) {
      if (!coveredIds.has(candidate.candidateId)) {
        outcomes.push({ candidateId: candidate.candidateId, status: "fallback", fallbackReason: residualReason });
      }
    }

    const scoredCount = outcomes.filter((outcome) => outcome.status === "scored").length;
    const status = scoredCount > 0 ? "applied" : input.signal.aborted ? "cancelled" : "fallback";
    const policy = localOnly(outcomes);
    const outboundCount = fresh?.outboundCount ?? 0;

    this.options.telemetry.recordStage({
      outboundCount,
      cacheHitCount: cacheHitOutcomes.length,
      outcomes,
      inputTokens: fresh?.inputTokens ?? 0,
      outputTokens: fresh?.outputTokens ?? 0,
      latencyMs: Date.now() - startedAtMs,
    });

    return {
      diagnostics: assembleDiagnostics({
        status,
        reason: status === "applied" ? null : (stageReason ?? residualReason),
        providerId: options.provider.id,
        modelVersion: fresh?.modelVersion ?? null,
        outboundCount,
        outcomes,
        cacheHitCount: cacheHitOutcomes.length,
        latencyMs: Date.now() - startedAtMs,
        action: policy.action,
      }),
      outcomes,
      policy,
    };
  }
}

function firstFallbackReason(outcomes: KnowledgeDecisionOutcome[]): KnowledgeDecisionFallbackReason | null {
  for (const outcome of outcomes) {
    if (outcome.status === "fallback") return outcome.fallbackReason ?? "provider_error";
  }
  return null;
}

function cacheKey(
  options: DecisionPipelineOptions,
  input: DecisionStageInput,
  chunkSha256: string,
): string {
  // 键分量与 spec §5d.7 一致：provider/model/policy/vault/epoch/queryHash/chunkSha。
  return decisionCacheKeyOf({
    providerId: options.provider?.id ?? "none",
    modelId: options.provider?.modelId ?? "none",
    policyVersion: DECISION_POLICY_VERSION,
    vaultId: input.vaultId,
    sourceEpoch: input.sourceEpoch,
    queryHash: input.queryHash,
    chunkSha256,
  });
}

function assembleDiagnostics(entry: {
  status: KnowledgeDecisionDiagnostics["status"];
  reason: KnowledgeDecisionFallbackReason | null;
  providerId: string | null;
  modelVersion: string | null;
  outboundCount: number;
  outcomes: KnowledgeDecisionOutcome[];
  cacheHitCount: number;
  latencyMs: number;
  action: KnowledgeDecisionDiagnostics["action"];
}): KnowledgeDecisionDiagnostics {
  const scoredCount = entry.outcomes.filter((outcome) => outcome.status === "scored").length;
  return {
    status: entry.status,
    reason: entry.reason,
    action: entry.action,
    providerId: entry.providerId,
    modelVersion: entry.modelVersion,
    policyVersion: DECISION_POLICY_VERSION,
    outboundCount: entry.outboundCount,
    scoredCount,
    fallbackCount: entry.outcomes.length - scoredCount,
    cacheHitCount: entry.cacheHitCount,
    latencyMs: entry.latencyMs,
  };
}
