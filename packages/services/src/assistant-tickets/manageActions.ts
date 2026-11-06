/**
 * P10b 管理动作面（10 号详设 §3.1；2026-11-07）：manage 臂的人工放行编排与执行回写。
 *
 * 事件顺序（approveManageDecision）：
 * 1. 放行前置预检（事务外）：读 router_evaluation verdict（须 suggested 的 manage 臂）
 *    + 实时台账可见集复核（deriveManageTargets——评估输入携带清单的同源推导；清单外
 *    targetRef=失配拒绝，attach 臂 probeAttachTarget 同款 fail-closed 反编造兜底）；
 * 2. 事务：admission_decision 翻 outcome=managed + decided_by=user + manage_state=
 *    executing（幂等：已翻行二次放行返回首次结果；并发兜底=UPDATE ... WHERE outcome=
 *    decision_card 行数判定）；
 * 3. publish 后**异步执行**（不 await，调用方即时拿 ok）：manage 端口（node.ts 装配的
 *    既有 harness 服务面——session=v4 stop 含 expectedForegroundExecutionId 守卫/
 *    offpeak=offPeakTaskService.cancelTask，无特权路径无旁路）→ 结果回写
 *    manage_state=executed/skipped/failed + manage_note（失败不自动重试；重新触发=
 *    新卡新决策）。
 *
 * 纯模块纪律：db/publish/端口由调用方注入；本文件不发 IO（除注入的 manage 端口）。
 * auto 永不放行 manage（autoDispatch.handleRouterSuggested 显式排除——管理≠自动）。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MANAGE_ACTIONS,
  ASSISTANT_MANAGE_LIMITS,
  ASSISTANT_MANAGE_STATES,
  ASSISTANT_MANAGE_TARGET_KINDS,
  ASSISTANT_OUTCOMES,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import type { AssistantResult } from "./assistantTickets.js";
import { getAssistantPorts } from "./assistantPorts.js";
import { deriveManageTargets } from "./routerShell.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

/** 回写 note 截断（code point；界=ASSISTANT_MANAGE_LIMITS.noteMax 单出处）。 */
function capManageNote(note: string): string {
  const chars = [...note];
  return chars.length > ASSISTANT_MANAGE_LIMITS.noteMax
    ? `${chars.slice(0, ASSISTANT_MANAGE_LIMITS.noteMax).join("")}…`
    : note;
}

// ---------------------------------------------------------------------------
// stop_turn 取帧纯函数（执行面守卫传参的唯一判定处；node.ts 装配与单测同引——
// 「executionId 从会话活动执行帧取」的语义锁死在此，不建第二取帧路径）。
// ---------------------------------------------------------------------------

/** 会话控制面读点形状（ConversationSnapshot.control 的最小投影；装配层喂真值）。 */
export interface ManageStopControlView {
  /** 会话当前是否存在可停执行（UI SessionPane handleStop 同一判定门）。 */
  readonly canStop?: boolean;
  readonly stopState?: string;
  /** 活动执行帧（v4 snapshot control.activeWorks；foregroundExecutionId 来自 CLI）。 */
  readonly activeWorks?: readonly { readonly foregroundExecutionId?: string }[];
}

/** stop_turn 执行计划：none=无可停执行（幂等成功）；stop=发 v4 stop（守卫参数可选携带）。 */
export type ManageStopPlan =
  | { readonly kind: "none"; readonly detail: string }
  | {
      readonly kind: "stop";
      /** 取自活动执行帧首个带 foregroundExecutionId 的 active work（与 SessionPane
       * handleStop 同一取帧语义——CAS 守卫防误杀迟到 Stop；帧上无 id 则不带守卫
       * 参数发 stop，镜像 UI 行为，不加特权判定）。 */
      readonly expectedForegroundExecutionId?: string;
    };

/**
 * stop_turn 取帧判定（纯函数）：!canStop → 无可停执行（已停/停止中/空闲——幂等成功
 * 「已无需执行」）；canStop → 从 activeWorks 取首个 foregroundExecutionId（缺席不带
 * 守卫参数）。与 UI SessionPane.handleStop 逐语义对齐：mate 无特权路径，同一守卫
 * 原样适用（CLI 侧 expectedForegroundExecutionId CAS 校验拒绝即失败）。
 */
export function planManageStopTurn(control: ManageStopControlView): ManageStopPlan {
  if (!control.canStop) {
    return { kind: "none", detail: "会话当前无可停执行（已停或空闲），已无需执行" };
  }
  const executionId = control.activeWorks?.find(
    (work) =>
      typeof work.foregroundExecutionId === "string" && work.foregroundExecutionId.length > 0,
  )?.foregroundExecutionId;
  return {
    kind: "stop",
    ...(executionId ? { expectedForegroundExecutionId: executionId } : {}),
  };
}

// ---------------------------------------------------------------------------
// 放行预检（事务外）：manage verdict 读取 + 实时可见集复核。
// ---------------------------------------------------------------------------

interface ManageVerdictRow {
  readonly state: string;
  readonly verdict: string | null;
}

