// 迁自 packages/services/src/knowledge/vaultSearchProtocol.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * VaultSearch 协议映射（obsidian-knowledge.md §5f）。
 *
 * KnowledgeRunView → drora knowledge/search 协议结果的纯函数。字段白名单是 §5f.2
 * 的边界落点：不含 score（bm25 值不是正确率）、不含 sha 字段（可验证性归 W03
 * Receipt，工具摘录是「未验证引用」）、不含绝对路径。结构化 status 直通，不编造。
 */
import type { KnowledgeRunView } from "./knowledgeTypes.js";

// P7/C8（specs/obsidian-vault-phase2-true-extraction.md §1-C6/§4）：shared 协议段
// （knowledge/search schema，CLI→host 反向分发）已随双轨下线删除——插件 MCP 工具面
// 持有唯一契约，出站结果类型迁入本文件（字段形状与 HEAD wire schema 逐字等价，
// 供 src/mcp/agent-tools.ts 的 vault_search 工具 schema 与白名单映射共同引用）。

/** 检索候选（出站白名单：不含 score/sha/绝对路径，§5f.2 边界）。 */
export interface VaultSearchProtocolCandidate {
  /** 稳定文章 id = sha256(vaultId + relativePath)；不含根路径，可安全出站（§5d.6 同口径）。 */
  articleId: string;
  relativePath: string;
  title: string;
  matchedHeading: string | null;
  /** 命中 chunk 的原文逐字节选（≤240 字符，§5b.5 命中感知窗口）。 */
  excerpt: string;
  quote: {
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  };
  rank: number;
  matchedChunkCount: number;
}

/** search 落定后的协议结果（status 为 KnowledgeQueryStatus 终态直通）。 */
export interface DroraKnowledgeSearchProtocolResult {
  status: "ready" | "partial" | "empty" | "no_source" | "source_stale" | "cancelled" | "failed";
  /** failed 的机器可读原因；不含绝对路径与笔记内容（§5b.6）。 */
  reason: string | null;
  candidates: VaultSearchProtocolCandidate[];
  diagnostics: {
    /** 索引 coverage 截断如实呈现（§5b.4）；无源为 null。 */
    coveragePartial: boolean | null;
    /** 检索是否自动扩大了一次（§5b.5 降级）；无源为 null。 */
    matchRelaxedToOr: boolean | null;
    /** 语义阶段词表（§5b.5）：unavailable/applied/skipped。 */
    semantic: "unavailable" | "applied" | "skipped";
    /** 向量独有进入候选池的数量（§5b.9 混合召回，additive 可选）。 */
    semanticRecalled?: number;
  } | null;
}

/** search 落定后的合法终态（retrieving 是 createRun 与 search 之间的瞬态，不可达）。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "ready",
  "partial",
  "empty",
  "no_source",
  "source_stale",
  "cancelled",
  "failed",
]);

export function toVaultSearchProtocolResult(
  run: KnowledgeRunView,
): DroraKnowledgeSearchProtocolResult {
  const status = TERMINAL_STATUSES.has(run.status)
    ? (run.status as DroraKnowledgeSearchProtocolResult["status"])
    : // 防御：非终态（理论不可达）按 failed 结构化上报，绝不把半成品候选当结果。
      ("failed" as const);
  return {
    status,
    reason:
      status === run.status
        ? run.reason
        : ((run.reason ?? "search_not_finished") as DroraKnowledgeSearchProtocolResult["reason"]),
    candidates: run.candidates.map((candidate) => ({
      articleId: candidate.articleId,
      relativePath: candidate.relativePath,
      title: candidate.title,
      matchedHeading: candidate.matchedHeading,
      excerpt: candidate.excerpt,
      quote: {
        startLine: candidate.quote.startLine,
        endLine: candidate.quote.endLine,
        startOffset: candidate.quote.startOffset,
        endOffset: candidate.quote.endOffset,
      },
      rank: candidate.rank,
      matchedChunkCount: candidate.matchedChunkCount,
    })),
    diagnostics:
      run.diagnostics === null
        ? null
        : {
            coveragePartial: run.coverage?.partial ?? null,
            matchRelaxedToOr: run.diagnostics.matchRelaxedToOr,
            semantic: run.diagnostics.semantic,
          },
  };
}
