/**
 * P1 本地触发路径（01 详设；从 assistantTicketsService 拆出——单文件 ≤800 行纪律，
 * 先例：sourceIngest/postApproval/mandateActions 拆分）。本地双按钮=测试工具
 * （master plan §4.1），P3 起真实 Source 走 sources/sourceIngest.ts（同 gate 语义）。
 *
 * 事件顺序（recordTrigger）：auto 预检（事务外，探测是异步 IO）→ gate 事务（trigger+
 * admission_decision+配额 decision 计数+auto 直派建票同事务单一写者）→ 决策卡进
 * Router 候选卡循环 / auto 票走 runPostApproval 编排 → publish。
 *
 * 纯编排：db/端口/配额读点由调用方注入；探测端口缺席按各语义诚实降级。
 */

import { createUuid } from "@drora/shared";
import {
  ASSISTANT_DISTURBANCE_KINDS,
  ASSISTANT_ERROR_CODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_SOURCE_KINDS,
  type AssistantPermissionTier,
  type AssistantStrength,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import { evaluateAdmission } from "./admissionGate.js";
import type { AssistantConfigView, AssistantResult } from "./assistantTickets.js";
import { getAssistantPorts, type AssistantDispatchResult } from "./assistantPorts.js";
import type { RouterEvaluationTrigger } from "./routerEvaluation.js";
import { admitAssistantDisturbanceTx } from "./quotaCenter.js";
import { insertAssistantAutoTicket, resolveAssistantAutoGateOutcome } from "./autoDispatch.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

function fail<T>(
  code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
  reason?: string,
): AssistantResult<T> {
  return { ok: false, error: { code, reason } };
}

export interface AssistantTriggerRecordDeps {
  readonly db: AssistantDatabase;
  readonly readConfig: (raw: AssistantDatabaseRaw) => AssistantConfigView;
  /** P1 local Source 触发者（装配层注入的本机用户 identity）。 */
  readonly localIdentity: string;
  /** gate 事务落库后推送快照（服务闭包 publish）。 */
  readonly publish: () => void;
  /** 决策卡候选卡循环（02 §1.3；与 sourceIngest 同一闭包）。 */
  readonly scheduleRouterEvaluation: (input: RouterEvaluationTrigger) => void;
  /**
   * P4 配额生产接线（04 详设 §4 修复批注记）：gate 落 decision_card 同事务计数用的
   * 配额值读点（快照投影同口径的闭包缓存值；decision 判定臂永不抑制，值无判定效果）。
   */
  readonly readDailyQuotaSnapshot: () => number;
  /** P4 auto 直派的后半程（事务外 runPostApproval 编排；同 sourceIngest 接缝）。 */
  readonly dispatchCreatedTicket: (input: {
    decisionId: number;
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  }) => Promise<AssistantDispatchResult>;
}

/**
 * 记录一次本地触发并跑准入门（纯函数判定；单一写者事务内同写 trigger+decision+配额
 * decision 计数+auto 建票）。off 模式：只记 trigger+decision（outcome=ignored），
 * 零执行。
 */
export function createAssistantRecordTrigger(deps: AssistantTriggerRecordDeps): (input: {
  text: string;
  simulated: AssistantStrength;
  targetWorkspaceIdentity?: string;
}) => Promise<AssistantResult<{ triggerId: string; outcome: string }>> {
  const { db, readConfig, localIdentity, publish } = deps;
  return async function recordTrigger(input) {
    try {
      // P4 auto 门预检（04 详设 §2；approveDecision 同口径）：探测是异步 IO，必须在
      // 事务外完成——探测失败降级 decision_card（问人），不消费、不建票。observe/
      // off/inferred 触发时 resolveAssistantAutoGateOutcome 原样透传（零开销）。
      const preConfig = readConfig(db.raw);
      const preVerdict = evaluateAdmission(
        { strength: input.simulated, identity: localIdentity },
        preConfig,
      );
      const autoPlan = await resolveAssistantAutoGateOutcome({
        verdict: preVerdict,
        targetIdentity: input.targetWorkspaceIdentity ?? null,
        probe: getAssistantPorts().workspaceProbe,
      });
      const outcome = db.transaction((raw) => {
        const config = readConfig(raw);
        const verdict = evaluateAdmission(
          { strength: input.simulated, identity: localIdentity },
          config,
        );
        // 预检与事务之间模式翻转（罕见竞态）：以事务内 verdict 为准，auto 预检计划
        // 仅在 verdict 一致时采纳。翻转后的 auto 意图经 Router 建议钩子恢复，不猜测。
        const planMatches = verdict.outcome === preVerdict.outcome;
        let finalOutcome = planMatches ? autoPlan.finalOutcome : verdict.outcome;
        let reasonCode =
          planMatches && autoPlan.finalOutcome !== verdict.outcome
            ? autoPlan.reasonCode
            : verdict.reasonCode;
        // 孤儿 auto_notice 守卫（2026-11-05 全链审查修复，与 sourceIngest 同款）：
        // observe→auto 翻转时 planMatches=false 落 auto_notice，而 observe 预检透传的
        // autoPlan.autoTargetIdentity=null → 不建票不出卡，该 decision 行不进决策卡集、
        // UI 两档均不渲染——explicit 触发从所有可操作面消失。守卫降级 decision_card
        // 问人（复用 auto_missing_target 语义），保证触发必有可操作出口。
        if (finalOutcome === ASSISTANT_OUTCOMES.autoNotice && !autoPlan.autoTargetIdentity) {
          finalOutcome = ASSISTANT_OUTCOMES.decisionCard;
          reasonCode = autoPlan.reasonCode ?? "auto_missing_target";
        }
        const triggerId = `T-${createUuid()}`;
        const ts = nowMs();
        raw
          .prepare(
            "INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            triggerId,
            // source_kind 字面量单出处（contracts ASSISTANT_SOURCE_KINDS；spec §5 P3
            // 落地注记「消费方只引用本常量」——P3 收尾回填，值不变）。
            ASSISTANT_SOURCE_KINDS.local,
            input.simulated,
            localIdentity,
            input.targetWorkspaceIdentity ?? null,
            input.text,
            ts,
          );
        const info = raw
          .prepare(
            "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            triggerId,
            verdict.strength,
            config.mode,
            finalOutcome,
            reasonCode ?? null,
            "gate",
            ts,
          );
        const decisionId = Number(info.lastInsertRowid);
        // P4 配额生产接线（04 详设 §4 修复批注记；spec §2.3）：决策卡落卡即推送事件
        // ——同事务过统一计数接口（kind=decision 永不抑制，本接线只兑现「仍计数」，
        // used.decision 不再恒 0）。quota 值对 decision 判定臂无效果，取快照投影同
        // 口径的闭包缓存值+缺省回落（判定实时读纪律只约束 report/bubble 抑制臂）。
        if (finalOutcome === ASSISTANT_OUTCOMES.decisionCard) {
          admitAssistantDisturbanceTx(raw, {
            kind: ASSISTANT_DISTURBANCE_KINDS.decision,
            atMs: ts,
            quota: deps.readDailyQuotaSnapshot(),
          });
        }
        // auto 直派（04 详设 §2：explicit→直接执行+告知卡）：同事务建票（mandate+
        // ticket+dispatch_intent），派发编排事务外走 runPostApproval（排队/释放复用）。
        let autoTicket:
          | { ticketId: string; targetIdentity: string; tier: AssistantPermissionTier }
          | null = null;
        if (finalOutcome === ASSISTANT_OUTCOMES.autoNotice && autoPlan.autoTargetIdentity) {
          const created = insertAssistantAutoTicket(raw, {
            decisionId,
            triggerText: input.text,
            targetIdentity: autoPlan.autoTargetIdentity,
            channelRef: null,
            atMs: ts,
          });
          if (created.kind === "created") {
            autoTicket = {
              ticketId: created.value.ticketId,
              targetIdentity: created.value.targetIdentity,
              tier: created.value.tier,
            };
          }
        }
        return {
          triggerId,
          outcome: finalOutcome,
          decisionId,
          strength: verdict.strength,
          autoTicket,
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
          deps.scheduleRouterEvaluation({
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
      } else if (outcome.autoTicket) {
        // auto 直派：与人工放行同一 runPostApproval 编排（W1 规划/软预算排队/派发）。
        // 失败如实上抛（2026-11-05 全链审查修复，与 sourceIngest 同口径）：旧实现丢弃
        // 返回值——DB 已由引擎落 failed 但接口返回 ok=true，语义撕裂；失败细节由
        // runPostApproval/markTicketFailed 负责落账与推送，此处只透传错误臂。
        const dispatched = await deps.dispatchCreatedTicket({
          decisionId: outcome.decisionId,
          ticketId: outcome.autoTicket.ticketId,
          brief: input.text,
          targetIdentity: outcome.autoTicket.targetIdentity,
          tier: outcome.autoTicket.tier,
        });
        if (!dispatched.ok) return dispatched;
      }
      publish();
      return { ok: true, value: { triggerId: outcome.triggerId, outcome: outcome.outcome } };
    } catch (error) {
      if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
      if (error instanceof AssistantStoreMigrationError)
        return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
      throw error;
    }
  };
}
