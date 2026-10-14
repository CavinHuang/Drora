/**
 * VaultView evidence verification is deliberately separate from UI state.
 * A successful prepareEvidence receipt is not enough: resolveCitation must
 * independently confirm the original file, session and quote are current.
 */
import type { IKnowledgeQueryService } from "@drora/services";
import type { KnowledgeEvidenceInspectState } from "./knowledgeAskModel.js";

export async function verifyKnowledgeCandidateEvidence(params: {
  queryService: IKnowledgeQueryService;
  runId: string;
  articleId: string;
  sessionId?: string;
}): Promise<KnowledgeEvidenceInspectState> {
  const { queryService, runId, articleId, sessionId } = params;
  try {
    const prepared = await queryService.prepareEvidence({ runId, articleId });
    if (prepared.status !== "current") {
      return { phase: "unavailable", status: prepared.status, reason: null };
    }

    const resolved = await queryService.resolveCitation({
      receiptId: prepared.receipt.receiptId,
      sessionId,
    });
    if (resolved.status !== "current" || !resolved.citation) {
      return {
        phase: "unavailable",
        status: resolved.status === "current" ? "forbidden" : resolved.status,
        reason: "reason" in resolved ? resolved.reason : null,
      };
    }

    return {
      phase: "verified",
      receiptId: resolved.citation.receiptId,
      excerpt: resolved.citation.excerpt,
      relativePath: resolved.citation.relativePath,
      title: resolved.citation.title,
      heading: resolved.citation.heading,
      quote: resolved.citation.quote,
    };
  } catch (error) {
    return { phase: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
