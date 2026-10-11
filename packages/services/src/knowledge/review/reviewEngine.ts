/* eslint-disable max-lines -- Proposal 生命周期、批准绑定与 Operation ledger 执行（快照→转移→CAS 写→reconcile/undo）是同一账本状态机，必须同文件原子演进（与 host registry / windowHostController 同先例）。 *//**
 * W06 审核写入引擎（specs/obsidian-knowledge.md §5e）。
 *
 * L2 治理写的唯一落盘路径：Proposal（目标源/来源证据/base SHA/proposalRevision/
 * 精确内容）→ 人工批准（绑定 revision + changesHash + sourceEpoch + TTL）→
 * Operation ledger（operationId 唯一；prepared→applying→applied/conflict/uncertain；
 * 先保护快照后落盘）→ 经 `createVaultFileSystem` 安全门面 CAS 写（绝不直接
 * fs.writeFile 绕过门面）。
 *
 * 并发模型（§5e.6/§5e.8）：
 * - 同 operationId：账本行唯一约束 + prepared→applying 单赢家转移（跨进程 BEGIN
 *   IMMEDIATE 串行）——重复提交幂等返回，绝不二次执行；
 * - 不同 operationId 同文件：门面 read-SHA + atomic rename CAS——后写者结构化 conflict；
 * - 同进程并发：per-vault 异步互斥排队；
 * - 断线/崩溃停在 applying：只能经 reconcile（只读文件证据 + 账本落定）恢复，
 *   服务任何路径绝不自动重放。
 */
import { randomBytes } from "node:crypto";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { VaultConfig } from "../../obsidian-vault/config.js";
import {
  createVaultFileSystem,
  type VaultFileSystem,
  type VaultReadResult,
} from "../../obsidian-vault/vault-fs.js";
import { getSafeVaultPath, normalizeRelativeMarkdownPath } from "../../obsidian-vault/paths.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { resolveKnowledgeSource } from "../source/sourceRegistry.js";
import {
  canonicalizeChangesJson,
  sha256Hex,
  ReviewLedgerStore,
  type ReviewOperationFileRow,
  type ReviewOperationRow,
  type ReviewProposalRow,
} from "./reviewStore.js";
import type {
  KnowledgeReviewApplyResult,
  KnowledgeReviewApprovalView,
  KnowledgeReviewChangeInput,
  KnowledgeReviewChangeKind,
  KnowledgeReviewChangeView,
  KnowledgeReviewEvidenceInput,
  KnowledgeReviewEvidenceView,
  KnowledgeReviewFileStatus,
  KnowledgeReviewOperationFileView,
  KnowledgeReviewOperationStatus,
  KnowledgeReviewOperationView,
  KnowledgeReviewProposalView,
  KnowledgeReviewRejectionCode,
  KnowledgeReviewReconcileResult,
  KnowledgeReviewUndoResult,
} from "./reviewTypes.js";
import { KNOWLEDGE_REVIEW_REJECTION_CODES } from "./reviewTypes.js";
import type {
  IKnowledgeReviewService,
  KnowledgeReviewCreateProposalParams,
  KnowledgeReviewReviseProposalParams,
} from "./reviewService.js";

/** 单提案变更上限：批量治理仍逐文件可审计；更大的批量属 L3，不经本门面。 */
const MAX_PROPOSAL_CHANGES = 100;
/** 与门面一致的 2MB 内容上限（Buffer 字节）。 */
const MAX_CHANGE_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_REASON_LENGTH = 2000;
const MAX_EVIDENCE_NOTE_LENGTH = 1000;
/** 批准 TTL 默认 10 分钟；生产最低 30s（0/negative 仅测试钩子，表示立即过期）。 */
const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** 业务拒绝（结构化 blocked.reason 的抛出形态；公共方法捕获后映射为结构化结果）。 */
class ReviewRejection extends Error {
  constructor(readonly code: KnowledgeReviewRejectionCode, message: string) {
    super(message);
  }
}

/** 提案内物化后的变更（写入账本 changes_json 的规范形状）。 */
interface StoredChange {
  kind: KnowledgeReviewChangeKind;
  relativePath: string;
  baseSha256: string | null;
  content: string | null;
  nextSha256: string | null;
  sizeBytes: number | null;
}

export interface KnowledgeReviewEngineOptions {
  db: KnowledgeDatabase;
  /** vault-config.json 所在插件数据目录（与面板/索引服务同源）。 */
  pluginDataDir: string;
  /**
   * S03 Hard Write Safety GO 总门（W06 评审修复轮 1）：默认 **false**——门禁前提
   * （三洞修复 + P0 分级门控，见 docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md）未在
   * runtime permission 层程序化落地前，applyProposal/undoOperation 一律返回结构化
   * `write_path_disabled`，不产生任何文件写。提案/批准/账本/reconcile（只读核验）
   * 面保持可用，供审计与门禁复验。生产使能必须在门禁通过后以独立改动完成；
   * 仅测试环境经 KnowledgeServicesOptions.reviewWritePathEnabled 显式置 true。
   */
  writePathEnabled?: boolean;
}

