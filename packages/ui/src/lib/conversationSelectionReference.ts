/* eslint-disable max-lines -- 引用 scope（内存 Map + D-4 持久化快照/懒水合）与增删/去重/序列化
 * 纯函数是同一引用模型的两半（持久化键与 scope 键共享 referenceScopeKey 语义），拆文件会
 * 割裂唯一状态所有者（与 KnowledgeReviewView.tsx / reviewEngine.ts 同先例）。 */
import {
  createUuid,
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  CONVERSATION_SELECTION_MAX_COUNT,
  CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
  type ConversationSelectionText,
} from "@drora/shared";
import { logger } from "../logger.js";

export {
  buildPromptWithConversationSelections,
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  CONVERSATION_SELECTION_MAX_COUNT,
  CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
  type ConversationSelectionText,
} from "@drora/shared";

export type ConversationSelectionContentType = "user" | "assistant" | "reasoning" | "tool";

export interface MessageSelectionReference extends ConversationSelectionText {
  id: string;
  sourceSessionId: string;
  sourceRowId: number;
  contentType: ConversationSelectionContentType;
}

export interface MarkdownSelectionReference extends ConversationSelectionText {
  id: string;
  contentType: "markdown";
  sourceKey: string;
  sourceTitle: string;
  /** Renderer-only: opaque server-issued receipt; never serialize into the model-facing userselect block. */
  evidenceReceiptId?: string;
  /** Renderer-only numbered source label; never included in the model-facing userselect block. */
  evidenceSource?: import("./conversationKnowledgeSources.js").KnowledgeDraftSource;
}

export type ConversationSelectionReference = MessageSelectionReference | MarkdownSelectionReference;

export interface MarkdownSelectionTarget {
  sessionId: string | null;
  workspaceKey: string;
  draftScopeKey?: string;
}

export type ConversationSelectionDisplayReference =
  | ConversationSelectionText
  | ConversationSelectionReference;

interface ConversationSelectionAddEventDetail {
  targetSessionId: string | null;
  draftScopeKey?: string;
  workspaceKey: string;
  reference: ConversationSelectionReference;
  result?: ConversationSelectionAppendResult;
}

export type ConversationSelectionLimitReason = "count" | "single" | "total";
export type ConversationSelectionAppendResult =
  | {
      ok: true;
      references: readonly ConversationSelectionReference[];
      duplicate: boolean;
    }
  | { ok: false; reason: ConversationSelectionLimitReason };

const ADD_EVENT = "drora:conversation-selection-add";
const KNOWLEDGE_HANDOFF_EVENT = "drora:knowledge-agent-handoff";
const KNOWLEDGE_CITATION_OPEN_EVENT = "drora:knowledge-citation-open";

export type KnowledgeCitationOpenResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "stale" | "missing" | "forbidden" | "failed" };

export interface KnowledgeCitationOpenEventDetail {
  targetSessionId: string;
  workspaceKey: string;
  receiptId: string;
  /** Set immediately by exactly one active VaultView to acknowledge ownership. */
  accepted: boolean;
  /** Turns false on completion or timeout; async Vault handlers must check before navigation. */
  isActive: () => boolean;
  /** Claim a one-time wait while the matching workspace lazily mounts VaultView. */
  deferUntilMounted: () => boolean;
  /** Re-dispatch the same active request after VaultView installed its resolver listener. */
  retryAfterMount: () => boolean;
  finish: (result: KnowledgeCitationOpenResult) => void;
}

/** A hung Vault RPC must not leave a permanent spinner or authorize a late navigation. */
export const KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS = 15_000;
const pendingCitationOpens = new Map<string, Promise<KnowledgeCitationOpenResult>>();

/**
 * The only navigation capability is the opaque Receipt, freshly resolved by
 * VaultView. Identical rapid clicks share one in-flight RPC; every request
 * settles even when the Vault accepts but never responds.
 */
