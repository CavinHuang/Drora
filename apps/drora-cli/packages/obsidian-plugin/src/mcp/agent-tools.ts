/**
 * Agent 工具面（P4，specs/obsidian-vault-phase2-true-extraction.md §4/§10-P4）：
 * VaultSearch / vault_neighbors 从 CLI 内建工具（drora-protocol 反向请求链）迁为插件
 * knowledge server 的 MCP 工具。schema 随迁 C8 契约（HEAD bf872a6c0 的
 * contracts/src/tools/vault-search.ts 与 vault-neighbors.ts；P7 随 C8 拆除后本文件即
 * 唯一契约位，故在此携带完整入参/出参形状而非引用本体 contracts）。
 *
 * 与服务面 1:1 工具（tools.ts 的 knowledge_query_search / knowledge_query_neighbors）
 * 的区别：服务面是 UI/RPC 原始形状（run 生命周期、decisionConsentId 扩展）；本文件是
 * agent 消费契约——一次性检索（createRun + search，**不携带 decisionConsentId**，
 * §5f.2 零出站）+ 出站白名单映射（vaultSearchProtocol.ts 同一收口）+ **evidence 工具内
 * 复验**（§4.2 / D9 建议值先行）：旧三层接线（工具未验证摘录 → prepareEvidence 签发
 * → CLI admission gate 输入复验）收窄为工具内单层——逐候选在调用时刻对当前文件复验
 * （与 evidenceRegistry.prepareEvidenceFromRun 同一道核验），复验状态内嵌进结果，
 * 「agent 携带证据的输入复验」改由工具调用时序保证。
 *
 * D15（建议值先行）：两工具随 knowledge server 经 manifest `alwaysLoad: true` 常驻首发
 * （.zcode-plugin/plugin.json；每会话 context 占用差异已在 §9 已知差异⑧如实记录）。
 * deferred 收敛时在 manifest 加工具级 `tools.vault_search.deferred: true` 等声明即可
 * （P2 g3 机制，优先级压过 server 级 alwaysLoad），本文件无需改动。
 *
 * CLI 旧面（core handlers / bootstrap 端口 / contracts 契约）双轨期保留并标记 deprecated
 * （读旧路径不受影响，§5 时序），P7 随 C7/C8 一并拆除。
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { quoteSliceSha256 } from "../server/knowledge/evidence/evidenceRegistry.js";
import type { KnowledgeArticleCandidate } from "../server/knowledge/knowledgeTypes.js";
import { toVaultSearchProtocolResult } from "../server/knowledge/vaultSearchProtocol.js";
import type { IObsidianVaultService } from "../server/vault/obsidianVault.js";
import { requireDataPlane, type ToolContext, type ToolSpec } from "./tools.js";

// ── 入参契约（随迁 C8 契约 @ bf872a6c0：限界与 describe 原样；strict 拒未知键与
// HEAD 工具行为一致——旧链 VaultSearchInputSchema.parse 同为 strict）──

const vaultSearchInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .max(512)
      .describe("Natural-language search text over the configured vault"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Maximum number of article candidates to return (default 5)"),
  })
  .strict();

const vaultNeighborsInputSchema = z
  .object({
    notePath: z
      .string()
      .min(1)
      .max(512)
      .describe("Vault-relative path of the note to find neighbors for (exact match)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Maximum number of neighbor candidates to return (default 5)"),
  })
  .strict();

/**
 * evidence 工具内复验（§4.2/D9）：与 prepareEvidenceFromRun 同一道核验（文件在 →
 * 文件版本 sha256 → quote 切片 sha256），只复验不签发 receipt——检索工具每次对全部
 * 候选复验，按次签发会无界膨胀账本；需要可回查的 receipt 时仍走服务面
 * knowledge_query_prepare_evidence（runId+articleId）。状态词表对齐 receipt 签发结果：
 * current（摘录已对当前文件逐字核验）/ stale（文件或切片自索引后漂移）/ missing
 * （文件已删或不可读——不可验证，与 prepareEvidence 的 missing 同语义）。
 */
