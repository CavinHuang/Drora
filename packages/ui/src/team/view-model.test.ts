import { describe, expect, it } from "vitest";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";

import { mapTeamProjectionToViewModel } from "./view-model.js";

function projection(_overrides: Partial<TeamProjectionState> = {}): TeamProjectionState {
  return {
    teamId: "team_1",
    status: "active",
    permissionMode: "build",
    members: [
      {
        agentId: "agent_a",
        memberName: "alice",
        profile: "researcher",
        profileColor: "bg-red-500",
        state: "working",
        currentTaskId: "task_1",
        childSessionId: "child_a",
      },
    ],
    board: {
      limit: 100,
      tasks: [
        {
          taskId: "task_1",
          title: "进行中任务",
          status: "in_progress",
          assignee: "alice",
          attempt: 2,
          dependsOn: [],
          artifactRefs: [],
        },
        {
          taskId: "task_2",
          title: "待办任务",
          status: "pending",
          attempt: 0,
          dependsOn: ["task_1"],
          artifactRefs: [],
        },
        {
          taskId: "task_3",
          title: "已完成",
          status: "completed",
          attempt: 1,
          dependsOn: [],
          artifactRefs: ["a.txt"],
        },
      ],
    },
    mailboxTail: [{ messageId: "m1", from: "alice", summary: "done" }],
    artifacts: { dir: ".drora/team-artifacts/team_1" },
  } as unknown as TeamProjectionState;
}

describe("mapTeamProjectionToViewModel", () => {
  it("derives the three-column board and keeps internal handoff state out", () => {
    const model = mapTeamProjectionToViewModel(projection());
    expect(model.status).toBe("active");
    expect(model.permissionMode).toBe("build");
    expect(model.board.inProgress.map((t) => t.taskId)).toEqual(["task_1"]);
    expect(model.board.pending.map((t) => t.taskId)).toEqual(["task_2"]);
    expect(model.board.completed.map((t) => t.taskId)).toEqual(["task_3"]);
    expect(model.board.inProgress[0]?.attempt).toBe(2);
    expect(model.members[0]).toMatchObject({ memberName: "alice", state: "working" });
  });

  it("derives staged draft rows when present", () => {
    const staged = projection();
    (staged as { stagedDraft?: unknown }).stagedDraft = {
      draftMembers: [
        {
          memberName: "a",
          profile: "researcher",
          modelSelection: { provider: "zai", model: "glm-5", thought: "high" },
        },
        { memberName: "b" },
      ],
      draftTasks: [
        { taskId: "t1", title: "x", assignee: "a", dependsOn: [] },
        { taskId: "t2", title: "y", dependsOn: ["t1"] },
      ],
      awaitingFeedback: true,
    };
    (staged as { status?: string }).status = "staged";
    const model = mapTeamProjectionToViewModel(staged);
    expect(model.stagedDraft).toEqual({
      members: [
        {
          memberName: "a",
          profile: "researcher",
          modelSelection: { provider: "zai", model: "glm-5", thought: "high" },
        },
        { memberName: "b" },
      ],
      tasks: [
        { taskId: "t1", title: "x", assignee: "a", dependsOn: [] },
        { taskId: "t2", title: "y", dependsOn: ["t1"] },
      ],
      awaitingFeedback: true,
    });
  });
});
