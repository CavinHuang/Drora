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
  CONVERSATION_SELECTION_MAX_COMMENT_LENGTH,
  CONVERSATION_SELECTION_MAX_TEXT_LENGTH,
  CONVERSATION_SELECTION_MAX_COUNT,
  CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
  type ConversationSelectionText,
} from "@drora/shared";

export type ConversationSelectionContentType = "user" | "assistant" | "reasoning" | "tool";

/**
 * 选区在来源行里的文字位置，只给正文内的注释标记定位用，不进入发送载荷。
 * regionIndex 是行内第几个 [data-conversation-selectable] 区域，start/end 是该区域
 * 文本节点拼接串里的字符偏移（左闭右开）。
 */
export interface ConversationSelectionTextAnchor {
  regionIndex: number;
  start: number;
  end: number;
  /**
   * 描述时 Range.toString() 去空白后的文字，还原时用同一口径校验。
   * 不能拿 Selection.toString() 比：它会跳过 select-none 节点（如表格工具栏），
   * 跨单元格框选时与 Range 文本不一致，标记会被静默丢掉。
   */
  rangeText?: string;
}

export interface MessageSelectionReference extends ConversationSelectionText {
  id: string;
  sourceSessionId: string;
  sourceRowId: number;
  contentType: ConversationSelectionContentType;
  /** 仅渲染层使用的定位信息；缺失（旧引用、无法定位）时正文不画标记，chip 照常。 */
  anchor?: ConversationSelectionTextAnchor;
}

