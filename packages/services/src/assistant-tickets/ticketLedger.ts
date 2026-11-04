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
  | "turn_cancelled"
  /** 仅记账不改状态（conversation 帧 state.updated 带 usage；解析层 01 §3）。 */
  | "usage_snapshot";

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
  /** 归账一条事件；返回本条是否使工单进入终态（帧接线据此退订）。 */
  applyTicketTurnEvent(input: AssistantTicketTurnEventInput): boolean;
} {
  const { db, publish } = deps;

  function applyTicketTurnEvent(input: AssistantTicketTurnEventInput): boolean {
    try {
      let becameTerminal = false;
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
        const nextStatus =
          input.kind === "usage_snapshot"
            ? row.status
            : terminal
              ? row.status
              : resolveEventStatus(input.kind);
        if (
          !terminal &&
          nextStatus !== row.status &&
          (nextStatus === ASSISTANT_TICKET_STATUSES.done ||
            nextStatus === ASSISTANT_TICKET_STATUSES.failed)
        ) {
          becameTerminal = true;
        }
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
      return becameTerminal;
    } catch (error) {
      logger.error("assistant-tickets turn 事件归账异常", error);
      return false;
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

// ---------------------------------------------------------------------------
// 帧解析（01 §3 映射表的实现侧）。输入是 droraAgentService.onDynamicConversationFrame
// 发出的 ConversationTopicWireCandidate——上游在 fire 前已经
// conversationTopicWireCandidateSchema.safeParse 校验（droraAgentService.ts:2826），
// 这里做防御式字段读取（不用 zod 重验）：帧非法时返回空数组，绝不抛错。
// ---------------------------------------------------------------------------

interface FrameUsageCumulative {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
}

function readUsage(
  patchUsage: FrameUsageCumulative | undefined,
): AssistantTicketTurnEventInput["usage"] | undefined {
  if (typeof patchUsage !== "object" || patchUsage === null) return undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  // wire 形态是 sessionUsageStateSchema：累计值嵌套在 cumulative 键下
  // （snapshot.ts:195-212）；直接平铺形态仅测试便利，两种都收。
  const cumulativeRaw = (patchUsage as { cumulative?: unknown }).cumulative;
  const source =
    typeof cumulativeRaw === "object" && cumulativeRaw !== null
      ? (cumulativeRaw as FrameUsageCumulative)
      : patchUsage;
  const inputTokens = num(source.inputTokens);
  const outputTokens = num(source.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: num(source.cacheReadTokens) ?? 0,
    cacheWriteTokens: num(patchUsage.cacheWriteTokens) ?? 0,
  };
}

/**
 * 把一帧 conversation wire candidate 解析为零或多条归账事件（按帧序排列）。
 * 映射（01 §3）：row.appended/row.upserted 的 userInput 行 → turn_started（我们派发的
 * brief 进转录即轮起点）；assistantText 行 state=streaming → turn_started、complete →
 * turn_completed（outputSummary=行文本）、failed → turn_failed、interrupted →
 * turn_cancelled（用户 stop 的诚实留痕）；state.updated 带 usage → usage_snapshot
 * （仅记账）；snapshot 载荷（resync）→ usage_snapshot（usage 累计是全量快照值，
 * 差值由台账单调/差值纪律消化）。
 */
export function parseTicketFrameEvents(
  candidate: unknown,
  sessionId: string,
): AssistantTicketTurnEventInput[] {
  const events: AssistantTicketTurnEventInput[] = [];
  if (typeof candidate !== "object" || candidate === null) return events;
  const frame = candidate as {
    topic?: unknown;
    sentAt?: unknown;
    payload?: {
      kind?: unknown;
      snapshot?: { usage?: FrameUsageCumulative; rows?: unknown };
      deltas?: unknown;
    };
  };
  if (frame.topic !== `conversation/${sessionId}`) return events;
  const atMs =
    typeof frame.sentAt === "number" && Number.isFinite(frame.sentAt) ? frame.sentAt : Date.now();
  const payload = frame.payload;
  if (typeof payload !== "object" || payload === null) return events;

  if (payload.kind === "snapshot") {
    const usage = readUsage(payload.snapshot?.usage);
    if (usage) events.push({ ticketId: "", atMs, kind: "usage_snapshot", usage });
    return events;
  }
  if (payload.kind !== "deltas" || !Array.isArray(payload.deltas)) return events;

  let pendingUsage: AssistantTicketTurnEventInput["usage"] | undefined;
  for (const delta of payload.deltas) {
    if (typeof delta !== "object" || delta === null) continue;
    const d = delta as {
      op?: unknown;
      row?: { kind?: unknown; state?: unknown; text?: unknown };
      patch?: { usage?: FrameUsageCumulative };
    };
    if (d.op === "state.updated" && typeof d.patch === "object" && d.patch !== null) {
      const usage = readUsage(d.patch.usage);
      if (usage) pendingUsage = usage;
      continue;
    }
    if (
      (d.op === "row.appended" || d.op === "row.upserted") &&
      typeof d.row === "object" &&
      d.row !== null
    ) {
      const rowKind = d.row.kind;
      const rowState = d.row.state;
      const text = typeof d.row.text === "string" ? d.row.text : undefined;
      if (rowKind === "userInput") {
        events.push({ ticketId: "", atMs, kind: "turn_started" });
      } else if (rowKind === "assistantText") {
        if (rowState === "streaming") {
          events.push({ ticketId: "", atMs, kind: "turn_started" });
        } else if (rowState === "complete") {
          events.push({ ticketId: "", atMs, kind: "turn_completed", outputSummary: text });
        } else if (rowState === "failed") {
          events.push({
            ticketId: "",
            atMs,
            kind: "turn_failed",
            failReason: "assistant_row_failed",
          });
        } else if (rowState === "interrupted") {
          events.push({
            ticketId: "",
            atMs,
            kind: "turn_cancelled",
            failReason: "assistant_row_interrupted",
          });
        }
      }
    }
  }
  // usage 事件排在行事件之后：本轮 token 累计发生在这些行产生之后，差值归账不丢账。
  if (pendingUsage) {
    events.push({ ticketId: "", atMs, kind: "usage_snapshot", usage: pendingUsage });
  }
  // ticketId 留空由调用方回填（parse 层只认 sessionId；ticket↔session 映射属服务闭包）。
  return events;
}
