/**
 * W06 审核账本行类型、SQLite 行映射与规范序列化助手（specs/obsidian-knowledge.md §5e.2）。
 *
 * 与 reviewStore.ts（CRUD）分离：本文件无 IO 语义，只有形状转换与 hash 口径——
 * canonical 4 权威字段（kind/relativePath/baseSha256/content）是 changesHash 的唯一输入，
 * 派生字段（nextSha256/sizeBytes）由消费方按内容重建。
 */
import { createHash } from "node:crypto";
import type {
  KnowledgeReviewChangeKind,
  KnowledgeReviewFileStatus,
  KnowledgeReviewOperationStatus,
} from "./reviewTypes.js";

export interface ReviewProposalRow {
  proposalId: string;
  vaultId: string;
  title: string;
  reason: string;
  revision: number;
  changesHash: string;
  /** 规范化 changes JSON（kind/relativePath/baseSha256/content 固定键序）。 */
  changesJson: string;
  evidenceJson: string;
  rejectedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ReviewApprovalRow {
  proposalId: string;
  revision: number;
  changesHash: string;
  sourceEpoch: number;
  approvedAtMs: number;
  expiresAtMs: number;
}

export interface ReviewOperationRow {
  operationId: string;
  proposalId: string;
  revision: number;
  vaultId: string;
  sourceEpoch: number;
  status: KnowledgeReviewOperationStatus;
  error: string | null;
  createdAtMs: number;
  finishedAtMs: number | null;
  reconciledAtMs: number | null;
}

export interface ReviewOperationFileRow {
  operationId: string;
  ordinal: number;
  relativePath: string;
  kind: KnowledgeReviewChangeKind;
  baseSha256: string | null;
  nextSha256: string | null;
  /** 精确目标内容（write/create）；delete 为 null。 */
  nextContent: string | null;
  /** 写前快照（先保护快照后落盘）；未执行到快照阶段为 null。 */
  snapshotContent: string | null;
  snapshotSha256: string | null;
  status: KnowledgeReviewFileStatus;
  error: string | null;
  updatedAtMs: number;
}

export interface ProposalDbRow {
  proposal_id: string;
  vault_id: string;
  title: string;
  reason: string;
  revision: number;
  changes_hash: string;
  changes_json: string;
  evidence_json: string;
  rejected_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ApprovalDbRow {
  proposal_id: string;
  revision: number;
  changes_hash: string;
  source_epoch: number;
  approved_at_ms: number;
  expires_at_ms: number;
}

export interface OperationDbRow {
  operation_id: string;
  proposal_id: string;
  revision: number;
  vault_id: string;
  source_epoch: number;
  status: string;
  error: string | null;
  created_at_ms: number;
  finished_at_ms: number | null;
  reconciled_at_ms: number | null;
}

export interface OperationFileDbRow {
  operation_id: string;
  ordinal: number;
  relative_path: string;
  kind: string;
  base_sha256: string | null;
  next_sha256: string | null;
  next_content: string | null;
  snapshot_content: string | null;
  snapshot_sha256: string | null;
  status: string;
  error: string | null;
  updated_at_ms: number;
}

export function mapProposal(row: ProposalDbRow): ReviewProposalRow {
  return {
    proposalId: row.proposal_id,
    vaultId: row.vault_id,
    title: row.title,
    reason: row.reason,
    revision: row.revision,
    changesHash: row.changes_hash,
    changesJson: row.changes_json,
    evidenceJson: row.evidence_json,
    rejectedAtMs: row.rejected_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function mapApproval(row: ApprovalDbRow): ReviewApprovalRow {
  return {
    proposalId: row.proposal_id,
    revision: row.revision,
    changesHash: row.changes_hash,
    sourceEpoch: row.source_epoch,
    approvedAtMs: row.approved_at_ms,
    expiresAtMs: row.expires_at_ms,
  };
}

export function mapOperation(row: OperationDbRow): ReviewOperationRow {
  return {
    operationId: row.operation_id,
    proposalId: row.proposal_id,
    revision: row.revision,
    vaultId: row.vault_id,
    sourceEpoch: row.source_epoch,
    status: row.status as KnowledgeReviewOperationStatus,
    error: row.error,
    createdAtMs: row.created_at_ms,
    finishedAtMs: row.finished_at_ms,
    reconciledAtMs: row.reconciled_at_ms,
  };
}

export function mapOperationFile(row: OperationFileDbRow): ReviewOperationFileRow {
  return {
    operationId: row.operation_id,
    ordinal: row.ordinal,
    relativePath: row.relative_path,
    kind: row.kind as KnowledgeReviewChangeKind,
    baseSha256: row.base_sha256,
    nextSha256: row.next_sha256,
    nextContent: row.next_content,
    snapshotContent: row.snapshot_content,
    snapshotSha256: row.snapshot_sha256,
    status: row.status as KnowledgeReviewFileStatus,
    error: row.error,
    updatedAtMs: row.updated_at_ms,
  };
}

/** 规范化 changes 序列化（固定键序）——changesHash 的唯一口径，批准与重算共用。 */
export function canonicalizeChangesJson(
  changes: Array<{
    kind: KnowledgeReviewChangeKind;
    relativePath: string;
    baseSha256: string | null;
    content: string | null;
  }>,
): string {
  return JSON.stringify(
    changes.map((change) => ({
      kind: change.kind,
      relativePath: change.relativePath,
      baseSha256: change.baseSha256,
      content: change.content,
    })),
  );
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}
