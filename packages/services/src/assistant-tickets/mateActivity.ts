/**
 * assistantActivity 聚合（specs/drora-personal-assistant.md §11.4；02 详设 §6）。
 *
 * 事实源=TicketService 快照（唯一所有者）；本文件是纯投影：把快照折叠成
 * 「workspace identity → mate 摘要」映射，供 host 侧任务行 overlay 合成
 * （desktop windowHostControllerService 的 sessionOverlay 同位先例）。
 * 有界（ASSISTANT_MATE_ACTIVITY_LIMITS）、只读、无副作用。
 */
import { ASSISTANT_MATE_ACTIVITY_LIMITS } from "@drora/shared";
import type { SessionMateActivity } from "@drora/shared/drora-protocol-v4";
import { ASSISTANT_OUTCOMES } from "@drora/shared";
import type { AssistantSnapshot } from "./assistantTickets.js";
import { isBudgetActiveStatus } from "./writeDomain.js";

export interface MateActivityByWorkspace {
  /** key=workspaceIdentity（触发/工单的 target workspace；空 identity 不产出）。 */
  readonly byWorkspaceIdentity: ReadonlyMap<string, SessionMateActivity>;
}

/**
 * 折叠快照：activeCount=该 workspace 活动工单数（软预算口径 dispatched/running/
 * awaiting_output——2026-11-05 全链审查修复：awaiting_output 占预算位（04 详设 §3），
 * 旧口径漏计导致任务行摘要与面板/软预算分叉）；pendingDecisions=该 workspace 未决
 * 决策卡数（outcome=decision_card 且 decided_by=gate，按其 trigger 的 target
 * workspace 归属）。updatedAtMs=快照时刻（host 时钟）。
 */
export function computeMateActivityByWorkspace(snapshot: AssistantSnapshot): MateActivityByWorkspace {
  const activeByIdentity = new Map<string, number>();
  for (const ticket of snapshot.tickets) {
    if (!isBudgetActiveStatus(ticket.status)) {
      continue;
    }
    const identity = ticket.targetWorkspaceIdentity?.trim();
    if (!identity) continue;
    activeByIdentity.set(identity, (activeByIdentity.get(identity) ?? 0) + 1);
  }
  const pendingByIdentity = new Map<string, number>();
  for (const decision of snapshot.decisions) {
    if (decision.outcome !== ASSISTANT_OUTCOMES.decisionCard || decision.decidedBy !== "gate") {
      continue;
    }
    const identity = findTriggerIdentity(snapshot, decision.triggerId);
    if (!identity) continue;
    pendingByIdentity.set(identity, (pendingByIdentity.get(identity) ?? 0) + 1);
  }
  const byWorkspaceIdentity = new Map<string, SessionMateActivity>();
  const identities = new Set([...activeByIdentity.keys(), ...pendingByIdentity.keys()]);
  for (const identity of identities) {
    byWorkspaceIdentity.set(identity, {
      activeCount: Math.min(
        activeByIdentity.get(identity) ?? 0,
        ASSISTANT_MATE_ACTIVITY_LIMITS.activeCountMax,
      ),
      pendingDecisions: Math.min(
        pendingByIdentity.get(identity) ?? 0,
        ASSISTANT_MATE_ACTIVITY_LIMITS.pendingDecisionsMax,
      ),
      updatedAtMs: snapshot.updatedAtMs,
    });
  }
  return { byWorkspaceIdentity };
}

/** 决策卡归属 workspace：trigger 的 targetWorkspaceIdentity（缺席=未指定，不产出）。 */
function findTriggerIdentity(snapshot: AssistantSnapshot, triggerId: string): string | null {
  const trigger = snapshot.triggers.find((t) => t.id === triggerId);
  const identity = trigger?.targetWorkspaceIdentity?.trim();
  return identity ? identity : null;
}
