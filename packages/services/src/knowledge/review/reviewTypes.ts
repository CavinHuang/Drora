/**
 * Knowledge 审核写入共享 DTO（W06 / specs/obsidian-knowledge.md §5e）。
 *
 * 单一出处：本文件是 knowledge-review channel 上往返 DTO 与状态机词表的唯一定义处
 * （与 knowledgeTypes.ts 同形），经 services index.ts 以纯类型导出（根 index 会被
 * renderer 拉进浏览器包，禁止携带实现值）。
 *
 * 行为契约：L2 治理写必须走 Proposal → 人工批准 → 账本执行；未批准/过期批准/
 * revision 或 epoch 失配/撤权一律结构化拒绝，绝不写文件（ADR #8）。
 */

/** 变更种类：write=覆盖既有文件（须 baseSha256）、create=独占新建、delete=删除。 */
export type KnowledgeReviewChangeKind = "write" | "create" | "delete";

/** 提案变更输入。L3 类操作（隐藏路径/非 .md/目录/超 2MB）在形状校验层不可表达。 */
export interface KnowledgeReviewChangeInput {
  kind: KnowledgeReviewChangeKind;
  relativePath: string;
  /** write/delete 必填：提案所依据的当前版本；create 必须缺省（不存在才可建）。 */
  baseSha256?: string | null;
  /** write/create 必填：精确目标内容（不是指令）；delete 不得携带。 */
  content?: string;
}

/** 来源证据：审批人核对「为什么改」的上下文；不构成写授权。 */
export interface KnowledgeReviewEvidenceInput {
  /** 关联的 EvidenceReceipt（W03）；仅记录 id，服务不复验其 current 性。 */
  receiptId?: string | null;
  /** 文字说明（如「来自某次问答的结论」）。 */
  note?: string;
}

/** 提案变更视图（不含目标内容全文——全文走 getProposalChangeContent，防 RPC 面膨胀）。 */
export interface KnowledgeReviewChangeView {
  kind: KnowledgeReviewChangeKind;
  relativePath: string;
  baseSha256: string | null;
  /** 精确目标内容的 sha256（write/create，可先算不必先写）；delete 为 null。 */
  nextSha256: string | null;
  /** 目标内容字节数；delete 为 null。 */
  sizeBytes: number | null;
}

export interface KnowledgeReviewEvidenceView {
  receiptId: string | null;
  note: string | null;
}

export interface KnowledgeReviewProposalView {
  proposalId: string;
  /** 创建时绑定的目标源；切库后本提案对当前 vault 不可见。 */
  vaultId: string;
  title: string;
  reason: string;
  /** 从 1 起单调递增；changes/标题/理由/证据的任何修订都 +1。 */
  revision: number;
  /** 当前 changes 的规范序列化 sha256；批准绑定本值。 */
  changesHash: string;
  changes: KnowledgeReviewChangeView[];
  evidence: KnowledgeReviewEvidenceView[];
  rejected: boolean;
  /** 当前 revision 的批准；不存在或属于旧 revision 时为 null。 */
  approval: KnowledgeReviewApprovalView | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface KnowledgeReviewApprovalView {
  proposalId: string;
  revision: number;
  changesHash: string;
  sourceEpoch: number;
  approvedAtMs: number;
  expiresAtMs: number;
  /** 读取时刻是否已过期（ 过期批准绝不写文件，A32）。 */
  expired: boolean;
}

/** Operation（一次 apply 执行）状态机：prepared → applying → applied/conflict/uncertain。 */
export type KnowledgeReviewOperationStatus =
  | "prepared"
  | "applying"
  | "applied"
  | "conflict"
  | "uncertain";

/**
 * per-file 状态：prepared=未尝试；applying=写入中（崩溃后由 reconcile 落定）；
 * applied=已落盘；conflict=base/CAS 失配；not_landed=reconcile 证实目标不在盘上
 * （回到可显式重放状态——服务绝不自动重放）；undo_applied/undo_conflict=逆操作结果。
 */
export type KnowledgeReviewFileStatus =
  | "prepared"
  | "applying"
  | "applied"
  | "conflict"
  | "not_landed"
  | "undo_applied"
  | "undo_conflict";

export interface KnowledgeReviewOperationFileView {
  relativePath: string;
  kind: KnowledgeReviewChangeKind;
  baseSha256: string | null;
  nextSha256: string | null;
  /** 写前快照（先保护快照后落盘）；未执行到快照阶段为 null。 */
  snapshotSha256: string | null;
  status: KnowledgeReviewFileStatus;
  error: string | null;
}

export interface KnowledgeReviewOperationView {
  operationId: string;
  proposalId: string;
  revision: number;
  vaultId: string;
  sourceEpoch: number;
  status: KnowledgeReviewOperationStatus;
  files: KnowledgeReviewOperationFileView[];
  createdAtMs: number;
  finishedAtMs: number | null;
  reconciledAtMs: number | null;
  error: string | null;
}

/** applyProposal 结构化结果（业务态不抛错；只有参数非法抛 Error）。 */
export interface KnowledgeReviewApplyResult {
  outcome:
    | "applied"
    | "conflict"
    | "blocked"
    /** 重复 operationId：返回账本既有记录，未二次执行（A33）。 */
    | "idempotent_replay"
    /** 账本存在 applying/uncertain 的在途操作：必须先 reconcile 才能继续（A33）。 */
    | "reconcile_required";
  /** blocked 时的机器可读拒绝码（KnowledgeReviewRejectionCode 词表）。 */
  reason: string | null;
  message: string | null;
  operation: KnowledgeReviewOperationView | null;
}

export interface KnowledgeReviewUndoResult {
  outcome: "applied" | "partial" | "conflict" | "blocked";
  reason: string | null;
  message: string | null;
  operation: KnowledgeReviewOperationView | null;
}

export interface KnowledgeReviewReconcileResult {
  outcome:
    | "reconciled"
    /** operation 不处于 applying/uncertain，无需落定。 */
    | "not_applicable"
    | "blocked";
  reason: string | null;
  operation: KnowledgeReviewOperationView | null;
}

/** getProposalChangeContent 结果：delete 变更 content 为 null。 */
export interface KnowledgeReviewChangeContentResult {
  proposalId: string;
  revision: number;
  relativePath: string;
  kind: KnowledgeReviewChangeKind;
  content: string | null;
  sha256: string | null;
}

/** 结构化拒绝码（blocked.reason 词表；机器可读，不含路径与笔记内容）。 */
export const KNOWLEDGE_REVIEW_REJECTION_CODES = {
  noSource: "no_source",
  notFound: "not_found",
  vaultMismatch: "vault_mismatch",
  writesDisabled: "writes_disabled",
  /** S03 Hard Write Safety GO 门禁未满足：执行/撤销写路径整体 fail-closed（W06 修复轮 1）。 */
  writePathDisabled: "write_path_disabled",
  proposalRejected: "proposal_rejected",
  notApproved: "not_approved",
  approvalStale: "approval_stale",
  approvalExpired: "approval_expired",
  approvalEpochStale: "approval_epoch_stale",
  operationMismatch: "operation_mismatch",
  operationBusy: "operation_busy",
  invalidChange: "invalid_change",
  undoUnavailable: "undo_unavailable",
  internal: "internal",
} as const;
export type KnowledgeReviewRejectionCode =
  (typeof KNOWLEDGE_REVIEW_REJECTION_CODES)[keyof typeof KNOWLEDGE_REVIEW_REJECTION_CODES];
