/**
 * Drora Mate 工单服务实现（01 详设 §1/§3/§4；02 详设 §1-§5 P2 host 内核）。
 * 单一写者：trigger+decision+mandate+ticket+router_evaluation 全部经本服务事务写
 * （mate.sqlite）；派发生命周期（带序 commandId/锚回写/Mode A·B·C/换代/queued FIFO/
 * W1 worktree/帧归账）委托 dispatchEngine（本文件是唯一编排者，引擎是唯一执行者）。
 * 事件驱动，禁超时兜底；失败写原因不自动重试。
 */

import { createUuid } from "@drora/shared";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_TICKET_STATUSES,
  type AssistantPermissionTier,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { evaluateAdmission } from "./admissionGate.js";
import { ASSISTANT_KV_KEYS, readAssistantConfig } from "./assistantConfig.js";
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
import type { AssistantTicketTurnEventInput } from "./ticketLedger.js";
import { buildAssistantSnapshot } from "./assistantSnapshot.js";
import { createDispatchEngine } from "./dispatchEngine.js";
import { getAssistantPorts } from "./assistantPorts.js";
import { createRouterEvaluation } from "./routerEvaluation.js";
import { resolveAnchorVerdict } from "./incarnation.js";
import { serializeDispatchIntent } from "./dispatchIntent.js";
import { runPostApproval } from "./postApproval.js";
import { createAssistantSourceIngest } from "./sources/sourceIngest.js";
import type { AssistantSourceIngestValue } from "./sources/sourceIngest.js";
import type { MateSourceEvent } from "./sources/contract.js";

const logger = createServiceLogger("assistant-tickets");

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

