/**
 * Knowledge 索引服务接口 + descriptor（W02）。
 *
 * RPC 面：getStatus / startReconcile / requestRebuild / cancelJob。
 * 索引是可重建缓存：任务只写 knowledge-index.sqlite，绝不改写笔记、
 * 绝不触及审核账本（W06 才存在）。行为契约见 specs/obsidian-knowledge.md §5b。
 */
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  KnowledgeIndexJobStartResult,
  KnowledgeIndexStatus,
  KnowledgeJobCancelResult,
} from "./knowledgeTypes.js";

/**
 * Obsidian Knowledge 索引 RPC 服务面。
 * 所有方法返回结构化状态而非抛业务错：无源、租约竞争等都是可呈现状态。
 */
export interface IKnowledgeIndexService {
  /** 当前源身份 + coverage + 最近任务 + 租约持有方。未配置 Vault 时 configured=false。 */
  getStatus(): Promise<KnowledgeIndexStatus>;

  /**
   * 增量对账：全量扫描（门面不变量）+ 与索引差异对比，落实增删改/重命名/漏事件。
   * 已有任务进行中时不重复起任务（alreadyRunning=true 返回既有任务）。
   */
  startReconcile(): Promise<KnowledgeIndexJobStartResult>;

  /** 全量重建：清空当前 epoch 缓存后重新扫描索引。 */
  requestRebuild(): Promise<KnowledgeIndexJobStartResult>;

  /** 取消任务；jobId 未知或任务已结束时 cancelled=false（status 如实回显）。 */
  cancelJob(params: { jobId: string }): Promise<KnowledgeJobCancelResult>;
}

export const IKnowledgeIndexService = createServiceDescriptor<IKnowledgeIndexService>(
  ServiceChannels.KnowledgeIndex,
);
