/**
 * LocalFallback（W05 / spec §5d.1）。
 *
 * 确定性本地产出：全部候选 status:"fallback"、保持本地名次——任何「关闭/未授权/
 * 失败」路径都落到这里，本地候选永远可用（ADR #5、A25）。不产生任何出站。
 */
import type {
  KnowledgeDecisionCandidate,
  KnowledgeDecisionOutcome,
  KnowledgeDecisionProvider,
  KnowledgeDecisionRequest,
  KnowledgeDecisionResult,
  KnowledgeDecisionFallbackReason,
} from "./decisionTypes.js";

export const LOCAL_FALLBACK_PROVIDER_ID = "local-fallback";

/** 由候选集合构造全部回退的决策结果（顺序 = 本地名次）。 */
export function localFallbackOutcomes(
  candidates: KnowledgeDecisionCandidate[],
  reason: KnowledgeDecisionFallbackReason,
): KnowledgeDecisionOutcome[] {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    status: "fallback" as const,
    fallbackReason: reason,
  }));
}

/**
 * 可注入管线的 LocalFallback provider 形态：管线也可以不注入 provider 直接用
 * `localFallbackOutcomes`；此实现供评测框架把「本地基线」表达为同一端口。
 */
export function createLocalFallbackProvider(): KnowledgeDecisionProvider {
  return {
    id: LOCAL_FALLBACK_PROVIDER_ID,
    modelId: "none",
    async decide(request: KnowledgeDecisionRequest): Promise<KnowledgeDecisionResult> {
      return {
        providerId: LOCAL_FALLBACK_PROVIDER_ID,
        modelVersion: null,
        outcomes: localFallbackOutcomes(request.candidates, "disabled_no_provider"),
        outboundCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        skippedCount: 0,
      };
    },
  };
}
