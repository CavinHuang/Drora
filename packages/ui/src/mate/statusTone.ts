/**
 * Mate 状态灯五档映射（docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §5
 * 「状态灯 token 映射」的单一出处；DESIGN.md 语义 token，不为状态发明新色）：
 * 待决策=destructive（仅灯）/ 运行=warning / 观察=foreground-subtlest 空心 /
 * 完成=success / 失败=destructive。时间线 mate scope token P2 启用（01 §5）。
 */
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantTicketView } from "@drora/services";

export type MateLampTone = "decision" | "running" | "observe" | "done" | "failed";

/** 灯的视觉类：观察档是空心灯（描边不填充），其余为语义色实心圆点。 */
export const MATE_LAMP_TONE_CLASS: Record<MateLampTone, string> = {
  decision: "bg-destructive",
  running: "bg-warning",
  observe: "border border-foreground-subtlest",
  done: "bg-success",
  failed: "bg-destructive",
};

/** 工单状态 → 灯档；未知状态按空心（观察）档诚实降级，不猜测语义。 */
export function mateTicketLampTone(status: AssistantTicketView["status"]): MateLampTone {
  if (status === ASSISTANT_TICKET_STATUSES.done) return "done";
  if (status === ASSISTANT_TICKET_STATUSES.failed) return "failed";
  if (
    status === ASSISTANT_TICKET_STATUSES.dispatched ||
    status === ASSISTANT_TICKET_STATUSES.running
  ) {
    return "running";
  }
  return "observe";
}
