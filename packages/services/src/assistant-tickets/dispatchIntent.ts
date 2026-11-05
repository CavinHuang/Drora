/**
 * 派发意图（ticket.dispatch_intent 列 JSON；P2 审查修复新增纯模块）。
 *
 * 背景（2026-11-05 审查发现）：放行时的派发形态（Mode A/B/C、附着目标、放行权限档）
 * 此前只存在于 runPostApproval 的内存参数——工单因软预算/写域冲突进入 queued 后，
 * 终态释放路径（dispatchEngine.releaseNextQueued）读不到这些事实，队头一律按
 * Mode A/build 直派原文：Mode B 的 /team 建队指示丢失、Mode C 的附着目标无处可取，
 * 用户放行动作被静默改写（违反 spec §2.4 诚实规则与 §7 三模式定义）。
 *
 * 修复机制：建票事务即落库意图（approveDecision INSERT），queued FIFO 释放按落库
 * 形态重放派发。dispatch_mode 列不能承担该职责——它由 commitDispatchSuccess 在
 * 派发成功后才写入，queued 行恒为 NULL。
 *
 * 语义边界（单一消费方=releaseNextQueued）：
 * - 只在放行建票事务写入一次（换代重派是 Mode A 直派不经释放路径，不读本列；
 *   follow-up/附着也不读本列）；
 * - brief 列恒存原文（verbatim+追加段），Mode B 的 /team 指示不落库、由释放路径
 *   按 mode="B" 经 composeTeamLeadBrief 幂等重套——不双写两种 brief 形态；
 * - 坏 JSON/未知形状 → undefined（诚实回退 Mode A/build，与 v2 旧行一致）。
 *
 * 纯模块：无 IO。
 */
import type { AssistantPermissionTier } from "@drora/shared";

/** 放行时的派发意图（ticket.dispatch_intent JSON 形状）。 */
export interface AssistantDispatchIntent {
  /** 派发模式：A=独立单工单；B=建队（释放时重套 /team 指示）；C=附着既有会话。 */
  readonly mode: "A" | "B" | "C";
  /** mode="C" 时的附着目标会话（放行事务前已经 Tier2 预检；释放时 attachDispatch 再校验）。 */
  readonly attachSessionId?: string;
  /** 放行时的权限档（释放恢复，不再一律降为 build）。 */
  readonly tier: Exclude<AssistantPermissionTier, "yolo">;
}

/** 序列化（建票事务写列用）。 */
export function serializeDispatchIntent(intent: AssistantDispatchIntent): string {
  return JSON.stringify(intent);
}

/** ticket.dispatch_intent JSON → 意图（坏 JSON/未知形状 → undefined 诚实降级）。 */
export function parseDispatchIntent(raw: string | null): AssistantDispatchIntent | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AssistantDispatchIntent>;
    if (parsed.mode !== "A" && parsed.mode !== "B" && parsed.mode !== "C") return undefined;
    const tier =
      parsed.tier === "build" || parsed.tier === "guarded" ? parsed.tier : undefined;
    if (!tier) return undefined;
    if (parsed.mode === "C" && typeof parsed.attachSessionId !== "string") return undefined;
    return {
      mode: parsed.mode,
      tier,
      ...(parsed.mode === "C" && typeof parsed.attachSessionId === "string"
        ? { attachSessionId: parsed.attachSessionId }
        : {}),
    };
  } catch {
    return undefined;
  }
}