export interface MarkdownSelectionReference extends ConversationSelectionText {
  id: string;
  contentType: "markdown";
  sourceKey: string;
  sourceTitle: string;
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
const KNOWLEDGE_CITATION_OPEN_EVENT = "drora:knowledge-citation-open";

export type KnowledgeCitationOpenResult =
  | { ok: true }
  | {
      ok: false;
      /** unavailable：插件面板不在场（未启用/投影缺席/bridge 缺席）——P7 后唯一空态终态。 */
      reason: "unavailable" | "stale" | "missing" | "forbidden" | "failed";
    };

export interface KnowledgeCitationOpenEventDetail {
  targetSessionId: string;
  workspaceKey: string;
  receiptId: string;
  /** Set immediately by exactly one citation-open consumer to acknowledge ownership. */
  accepted: boolean;
  /** Turns false on completion or timeout; async handlers must check before navigation. */
  isActive: () => boolean;
  /** Claim a one-time wait while the matching workspace lazily mounts the panel consumer. */
  deferUntilMounted: () => boolean;
  /** Re-dispatch the same active request after the consumer installed its resolver listener. */
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

const USER_SELECT_KEYS = new Set(["text", "path", "comment", "agent"]);
const USER_SELECT_BLOCK_PATTERN = /(?:\n\n)?# userselect:\n```userselect\n([\s\S]*?)\n```\s*$/;
const LEGACY_BLOCK_PATTERN =
  /(?:\n\n)?# Conversation selections:\n```drora-conversation-selections\n([\s\S]*?)\n```\s*$/;
const EDIT_EVENT = "drora:conversation-selection-edit";
const referencesByScope = new Map<string, readonly ConversationSelectionReference[]>();
const limitReasonByScope = new Map<string, ConversationSelectionLimitReason>();
/** 已随消息发出的注释（含锚点），只用于正文里画灰色“已发送”标记；不持久化，刷新后消失。 */
const sentReferencesByScope = new Map<string, readonly ConversationSelectionReference[]>();
const SENT_REFERENCES_MAX = 32;
const scopeListeners = new Set<() => void>();
const EMPTY_REFERENCES: readonly ConversationSelectionReference[] = [];

function notifyScopeListeners(): void {
  // setConversationSelectionReferenceScope 会在 React 的 setState updater（渲染阶段）里被调用；
  // 同步通知订阅者会在渲染别的组件时触发它们的更新，必须推迟到微任务。
  queueMicrotask(() => {
    for (const listener of scopeListeners) listener();
  });
}

/** 订阅任一引用作用域的变化（composer 删除 chip、正文标记编辑/删除、发送清空都会触发）。 */
export function subscribeConversationSelectionReferenceScopes(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

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
    // 与旧行为一致，不抛错）。P7 后 markdown 引用不再携带 evidenceReceiptId/
    // evidenceSource（C5b 生产端拆除），历史存储中的残留字段按条丢弃。
    const references = persisted.filter(
      (item): item is ConversationSelectionReference =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { contentType?: unknown }).contentType === "string" &&
        typeof (item as { text?: unknown }).text === "string" &&
        (item as { evidenceReceiptId?: unknown }).evidenceReceiptId === undefined &&
        (item as { evidenceSource?: unknown }).evidenceSource === undefined,
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
  notifyScopeListeners();
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
  sentReferencesByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  notifyScopeListeners();
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
  const existingIndex = current.findIndex(
    (item) => getConversationSelectionDedupeKey(item) === key,
  );
  if (existingIndex >= 0) {
    // 对已注释的同一段再次写评论时更新原条目，不能被去重静默吞掉；不带评论的重复注释不覆盖已有评论。
    const existing = current[existingIndex];
    if (!reference.comment || !existing || existing.comment === reference.comment) {
      return { ok: true, references: current, duplicate: true };
    }
    const references = current.map((item, index) =>
      index === existingIndex ? { ...item, comment: reference.comment } : item,
    );
    return { ok: true, references, duplicate: true };
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

// P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C5b/C6）：
// drora:knowledge-agent-handoff 窗口事件与 collectConversationEvidenceRefs
// （发送链 evidenceRefs 生产端）已随 VaultView 生产面拆除——插件面板的 handoff 走
// g9 `drora/openConversationHandoff`（pluginUiModelContext 既有通道），发送链不再
// 携带 wire 证据引用（evidenceRefs 字段 deprecated，旧账本带 refs 条目由 CLI
// legacy 探测器 fail-closed 拒绝）。

export function parsePromptConversationSelections(text: string): {
  visibleContent: string;
  references: readonly ConversationSelectionDisplayReference[];
} {
  const userSelectMatch = text.match(USER_SELECT_BLOCK_PATTERN);
  if (userSelectMatch) {
    return parseConversationSelectionBlock(text, userSelectMatch, (value) => {
      if (!isConversationSelectionText(value)) return null;
      // 与发送合同一致，历史保留文件路径、评论与 agent 来源，普通对话继续只恢复正文。
      return {
        ...(value.path ? { path: value.path } : {}),
        text: value.text,
        ...(value.agent ? { agent: value.agent } : {}),
        ...(value.comment ? { comment: value.comment } : {}),
      };
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
    (!("comment" in value) || typeof candidate.comment === "string") &&
    (!("agent" in value) || typeof candidate.agent === "string") &&
    Object.keys(value).every((key) => USER_SELECT_KEYS.has(key))
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

/**
 * rewind（edit/retry/回滚）删除来源行后，带评论的注释失去所指回答，必须随之删除。
 * rowId 在 session 内单调且不复用，因此已加载窗口内缺失的来源行就是被删除的行；
 * 窗口之前尚未分页加载的历史不能当作已删除。不带评论的注释是冻结文字，保持原行为不删。
 */
export function retainSelectionCommentsWithLiveSource(
  references: readonly ConversationSelectionReference[],
  sourceSessionId: string,
  rows: { window: readonly { rowId: number }[]; firstRowId: number | null },
): readonly ConversationSelectionReference[] {
  const liveRowIds = new Set(rows.window.map((row) => row.rowId));
  const windowStart = rows.window.reduce<number | null>(
    (min, row) => (min === null ? row.rowId : Math.min(min, row.rowId)),
    null,
  );
  // 整个活动分支被回滚时窗口为空且 firstRowId 归零；仍有 firstRowId 的空窗口无法判断，保守保留。
  if (windowStart === null && rows.firstRowId !== null) return references;
  const next = references.filter(
    (reference) =>
      reference.contentType === "markdown" ||
      !reference.comment?.trim() ||
      reference.sourceSessionId !== sourceSessionId ||
      (windowStart !== null && reference.sourceRowId < windowStart) ||
      liveRowIds.has(reference.sourceRowId),
  );
  return next.length === references.length ? references : next;
}

/** 修改作用域内一条注释的评论；空评论表示回到“只保留原文”，不会删除这条注释。 */
export function updateConversationSelectionCommentInScope(
  sessionId: string | null,
  workspaceKey: string,
  id: string,
  comment: string,
  draftScopeKey?: string,
): void {
  const current = getConversationSelectionReferenceScope(sessionId, workspaceKey, draftScopeKey);
  const trimmed = comment.trim();
  let changed = false;
  const next = current.map((reference) => {
    if (reference.id !== id || (reference.comment ?? "") === trimmed) return reference;
    changed = true;
    const { comment: _previous, ...rest } = reference;
    return (trimmed ? { ...rest, comment: trimmed } : rest) as ConversationSelectionReference;
  });
  if (changed) setConversationSelectionReferenceScope(sessionId, workspaceKey, next, draftScopeKey);
}

export interface RemovedConversationSelectionReference {
  reference: ConversationSelectionReference;
  index: number;
}

/** 从作用域删除一条注释，返回原位置供撤销；composer chip 与正文标记共用，保证两边同一份数据。 */
export function removeConversationSelectionReferenceFromScope(
  sessionId: string | null,
  workspaceKey: string,
  id: string,
  draftScopeKey?: string,
): RemovedConversationSelectionReference | null {
  const current = getConversationSelectionReferenceScope(sessionId, workspaceKey, draftScopeKey);
  const index = current.findIndex((reference) => reference.id === id);
  const reference = current[index];
  if (index < 0 || !reference) return null;
  setConversationSelectionReferenceScope(
    sessionId,
    workspaceKey,
    current.filter((item) => item.id !== id),
    draftScopeKey,
  );
  return { reference, index };
}

/**
 * 撤销删除：放回原位置，其余编号随之恢复。撤销窗口内用户可能又加了注释，
 * 仍按追加规则校验条数与总长，超限时放弃撤销而不是挤掉别的注释。
 */
export function restoreConversationSelectionReferenceInScope(
  sessionId: string | null,
  workspaceKey: string,
  removed: RemovedConversationSelectionReference,
  draftScopeKey?: string,
): boolean {
  const current = getConversationSelectionReferenceScope(sessionId, workspaceKey, draftScopeKey);
  const appended = appendConversationSelectionReference(current, removed.reference);
  if (!appended.ok) return false;
  if (appended.duplicate) return true;
  const next = [...current];
  next.splice(Math.min(removed.index, next.length), 0, removed.reference);
  setConversationSelectionReferenceScope(sessionId, workspaceKey, next, draftScopeKey);
  return true;
}

/** 消息发出后记下这批注释，正文里改画中性灰的“已发送”标记。 */
export function recordSentConversationSelections(
  sessionId: string,
  workspaceKey: string,
  references: readonly ConversationSelectionReference[],
): void {
  const anchored = references.filter(
    (reference) => reference.contentType !== "markdown" && reference.anchor,
  );
  if (anchored.length === 0) return;
  const key = referenceScopeKey(sessionId, workspaceKey);
  const sentIds = new Set(anchored.map((reference) => reference.id));
  const previous = (sentReferencesByScope.get(key) ?? []).filter(
    (reference) => !sentIds.has(reference.id),
  );
  sentReferencesByScope.set(key, [...previous, ...anchored].slice(-SENT_REFERENCES_MAX));
  notifyScopeListeners();
}

export function getSentConversationSelections(
  sessionId: string,
  workspaceKey: string,
): readonly ConversationSelectionReference[] {
  return sentReferencesByScope.get(referenceScopeKey(sessionId, workspaceKey)) ?? EMPTY_REFERENCES;
}

interface ConversationSelectionEditEventDetail {
  /** 同一会话分屏时多个时间线都在监听，第一个打开浮层的置 true，其余跳过。 */
  handled?: boolean;
  sessionId: string;
  workspaceKey: string;
  id: string;
  /** 正文标记不可见（行未挂载、锚点失效）时，编辑浮层退回指向这个位置。 */
  fallback: { center: number; top: number; bottom: number };
}

/** composer 注释列表点铅笔/“添加评论”：请求时间线在正文编号处打开编辑浮层。 */
export function dispatchConversationSelectionEdit(
  detail: ConversationSelectionEditEventDetail,
): void {
  window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail }));
}

export function subscribeConversationSelectionEdit(
  listener: (detail: ConversationSelectionEditEventDetail) => void,
): () => void {
  const handle = (event: Event) => {
    if (event instanceof CustomEvent)
      listener(event.detail as ConversationSelectionEditEventDetail);
  };
  window.addEventListener(EDIT_EVENT, handle);
  return () => window.removeEventListener(EDIT_EVENT, handle);
}

let hoveredAnnotationId: string | null = null;
const hoverListeners = new Set<(id: string | null) => void>();

/** 列表行与正文气泡互相高亮：任一侧悬停都写同一个 id。 */
export function setHoveredConversationAnnotation(id: string | null): void {
  if (hoveredAnnotationId === id) return;
  hoveredAnnotationId = id;
  for (const listener of hoverListeners) listener(id);
}

export function subscribeHoveredConversationAnnotation(
  listener: (id: string | null) => void,
): () => void {
  hoverListeners.add(listener);
  listener(hoveredAnnotationId);
  return () => {
    hoverListeners.delete(listener);
  };
}
