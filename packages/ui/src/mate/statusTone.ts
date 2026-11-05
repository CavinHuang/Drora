/**
 * Mate 状态灯档映射（docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §5
 * 「状态灯 token 映射」的单一出处；DESIGN.md 语义 token，不为状态发明新色）：
 * 待决策=destructive（仅灯）/ 运行=warning / 观察=foreground-subtlest 空心 /
 * 完成=success / 失败=destructive。时间线 mate scope token P2 启用（01 §5）。
 * P2 新增 queued 档（specs §9 软预算排队）：warning 空心（等待语义——非活动执行，
 * 但区别于观察档的静默空心；共用 warning 色不发明新色）。
 * P4 第二棒新增 awaiting 档（04 详设 §3 工件核验滞留）：与 queued 同为 warning 空心
 * （同样「等待人工/事件」语义，不发明新色；滞留文本伴随灯出现满足 never-by-color-alone）。
 */
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantTicketView } from "@drora/services";

export type MateLampTone =
  | "decision"
  | "running"
  | "observe"
  | "queued"
  | "awaiting"
  | "done"
  | "failed";

/** 灯的视觉类：观察/排队/核验滞留档是空心灯（描边不填充），其余为语义色实心圆点。 */
export const MATE_LAMP_TONE_CLASS: Record<MateLampTone, string> = {
  decision: "bg-destructive",
  running: "bg-warning",
  observe: "border border-foreground-subtlest",
  queued: "border border-warning",
  awaiting: "border border-warning",
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
  if (status === ASSISTANT_TICKET_STATUSES.queued) return "queued";
  if (status === ASSISTANT_TICKET_STATUSES.awaitingOutput) return "awaiting";
  return "observe";
}
