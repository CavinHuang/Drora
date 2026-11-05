/**
 * 代际（incarnation）纯模块（specs/drora-personal-assistant.md §8；02 详设 §3）。
 *
 * - 身份锚在工单：incarnation_current 是当代执行体指针（JSON，P1 形状的超集——新增
 *   anchorCommandId/dispatchSeq/worktree/hostPath 字段，缺省兼容 P1 行）；
 * - anchor=该代最后一次成功 sendText 的 commandId（=`<ticketId>-<投递序号>`，kv 计数）；
 * - incarnation_generations[] 追加 {sessionId, fromMs, toMs, cause, note}；
 * - 任一时刻最多一代 active（无 DB 级唯一索引可表达「JSON 数组内至多一条未闭合代」，
 *   由 appendGeneration 的闭合纪律 + 单测锁定：追加前必须闭合旧代）；
 * - 换代不改写 usage_accum（按 ticketId 记账）；
 * - 触发源仅三种（spec §8，禁超时兜底）：锚校验失配/生命周期删除归档/lease 失效超窗。
 *
 * 纯模块：无 IO。
 */
import {
  ASSISTANT_GENERATION_CAUSES,
  type AssistantGenerationCause,
} from "@drora/shared";

/** 当代执行体指针（ticket.incarnation_current JSON）。 */
export interface AssistantIncarnation {
  readonly workspaceIdentity: string;
  readonly sessionId: string | null;
  readonly boundAtMs: number;
  readonly cause: string;
  /** 本代最后一次成功投递的 commandId（anchor；null=尚未投递）。 */
  anchorCommandId?: string | null;
  /** 本代已投递次数（=下一次投递序号；与 kv dispatch_seq 双记账，行内为准）。 */
  dispatchSeq?: number;
  /** W1 续用域（换代不重复 add）。 */
  worktree?: { readonly path: string; readonly branch: string };
  /** host 侧会话落位路径（assistant 虚拟 workspace 或 worktree 真实目录）。 */
  hostPath?: string;
}

/** 历史代（ticket.incarnation_generations[] 元素）。 */
export interface AssistantIncarnationGeneration {
  readonly sessionId: string | null;
  readonly fromMs: number;
  readonly toMs: number;
  readonly cause: AssistantGenerationCause;
  readonly note?: string;
}

export function parseIncarnation(json: string): AssistantIncarnation {
  const parsed = JSON.parse(json) as Partial<AssistantIncarnation>;
  return {
    workspaceIdentity: parsed.workspaceIdentity ?? "",
    sessionId: parsed.sessionId ?? null,
    boundAtMs: parsed.boundAtMs ?? 0,
    cause: parsed.cause ?? "dispatched",
    anchorCommandId: parsed.anchorCommandId ?? null,
    dispatchSeq: parsed.dispatchSeq ?? 0,
    worktree: parsed.worktree,
    hostPath: parsed.hostPath,
  };
}

export function serializeIncarnation(incarnation: AssistantIncarnation): string {
  return JSON.stringify(incarnation);
}

/** P2 幂等键：`<ticketId>-<投递序号>`（02 §3 commandId 规则升级；kv 计数由服务事务自增）。 */
export function composeDispatchCommandId(ticketId: string, dispatchSeq: number): string {
  return `${ticketId}-${dispatchSeq}`;
}

/**
 * 追加历史代：必须先闭合旧代（toMs>0），否则抛错——「任一时刻最多一代 active」的
 * 结构化表达；调用方（换代事务）保证顺序：闭合旧代 → 追加 → 立新代。
 */
export function appendGeneration(
  generations: readonly AssistantIncarnationGeneration[],
  entry: AssistantIncarnationGeneration,
): AssistantIncarnationGeneration[] {
  const last = generations[generations.length - 1];
  if (last && last.toMs <= 0) {
    throw new Error(
      `换代纪律破坏：存在未闭合代（sessionId=${last.sessionId}）——必须先闭合旧代再追加`,
    );
  }
  return [...generations, entry];
}

/** 代际 cause 归一（越界值如实按 lost 记并保留原词于 note；不猜测）。 */
export function normalizeGenerationCause(
  cause: string,
): { cause: AssistantGenerationCause; noteSuffix?: string } {
  const values = Object.values(ASSISTANT_GENERATION_CAUSES) as string[];
  if (values.includes(cause)) {
    return { cause: cause as AssistantGenerationCause };
  }
  return { cause: ASSISTANT_GENERATION_CAUSES.lost, noteSuffix: `cause=${cause}` };
}

export interface GenerationDigestInput {
  /** 代际序号（1 起；新代=历史数+1）。 */
  readonly nextGeneration: number;
  /** 历史 output_summary（时间升序；可为空）。 */
  readonly outputSummaries: readonly { readonly atMs: number; readonly summary: string }[];
  /** usage_accum 合计（换账不改写：仅汇总展示）。 */
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  /** 未确认增量标注（spec §2.4 诚实规则；无则给缺省文案）。 */
  readonly unconfirmedNote?: string;
}

/** 换代重派 brief 的台账浓缩段（02 §3：历史 output_summary + usage 合计 + 未确认增量标注）。 */
export function composeGenerationDigest(input: GenerationDigestInput): string {
  const lines: string[] = [`第 ${input.nextGeneration} 代重启（台账浓缩，编排事实以台账为准）。`];
  if (input.outputSummaries.length > 0) {
    lines.push("前代产出摘要：");
    for (const item of input.outputSummaries) {
      lines.push(`- @${item.atMs} ${item.summary}`);
    }
  } else {
    lines.push("前代无产出摘要。");
  }
  lines.push(
    `前代累计消耗：input ${input.usage.inputTokens} / output ${input.usage.outputTokens} tokens（换代不换账）。`,
  );
  lines.push(
    `未确认增量：${input.unconfirmedNote ?? `第 ${input.nextGeneration - 1} 代末尾改动未汇报，落地前请自行核对。`}`,
  );
  return lines.join("\n");
}

/** 锚校验判定（spec §8 表：fork/rewind → 失配；删除/归档 → 失位）。 */
export type AnchorProbe =
  | { readonly kind: "ok" }
  | { readonly kind: "missing"; readonly deleted: boolean }
  | { readonly kind: "unavailable"; readonly reason: string };

export function resolveAnchorVerdict(probe: AnchorProbe): {
  mismatch: boolean;
  reason: string;
} {
  if (probe.kind === "ok") return { mismatch: false, reason: "" };
  if (probe.kind === "missing") {
    return {
      mismatch: true,
      reason: probe.deleted ? "锚会话已删除" : "锚会话已失位（fork/rewind/归档）",
    };
  }
  return { mismatch: true, reason: `锚对账不可用：${probe.reason}` };
}
