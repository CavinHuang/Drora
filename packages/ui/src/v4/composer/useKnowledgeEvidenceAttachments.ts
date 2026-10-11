/**
 * composer 证据附件区 hook（W09）：镜像 useConversationSelectionReferences 的
 * scope 订阅模式——本地 state + 模块级存储 + CustomEvent 跨组件刷新。
 */
import { useCallback, useEffect, useState } from "react";
import {
  clearKnowledgeEvidenceAttachmentLimitReason,
  getKnowledgeEvidenceAttachmentLimitReason,
  getKnowledgeEvidenceAttachmentScope,
  getKnowledgeEvidenceAddEventName,
  isKnowledgeEvidenceAddEvent,
  setKnowledgeEvidenceAttachmentScope,
  type KnowledgeEvidenceAttachment,
  type KnowledgeEvidenceLimitReason,
} from "@/lib/knowledgeEvidenceAttachment.js";

export function useKnowledgeEvidenceAttachments(options: {
  sessionId: string | null;
  workspaceKey: string;
}) {
  const [attachments, setAttachmentsState] = useState<
    readonly KnowledgeEvidenceAttachment[]
  >(() => getKnowledgeEvidenceAttachmentScope(options.sessionId, options.workspaceKey));
  const [limitReason, setLimitReason] = useState<KnowledgeEvidenceLimitReason | null>(() =>
    getKnowledgeEvidenceAttachmentLimitReason(options.sessionId, options.workspaceKey),
  );

  useEffect(() => {
    setAttachmentsState(getKnowledgeEvidenceAttachmentScope(options.sessionId, options.workspaceKey));
    setLimitReason(getKnowledgeEvidenceAttachmentLimitReason(options.sessionId, options.workspaceKey));
  }, [options.sessionId, options.workspaceKey]);

  const setAttachments = useCallback(
    (
      update:
        | readonly KnowledgeEvidenceAttachment[]
        | ((
            current: readonly KnowledgeEvidenceAttachment[],
          ) => readonly KnowledgeEvidenceAttachment[]),
    ) => {
      setAttachmentsState((current) => {
        const next = typeof update === "function" ? update(current) : update;
        setKnowledgeEvidenceAttachmentScope(options.sessionId, options.workspaceKey, next);
        return next;
      });
    },
    [options.sessionId, options.workspaceKey],
  );

  useEffect(() => {
    const handleAdd = (event: Event) => {
      if (!isKnowledgeEvidenceAddEvent(event)) return;
      if (
        event.detail.targetSessionId !== options.sessionId ||
        event.detail.workspaceKey !== options.workspaceKey
      ) {
        return;
      }
      setAttachmentsState(getKnowledgeEvidenceAttachmentScope(options.sessionId, options.workspaceKey));
      setLimitReason(getKnowledgeEvidenceAttachmentLimitReason(options.sessionId, options.workspaceKey));
    };
    window.addEventListener(getKnowledgeEvidenceAddEventName(), handleAdd);
    return () => window.removeEventListener(getKnowledgeEvidenceAddEventName(), handleAdd);
  }, [options.sessionId, options.workspaceKey]);

  const removeAttachment = useCallback(
    (receiptId: string) => {
      setAttachments((current) => current.filter((item) => item.receiptId !== receiptId));
      setLimitReason(null);
    },
    [setAttachments],
  );
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setLimitReason(null);
  }, [setAttachments]);
  const dismissLimitReason = useCallback(() => {
    clearKnowledgeEvidenceAttachmentLimitReason(options.sessionId, options.workspaceKey);
    setLimitReason(null);
  }, [options.sessionId, options.workspaceKey]);

  return {
    attachments,
    limitReason,
    dismissLimitReason,
    removeAttachment,
    clearAttachments,
  };
}
