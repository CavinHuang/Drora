import { z } from "zod";
import {
  ASSISTANT_MATE_ACTIVITY_LIMITS,
  SESSION_MATE_ACTIVITY_KEY,
} from "../contracts/assistant.js";

/**
 * Drora Mate 活动摘要（specs/drora-personal-assistant.md §11.4；02 详设 §6）：
 * host 侧 TicketService 快照合成的任务行 overlay 字段——事实源在 host，不经 CLI 投影
 * （CLI→host 的 sessions-index wire 不携带本字段，桌面/手机经 controller 任务行透传）。
 * 与 sessions-index-team-activity.ts 同位：有界、strict、旧帧缺席合法。
 */
export const sessionMateActivitySchema = z
  .object({
    /** 目标 workspace 的活动工单数（dispatched/running）。 */
    activeCount: z
      .number()
      .int()
      .nonnegative()
      .max(ASSISTANT_MATE_ACTIVITY_LIMITS.activeCountMax),
    /** 目标 workspace 的待决策卡数（decision_card 未决）。 */
    pendingDecisions: z
      .number()
      .int()
      .nonnegative()
      .max(ASSISTANT_MATE_ACTIVITY_LIMITS.pendingDecisionsMax),
    /** 摘要合成时刻（host 时钟；仅展示新鲜度，不参与排序语义）。 */
    updatedAtMs: z.number().finite().nonnegative(),
  })
  .strict();
export type SessionMateActivity = z.infer<typeof sessionMateActivitySchema>;

export { SESSION_MATE_ACTIVITY_KEY };
