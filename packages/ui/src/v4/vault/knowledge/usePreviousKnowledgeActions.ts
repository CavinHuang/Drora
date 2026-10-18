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
  getConversationSelectionReferenceScope,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";
import { displayCandidateTitle, evidenceUnavailableMessageKey } from "./KnowledgeCandidateCard.js";
import { createKnowledgeAttachReference } from "./knowledgeAgentHandoff.js";
import {
  buildSelectionSideChatKey,
  requestSelectionSideChatOpen,
} from "@/lib/selectionSideChatRuntime.js";
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
  onOpenNote: (
    relativePath: string,
    reveal?: KnowledgeEvidenceQuote,
    isCurrent?: () => boolean,
    expectedExcerpt?: string,
    expectedFileSha256?: string,
  ) => void;
}): {
  openingPreviousId: string | null;
  /** 非-hook 普通回调（D-8：use 前缀命名会误导 rules-of-hooks，已更名）。 */
  runPreviousCandidateAction: (
    candidate: KnowledgeArticleCandidate,
    action: "open" | "attach",
  ) => Promise<void>;
  cancelPendingPrevious: () => void;
  openFollowUpSideChat: (candidate: KnowledgeArticleCandidate) => void;
} {
  const { intl } = useDroraIntl();
  const [openingPreviousId, setOpeningPreviousId] = React.useState<string | null>(null);
  const openingPreviousRef = React.useRef<{ articleId: string; seq: number } | null>(null);

  const cancelPendingPrevious = React.useCallback((): void => {
    openingPreviousRef.current = null;
    setOpeningPreviousId(null);
  }, []);

  const runPreviousCandidateAction = React.useCallback(
    async (candidate: KnowledgeArticleCandidate, action: "open" | "attach"): Promise<void> => {
      if (!previous || !queryService || openingPreviousRef.current) return;
      if (action === "attach" && !selectionTarget?.sessionId) {
        droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), {
          variant: "warning",
        });
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
            // D-5 修复（2026-10-17 增量评审）：与当前轮 openCurrentCandidate 同防护强度——
            // 携带 isCurrent/expectedExcerpt/expectedFileSha256，VaultView 侧据此装配
            // validateRead 二次读回校验；resolveCitation 之后文件被改时不按旧行号锚定。
            onOpenNote(
              proof.relativePath,
              proof.quote,
              () => openingPreviousRef.current === token,
              proof.excerpt,
              candidate.fileSha256,
            );
          } else if (selectionTarget?.sessionId) {
            // ui-know-b-1（2026-10-18 终审）：attach 与单篇「加入 Agent」同构造——与
            // handoff 草稿混用（同来源去重替换）时镜像 evidenceSource.index，消除整批
            // manifest mismatch；独立 attach 语义不变。
            const reference = createKnowledgeAttachReference({
              scope: getConversationSelectionReferenceScope(
                selectionTarget.sessionId,
                selectionTarget.workspaceKey,
              ),
              proof,
            });
            const result = dispatchConversationSelectionAdd({
              targetSessionId: selectionTarget.sessionId,
              workspaceKey: selectionTarget.workspaceKey,
              reference,
            });
            if (!result.ok) {
              droraToast(
                intl.formatMessage({
                  id:
                    result.reason === "count"
                      ? "vault.selection.limitReached"
                      : "vault.selection.tooLong",
                }),
                { variant: "warning" },
              );
            }
          }
        } else if (proof.phase === "failed") {
          droraToast(
            intl.formatMessage({ id: "vault.ask.evidence.failed" }, { message: proof.message }),
            { variant: "warning" },
          );
        } else if (proof.phase === "unavailable") {
          droraToast(intl.formatMessage({ id: evidenceUnavailableMessageKey(proof.status) }), {
            variant: "warning",
          });
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

  const openFollowUpSideChat = React.useCallback(
    (candidate: KnowledgeArticleCandidate): void => {
      if (!selectionTarget?.sessionId) {
        droraToast(intl.formatMessage({ id: "vault.ask.candidate.needSession" }), {
          variant: "warning",
        });
        return;
      }
      // A side chat is an ordinary selection, not a transferable Evidence Receipt.
      const key = buildSelectionSideChatKey(
        selectionTarget.workspaceKey,
        selectionTarget.sessionId,
      );
      const reference = createConversationSelectionReference({
        contentType: "markdown",
        sourceKey: `vault:${candidate.relativePath}`,
        sourceTitle: displayCandidateTitle(candidate),
        path: candidate.relativePath,
        text: candidate.excerpt,
      });
      if (!requestSelectionSideChatOpen(key, reference)) {
        droraToast(intl.formatMessage({ id: "vault.selection.sideChatFailed" }), {
          variant: "warning",
        });
      }
    },
    [intl, selectionTarget],
  );

  return {
    openingPreviousId,
    runPreviousCandidateAction,
    cancelPendingPrevious,
    openFollowUpSideChat,
  };
}
