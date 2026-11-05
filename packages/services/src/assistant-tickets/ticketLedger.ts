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
import { parseWriteDomainColumn } from "./writeDomain.js";

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
  /**
   * P2：工单进入终态后的后续动作钩子（事务提交后调用；queued FIFO 释放、W1 worktree
   * 清理挂这里——钩子内部异常只记日志，不回滚已提交归账）。
   */
  readonly onTicketTerminal?: (input: {
    readonly ticketId: string;
    readonly workspaceIdentity: string;
    readonly status: string;
  }) => void;
  /**
   * P4 第二棒（04 详设 §3 工件核验）：W1 worktree 工单 turn ended 进入 awaiting_output
   * 后的核验钩子（事务提交后调用；只读核验编排=reportCompletion.verifyTicketArtifacts
   * ——端口缺席/核验通过/失败/不可用的处置矩阵见该文件头）。钩子内部异常只记日志。
   */
  readonly onAwaitingVerification?: (input: { readonly ticketId: string }) => void;
}

export function createTicketLedger(deps: TicketLedgerDeps): {
  /** 归账一条事件；返回本条是否使工单进入终态（帧接线据此退订）。 */
  applyTicketTurnEvent(input: AssistantTicketTurnEventInput): boolean;
  /**
   * P2 第三信号（02 详设 §5）：sessions-index teamActivity 归账（Mode B 工单）。
   * team completed→done；cancelled/archived→failed（reason=team_<status>，诚实留痕）；
   * 其余状态→running。单调纪律与 usage 累进同 applyTicketTurnEvent。
   */
  applyTicketTeamEvent(input: {
    readonly ticketId: string;
    readonly teamStatus: string;
    readonly atMs: number;
  }): boolean;
} {
  const { db, publish } = deps;

  function applyTicketTeamEvent(input: {
    ticketId: string;
    teamStatus: string;
    atMs: number;
  }): boolean {
    try {
      let becameTerminal = false;
      // 事务内收集、提交后派发（钩子异常只记日志，不回滚已提交归账）。
      const pendingTerminal: Array<{
        ticketId: string;
        workspaceIdentity: string;
        status: string;
      }> = [];
      db.transaction((raw) => {
        const row = raw
          .prepare("SELECT status, usage_accum, updated_ms, target_workspace_identity FROM ticket WHERE id = ?")
          .get(input.ticketId) as
          | { status: string; usage_accum: string; updated_ms: number; target_workspace_identity: string }
          | undefined;
        if (!row) return;
        if (input.atMs < row.updated_ms) return; // 单调丢弃：迟到/重放事件整体忽略
        const terminal =
          row.status === ASSISTANT_TICKET_STATUSES.done ||
          row.status === ASSISTANT_TICKET_STATUSES.failed;
        if (terminal) return; // 终态工单不再改写状态（team 信号无 usage 维度）
        const nextStatus =
          input.teamStatus === "completed"
            ? ASSISTANT_TICKET_STATUSES.done
            : input.teamStatus === "cancelled" || input.teamStatus === "archived"
              ? ASSISTANT_TICKET_STATUSES.failed
              : ASSISTANT_TICKET_STATUSES.running;
        const failReason =
          nextStatus === ASSISTANT_TICKET_STATUSES.failed ? `team_${input.teamStatus}` : null;
        if (
          nextStatus === ASSISTANT_TICKET_STATUSES.done ||
          nextStatus === ASSISTANT_TICKET_STATUSES.failed
        ) {
          becameTerminal = true;
        }
        raw
          .prepare(
            "UPDATE ticket SET status = ?, fail_reason = COALESCE(?, fail_reason), updated_ms = ? WHERE id = ?",
          )
          .run(nextStatus, failReason, Math.max(input.atMs, row.updated_ms), input.ticketId);
        if (nextStatus === ASSISTANT_TICKET_STATUSES.failed) {
          raw
            .prepare(
              "UPDATE mandate SET state = 'revoked', ended_ms = ?, end_reason = ? WHERE ticket_id = ? AND state = 'active'",
            )
            .run(Date.now(), `team_${input.teamStatus}`, input.ticketId);
        }
        if (becameTerminal) {
          // 终态后续动作（queued 释放/worktree 清理）在事务提交后执行，失败不回滚归账。
          pendingTerminal.push({
            ticketId: input.ticketId,
            workspaceIdentity: row.target_workspace_identity,
            status: nextStatus,
          });
        }
      });
      publish();
      flushTerminalHooks(pendingTerminal);
      return becameTerminal;
    } catch (error) {
      logger.error("assistant-tickets teamActivity 归账异常", error);
      return false;
    }
  }

  /** 终态钩子派发（事务提交后；钩子异常只记日志——归账事实已提交，不能被后续动作回滚）。 */
  function flushTerminalHooks(
    pending: ReadonlyArray<{ ticketId: string; workspaceIdentity: string; status: string }>,
  ): void {
    if (!deps.onTicketTerminal) return;
    for (const entry of pending) {
      try {
        deps.onTicketTerminal(entry);
      } catch (error) {
        logger.warn("assistant-tickets 终态后续动作失败", error);
      }
    }
  }

  function applyTicketTurnEvent(input: AssistantTicketTurnEventInput): boolean {
    try {
      let becameTerminal = false;
      let enteredAwaiting = false;
      const pendingTerminal: Array<{
        ticketId: string;
        workspaceIdentity: string;
        status: string;
      }> = [];
      db.transaction((raw) => {
        const row = raw
          .prepare(
            "SELECT status, usage_accum, updated_ms, target_workspace_identity, write_domain, awaiting_since_ms FROM ticket WHERE id = ?",
          )
          .get(input.ticketId) as
          | {
              status: string;
              usage_accum: string;
              updated_ms: number;
              target_workspace_identity: string;
              write_domain: string | null;
              awaiting_since_ms: number | null;
            }
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
        // P4 第二棒（04 详设 §3 工件核验）：turn completed 的 done 判据升级为
        // 「turn ended + 派发桥只读核验」——W1 worktree 工单先进 awaiting_output 滞留
        // （schema v6 awaiting_since_ms），提交后经 onAwaitingVerification 异步核验：
        // 通过→done / 失败→滞留喂 watchdog / 不可用→滞留待人工（矩阵见 reportCompletion）。
        // 非 W1 工单无工件契约，维持 turn ended→done 不变。
        const isW1Worktree =
          nextStatus === ASSISTANT_TICKET_STATUSES.done &&
          parseWriteDomainColumn(row.write_domain)?.kind === "worktree";
        const effectiveStatus = isW1Worktree
          ? ASSISTANT_TICKET_STATUSES.awaitingOutput
          : nextStatus;
        if (
          !terminal &&
          effectiveStatus !== row.status &&
          (effectiveStatus === ASSISTANT_TICKET_STATUSES.done ||
            effectiveStatus === ASSISTANT_TICKET_STATUSES.failed)
        ) {
          becameTerminal = true;
        }
        if (
          !terminal &&
          effectiveStatus !== row.status &&
          effectiveStatus === ASSISTANT_TICKET_STATUSES.awaitingOutput
        ) {
          enteredAwaiting = true;
        }
        // awaiting_since_ms 列维护：进入 awaiting 记起始（单调基准与 updated_ms 同口径）；
        // 离开 awaiting（新 turn/失败/取消）清除；其余（含 usage_snapshot 原态）保持。
        const nextAwaitingSinceMs =
          effectiveStatus === ASSISTANT_TICKET_STATUSES.awaitingOutput
            ? Math.max(input.atMs, row.updated_ms)
            : row.status === ASSISTANT_TICKET_STATUSES.awaitingOutput
              ? null
              : row.awaiting_since_ms;
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
            "UPDATE ticket SET status = ?, output_summary = COALESCE(?, output_summary), fail_reason = COALESCE(?, fail_reason), usage_accum = ?, awaiting_since_ms = ?, updated_ms = ? WHERE id = ?",
          )
          .run(
            effectiveStatus,
            outputSummary,
            failReason,
            JSON.stringify(accum),
            nextAwaitingSinceMs,
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
        if (becameTerminal) {
          pendingTerminal.push({
            ticketId: input.ticketId,
            workspaceIdentity: row.target_workspace_identity,
            status: effectiveStatus,
          });
        }
      });
      publish();
      // W1 工单进入核验滞留：事务提交后异步核验（钩子异常只记日志——滞留事实已提交）。
      if (enteredAwaiting && deps.onAwaitingVerification) {
        try {
          deps.onAwaitingVerification({ ticketId: input.ticketId });
        } catch (error) {
          logger.warn("assistant-tickets 工件核验钩子异常（滞留保持，待人工确认）", error);
        }
      }
      flushTerminalHooks(pendingTerminal);
      return becameTerminal;
    } catch (error) {
      logger.error("assistant-tickets turn 事件归账异常", error);
      return false;
    }
  }

  return { applyTicketTurnEvent, applyTicketTeamEvent };
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
