// ============================================================
// VaultSearch Port - read-only vault retrieval boundary
// ============================================================
// obsidian-knowledge.md §5f：CLI 工具经本端口访问 host 侧 knowledge 检索服务
// （bootstrap 协议端口实现；host 无 knowledge 服务时工具整体不注册）。端口是
// 只读查询——不承载索引、授权或任何写语义。

import type { VaultSearchInput, VaultSearchOutput } from "../tools/vault-search.js";

export interface VaultSearchPort {
  /**
   * 只读检索已授权配置的 vault。失败以结构化 status 返回（no_source/failed 等），
   * 不抛业务错；传输/协议错误由实现层抛出，调用方按工具失败处理。
   */
  search(input: VaultSearchInput): Promise<VaultSearchOutput>;
}
