/**
 * Mandate 变更途径之二/三的服务面（specs/drora-personal-assistant.md §5 三途径；
 * 从 assistantTicketsService 拆出——单文件 ≤800 行纪律，quotaCenterService 同款先例）。
 *
 * - stopMandate（用户 stop）：工单未终态时终止（failed/stopped_by_user 留痕）+
 *   mandate stopped + 帧订阅退订 + 终态后续（worktree 清理+FIFO 释放）。
 * - revokeMandate（校验失败撤销）：仅 mandate 侧撤销留痕（工单状态由归账路径处置）。
 *
 * 纯编排：db/引擎/发布由服务闭包注入；事务纪律与主服务一致（单写者连接）。
 * 失败臂映射与主服务同款（busy→storeBusy / 迁移→storeMigration / 其余原样上抛）。
 */
import { ASSISTANT_ERROR_CODES } from "@drora/shared";
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import type { AssistantResult } from "./assistantTickets.js";

function nowMs(): number {
  return Date.now();
}

/**
 * 「校验失败撤销」mandate 的唯一写路径（2026-11-06 审查 G1 收敛：此前本语义有三处
 * 逐字重复的内联 SQL——dispatchEngine.markTicketFailed / ticketLedger teamActivity /
 * ticketLedger turn_failed——与本服务面 revokeMandate（SELECT mandate_id 后按 id 撤）
 * 双路径并存，违反 AGENTS「避免多条写入路径」纪律）。裁决：生产路径全部收敛到本函数
 * （事务内传 raw 复用同一连接，不拆分事务边界），revokeMandate 服务方法同走此路径。
 * 语句形态保持生产侧原样（WHERE ticket_id + state='active'，幂等：无活动 mandate 时
 * 零行更新）；调用方各自维持原有的 ended_ms 时域（Date.now()/nowMs）与 end_reason
 * 前缀（dispatch_failed/team_/turn_），本函数不改写语义。
 */
export function revokeActiveMandateInTransaction(
  raw: AssistantDatabaseRaw,
  input: { ticketId: string; reason: string; endedMs: number },
): void {
  raw
    .prepare(
      "UPDATE mandate SET state = ?, ended_ms = ?, end_reason = ? WHERE ticket_id = ? AND state = ?",
    )
    .run("revoked", input.endedMs, input.reason, input.ticketId, "active");
}

export interface MandateActionsDeps {
  readonly db: AssistantDatabase;
  /** 帧订阅退订（stopMandate 路径；引擎注入——本模块不建第二条订阅面）。 */
  readonly unwatchSession: (sessionId: string) => void;
  /** 用户 stop 直改终态后的清理+queued 释放（引擎注入）。 */
  readonly handleManualStop: (ticketId: string) => void;
  readonly publish: () => void;
}

export function createMandateActions(deps: MandateActionsDeps): {
  stopMandate(input: { ticketId: string }): Promise<AssistantResult<{ ok: true }>>;
  revokeMandate(input: { ticketId: string; reason: string }): Promise<AssistantResult<{ ok: true }>>;
} {
  const { db } = deps;

  return {
    async stopMandate(input) {
      try {
        // 订阅退订与台账更新解耦：先查 incarnation.sessionId 再在事务外退订。
        const sessionRow = db.raw
          .prepare("SELECT incarnation_current FROM ticket WHERE id = ?")
          .get(input.ticketId) as { incarnation_current: string } | undefined;
        db.transaction((raw) => {
          const ticket = raw
            .prepare("SELECT mandate_id, status FROM ticket WHERE id = ?")
            .get(input.ticketId) as { mandate_id: string; status: string } | undefined;
          if (!ticket) return;
          if (
            ticket.status !== ASSISTANT_TICKET_STATUSES.done &&
            ticket.status !== ASSISTANT_TICKET_STATUSES.failed
          ) {
            raw
              .prepare("UPDATE ticket SET status = ?, fail_reason = ?, updated_ms = ? WHERE id = ?")
              .run(ASSISTANT_TICKET_STATUSES.failed, "stopped_by_user", nowMs(), input.ticketId);
          }
          raw
            .prepare(
              "UPDATE mandate SET state = ?, ended_ms = ?, end_reason = ? WHERE id = ? AND state = ?",
            )
            .run("stopped", nowMs(), "user_stop", ticket.mandate_id, "active");
        });
        if (sessionRow) {
          const incarnation = JSON.parse(sessionRow.incarnation_current) as { sessionId?: string };
          if (incarnation.sessionId) deps.unwatchSession(incarnation.sessionId);
        }
        // 用户 stop 的直改终态也走终态后续（worktree 清理 + queued FIFO 释放）。
        deps.handleManualStop(input.ticketId);
        deps.publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) {
          return { ok: false, error: { code: ASSISTANT_ERROR_CODES.storeBusy } };
        }
        if (error instanceof AssistantStoreMigrationError) {
          return {
            ok: false,
            error: { code: ASSISTANT_ERROR_CODES.storeMigration, reason: String(error.message) },
          };
        }
        throw error;
      }
    },

    async revokeMandate(input) {
      try {
        db.transaction((raw) => {
          // G1 收敛：唯一写路径 revokeActiveMandateInTransaction（原 SELECT+按 id 撤
          // 与生产内联 UPDATE-by-ticket_id 双路径并存；语义等价——工单当前活动 mandate
          // 至多一条，语句形态与生产三处一致）。
          revokeActiveMandateInTransaction(raw, {
            ticketId: input.ticketId,
            reason: input.reason,
            endedMs: nowMs(),
          });
        });
        deps.publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) {
          return { ok: false, error: { code: ASSISTANT_ERROR_CODES.storeBusy } };
        }
        if (error instanceof AssistantStoreMigrationError) {
          return {
            ok: false,
            error: { code: ASSISTANT_ERROR_CODES.storeMigration, reason: String(error.message) },
          };
        }
        throw error;
      }
    },
  };
}
