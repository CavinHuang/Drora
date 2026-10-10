/**
 * W06 审核账本存取层（specs/obsidian-knowledge.md §5e.2/§5e.6）。
 *
 * 只做行映射与 SQLite 短事务（knowledge-index.sqlite v3 四张 review_* 表）：
 * - operationId PRIMARY KEY 唯一约束是幂等的最终防线（应用层检查只是快速路径）；
 * - prepared→applying 的单赢家转移用「UPDATE ... WHERE status='prepared'」的受影响
 *   行数判定，跨进程（双 Host）由 BEGIN IMMEDIATE + WAL 串行化；
 * - 本文件绝不触碰文件系统（§5b.3 纪律：事务内不做文件 IO），文件写全在 engine 层。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import {
  mapApproval,
  mapOperation,
  mapOperationFile,
  mapProposal,
  type ApprovalDbRow,
  type OperationDbRow,
  type OperationFileDbRow,
  type ProposalDbRow,
  type ReviewApprovalRow,
  type ReviewOperationFileRow,
  type ReviewOperationRow,
  type ReviewProposalRow,
} from "./reviewLedgerRows.js";

export type {
  ReviewApprovalRow,
  ReviewOperationFileRow,
  ReviewOperationRow,
  ReviewProposalRow,
} from "./reviewLedgerRows.js";
export {
  canonicalizeChangesJson,
  sha256Hex,
} from "./reviewLedgerRows.js";
import type {
  KnowledgeReviewFileStatus,
  KnowledgeReviewOperationStatus,
} from "./reviewTypes.js";

export class ReviewLedgerStore {
  constructor(private readonly db: KnowledgeDatabase) {}

  // ── proposals ─────────────────────────────────────────────

  insertProposal(row: ReviewProposalRow): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `INSERT INTO review_proposals(
             proposal_id, vault_id, title, reason, revision, changes_hash,
             changes_json, evidence_json, rejected_at_ms, created_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.proposalId,
          row.vaultId,
          row.title,
          row.reason,
          row.revision,
          row.changesHash,
          row.changesJson,
          row.evidenceJson,
          row.rejectedAtMs,
          row.createdAtMs,
          row.updatedAtMs,
        );
    });
  }

  getProposal(proposalId: string): ReviewProposalRow | null {
    const row = this.db.raw
      .prepare("SELECT * FROM review_proposals WHERE proposal_id = ?")
      .get(proposalId) as ProposalDbRow | undefined;
    return row ? mapProposal(row) : null;
  }

  listProposalsByVault(vaultId: string): ReviewProposalRow[] {
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM review_proposals WHERE vault_id = ? ORDER BY created_at_ms DESC, proposal_id DESC",
      )
      .all(vaultId) as unknown as ProposalDbRow[];
    return rows.map(mapProposal);
  }

  /** 修订：整体覆盖标题/理由/证据/changes/revision；rejected 可被 revive 置空。 */
  updateProposalRevision(row: ReviewProposalRow): void {
    this.db.transaction((tx) => {
      const result = tx.raw
        .prepare(
          `UPDATE review_proposals
           SET title = ?, reason = ?, revision = ?, changes_hash = ?, changes_json = ?,
               evidence_json = ?, rejected_at_ms = ?, updated_at_ms = ?
           WHERE proposal_id = ? AND revision = ?`,
        )
        .run(
          row.title,
          row.reason,
          row.revision,
          row.changesHash,
          row.changesJson,
          row.evidenceJson,
          row.rejectedAtMs,
          row.updatedAtMs,
          row.proposalId,
          // 乐观并发：修订必须基于读取到的旧 revision，双 Host 同时修订只有一个生效。
          row.revision - 1,
        );
      if (Number(result.changes) !== 1) {
        throw new Error("提案已被并发修订，请刷新后重试");
      }
    });
  }

  // ── approvals ─────────────────────────────────────────────

  upsertApproval(row: ReviewApprovalRow): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `INSERT INTO review_approvals(
             proposal_id, revision, changes_hash, source_epoch, approved_at_ms, expires_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(proposal_id, revision) DO UPDATE SET
             changes_hash = excluded.changes_hash,
             source_epoch = excluded.source_epoch,
             approved_at_ms = excluded.approved_at_ms,
             expires_at_ms = excluded.expires_at_ms`,
        )
        .run(
          row.proposalId,
          row.revision,
          row.changesHash,
          row.sourceEpoch,
          row.approvedAtMs,
          row.expiresAtMs,
        );
    });
  }

  getApproval(proposalId: string, revision: number): ReviewApprovalRow | null {
    const row = this.db.raw
      .prepare(
        "SELECT * FROM review_approvals WHERE proposal_id = ? AND revision = ?",
      )
      .get(proposalId, revision) as ApprovalDbRow | undefined;
    return row ? mapApproval(row) : null;
  }

  /** 拒绝标记（可被 reviseProposal 复活）：只翻 rejected_at_ms，不动 revision/hash。 */
  setProposalRejected(proposalId: string, rejectedAtMs: number): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare("UPDATE review_proposals SET rejected_at_ms = ?, updated_at_ms = ? WHERE proposal_id = ?")
        .run(rejectedAtMs, rejectedAtMs, proposalId);
    });
  }

  // ── operations（Operation ledger）─────────────────────────

  insertOperation(row: ReviewOperationRow): boolean {
    let inserted = false;
    this.db.transaction((tx) => {
      const result = tx.raw
        .prepare(
          `INSERT OR IGNORE INTO review_operations(
             operation_id, proposal_id, revision, vault_id, source_epoch, status,
             error, created_at_ms, finished_at_ms, reconciled_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.operationId,
          row.proposalId,
          row.revision,
          row.vaultId,
          row.sourceEpoch,
          row.status,
          row.error,
          row.createdAtMs,
          row.finishedAtMs,
          row.reconciledAtMs,
        );
      inserted = Number(result.changes) === 1;
    });
    return inserted;
  }

  getOperation(operationId: string): ReviewOperationRow | null {
    const row = this.db.raw
      .prepare("SELECT * FROM review_operations WHERE operation_id = ?")
      .get(operationId) as OperationDbRow | undefined;
    return row ? mapOperation(row) : null;
  }

  listOperationsByStatus(statuses: KnowledgeReviewOperationStatus[]): ReviewOperationRow[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM review_operations WHERE status IN (${placeholders}) ORDER BY created_at_ms ASC`,
      )
      .all(...statuses) as unknown as OperationDbRow[];
    return rows.map(mapOperation);
  }

  listOperationsByProposal(proposalId: string): ReviewOperationRow[] {
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM review_operations WHERE proposal_id = ? ORDER BY created_at_ms ASC, operation_id ASC",
      )
      .all(proposalId) as unknown as OperationDbRow[];
    return rows.map(mapOperation);
  }

  /**
   * 单赢家转移：prepared→applying。返回是否赢得；
   * 跨进程由 BEGIN IMMEDIATE 串行，同 operationId 只可能有一个赢家（A33）。
   */
  transitionOperationToApplying(operationId: string): boolean {
    let won = false;
    this.db.transaction((tx) => {
      const result = tx.raw
        .prepare(
          "UPDATE review_operations SET status = 'applying' WHERE operation_id = ? AND status = 'prepared'",
        )
        .run(operationId);
      won = Number(result.changes) === 1;
    });
    return won;
  }

  setOperationStatus(
    operationId: string,
    status: KnowledgeReviewOperationStatus,
    options: { error?: string | null; finishedAtMs?: number | null; reconciledAtMs?: number | null } = {},
  ): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `UPDATE review_operations
           SET status = ?,
               error = COALESCE(?, error),
               finished_at_ms = COALESCE(?, finished_at_ms),
               reconciled_at_ms = COALESCE(?, reconciled_at_ms)
           WHERE operation_id = ?`,
        )
        .run(
          status,
          options.error ?? null,
          options.finishedAtMs ?? null,
          options.reconciledAtMs ?? null,
          operationId,
        );
    });
  }

  // ── operation files ───────────────────────────────────────

  insertOperationFile(row: ReviewOperationFileRow): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `INSERT OR IGNORE INTO review_operation_files(
             operation_id, ordinal, relative_path, kind, base_sha256, next_sha256,
             next_content, snapshot_content, snapshot_sha256, status, error, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.operationId,
          row.ordinal,
          row.relativePath,
          row.kind,
          row.baseSha256,
          row.nextSha256,
          row.nextContent,
          row.snapshotContent,
          row.snapshotSha256,
          row.status,
          row.error,
          row.updatedAtMs,
        );
    });
  }

  updateOperationFileSnapshot(
    operationId: string,
    ordinal: number,
    snapshot: { content: string | null; sha256: string | null },
    nowMs: number,
  ): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `UPDATE review_operation_files
           SET snapshot_content = ?, snapshot_sha256 = ?, updated_at_ms = ?
           WHERE operation_id = ? AND ordinal = ?`,
        )
        .run(snapshot.content, snapshot.sha256, nowMs, operationId, ordinal);
    });
  }

  updateOperationFileStatus(
    operationId: string,
    ordinal: number,
    status: KnowledgeReviewFileStatus,
    error: string | null,
    nowMs: number,
  ): void {
    this.db.transaction((tx) => {
      tx.raw
        .prepare(
          `UPDATE review_operation_files
           SET status = ?, error = ?, updated_at_ms = ?
           WHERE operation_id = ? AND ordinal = ?`,
        )
        .run(status, error, nowMs, operationId, ordinal);
    });
  }

  listOperationFiles(operationId: string): ReviewOperationFileRow[] {
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM review_operation_files WHERE operation_id = ? ORDER BY ordinal ASC",
      )
      .all(operationId) as unknown as OperationFileDbRow[];
    return rows.map(mapOperationFile);
  }

  getOperationFile(operationId: string, relativePath: string): ReviewOperationFileRow | null {
    const row = this.db.raw
      .prepare(
        "SELECT * FROM review_operation_files WHERE operation_id = ? AND relative_path = ?",
      )
      .get(operationId, relativePath) as OperationFileDbRow | undefined;
    return row ? mapOperationFile(row) : null;
  }
}
