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
import { createRouterEvaluation } from "./routerEvaluation.js";
import { serializeDispatchIntent } from "./dispatchIntent.js";
import { isAssistantTrustGateSatisfied } from "./trustGate.js";
import { runAssistantWatchdogRound } from "./watchdog.js";
import { runPostApproval, runApprovalPrecheck } from "./postApproval.js";
import { createMandateActions } from "./mandateActions.js";
import {
  confirmTicketIncrements,
  confirmTicketOutput,
  collectAwaitingCandidates,
} from "./reportCompletion.js";
import { createAssistantAutoDispatch } from "./autoDispatch.js";
import { createAssistantQuotaService } from "./quotaCenterService.js";
import { resolveAssistantDailyQuota } from "./quotaCenter.js";
import { createAssistantRecordTrigger } from "./triggerRecord.js";
import { createAssistantConfigActions } from "./configActions.js";
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
  /** host 内部 ledger 入口（01 §3；不在 IAssistantTicketService 类型面）。装配层
   * （node.ts ticketLedger 接线）与单测消费。边界注记（P4 修复轮核实）：服务实例
   * 整体注册进 channel，ProxyChannel.fromService 遍历实例全部可枚举函数属性——本
   * 方法与 runWatchdogRound 等工厂附加方法在 channel 面上实际可调，边界是约定+
   * 兜底（ledger 单调纪律拒绝乱序归账），不是结构隔离。 */
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
  /** host 内部：服务级订阅收口（全链审查遗留 16）——disposeWatchers 拆全部帧/
   * sessions-index 订阅；disposeServiceResources 统一调用（node.ts WeakMap 挂链）。 */
  dispose(): void;
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
   * channelRef 命中活动工单→直通 Tier1，否则真实强度规则进 gate）。边界注记（P4
   * 修复轮核实）：本方法在 channel 面上经 ProxyChannel 实际可调（实例整体注册），
   * 「只有 submitSourceEntry 可达」是约定不是结构隔离——身份伪造防线在 ingest 内部
   * 强制规则（mention && allowlist 真实强度判定，identity 自报不提权）与
   * submitSourceEntry 的 host 侧 identity 注入。
   */
  ingestSourceEvent(event: MateSourceEvent): Promise<AssistantResult<AssistantSourceIngestValue>>;
  /**
   * host 内部：P4 watchdog 轮（04 详设 §1；host/cronMateWatchdog.ts 定时器驱动）。
   * 到轮判定（kv interval）在轮内裁决。边界注记（P4 修复轮核实）：本方法在 channel
   * 面上经 ProxyChannel 实际可调（实例整体注册，见 applyTicketTurnEvent 注记），
   * 非结构隔离——误调兜底=kv 到轮节流（interval 内 ran=false 零副作用）+纯标记/
   * 通知语义（永不改状态机）。awaitingCandidates 是 §3 工件核验的接缝入参（缺席=
   * 判据不激活）。
   */
  runWatchdogRound(input?: {
    nowMs?: number;
    awaitingCandidates?: readonly { ticketId: string; sinceMs: number }[];
  }): Promise<import("./watchdog.js").AssistantWatchdogRoundResult>;
  /** host 内部：auto 建议臂/直派臂的建票编排（测试直驱；Router 钩子同函数）。 */
  autoDispatchDecision(input: {
    decisionId: number;
    kind: "dispatch" | "attach";
    targetIdentity: string;
    suggestedTier?: AssistantPermissionTier;
    attachSessionId?: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
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

  // ------------------------------------------------------------------
  // Mandate 变更途径之二/三（P4 第二棒拆分）：stop/revoke 实现拆 mandateActions.ts。
  // ------------------------------------------------------------------
  const mandateActions = createMandateActions({
    db,
    unwatchSession: (sessionId) => engine.unwatchSession(sessionId),
    handleManualStop: (ticketId) => engine.handleManualStop(ticketId),
    publish,
  });

  // ------------------------------------------------------------------
  // P4 配额中心（04 详设 §4）：服务面拆在 quotaCenterService.ts（判定实时读 settings
  // 端口、快照投影用闭包缓存值——判定与投影分离，quotaCenter.ts 注释即对账点）。
  // ------------------------------------------------------------------
  const quotaService = createAssistantQuotaService({ db, publish });

  // P5 设置中心（06 号详设）：六 setter 纯模块件（写 kv+publish；见 configActions.ts）。
  const configActions = createAssistantConfigActions({ db, publish });
  function publish(): void {
    const snapshot = buildAssistantSnapshot(db.raw, readConfig(db.raw), {
      dailyQuota: quotaService.cachedQuota(),
    });
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
  // P4 auto 钩子：建议落账为 suggested 后回调 autoDispatch.handleRouterSuggested
  // （auto 模式复核 dispatch/attach 臂 + evidence ≥1 + 探测通过才自动建票；失败留在
  // 决策卡问人）。编排拆在 autoDispatch.ts（≤800 行纪律）。
  // ------------------------------------------------------------------

  const autoDispatch = createAssistantAutoDispatch({
    db,
    readConfig,
    engine,
    publish,
    dispatchIndex,
  });

  const { scheduleRouterEvaluation } = createRouterEvaluation({
    db,
    publish,
    // P7 查询直答（08 号详设 §3.3）：query_status 臂经确定性应答器直答（本地 identity
    // 模板占位+答复语言缺省 zh；Source 事件原语言随后续批接入）。
    localIdentity,
    replyLocale: "zh",
    onSuggested: ({ decisionId, verdictJson }) => {
      void autoDispatch.handleRouterSuggested({ decisionId, verdictJson }).catch((error) => {
        logger.warn("assistant-tickets auto 建议执行失败（决策卡留人工）", error);
      });
    },
  });

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
    // P4 配额生产接线（04 详设 §4 修复批注记）：gate 落 decision_card 同事务计数用，
    // 快照投影同口径的闭包缓存值（判定实时读纪律只约束 report/bubble 抑制臂）。
    readDailyQuotaSnapshot: () => resolveAssistantDailyQuota(quotaService.cachedQuota()),
    // P4 auto 直派后半程（04 详设 §2）：runPostApproval 编排拆在 autoDispatch.ts
    // （engine/dispatchIndex/软预算同 approveDecision 路径——排队不发明第二条释放路径）。
    dispatchCreatedTicket: (input) => autoDispatch.dispatchCreatedTicket(input),
  });

  // P1 本地触发路径（recordTrigger 编排拆 triggerRecord.ts——单文件 ≤800 行纪律；
  // 与 sourceIngest 同闭包依赖：Router 候选卡循环/auto 直派后半程/配额读点）。
  const recordTrigger = createAssistantRecordTrigger({
    db,
    readConfig,
    localIdentity,
    publish,
    scheduleRouterEvaluation,
    readDailyQuotaSnapshot: () => resolveAssistantDailyQuota(quotaService.cachedQuota()),
    dispatchCreatedTicket: (input) => autoDispatch.dispatchCreatedTicket(input),
  });

  // ------------------------------------------------------------------
  // 准入与决策
  // ------------------------------------------------------------------

  return {
    // P1 本地触发路径（01 详设；recordTrigger 编排拆 triggerRecord.ts——单文件 ≤800
    // 行纪律，先例：sourceIngest/postApproval 拆分；行为与拆分前逐行等价）。
    recordTrigger,

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
        // 放行前置预检（Router 建议读取 + Tier2 附着校验 + workspace 探测）拆在
        // postApproval.runApprovalPrecheck——失败臂语义：决策卡不消费、不建票（问人）。
        const precheck = await runApprovalPrecheck(db.raw, engine, {
          decisionId: input.decisionId,
          ...(input.attachToSessionId ? { attachToSessionId: input.attachToSessionId } : {}),
          ...(input.targetWorkspaceIdentity
            ? { targetWorkspaceIdentity: input.targetWorkspaceIdentity }
            : {}),
        });
        if (!precheck.ok) {
          return fail(
            precheck.error.code as (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
            precheck.error.reason,
          );
        }
        const attachSessionId = precheck.attachSessionId;
        const suggestedTarget = precheck.suggestedTarget;
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

    // P7（08 号详设 §3.4）：查询答复卡 dismiss——status_replied → ignored（照
    // ignoreDecision 同款单条 UPDATE 事务；出清后答复卡离开面板）。
    async dismissQueryReply(input) {
      try {
        db.transaction((raw) => {
          raw
            .prepare(
              "UPDATE admission_decision SET outcome = ? WHERE id = ? AND outcome = ?",
            )
            .run(ASSISTANT_OUTCOMES.ignored, input.decisionId, ASSISTANT_OUTCOMES.statusReplied);
        });
        publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
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
      // P4 第二棒：实现拆在 mandateActions.ts（≤800 行纪律；三途径语义不变）。
      return mandateActions.stopMandate(input);
    },

    async revokeMandate(input) {
      // P4 第二棒：实现拆在 mandateActions.ts（≤800 行纪律；三途径语义不变）。
      return mandateActions.revokeMandate(input);
    },

    // ----------------------------------------------------------------
    // P4 第二棒（04 详设 §3）：汇报卡完整版的人工出口——工件核验确认与换代增量确认。
    // 编排拆在 reportCompletion.ts（核验矩阵/唯一落库路径见其文件头）。
    // ----------------------------------------------------------------

    async confirmTicketOutput(input) {
      try {
        return confirmTicketOutput(
          {
            db,
            publish,
            // awaiting→done 的终态后续与 ledger/handleManualStop 同一引擎入口
            // （worktree 清理+FIFO 释放+帧退订），不建第二条终态路径。
            onTicketTerminal: (entry) => engine.handleManualStop(entry.ticketId),
          },
          input.ticketId,
        );
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async confirmTicketIncrements(input) {
      try {
        return confirmTicketIncrements(
          { db, publish, onTicketTerminal: () => {} },
          input.ticketId,
        );
      } catch (error) {
        if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
        if (error instanceof AssistantStoreMigrationError)
          return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
        throw error;
      }
    },

    async setMode(mode) {
      if (mode === ASSISTANT_MODES.auto) {
        // P4 信任门（04 详设 §2）：判定读 admission_decision 实时 counts（单一事实源；
        // kv trust_gate_stats 只是 watchdog 轮的审计投影，不作判定输入）。未达标仍
        // mate.auto.locked（确认 dialog 是 UI 侧动作，服务侧不二次确认）。
        const gate = isAssistantTrustGateSatisfied(db.raw);
        if (!gate.open) {
          return fail(
            ASSISTANT_ERROR_CODES.autoLocked,
            `信任门未开放：releaseRate=${gate.stats.releaseRate.toFixed(3)}（需 ≥${gate.thresholds.minRate}），样本=${gate.stats.sampleCount}（需 ≥${gate.thresholds.minSamples}）`,
          );
        }
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

    // P5 设置中心（06 号详设 §2）：六 setter 委托 configActions（bounds fail-closed+
    // publish 即 reconcile 的公共纪律收在纯模块；服务仍是 kv 唯一生产写者）。
    ...configActions,
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

    // ----------------------------------------------------------------
    // P4 配额中心（04 详设 §4）：三端同源的统一计数/查询/投递回执接口。
    // 实现拆在 quotaCenterService.ts（判定实时读 settings 端口；事务单写者）。
    // ----------------------------------------------------------------

    admitDisturbance: (input) => quotaService.admitDisturbance(input),

    getDisturbanceQuota: () => quotaService.getDisturbanceQuota(),

    markDailyDigestDelivered: () => quotaService.markDailyDigestDelivered(),

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
      // P4：与 publish 同参（配额闭包缓存值进投影；判定仍以 admitDisturbance 实时读为准）。
      return buildAssistantSnapshot(db.raw, readConfig(db.raw), {
        dailyQuota: quotaService.cachedQuota(),
      });
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
    // 服务级订阅收口（全链审查遗留 16）：disposeServiceResources 统一调用。
    dispose: () => engine.disposeWatchers(),
    followUp: engine.followUp,
    recycle: engine.recycle,
    ingestSourceEvent: sourceIngest.ingestSourceEvent,
    // P4（04 详设 §1/§2）：watchdog 轮（host cron 驱动）与 auto 建票编排（Router 钩子）。
    // P4 第二棒：awaiting 判据激活——工件核验滞留（awaiting_output）工单按轮喂入
    // awaitingCandidates（§1 判据表第 2 行；事实源=collectAwaitingCandidates）。
    runWatchdogRound: (input) =>
      runAssistantWatchdogRound(
        { db, publish, readDailyQuota: quotaService.readDailyQuotaLive },
        {
          ...input,
          awaitingCandidates: input?.awaitingCandidates ?? collectAwaitingCandidates(db.raw, nowMs()),
        },
      ),
    autoDispatchDecision: (input) => autoDispatch.autoDispatchDecision(input),
  };
}
