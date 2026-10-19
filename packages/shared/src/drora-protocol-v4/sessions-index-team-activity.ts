import { z } from "zod";
import { TEAM_LIMITS, teamStatusSchema, type TeamProjectionState } from "./team.js";

/** 有界会话目录契约；列表/Host/手机复用，不能为每行订阅完整会话。 */
export const SESSION_TEAM_ACTIVITY_KEY = "teamActivity";
export const sessionTeamActivitySchema = z
  .object({
    teamId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
    name: z.string().max(TEAM_LIMITS.maxNameChars).optional(),
    status: teamStatusSchema,
    memberCount: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type SessionTeamActivity = z.infer<typeof sessionTeamActivitySchema>;

export function deriveSessionTeamActivity(
  team: TeamProjectionState | undefined,
): SessionTeamActivity | undefined {
  if (!team) return undefined;
  const staged = team.status === "staged" ? team.stagedDraft : undefined;
  return {
    teamId: team.teamId,
    ...(team.name === undefined ? {} : { name: team.name }),
    status: team.status,
    memberCount: staged?.draftMembers.length ?? team.members.length,
    completed: staged ? 0 : team.board.tasks.filter((task) => task.status === "completed").length,
    total: staged?.draftTasks.length ?? team.board.tasks.length,
  };
}
