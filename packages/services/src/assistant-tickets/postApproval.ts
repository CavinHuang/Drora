/**
 * 放行后编排（从 assistantTicketsService 抽出——单文件 ≤800 行纪律，先例：
 * routerEvaluation/dispatchEngine/generationRollover 拆分；逻辑不变）。
 *
 * 事件顺序：建票事务（status=dispatched）→ planDispatchTarget（W1 git add，幂等）
 * → budget/conflict 检查（排除自身行）→ queue 或 dispatch；失败→failed+reason。
 * Mode C：派发桥校验（存在/归属）+ W3 冲突检查在 attachDispatch/排队闸内。
 */

import { ASSISTANT_ERROR_CODES, ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type { AssistantResult } from "./assistantTickets.js";
import type { AssistantPermissionTier } from "@drora/shared";
import { createDispatchEngine } from "./dispatchEngine.js";
import { composeTeamLeadBrief } from "./routerShell.js";
import {
  detectWriteDomainOverlap,
  planBudgetAdmission,
  type AssistantWriteDomain,
} from "./writeDomain.js";

type DispatchEngine = ReturnType<typeof createDispatchEngine>;

export interface PostApprovalDeps {
  readonly engine: DispatchEngine;
  readonly publish: () => void;
  /** decisionId → {ticketId, sessionId} 幂等登记（同卡二次放行返回首次结果）。 */
  readonly dispatchIndex: Map<number, { ticketId: string; sessionId: string }>;
}

export async function runPostApproval(
  deps: PostApprovalDeps,
  created: {
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  },
  options: {
    decisionId: number;
    attachSessionId?: string;
    dispatchMode: "A" | "B";
    budgetMaxActivePerWorkspace: number;
  },
): Promise<AssistantResult<{ ticketId: string; sessionId: string; queued?: boolean }>> {
  const { engine, publish, dispatchIndex } = deps;
  // Mode C：派发桥校验（存在/归属）+ W3 冲突检查在 attachDispatch/排队闸内。
  if (options.attachSessionId) {
    const targetIdentity = created.targetIdentity;
    const queuedReason = evaluateQueueGate(
      engine,
      created.ticketId,
      targetIdentity,
      { kind: "workspace" },
      options.budgetMaxActivePerWorkspace,
    );
    if (queuedReason) {
      engine.setWriteDomain(created.ticketId, { kind: "workspace" });
      engine.queueTicket(created.ticketId, queuedReason);
      return { ok: true, value: { ticketId: created.ticketId, sessionId: "", queued: true } };
    }
    const result = await engine.attachDispatch({
      ticketId: created.ticketId,
      text: created.brief,
      targetIdentity,
      sessionId: options.attachSessionId,
    });
    if (!result.ok) return result;
    dispatchIndex.set(options.decisionId, {
      ticketId: created.ticketId,
      sessionId: result.value.sessionId,
    });
    publish();
    return { ok: true, value: { ticketId: created.ticketId, sessionId: result.value.sessionId } };
  }
  const plan = await engine.planDispatchTarget({
    ticketId: created.ticketId,
    targetIdentity: created.targetIdentity,
    // Mode B（02 §5）：lead 团队会话跑主工作区，不做 W1 worktree。
    allowWorktree: options.dispatchMode === "A",
  });
  if (!plan.ok) {
    engine.markTicketFailed(created.ticketId, plan.reason);
    return { ok: false, error: { code: ASSISTANT_ERROR_CODES.dispatchRejected, reason: plan.reason } };
  }
  const ownDomain = plan.domain ?? { kind: "workspace" as const };
  const queuedReason = evaluateQueueGate(
    engine,
    created.ticketId,
    created.targetIdentity,
    ownDomain,
    options.budgetMaxActivePerWorkspace,
  );
  if (queuedReason) {
    engine.setWriteDomain(created.ticketId, ownDomain);
    engine.queueTicket(created.ticketId, queuedReason);
    return { ok: true, value: { ticketId: created.ticketId, sessionId: "", queued: true } };
  }
  // Mode B（02 §5）：lead 会话 + /team 流程指示（prompt 驱动，审批门原样）。
  const brief = options.dispatchMode === "B" ? composeTeamLeadBrief(created.brief) : created.brief;
  const result = await engine.dispatchNewTicket({
    ticketId: created.ticketId,
    brief,
    targetIdentity: created.targetIdentity,
    tier:
      created.tier === ASSISTANT_PERMISSION_TIERS.yolo
        ? ASSISTANT_PERMISSION_TIERS.build
        : created.tier,
    mode: options.dispatchMode,
    ...(plan.hostPath ? { hostPath: plan.hostPath } : {}),
    ...(plan.domain ? { domain: plan.domain } : {}),
  });
  if (!result.ok) return result;
  dispatchIndex.set(options.decisionId, {
    ticketId: created.ticketId,
    sessionId: result.value.sessionId,
  });
  publish();
  return {
    ok: true,
    value: { ticketId: created.ticketId, sessionId: result.value.sessionId },
  };
}

/**
 * 排队闸（spec §9）：软预算（活动工单计数，排除自身行）或同 workspace 活动工单写域
 * 重叠（W2 声明域 / W3 附着整域 vs 其他域；worktree 恒不冲突）。命中→queued 原因文案，
 * 否则 undefined。预算为软约束：并发放行的窗口内竞态按设计容忍（无硬上限、无全局锁）。
 */
function evaluateQueueGate(
  engine: DispatchEngine,
  ticketId: string,
  identity: string,
  ownDomain: AssistantWriteDomain,
  budget: number,
): string | undefined {
  const budgetVerdict = planBudgetAdmission({
    activeCount: engine.activeCountFor(identity, ticketId),
    budgetMaxActivePerWorkspace: budget,
  });
  if (budgetVerdict.action === "queue") {
    return budgetVerdict.reason;
  }
  const conflict = engine
    .listActiveWriteDomains(identity)
    .some(
      (entry) => entry.ticketId !== ticketId && detectWriteDomainOverlap(entry.domain, ownDomain),
    );
  if (conflict) {
    return "同 workspace 存在写域重叠的活动工单（W2/W3 派发桥比对），进入队列等待释放";
  }
  return undefined;
}
