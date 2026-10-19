import { describe, expect, it } from "vitest";
import {
  deriveSessionTeamActivity,
  sessionSummarySchema,
  windowHostControllerTaskActivitySchema,
  sessionTeamActivitySchema,
  teamProjectionStateSchema,
} from "../src/drora-protocol-v4/index.js";

describe("session team activity", () => {
  it("keeps old directory frames valid and preserves team facts through controller frames", () => {
    const legacy = {
      sessionId: "s",
      workspaceId: "w",
      title: "test",
      phase: "completedSuccess",
      sessionEnded: true,
      hasBackgroundWork: false,
      lastActivityAt: 2,
      createdAt: 1,
    };
    expect(sessionSummarySchema.parse(legacy).teamActivity).toBeUndefined();
    const activity = { teamId: "team", status: "idle", memberCount: 3, completed: 5, total: 5 };
    expect(sessionSummarySchema.parse({ ...legacy, teamActivity: activity }).teamActivity).toEqual(
      activity,
    );
    expect(
      windowHostControllerTaskActivitySchema.parse({
        phase: legacy.phase,
        lastActivityAt: 2,
        hasBackgroundWork: false,
        teamActivity: activity,
      }).teamActivity,
    ).toEqual(activity);
  });
  it("keeps failed/cancelled in totals without inferring team completion", () => {
    const team = teamProjectionStateSchema.parse({
      teamId: "team",
      status: "idle",
      members: [],
      mailboxTail: [],
      board: {
        limit: 100,
        tasks: ["completed", "failed", "cancelled"].map((status, i) => ({
          taskId: String(i),
          title: "task",
          status,
          attempt: 1,
          dependsOn: [],
          artifactRefs: [],
          spec: { goal: "task", acceptance: [] },
          createdAt: "2026-10-19T00:00:00Z",
          updatedAt: "2026-10-19T00:00:00Z",
        })),
      },
    });
    expect(sessionTeamActivitySchema.parse(deriveSessionTeamActivity(team))).toEqual({
      teamId: "team",
      status: "idle",
      completed: 1,
      total: 3,
      memberCount: 0,
    });
    expect(deriveSessionTeamActivity(undefined)).toBeUndefined();
  });
  it("counts only planned members before approval", () => {
    const team = teamProjectionStateSchema.parse({
      teamId: "draft",
      status: "staged",
      members: [],
      mailboxTail: [],
      board: { limit: 100, tasks: [] },
      stagedDraft: {
        draftMembers: [{ memberName: "A" }],
        draftTasks: [{ taskId: "t", title: "task", dependsOn: [] }],
        awaitingFeedback: false,
      },
    });
    expect(deriveSessionTeamActivity(team)).toMatchObject({
      memberCount: 1,
      total: 1,
      completed: 0,
      status: "staged",
    });
  });
});
