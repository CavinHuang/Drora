/**
 * P10a（10 号详设 §2.4）：readMateThread 的实现件——对话流分页只读。
 *
 * 对话流=台账的消息投影（零新状态所有者）：三源 SQL 合并——trigger（用户消息
 * verbatim）/ admission_decision JOIN router_evaluation（决策卡+答复 answer）/
 * ticket 终态行（done/failed 摘要行；非终态不进流，活动态走决策卡/工单区既有面）。
 * 按时间倒序取、**正序返回**；快照 triggersMax/decisionsMax 截断版仍作首屏，上滑
 * 加载走本方法。只读（单写者纪律不动；照 getConfig 先例开在 channel 面）。
 *
 * 排序与分页语义（本文件即单出处）：
 * - 升序呈现序=(atMs 升, kind 序 trigger→decision→ticket, 同源 id 升)；trigger 与其
 *   decision 同事务同刻，同刻并列按该序呈现（用户消息在答复/卡前）；
 * - 三源各自 DESC 取 limit 条（时刻 DESC、kind 序逆、id DESC），JS 归并后截 limit、
 *   整页反转得升序；
 * - **分页界不切开同刻并列组**：界内补齐同刻剩余行（页可略超 limit）——否则下一页
 *   `atMs < nextBeforeMs` 会跳过并列残行（如某 trigger 已入页而其 decision 永久丢失）；
 * - nextBeforeMs=主查询满页时本页最旧时刻（可能恰好耗尽——下一页空即停），否则 null。
 *
 * 纯读模块：无写、无 publish；trigger/decision 视图复用 assistantSnapshot 的共用
 * 映射（单一投影口径，不建第二读路径）。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_TICKET_STATUSES,
  MATE_THREAD_LIMITS,
} from "@drora/shared";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import type {
  AssistantResult,
  IAssistantTicketService,
  MateThreadRow,
} from "./assistantTickets.js";
import {
  assistantDecisionRowToView,
  assistantTriggerRowToView,
  type AssistantDecisionRowDb,
  type AssistantTriggerRowDb,
} from "./assistantSnapshot.js";

/** 归并行（时刻+kind 序+同源 id；kind 序=升序呈现序 trigger(0)→decision(1)→ticket(2)）。 */
interface MergedRow {
  readonly atMs: number;
  readonly rank: 0 | 1 | 2;
  readonly id: string;
  readonly row: MateThreadRow;
}