export function requestKnowledgeCitationOpen(input: {
  targetSessionId: string;
  workspaceKey: string;
  receiptId: string;
}): Promise<KnowledgeCitationOpenResult> {
  if (!input.targetSessionId.trim() || !input.workspaceKey.trim() || !input.receiptId.trim()) {
    return Promise.resolve({ ok: false, reason: "unavailable" });
  }
  const key = [input.workspaceKey, input.targetSessionId, input.receiptId].join("\0");
  const pending = pendingCitationOpens.get(key);
  if (pending) return pending;

  const request = new Promise<KnowledgeCitationOpenResult>((resolve) => {
    let active = true;
    let deferredUntilMounted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let detail: KnowledgeCitationOpenEventDetail;
    const finish = (result: KnowledgeCitationOpenResult): void => {
      if (!active) return;
      active = false;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(result);
    };
    const ensureTimeout = (): void => {
      if (!active || timeout !== undefined) return;
      timeout = setTimeout(
        () => finish({ ok: false, reason: "failed" }),
        KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS,
      );
    };
    const dispatch = (): void => {
      if (!active) return;
      detail.accepted = false;
      try {
        window.dispatchEvent(new CustomEvent(KNOWLEDGE_CITATION_OPEN_EVENT, { detail }));
      } catch {
        finish({ ok: false, reason: "failed" });
        return;
      }
      if (detail.accepted || deferredUntilMounted) ensureTimeout();
      else finish({ ok: false, reason: "unavailable" });
    };
    detail = {
      ...input,
      accepted: false,
      isActive: () => active,
      deferUntilMounted: () => {
        if (!active || detail.accepted || deferredUntilMounted) return false;
        deferredUntilMounted = true;
        ensureTimeout();
        return true;
      },
      retryAfterMount: () => {
        if (!active || !deferredUntilMounted) return false;
        deferredUntilMounted = false;
        dispatch();
        return true;
      },
      finish,
    };
    dispatch();
  });
  pendingCitationOpens.set(key, request);
  void request.then(() => {
    if (pendingCitationOpens.get(key) === request) pendingCitationOpens.delete(key);
  });
  return request;
}

export function getKnowledgeCitationOpenEventName(): string {
  return KNOWLEDGE_CITATION_OPEN_EVENT;
}

export function isKnowledgeCitationOpenEvent(
  event: Event,
): event is CustomEvent<KnowledgeCitationOpenEventDetail> {
  return event.type === KNOWLEDGE_CITATION_OPEN_EVENT && event instanceof CustomEvent;
}

export type KnowledgeAgentHandoffResult =
  | ConversationSelectionAppendResult
  | { ok: false; reason: "unavailable" | "draft-not-empty" };

export interface KnowledgeAgentHandoffEventDetail {
  targetSessionId: string;
  workspaceKey: string;
  prompt: string;
  references: readonly MarkdownSelectionReference[];
  /** Synchronous acknowledgment from the session-scoped, mounted composer. */
  result?: KnowledgeAgentHandoffResult;
}
const USER_SELECT_BLOCK_PATTERN = /(?:\n\n)?# userselect:\n```userselect\n([\s\S]*?)\n```\s*$/;
const LEGACY_BLOCK_PATTERN =
  /(?:\n\n)?# Conversation selections:\n```drora-conversation-selections\n([\s\S]*?)\n```\s*$/;
const referencesByScope = new Map<string, readonly ConversationSelectionReference[]>();
const limitReasonByScope = new Map<string, ConversationSelectionLimitReason>();

function referenceScopeKey(
  sessionId: string | null,
  workspaceKey: string,
  draftScopeKey?: string,
): string {
  return `${workspaceKey}\0${sessionId ?? (draftScopeKey ? `__draft__:${draftScopeKey}` : "__draft__")}`;
}

/**
 * D-4 修复（2026-10-17 增量评审）：引用快照与草稿文本同为用户未提交输入，必须同生命周期。
 * 此前 receipt 引用只存模块级内存 Map，而草稿文本（含来源清单表头）跨刷新持久化——
 * renderer 重载后文本恢复、引用清零，manifest 校验判 mismatch、发送被永久禁用且无恢复
 * 入口。现在引用随每次 scope 写入 write-through 到 localStorage（per-workspace 键空间，
 * 与 composerDraftStore 同模式），读取 miss 时懒水合。
 * 安全性：水合的引用与内存引用同信任级——receipt 在点击（resolveCitation）与发送
 * （CLI admission/queue promotion）时都会被服务端按 session/workspace/turn 重新复验，
 * 过期收据得到结构化 SEND_FAILED（可重新准备），伪造 localStorage 无任何收益。
 */
const REFERENCE_STORAGE_PREFIX = "drora-v4-selection-references:v1:";
const warnedReferenceStorageKeys = new Set<string>();

interface PersistedReferenceFile {
  version: 1;
  scopes: Record<string, readonly ConversationSelectionReference[]>;
}

