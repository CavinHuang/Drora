/** Final renderer guard for opening a citation from an existing Agent composer. */
import type { KnowledgeResolveCitationResult } from "@drora/services";
import type { KnowledgeEvidenceQuote } from "./knowledgeAskModel.js";
import type { KnowledgeCitationOpenResult } from "@/lib/conversationSelectionReference.js";

/** Confirm that navigation still belongs to this live Vault, Session and request. */
export function isKnowledgeCitationScopeCurrent(input: {
  requestActive: boolean;
  mounted: boolean;
  originalVaultId: string;
  currentVaultId: string | null | undefined;
  sessionId: string;
  activeSessionId: string | null | undefined;
  workspaceKey: string;
  activeWorkspaceKey: string | null | undefined;
  sameQueryService: boolean;
}): boolean {
  return input.requestActive && input.mounted &&
    input.originalVaultId === input.currentVaultId &&
    input.sessionId === input.activeSessionId &&
    input.workspaceKey === input.activeWorkspaceKey &&
    input.sameQueryService;
}

export type KnowledgeCitationNavigationDecision =
  | { ok: true; relativePath: string; quote: KnowledgeEvidenceQuote }
  | Extract<KnowledgeCitationOpenResult, { ok: false }>;

function isSafeVaultRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"));
}

function isValidQuote(quote: KnowledgeEvidenceQuote): boolean {
  return (
    Number.isInteger(quote.startLine) && quote.startLine > 0 &&
    Number.isInteger(quote.endLine) && quote.endLine >= quote.startLine &&
    Number.isInteger(quote.startOffset) && quote.startOffset >= 0 &&
    Number.isInteger(quote.endOffset) && quote.endOffset >= quote.startOffset
  );
}

/**
 * The model/renderer never supplies the destination. It is taken exclusively from
 * a CURRENT resolver result for the exact session and opaque receipt requested.
 */
export function decideKnowledgeCitationNavigation(input: {
  resolved: KnowledgeResolveCitationResult;
  sessionId: string;
  receiptId: string;
}): KnowledgeCitationNavigationDecision {
  const { resolved, sessionId, receiptId } = input;
  if (resolved.status !== "current") {
    const status = resolved.status;
    return {
      ok: false,
      reason: status === "stale" || status === "missing" || status === "forbidden"
        ? status
        : "unavailable",
    };
  }
  const citation = resolved.citation;
  if (
    !citation ||
    !receiptId.trim() ||
    citation.receiptId !== receiptId ||
    citation.sessionId !== sessionId ||
    !isSafeVaultRelativePath(citation.relativePath) ||
    !isValidQuote(citation.quote)
  ) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, relativePath: citation.relativePath, quote: citation.quote };
}
