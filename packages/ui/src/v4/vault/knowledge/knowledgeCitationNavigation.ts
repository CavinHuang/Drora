/** Final renderer guard for opening a citation from an existing Agent composer. */
import type { KnowledgeResolveCitationResult } from "@drora/services";
import { knowledgeEvidenceExcerpt, normalizeContentForQuoteSelector } from "@drora/shared";
import type { KnowledgeEvidenceQuote } from "./knowledgeAskModel.js";
import type { KnowledgeCitationOpenResult } from "@/lib/conversationSelectionReference.js";

/**
 * An asynchronous citation must not become authorized again after A→B→A
 * navigation. Checking only current identity lets an old resolver regain
 * permission when the same Vault/session is reselected.
 *
 * This monotonic epoch is local to one mounted VaultView and never persisted.
 * Query services use identity comparison, not serialized object values.
 */
export function createKnowledgeCitationScopeEpoch() {
  let version = 0;
  let current: {
    sessionId: string | null | undefined;
    workspaceKey: string | null | undefined;
    vaultId: string | null | undefined;
    queryService: unknown;
  } | null = null;

  return {
    observe(next: {
      sessionId: string | null | undefined;
      workspaceKey: string | null | undefined;
      vaultId: string | null | undefined;
      queryService: unknown;
    }): number {
      if (!current ||
          current.sessionId !== next.sessionId ||
          current.workspaceKey !== next.workspaceKey ||
          current.vaultId !== next.vaultId ||
          current.queryService !== next.queryService) {
        version++;
        current = { ...next };
      }
      return version;
    },
    currentVersion(): number {
      return version;
    },
    isCurrent(capturedVersion: number): boolean {
      return capturedVersion > 0 && capturedVersion === version && current !== null;
    },
    revoke(): void {
      version++;
      current = null;
    },
  };
}

/** Prevent a delayed CodeMirror mount from applying revoked source highlights. */
export function isVaultCitationFocusCurrent(
  requestEpoch: number | undefined,
  activeEpoch: number,
): boolean {
  return requestEpoch === undefined || (requestEpoch > 0 && requestEpoch === activeEpoch);
}

/**
 * A Receipt may be current at resolution time, yet the file can change before
 * the Vault editor performs its independent read. Recheck the exact quote slice
 * before mutating the selected file or CodeMirror state.
 */
export function matchesKnowledgeCitationReadback(
  content: string,
  quote: KnowledgeEvidenceQuote,
  expectedExcerpt: string,
): boolean {
  if (!expectedExcerpt || !Number.isSafeInteger(quote.startOffset) ||
      !Number.isSafeInteger(quote.endOffset) ||
      quote.startOffset < 0 || quote.endOffset <= quote.startOffset) return false;
  const normalized = normalizeContentForQuoteSelector(content);
  if (quote.endOffset > normalized.length) return false;
  return knowledgeEvidenceExcerpt(
    normalized.slice(quote.startOffset, quote.endOffset),
  ) === expectedExcerpt;
}

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
  | {
      ok: true;
      relativePath: string;
      quote: KnowledgeEvidenceQuote;
      excerpt: string;
      fileSha256: string;
    }
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
    !isValidQuote(citation.quote) ||
    typeof citation.excerpt !== "string" || !citation.excerpt ||
    !/^[a-f0-9]{64}$/.test(citation.fileSha256)
  ) {
    return { ok: false, reason: "forbidden" };
  }
  return {
    ok: true, relativePath: citation.relativePath,
    quote: citation.quote, excerpt: citation.excerpt,
    fileSha256: citation.fileSha256,
  };
}

/**
 * Testable source-to-note navigation transaction. Never trust model links as
 * destination authority: only the fresh, matching server citation may open.
 * VaultView's isCurrent callback also checks request timeout/unmount and scope.
 */
export async function navigateKnowledgeCitation(input: {
  sessionId: string;
  receiptId: string;
  isCurrent: () => boolean;
  resolveCitation: () => Promise<KnowledgeResolveCitationResult>;
  openNote: (
    relativePath: string,
    quote: KnowledgeEvidenceQuote,
    isCurrent: () => boolean,
    expectedExcerpt: string,
    expectedFileSha256: string,
  ) => Promise<boolean>;
}): Promise<KnowledgeCitationOpenResult> {
  const forbidden: KnowledgeCitationOpenResult = { ok: false, reason: "forbidden" };
  try {
    if (!input.isCurrent()) return forbidden;
    const resolved = await input.resolveCitation();
    if (!input.isCurrent()) return forbidden;
    const decision = decideKnowledgeCitationNavigation({
      resolved, sessionId: input.sessionId, receiptId: input.receiptId,
    });
    if (!decision.ok) return decision;
    if (!input.isCurrent()) return forbidden;
    const opened = await input.openNote(
      decision.relativePath, decision.quote, input.isCurrent,
      decision.excerpt, decision.fileSha256,
    );
    if (!input.isCurrent()) return forbidden;
    return opened ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return input.isCurrent() ? { ok: false, reason: "failed" } : forbidden;
  }
}
