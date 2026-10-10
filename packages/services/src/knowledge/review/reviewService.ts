/**
 * Knowledge 审核写入服务接口 + descriptor（W06 / specs/obsidian-knowledge.md §5e）。
 *
 * RPC 面：createProposal / reviseProposal / getProposal / listProposals /
 * approveProposal / rejectProposal / applyProposal / reconcileOperation /
 * reconcileStuckOperations / undoOperation / getProposalChangeContent。
 *
 * 本文件必须保持 browser-safe（只依赖 @drora/shared 与 descriptors，禁止 node:*）：
 * 根 index 会被 renderer 经 value import 拉进浏览器包。实现工厂在
 * `review/reviewEngine.ts`（node 侧），由 knowledgeServices.ts 装配。
 */
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../../descriptors.js";
import type {
  KnowledgeReviewApprovalView,
  KnowledgeReviewApplyResult,
  KnowledgeReviewChangeContentResult,
  KnowledgeReviewChangeInput,
  KnowledgeReviewEvidenceInput,
  KnowledgeReviewOperationView,
  KnowledgeReviewProposalView,
  KnowledgeReviewReconcileResult,
  KnowledgeReviewUndoResult,
} from "./reviewTypes.js";

export interface KnowledgeReviewCreateProposalParams {
  title: string;
  reason: string;
  evidence?: KnowledgeReviewEvidenceInput[];
  changes: KnowledgeReviewChangeInput[];
}

export interface KnowledgeReviewReviseProposalParams {
  proposalId: string;
  title?: string;
  reason?: string;
  evidence?: KnowledgeReviewEvidenceInput[];
  /** 提供即整体替换 changes 并重校验；任何字段修订都使 revision+1（旧批准失效）。 */
  changes?: KnowledgeReviewChangeInput[];
}

/**
 * Obsidian Knowledge 审核 RPC 服务面（L2 治理写唯一入口）。
 * 业务态（未批准/过期/冲突/撤权）返回结构化结果而非抛错；参数非法抛 Error。
 */
export interface IKnowledgeReviewService {
  /** 创建提案：绑定当前 vaultId + revision=1；逐条与现实对齐（base SHA 必须命中）。 */
  createProposal(params: KnowledgeReviewCreateProposalParams): Promise<KnowledgeReviewProposalView>;

  /** 修订提案：任何字段变化 → revision+1 + changesHash 重算，旧 revision 批准失效（A32）。 */
  reviseProposal(params: KnowledgeReviewReviseProposalParams): Promise<KnowledgeReviewProposalView>;

  /** 读取提案；不存在或不属于当前 vault 时为 null。 */
  getProposal(params: { proposalId: string }): Promise<KnowledgeReviewProposalView | null>;

  /** 当前 vault 的提案列表（按创建时间倒序；不含其他 vault 的历史提案）。 */
  listProposals(): Promise<KnowledgeReviewProposalView[]>;

  /**
   * 人工批准：绑定 (proposalId, 当前 revision, changesHash, 当前 sourceEpoch, expiresAt)。
   * ttlMs 缺省 10 分钟；显式 0/negative 表示立即过期（测试钩子，生产 UI 不传）。
   */
  approveProposal(params: { proposalId: string; ttlMs?: number }): Promise<KnowledgeReviewApprovalView>;

  /** 拒绝提案（终态标记；reviseProposal 可复活并重走审批）。 */
  rejectProposal(params: { proposalId: string }): Promise<KnowledgeReviewProposalView>;

  /**
   * 执行已批准提案（唯一写盘路径，经 Vault 安全门面 CAS）。
   * operationId 是调用方幂等键：重复提交返回账本既有记录，绝不二次执行。
   */
  applyProposal(params: { proposalId: string; operationId?: string }): Promise<KnowledgeReviewApplyResult>;

  /**
   * 对 applying/uncertain 的 operation 做只读文件证据核验 + 账本落定；
   * 绝不执行任何文件写、绝不自动重放（A33）。
   */
  reconcileOperation(params: { operationId: string }): Promise<KnowledgeReviewReconcileResult>;

  /** 重启恢复入口：落定全部 applying/uncertain 操作（返回落定后的视图）。 */
  reconcileStuckOperations(): Promise<KnowledgeReviewOperationView[]>;

  /** 逆操作：对该 operation 内已 applied 文件按逆序做带当前 SHA 验证的还原（A34）。 */
  undoOperation(params: { operationId: string }): Promise<KnowledgeReviewUndoResult>;

  /** Diff 预览：读取提案内某文件的精确目标内容（delete 为 null content）。 */
  getProposalChangeContent(params: {
    proposalId: string;
    relativePath: string;
  }): Promise<KnowledgeReviewChangeContentResult | null>;
}

export const IKnowledgeReviewService = createServiceDescriptor<IKnowledgeReviewService>(
  ServiceChannels.KnowledgeReview,
);