function referenceStorageKey(workspaceKey: string): string {
  return `${REFERENCE_STORAGE_PREFIX}${encodeURIComponent(workspaceKey)}`;
}

function warnReferenceStorageFailure(key: string, error: unknown): void {
  if (warnedReferenceStorageKeys.has(key)) return;
  warnedReferenceStorageKeys.add(key);
  logger.warn("[conversation-selection] 引用快照持久化访问失败", {
    error: error instanceof Error ? error.message : String(error),
    key,
  });
}

function readPersistedReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
): readonly ConversationSelectionReference[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(referenceStorageKey(workspaceKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      typeof (parsed as { scopes?: unknown }).scopes !== "object" ||
      (parsed as { scopes?: unknown }).scopes === null
    ) {
      return null;
    }
    const persisted = (parsed as PersistedReferenceFile).scopes[sessionId ?? "__draft__"];
    if (!Array.isArray(persisted)) return null;
    // 形状守卫：只收 contentType/text 齐全的条目；坏存储整批丢弃（回落无引用态，
    // 与旧行为一致，不抛错）。
    // ui-lib-b-1 补强（2026-10-18 终审）：evidenceReceiptId / evidenceSource 是渲染器
    // 私有可信元数据的入口，形状不符（number 化 receipt、字符串化 source 等）时不能
    // 流入 manifest 校验与发送链——按条丢弃，与坏存储同处置。
    const references = persisted.filter(
      (item): item is ConversationSelectionReference =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { contentType?: unknown }).contentType === "string" &&
        typeof (item as { text?: unknown }).text === "string" &&
        ((item as { evidenceReceiptId?: unknown }).evidenceReceiptId === undefined ||
          typeof (item as { evidenceReceiptId?: unknown }).evidenceReceiptId === "string") &&
        ((item as { evidenceSource?: unknown }).evidenceSource === undefined ||
          (typeof (item as { evidenceSource?: unknown }).evidenceSource === "object" &&
            (item as { evidenceSource?: unknown }).evidenceSource !== null)),
    );
    return references.length > 0 ? references : [];
  } catch (error) {
    warnReferenceStorageFailure(referenceStorageKey(workspaceKey), error);
    return null;
  }
}

function writePersistedReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
  references: readonly ConversationSelectionReference[] | null,
): void {
  if (typeof window === "undefined") return;
  const storageKey = referenceStorageKey(workspaceKey);
  try {
    const scopeId = sessionId ?? "__draft__";
    let base: PersistedReferenceFile = { version: 1, scopes: {} };
    const raw = window.localStorage.getItem(storageKey);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { version?: unknown }).version === 1 &&
        typeof (parsed as { scopes?: unknown }).scopes === "object" &&
        (parsed as { scopes?: unknown }).scopes !== null
      ) {
        base = parsed as PersistedReferenceFile;
      }
    }
    if (!base.scopes || typeof base.scopes !== "object") base.scopes = {};
    if (references === null || references.length === 0) delete base.scopes[scopeId];
    else base.scopes[scopeId] = references;
    if (Object.keys(base.scopes).length === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(base));
    // ui-lib-a-3 对齐（2026-10-18 终审）：写入成功即清去重标记（与 composerDraftStore
    // 同模式），避免一次瞬时故障把该 workspace 的存储告警永久静默、故障恢复后也不再上报。
    warnedReferenceStorageKeys.delete(storageKey);
  } catch (error) {
    warnReferenceStorageFailure(storageKey, error);
  }
}

export function getConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
  draftScopeKey?: string,
): readonly ConversationSelectionReference[] {
  const key = referenceScopeKey(sessionId, workspaceKey, draftScopeKey);
  if (referencesByScope.has(key)) return referencesByScope.get(key)!;
  // 懒水合：重载后首次读取从持久化快照恢复（D-4）。
  const persisted = readPersistedReferenceScope(sessionId, workspaceKey);
  if (persisted === null || persisted.length === 0) return [];
  referencesByScope.set(key, persisted);
  return persisted;
}

export function setConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
  references: readonly ConversationSelectionReference[],
  draftScopeKey?: string,
): void {
  const key = referenceScopeKey(sessionId, workspaceKey, draftScopeKey);
  if (references.length > 0) referencesByScope.set(key, references);
  else referencesByScope.delete(key);
  limitReasonByScope.delete(key);
  writePersistedReferenceScope(sessionId, workspaceKey, references);
}