/** DESC 归并比较器：时刻降序 → kind 序降序（升序反转后 trigger 在前）→ id 降序。 */
function compareDesc(a: MergedRow, b: MergedRow): number {
  if (b.atMs !== a.atMs) return b.atMs - a.atMs;
  if (b.rank !== a.rank) return b.rank - a.rank;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

export interface ReadMateThreadInput {
  readonly workspaceKey?: string;
  readonly limit?: number;
  readonly beforeMs?: number;
}

/**
 * 分页读对话流（readMateThread 服务方法的实现体）。入参校验 fail-closed：
 * limit 非 [1, maxPageSize] 整数 / beforeMs 非有限数 → validationFailed（不猜测收敛）。
 */
export function readAssistantMateThread(
  raw: AssistantDatabaseRaw,
  input: ReadMateThreadInput,
): AssistantResult<{
  readonly rows: readonly MateThreadRow[];
  readonly nextBeforeMs: number | null;
}> {
  const limit = input.limit ?? MATE_THREAD_LIMITS.defaultPageSize;
  if (!Number.isInteger(limit) || limit < 1 || limit > MATE_THREAD_LIMITS.maxPageSize) {
    return {
      ok: false as const,
      error: {
        code: ASSISTANT_ERROR_CODES.validationFailed,
        reason: `limit 必须为 1-${MATE_THREAD_LIMITS.maxPageSize} 的整数（缺省 ${MATE_THREAD_LIMITS.defaultPageSize}）`,
      },
    };
  }
  if (input.beforeMs !== undefined && !Number.isFinite(input.beforeMs)) {
    return {
      ok: false as const,
      error: {
        code: ASSISTANT_ERROR_CODES.validationFailed,
        reason: "beforeMs 必须为有限数",
      },
    };
  }
  const workspaceKey = input.workspaceKey?.trim() || undefined;

  const triggerRows = raw
    .prepare(
      `SELECT id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms, channel_ref, remote_session_id
       FROM trigger WHERE 1=1${input.beforeMs !== undefined ? " AND at_ms < ?" : ""}${workspaceKey ? " AND workspace_identity = ?" : ""}
       ORDER BY at_ms DESC, id DESC LIMIT ?`,
    )
    .all(
      ...(input.beforeMs !== undefined ? [input.beforeMs] : []),
      ...(workspaceKey ? [workspaceKey] : []),
      limit,
    ) as AssistantTriggerRowDb[];
  const decisionRows = raw
    .prepare(
      `SELECT d.id, d.trigger_id, d.strength, d.mode, d.outcome, d.decided_by, d.decided_ms, t.text AS trigger_text,
              t.source_kind AS trigger_source_kind,
              r.state AS router_state, r.verdict AS router_verdict, r.error AS router_error,
              r.answer_text AS router_answer,
              d.manage_state, d.manage_note
       FROM admission_decision d
       JOIN trigger t ON t.id = d.trigger_id
       LEFT JOIN router_evaluation r ON r.decision_id = d.id
       WHERE 1=1${input.beforeMs !== undefined ? " AND d.decided_ms < ?" : ""}${workspaceKey ? " AND t.workspace_identity = ?" : ""}
       ORDER BY d.decided_ms DESC, d.id DESC LIMIT ?`,
    )
    .all(
      ...(input.beforeMs !== undefined ? [input.beforeMs] : []),
      ...(workspaceKey ? [workspaceKey] : []),
      limit,
    ) as AssistantDecisionRowDb[];
  const ticketRows = raw
    .prepare(
      `SELECT id, brief, status, target_workspace_identity, output_summary, fail_reason, updated_ms, incarnation_generations
       FROM ticket
       WHERE status IN (?, ?)${input.beforeMs !== undefined ? " AND updated_ms < ?" : ""}${workspaceKey ? " AND target_workspace_identity = ?" : ""}
       ORDER BY updated_ms DESC, id DESC LIMIT ?`,
    )
    .all(
      ASSISTANT_TICKET_STATUSES.done,
      ASSISTANT_TICKET_STATUSES.failed,
      ...(input.beforeMs !== undefined ? [input.beforeMs] : []),
      ...(workspaceKey ? [workspaceKey] : []),
      limit,
    ) as Array<{
    id: string;
    brief: string;
    status: string;
    target_workspace_identity: string | null;
    output_summary: string | null;
    fail_reason: string | null;
    updated_ms: number;
    incarnation_generations: string;
  }>;

  const merged: MergedRow[] = [
    ...triggerRows.map((row): MergedRow => {
      const view = assistantTriggerRowToView(row);
      return {
        atMs: view.atMs,
        rank: 0,
        id: view.id,
        row: { kind: "trigger", atMs: view.atMs, trigger: view },
      };
    }),
    ...decisionRows.map((row): MergedRow => {
      const view = assistantDecisionRowToView(row);
      return {
        atMs: view.decidedMs,
        rank: 1,
        id: String(view.id),
        row: { kind: "decision", atMs: view.decidedMs, decision: view },
      };
    }),
    ...ticketRows.map((row): MergedRow => {
      let generationCount: number | undefined;
      try {
        const generations = JSON.parse(row.incarnation_generations) as unknown;
        if (Array.isArray(generations)) generationCount = generations.length;
      } catch {
        // 坏 JSON=旧行/防御态——不携带代际数（诚实降级，快照同款 try/catch 口径）。
      }
      return {
        atMs: row.updated_ms,
        rank: 2,
        id: row.id,
        row: {
          kind: "ticket",
          atMs: row.updated_ms,
          ticket: {
            ticketId: row.id,
            brief: row.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax),
            status: row.status,
            targetWorkspaceIdentity: row.target_workspace_identity,
            outputSummary: row.output_summary,
            failReason: row.fail_reason,
            ...(generationCount !== undefined ? { generationCount } : {}),
          },
        },
      };
    }),
  ].sort(compareDesc);

  const mainPage = merged.slice(0, limit);
  // 分页界不切开同刻并列组：主查询满页时补齐界刻剩余行（补齐范围=各源本窗取回集；
  // 单事务写 trigger+decision 的常态并列组远小于页界。病理态——同刻行数超各源单窗
  // limit——界刻仍可能留残行，属「同刻批量导入超页界」的既有上界，不静默扩窗）。
  let page = mainPage;
  if (mainPage.length === limit) {
    const boundary = mainPage[mainPage.length - 1]!;
    const extras = merged
      .slice(limit)
      .filter((row) => row.atMs === boundary.atMs)
      .sort(compareDesc);
    page = [...mainPage, ...extras];
  }
  const rows = page.map((entry) => entry.row).reverse();
  const nextBeforeMs = mainPage.length === limit ? mainPage[mainPage.length - 1]!.atMs : null;
  return { ok: true as const, value: { rows, nextBeforeMs } };
}

// ---------------------------------------------------------------------------
// 服务闭包工厂（assistantTicketsService ≤800 行纪律，照 configActions 拆分先例）：
// busy/migration 错误分类与 getConfig 同款。
// ---------------------------------------------------------------------------

/** readMateThread 的服务方法件（只读；异常分类照 getConfig）。 */
export function createMateThreadReader(deps: {
  readonly db: AssistantDatabase;
}): IAssistantTicketService["readMateThread"] {
  return async (input) => {
    try {
      return readAssistantMateThread(deps.db.raw, input);
    } catch (error) {
      if (error instanceof AssistantStoreBusyError) {
        return { ok: false, error: { code: ASSISTANT_ERROR_CODES.storeBusy } };
      }
      if (error instanceof AssistantStoreMigrationError) {
        return {
          ok: false,
          error: {
            code: ASSISTANT_ERROR_CODES.storeMigration,
            reason: String(error.message),
          },
        };
      }
      throw error;
    }
  };
}