export function createKnowledgeReviewService(options: KnowledgeReviewEngineOptions): IKnowledgeReviewService {
  const logger = createServiceLogger("knowledge-review");
  const store = new ReviewLedgerStore(options.db);
  // fail-closed：缺省（含 undefined）一律视为门禁未通过。
  const writePathEnabled = options.writePathEnabled === true;

  // per-vault 进程内互斥：同一 vault 的执行/撤销串行排队，防同进程交错。
  const vaultLocks = new Map<string, Promise<unknown>>();
  async function withVaultLock<T>(vaultId: string, fn: () => Promise<T>): Promise<T> {
    const previous = vaultLocks.get(vaultId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    vaultLocks.set(
      vaultId,
      run.catch(() => undefined),
    );
    return run;
  }

  function reject(code: KnowledgeReviewRejectionCode, message: string): never {
    throw new ReviewRejection(code, message);
  }

  interface ResolvedSource {
    config: VaultConfig;
    vaultId: string;
    sourceEpoch: number;
  }

  async function resolveSource(): Promise<ResolvedSource> {
    const source = await resolveKnowledgeSource(options.db, options.pluginDataDir, Date.now());
    if (!source.configured || source.config === null || source.summary === null || source.sourceEpoch === null) {
      return reject(KNOWLEDGE_REVIEW_REJECTION_CODES.noSource, "尚未配置 Vault：先在 Vault 面板选择或授权一个根目录");
    }
    return { config: source.config, vaultId: source.summary.vaultId, sourceEpoch: source.sourceEpoch };
  }

  function requireVaultMatch(row: ReviewProposalRow, source: ResolvedSource): void {
    if (row.vaultId !== source.vaultId) {
      reject(
        KNOWLEDGE_REVIEW_REJECTION_CODES.vaultMismatch,
        "提案属于其他 Vault：切库后本提案对当前 vault 不可操作",
      );
    }
  }

  function requireWritesEnabled(source: ResolvedSource): void {
    if (source.config.allowAgentWrites !== true) {
      reject(
        KNOWLEDGE_REVIEW_REJECTION_CODES.writesDisabled,
        "allowAgentWrites=false：Agent 发起的写入（含审核提案执行/撤销）已被撤权",
      );
    }
  }

  /** 读取 vault 文件；「不存在」返回 null，其余 IO 异常上抛（由调用方按 conflict 处理）。 */
  async function readFileOrNull(facade: VaultFileSystem, relativePath: string): Promise<VaultReadResult | null> {
    try {
      return await facade.readFile(relativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("不存在")) return null;
      throw error;
    }
  }

  /**
   * 读取账本 changes_json（canonical 4 权威字段：kind/relativePath/baseSha256/content），
   * 并重建派生字段（nextSha256/sizeBytes）——hash 口径只覆盖权威字段，派生值可随时重算。
   */
  function parseStoredChanges(row: ReviewProposalRow): StoredChange[] {
    const parsed = JSON.parse(row.changesJson) as Array<{
      kind: KnowledgeReviewChangeKind;
      relativePath: string;
      baseSha256: string | null;
      content: string | null;
    }>;
    if (!Array.isArray(parsed)) throw new Error("提案变更数据损坏");
    return parsed.map((change) => ({
      ...change,
      nextSha256: change.content === null ? null : sha256Hex(change.content),
      sizeBytes: change.content === null ? null : Buffer.byteLength(change.content, "utf-8"),
    }));
  }

  function parseStoredEvidence(row: ReviewProposalRow): KnowledgeReviewEvidenceView[] {
    const parsed = JSON.parse(row.evidenceJson) as KnowledgeReviewEvidenceView[];
    return Array.isArray(parsed) ? parsed : [];
  }

  function buildChangeViews(changes: StoredChange[]): KnowledgeReviewChangeView[] {
    return changes.map((change) => ({
      kind: change.kind,
      relativePath: change.relativePath,
      baseSha256: change.baseSha256,
      nextSha256: change.nextSha256,
      sizeBytes: change.sizeBytes,
    }));
  }

  function buildApprovalView(row: ReviewApprovalRowLike, nowMs: number): KnowledgeReviewApprovalView {
    return {
      proposalId: row.proposalId,
      revision: row.revision,
      changesHash: row.changesHash,
      sourceEpoch: row.sourceEpoch,
      approvedAtMs: row.approvedAtMs,
      expiresAtMs: row.expiresAtMs,
      expired: row.expiresAtMs <= nowMs,
    };
  }
  /** 与 store 行形状一致的最小结构（避免 engine 依赖 store 行类型之外的字段）。 */
  type ReviewApprovalRowLike = {
    proposalId: string;
    revision: number;
    changesHash: string;
    sourceEpoch: number;
    approvedAtMs: number;
    expiresAtMs: number;
  };

  function buildProposalView(row: ReviewProposalRow, nowMs: number): KnowledgeReviewProposalView {
    const approval = store.getApproval(row.proposalId, row.revision);
    return {
      proposalId: row.proposalId,
      vaultId: row.vaultId,
      title: row.title,
      reason: row.reason,
      revision: row.revision,
      changesHash: row.changesHash,
      changes: buildChangeViews(parseStoredChanges(row)),
      evidence: parseStoredEvidence(row),
      rejected: row.rejectedAtMs !== null,
      approval: approval ? buildApprovalView(approval, nowMs) : null,
      createdAtMs: row.createdAtMs,
      updatedAtMs: row.updatedAtMs,
    };
  }

  function buildOperationView(opRow: ReviewOperationRow, files?: ReviewOperationFileRow[]): KnowledgeReviewOperationView {
    const fileRows = files ?? store.listOperationFiles(opRow.operationId);
    return {
      operationId: opRow.operationId,
      proposalId: opRow.proposalId,
      revision: opRow.revision,
      vaultId: opRow.vaultId,
      sourceEpoch: opRow.sourceEpoch,
      status: opRow.status,
      files: fileRows.map(
        (file): KnowledgeReviewOperationFileView => ({
          relativePath: file.relativePath,
          kind: file.kind,
          baseSha256: file.baseSha256,
          nextSha256: file.nextSha256,
          snapshotSha256: file.snapshotSha256,
          status: file.status,
          error: file.error,
        }),
      ),
      createdAtMs: opRow.createdAtMs,
      finishedAtMs: opRow.finishedAtMs,
      reconciledAtMs: opRow.reconciledAtMs,
      error: opRow.error,
    };
  }

  // ── 提案校验与物化 ────────────────────────────────────────

  function validateEvidenceInput(evidence: KnowledgeReviewEvidenceInput[] | undefined): KnowledgeReviewEvidenceView[] {
    if (evidence === undefined) return [];
    if (!Array.isArray(evidence) || evidence.length > 20) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "evidence 必须是不超过 20 条的数组");
    }
    return evidence.map((item) => {
      const receiptId =
        typeof item?.receiptId === "string" && item.receiptId.trim() ? item.receiptId.trim() : null;
      const note = typeof item?.note === "string" && item.note.trim() ? item.note.trim().slice(0, MAX_EVIDENCE_NOTE_LENGTH) : null;
      if (!receiptId && !note) {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "evidence 条目必须携带 receiptId 或 note");
      }
      return { receiptId, note };
    });
  }

  /**
   * 物化并校验变更：路径仅普通非隐藏 `.md` + 逐段 lstat 拒软链；write 的 baseSha256
   * 必须命中当前文件（提案与现实对齐，杜绝批准一个基于幻觉旧版的提案）；
   * L3 类操作（隐藏路径/非 .md/目录/超限）在这里不可表达（§5e.4）。
   */
  async function materializeChanges(source: ResolvedSource, changes: KnowledgeReviewChangeInput[]): Promise<StoredChange[]> {
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_PROPOSAL_CHANGES) {
      reject(
        KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange,
        `changes 必须是 1..${MAX_PROPOSAL_CHANGES} 条数组`,
      );
    }
    const facade = createVaultFileSystem(source.config.rootPath);
    const seen = new Set<string>();
    const stored: StoredChange[] = [];

    for (const change of changes) {
      if (!change || typeof change !== "object") {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "change 必须是对象");
      }
      let relativePath: string;
      try {
        relativePath = normalizeRelativeMarkdownPath(change.relativePath);
        // 创建期即做防逃逸校验（软链/越界在 apply 时还会被门面再次校验）。
        await getSafeVaultPath(source.config.rootPath, relativePath);
      } catch (error) {
        reject(
          KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange,
          `路径非法（仅根内非隐藏 .md）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (seen.has(relativePath)) {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, `同一文件在提案中重复：${relativePath}`);
      }
      seen.add(relativePath);

      const kind = change.kind;
      if (kind !== "write" && kind !== "create" && kind !== "delete") {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, `未知 change kind：${String(kind)}`);
      }

      if (kind === "delete") {
        if (change.content !== undefined) {
          reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "delete 变更不得携带 content");
        }
      } else {
        if (typeof change.content !== "string") {
          reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "write/create 变更必须携带字符串 content");
        }
        if (Buffer.byteLength(change.content, "utf-8") > MAX_CHANGE_CONTENT_BYTES) {
          reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "变更内容超过 2MB 门面上限");
        }
      }

      const baseSha256 = kind === "create" ? null : change.baseSha256;
      if (kind === "create" && change.baseSha256 != null) {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "create 变更不得携带 baseSha256");
      }
      if (baseSha256 !== null && (typeof baseSha256 !== "string" || baseSha256.length === 0)) {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "write/delete 变更必须携带 baseSha256");
      }

      // 与现实对齐（缺失/超限按 invalid 处理——门面对 >2MB 文件本就拒绝 sha 校验）。
      let current: VaultReadResult | null = null;
      try {
        current = await readFileOrNull(facade, relativePath);
      } catch (error) {
        reject(
          KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange,
          `无法读取目标当前版本：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (kind === "create") {
        if (current !== null) {
          reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "目标已存在，create 应改为 write 并携带 baseSha256");
        }
      } else {
        if (current === null) {
          reject(KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange, "目标不存在或已删除，无法按 base SHA 对齐");
        }
        if (current.sha256 !== baseSha256) {
          reject(
            KNOWLEDGE_REVIEW_REJECTION_CODES.invalidChange,
            "baseSha256 与当前文件不一致：请基于最新版本重新生成提案",
          );
        }
      }

      const content = kind === "delete" ? null : (change.content as string);
      stored.push({
        kind,
        relativePath,
        baseSha256,
        content,
        nextSha256: content === null ? null : sha256Hex(content),
        sizeBytes: content === null ? null : Buffer.byteLength(content, "utf-8"),
      });
    }
    return stored;
  }

  // ── 公共 RPC 面 ───────────────────────────────────────────

  async function createProposal(params: KnowledgeReviewCreateProposalParams): Promise<KnowledgeReviewProposalView> {
    if (!params || typeof params !== "object") throw new Error("参数非法");
    const title = typeof params.title === "string" ? params.title.trim() : "";
    const reason = typeof params.reason === "string" ? params.reason.trim() : "";
    if (!title || title.length > MAX_TITLE_LENGTH) {
      throw new Error(`title 必须是 1..${MAX_TITLE_LENGTH} 个字符`);
    }
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      throw new Error(`reason 必须是 1..${MAX_REASON_LENGTH} 个字符`);
    }
    const evidence = validateEvidenceInput(params.evidence);
    const source = await resolveSource();
    const stored = await materializeChanges(source, params.changes);
    const nowMs = Date.now();
    const changesJson = canonicalizeChangesJson(stored);
    const row: ReviewProposalRow = {
      proposalId: `prp_${randomBytes(12).toString("hex")}`,
      vaultId: source.vaultId,
      title,
      reason,
      revision: 1,
      changesHash: sha256Hex(changesJson),
      changesJson,
      evidenceJson: JSON.stringify(evidence),
      rejectedAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    store.insertProposal(row);
    logger.info("提案已创建", { proposalId: row.proposalId, changes: stored.length });
    return buildProposalView(row, nowMs);
  }

  async function reviseProposal(params: KnowledgeReviewReviseProposalParams): Promise<KnowledgeReviewProposalView> {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) {
      throw new Error("proposalId 不能为空");
    }
    const row = store.getProposal(params.proposalId);
    if (!row) throw new Error(`提案不存在: ${params.proposalId}`);
    const source = await resolveSource();
    requireVaultMatch(row, source);

    const hasChanges = params.changes !== undefined;
    const hasTitle = params.title !== undefined;
    const hasReason = params.reason !== undefined;
    const hasEvidence = params.evidence !== undefined;
    if (!hasChanges && !hasTitle && !hasReason && !hasEvidence) {
      throw new Error("reviseProposal 至少提供一个待修订字段");
    }

    // 任何字段修订都 +1（§5e.3）：旧 revision 的批准随之失效（A32「Diff 改后旧 revision 无效」）。
    const nextRevision = row.revision + 1;
    const title = hasTitle ? String(params.title ?? "").trim() : row.title;
    const reason = hasReason ? String(params.reason ?? "").trim() : row.reason;
    if (!title || title.length > MAX_TITLE_LENGTH) throw new Error(`title 必须是 1..${MAX_TITLE_LENGTH} 个字符`);
    if (!reason || reason.length > MAX_REASON_LENGTH) throw new Error(`reason 必须是 1..${MAX_REASON_LENGTH} 个字符`);
    const evidence = hasEvidence ? validateEvidenceInput(params.evidence) : parseStoredEvidence(row);
    const stored = hasChanges ? await materializeChanges(source, params.changes ?? []) : parseStoredChanges(row);

    const nowMs = Date.now();
    const changesJson = canonicalizeChangesJson(stored);
    const updated: ReviewProposalRow = {
      ...row,
      revision: nextRevision,
      title,
      reason,
      changesHash: sha256Hex(changesJson),
      changesJson,
      evidenceJson: JSON.stringify(evidence),
      rejectedAtMs: null,
      updatedAtMs: nowMs,
    };
    store.updateProposalRevision(updated);
    logger.info("提案已修订", { proposalId: row.proposalId, revision: nextRevision });
    return buildProposalView(updated, nowMs);
  }

  async function getProposal(params: { proposalId: string }): Promise<KnowledgeReviewProposalView | null> {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) return null;
    const row = store.getProposal(params.proposalId);
    if (!row) return null;
    const source = await resolveSource();
    if (row.vaultId !== source.vaultId) return null;
    return buildProposalView(row, Date.now());
  }

  async function listProposals(): Promise<KnowledgeReviewProposalView[]> {
    const source = await resolveSource();
    const nowMs = Date.now();
    return store.listProposalsByVault(source.vaultId).map((row) => buildProposalView(row, nowMs));
  }

  async function approveProposal(params: {
    proposalId: string;
    ttlMs?: number;
  }): Promise<KnowledgeReviewApprovalView> {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) {
      throw new Error("proposalId 不能为空");
    }
    const row = store.getProposal(params.proposalId);
    if (!row) throw new Error(`提案不存在: ${params.proposalId}`);
    const source = await resolveSource();
    requireVaultMatch(row, source);
    if (row.rejectedAtMs !== null) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.proposalRejected, "提案已被拒绝；修订（revise）后可重新送审");
    }
    const ttlMs =
      params.ttlMs === undefined
        ? DEFAULT_APPROVAL_TTL_MS
        : Math.min(Math.max(0, Math.floor(params.ttlMs)), MAX_APPROVAL_TTL_MS);
    const nowMs = Date.now();
    const approval = {
      proposalId: row.proposalId,
      revision: row.revision,
      changesHash: row.changesHash,
      sourceEpoch: source.sourceEpoch,
      approvedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
    store.upsertApproval(approval);
    logger.info("提案已批准", { proposalId: row.proposalId, revision: row.revision });
    return buildApprovalView(approval, nowMs);
  }

  async function rejectProposal(params: { proposalId: string }): Promise<KnowledgeReviewProposalView> {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) {
      throw new Error("proposalId 不能为空");
    }
    const row = store.getProposal(params.proposalId);
    if (!row) throw new Error(`提案不存在: ${params.proposalId}`);
    const source = await resolveSource();
    requireVaultMatch(row, source);
    const nowMs = Date.now();
    store.setProposalRejected(row.proposalId, nowMs);
    return buildProposalView({ ...row, rejectedAtMs: nowMs, updatedAtMs: nowMs }, nowMs);
  }

  // ── 执行（apply）──────────────────────────────────────────

  /** 写盘前的完整批准校验（§5e.5；vault 归属与拒绝态已由调用方先行校验）。 */
  function checkApproval(row: ReviewProposalRow, source: ResolvedSource, nowMs: number): void {
    requireWritesEnabled(source);
    const approval = store.getApproval(row.proposalId, row.revision);
    if (!approval) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.notApproved, "当前 revision 尚未获得人工批准");
    }
    if (approval.changesHash !== row.changesHash) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.approvalStale, "批准与当前变更内容不一致（Diff 已改变，必须重审）");
    }
    if (approval.expiresAtMs <= nowMs) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.approvalExpired, "批准已过期，必须重新批准");
    }
    if (approval.sourceEpoch !== source.sourceEpoch) {
      reject(KNOWLEDGE_REVIEW_REJECTION_CODES.approvalEpochStale, "源身份已变化（切库/撤权重授），批准失效");
    }
  }

  /** 已存在的 operationId 的幂等/在途语义（A33）。返回 null = 允许继续执行。 */
  function resolveExistingOperation(opRow: ReviewOperationRow, proposalId: string, revision: number):
    | KnowledgeReviewApplyResult
    | null {
    if (opRow.proposalId !== proposalId || opRow.revision !== revision) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.operationMismatch,
        message: "operationId 已绑定其他提案或旧 revision",
        operation: buildOperationView(opRow),
      };
    }
    if (opRow.status === "applying" || opRow.status === "uncertain") {
      return {
        outcome: "reconcile_required",
        reason: null,
        message: "该操作结果未知：先 reconcile 落定后才能继续",
        operation: buildOperationView(opRow),
      };
    }
    if (opRow.status === "applied" || opRow.status === "conflict") {
      return {
        outcome: "idempotent_replay",
        reason: null,
        message: "operationId 已执行过：返回账本既有记录，未二次执行",
        operation: buildOperationView(opRow),
      };
    }
    // prepared：尚未执行过（插入后中断），允许恢复执行。
    return null;
  }

  async function applyProposal(params: { proposalId: string; operationId?: string }): Promise<KnowledgeReviewApplyResult> {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) {
      throw new Error("proposalId 不能为空");
    }
    if (params.operationId !== undefined && (typeof params.operationId !== "string" || !params.operationId)) {
      throw new Error("operationId 非法");
    }
    // S03 Hard Write Safety GO 总门：门禁未满足时执行面整体 fail-closed（含幂等回放——
    // 统一语义，杜绝任何被认为可执行的入口）。
    if (!writePathEnabled) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.writePathDisabled,
        message:
          "写安全门禁（S03 Hard Write Safety GO）未满足：三洞修复 + P0 分级门控未在 runtime 层落地前，审核写路径整体关闭（见 WRITE_SAFETY_NO_GO.md）",
        operation: null,
      };
    }
    const source = await resolveSource();
    const row = store.getProposal(params.proposalId);
    if (!row) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.notFound,
        message: `提案不存在: ${params.proposalId}`,
        operation: null,
      };
    }
    try {
      // vault 归属/拒绝态先行校验（幂等回放也必须满足）。
      requireVaultMatch(row, source);
      if (row.rejectedAtMs !== null) {
        reject(KNOWLEDGE_REVIEW_REJECTION_CODES.proposalRejected, "提案已被拒绝，不能执行");
      }
    } catch (error) {
      if (error instanceof ReviewRejection) {
        return { outcome: "blocked", reason: error.code, message: error.message, operation: null };
      }
      throw error;
    }

    const nowMs = Date.now();
    const operationId = params.operationId ?? `rop_${randomBytes(12).toString("hex")}`;

    // 幂等/在途解析（纯账本读，不需要有效批准）：重复 operationId 绝不二次执行（A33）。
    const existing = store.getOperation(operationId);
    if (existing) {
      const resolved = resolveExistingOperation(existing, row.proposalId, row.revision);
      if (resolved) return resolved;
    }

    // 同提案的在途保护：已有 applying/uncertain 的其他 operation → 先 reconcile（A33）。
    const inFlight = store
      .listOperationsByProposal(row.proposalId)
      .find((op) => (op.status === "applying" || op.status === "uncertain") && op.operationId !== operationId);
    if (inFlight) {
      return {
        outcome: "reconcile_required",
        reason: null,
        message: "该提案存在结果未知的在途操作：先 reconcile 后才能发起新执行",
        operation: buildOperationView(inFlight),
      };
    }

    // 真正要写文件了：完整批准校验（未批准/过期/换 revision/换 epoch/撤权一律拒绝）。
    try {
      checkApproval(row, source, nowMs);
    } catch (error) {
      if (error instanceof ReviewRejection) {
        return { outcome: "blocked", reason: error.code, message: error.message, operation: null };
      }
      throw error;
    }

    if (!existing) {
      const inserted = store.insertOperation({
        operationId,
        proposalId: row.proposalId,
        revision: row.revision,
        vaultId: source.vaultId,
        sourceEpoch: source.sourceEpoch,
        status: "prepared",
        error: null,
        createdAtMs: nowMs,
        finishedAtMs: null,
        reconciledAtMs: null,
      });
      if (!inserted) {
        // 极小窗口：同 operationId 被另一进程抢先插入——按已存在语义处理。
        const raced = store.getOperation(operationId);
        if (raced) {
          const resolved = resolveExistingOperation(raced, row.proposalId, row.revision);
          if (resolved) return resolved;
        }
      }
    }

    return withVaultLock(source.vaultId, () => executeOperation(operationId, row, source));
  }

  /** 阶段 1 快照对齐 → 阶段 2 单赢家转移 → 阶段 3 门面 CAS 写（冲突即停）。 */
  async function executeOperation(
    operationId: string,
    proposalRow: ReviewProposalRow,
    source: ResolvedSource,
  ): Promise<KnowledgeReviewApplyResult> {
    const changes = parseStoredChanges(proposalRow);
    const facade = createVaultFileSystem(source.config.rootPath);
    const nowMs = () => Date.now();

    // ── 阶段 1：写前对齐 + 快照入账（无任何文件写）。已在账的行复用（INSERT OR IGNORE）。──
    let verifyConflict: string | null = null;
    const verified: Array<{ ordinal: number; change: StoredChange }> = [];
    for (const [ordinal, change] of changes.entries()) {
      let conflictMessage: string | null = null;
      let snapshot: { content: string | null; sha256: string | null } = { content: null, sha256: null };
      try {
        const current = await readFileOrNull(facade, change.relativePath);
        if (change.kind === "create") {
          if (current !== null) conflictMessage = "conflict: 创建目标已存在";
        } else {
          if (current === null) {
            conflictMessage = "conflict: 目标文件不存在";
          } else if (current.sha256 !== change.baseSha256) {
            conflictMessage = "conflict: 文件已相对提案 base 版本发生变化";
          } else {
            snapshot = { content: current.content, sha256: current.sha256 };
          }
        }
      } catch (error) {
        conflictMessage = `conflict: ${error instanceof Error ? error.message : String(error)}`;
      }

      store.insertOperationFile({
        operationId,
        ordinal,
        relativePath: change.relativePath,
        kind: change.kind,
        baseSha256: change.baseSha256,
        nextSha256: change.nextSha256,
        nextContent: change.content,
        snapshotContent: snapshot.content,
        snapshotSha256: snapshot.sha256,
        status: conflictMessage ? "conflict" : "prepared",
        error: conflictMessage,
        updatedAtMs: nowMs(),
      });
      if (conflictMessage) {
        // 复用路径（恢复 prepared 操作）里旧行可能仍停在 prepared：显式写冲突态。
        store.updateOperationFileStatus(operationId, ordinal, "conflict", conflictMessage, nowMs());
        verifyConflict = conflictMessage;
        break;
      }
      // 复用/恢复的行也要刷新快照（file 行可能来自更早的 prepared 尝试）。
      store.updateOperationFileSnapshot(operationId, ordinal, snapshot, nowMs());
      verified.push({ ordinal, change });
    }

    if (verifyConflict !== null) {
      store.setOperationStatus(operationId, "conflict", {
        error: verifyConflict,
        finishedAtMs: nowMs(),
      });
      const opRow = store.getOperation(operationId);
      return { outcome: "conflict", reason: null, message: verifyConflict, operation: opRow ? buildOperationView(opRow) : null };
    }

    // ── 阶段 2：单赢家转移（跨进程 BEGIN IMMEDIATE 串行；输家按在途/已完成语义返回）。──
    if (!store.transitionOperationToApplying(operationId)) {
      const raced = store.getOperation(operationId);
      if (raced && (raced.status === "applied" || raced.status === "conflict")) {
        return {
          outcome: "idempotent_replay",
          reason: null,
          message: "operationId 已执行过：返回账本既有记录，未二次执行",
          operation: buildOperationView(raced),
        };
      }
      return {
        outcome: "reconcile_required",
        reason: null,
        message: "该操作正在另一进程执行：结果未知，先 reconcile",
        operation: raced ? buildOperationView(raced) : null,
      };
    }

    // ── 阶段 3：顺序写（门面 CAS），冲突即停。 ──
    let stopMessage: string | null = null;
    for (const { ordinal, change } of verified) {
      store.updateOperationFileStatus(operationId, ordinal, "applying", null, nowMs());
      let applied = false;
      let fileError: string | null = null;
      try {
        if (change.kind === "delete") {
          await facade.deleteFile({ relativePath: change.relativePath, expectedSha256: change.baseSha256 ?? undefined });
          applied = true;
        } else {
          const result = await facade.writeFile({
            relativePath: change.relativePath,
            content: change.content ?? "",
            ...(change.kind === "write" ? { expectedSha256: change.baseSha256 ?? undefined } : { createOnly: true }),
          });
          if (result.ok) {
            applied = true;
          } else {
            fileError = `conflict: 门面 CAS 冲突（当前 ${result.currentSha256.slice(0, 12)}…）`;
          }
        }
      } catch (error) {
        fileError = `conflict: ${error instanceof Error ? error.message : String(error)}`;
      }
      store.updateOperationFileStatus(
        operationId,
        ordinal,
        applied ? "applied" : "conflict",
        applied ? null : fileError,
        nowMs(),
      );
      if (!applied) {
        stopMessage = fileError ?? "conflict";
        break;
      }
    }

    const finalStatus: KnowledgeReviewOperationStatus = stopMessage === null ? "applied" : "conflict";
    store.setOperationStatus(operationId, finalStatus, {
      error: stopMessage,
      finishedAtMs: nowMs(),
    });
    const opRow = store.getOperation(operationId);
    if (stopMessage === null) {
      logger.info("审核写入已应用", { operationId, files: verified.length });
    } else {
      logger.warn("审核写入部分冲突", { operationId, error: stopMessage });
    }
    return {
      outcome: stopMessage === null ? "applied" : "conflict",
      reason: null,
      message: stopMessage,
      operation: opRow ? buildOperationView(opRow) : null,
    };
  }

  // ── reconcile（只读证据核验 + 账本落定；绝不写文件、绝不自动重放）─────────

  function resolveStuckFile(
    facade: VaultFileSystem,
    file: ReviewOperationFileRow,
  ): Promise<{ status: KnowledgeReviewFileStatus; error: string | null; ioFailed: boolean }> {
    return (async () => {
      let current: VaultReadResult | null;
      try {
        current = await readFileOrNull(facade, file.relativePath);
      } catch (error) {
        // 证据不可得：保持 applying，由 operation 落为 uncertain，等待下次 reconcile。
        return {
          status: "applying" as KnowledgeReviewFileStatus,
          error: `证据不可得：${error instanceof Error ? error.message : String(error)}`,
          ioFailed: true,
        };
      }
      if (file.kind === "delete") {
        if (current === null) return { status: "applied", error: null, ioFailed: false };
        if (current.sha256 === file.snapshotSha256) {
          return { status: "not_landed", error: null, ioFailed: false };
        }
        return { status: "conflict", error: "conflict: 文件内容与 base/目标均不符（外部编辑介入）", ioFailed: false };
      }
      if (current === null) return { status: "not_landed", error: null, ioFailed: false };
      if (file.nextSha256 !== null && current.sha256 === file.nextSha256) {
        return { status: "applied", error: null, ioFailed: false };
      }
      if (file.snapshotSha256 !== null && current.sha256 === file.snapshotSha256) {
        return { status: "not_landed", error: null, ioFailed: false };
      }
      return { status: "conflict", error: "conflict: 文件内容与 base/目标均不符（外部编辑介入）", ioFailed: false };
    })();
  }

  async function reconcileOperation(params: { operationId: string }): Promise<KnowledgeReviewReconcileResult> {
    if (!params || typeof params.operationId !== "string" || !params.operationId) {
      throw new Error("operationId 不能为空");
    }
    const opRow = store.getOperation(params.operationId);
    if (!opRow) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.notFound,
        operation: null,
      };
    }
    if (opRow.status !== "applying" && opRow.status !== "uncertain") {
      return { outcome: "not_applicable", reason: null, operation: buildOperationView(opRow) };
    }
    const source = await resolveSource();
    if (opRow.vaultId !== source.vaultId) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.vaultMismatch,
        operation: buildOperationView(opRow),
      };
    }
    const facade = createVaultFileSystem(source.config.rootPath);
    const files = store.listOperationFiles(opRow.operationId);
    const nowMs = Date.now();
    let ioFailed = false;
    for (const file of files) {
      if (file.status !== "applying") continue;
      const resolved = await resolveStuckFile(facade, file);
      if (resolved.ioFailed) ioFailed = true;
      store.updateOperationFileStatus(opRow.operationId, file.ordinal, resolved.status, resolved.error, nowMs);
      file.status = resolved.status;
    }
    const statuses = files.map((file) => file.status);
    const hasConflict = statuses.includes("conflict");
    const hasApplying = statuses.includes("applying");
    const allApplied = statuses.length > 0 && statuses.every((status) => status === "applied");
    const nextStatus: KnowledgeReviewOperationStatus = hasApplying
      ? "uncertain"
      : hasConflict
        ? "conflict"
        : allApplied
          ? "applied"
          : "prepared";
    store.setOperationStatus(opRow.operationId, nextStatus, {
      reconciledAtMs: nowMs,
      ...(nextStatus === "applied" && opRow.finishedAtMs === null ? { finishedAtMs: nowMs } : {}),
      ...(ioFailed ? { error: "部分文件证据不可得，保持 uncertain" } : {}),
    });
    const updated = store.getOperation(opRow.operationId);
    logger.info("operation 已 reconcile", { operationId: opRow.operationId, status: nextStatus });
    return {
      outcome: "reconciled",
      reason: null,
      operation: updated ? buildOperationView(updated) : null,
    };
  }

  async function reconcileStuckOperations(): Promise<KnowledgeReviewOperationView[]> {
    const source = await resolveSource();
    const stuck = store.listOperationsByStatus(["applying", "uncertain"]);
    const results: KnowledgeReviewOperationView[] = [];
    for (const opRow of stuck) {
      // 其他 vault 的在途行无法在当前根上安全核验，留待切回后处理（如实不静默清除）。
      if (opRow.vaultId !== source.vaultId) continue;
      const result = await reconcileOperation({ operationId: opRow.operationId });
      if (result.operation) results.push(result.operation);
    }
    return results;
  }

  // ── undo（带当前 SHA 验证的逆操作，§5e.7）──────────────────

  async function undoOperation(params: { operationId: string }): Promise<KnowledgeReviewUndoResult> {
    if (!params || typeof params.operationId !== "string" || !params.operationId) {
      throw new Error("operationId 不能为空");
    }
    // S03 Hard Write Safety GO 总门：撤销同为文件写路径，门禁未满足时整体关闭
    // （置于存在性检查之前——fail-closed 语义优先，不泄露账本存在性）。
    if (!writePathEnabled) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.writePathDisabled,
        message:
          "写安全门禁（S03 Hard Write Safety GO）未满足：审核撤销路径整体关闭（见 WRITE_SAFETY_NO_GO.md）",
        operation: null,
      };
    }
    const opRow = store.getOperation(params.operationId);
    if (!opRow) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.notFound,
        message: `操作不存在: ${params.operationId}`,
        operation: null,
      };
    }
    if (opRow.status === "applying" || opRow.status === "uncertain") {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.operationBusy,
        message: "操作结果未知：先 reconcile 后才能撤销",
        operation: buildOperationView(opRow),
      };
    }
    const source = await resolveSource();
    if (opRow.vaultId !== source.vaultId) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.vaultMismatch,
        message: "操作属于其他 Vault",
        operation: buildOperationView(opRow),
      };
    }
    if (source.config.allowAgentWrites !== true) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.writesDisabled,
        message: "allowAgentWrites=false：Agent 发起的写入（含审核提案执行/撤销）已被撤权",
        operation: buildOperationView(opRow),
      };
    }

    const files = store.listOperationFiles(opRow.operationId);
    const undoable = files.filter((file) => file.status === "applied");
    if (undoable.length === 0) {
      return {
        outcome: "blocked",
        reason: KNOWLEDGE_REVIEW_REJECTION_CODES.undoUnavailable,
        message: "该操作没有可撤销的已应用文件",
        operation: buildOperationView(opRow, files),
      };
    }

    const facade = createVaultFileSystem(source.config.rootPath);
    const nowMs = Date.now();
    let undone = 0;
    let conflicts = 0;
    // 逆序撤销：后写的先撤，尽量恢复原始时序。
    for (const file of [...undoable].reverse()) {
      let ok = false;
      let error: string | null = null;
      try {
        const current = await readFileOrNull(facade, file.relativePath);
        if (file.kind === "write") {
          if (current === null) {
            error = "undo conflict: 文件已被外部删除";
          } else if (current.sha256 !== file.nextSha256) {
            error = "undo conflict: 当前文件已不是本操作写入的版本";
          } else if (file.snapshotContent === null) {
            error = "undo conflict: 快照缺失";
          } else {
            const result = await facade.writeFile({
              relativePath: file.relativePath,
              content: file.snapshotContent,
              expectedSha256: file.nextSha256 ?? undefined,
            });
            ok = result.ok;
            if (!result.ok) error = "undo conflict: 门面 CAS 冲突";
          }
        } else if (file.kind === "create") {
          if (current === null) {
            error = "undo conflict: 文件已被外部删除";
          } else if (current.sha256 !== file.nextSha256) {
            error = "undo conflict: 当前文件已不是本操作创建的版本";
          } else {
            await facade.deleteFile({
              relativePath: file.relativePath,
              expectedSha256: file.nextSha256 ?? undefined,
            });
            ok = true;
          }
        } else {
          // delete 的逆 = createOnly 重建快照内容。
          if (current !== null) {
            error = "undo conflict: 目标位置已存在文件";
          } else if (file.snapshotContent === null) {
            error = "undo conflict: 快照缺失";
          } else {
            const result = await facade.writeFile({
              relativePath: file.relativePath,
              content: file.snapshotContent,
              createOnly: true,
            });
            ok = result.ok;
            if (!result.ok) error = "undo conflict: 门面 CAS 冲突";
          }
        }
      } catch (caught) {
        error = `undo conflict: ${caught instanceof Error ? caught.message : String(caught)}`;
      }
      store.updateOperationFileStatus(
        opRow.operationId,
        file.ordinal,
        ok ? "undo_applied" : "undo_conflict",
        ok ? null : error,
        nowMs,
      );
      file.status = ok ? "undo_applied" : "undo_conflict";
      if (ok) undone += 1;
      else conflicts += 1;
    }

    const updated = store.getOperation(opRow.operationId);
    const outcome: KnowledgeReviewUndoResult["outcome"] =
      conflicts === 0 ? "applied" : undone === 0 ? "conflict" : "partial";
    logger.info("审核写入撤销完成", { operationId: opRow.operationId, undone, conflicts });
    return {
      outcome,
      reason: null,
      message: undone === 0 && conflicts > 0 ? "全部撤销被拒绝：文件已相对本操作发生变化" : null,
      operation: updated ? buildOperationView(updated) : null,
    };
  }

  async function getProposalChangeContent(params: {
    proposalId: string;
    relativePath: string;
  }) {
    if (!params || typeof params.proposalId !== "string" || !params.proposalId) return null;
    if (typeof params.relativePath !== "string" || !params.relativePath) return null;
    const row = store.getProposal(params.proposalId);
    if (!row) return null;
    const source = await resolveSource();
    if (row.vaultId !== source.vaultId) return null;
    const change = parseStoredChanges(row).find((item) => item.relativePath === params.relativePath);
    if (!change) return null;
    return {
      proposalId: row.proposalId,
      revision: row.revision,
      relativePath: change.relativePath,
      kind: change.kind,
      content: change.content,
      sha256: change.nextSha256,
    };
  }

  return {
    createProposal,
    reviseProposal,
    getProposal,
    listProposals,
    approveProposal,
    rejectProposal,
    applyProposal,
    reconcileOperation,
    reconcileStuckOperations,
    undoOperation,
    getProposalChangeContent,
  };
}
