/**
 * Inspector verification and source opening share a scoped, fail-closed pipeline.
 * Displaying "verified" is not a capability: opening always acquires a fresh
 * receipt and checks the Vault file SHA/quote at the second read.
 */
import * as React from "react";
import type {
  IKnowledgeIndexService, IKnowledgeQueryService, KnowledgeArticleCandidate,
} from "@drora/services";
import type {
  KnowledgeAskAction, KnowledgeAskState, KnowledgeEvidenceInspectState,
  KnowledgeEvidenceQuote,
} from "./knowledgeAskModel.js";
import { verifyKnowledgeCandidateEvidence } from "./knowledgeEvidenceVerification.js";

interface AskScope {
  sessionId?: string;
  workspaceKey?: string;
  queryService: IKnowledgeQueryService | null;
  indexService: IKnowledgeIndexService | null;
}

export function useKnowledgeCandidateVerification(input: {
  state: KnowledgeAskState;
  queryService: IKnowledgeQueryService | null;
  sessionId?: string;
  submitSeqRef: React.MutableRefObject<number>;
  scopeRef: React.MutableRefObject<AskScope>;
  dispatch: React.Dispatch<KnowledgeAskAction>;
  onOpenNote: (
    relativePath: string,
    reveal?: KnowledgeEvidenceQuote,
    isCurrent?: () => boolean,
    expectedExcerpt?: string,
    expectedFileSha256?: string,
  ) => void;
}) {
  const { state, queryService, sessionId, submitSeqRef, scopeRef, dispatch, onOpenNote } = input;

  const verifyEvidence = React.useCallback(
    async (candidate: KnowledgeArticleCandidate): Promise<KnowledgeEvidenceInspectState | null> => {
      const run = state.current?.run;
      const seq = submitSeqRef.current;
      if (!queryService || !run) return null;
      dispatch({ type: "evidenceChecking", articleId: candidate.articleId });
      const proof = await verifyKnowledgeCandidateEvidence({
        queryService, run, candidate, sessionId,
      });
      if (seq !== submitSeqRef.current) return null;
      dispatch({ type: "evidenceResolved", articleId: candidate.articleId, state: proof });
      return proof;
    },
    [queryService, sessionId, state.current?.run.runId, submitSeqRef, dispatch],
  );

  const openCurrentCandidate = React.useCallback(
    async (candidate: KnowledgeArticleCandidate): Promise<void> => {
      const seq = submitSeqRef.current;
      const scope = scopeRef.current;
      const isCurrent = (): boolean =>
        seq === submitSeqRef.current &&
        scopeRef.current.sessionId === scope.sessionId &&
        scopeRef.current.workspaceKey === scope.workspaceKey &&
        scopeRef.current.queryService === scope.queryService &&
        scopeRef.current.indexService === scope.indexService;
      if (!isCurrent()) return;
      const verified = await verifyEvidence(candidate);
      if (!isCurrent() || verified?.phase !== "verified") return;
      onOpenNote(
        verified.relativePath, verified.quote, isCurrent,
        verified.excerpt, candidate.fileSha256,
      );
    },
    [onOpenNote, scopeRef, submitSeqRef, verifyEvidence],
  );

  return { verifyEvidence, openCurrentCandidate };
}
