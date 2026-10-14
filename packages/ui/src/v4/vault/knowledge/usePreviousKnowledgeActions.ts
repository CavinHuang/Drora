/**
 * Historical results are navigation aids, never persistent proof.
 * Every open/reattach action obtains fresh server-issued evidence and checks the originating
 * query, session and source before it can navigate or mutate a scoped composer selection.
 */
import * as React from "react";
import type { IKnowledgeQueryService, KnowledgeArticleCandidate } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import {
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";
import { evidenceUnavailableMessageKey } from "./KnowledgeCandidateCard.js";
import { verifyPreviousKnowledgeCandidateEvidence } from "./knowledgeEvidenceVerification.js";
import type { KnowledgeAskRound, KnowledgeEvidenceQuote } from "./knowledgeAskModel.js";

export function usePreviousKnowledgeActions({
  previous,
  queryService,
  sessionId,
  selectionTarget,
  submitSeqRef,
  onOpenNote,
}: {
  previous: KnowledgeAskRound | null;
  queryService: IKnowledgeQueryService | null;
  sessionId?: string;
  selectionTarget: MarkdownSelectionTarget | null;
  submitSeqRef: React.RefObject<number>;
  onOpenNote: (relativePath: string, reveal?: KnowledgeEvidenceQuote) => void;
}): {
  openingPreviousId: string | null;
  usePreviousCandidate: (candidate: KnowledgeArticleCandidate, action: "open" | "attach") => Promise<void>;
  cancelPendingPrevious: () => void;
} {
  const { intl } = useDroraIntl();
  const [openingPreviousId, setOpeningPreviousId] = React.useState<string | null>(null);
  const openingPreviousRef = React.useRef<{ articleId: string; seq: number } | null>(null);

  const cancelPendingPrevious = React.useCallback((): void => {
    openingPreviousRef.current = null;
    setOpeningPreviousId(null);
  }, []);

  const usePreviousCandidate = React.useCallback(
    async (candidate: KnowledgeArticleCandidate, action: "open" | "attach"): Promise<void> => {
      if (!previous || !queryService || openingPreviousRef.current) return;
      if (action === "attach" && !selectionTarget?.sessionId) {
        droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), { variant: "warning" });
        return;
      }
      const seq = submitSeqRef.current;
      const token = { articleId: candidate.articleId, seq };
      openingPreviousRef.current = token;
      setOpeningPreviousId(candidate.articleId);
      try {
        const proof = await verifyPreviousKnowledgeCandidateEvidence({
          queryService,
          run: previous.run,
          candidate,
          sessionId,
        });
        if (seq !== submitSeqRef.current || openingPreviousRef.current !== token) return;
        if (proof.phase === "verified") {
          if (action === "open") {
            onOpenNote(proof.relativePath, proof.quote);
          } else if (selectionTarget?.sessionId) {
            const reference = createConversationSelectionReference({
              contentType: "markdown",
              sourceKey: `vault:${proof.relativePath}`,
              sourceTitle: proof.title,
              path: proof.relativePath,
              text: proof.excerpt,
              evidenceReceiptId: proof.receiptId,
            });
            const result = dispatchConversationSelectionAdd({
              targetSessionId: selectionTarget.sessionId,
              workspaceKey: selectionTarget.workspaceKey,
              reference,
            });
            if (!result.ok) {
              droraToast(intl.formatMessage({
                id: result.reason === "count" ? "vault.selection.limitReached" : "vault.selection.tooLong",
              }), { variant: "warning" });
            }
          }
        } else if (proof.phase === "failed") {
          droraToast(intl.formatMessage({ id: "vault.ask.evidence.failed" }, { message: proof.message }), { variant: "warning" });
        } else if (proof.phase === "unavailable") {
          droraToast(intl.formatMessage({ id: evidenceUnavailableMessageKey(proof.status) }), { variant: "warning" });
        }
      } finally {
        if (openingPreviousRef.current === token) {
          openingPreviousRef.current = null;
          setOpeningPreviousId(null);
        }
      }
    },
    [intl, onOpenNote, previous, queryService, selectionTarget, sessionId, submitSeqRef],
  );

  return { openingPreviousId, usePreviousCandidate, cancelPendingPrevious };
}
