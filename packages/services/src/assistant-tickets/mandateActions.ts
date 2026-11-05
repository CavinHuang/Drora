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
} from "./assistantDatabase.js";
import type { AssistantResult } from "./assistantTickets.js";

function nowMs(): number {
  return Date.now();
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
          const ticket = raw
            .prepare("SELECT mandate_id FROM ticket WHERE id = ?")
            .get(input.ticketId) as { mandate_id: string } | undefined;
          if (!ticket) return;
          raw
            .prepare(
              "UPDATE mandate SET state = ?, ended_ms = ?, end_reason = ? WHERE id = ? AND state = ?",
            )
            .run("revoked", nowMs(), input.reason, ticket.mandate_id, "active");
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
