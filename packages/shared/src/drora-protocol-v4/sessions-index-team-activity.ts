import { z } from "zod";
import {
  TEAM_LIMITS,
  teamMemberStateSchema,
  teamStatusSchema,
  type TeamProjectionState,
} from "./team.js";
export const SESSION_TEAM_MEMBERS_PREVIEW_MAX = 6;

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
    working: z.number().int().nonnegative().optional(),
    blocked: z.number().int().nonnegative().optional(),
    members: z
      .array(
        z.object({
          agentId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
          memberName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
          state: teamMemberStateSchema,
        }),
      )
      .max(SESSION_TEAM_MEMBERS_PREVIEW_MAX)
      .optional(),
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
    working: staged ? 0 : team.members.filter((member) => member.state === "working").length,
    blocked: staged
      ? 0
      : team.board.tasks.filter(
          (task) =>
            task.status === "pending" &&
            task.dependsOn.some(
              (id) =>
                team.board.tasks.find((candidate) => candidate.taskId === id)?.status !==
                "completed",
            ),
        ).length,
    members: staged
      ? []
      : team.members.slice(0, SESSION_TEAM_MEMBERS_PREVIEW_MAX).map((member) => ({
          agentId: member.agentId,
          memberName: member.memberName,
          state: member.state,
        })),
  };
}
