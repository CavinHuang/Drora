/**
 * Drora Mate 工单服务实现（01 详设 §1/§3/§4；specs/drora-personal-assistant.md §5）。
 * 单一写者：trigger+decision+mandate+ticket 全部经本服务事务写（mate.sqlite）；
 * 工单状态/usage 归账在 P1 由 turn 事件面驱动（ticketLedger 接线属装配层，本文件
 * 提供 applyTicketTurnEvent 内部落账入口）。事件驱动，禁超时兜底；失败写原因不自动重试。
 */

import { createUuid } from "@drora/shared";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_TICKET_STATUSES,
  type AssistantMode,
  type AssistantPermissionTier,
  type AssistantStrength,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { evaluateAdmission } from "./admissionGate.js";
import {
  AssistantDatabase,
  openAssistantDatabase,
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import {
  IAssistantTicketService,
  type AssistantConfigView,
  type AssistantResult,
  type AssistantSnapshot,
} from "./assistantTickets.js";

const logger = createServiceLogger("assistant-tickets");

const KV_KEYS = {
  mode: "mode",
  allowlist: "allowlist",
  budgetMaxActivePerWorkspace: "budget_max_active_per_workspace",
} as const;

const DEFAULT_CONFIG: AssistantConfigView = {
  mode: ASSISTANT_MODES.observe,
  allowlist: [],
  budgetMaxActivePerWorkspace: 1,
};

function nowMs(): number {
  return Date.now();
}

type SnapshotEmitter = (snapshot: AssistantSnapshot) => void;

export interface AssistantTicketsServiceOptions {
  /** mate.sqlite 路径（node.ts 装配时由 resolveAssistantDatabasePath(getAppConfigDir()) 得出）。 */
  databasePath: string;
  /** 本机用户 identity（P1 local Source 的触发者与默认名单成员）。 */
  localIdentity: string;
  /** 仅供测试注入；生产由 openAssistantDatabase 创建。 */
  database?: AssistantDatabase;
}

interface TicketRow {
  id: string;
  mandate_id: string;
  brief: string;
  target_workspace_identity: string;
  status: string;
  incarnation_current: string;
  usage_accum: string;
  output_summary: string | null;
  fail_reason: string | null;
  updated_ms: number;
}

export function createAssistantTicketsService(
  options: AssistantTicketsServiceOptions,
): IAssistantTicketService {
  const db = options.database ?? openAssistantDatabase(options.databasePath);
  const localIdentity = options.localIdentity;
  const emitters = new Set<SnapshotEmitter>();
  /** decisionId → {ticketId, sessionId} 幂等登记（同卡二次放行返回首次结果）。 */
  const dispatchIndex = new Map<number, { ticketId: string; sessionId: string }>();

  // ------------------------------------------------------------------
  // kv 配置（P1 全存台账 kv，不动 AppSettings——01 §1.4）
  // ------------------------------------------------------------------

  function readKv(raw: AssistantDatabaseRaw, key: string): string | undefined {
    const row = raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  function readConfig(raw: AssistantDatabaseRaw): AssistantConfigView {
    const mode = (readKv(raw, KV_KEYS.mode) as AssistantMode | undefined) ?? DEFAULT_CONFIG.mode;
    const allowlistRaw = readKv(raw, KV_KEYS.allowlist);
    const allowlist = allowlistRaw ? (JSON.parse(allowlistRaw) as string[]) : [localIdentity];
    const budgetRaw = readKv(raw, KV_KEYS.budgetMaxActivePerWorkspace);
    const budgetMaxActivePerWorkspace = budgetRaw
      ? Number(budgetRaw)
      : DEFAULT_CONFIG.budgetMaxActivePerWorkspace;
    return { mode, allowlist, budgetMaxActivePerWorkspace };
  }

  function buildSnapshot(): AssistantSnapshot {
    const raw = db.raw;
    const config = readConfig(raw);
    const triggers = (
      raw
        .prepare(
          "SELECT id, source_kind, simulated_strength, identity, text, at_ms FROM trigger ORDER BY at_ms DESC LIMIT ?",
        )
        .all(ASSISTANT_SNAPSHOT_LIMITS.triggersMax) as Array<{
        id: string;
        source_kind: string;
        simulated_strength: string;
        identity: string;
        text: string;
        at_ms: number;
      }>
    ).map((row) => ({
      id: row.id,
      sourceKind: row.source_kind,
      strength: row.simulated_strength as AssistantSnapshot["triggers"][number]["strength"],
      identity: row.identity,
      text: row.text,
      atMs: row.at_ms,
    }));
    const decisions = (
      raw
        .prepare(
          `SELECT d.id, d.trigger_id, d.strength, d.mode, d.outcome, d.decided_by, d.decided_ms, t.text AS trigger_text
         FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id
         ORDER BY d.decided_ms DESC LIMIT ?`,
        )
        .all(ASSISTANT_SNAPSHOT_LIMITS.decisionsMax) as Array<{
        id: number;
        trigger_id: string;
        strength: string;
        mode: string;
        outcome: string;
        decided_by: string;
        decided_ms: number;
        trigger_text: string;
      }>
    ).map((row) => ({
      id: row.id,
      triggerId: row.trigger_id,
      strength: row.strength as AssistantSnapshot["decisions"][number]["strength"],
      mode: row.mode as AssistantSnapshot["decisions"][number]["mode"],
      outcome: row.outcome,
      decidedBy: row.decided_by as AssistantSnapshot["decisions"][number]["decidedBy"],
      decidedMs: row.decided_ms,
      triggerText: row.trigger_text,
    }));
    const ticketRows = (
      raw
        .prepare(
          `SELECT id, brief, status, target_workspace_identity, incarnation_current, usage_accum,
                output_summary, fail_reason, updated_ms
         FROM ticket ORDER BY created_ms DESC LIMIT ?`,
        )
        .all(ASSISTANT_SNAPSHOT_LIMITS.ticketsMax) as unknown as TicketRow[]
    ).map((row) => ticketRowToView(row));
    const wouldAcceptCount = (
      raw
        .prepare("SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ?")
        .get(ASSISTANT_OUTCOMES.wouldAccept) as { n: number }
    ).n;
    const releaseCount = (
      raw
        .prepare(
          "SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ? AND decided_by = ?",
        )
        .get(ASSISTANT_OUTCOMES.decisionCard, "user") as { n: number }
    ).n;

    return {
      version: 1,
      mode: config.mode,
      allowlist: config.allowlist,
      budget: { maxActivePerWorkspace: config.budgetMaxActivePerWorkspace },
      trust: { wouldAcceptCount, releaseCount },
      triggers,
      decisions,
      tickets: ticketRows,
      updatedAtMs: nowMs(),
    };
  }

  function ticketRowToView(row: TicketRow): AssistantSnapshot["tickets"][number] {
    const incarnation = JSON.parse(row.incarnation_current) as { sessionId?: string };
    const usage = JSON.parse(row.usage_accum) as { inputTokens?: number; outputTokens?: number };
    return {
      id: row.id,
      brief: row.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax),
      status: row.status,
      permissionTier: ASSISTANT_PERMISSION_TIERS.build,
      usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
      outputSummary: row.output_summary,
      failReason: row.fail_reason,
      targetWorkspaceIdentity: row.target_workspace_identity,
      sessionId: incarnation.sessionId ?? null,
      updatedAtMs: row.updated_ms,
    };
  }

  function publish(): void {
    const snapshot = buildSnapshot();
    for (const emit of emitters) {
      try {
        emit(snapshot);
      } catch (error) {
        logger.warn("assistant-tickets 快照订阅者回调失败", error);
      }
    }
  }

  function fail<T>(
    code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
    reason?: string,
  ): AssistantResult<T> {
    return { ok: false, error: { code, reason } };
  }

  // ------------------------------------------------------------------
  // 准入与决策
  // ------------------------------------------------------------------

  return {
    async recordTrigger(input) {
      try {
        const outcome = db.transaction((raw) => {
          const config = readConfig(raw);
          const verdict = evaluateAdmission(
            { strength: input.simulated, identity: localIdentity },
            config,
          );
          const triggerId = `T-${createUuid()}`;
          raw
            .prepare(
              "INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              triggerId,
              "local",
              input.simulated,
              localIdentity,
              input.targetWorkspaceIdentity ?? null,
              input.text,
              nowMs(),
            );
          raw
            .prepare(
              "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              triggerId,
              verdict.strength,
              config.mode,
              verdict.outcome,
              verdict.reasonCode ?? null,
              "gate",
              nowMs(),
            );
          return { triggerId, outcome: verdict.outcome };
        });
        logger.info("assistant-tickets trigger recorded", {
          triggerId: outcome.triggerId,
          outcome: outcome.outcome,
        });
        publish();
        return { ok: true, value: outcome };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async approveDecision(input) {
      // yolo 必须决策卡人工放行——本接口即人工路径，但 P1 直派通道不开放 yolo（spec §2.5）。
      // 类型层已排除 yolo（Exclude），运行时防线兜住 any 绕道。
      const tier: AssistantPermissionTier =
        input.permissionTier ?? ASSISTANT_PERMISSION_TIERS.build;
      if ((tier as AssistantPermissionTier) === ASSISTANT_PERMISSION_TIERS.yolo) {
        return fail(ASSISTANT_ERROR_CODES.yoloRequiresHumanApproval);
      }
      const existing = dispatchIndex.get(input.decisionId);
      if (existing) {
        return { ok: true, value: existing };
      }
      try {
        const created = db.transaction(
          (
            raw,
          ): AssistantResult<{
            ticketId: string;
            mandateId: string;
            brief: string;
            targetIdentity: string;
            tier: AssistantPermissionTier;
          }> => {
            const decision = raw
              .prepare(
                "SELECT d.id, d.trigger_id, d.outcome, t.text, t.workspace_identity FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id WHERE d.id = ?",
              )
              .get(input.decisionId) as
              | {
                  id: number;
                  trigger_id: string;
                  outcome: string;
                  text: string;
                  workspace_identity: string | null;
                }
              | undefined;
            if (!decision) {
              return fail(ASSISTANT_ERROR_CODES.decisionNotFound);
            }
            if (decision.outcome !== ASSISTANT_OUTCOMES.decisionCard) {
              return fail(
                ASSISTANT_ERROR_CODES.decisionNotFound,
                `outcome=${decision.outcome} 不可放行`,
              );
            }
            const ticketId = `T-${createUuid()}`;
            const mandateId = `M-${createUuid()}`;
            const ts = nowMs();
            const targetIdentity =
              input.targetWorkspaceIdentity ?? decision.workspace_identity ?? "";
            if (!targetIdentity) {
              return fail(ASSISTANT_ERROR_CODES.validationFailed, "缺少派发目标 workspace");
            }
            const scope = JSON.stringify({ permissionTier: tier, writeDomain: "workspace" });
            raw
              .prepare(
                "INSERT INTO mandate(id, ticket_id, scope, state, created_cause) VALUES (?,?,?,?,'accept')",
              )
              .run(mandateId, ticketId, scope, "active");
            const brief = input.briefAppendix
              ? `${decision.text}\n\n---\n大副补充：${input.briefAppendix}`
              : decision.text;
            raw
              .prepare(
                `INSERT INTO ticket(id, mandate_id, decision_id, brief, target_workspace_identity, status,
              incarnation_current, incarnation_generations, usage_accum, created_ms, updated_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
                ticketId,
                mandateId,
                decision.id,
                brief,
                targetIdentity,
                ASSISTANT_TICKET_STATUSES.dispatched,
                JSON.stringify({
                  workspaceIdentity: targetIdentity,
                  sessionId: null,
                  boundAtMs: ts,
                  cause: "dispatched",
                }),
                "[]",
                "{}",
                ts,
                ts,
              );
            raw
              .prepare("UPDATE admission_decision SET outcome = ? WHERE id = ?")
              .run(ASSISTANT_OUTCOMES.decisionCard, decision.id);
            return {
              ok: true as const,
              value: { ticketId, mandateId, brief, targetIdentity, tier },
            };
          },
        );
        if (!created.ok) return created;

        // 派发（事务外：v4 通道是异步 IO；失败→ticket=failed+reason，诚实留痕不静默重试）。
        // 实际 v4 调用由装配层注入的 dispatcher 完成（见 AssistantDispatchPort）；
        // P1 单测以 fake dispatcher 验证幂等/失败路径。
        const dispatchResult = await runDispatch(created.value);
        if (!dispatchResult.ok) {
          markTicketFailed(
            created.value.ticketId,
            dispatchResult.error.reason ?? dispatchResult.error.code,
          );
          return dispatchResult;
        }
        dispatchIndex.set(input.decisionId, dispatchResult.value);
        publish();
        return dispatchResult;
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async ignoreDecision(input) {
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "UPDATE admission_decision SET outcome = ?, decided_by = ? WHERE id = ? AND outcome = ?",
            )
            .run(
              ASSISTANT_OUTCOMES.rejected,
              "user",
              input.decisionId,
              ASSISTANT_OUTCOMES.decisionCard,
            );
        });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async dismissObservation(input) {
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "UPDATE admission_decision SET outcome = ?, decided_by = ? WHERE trigger_id = ? AND outcome = ?",
            )
            .run(
              ASSISTANT_OUTCOMES.ignored,
              "user",
              input.triggerId,
              ASSISTANT_OUTCOMES.wouldAccept,
            );
        });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async stopMandate(input) {
      try {
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
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
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
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async setMode(mode) {
      if (mode === ASSISTANT_MODES.auto) {
        // 信任门 P4 才开（00 master plan §5）：P1/P2 恒拒。
        return fail(ASSISTANT_ERROR_CODES.autoLocked);
      }
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
            )
            .run(KV_KEYS.mode, mode, nowMs());
        });
        logger.info("assistant-tickets mode changed", { mode });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async setAllowlist(identities) {
      const cleaned = [...new Set(identities.map((id) => id.trim()).filter((id) => id.length > 0))];
      if (cleaned.length === 0) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "allowlist 不能为空");
      }
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
            )
            .run(KV_KEYS.allowlist, JSON.stringify(cleaned), nowMs());
        });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async getConfig() {
      try {
        return { ok: true, value: readConfig(db.raw) };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async getSnapshot() {
      return buildSnapshot();
    },

    onDidChange(listener) {
      emitters.add(listener);
      return {
        dispose() {
          emitters.delete(listener);
        },
      };
    },
  };

  // ------------------------------------------------------------------
  // 内部：派发端口与失败落账（v4 通道接线在装配层；P1 单测注入 fake）
  // ------------------------------------------------------------------

  function markTicketFailed(ticketId: string, reason: string): void {
    try {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET status = ?, fail_reason = ?, updated_ms = ? WHERE id = ?")
          .run(ASSISTANT_TICKET_STATUSES.failed, reason, nowMs(), ticketId);
        raw
          .prepare(
            "UPDATE mandate SET state = 'revoked', ended_ms = ?, end_reason = ? WHERE ticket_id = ? AND state = 'active'",
          )
          .run(nowMs(), `dispatch_failed: ${reason}`, ticketId);
      });
      publish();
    } catch (error) {
      logger.error("assistant-tickets 失败落账异常", error);
    }
  }

  /** 派发成功回写：incarnation.sessionId + status=running（闭包内事务）。 */
  function applyDispatchSuccess(ticketId: string, sessionId: string): void {
    try {
      db.transaction((raw) => {
        const row = raw
          .prepare("SELECT incarnation_current FROM ticket WHERE id = ?")
          .get(ticketId) as { incarnation_current: string } | undefined;
        if (!row) return;
        const incarnation = JSON.parse(row.incarnation_current) as { sessionId?: string };
        incarnation.sessionId = sessionId;
        raw
          .prepare(
            "UPDATE ticket SET incarnation_current = ?, status = ?, updated_ms = ? WHERE id = ?",
          )
          .run(JSON.stringify(incarnation), ASSISTANT_TICKET_STATUSES.running, nowMs(), ticketId);
      });
    } catch (error) {
      logger.error("assistant-tickets 派发回写异常", error);
    }
  }

  /** 闭包内派发：调用装配层端口 + 回写（dispatchTicket 模块级壳经此完成全部副作用）。 */
  async function runDispatch(created: {
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>> {
    if (!dispatchPort) {
      return fail(ASSISTANT_ERROR_CODES.dispatchRejected, "派发通道未装配（dispatch port 未注入）");
    }
    const result = await dispatchPort({
      ticketId: created.ticketId,
      brief: created.brief,
      targetWorkspaceIdentity: created.targetIdentity,
      permissionTier:
        created.tier === ASSISTANT_PERMISSION_TIERS.yolo
          ? ASSISTANT_PERMISSION_TIERS.build
          : created.tier,
    });
    if (result.ok) {
      applyDispatchSuccess(created.ticketId, result.value.sessionId);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// 派发端口：v4 通道接线在装配层（node.ts 注入 droraAgentService.sendConversationCommandV4）；
// 本文件只定义端口形状与缺省（未注入=不可派发，approve 返回 dispatch.rejected——诚实降级，
// 不假装派发成功）。单测注入 fake 验证幂等/失败路径（01 §6）。
// ---------------------------------------------------------------------------

export interface AssistantDispatchRequest {
  readonly ticketId: string;
  readonly brief: string;
  readonly targetWorkspaceIdentity: string;
  readonly permissionTier: Exclude<AssistantPermissionTier, typeof ASSISTANT_PERMISSION_TIERS.yolo>;
}

export interface AssistantDispatchResultValue {
  readonly ticketId: string;
  readonly sessionId: string;
}

export type AssistantDispatchResult = AssistantResult<AssistantDispatchResultValue>;

export type AssistantDispatchPort = (
  request: AssistantDispatchRequest,
) => Promise<AssistantDispatchResult>;

/** 装配层注入点（node.ts setAssistantDispatchPort；服务工厂闭包经 getter 读取）。 */
let dispatchPort: AssistantDispatchPort | null = null;

export function setAssistantDispatchPort(port: AssistantDispatchPort | null): void {
  dispatchPort = port;
}

function getAssistantDispatchPort(): AssistantDispatchPort | null {
  return dispatchPort;
}
