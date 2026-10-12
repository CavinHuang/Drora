// ============================================================
// VaultSearch Tool - read-only vault retrieval for the agent
// ============================================================
// obsidian-knowledge.md §5f：agent 的只读 vault 检索入口。与 UI 检索同一条
// knowledge 服务链（scope/sourceEpoch/coverage 语义全继承）；工具面只是第二个
// 消费方。入参只有 query + limit——服务端不提供任何日期/路径范围过滤（§5b.1），
// 模型无法借工具扩展授权范围。

import { z } from "zod";
import type { ToolCallId, TraceId } from "../interfaces/shared.js";
import { toToolJsonSchema } from "./json-schema.js";

// -----------------------------------------------
// Input Schema
// -----------------------------------------------

export const VaultSearchInputSchema = z.object({
  /**
   * 原样查询文本（中文/英文/混合）。不支持路径、日期或标签过滤——检索范围是
   * 已授权配置的整个 vault。
   */
  query: z.string().min(1).max(512).describe("Natural-language search text over the configured vault"),
  /**
   * 返回候选上限（1-10，缺省 5）。候选按相关性排序。
   */
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Maximum number of article candidates to return (default 5)"),
}).strict();

export type VaultSearchInput = z.infer<typeof VaultSearchInputSchema>;

export const VaultSearchInputJsonSchema = toToolJsonSchema(VaultSearchInputSchema);

// -----------------------------------------------
// Output Schema
// -----------------------------------------------

export const VaultSearchCandidateSchema = z
  .object({
    /** 稳定文章 id（不含根路径，可安全引用）。 */
    articleId: z.string(),
    /** 相对 vault 根的路径。 */
    relativePath: z.string(),
    title: z.string(),
    /** 命中 chunk 的标题路径（`A > B`）；顶层命中为 null。 */
    matchedHeading: z.string().nullable(),
    /** 命中 chunk 的原文逐字节选（≤240 字符，窗口对准命中位置）。 */
    excerpt: z.string(),
    /** 命中 chunk 的 1-based 起止行与全文字符偏移（可回原文核验）。 */
    quote: z.object({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
    }),
    /** 1 起始相关性名次。 */
    rank: z.number().int().positive(),
    /** 该文章内命中的 chunk 数。 */
    matchedChunkCount: z.number().int().positive(),
  })
  .strict();

export type VaultSearchCandidate = z.infer<typeof VaultSearchCandidateSchema>;

export const VaultSearchOutputSchema = z
  .object({
    /** 检索终态：ready/partial（索引截断但部分可用）/empty/no_source/source_stale/cancelled/failed。 */
    status: z.enum([
      "ready",
      "partial",
      "empty",
      "no_source",
      "source_stale",
      "cancelled",
      "failed",
    ]),
    /** failed 的机器可读原因；不含绝对路径与笔记内容。 */
    reason: z.string().nullable(),
    candidates: z.array(VaultSearchCandidateSchema),
    /** 检索诊断；no_source 时为 null。 */
    diagnostics: z
      .object({
        /** 索引 coverage 截断（部分文件被排除/超配额）——结果可能不全。 */
        coveragePartial: z.boolean().nullable(),
        /** 服务端是否自动扩大了一次检索（AND 无命中降级）。 */
        matchRelaxedToOr: z.boolean().nullable(),
        /** 语义通道阶段：unavailable/applied/skipped。 */
        semantic: z.enum(["unavailable", "applied", "skipped"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type VaultSearchOutput = z.infer<typeof VaultSearchOutputSchema>;

export const VaultSearchOutputJsonSchema = toToolJsonSchema(VaultSearchOutputSchema);

// -----------------------------------------------
// Tool Call Structure
// -----------------------------------------------

export interface VaultSearchToolCall {
  id: ToolCallId;
  name: "VaultSearch";
  input: VaultSearchInput;
  traceId: TraceId;
  startedAt: Date;
}

export interface VaultSearchToolResult {
  toolCallId: ToolCallId;
  output: VaultSearchOutput;
  traceId: TraceId;
  durationMs: number;
}
