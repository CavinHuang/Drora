// 迁自 packages/services/src/knowledge/decision/localFallback.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
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