export function getConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
  draftScopeKey?: string,
): ConversationSelectionLimitReason | null {
  return limitReasonByScope.get(referenceScopeKey(sessionId, workspaceKey, draftScopeKey)) ?? null;
}

export function clearConversationSelectionReferenceScope(
  sessionId: string,
  workspaceKey: string,
): void {
  referencesByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  writePersistedReferenceScope(sessionId, workspaceKey, null);
}

export function clearConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
  draftScopeKey?: string,
): void {
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey, draftScopeKey));
}

export function createConversationSelectionReference(
  input: Omit<MessageSelectionReference, "id"> | Omit<MarkdownSelectionReference, "id">,
): ConversationSelectionReference {
  return { ...input, id: createUuid() };
}

export function getConversationSelectionDedupeKey(
  reference: ConversationSelectionReference,
): string {
  if (reference.contentType === "markdown") {
    return ["markdown", reference.sourceKey, reference.text].join("\0");
  }
  return [
    reference.sourceSessionId,
    reference.sourceRowId,
    reference.contentType,
    reference.text,
  ].join("\0");
}

export function appendConversationSelectionReference(
  current: readonly ConversationSelectionReference[],
  reference: ConversationSelectionReference,
): ConversationSelectionAppendResult {
  if (reference.text.length > CONVERSATION_SELECTION_MAX_TEXT_LENGTH) {
    return { ok: false, reason: "single" };
  }
  const key = getConversationSelectionDedupeKey(reference);
  const duplicateIndex = current.findIndex(
    (item) => getConversationSelectionDedupeKey(item) === key,
  );
  if (duplicateIndex !== -1) {
    const existing = current[duplicateIndex];
    // A reverified receipt must replace the stale one even when the visible quote is identical.
    if (
      reference.contentType === "markdown" &&
      reference.evidenceReceiptId &&
      existing?.contentType === "markdown" &&
      existing.evidenceReceiptId !== reference.evidenceReceiptId
    ) {
      const next = [...current];
      next[duplicateIndex] = reference;
      return { ok: true, references: next, duplicate: false };
    }
    return { ok: true, references: current, duplicate: true };
  }
  if (current.length >= CONVERSATION_SELECTION_MAX_COUNT) {
    return { ok: false, reason: "count" };
  }
  const totalLength = current.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLength + reference.text.length > CONVERSATION_SELECTION_MAX_TOTAL_LENGTH) {
    return { ok: false, reason: "total" };
  }
  return { ok: true, references: [...current, reference], duplicate: false };
}

/** Validate a whole batch before mutating the composer scope; never attach only a prefix. */
export function appendConversationSelectionReferences(
  current: readonly ConversationSelectionReference[],
  references: readonly ConversationSelectionReference[],
): ConversationSelectionAppendResult {
  if (references.length === 0) return { ok: false, reason: "count" };
  let next = current;
  let duplicate = true;
  for (const reference of references) {
    const result = appendConversationSelectionReference(next, reference);
    if (!result.ok) return result;
    next = result.references;
    duplicate &&= result.duplicate;
  }
  return { ok: true, references: next, duplicate };
}

/**
 * Only an active composer can acknowledge this handoff. No session/global draft is mutated
 * when a target composer is absent, busy or already contains user-authored text.
 */
export function requestKnowledgeAgentHandoff(
  input: Omit<KnowledgeAgentHandoffEventDetail, "result">,
): KnowledgeAgentHandoffResult {
  const detail: KnowledgeAgentHandoffEventDetail = { ...input };
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_HANDOFF_EVENT, { detail }));
  return detail.result ?? { ok: false, reason: "unavailable" };
}

export function isKnowledgeAgentHandoffEvent(
  event: Event,
): event is CustomEvent<KnowledgeAgentHandoffEventDetail> {
  return event.type === KNOWLEDGE_HANDOFF_EVENT && event instanceof CustomEvent;
}

export function getKnowledgeAgentHandoffEventName(): string {
  return KNOWLEDGE_HANDOFF_EVENT;
}

/** Commit an already preflighted set of refs and notify the existing selection hook once. */
export function commitKnowledgeAgentHandoff(
  input: KnowledgeAgentHandoffEventDetail,
  result: Extract<ConversationSelectionAppendResult, { ok: true }>,
): void {
  setConversationSelectionReferenceScope(
    input.targetSessionId,
    input.workspaceKey,
    result.references,
  );
  window.dispatchEvent(
    new CustomEvent(ADD_EVENT, {
      detail: {
        targetSessionId: input.targetSessionId,
        workspaceKey: input.workspaceKey,
        reference: input.references[0],
        result,
      },
    }),
  );
}