async function verifyCandidateEvidence(
  vault: IObsidianVaultService,
  candidate: KnowledgeArticleCandidate,
): Promise<{ status: "current" | "stale" | "missing" }> {
  let file: Awaited<ReturnType<IObsidianVaultService["readFile"]>>;
  try {
    file = await vault.readFile({ relativePath: candidate.relativePath });
  } catch {
    // 门面对不存在/越界/超限统一抛错；不可读即不可验证 → missing（不猜部分真相）。
    return { status: "missing" };
  }
  if (file.sha256 !== candidate.fileSha256) return { status: "stale" };
  if (quoteSliceSha256(file.content, candidate.quote) !== candidate.chunkSha256) {
    return { status: "stale" };
  }
  return { status: "current" };
}

export const agentTools: ToolSpec[] = [
  {
    name: "vault_search",
    description: [
      "Search the user's configured Obsidian vault (knowledge base) for notes relevant to a natural-language query.",
      "Returns ranked article candidates with verbatim excerpts and line-precise quote selectors; each candidate carries an `evidence` status verified against the current file at call time: `current` = excerpt is verbatim and still matches the file, `stale` = the file changed since the index (re-search or read the file before quoting), `missing` = the file is gone or unreadable (unverified).",
      "Read-only; scoped to the whole authorized vault — no path/date/tag filters exist, express intent in the query text itself.",
      "`status` is honest: 'no_source' means no vault is configured, 'partial' means the index is incomplete, 'empty' means nothing matched (do not invent notes).",
      "Prefer this over Grep/Glob when the user asks about the content of their notes/knowledge base. Results reflect the last completed index; very recent edits may not be searchable yet.",
    ].join(" "),
    schema: vaultSearchInputSchema,
    needsDataPlane: true,
    handler: async (args, context: ToolContext) => {
      const parsed = vaultSearchInputSchema.parse(args ?? {});
      const dataPlane = requireDataPlane(context);
      // 纯检索 run：不绑会话（§5.1 无会话语义）、不携带决策授权（§5f.2 零出站）——
      // 与 HEAD host 反向分发（droraAgentService knowledge/search 分支）同链路语义。
      const run = await dataPlane.services.queryService.createRun({
        query: parsed.query,
        clientRequestId: `vault-search-${randomUUID()}`,
      });
      const finished = await dataPlane.services.queryService.search({ runId: run.runId });
      // evidence 工具内复验必须在白名单映射前做：内部候选才携带 fileSha256/chunkSha256
      // （出站白名单剥除 sha，vaultSearchProtocol.ts §5f.2 收口）。入参 limit 为 C8
      // 契约兼容位，检索服务按自身缺省（候选 ≤5）截断——HEAD 反向链路同行为（host
      // 分支不消费 limit），等价基准下不做新截断。
      const evidence = await Promise.all(
        finished.candidates.map((candidate) => verifyCandidateEvidence(dataPlane.vault, candidate)),
      );
      const result = toVaultSearchProtocolResult(finished);
      return {
        ...result,
        candidates: result.candidates.map((candidate, index) => ({
          ...candidate,
          evidence: evidence[index] ?? { status: "missing" as const },
        })),
      };
    },
  },
  {
    name: "vault_neighbors",
    description: [
      "Return the notes most similar to a given note in the user's configured Obsidian vault (knowledge base), ranked by vector similarity over the indexed chunks.",
      "Input is the vault-relative path of one note (exact match, no globbing); status `note_not_found` means the path is not in the current index — do not retry with path variants, search first.",
      "`semantic_unavailable` means the local semantic model is off or vectors are not backfilled; neighbors cannot work in that state.",
      "Candidates are similarity facts, not verified citations — verify against the real file before quoting. Read-only; scoped to the indexed, authorized vault.",
    ].join(" "),
    schema: vaultNeighborsInputSchema,
    needsDataPlane: true,
    handler: async (args, context: ToolContext) => {
      const parsed = vaultNeighborsInputSchema.parse(args ?? {});
      // 服务返回即白名单 DTO（query/knowledgeNeighbors.ts 收口：不含 score/sha/绝对
      // 路径），与 HEAD 反向分发同形，无需二次映射；近邻无 evidence 语义（相似是向量
      // 事实、非引用核验，HEAD knowledgeTypes 同口径），不加复验注解。
      return requireDataPlane(context).services.queryService.neighbors({
        notePath: parsed.notePath,
        ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      });
    },
  },
];
