import {
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type CollaborationMode,
} from "@drora/contracts";

interface PlanModeTransitionContext {
  toolName: string;
  mode: CollaborationMode;
  planEnabled?: boolean;
  prePlanMode?: Exclude<CollaborationMode, "plan">;
  /** 只读会话（specs/exploration-mode.md）：plan 切换在判定序最前直接拒绝。 */
  readOnly?: boolean;
}

interface PlanModeTransitionPermission {
  behavior: "allow" | "deny";
  reason: string;
  ruleId: string;
}

export function resolvePlanModeTransitionPermission(
  context: PlanModeTransitionContext,
): PlanModeTransitionPermission | undefined {
  // 只读会话在判定序最前拒绝 plan 切换：早于 requiresUserInteraction 的 ask 分支，
  // 避免 ExitPlanMode 先弹确认再被端口拒绝的体验，也杜绝用户误批后解锁写入。
  if (
    context.readOnly &&
    (context.toolName === ENTER_PLAN_MODE_TOOL_NAME || context.toolName === EXIT_PLAN_MODE_TOOL_NAME)
  ) {
    return {
      behavior: "deny",
      reason: "This session is read-only; plan mode transitions are unavailable",
      ruleId: "mode.readOnly.planTransition",
    };
  }

  if (context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
    return {
      behavior: "allow",
      reason: "EnterPlanMode switches to plan mode without a permission prompt",
      ruleId: "tool.plan.enter",
    };
  }

  if (
    context.toolName === EXIT_PLAN_MODE_TOOL_NAME &&
    !(context.planEnabled ?? context.mode === "plan")
  ) {
    return {
      behavior: "deny",
      reason: "ExitPlanMode can only be used while plan mode is active",
      ruleId: "mode.plan.exitOnly",
    };
  }

  return undefined;
}