/** Read the only trusted receipt identifiers from frozen composer selections; ordinary quotes carry none. */
export function collectConversationEvidenceRefs(
  references: readonly ConversationSelectionReference[],
): Array<{ receiptId: string }> {
  const receipts = new Set<string>();
  for (const ref of references) {
    if (ref.contentType === "markdown" && ref.evidenceReceiptId) {
      receipts.add(ref.evidenceReceiptId);
    }
  }
  return [...receipts].map((receiptId) => ({ receiptId }));
}

export function parsePromptConversationSelections(text: string): {
  visibleContent: string;
  references: readonly ConversationSelectionDisplayReference[];
} {
  const userSelectMatch = text.match(USER_SELECT_BLOCK_PATTERN);
  if (userSelectMatch) {
    return parseConversationSelectionBlock(text, userSelectMatch, (value) => {
      if (!isConversationSelectionText(value)) return null;
      // 与发送合同一致，历史保留文件路径，普通对话继续只恢复正文。
      return value.path ? { path: value.path, text: value.text } : { text: value.text };
    });
  }
  const legacyMatch = text.match(LEGACY_BLOCK_PATTERN);
  if (!legacyMatch) return { visibleContent: text, references: [] };
  return parseConversationSelectionBlock(text, legacyMatch, (value) =>
    isConversationSelectionReference(value) ? value : null,
  );
}

function parseConversationSelectionBlock<T extends ConversationSelectionDisplayReference>(
  text: string,
  match: RegExpMatchArray,
  parseItem: (value: unknown) => T | null,
): { visibleContent: string; references: readonly T[] } {
  try {
    const parsed = JSON.parse(match[1] ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("selection block is not an array");
    const references: T[] = [];
    for (const value of parsed) {
      const reference = parseItem(value);
      if (!reference) throw new Error("invalid selection reference");
      references.push(reference);
    }
    return {
      visibleContent: text.slice(0, match.index).trimEnd(),
      references,
    };
  } catch {
    return { visibleContent: text, references: [] };
  }
}

export function dispatchConversationSelectionAdd(
  detail: Omit<ConversationSelectionAddEventDetail, "result">,
): ConversationSelectionAppendResult {
  const current = getConversationSelectionReferenceScope(
    detail.targetSessionId,
    detail.workspaceKey,
    detail.draftScopeKey,
  );
  const result = appendConversationSelectionReference(current, detail.reference);
  if (result.ok) {
    setConversationSelectionReferenceScope(
      detail.targetSessionId,
      detail.workspaceKey,
      result.references,
      detail.draftScopeKey,
    );
  } else {
    limitReasonByScope.set(
      referenceScopeKey(detail.targetSessionId, detail.workspaceKey, detail.draftScopeKey),
      result.reason,
    );
  }
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: { ...detail, result } }));
  return result;
}

export function isConversationSelectionAddEvent(
  event: Event,
): event is CustomEvent<ConversationSelectionAddEventDetail> {
  return event.type === ADD_EVENT && event instanceof CustomEvent;
}

export function getConversationSelectionAddEventName(): string {
  return ADD_EVENT;
}

function isConversationSelectionText(value: unknown): value is ConversationSelectionText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ConversationSelectionText>;
  return (
    typeof candidate.text === "string" &&
    (!("path" in value) ||
      (typeof candidate.path === "string" && candidate.path.trim().length > 0)) &&
    Object.keys(value).every((key) => key === "text" || key === "path")
  );
}

export function isConversationSelectionReference(
  value: unknown,
): value is ConversationSelectionReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConversationSelectionReference>;
  if (candidate.contentType === "markdown") {
    return (
      typeof candidate.id === "string" &&
      typeof candidate.text === "string" &&
      typeof candidate.sourceKey === "string" &&
      typeof candidate.sourceTitle === "string"
    );
  }
  return (
    typeof candidate.id === "string" &&
    "sourceSessionId" in candidate &&
    typeof candidate.sourceSessionId === "string" &&
    "sourceRowId" in candidate &&
    typeof candidate.sourceRowId === "number" &&
    typeof candidate.text === "string" &&
    ["user", "assistant", "reasoning", "tool"].includes(candidate.contentType ?? "")
  );
}
