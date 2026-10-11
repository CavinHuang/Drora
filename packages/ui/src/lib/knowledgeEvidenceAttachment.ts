/**
 * VaultView Evidence 附件区（W09 / specs/obsidian-knowledge.md §5f.1）：
 * 「核验」产生的 receipt（prepareEvidence 签发、绑定 sessionId）经「作为证据附给
 * Agent」进入目标会话 composer 的证据附件区，发送时以 evidenceRefs:[{receiptId}]
 * 随 sendText payload 提交（admission 固定进 intent，队列提升时 CLI gate 复验）。
 *
 * 与 conversationSelectionReference 同一套 scope 存储 + CustomEvent 模式：
 * - scope key = workspaceKey + sessionId（跨会话调度复用同一作用域模型）；
 * - 上限 = 契约 MAX_EVIDENCE_REFS_PER_INPUT（8），按 receiptId 去重；
 * - 只存展示所需的最小字段（receiptId 短形/路径/quote 摘要），不存笔记全文。
 *
 * 边界（如实）：附件区不做发送前预检；stale/cross_session/forbidden 由 CLI gate 在
 * admission/提升时裁决——UI 文案必须写明「发送时复验」。
 */
import { MAX_EVIDENCE_REFS_PER_INPUT } from "@drora/shared";

/** 附件区条目：只携带 composer chip 展示与发送所需的最小字段。 */
export interface KnowledgeEvidenceAttachment {
  receiptId: string;
  /** 笔记相对路径（展示用；复验事实在服务端账本，不信任本字段）。 */
  relativePath: string;
  /** quote 摘要（截断后），chip Tooltip 展示。 */
  quoteExcerpt: string;
  /** 候选展示标题。 */
  title: string;
}

export type KnowledgeEvidenceLimitReason = "count";

interface KnowledgeEvidenceAddEventDetail {
  targetSessionId: string | null;
  workspaceKey: string;
  attachment: KnowledgeEvidenceAttachment;
  result?: KnowledgeEvidenceAppendResult;
}

export type KnowledgeEvidenceAppendResult =
  | { ok: true; attachments: readonly KnowledgeEvidenceAttachment[]; duplicate: boolean }
  | { ok: false; reason: KnowledgeEvidenceLimitReason };

const ADD_EVENT = "drora:knowledge-evidence-attachment-add";

const attachmentsByScope = new Map<string, readonly KnowledgeEvidenceAttachment[]>();
const limitReasonByScope = new Map<string, KnowledgeEvidenceLimitReason>();

function evidenceScopeKey(sessionId: string | null, workspaceKey: string): string {
  return `${workspaceKey}\0${sessionId ?? "__draft__"}`;
}

export function getKnowledgeEvidenceAttachmentScope(
  sessionId: string | null,
  workspaceKey: string,
): readonly KnowledgeEvidenceAttachment[] {
  return attachmentsByScope.get(evidenceScopeKey(sessionId, workspaceKey)) ?? [];
}

export function setKnowledgeEvidenceAttachmentScope(
  sessionId: string | null,
  workspaceKey: string,
  attachments: readonly KnowledgeEvidenceAttachment[],
): void {
  const key = evidenceScopeKey(sessionId, workspaceKey);
  if (attachments.length > 0) attachmentsByScope.set(key, attachments);
  else attachmentsByScope.delete(key);
  limitReasonByScope.delete(key);
}

export function getKnowledgeEvidenceAttachmentLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): KnowledgeEvidenceLimitReason | null {
  return limitReasonByScope.get(evidenceScopeKey(sessionId, workspaceKey)) ?? null;
}

export function clearKnowledgeEvidenceAttachmentLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): void {
  limitReasonByScope.delete(evidenceScopeKey(sessionId, workspaceKey));
}

/** 纯函数（导出供 node:test 直接回归，绕开 window 依赖）：去重 + 上限判定。 */
export function appendKnowledgeEvidenceAttachment(
  current: readonly KnowledgeEvidenceAttachment[],
  attachment: KnowledgeEvidenceAttachment,
): KnowledgeEvidenceAppendResult {
  if (current.some((item) => item.receiptId === attachment.receiptId)) {
    return { ok: true, attachments: current, duplicate: true };
  }
  if (current.length >= MAX_EVIDENCE_REFS_PER_INPUT) {
    return { ok: false, reason: "count" };
  }
  return { ok: true, attachments: [...current, attachment], duplicate: false };
}

export function dispatchKnowledgeEvidenceAttachmentAdd(detail: {
  targetSessionId: string | null;
  workspaceKey: string;
  attachment: KnowledgeEvidenceAttachment;
}): KnowledgeEvidenceAppendResult {
  const current = getKnowledgeEvidenceAttachmentScope(
    detail.targetSessionId,
    detail.workspaceKey,
  );
  const result = appendKnowledgeEvidenceAttachment(current, detail.attachment);
  if (result.ok) {
    setKnowledgeEvidenceAttachmentScope(
      detail.targetSessionId,
      detail.workspaceKey,
      result.attachments,
    );
  } else {
    limitReasonByScope.set(evidenceScopeKey(detail.targetSessionId, detail.workspaceKey), result.reason);
  }
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: { ...detail, result } }));
  return result;
}

export function getKnowledgeEvidenceAddEventName(): string {
  return ADD_EVENT;
}

export function isKnowledgeEvidenceAddEvent(
  event: Event,
): event is CustomEvent<KnowledgeEvidenceAddEventDetail> {
  return event instanceof CustomEvent && event.type === ADD_EVENT;
}

/** 发送 payload 用：契约只收 opaque receiptId。 */
export function toEvidenceRefPayload(
  attachments: readonly KnowledgeEvidenceAttachment[],
): ReadonlyArray<{ receiptId: string }> {
  return attachments.map((attachment) => ({ receiptId: attachment.receiptId }));
}
