/**
 * Knowledge 检索服务接口 + descriptor（W02/W03）。
 *
 * RPC 面：createRun / search / getRun / cancelRun / onRunUpdated /
 * prepareEvidence / resolveCitation（W03 EvidenceReceipt）。
 * 行为契约见 specs/obsidian-knowledge.md §5b 与 §5。
 */
import type { Event } from "@drora/rpc";
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  KnowledgeDecisionConsentGrantResult,
  KnowledgePrepareEvidenceParams,
  KnowledgePrepareEvidenceResult,
  KnowledgeResolveCitationParams,
  KnowledgeResolveCitationResult,
  KnowledgeRunUpdatedEvent,
  KnowledgeRunView,
} from "./knowledgeTypes.js";

export interface KnowledgeCreateRunParams {
  /** 查询文本；≤512 字符，空串拒绝。范围/日期等扩展参数不存在（spec §5b.1）。 */
  query: string;
  /** 客户端幂等键：同键重复 createRun 返回同一 run（防双击/重试双跑）。 */
  clientRequestId: string;
  /** 发起会话（可选）；W03 Receipt 绑定用，本阶段只透传存储。 */
  sessionId?: string;
}

/** search 的决策扩展（W05 additive）：携带 grantDecisionConsent 签发的授权 id。 */
export interface KnowledgeSearchParams {
  runId: string;
  /** 缺省 = 不携带授权；决策管线按 denied/off 处理，本地候选照常（spec §5d.6）。 */
  decisionConsentId?: string;
}

/**
 * Obsidian Knowledge 检索 RPC 服务面。
 * 预期状态（无源/过期/取消/失败）以结构化 status 返回，不抛业务错。
 */
export interface IKnowledgeQueryService {
  /** 创建 run 并绑定当前 sourceEpoch；无活动 Vault 时返回 no_source run。 */
  createRun(params: KnowledgeCreateRunParams): Promise<KnowledgeRunView>;

  /** 执行本地检索并落定 run 状态；完成前源失效 → source_stale 且丢弃候选。 */
  search(params: KnowledgeSearchParams): Promise<KnowledgeRunView>;

  /**
   * 授予本次出站授权（W05 §5d.6，additive）：run 落定且有候选时，绑定授予时刻的
   * provider/vaultId/sourceEpoch/queryHash/candidateHashes/TTL（单 query）。
   * 默认关闭（未注入 provider）时返回 granted:false, reason:"disabled"。
   * 追问/新 Query 是新 run，必须重新授权。
   */
  grantDecisionConsent(params: {
    runId: string;
    /** 授权出站的候选子集（articleId）；缺省 = 当前 run 全部候选（出站池内）。 */
    candidateIds?: string[];
  }): Promise<KnowledgeDecisionConsentGrantResult>;

  /** 撤销授权：停止新的出站、清除关联决策缓存；进行中阶段在逐调用重查时失败回退。 */
  revokeDecisionConsent(params: { consentId: string }): Promise<{ revoked: boolean }>;

  /** 读取 run 当前状态；未知 runId 返回 null。 */
  getRun(params: { runId: string }): Promise<KnowledgeRunView | null>;

  /** 取消 run；in-flight 检索结果按 runGeneration 丢弃。 */
  cancelRun(params: { runId: string }): Promise<{ cancelled: boolean }>;

  /**
   * 从 run 候选签发 opaque EvidenceReceipt（spec §5.1）。创建时复验源身份/文件版本/
   * quote 切片，任一不满足返回结构化 status 且不签发；receipt 持久化在共享账本，
   * CLI Runtime gate 据此执行时复验。
   */
  prepareEvidence(
    params: KnowledgePrepareEvidenceParams,
  ): Promise<KnowledgePrepareEvidenceResult>;

  /**
   * 引用可信的唯一解析入口（spec §5.2）：账本 → 会话绑定 → 源身份 → 文件版本 →
   * quote 切片；伪造 id → forbidden/unknown_receipt，跨会话 → forbidden/cross_session。
   */
  resolveCitation(
    params: KnowledgeResolveCitationParams,
  ): Promise<KnowledgeResolveCitationResult>;

  /** run 状态事件（runGeneration+seq）：迟到事件不得覆盖新 run（W04 UI 契约）。 */
  onRunUpdated: Event<KnowledgeRunUpdatedEvent>;
}

export const IKnowledgeQueryService = createServiceDescriptor<IKnowledgeQueryService>(
  ServiceChannels.KnowledgeQuery,
);
