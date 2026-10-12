/**
 * Knowledge 索引服务接口 + descriptor（W02）。
 *
 * RPC 面：getStatus / getInsights / startReconcile / requestRebuild / cancelJob。
 * 索引是可重建缓存：任务只写 knowledge-index.sqlite 的索引侧表，绝不改写笔记、
 * 绝不触及审核账本（W06 起同库的 review_* 四表，spec §5e.2）。行为契约见
 * specs/obsidian-knowledge.md §5b。
 */
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  KnowledgeIndexJobStartResult,
  KnowledgeIndexStatus,
  KnowledgeInsightsSnapshot,
  KnowledgeJobCancelResult,
} from "./knowledgeTypes.js";
import type { KnowledgeSemanticPortStatus } from "./search/embeddingPort.js";

/**
 * Obsidian Knowledge 索引 RPC 服务面。
 * 所有方法返回结构化状态而非抛业务错：无源、租约竞争等都是可呈现状态。
 */
export interface IKnowledgeIndexService {
  /** 当前源身份 + coverage + 最近任务 + 租约持有方。未配置 Vault 时 configured=false。 */
  getStatus(): Promise<KnowledgeIndexStatus>;

  /**
   * 洞察视图快照（spec §5g，additive）：host 端聚合纯查询——库存/覆盖/最近任务/
   * 决策 telemetry 投影；不新增表、不做后台任务、不读 vault 文件。
   */
  getInsights(): Promise<KnowledgeInsightsSnapshot>;

  /**
   * 增量对账：全量扫描（门面不变量）+ 与索引差异对比，落实增删改/重命名/漏事件。
   * 已有任务进行中时不重复起任务（alreadyRunning=true 返回既有任务）。
   */
  /**
   * Jev 配置热生效（spec §5d.10）：UI 写入 Jev 配置后调用；下一轮决策 stage 强制
   * 重解析装配并按签名清缓存。无动态源时 refreshed=false（静态注入路径）。
   */
  refreshDecisionConfig(): Promise<{ refreshed: boolean }>;

  /**
   * 本地语义检索状态面（spec §5b.9）：模型文件/下载/失败的粗粒度状态。
   * 功能关闭 → state="model_missing" 且 lastError="semantic_disabled"（与装配缺省一致）。
   */
  getSemanticStatus(): Promise<KnowledgeSemanticPortStatus>;

  /**
   * 手动触发模型就绪（下载 + 会话初始化）；长耗时，调用方轮询 getSemanticStatus。
   * started=false 表示无端口可触发（功能关闭）；失败以 error 携带（不抛业务错）。
   */
  downloadSemanticModel(): Promise<{ started: boolean; error: string | null }>;

  startReconcile(): Promise<KnowledgeIndexJobStartResult>;

  /** 全量重建：清空当前 epoch 缓存后重新扫描索引。 */
  requestRebuild(): Promise<KnowledgeIndexJobStartResult>;

  /** 取消任务；jobId 未知或任务已结束时 cancelled=false（status 如实回显）。 */
  cancelJob(params: { jobId: string }): Promise<KnowledgeJobCancelResult>;
}

export const IKnowledgeIndexService = createServiceDescriptor<IKnowledgeIndexService>(
  ServiceChannels.KnowledgeIndex,
);
