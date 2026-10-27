import { describe, expect, it } from "vitest";
import {
  TEAM_LIMITS,
  teamProjectionStateSchema,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import {
  DEFAULT_TEAM_PROJECTION_LIMITS,
  mailboxTailWindowOf,
  projectTeam,
  trimBoardTasks,
  type TeamProjectionLimits,
  type TeamProjectionRecordInput,
  type TeamProjectionTaskInput,
} from "../../src/team/projection.js";
import type {
  TeamMailboxEntry,
  TeamMemberInternal,
  TeamRecord,
  TeamTaskInternal,
} from "../../src/team/types.js";

/**
 * PR-2.3a 投影单测（design §7 PR-2.3 验收：boardTasksMax 裁剪、mailboxTail 裁剪；
 * spec §6.3「尾窗/limit 裁剪有界」；design §3.3.2「wire 投影不携带
 * handoffId/reassigning/parked」）。投影对象一律过 shared teamProjectionStateSchema
 * 校验（符合 wire schema 是本卡的验收口径）。
 */

const LIMITS_5: TeamProjectionLimits = { boardTasksMax: 5, mailboxTailWindow: 10 };

function makeTask(overrides: Partial<TeamProjectionTaskInput> = {}): TeamProjectionTaskInput {
  return {
    taskId: "task_1",
    title: "demo task",
    spec: { goal: "do the thing", acceptance: ["it works"] },
    status: "pending",
    attempt: 0,
    dependsOn: [],
    artifactRefs: [],
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<TeamProjectionRecordInput> = {}): TeamProjectionRecordInput {
  return {
    teamId: "team_abc",
    status: "active",
    members: [],
    tasks: [],
    mailbox: [],
    ...overrides,
  };
}

function makeMail(index: number, overrides: Partial<TeamMailboxEntry> = {}): TeamMailboxEntry {
  return {
    messageId: `msg_${String(index).padStart(2, "0")}`,
    from: "lead",
    to: "explorer",
    message: `body ${index}`,
    at: `2026-10-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    deliveredAccepted: false,
    ...overrides,
  };
}

describe("projectTeam → shared teamProjectionStateSchema 一致性", () => {
  it("active 态全字段投影通过 wire schema 校验，且派生 currentTaskId / 花名册过滤正确", () => {
    const record = makeRecord({
      name: "重构小队",
      permissionMode: "build",
      members: [
        {
          agentId: "agent_1",
          memberName: "explorer",
          profile: "explore",
          profileColor: "#4f8ef7",
          state: "working",
          childSessionId: "child_session_1",
        },
        { agentId: "agent_2", memberName: "writer", state: "terminal" },
      ],
      tasks: [
        makeTask({
          taskId: "task_open",
          status: "in_progress",
          assignee: "explorer",
          attempt: 2,
          attemptId: "attempt_2",
        }),
        makeTask({ taskId: "task_done", status: "completed", assignee: "writer", attempt: 1 }),
      ],
      mailbox: [
        makeMail(1, {
          from: "explorer",
          to: "lead",
          summary: "done report",
          sourceTaskId: "task_done",
          sourceAttemptId: "attempt_1",
          deliveredAccepted: true,
        }),
        makeMail(2),
      ],
      artifacts: { dir: ".drora/team-artifacts/team_abc" },
    });

    const projection = projectTeam(record);

    const parsed = teamProjectionStateSchema.safeParse(projection);
    expect(parsed.success).toBe(true);

    expect(projection.name).toBe("重构小队");
    expect(projection.permissionMode).toBe("build");
    // currentTaskId 从板派生：working 成员持有 in_progress 任务；terminal 成员缺席。
    expect(projection.members[0]).toMatchObject({
      agentId: "agent_1",
      memberName: "explorer",
      state: "working",
      currentTaskId: "task_open",
      childSessionId: "child_session_1",
    });
    expect(projection.members[1]).not.toHaveProperty("currentTaskId");
    // ack 只认注入：delivered ← deliveredAccepted（queued 不算送达）。
    expect(projection.mailboxTail[0]).toMatchObject({ messageId: "msg_01", delivered: true });
    expect(projection.mailboxTail[1]).toMatchObject({ messageId: "msg_02", delivered: false });
    expect(projection.board.limit).toBe(DEFAULT_TEAM_PROJECTION_LIMITS.boardTasksMax);
    expect(projection.artifacts).toEqual({ dir: ".drora/team-artifacts/team_abc" });
    // 非 staged 态：键缺席而非 undefined（照 workflow-actor-permission 同规）。
    expect("stagedDraft" in projection).toBe(false);
  });

  it("TeamRecord 内部态可直接作为宽松入参（结构 duck 类型编译级兼容）", () => {
    const hubRecord: TeamRecord = {
      teamId: "team_hub",
      leadSessionId: "session_lead",
      permissionMode: "edit",
      status: "idle",
      members: [
        {
          agentId: "agent_1",
          memberName: "explorer",
          state: "terminal",
          modelSelection: { provider: "acme", model: "m1" },
          removed: false,
        },
      ],
      tasks: [
        {
          taskId: "task_1",
          title: "demo",
          spec: { goal: "g", acceptance: ["a"] },
          status: "pending",
          attempt: 0,
          reassigning: false,
          handoffId: "handoff_1",
          dependsOn: [],
          artifactRefs: [],
          output: "should not leak",
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
          acceptanceSupplement: { evidenceNote: "internal" },
        } satisfies TeamTaskInternal,
      ],
      mailbox: [
        {
          messageId: "msg_01",
          from: "lead",
          to: "explorer",
          message: "hello",
          at: "2026-10-17T00:00:00.000Z",
          targetTaskId: "task_1",
          targetAttemptId: "attempt_9",
          deliveredAt: "2026-10-17T00:01:00.000Z",
          deliveredVia: "steered",
          deliveredAccepted: false,
        } satisfies TeamMailboxEntry,
      ],
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    };

    const projection: TeamProjectionState = projectTeam(hubRecord);
    expect(teamProjectionStateSchema.safeParse(projection).success).toBe(true);
    expect(projection.status).toBe("idle");
  });

  it("容缺：members/tasks/mailbox 缺席视为空集，投影仍是合法 wire 帧", () => {
    const projection = projectTeam({ teamId: "team_min", status: "active" });
    expect(projection.members).toEqual([]);
    expect(projection.board).toEqual({ tasks: [], limit: TEAM_LIMITS.boardTasksMax });
    expect(projection.mailboxTail).toEqual([]);
    expect(teamProjectionStateSchema.safeParse(projection).success).toBe(true);
  });

  // §22 契约 7（2026-10-27 审查 H2 修复）：managerName 此前在桥塞进 record 后于
  // projectTeam 一跳被静默丢弃（TeamProjectionRecordInput 无该字段、输出键清单不含它）
  // ——wire 帧恒缺该键，UI 管理者徽标永不渲染。锁三件事：在场透传、键缺席语义、wire 可解析。
  it("managerName 在场透传到 wire 投影；缺席时键缺席而非 undefined（§22 契约 7）", () => {
    const withManager = projectTeam(
      makeRecord({
        managerName: "explorer",
        members: [{ agentId: "agent_1", memberName: "explorer", state: "working" }],
      }),
    );
    expect(withManager.managerName).toBe("explorer");
    expect(teamProjectionStateSchema.safeParse(withManager).success).toBe(true);

    const withoutManager = projectTeam(makeRecord());
    expect("managerName" in withoutManager).toBe(false);
    expect(teamProjectionStateSchema.safeParse(withoutManager).success).toBe(true);
  });
});

describe("board.tasks limit 裁剪（保序截尾窗；pending 优先保留、terminal 从最旧丢弃）", () => {
  it("=limit：全保留、保序，limit 原样回显", () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => makeTask({ taskId: `task_${n}` }));
    const projection = projectTeam(makeRecord({ tasks }), LIMITS_5);
    expect(projection.board.tasks.map((task) => task.taskId)).toEqual([
      "task_1",
      "task_2",
      "task_3",
      "task_4",
      "task_5",
    ]);
    expect(projection.board.limit).toBe(5);
  });

  it("limit+1 且最旧为终态：恰丢弃最旧的终态任务，其余全保留", () => {
    const tasks = [
      makeTask({ taskId: "task_oldest_done", status: "completed", attempt: 1 }),
      ...[2, 3, 4, 5, 6].map((n) => makeTask({ taskId: `task_${n}` })),
    ];
    const projection = projectTeam(makeRecord({ tasks }), LIMITS_5);
    expect(projection.board.tasks.map((task) => task.taskId)).toEqual([
      "task_2",
      "task_3",
      "task_4",
      "task_5",
      "task_6",
    ]);
  });

  it("limit+1 且全为 pending：保序尾窗，丢弃最旧的 pending", () => {
    const tasks = [1, 2, 3, 4, 5, 6].map((n) => makeTask({ taskId: `task_${n}` }));
    const projection = projectTeam(makeRecord({ tasks }), LIMITS_5);
    expect(projection.board.tasks.map((task) => task.taskId)).toEqual([
      "task_2",
      "task_3",
      "task_4",
      "task_5",
      "task_6",
    ]);
  });

  it("terminal 不入 pending 窗：超限时终态从最旧丢弃，开放任务绝不被终态挤掉", () => {
    const tasks = [
      makeTask({ taskId: "task_p1", status: "pending" }),
      makeTask({ taskId: "task_c1", status: "completed", attempt: 1 }),
      makeTask({ taskId: "task_c2", status: "failed", attempt: 1 }),
      makeTask({ taskId: "task_p2", status: "claimed", assignee: "explorer", attempt: 1 }),
    ];
    const limits: TeamProjectionLimits = { boardTasksMax: 3, mailboxTailWindow: 10 };
    const projection = projectTeam(makeRecord({ tasks }), limits);
    // 开放（p1/p2）全保留；两条终态保最新一条（c1 从最旧丢弃），保序归并。
    expect(projection.board.tasks.map((task) => task.taskId)).toEqual([
      "task_p1",
      "task_c2",
      "task_p2",
    ]);
    // 开放数已达 limit：终态全部让位（c1/c2 都不入窗）。
    expect(
      projectTeam(makeRecord({ tasks }), { ...limits, boardTasksMax: 2 }).board.tasks.map(
        (task) => task.taskId,
      ),
    ).toEqual(["task_p1", "task_p2"]);
  });

  it("cancelled 也算终态；claimed/in_progress 与 pending 同属受保护的开集合", () => {
    const kept = trimBoardTasks(
      [
        makeTask({ taskId: "a", status: "in_progress" }),
        makeTask({ taskId: "b", status: "cancelled" }),
        makeTask({ taskId: "c", status: "cancelled" }),
        makeTask({ taskId: "d", status: "pending" }),
      ],
      2,
      (task) =>
        task.status === "completed" || task.status === "failed" || task.status === "cancelled",
    );
    expect(kept.map((task) => task.taskId)).toEqual(["a", "d"]);
  });

  it("trimBoardTasks：limit 非正整数按 1 处理，投影保持有界", () => {
    const tasks = [1, 2, 3].map((n) => makeTask({ taskId: `task_${n}` }));
    expect(trimBoardTasks(tasks, 0, () => true).map((task) => task.taskId)).toEqual(["task_3"]);
    expect(mailboxTailWindowOf([1, 2, 3], -1)).toEqual([]);
  });
});

describe("mailboxTail 窗口", () => {
  it("超出窗口：只保留最近 window 条，保序", () => {
    const mailbox = Array.from({ length: 12 }, (_, i) => makeMail(i + 1));
    const projection = projectTeam(makeRecord({ mailbox }), LIMITS_5);
    expect(projection.mailboxTail.map((entry) => entry.messageId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `msg_${String(i + 3).padStart(2, "0")}`),
    );
  });

  it("恰等于窗口与不足窗口：全保留", () => {
    const ten = Array.from({ length: DEFAULT_TEAM_PROJECTION_LIMITS.mailboxTailWindow }, (_, i) =>
      makeMail(i + 1),
    );
    expect(
      projectTeam(makeRecord({ mailbox: ten }), LIMITS_5).mailboxTail.map((e) => e.messageId),
    ).toEqual(ten.map((e) => e.messageId));
    const two = [makeMail(1), makeMail(2)];
    expect(projectTeam(makeRecord({ mailbox: two }), LIMITS_5).mailboxTail).toHaveLength(2);
  });

  it("自定义窗口生效；尾窗条目只带摘要与投递事实，正文不上 wire", () => {
    const mailbox = [
      makeMail(1, { summary: "first", deliveredAccepted: true }),
      makeMail(2, { from: "explorer", to: "writer" }),
      makeMail(3),
    ];
    const projection = projectTeam(makeRecord({ mailbox }), {
      boardTasksMax: 100,
      mailboxTailWindow: 2,
    });
    expect(projection.mailboxTail.map((entry) => entry.messageId)).toEqual(["msg_02", "msg_03"]);
    const first = projection.mailboxTail[0];
    expect(first).toMatchObject({ from: "explorer", to: "writer" });
    expect("message" in first).toBe(false);
    expect(teamProjectionStateSchema.safeParse(projection).success).toBe(true);
  });
});

describe("stagedDraft 草案字段（仅 staged 态携带）", () => {
  it("staged 态：草案取自花名册占位与板，awaitingFeedback 缺席按 false", () => {
    const projection = projectTeam(
      makeRecord({
        status: "staged",
        members: [
          {
            agentId: "pending_explorer",
            memberName: "explorer",
            profile: "explore",
            state: "spawning",
            modelSelection: { provider: "acme", model: "m1", thought: "high" },
          },
          {
            agentId: "pending_writer",
            memberName: "writer",
            state: "spawning",
            removed: true,
          },
        ],
        tasks: [
          makeTask({
            taskId: "task_draft1",
            title: "draft task",
            assignee: "explorer",
            dependsOn: ["task_draft2"],
          }),
        ],
      }),
    );

    expect(projection.stagedDraft).toBeDefined();
    expect(projection.stagedDraft?.draftMembers).toEqual([
      {
        memberName: "explorer",
        profile: "explore",
        modelSelection: { provider: "acme", model: "m1", thought: "high" },
      },
    ]);
    expect(projection.stagedDraft?.draftTasks).toEqual([
      {
        taskId: "task_draft1",
        title: "draft task",
        assignee: "explorer",
        dependsOn: ["task_draft2"],
      },
    ]);
    expect(projection.stagedDraft?.awaitingFeedback).toBe(false);
    // removed 占位不进花名册也不进草案行；未移除的占位仍按花名册投影。
    expect(projection.members.map((member) => member.memberName)).toEqual(["explorer"]);
    expect(teamProjectionStateSchema.safeParse(projection).success).toBe(true);
  });

  it("awaitingFeedback=true 透传；非 staged 态即使有标记也不携带草案", () => {
    const staged = projectTeam(makeRecord({ status: "staged", awaitingFeedback: true }));
    expect(staged.stagedDraft?.awaitingFeedback).toBe(true);

    const active = projectTeam(makeRecord({ status: "active", awaitingFeedback: true }));
    expect("stagedDraft" in active).toBe(false);
  });
});

describe("投影不携带内部交接态（design §3.3.2）", () => {
  it("handoffId/reassigning/output/acceptanceSupplement 不入 wire 任务卡", () => {
    const record: TeamRecord = {
      teamId: "team_x",
      leadSessionId: "session_lead",
      status: "active",
      members: [],
      tasks: [
        {
          taskId: "task_1",
          title: "demo",
          spec: { goal: "g", acceptance: ["a"] },
          status: "in_progress",
          assignee: "explorer",
          attempt: 3,
          attemptId: "attempt_3",
          handoffId: "handoff_secret",
          reassigning: true,
          dependsOn: [],
          artifactRefs: [],
          output: "internal output",
          createdAt: "2026-10-17T00:00:00.000Z",
          updatedAt: "2026-10-17T00:00:00.000Z",
          acceptanceSupplement: { evidenceNote: "internal evidence" },
        },
      ],
      mailbox: [],
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    };

    const projection = projectTeam(record);
    const card = projection.board.tasks[0];
    expect("handoffId" in card).toBe(false);
    expect("reassigning" in card).toBe(false);
    expect("output" in card).toBe(false);
    expect("acceptanceSupplement" in card).toBe(false);
    expect(card).toMatchObject({ taskId: "task_1", attempt: 3, attemptId: "attempt_3" });
    expect(teamProjectionStateSchema.safeParse(projection).success).toBe(true);
  });

  it("邮箱投递世代与送达元数据不入尾窗条目", () => {
    const entry: TeamMailboxEntry = {
      messageId: "msg_01",
      from: "lead",
      to: "explorer",
      message: "hello",
      at: "2026-10-17T00:00:00.000Z",
      targetTaskId: "task_1",
      targetAttemptId: "attempt_9",
      deliveredAt: "2026-10-17T00:01:00.000Z",
      deliveredVia: "steered",
      deliveredAccepted: true,
    };
    const tail = projectTeam(makeRecord({ mailbox: [entry] })).mailboxTail[0];
    expect(tail.delivered).toBe(true);
    for (const key of ["message", "deliveredAt", "deliveredVia", "targetTaskId", "targetAttemptId"]) {
      expect(key in tail).toBe(false);
    }
  });

  it("成员内部路由快照与 removed 标记不入成员卡", () => {
    const member: TeamMemberInternal = {
      agentId: "agent_1",
      memberName: "explorer",
      profile: "explore",
      state: "working",
      modelSelection: { provider: "acme", model: "m1" },
      removed: false,
    };
    const projection = projectTeam(
      makeRecord({
        status: "active",
        members: [member, { ...member, memberName: "ghost", removed: true }],
        tasks: [makeTask({ status: "in_progress", assignee: "explorer", attempt: 1 })],
      }),
    );
    expect(projection.members.map((m) => m.memberName)).toEqual(["explorer"]);
    const card = projection.members[0];
    expect("modelSelection" in card).toBe(false);
    expect("removed" in card).toBe(false);
  });
});
