/**
 * VaultSearch 协议映射（obsidian-knowledge.md §5f）。
 *
 * KnowledgeRunView → drora knowledge/search 协议结果的纯函数。字段白名单是 §5f.2
 * 的边界落点：不含 score（bm25 值不是正确率）、不含 sha 字段（可验证性归 W03
 * Receipt，工具摘录是「未验证引用」）、不含绝对路径。结构化 status 直通，不编造。
 */
import type { DroraKnowledgeSearchProtocolResult } from "@drora/shared";
import type { KnowledgeRunView } from "./knowledgeTypes.js";

/** search 落定后的合法终态（retrieving 是 createRun 与 search 之间的瞬态，不可达）。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "ready",
  "partial",
  "empty",
  "no_source",
  "source_stale",
  "cancelled",
  "failed",
]);

export function toVaultSearchProtocolResult(
  run: KnowledgeRunView,
): DroraKnowledgeSearchProtocolResult {
  const status = TERMINAL_STATUSES.has(run.status)
    ? (run.status as DroraKnowledgeSearchProtocolResult["status"])
    : // 防御：非终态（理论不可达）按 failed 结构化上报，绝不把半成品候选当结果。
      ("failed" as const);
  return {
    status,
    reason:
      status === run.status
        ? run.reason
        : ((run.reason ?? "search_not_finished") as DroraKnowledgeSearchProtocolResult["reason"]),
    candidates: run.candidates.map((candidate) => ({
      articleId: candidate.articleId,
      relativePath: candidate.relativePath,
      title: candidate.title,
      matchedHeading: candidate.matchedHeading,
      excerpt: candidate.excerpt,
      quote: {
        startLine: candidate.quote.startLine,
        endLine: candidate.quote.endLine,
        startOffset: candidate.quote.startOffset,
        endOffset: candidate.quote.endOffset,
      },
      rank: candidate.rank,
      matchedChunkCount: candidate.matchedChunkCount,
    })),
    diagnostics:
      run.diagnostics === null
        ? null
        : {
            coveragePartial: run.coverage?.partial ?? null,
            matchRelaxedToOr: run.diagnostics.matchRelaxedToOr,
            semantic: run.diagnostics.semantic,
          },
  };
}
