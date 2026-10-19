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
  const [openingPreviousId, setOpeningIdState] = React.useState<string | null>(null);
  const openingPreviousRef = React.useRef<{ articleId: string; seq: number } | null>(null);
  // D-G20-1 修复（2026-10-18 G 覆盖轮实证）：isCurrent 闭包此前读
  // openingPreviousRef（busy token），而 finally 在 onOpenNote 的 fire-and-forget
  // 导航仍在途时同 tick 清空它——VaultView openFile 首过 isCurrent 后在
  // await flushCurrentEditor 让出微任务，恢复时二次 isCurrent 恒 false，
  // 「上一轮候选打开原文」整族（G17/G20/G28 历史路径）确定性静默失败。
  // 修法对齐当前轮 openCurrentCandidate 的自包含闭包先例：导航有效性判
  // mountedRef + openEpoch + submitSeq，与 busy token 解耦——busy 态照常即时复位。
  const mountedRef = React.useRef(true);
  const openEpochRef = React.useRef(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openEpochRef.current += 1;
    };
  }, []);

  const setOpeningPreviousId = setOpeningIdState;

  const cancelPendingPrevious = React.useCallback((): void => {
    openEpochRef.current += 1;
    openingPreviousRef.current = null;
    setOpeningIdState(null);
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
      // 新动作使旧的在途导航失效（快速连点时只认最新一次）。
      openEpochRef.current += 1;
      const epoch = openEpochRef.current;
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
            // isCurrent 为自包含闭包（D-G20-1）：不读会被 finally 即时清空的 busy
            // token，导航全程有效；取消/新动作/新检索/卸载各自经 epoch/seq/mounted 使
            // 其失效。证实时（old refs 仍用于 busy 守卫，命名沿用）导航闭包不用它。
            onOpenNote(
              proof.relativePath,
              proof.quote,
              () =>
                mountedRef.current &&
                epoch === openEpochRef.current &&
                seq === submitSeqRef.current,
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