export function createAssistantTicketsService(
  options: AssistantTicketsServiceOptions,
): IAssistantTicketService & {
  /** host 内部 ledger 入口（01 §3；不在 IAssistantTicketService——channel 代理面只含
   * 接口方法，renderer 不可达）。装配层（node.ts ticketLedger 接线）与单测消费。 */
  applyTicketTurnEvent(input: AssistantTicketTurnEventInput): boolean;
  /** host 内部：teamActivity 第三信号归账（02 §5；sessions-index 桥喂入）。 */
  applyTicketTeamEvent(input: {
    ticketId: string;
    teamStatus: string;
    atMs: number;
  }): boolean;
  /** host 内部：按 sessionId 反查工单的 teamActivity 归账（Mode B 桥路径）。 */
  applyTeamActivityForSession(input: {
    sessionId: string;
    teamStatus: string;
    atMs: number;
  }): boolean;
  /** host 内部：sessions-index session.removed → 换代重派（spec §8 触发源②）。 */
  notifySessionRemoved(sessionId: string): void;
  /** host 内部：follow-up Tier1 直投（P3 Source 接线；测试直驱）。 */
  followUp(input: {
    ticketId: string;
    text: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
  /** host 内部：换代重派（spec §8 三触发源；测试直驱）。 */
  recycle(input: {
    ticketId: string;
    cause: string;
    note?: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
  /**
   * host 内部：Source 注册表统一入口（03 详设 §1——飞书/GitHub 事件经装配层注入；
   * channelRef 命中活动工单→直通 Tier1，否则真实强度规则进 gate）。renderer 不可达：
   * channel 代理面只含接口方法（submitSourceEntry 才是 channel 可见入口，identity 由
   * host 决定，防伪造）。
   */
  ingestSourceEvent(event: MateSourceEvent): Promise<AssistantResult<AssistantSourceIngestValue>>;
} {
  const db = options.database ?? openAssistantDatabase(options.databasePath);
  const localIdentity = options.localIdentity;
  const emitters = new Set<SnapshotEmitter>();
  /** decisionId → {ticketId, sessionId} 幂等登记（同卡二次放行返回首次结果）。 */
  const dispatchIndex = new Map<number, { ticketId: string; sessionId: string }>();
  // kv 配置读取（P1 全存台账 kv，不动 AppSettings——01 §1.4）。读取纯函数在
  // assistantConfig.ts（≤800 行拆分）；写路径仍在本服务（唯一写者纪律）。
  const readConfig = (raw: AssistantDatabaseRaw): AssistantConfigView =>
    readAssistantConfig(raw, localIdentity);
  /** 派发引擎（唯一执行者：带序 commandId/锚/Mode A·B·C/换代/queued FIFO/W1/归账）。 */
  const engine = createDispatchEngine({ db, publish, readConfig });

  function publish(): void {
    const snapshot = buildAssistantSnapshot(db.raw, readConfig(db.raw));
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
  // Router 候选卡循环（02 §1.3）：评估循环在 routerEvaluation.ts（≤800 行拆分）——
  // 决策卡产出后异步送 Router 评估，建议预填进 router_evaluation；校验失败/通道失败
  // → state=failed（Tier3 问人，不重试模型）。
  // ------------------------------------------------------------------

  const { scheduleRouterEvaluation } = createRouterEvaluation({ db, publish });

  // ------------------------------------------------------------------
  // Source 统一入口（03 §1/§5；P3）：channelRef 直通 + 真实强度规则 gate。
  // ------------------------------------------------------------------

  const sourceIngest = createAssistantSourceIngest({
    db,
    readConfig,
    publish,
    scheduleRouterEvaluation,
    followUp: engine.followUp,
    localIdentity,
  });

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
          const info = raw
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
          return {
            triggerId,
            outcome: verdict.outcome,
            decisionId: Number(info.lastInsertRowid),
            strength: verdict.strength,
          };
        });
        logger.info("assistant-tickets trigger recorded", {
          triggerId: outcome.triggerId,
          outcome: outcome.outcome,
        });
        if (outcome.outcome === ASSISTANT_OUTCOMES.decisionCard) {
          // 候选卡循环（02 §1.3）：fire-and-forget，事件驱动回填建议；无建议前人工照常终审。
          const triggerRow = db.raw
            .prepare("SELECT id, text, simulated_strength, identity, workspace_identity, at_ms FROM trigger WHERE id = ?")
            .get(outcome.triggerId) as
            | {
                id: string;
                text: string;
                simulated_strength: string;
                identity: string;
                workspace_identity: string | null;
                at_ms: number;
              }
            | undefined;
          if (triggerRow) {
            scheduleRouterEvaluation({
              decisionId: outcome.decisionId,
              trigger: {
                id: triggerRow.id,
                text: triggerRow.text,
                strength: triggerRow.simulated_strength,
                identity: triggerRow.identity,
                atMs: triggerRow.at_ms,
                workspaceIdentity: triggerRow.workspace_identity,
              },
            });
          }
        }
        publish();
        return { ok: true, value: { triggerId: outcome.triggerId, outcome: outcome.outcome } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async approveDecision(input) {
      // yolo 必须决策卡人工放行——本接口即人工路径，但不开放 yolo 直派通道（spec §2.5）。
      // 类型层已排除 yolo（Exclude），运行时防线兜住 any 绕道。
      const tier: AssistantPermissionTier =
        input.permissionTier ?? ASSISTANT_PERMISSION_TIERS.build;
      if ((tier as AssistantPermissionTier) === ASSISTANT_PERMISSION_TIERS.yolo) {
        return fail(ASSISTANT_ERROR_CODES.yoloRequiresHumanApproval);
      }
      if (input.attachToSessionId != null && input.attachToSessionId.trim() === "") {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "attachToSessionId 不能为空串");
      }
      const existing = dispatchIndex.get(input.decisionId);
      if (existing) {
        return { ok: true, value: { ...existing } };
      }
      try {
        const config = readConfig(db.raw);
        // Router 建议预填（02 §1.3）：attach 建议在人按 Y 时生效（派发桥随后仍校验目标）。
        const suggestionRow = db.raw
          .prepare("SELECT state, verdict FROM router_evaluation WHERE decision_id = ?")
          .get(input.decisionId) as { state: string; verdict: string | null } | undefined;
        const suggestion =
          suggestionRow?.state === "suggested" && suggestionRow.verdict
            ? (JSON.parse(suggestionRow.verdict) as {
                kind?: string;
                arm?: { sessionId?: string; targetWorkspaceIdentity?: string };
              })
            : undefined;
        const attachSessionId =
          input.attachToSessionId?.trim() ||
          (suggestion?.kind === "attach" ? suggestion.arm?.sessionId : undefined);
        const suggestedTarget =
          suggestion?.kind === "attach" || suggestion?.kind === "dispatch"
            ? suggestion.arm?.targetWorkspaceIdentity
            : undefined;
        const decisionRow = db.raw
          .prepare(
            "SELECT t.workspace_identity FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id WHERE d.id = ?",
          )
          .get(input.decisionId) as { workspace_identity: string | null } | undefined;
        // Tier2 附着预检（02 §2 派发桥校验）：在放行事务**之前**校验目标存在/归属——
        // 失败时决策卡不被消费、不建票，人工可改选"开新会话"（Tier3 选项恒在）。
        if (attachSessionId) {
          const preIdentity =
            input.targetWorkspaceIdentity ?? suggestedTarget ?? decisionRow?.workspace_identity ?? "";
          if (!preIdentity) {
            return fail(ASSISTANT_ERROR_CODES.validationFailed, "附着缺少目标 workspace 归属");
          }
          const probe = await engine.probeAttachTarget({
            targetIdentity: preIdentity,
            sessionId: attachSessionId,
          });
          if (probe.kind !== "ok") {
            return fail(
              ASSISTANT_ERROR_CODES.attachTargetInvalid,
              `附着目标校验失败：${resolveAnchorVerdict(probe).reason}`,
            );
          }
        } else {
          // workspace 探测预检（P2 审查修复，spec §8「workspace 迁移→identity 解析失败→
          // 拒绝猜测，问人」）：照上方 attach 预检先例在放行事务之前执行——探测端口在位
          // 而目标探测失败（远程/非本地路径/目录不存在）→ 不消费决策卡、不建票，人工可
          // 改选目标或追加说明后重放。此前三口径矛盾（CONTRACT.md/node.ts 注释称「降级
          // 不阻断」，实现却在建票后 fail-fast 且卡已消费无问人入口）收口为本形态。
          // 探测端口缺席（P1 形态）不预检：跳过 W1 规划按 workspace 域派发（未隔离明示）。
          const { workspaceProbe } = getAssistantPorts();
          if (workspaceProbe) {
            const preIdentity =
              input.targetWorkspaceIdentity ?? suggestedTarget ?? decisionRow?.workspace_identity ?? "";
            if (preIdentity) {
              const probe = await workspaceProbe(preIdentity);
              if (!probe.ok) {
                return fail(
                  ASSISTANT_ERROR_CODES.dispatchRejected,
                  `workspace 探测失败，决策卡未消费（改选目标后可重放）：${probe.reason}`,
                );
              }
            }
          }
        }
        const created = db.transaction(
          (
            raw,
          ):
            | (AssistantResult<{
                ticketId: string;
                mandateId: string;
                brief: string;
                targetIdentity: string;
                tier: AssistantPermissionTier;
                decisionId: number;
              }> & { alreadyExisted?: undefined })
            | {
                ok: true;
                alreadyExisted: true;
                ticketId: string;
                sessionId: string;
              } => {
            const decision = raw
              .prepare(
                "SELECT d.id, d.trigger_id, d.outcome, t.text, t.workspace_identity, t.channel_ref FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id WHERE d.id = ?",
              )
              .get(input.decisionId) as
              | {
                  id: number;
                  trigger_id: string;
                  outcome: string;
                  text: string;
                  workspace_identity: string | null;
                  channel_ref: string | null;
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
            // 并发幂等兜底（PR-1B 三审发现 7）：首个放行的派发 IO 在途时 dispatchIndex
            // 尚未记账，同 decisionId 的第二次 approve 会穿过前置内存检查。单写者事务
            // 串行化下在此按 decision_id 查已建工单，命中即幂等返回首次结果；UNIQUE
            // 索引 idx_ticket_decision_id 是跨进程第二道防线。
            const existingTicket = raw
              .prepare("SELECT id, incarnation_current FROM ticket WHERE decision_id = ?")
              .get(input.decisionId) as { id: string; incarnation_current: string } | undefined;
            if (existingTicket) {
              const existingIncarnation = JSON.parse(existingTicket.incarnation_current) as {
                sessionId?: string;
              };
              return {
                ok: true as const,
                alreadyExisted: true as const,
                ticketId: existingTicket.id,
                sessionId: existingIncarnation.sessionId ?? "",
              };
            }
            const ticketId = `T-${createUuid()}`;
            const mandateId = `M-${createUuid()}`;
            const ts = nowMs();
            const targetIdentity =
              input.targetWorkspaceIdentity ?? suggestedTarget ?? decision.workspace_identity ?? "";
            if (!targetIdentity) {
              return fail(ASSISTANT_ERROR_CODES.validationFailed, "缺少派发目标 workspace");
            }
            if (attachSessionId && !input.targetWorkspaceIdentity && !suggestedTarget) {
              return fail(ASSISTANT_ERROR_CODES.validationFailed, "附着缺少目标 workspace 归属");
            }
            const scope = JSON.stringify({
              permissionTier: tier,
              writeDomain: attachSessionId ? "attach" : "workspace",
            });
            raw
              .prepare(
                "INSERT INTO mandate(id, ticket_id, scope, state, created_cause) VALUES (?,?,?,?,'accept')",
              )
              .run(mandateId, ticketId, scope, "active");
            const brief = input.briefAppendix
              ? `${decision.text}\n\n---\n大副补充：${input.briefAppendix}`
              : decision.text;
            // 派发意图落库（P2 审查修复）：放行形态（Mode A/B/C、附着目标、权限档）进
            // ticket.dispatch_intent，queued FIFO 释放按落库形态重放派发——不依赖内存
            // 参数或派发成功后才写入的 dispatch_mode 列（dispatchIntent.ts 文件头即对账点）。
            const dispatchIntent = serializeDispatchIntent({
              mode: attachSessionId ? "C" : (input.dispatchMode ?? "A"),
              tier,
              ...(attachSessionId ? { attachSessionId } : {}),
            });
            raw
              .prepare(
                `INSERT INTO ticket(id, mandate_id, decision_id, brief, target_workspace_identity, status,
              incarnation_current, incarnation_generations, usage_accum, dispatch_intent, channel_ref, created_ms, updated_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
                  anchorCommandId: null,
                  dispatchSeq: 0,
                }),
                "[]",
                "{}",
                dispatchIntent,
                // P3（03 详设 §5）：放行建票即回填通道绑定——同绑定 SourceEvent 后续
                // 命中本工单走直通 Tier1（本地双按钮触发 channel_ref=NULL 不绑定）。
                decision.channel_ref,
                ts,
                ts,
              );
            // 修复（PR-1B 审查发现 2，2026-11-05）：放行即人工决策，除 reaffirm outcome 外
            // 必须把 decided_by 写为 user——trust.releaseCount 的 SQL 口径是
            // decision_card+decided_by='user'，漏写会让放行后卡片仍留在待决策集。
            raw
              .prepare("UPDATE admission_decision SET outcome = ?, decided_by = ? WHERE id = ?")
              .run(ASSISTANT_OUTCOMES.decisionCard, "user", decision.id);
            return {
              ok: true as const,
              value: { ticketId, mandateId, brief, targetIdentity, tier, decisionId: decision.id },
            };
          },
        );
        if (created.alreadyExisted) {
          // 并发第二次放行：工单已在首个放行事务中建好，幂等返回首次结果，不重派。
          return {
            ok: true as const,
            value: {
              ticketId: created.ticketId,
              sessionId: created.sessionId,
            },
          };
        }
        if (!created.ok) return created;
        return await runPostApproval(
          { engine, publish, dispatchIndex },
          created.value,
          {
            decisionId: created.value.decisionId,
            attachSessionId,
            dispatchMode: input.dispatchMode ?? "A",
            budgetMaxActivePerWorkspace: config.budgetMaxActivePerWorkspace,
          },
        );
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
          if (incarnation.sessionId) engine.unwatchSession(incarnation.sessionId);
        }
        // 用户 stop 的直改终态也走终态后续（worktree 清理 + queued FIFO 释放）。
        engine.handleManualStop(input.ticketId);
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
            .run(ASSISTANT_KV_KEYS.mode, mode, nowMs());
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
            .run(ASSISTANT_KV_KEYS.allowlist, JSON.stringify(cleaned), nowMs());
        });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        throw error;
      }
    },

    async setWorktreeDisabled(disabled) {
      // W1 用户开关（spec §9 W2 兜底；P2 审查修复补交互入口）：kv worktree_disabled
      // 唯一写路径（readConfig 既有读取）；只影响之后的派发规划（planWriteDomain），
      // 已建工单写域不回改——写域落列在建票时一次性判定。
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
            )
            .run(ASSISTANT_KV_KEYS.worktreeDisabled, disabled ? "true" : "false", nowMs());
        });
        logger.info("assistant-tickets W1 worktree 开关变更", { worktreeDisabled: disabled });
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
      return buildAssistantSnapshot(db.raw, readConfig(db.raw));
    },

    onDidChange(listener) {
      emitters.add(listener);
      return {
        dispose() {
          emitters.delete(listener);
        },
      };
    },

    // P3 Source 注册表 channel 可见入口（IAssistantTicketService.submitSourceEntry）：
    // identity 由 host 侧本机用户决定，renderer 不可自报外部身份（sourceIngest 内注释）。
    submitSourceEntry: sourceIngest.submitSourceEntry,

    // host 内部入口（renderer 经 channel 代理只见接口方法面，本组方法仅装配层/测试可触达）。
    applyTicketTurnEvent: engine.applyTicketTurnEvent,
    applyTicketTeamEvent: engine.applyTicketTeamEvent,
    applyTeamActivityForSession: engine.applyTeamActivityForSession,
    notifySessionRemoved: engine.notifySessionRemoved,
    followUp: engine.followUp,
    recycle: engine.recycle,
    ingestSourceEvent: sourceIngest.ingestSourceEvent,
  };

  // ------------------------------------------------------------------
  // 放行后编排已抽至 postApproval.ts（单文件 ≤800 行纪律，逻辑不变）：
  // 写域规划 → 软预算/写域冲突排队闸 → Mode A/B/C 派发；approveDecision 事务外调用。
  // ------------------------------------------------------------------

}
