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
import {
  prepareKnowledgeAgentHandoff,
  sameKnowledgeHandoffScope,
  type KnowledgeHandoffScope,
} from "./knowledgeAgentHandoff.js";
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
  // Ref locks are synchronous: double-clicks must not start two receipt batches.
  const addingRef = React.useRef(false);
  const handoffRef = React.useRef(false);
  const latestRef = React.useRef<{
    queryService: IKnowledgeQueryService | null;
    scope: KnowledgeHandoffScope;
  }>({ queryService: null, scope: { runId: null, sessionId: null, workspaceKey: null, articleIds: [] } });
  latestRef.current = {
    queryService,
    scope: {
      runId: state.current?.run.runId ?? null,
      sessionId: selectionTarget?.sessionId ?? null,
      workspaceKey: selectionTarget?.workspaceKey ?? null,
      articleIds: state.selectedArticleIds,
    },
  };

  const addVerifiedEvidenceToAgent = React.useCallback(
    async (candidate: KnowledgeArticleCandidate): Promise<void> => {
      if (!selectionTarget?.sessionId) {
        droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), { variant: "warning" });
        return;
      }
      if (addingRef.current) return;
      addingRef.current = true;
      const targetSession = selectionTarget.sessionId;
      const targetWorkspace = selectionTarget.workspaceKey;
      const runId = state.current?.run.runId ?? null;
      const submitSeq = submitSeqRef.current;
      setAddingArticleId(candidate.articleId);
      try {
        // Always issue a fresh receipt; the last verified badge may no longer be current.
        const proof = await verifyEvidence(candidate);
        if (!proof || proof.phase !== "verified" || submitSeq !== submitSeqRef.current) return;
        const latest = latestRef.current;
        if (
          latest.queryService !== queryService ||
          latest.scope.runId !== runId ||
          latest.scope.sessionId !== targetSession ||
          latest.scope.workspaceKey !== targetWorkspace
        ) return;
        const reference = createConversationSelectionReference({
          contentType: "markdown",
          sourceKey: `vault:${proof.relativePath}`,
          sourceTitle: proof.title,
          path: proof.relativePath,
          text: proof.excerpt,
          evidenceReceiptId: proof.receiptId,
        });
        const result = dispatchConversationSelectionAdd({
          targetSessionId: targetSession,
          workspaceKey: targetWorkspace,
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
        addingRef.current = false;
        setAddingArticleId(null);
      }
    },
    [intl, queryService, selectionTarget, state.current?.run.runId, submitSeqRef, verifyEvidence],
  );

  const handoffQuestionToAgent = React.useCallback(async (): Promise<void> => {
    const round = state.current;
    if (!queryService || !selectionTarget?.sessionId || !round) {
      droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), { variant: "warning" });
      return;
    }
    const intent = round.intent;
    if (intent === "find" || handoffRef.current) return;
    handoffRef.current = true;
    // ANSWER and COMPARE both accept an explicit 1–5 source selection.
    const articleIds = [...state.selectedArticleIds];
    const seq = submitSeqRef.current;
    const scope: KnowledgeHandoffScope = {
      runId: round.run.runId,
      sessionId: selectionTarget.sessionId,
      workspaceKey: selectionTarget.workspaceKey,
      articleIds,
    };
    setHandoffBusy(true);
    try {
      const preparation = await prepareKnowledgeAgentHandoff({
        run: round.run,
        articleIds,
        sessionId: selectionTarget.sessionId,
        intent,
        queryService,
      });
      if (
        seq !== submitSeqRef.current ||
        latestRef.current.queryService !== queryService ||
        !sameKnowledgeHandoffScope(scope, latestRef.current.scope)
      ) return;
      if (!preparation.ok) {
        droraToast(intl.formatMessage({ id: `vault.ask.handoff.error.${preparation.reason}` }), { variant: "warning" });
        return;
      }
      const result = requestKnowledgeAgentHandoff({
        targetSessionId: scope.sessionId!,
        workspaceKey: scope.workspaceKey!,
        prompt: preparation.prompt,
        references: preparation.references,
      });
      if (!result.ok) {
        droraToast(intl.formatMessage({ id: `vault.ask.handoff.error.${result.reason}` }), { variant: "warning" });
        return;
      }
      droraToast(intl.formatMessage({ id: "vault.ask.handoff.prepared" }));
    } finally {
      handoffRef.current = false;
      setHandoffBusy(false);
    }
  }, [intl, queryService, selectionTarget, state.current, state.selectedArticleIds, submitSeqRef]);

  return { addingArticleId, handoffBusy, addVerifiedEvidenceToAgent, handoffQuestionToAgent };
}
