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
        {
          taskId: "task_4",
          title: "失败任务",
          status: "failed",
          assignee: "alice",
          attempt: 3,
          dependsOn: [],
          artifactRefs: [],
        },
        {
          taskId: "task_5",
          title: "已取消任务",
          status: "cancelled",
          attempt: 1,
          dependsOn: [],
          artifactRefs: [],
        },
        {
          taskId: "task_6",
          title: "lead 接管任务",
          status: "pending",
          assignee: "lead",
          attempt: 0,
          dependsOn: ["task_2"],
          artifactRefs: [],
        },
      ],
    },
    mailboxTail: [
      { messageId: "m1", from: "alice", to: "lead", summary: "done" },
      { messageId: "m2", from: "lead", to: "alice" },
    ],
    artifacts: { dir: ".drora/team-artifacts/team_1" },
  } as unknown as TeamProjectionState;
}

describe("mapTeamProjectionToViewModel", () => {
  it("derives the three-column board and keeps internal handoff state out", () => {
    const model = mapTeamProjectionToViewModel(projection());
    expect(model.status).toBe("active");
    expect(model.permissionMode).toBe("build");
    expect(model.board.inProgress.map((t) => t.taskId)).toEqual(["task_1"]);
    expect(model.board.pending.map((t) => t.taskId)).toEqual(["task_2", "task_6"]);
    expect(model.board.completed.map((t) => t.taskId)).toEqual(["task_3"]);
    expect(model.board.inProgress[0]?.attempt).toBe(2);
    expect(model.members[0]).toMatchObject({ memberName: "alice", state: "working" });
  });

  it("routes failed/cancelled to attention, never to completed (2026-10-18 审查修复)", () => {
    const model = mapTeamProjectionToViewModel(projection());
    expect(model.board.attention.map((t) => t.taskId)).toEqual(["task_4", "task_5"]);
    expect(model.board.attention.map((t) => t.status)).toEqual(["failed", "cancelled"]);
    expect(model.board.completed.map((t) => t.taskId)).toEqual(["task_3"]);
    expect(model.board.pending.map((t) => t.taskId)).not.toContain("task_4");
  });

  it("maps assignee avatar color, lead exception, depends depth and artifactRefs", () => {
    const model = mapTeamProjectionToViewModel(projection());
    // task_1 assignee=alice → alice 的 profileColor；task_6 assignee=lead → 不带色（lead 标签在视图层）。
    expect(model.board.inProgress[0]).toMatchObject({
      assignee: "alice",
      assigneeColor: "bg-red-500",
    });
    expect(model.board.pending.find((t) => t.taskId === "task_6")).toMatchObject({
      assignee: "lead",
    });
    expect(model.board.pending.find((t) => t.taskId === "task_6")?.assigneeColor).toBeUndefined();
    // 依赖深度：task_2 依赖 task_1（深度 1）；task_6 依赖 task_2（深度 2，跨列计数）。
    expect(model.board.pending.find((t) => t.taskId === "task_2")?.dependsDepth).toBe(1);
    expect(model.board.pending.find((t) => t.taskId === "task_6")?.dependsDepth).toBe(2);
    expect(model.board.completed[0]?.artifactRefs).toEqual(["a.txt"]);
  });

  it("caps depends depth at 3 and survives dependency cycles without throwing", () => {
    const cyclic = projection();
    const tasks = (cyclic.board as { tasks: Array<{ taskId: string; dependsOn: string[] }> }).tasks;
    const byId = new Map(tasks.map((t) => [t.taskId, t] as const));
    // 链 task_2 → task_6 → task_2（成环）+ task_1 接一条 4 层链的顶端。
    byId.get("task_2")!.dependsOn = ["task_6"];
    byId.get("task_6")!.dependsOn = ["task_2", "task_5"];
    byId.get("task_5")!.dependsOn = ["task_4"];
    byId.get("task_4")!.dependsOn = ["task_3"];
    byId.get("task_3")!.dependsOn = ["task_1"];
    const model = mapTeamProjectionToViewModel(cyclic);
    for (const column of [
      model.board.attention,
      model.board.pending,
      model.board.inProgress,
      model.board.completed,
    ]) {
      for (const task of column) expect(task.dependsDepth).toBeLessThanOrEqual(3);
    }
  });

  it("maps mailbox tail with sender color, to passthrough and lead fallback", () => {
    const model = mapTeamProjectionToViewModel(projection());
    expect(model.mailboxTail).toEqual([
      { messageId: "m1", from: "alice", to: "lead", summary: "done", fromColor: "bg-red-500" },
      { messageId: "m2", from: "lead", to: "alice" },
    ]);
    expect(model.mailboxTail[1]?.fromColor).toBeUndefined();
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
