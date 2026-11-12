// 迁自 packages/services/src/knowledge/review/reviewService.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
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
// P7/C6-C7（spec §1-C7）：通道名迁插件自带常量（platform/knowledgeEvidence.ts）。
import { KNOWLEDGE_SERVICE_CHANNELS } from "../../platform/knowledgeEvidence.js";
import { createServiceDescriptor } from "../../platform/descriptors.js";
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
  approveProposal(params: {
    proposalId: string;
    ttlMs?: number;
  }): Promise<KnowledgeReviewApprovalView>;

  /** 拒绝提案（终态标记；reviseProposal 可复活并重走审批）。 */
  rejectProposal(params: { proposalId: string }): Promise<KnowledgeReviewProposalView>;

  /**
   * 执行已批准提案（唯一写盘路径，经 Vault 安全门面 CAS）。
   * operationId 是调用方幂等键：重复提交返回账本既有记录，绝不二次执行。
   */
  applyProposal(params: {
    proposalId: string;
    operationId?: string;
  }): Promise<KnowledgeReviewApplyResult>;

  /**
   * 对 applying/uncertain 的 operation 做只读文件证据核验 + 账本落定；
   * 绝不执行任何文件写、绝不自动重放（A33）。
   */
  reconcileOperation(params: { operationId: string }): Promise<KnowledgeReviewReconcileResult>;

  /** Read-only recent operation history (at most 100), scoped to the current Vault. */
  listRecentOperations(): Promise<KnowledgeReviewOperationView[]>;

  /** 重启恢复入口：落定全部 applying/uncertain 操作（返回落定后的视图）。 */
  reconcileStuckOperations(): Promise<KnowledgeReviewOperationView[]>;

  /** 逆操作：对该 operation 内已 applied 文件按逆序做带当前 SHA 验证的还原（A34）。 */
  undoOperation(params: { operationId: string }): Promise<KnowledgeReviewUndoResult>;

  /** Diff 预览：读取提案内某文件的精确目标内容（delete 为 null content）。 */
  getProposalChangeContent(params: {
    proposalId: string;
    relativePath: string;
  }): Promise<KnowledgeReviewChangeContentResult | null>;

  /** L2 写路径总门当前状态（W09：缺省 false；S03 GO 后经 UI/config 显式开启）。 */
  isWritePathEnabled(): boolean;
  /** Whether this Host is granted L2 activation by the reviewed release policy. */
  isWritePathActivationAllowed(): boolean;

  /**
   * 显式开启/关闭 L2 写路径总门：持久化到 vault-config.json（唯一写入入口
   * `obsidian-vault/config.setVaultReviewWritePathEnabled`）成功后才翻转进程内状态；
   * 持久化失败时上抛、状态不变。
   */
  setWritePathEnabled(enabled: boolean): Promise<void>;
}

export const IKnowledgeReviewService = createServiceDescriptor<IKnowledgeReviewService>(
  KNOWLEDGE_SERVICE_CHANNELS.KnowledgeReview,
);
