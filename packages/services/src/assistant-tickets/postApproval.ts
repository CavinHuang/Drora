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
import { resolveAnchorVerdict } from "./incarnation.js";
import { getAssistantPorts } from "./assistantPorts.js";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
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

/**
 * 放行前置预检（approveDecision 从本文件拆出——assistantTicketsService ≤800 行纪律）：
 * Router 建议读取 + Tier2 附着目标校验 + workspace 探测。任一失败返回 fail 臂
 * （决策卡不消费、不建票，人工可改选/改写后重放）；预检通过返回放行参数解析结果。
 */
export async function runApprovalPrecheck(
  raw: AssistantDatabaseRaw,
  engine: DispatchEngine,
  input: {
    decisionId: number;
    attachToSessionId?: string;
    targetWorkspaceIdentity?: string;
  },
): Promise<
  | { readonly ok: false; readonly error: { readonly code: string; readonly reason?: string } }
  | {
      readonly ok: true;
      readonly attachSessionId?: string;
      readonly suggestedTarget?: string;
      readonly decisionWorkspaceIdentity: string | null;
    }
> {
  // Router 建议预填（02 §1.3）：attach 建议在人按 Y 时生效（派发桥随后仍校验目标）。
  const suggestionRow = raw
    .prepare("SELECT state, verdict FROM router_evaluation WHERE decision_id = ?")
    .get(input.decisionId) as { state: string; verdict: string | null } | undefined;
  const suggestion =
    suggestionRow?.state === "suggested" && suggestionRow.verdict
      ? (JSON.parse(suggestionRow.verdict) as {
          kind?: string;
          arm?: { sessionId?: string; targetWorkspaceIdentity?: string };
        })
      : undefined;
  // P10b（10 号详设 §3.1/§3.3「准入门唯一」；2026-11-07 安全审查修复）：manage 建议卡
  // 的唯一放行口是 approveManageDecision（不建 mandate/ticket、不派 worker，经 manage
  // 执行端口调既有 harness 服务面）。本放行口对 suggested manage verdict 诚实拒绝
  // （validationFailed 同款、卡不消费、不建票）——此前 precheck 只消费 attach/dispatch
  // 臂，manage 卡经本口会以「管理意图原文」为 brief 建 worker 票，管理动作形成第二条
  // 执行路径（桌宠速览等臂无关消费方真实可达）；服务层拒绝后任何消费方都被挡住，不再
  // 依赖 UI 呈现约束。无 suggested 评估的普通卡不受影响（suggestion=undefined 直通）。
  if (suggestion?.kind === "manage") {
    return {
      ok: false,
      error: {
        code: ASSISTANT_ERROR_CODES.validationFailed,
        reason: "manage 决策卡不可经 approveDecision 放行（管理动作唯一放行口=approveManageDecision）",
      },
    };
  }
  const attachSessionId =
    input.attachToSessionId?.trim() ||
    (suggestion?.kind === "attach" ? suggestion.arm?.sessionId : undefined);
  const suggestedTarget =
    suggestion?.kind === "attach" || suggestion?.kind === "dispatch"
      ? suggestion.arm?.targetWorkspaceIdentity
      : undefined;
  const decisionRow = raw
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
      return {
        ok: false,
        error: { code: ASSISTANT_ERROR_CODES.validationFailed, reason: "附着缺少目标 workspace 归属" },
      };
    }
    const probe = await engine.probeAttachTarget({
      targetIdentity: preIdentity,
      sessionId: attachSessionId,
    });
    if (probe.kind !== "ok") {
      return {
        ok: false,
        error: {
          code: ASSISTANT_ERROR_CODES.attachTargetInvalid,
          reason: `附着目标校验失败：${resolveAnchorVerdict(probe).reason}`,
        },
      };
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
          return {
            ok: false,
            error: {
              code: ASSISTANT_ERROR_CODES.dispatchRejected,
              reason: `workspace 探测失败，决策卡未消费（改选目标后可重放）：${probe.reason}`,
            },
          };
        }
      }
    }
  }
  return {
    ok: true,
    ...(attachSessionId ? { attachSessionId } : {}),
    ...(suggestedTarget ? { suggestedTarget } : {}),
    decisionWorkspaceIdentity: decisionRow?.workspace_identity ?? null,
  };
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
    return {
      ok: false,
      error: { code: ASSISTANT_ERROR_CODES.dispatchRejected, reason: plan.reason },
    };
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
