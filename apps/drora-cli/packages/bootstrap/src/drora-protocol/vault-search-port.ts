// ============================================================
// VaultSearch Protocol Port
// ============================================================
// obsidian-knowledge.md §5f：VaultSearch 工具的 CLI 侧端口实现——经 drora-protocol
// 反向请求把检索转发到 host 进程内的 knowledge 检索服务（与 UI 同一条服务链）。
// host 无 knowledge 服务（降级/远程 host）时返回 -32603 结构化错误，由工具层按
// 业务失败转述；本端口不做任何本地兜底（无源/空结果是 host 返回的结构化 status，
// 不是这里的错误）。

import {
  droraKnowledgeSearchParamsSchema,
  droraKnowledgeSearchResultSchema,
  droraProtocolMethods,
  type DroraKnowledgeSearchProtocolResult,
} from "@drora/shared";
import type { VaultSearchOutput } from "@drora/contracts";
import { ProtocolRequestError, type DroraProtocolAgentServerContext } from "./server-types.js";

const KNOWLEDGE_SEARCH_UNAVAILABLE_MESSAGE =
  "Vault search is not available on this host (no knowledge service).";

export function createProtocolVaultSearchPort(
  context: DroraProtocolAgentServerContext,
): {
  search(input: { query: string; limit?: number }): Promise<VaultSearchOutput>;
} {
  return {
    async search(input: { query: string; limit?: number }): Promise<VaultSearchOutput> {
      try {
        const result = (await context.requestClient(
          droraProtocolMethods.knowledgeSearch,
          droraKnowledgeSearchParamsSchema.parse(input),
          droraKnowledgeSearchResultSchema,
        )) as DroraKnowledgeSearchProtocolResult;
        // 协议 result 与 contracts VaultSearchOutput 结构同形（字段白名单一致）；
        // 漂移会在 host/CLI 任一侧的严格 parse 处暴露，这里不再二次拷贝。
        return result as VaultSearchOutput;
      } catch (error) {
        // 旧 host 不认识 knowledge/search（-32601）= 能力差异，翻译成稳定的不可用文案；
        // -32603 等其余错误携带 host 原始消息（含显式不可用与真实内部错误），原样上抛。
        if (error instanceof ProtocolRequestError && error.code === -32601) {
          throw new Error(KNOWLEDGE_SEARCH_UNAVAILABLE_MESSAGE);
        }
        throw error;
      }
    },
  };
}
