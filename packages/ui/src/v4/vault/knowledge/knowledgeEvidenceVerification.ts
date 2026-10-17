/**
 * Source identity checks shared by the single-note Inspector and the multi-note Agent handoff.
 * A "current" citation is necessary but not sufficient: it must identify the exact selected
 * candidate and the exact receipt minted in this request, for the same session and source.
 */
import type {
  IKnowledgeQueryService,
  KnowledgeArticleCandidate,
  KnowledgeEvidenceReceipt,
  KnowledgeResolveCitationResult,
  KnowledgeRunView,
} from "@drora/services";
import type { KnowledgeEvidenceInspectState } from "./knowledgeAskModel.js";

type CurrentCitation = Extract<KnowledgeResolveCitationResult, { status: "current" }>["citation"];
type Quote = KnowledgeArticleCandidate["quote"];

function sameQuote(left: Quote, right: Quote): boolean {
  return (
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset
  );
}

/** Reject valid-looking receipts/citations that refer to a different source or selection. */
export function citationMatchesSelectedCandidate(input: {
  run: Pick<KnowledgeRunView, "runId" | "sessionId" | "source">;
  candidate: KnowledgeArticleCandidate;
  sessionId?: string;
  receipt: KnowledgeEvidenceReceipt;
  citation: CurrentCitation;
}): boolean {
  const { run, candidate, sessionId, receipt, citation } = input;
  const expectedSession = sessionId ?? "";
  if (!run.source || run.sessionId !== (sessionId ?? null)) return false;
  return (
    Boolean(receipt.receiptId) &&
    receipt.receiptId === citation.receiptId &&
    receipt.runId === run.runId &&
    citation.runId === run.runId &&
    receipt.sessionId === expectedSession &&
    citation.sessionId === expectedSession &&
    receipt.articleId === candidate.articleId &&
    citation.articleId === candidate.articleId &&
    receipt.vaultId === run.source.vaultId &&
    receipt.sourceEpoch === run.source.sourceEpoch &&
    receipt.relativePath === candidate.relativePath &&
    citation.relativePath === candidate.relativePath &&
    receipt.fileSha256 === candidate.fileSha256 &&
    receipt.chunkSha256 === candidate.chunkSha256 &&
    sameQuote(receipt.quote, candidate.quote) &&
    sameQuote(citation.quote, candidate.quote) &&
    Boolean(citation.excerpt.trim())
  );
}

export async function verifyKnowledgeCandidateEvidence(params: {
  queryService: Pick<IKnowledgeQueryService, "prepareEvidence" | "resolveCitation">;
  run: Pick<KnowledgeRunView, "runId" | "sessionId" | "source">;
  candidate: KnowledgeArticleCandidate;
  sessionId?: string;
}): Promise<KnowledgeEvidenceInspectState> {
  const { queryService, run, candidate, sessionId } = params;
  try {
    const prepared = await queryService.prepareEvidence({
      runId: run.runId,
      articleId: candidate.articleId,
    });
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
    if (!citationMatchesSelectedCandidate({
      run, candidate, sessionId, receipt: prepared.receipt, citation: resolved.citation,
    })) {
      return { phase: "unavailable", status: "forbidden", reason: "citation_mismatch" };
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

/**
 * Previous-round results are historical search candidates, not trusted navigation targets.
 * Revalidate their original run, candidate and source before returning a line-accurate link.
 * A newly created receipt is used only for verification; it is never carried to a different
 * session or converted into a plain-path navigation on failure.
 */
export async function verifyPreviousKnowledgeCandidateEvidence(params: {
  queryService: Pick<IKnowledgeQueryService, "prepareEvidence" | "resolveCitation">;
  run: KnowledgeRunView;
  candidate: KnowledgeArticleCandidate;
  sessionId?: string;
}): Promise<KnowledgeEvidenceInspectState> {
  const { run, candidate } = params;
  const belongsToRun = run.candidates.some((entry) =>
    entry.articleId === candidate.articleId &&
    entry.relativePath === candidate.relativePath &&
    entry.fileSha256 === candidate.fileSha256 &&
    entry.chunkSha256 === candidate.chunkSha256 &&
    sameQuote(entry.quote, candidate.quote)
  );
  if (!["ready", "partial"].includes(run.status) || !belongsToRun) {
    return { phase: "unavailable", status: "forbidden", reason: "previous_candidate_unavailable" };
  }
  return verifyKnowledgeCandidateEvidence(params);
}