/** 读决策与其 manage verdict（router_evaluation 落账的归一后 RouterDecision 形状）。 */
function readManageVerdict(
  raw: AssistantDatabaseRaw,
  decisionId: number,
):
  | {
      readonly ok: true;
      readonly arm: {
        readonly targetKind: string;
        readonly targetRef: string;
        readonly action: string;
        readonly reason: string;
      };
      readonly evidence: readonly string[];
    }
  | { readonly ok: false; readonly code: string; readonly reason: string } {
  const decision = raw
    .prepare("SELECT id, outcome FROM admission_decision WHERE id = ?")
    .get(decisionId) as { id: number; outcome: string } | undefined;
  if (!decision) {
    return { ok: false, code: ASSISTANT_ERROR_CODES.decisionNotFound, reason: "决策卡不存在" };
  }
  // 幂等：已放行（managed）直接走放行路径返回 ok（执行结果以快照 manageExecution 为准）。
  if (decision.outcome === ASSISTANT_OUTCOMES.managed) {
    return {
      ok: false,
      code: "__already_managed__",
      reason: "已放行（幂等返回）",
    };
  }
  if (decision.outcome !== ASSISTANT_OUTCOMES.decisionCard) {
    return {
      ok: false,
      code: ASSISTANT_ERROR_CODES.decisionNotFound,
      reason: `outcome=${decision.outcome} 不可放行`,
    };
  }
  const evaluation = raw
    .prepare("SELECT state, verdict FROM router_evaluation WHERE decision_id = ?")
    .get(decisionId) as ManageVerdictRow | undefined;
  if (evaluation?.state !== "suggested" || !evaluation.verdict) {
    return {
      ok: false,
      code: ASSISTANT_ERROR_CODES.validationFailed,
      reason: "决策卡无 manage 建议评估（未评估/降级态不可管理放行）",
    };
  }
  let parsed: {
    kind?: unknown;
    arm?: Record<string, unknown>;
    evidence?: unknown;
  };
  try {
    parsed = JSON.parse(evaluation.verdict) as typeof parsed;
  } catch {
    return {
      ok: false,
      code: ASSISTANT_ERROR_CODES.validationFailed,
      reason: "manage 建议评估损坏（不猜测）",
    };
  }
  const arm = parsed.arm ?? {};
  if (
    parsed.kind !== "manage" ||
    typeof arm.targetKind !== "string" ||
    typeof arm.targetRef !== "string" ||
    typeof arm.action !== "string" ||
    typeof arm.reason !== "string"
  ) {
    return {
      ok: false,
      code: ASSISTANT_ERROR_CODES.validationFailed,
      reason: "非 manage 臂决策（本入口只放行管理动作）",
    };
  }
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ok: true,
    arm: {
      targetKind: arm.targetKind,
      targetRef: arm.targetRef,
      action: arm.action,
      reason: arm.reason,
    },
    evidence,
  };
}

/**
 * 实时可见集复核（attach probeAttachTarget 同款 fail-closed 兜底）：targetRef 不在
 * 当前台账可见集 → invalid（manageTargetInvalid，决策卡不消费）；台账 provider 缺席
 * → unavailable（manageUnavailable——无法复核不是失配，诚实区分）。返回匹配对象的
 * workspace 域键（执行端口据此定位会话/任务；可见集行携带，非 Router 臂自报——防编造
 * workspace）。
 */
function resolveVisibleManageTarget(input: {
  readonly targetKind: string;
  readonly targetRef: string;
}):
  | { readonly ok: true; readonly workspaceKey: string }
  | { readonly ok: false; readonly kind: "invalid" | "unavailable"; readonly reason: string } {
  const { inventory } = getAssistantPorts();
  const providerInventory = inventory ? inventory() : null;
  if (!providerInventory) {
    return {
      ok: false,
      kind: "unavailable",
      reason: "台账不可用（provider 缺席/冷启动），无法复核管理目标",
    };
  }
  const targets = deriveManageTargets(providerInventory);
  const match = targets.find(
    (target) => target.targetKind === input.targetKind && target.targetRef === input.targetRef,
  );
  if (!match) {
    return {
      ok: false,
      kind: "invalid",
      reason: `目标不在台账可见集（${input.targetKind} ${input.targetRef}——清单外即失配拒绝，不猜测）`,
    };
  }
  return { ok: true, workspaceKey: match.workspaceKey };
}

// ---------------------------------------------------------------------------
// 服务闭包工厂（assistantTicketsService ≤800 行纪律，照 mateActions/configActions
// 拆分先例）。
// ---------------------------------------------------------------------------

