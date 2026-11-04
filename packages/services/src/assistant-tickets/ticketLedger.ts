/**
 * ticketLedger——turn 事件归账（00 master plan §2 PR-1A 文件表；01 详设 §3 映射表；
 * PR-1B 三审发现 6 的服务侧核心）。host 内部纯归账终点：**不经 RPC**（不进
 * IAssistantTicketService 代理面，renderer 不可达），由装配层（node.ts ticketLedger
 * 帧接线，随 PR-1A 后续批次）从会话帧解析后调用。
 *
 * 语义（01 §1.1/§3）：
 * - 单调丢弃：`atMs < ticket.updated_ms` 的迟到/重放事件整体忽略（resync 竞态纪律）；
 * - 状态机：dispatched/running → running（turn_started）/ done（turn_completed）/
 *   failed（turn_failed/turn_cancelled，mandate 同事务撤销）；终态工单不再改写状态
 *   （usage 仍记账）；
 * - usage 差值归账：`usage` 为会话累计值，差值=本次累计−usage_accum.lastCumulative，
 *   逐差值行写 usage_log，usage_accum 累进并更新 lastCumulative；累计回退（新会话
 *   计数器重置）按 0 记、仍推进 lastCumulative（诚实不记负数）；
 * - output_summary：turn_completed 的尾消息首行，服务侧截断 120 code point
 *   （01 §1.1，与 brief 同一 ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax 上界）。
 */
import { ASSISTANT_SNAPSHOT_LIMITS, ASSISTANT_TICKET_STATUSES } from "@drora/shared";

import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase } from "./assistantDatabase.js";

const logger = createServiceLogger("assistant-tickets");

export type AssistantTicketTurnEventKind =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "turn_cancelled";

export interface AssistantTicketTurnEventInput {
  readonly ticketId: string;
  /** 事件时刻；早于工单 updated_ms 的迟到/重放事件按单调纪律整体忽略（01 §3）。 */
  readonly atMs: number;
  readonly kind: AssistantTicketTurnEventKind;
  /** turn_completed 的尾 assistant 消息（服务侧截断 120 code point，01 §1.1）。 */
  readonly outputSummary?: string;
  /** turn_failed/turn_cancelled 的原因（诚实留痕，不自动重试）。 */
  readonly failReason?: string;
  /** snapshot.usage 会话累计值（差值归账：本次−上次已记，01 §3）。 */
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  };
}

export interface TicketLedgerDeps {
  /** 台账库（单写者连接；归账自持事务，mandate 撤销与工单更新同事务）。 */
  readonly db: AssistantDatabase;
  /** 归账后推送快照（服务闭包的 publish）。 */
  readonly publish: () => void;
}

export function createTicketLedger(deps: TicketLedgerDeps): {
  applyTicketTurnEvent(input: AssistantTicketTurnEventInput): void;
} {
  const { db, publish } = deps;

  function applyTicketTurnEvent(input: AssistantTicketTurnEventInput): void {
    try {
      db.transaction((raw) => {
        const row = raw
          .prepare("SELECT status, usage_accum, updated_ms FROM ticket WHERE id = ?")
          .get(input.ticketId) as
          | { status: string; usage_accum: string; updated_ms: number }
          | undefined;
        if (!row) return;
        if (input.atMs < row.updated_ms) return; // 单调丢弃：迟到/重放事件整体忽略
        const accum = JSON.parse(row.usage_accum) as {
          inputTokens?: number;
          outputTokens?: number;
          lastCumulative?: {
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
          };
        };
        const last = accum.lastCumulative ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
        const cumulative = {
          inputTokens: input.usage?.inputTokens ?? last.inputTokens,
          outputTokens: input.usage?.outputTokens ?? last.outputTokens,
          cacheReadTokens: input.usage?.cacheReadTokens ?? last.cacheReadTokens,
          cacheWriteTokens: input.usage?.cacheWriteTokens ?? last.cacheWriteTokens,
        };
        const diff = {
          inputTokens: Math.max(0, cumulative.inputTokens - last.inputTokens),
          outputTokens: Math.max(0, cumulative.outputTokens - last.outputTokens),
          cacheReadTokens: Math.max(0, cumulative.cacheReadTokens - last.cacheReadTokens),
          cacheWriteTokens: Math.max(0, cumulative.cacheWriteTokens - last.cacheWriteTokens),
        };
        if (Object.values(diff).some((value) => value > 0)) {
          raw
            .prepare(
              "INSERT INTO usage_log(ticket_id, turn_ref, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, at_ms) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              input.ticketId,
              `${input.kind}@${input.atMs}`,
              diff.inputTokens,
              diff.outputTokens,
              diff.cacheReadTokens,
              diff.cacheWriteTokens,
              input.atMs,
            );
        }
        accum.inputTokens = (accum.inputTokens ?? 0) + diff.inputTokens;
        accum.outputTokens = (accum.outputTokens ?? 0) + diff.outputTokens;
        accum.lastCumulative = cumulative;

        const terminal =
          row.status === ASSISTANT_TICKET_STATUSES.done ||
          row.status === ASSISTANT_TICKET_STATUSES.failed;
        const nextStatus = terminal ? row.status : resolveEventStatus(input.kind);
        let outputSummary: string | null = null;
        let failReason: string | null = null;
        if (!terminal) {
          if (input.kind === "turn_completed") {
            outputSummary = truncateOutputSummary(input.outputSummary);
          }
          if (input.kind === "turn_failed" || input.kind === "turn_cancelled") {
            failReason = input.failReason ?? input.kind;
          }
        }
        raw
          .prepare(
            "UPDATE ticket SET status = ?, output_summary = COALESCE(?, output_summary), fail_reason = COALESCE(?, fail_reason), usage_accum = ?, updated_ms = ? WHERE id = ?",
          )
          .run(
            nextStatus,
            outputSummary,
            failReason,
            JSON.stringify(accum),
            Math.max(input.atMs, row.updated_ms),
            input.ticketId,
          );
        if (!terminal && (input.kind === "turn_failed" || input.kind === "turn_cancelled")) {
          // mandate 撤销与工单更新同事务（markTicketFailed 同款语义，三途径之二）。
          raw
            .prepare(
              "UPDATE mandate SET state = 'revoked', ended_ms = ?, end_reason = ? WHERE ticket_id = ? AND state = 'active'",
            )
            .run(Date.now(), `turn_${input.kind}: ${failReason}`, input.ticketId);
        }
      });
      publish();
    } catch (error) {
      logger.error("assistant-tickets turn 事件归账异常", error);
    }
  }

  return { applyTicketTurnEvent };
}

function resolveEventStatus(kind: AssistantTicketTurnEventKind): string {
  switch (kind) {
    case "turn_started":
      return ASSISTANT_TICKET_STATUSES.running;
    case "turn_completed":
      return ASSISTANT_TICKET_STATUSES.done;
    default:
      return ASSISTANT_TICKET_STATUSES.failed;
  }
}

/** 截断为尾消息首行的 ≤120 code point 摘要（01 §1.1；空输入保持 null）。 */
function truncateOutputSummary(summary: string | undefined): string | null {
  if (summary === undefined) return null;
  const firstLine = summary.includes("\n") ? summary.slice(0, summary.indexOf("\n")) : summary;
  return firstLine.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax);
}
