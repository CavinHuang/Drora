/**
 * ANSWER / COMPARE → current Agent session.
 *
 * Preparation is read-only and all-or-nothing: each selected candidate receives a fresh
 * source-validated receipt, then a fresh resolveCitation check. Nothing enters the composer
 * until every selected source passes. CLI admission/queue promotion still reverify receipts.
 */
import type { IKnowledgeQueryService, KnowledgeRunView } from "@drora/services";
import { citationMatchesSelectedCandidate } from "./knowledgeEvidenceVerification.js";
import { MAX_KNOWLEDGE_HANDOFF_SOURCES } from "./knowledgeAskModel.js";
import {
  createConversationSelectionReference,
  type MarkdownSelectionReference,
} from "@/lib/conversationSelectionReference.js";

export type KnowledgeAnswerIntent = "answer" | "compare";
export type KnowledgeHandoffFailure =
  | "invalid_selection"
  | "session_mismatch"
  | "run_unavailable"
  | "evidence_unavailable";

export type KnowledgeHandoffPreparation =
  | { ok: true; prompt: string; references: MarkdownSelectionReference[] }
  | { ok: false; reason: KnowledgeHandoffFailure };

export { MAX_KNOWLEDGE_HANDOFF_SOURCES } from "./knowledgeAskModel.js";

export function buildKnowledgeAnswerPrompt(query: string, intent: KnowledgeAnswerIntent): string {
  const question = query.trim();
  if (intent === "compare") {
    return [
      "请根据附带的 Obsidian 可信证据比较相关笔记。",
      "逐项说明相同点、差异和可能的冲突，引用支持各结论的来源文件；不确定或证据不足时明确说明。",
      "不要把检索候选当成已经核实的事实，也不要补造未提供的原文。",
      "",
      `问题：${question}`,
    ].join("\n");
  }
  return [
    "请仅依据附带的 Obsidian 可信证据回答下面的问题。",
    "关键结论需指出所依据的来源文件；如果材料不足以回答，请明确说明，不要编造。",
    "",
    `问题：${question}`,
  ].join("\n");
}

export async function prepareKnowledgeAgentHandoff(input: {
  run: KnowledgeRunView;
  articleIds: readonly string[];
  sessionId: string;
  intent: KnowledgeAnswerIntent;
  queryService: Pick<IKnowledgeQueryService, "prepareEvidence" | "resolveCitation">;
}): Promise<KnowledgeHandoffPreparation> {
  const { run, articleIds, sessionId, intent, queryService } = input;
  if (!["ready", "partial"].includes(run.status)) {
    return { ok: false, reason: "run_unavailable" };
  }
  // A receipt from an unbound library query must never be upgraded to a session-bound claim.
  if (!sessionId.trim() || run.sessionId !== sessionId) {
    return { ok: false, reason: "session_mismatch" };
  }
  const uniqueIds = [...new Set(articleIds)];
  const minSources = intent === "compare" ? 2 : 1;
  if (
    uniqueIds.length < minSources ||
    uniqueIds.length > MAX_KNOWLEDGE_HANDOFF_SOURCES ||
    uniqueIds.length !== articleIds.length
  ) {
    return { ok: false, reason: "invalid_selection" };
  }
  const candidateById = new Map(run.candidates.map((entry) => [entry.articleId, entry]));
  if (uniqueIds.some((articleId) => !candidateById.has(articleId))) {
    return { ok: false, reason: "invalid_selection" };
  }

  const references: MarkdownSelectionReference[] = [];
  try {
    for (const articleId of uniqueIds) {
      const prepared = await queryService.prepareEvidence({ runId: run.runId, articleId });
      if (prepared.status !== "current") {
        return { ok: false, reason: "evidence_unavailable" };
      }
      const resolved = await queryService.resolveCitation({
        receiptId: prepared.receipt.receiptId,
        sessionId,
      });
      if (resolved.status !== "current" || !resolved.citation) {
        return { ok: false, reason: "evidence_unavailable" };
      }
      const citation = resolved.citation;
      const candidate = candidateById.get(articleId);
      if (!candidate || !citationMatchesSelectedCandidate({
        run, candidate, sessionId, receipt: prepared.receipt, citation,
      })) {
        return { ok: false, reason: "evidence_unavailable" };
      }
      references.push(
        createConversationSelectionReference({
          contentType: "markdown",
          sourceKey: `vault:${citation.relativePath}`,
          sourceTitle: citation.title,
          path: citation.relativePath,
          text: citation.excerpt,
          evidenceReceiptId: citation.receiptId,
        }) as MarkdownSelectionReference,
      );
    }
  } catch {
    return { ok: false, reason: "evidence_unavailable" };
  }
  return {
    ok: true,
    prompt: buildKnowledgeAnswerPrompt(run.query, intent),
    references,
  };
}
