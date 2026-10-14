/**
 * Agent handoff actions owned by the query view.
 * Separates async receipt verification and composer mutations from result rendering.
 * A new query invalidates in-flight receipts before they can reach the composer.
 */
import * as React from "react";
import type { IKnowledgeQueryService, KnowledgeArticleCandidate } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import {
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  requestKnowledgeAgentHandoff,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";
import { prepareKnowledgeAgentHandoff } from "./knowledgeAgentHandoff.js";
import type { KnowledgeAskState, KnowledgeEvidenceInspectState } from "./knowledgeAskModel.js";

export function useKnowledgeAgentActions(params: {
  queryService: IKnowledgeQueryService | null;
  selectionTarget: MarkdownSelectionTarget | null;
  state: KnowledgeAskState;
  submitSeqRef: React.RefObject<number>;
  verifyEvidence: (candidate: KnowledgeArticleCandidate) => Promise<KnowledgeEvidenceInspectState | null>;
}): {
  addingArticleId: string | null;
  handoffBusy: boolean;
  addVerifiedEvidenceToAgent: (candidate: KnowledgeArticleCandidate) => Promise<void>;
  handoffQuestionToAgent: () => Promise<void>;
} {
  const { intl } = useDroraIntl();
  const { queryService, selectionTarget, state, submitSeqRef, verifyEvidence } = params;
  const [addingArticleId, setAddingArticleId] = React.useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = React.useState(false);

  const addVerifiedEvidenceToAgent = React.useCallback(
    async (candidate: KnowledgeArticleCandidate): Promise<void> => {
      if (!selectionTarget?.sessionId) {
        droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), { variant: "warning" });
        return;
      }
      const submitSeq = submitSeqRef.current;
      setAddingArticleId(candidate.articleId);
      try {
        // Always issue a fresh receipt; the last verified badge may no longer be current.
        const proof = await verifyEvidence(candidate);
        if (!proof || proof.phase !== "verified" || submitSeq !== submitSeqRef.current) return;
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
          droraToast(
            intl.formatMessage({
              id: result.reason === "count" ? "vault.selection.limitReached" : "vault.selection.tooLong",
            }),
            { variant: "warning" },
          );
        }
      } finally {
        setAddingArticleId(null);
      }
    },
    [intl, selectionTarget, submitSeqRef, verifyEvidence],
  );

  const handoffQuestionToAgent = React.useCallback(async (): Promise<void> => {
    const round = state.current;
    if (!queryService || !selectionTarget?.sessionId || !round) {
      droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), { variant: "warning" });
      return;
    }
    const intent = round.intent;
    if (intent === "find") return;
    const articleIds = intent === "compare"
      ? state.selectedArticleIds
      : state.selectedArticleId ? [state.selectedArticleId] : [];
    const seq = submitSeqRef.current;
    setHandoffBusy(true);
    try {
      const preparation = await prepareKnowledgeAgentHandoff({
        run: round.run,
        articleIds,
        sessionId: selectionTarget.sessionId,
        intent,
        queryService,
      });
      if (seq !== submitSeqRef.current) return;
      if (!preparation.ok) {
        droraToast(intl.formatMessage({ id: `vault.ask.handoff.error.${preparation.reason}` }), { variant: "warning" });
        return;
      }
      const result = requestKnowledgeAgentHandoff({
        targetSessionId: selectionTarget.sessionId,
        workspaceKey: selectionTarget.workspaceKey,
        prompt: preparation.prompt,
        references: preparation.references,
      });
      if (!result.ok) {
        droraToast(intl.formatMessage({ id: `vault.ask.handoff.error.${result.reason}` }), { variant: "warning" });
        return;
      }
      droraToast(intl.formatMessage({ id: "vault.ask.handoff.prepared" }));
    } finally {
      setHandoffBusy(false);
    }
  }, [intl, queryService, selectionTarget, state.current, state.selectedArticleId, state.selectedArticleIds, submitSeqRef]);

  return { addingArticleId, handoffBusy, addVerifiedEvidenceToAgent, handoffQuestionToAgent };
}