export function createManageActions(deps: {
  readonly db: AssistantDatabase;
  readonly publish: () => void;
}): IAssistantTicketServiceManageFace {
  const { db } = deps;

  /** 执行结果回写（executing → executed/skipped/failed；幂等 UPDATE 守 state）。 */
  function writeBackManageResult(
    decisionId: number,
    state: "executed" | "skipped" | "failed",
    note: string,
  ): void {
    try {
      db.transaction((raw: AssistantDatabaseRaw) => {
        raw
          .prepare(
            "UPDATE admission_decision SET manage_state = ?, manage_note = ?, decided_ms = ? WHERE id = ? AND manage_state = ?",
          )
          .run(state, capManageNote(note), nowMs(), decisionId, ASSISTANT_MANAGE_STATES.executing);
      });
    } catch (error) {
      logger.warn("assistant-tickets manage 执行结果回写失败", error);
      return;
    }
    deps.publish();
  }

  async function approveManageDecision(input: {
    decisionId: number;
  }): Promise<AssistantResult<{ ok: true }>> {
    const fail = (
      code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
      reason?: string,
    ): AssistantResult<{ ok: true }> => ({ ok: false, error: { code, reason } });

    let arm: { targetKind: string; targetRef: string; action: string };
    try {
      const verdict = readManageVerdict(db.raw, input.decisionId);
      if (!verdict.ok) {
        if (verdict.code === "__already_managed__") return { ok: true, value: { ok: true } };
        return fail(
          verdict.code as (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
          verdict.reason,
        );
      }
      arm = verdict.arm;
      // 放行预检（事务外）：实时可见集复核 + 执行通道在位检查（缺一即拒绝，卡不消费）。
      const visible = resolveVisibleManageTarget(arm);
      if (!visible.ok) {
        return fail(
          visible.kind === "unavailable"
            ? ASSISTANT_ERROR_CODES.manageUnavailable
            : ASSISTANT_ERROR_CODES.manageTargetInvalid,
          visible.reason,
        );
      }
      if (!getAssistantPorts().manage) {
        return fail(
          ASSISTANT_ERROR_CODES.manageUnavailable,
          "manage 执行通道未装配（旧装配），决策卡不消费",
        );
      }
      // 事务：翻 managed + executing（单写者；并发二次放行被 WHERE outcome 行数兜底）。
      const updated = db.transaction((raw: AssistantDatabaseRaw): boolean => {
        const info = raw
          .prepare(
            "UPDATE admission_decision SET outcome = ?, decided_by = ?, manage_state = ?, decided_ms = ? WHERE id = ? AND outcome = ?",
          )
          .run(
            ASSISTANT_OUTCOMES.managed,
            "user",
            ASSISTANT_MANAGE_STATES.executing,
            nowMs(),
            input.decisionId,
            ASSISTANT_OUTCOMES.decisionCard,
          );
        return info.changes > 0;
      });
      if (!updated) {
        const outcome = db.raw
          .prepare("SELECT outcome FROM admission_decision WHERE id = ?")
          .get(input.decisionId) as { outcome: string } | undefined;
        if (outcome?.outcome === ASSISTANT_OUTCOMES.managed) {
          return { ok: true, value: { ok: true } }; // 并发二次放行：幂等返回首次结果
        }
        return fail(ASSISTANT_ERROR_CODES.decisionNotFound, "决策卡已被消费");
      }
      logger.info("assistant-tickets manage 决策放行，异步执行", {
        decisionId: input.decisionId,
        targetKind: arm.targetKind,
        action: arm.action,
      });
      deps.publish();
      // 事务提交后异步执行（10 号详设 §3.1：结果回写卡，失败不自动重试）。
      void (async () => {
        const port = getAssistantPorts().manage;
        if (!port) {
          writeBackManageResult(input.decisionId, "failed", "执行通道未装配");
          return;
        }
        try {
          const result = await port({
            targetKind:
              arm.targetKind === ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask
                ? ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask
                : ASSISTANT_MANAGE_TARGET_KINDS.session,
            targetRef: arm.targetRef,
            action:
              arm.action === ASSISTANT_MANAGE_ACTIONS.cancel
                ? ASSISTANT_MANAGE_ACTIONS.cancel
                : ASSISTANT_MANAGE_ACTIONS.stopTurn,
            workspaceKey: visible.workspaceKey,
          });
          if (!result.ok) {
            writeBackManageResult(input.decisionId, "failed", result.reason);
            return;
          }
          if (result.outcome === "already_terminal") {
            writeBackManageResult(input.decisionId, "skipped", result.detail);
            return;
          }
          writeBackManageResult(
            input.decisionId,
            "executed",
            result.detail ?? "已执行（既有 harness 服务面）",
          );
        } catch (error) {
          writeBackManageResult(
            input.decisionId,
            "failed",
            error instanceof Error ? error.message : String(error),
          );
        }
      })();
      return { ok: true, value: { ok: true } };
    } catch (error) {
      // busy/migration 错误分类（照 mateThread.ts 同款）。
      if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
      if (error instanceof AssistantStoreMigrationError) {
        return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
      }
      throw error;
    }
  }

  return { approveManageDecision };
}

/** 服务面形状（IAssistantTicketService.approveManageDecision 的实现件）。 */
export interface IAssistantTicketServiceManageFace {
  approveManageDecision(input: { decisionId: number }): Promise<AssistantResult<{ ok: true }>>;
}
