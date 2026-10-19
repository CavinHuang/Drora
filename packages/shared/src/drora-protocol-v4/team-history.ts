import { z } from "zod";
import { TEAM_LIMITS, teamTaskStatusSchema } from "./team.js";

/** 只读历史契约，与八条 mutation 命令分开注册。 */
export const TEAM_HISTORY_QUERY = "getTeamHistory";
export const TEAM_HISTORY_PAGE_DEFAULT = 20;
export const TEAM_HISTORY_PAGE_MAX = 30;
export const TEAM_HISTORY_UNAVAILABLE = "fault.command.teamHistoryUnavailable";
const id = z.string().min(1).max(TEAM_LIMITS.maxIdChars);
const name = z.string().min(1).max(TEAM_LIMITS.maxNameChars);
export const teamHistoryQuerySchema = z
  .object({
    teamId: id,
    beforeSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().positive().max(TEAM_HISTORY_PAGE_MAX).optional(),
  })
  .strict();
export type TeamHistoryQuery = z.infer<typeof teamHistoryQuerySchema>;
export const teamHistoryEntrySchema = z
  .object({
    seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    at: z.string(),
    kind: z.enum([
      "team_created",
      "staged",
      "approved",
      "member_added",
      "task_created",
      "task_updated",
      "message_appended",
      "message_delivered",
      "member_removed",
      "halted",
      "resumed",
      "escalated",
      "archived",
    ]),
    memberName: name.optional(),
    taskId: id.optional(),
    title: z.string().max(TEAM_LIMITS.maxSummaryChars).optional(),
    taskStatus: teamTaskStatusSchema.optional(),
    assignee: name.optional(),
    messageId: id.optional(),
    messageIds: z.array(id).max(TEAM_LIMITS.boardTasksMax).optional(),
    from: name.optional(),
    to: name.optional(),
    message: z.string().max(TEAM_LIMITS.teamMessageMaxChars).optional(),
    summary: z.string().max(TEAM_LIMITS.maxSummaryChars).optional(),
    sourceTaskId: id.optional(),
    sourceAttemptId: id.optional(),
    delivered: z.boolean().optional(),
    reason: z.string().max(TEAM_LIMITS.maxTextChars).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const valid =
      entry.kind === "task_created" || entry.kind === "task_updated"
        ? !!entry.taskId && entry.title !== undefined && !!entry.taskStatus
        : entry.kind === "message_appended"
          ? !!entry.messageId && !!entry.from && !!entry.to && entry.message !== undefined
          : entry.kind === "member_added" || entry.kind === "member_removed"
            ? !!entry.memberName
            : entry.kind === "message_delivered"
              ? entry.messageIds !== undefined
              : true;
    if (!valid) ctx.addIssue({ code: "custom", message: "Incomplete team history fact" });
  });
export type TeamHistoryEntry = z.infer<typeof teamHistoryEntrySchema>;
export const teamHistoryResultSchema = z
  .object({
    type: z.literal(TEAM_HISTORY_QUERY),
    teamId: id,
    events: z.array(teamHistoryEntrySchema).max(TEAM_HISTORY_PAGE_MAX),
    throughSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextBeforeSeq: z.number().int().positive().optional(),
    savedAt: z.string().optional(),
    skippedEntries: z.number().int().nonnegative(),
  })
  .strict();
export type TeamHistoryResult = z.infer<typeof teamHistoryResultSchema>;
export const TEAM_HISTORY_QUERY_SCHEMAS = { [TEAM_HISTORY_QUERY]: teamHistoryQuerySchema } as const;
