import { describe, expect, it } from "vitest";
import type { TeamLeadPort } from "@drora/contracts";
import { TEAM_LIMITS } from "@drora/shared/drora-protocol-v4";
import { createTeamManagerToolEntries } from "../../src/team/team-tools.js";

// specs/agents-team.md §19 契约 4（2026-10-23）：TeamReassign lead 工具接线——
// 端口与内核全备（hub 三步交接/静默链/新者胜见 team-hub.test.ts）后的生产入口。
// 本文件锁工具边界四件事：
// ① lead 会话可调：入参映射 taskId/to/reason 到端口，ok 回显轮换后的任务卡；
// ② 成员会话 resolver undefined → 结构性拒（E10 lead 专属，成员零通路）；
// ③ rejected 的 error.code 随 CoreError.context 全数透传（to="lead" 二次接管的
//    team_lead_only 为代表样本，文案 + hint 原样出显）；
// ④ 限额同门（§17 契约 4）：超限 / 空串在工具入参边界拒，端口零调用。

interface ReassignCall {
  taskId: string;
  to: string;
  reason: string;
}

function harness(options: { reassignResult?: unknown } = {}) {
  const calls: ReassignCall[] = [];
  const port = {
    reassign: async (input: ReassignCall) => {
      calls.push(input);
      return options.reassignResult ?? { status: "ok" };
    },
    taskGet: (taskId: string) => ({
      taskId,
      title: "t1",
      status: "in_progress",
      assignee: "lead",
      attempt: 2,
      attemptId: "att_2",
    }),
  } as unknown as TeamLeadPort;
  const entries = createTeamManagerToolEntries((context) =>
    context.sessionId === "lead_s1" ? port : undefined,
  );
  const reassign = entries.find((entry) => entry.metadata.name === "TeamReassign");
  if (reassign === undefined) throw new Error("TeamReassign entry missing");
  return {
    reassign,
    reassignCalls: () => calls,
    leadContext: { sessionId: "lead_s1" } as never,
    memberContext: { sessionId: "child_s1" } as never,
  };
}

const VALID_INPUT = { task_id: "task_1", to: "bob", reason: "alice is halted" };

describe("TeamReassign lead tool boundary (§19 契约 4)", () => {
  it("lead 会话可调：入参映射 taskId/to/reason 到端口，ok 回显轮换后的任务卡", async () => {
    const { reassign, reassignCalls, leadContext } = harness();
    const result = (await reassign.handler(VALID_INPUT, leadContext)) as {
      task: { task_id?: string; assignee?: string; attempt_id?: string };
    };
    expect(reassignCalls()).toEqual([{ taskId: "task_1", to: "bob", reason: "alice is halted" }]);
    expect(result.task).toEqual({
      task_id: "task_1",
      title: "t1",
      status: "in_progress",
      assignee: "lead",
      attempt: 2,
      attempt_id: "att_2",
      depends_on: undefined,
      output: undefined,
    });
  });

  it("成员会话 resolver undefined → 结构性拒（E10 lead 专属），端口零调用", async () => {
    const { reassign, reassignCalls, memberContext } = harness();
    await expect(reassign.handler(VALID_INPUT, memberContext)).rejects.toThrow("team sessions only");
    expect(reassignCalls()).toEqual([]);
  });

  it('to="lead" 二次接管 team_lead_only 透传：error.code 挂 CoreError.context，文案 + hint 原样出显', async () => {
    const { reassign, leadContext } = harness({
      reassignResult: {
        status: "rejected",
        error: {
          code: "team_lead_only",
          message: "lead already holds an open task",
          hint: "Finish or reassign it first.",
        },
      },
    });
    const error: { message?: string; context?: { code?: string } } = await reassign
      .handler({ ...VALID_INPUT, to: "lead" }, leadContext)
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught as { message?: string; context?: { code?: string } },
      );
    expect(error.message).toBe("lead already holds an open task Finish or reassign it first.");
    expect(error.context).toEqual({ code: "team_lead_only" });
  });

  it("超限 task_id/to/reason 工具边界拒（TEAM_LIMITS 单一出处，§17 契约 4 同门），端口零调用", async () => {
    const { reassign, reassignCalls, leadContext } = harness();
    await expect(
      reassign.handler(
        { ...VALID_INPUT, task_id: "x".repeat(TEAM_LIMITS.maxIdChars + 1) },
        leadContext,
      ),
    ).rejects.toThrow();
    await expect(
      reassign.handler(
        { ...VALID_INPUT, to: "n".repeat(TEAM_LIMITS.maxNameChars + 1) },
        leadContext,
      ),
    ).rejects.toThrow();
    await expect(
      reassign.handler(
        { ...VALID_INPUT, reason: "r".repeat(TEAM_LIMITS.maxTextChars + 1) },
        leadContext,
      ),
    ).rejects.toThrow();
    expect(reassignCalls()).toEqual([]);
  });

  it("空串 min(1) 工具入参面拒（与 §19 契约 2 的 hub 落库空白归一是两门），端口零调用", async () => {
    const { reassign, reassignCalls, leadContext } = harness();
    for (const field of ["task_id", "to", "reason"] as const) {
      await expect(
        reassign.handler({ ...VALID_INPUT, [field]: "" }, leadContext),
      ).rejects.toThrow();
    }
    expect(reassignCalls()).toEqual([]);
  });
});

// ---------- 2026-10-27 M15（决策 D8）：TeamReopen manager 工具边界 ----------

describe("TeamReopen manager tool boundary (M15/决策 D8)", () => {
  interface ReopenCall {
    taskId: string;
  }

  function reopenHarness(options: { reopenResult?: unknown } = {}) {
    const calls: ReopenCall[] = [];
    const port = {
      reopen: (input: ReopenCall) => {
        calls.push(input);
        return (
          options.reopenResult ?? {
            status: "ok",
            task: {
              taskId: input.taskId,
              title: "doomed",
              status: "pending",
              attempt: 1,
            },
          }
        );
      },
    } as unknown as TeamLeadPort;
    const entries = createTeamManagerToolEntries((context) =>
      context.sessionId === "child_manager" ? port : undefined,
    );
    const reopen = entries.find((entry) => entry.metadata.name === "TeamReopen");
    if (reopen === undefined) throw new Error("TeamReopen entry missing");
    return {
      reopen,
      reopenCalls: () => calls,
      managerContext: { sessionId: "child_manager" } as never,
      outsiderContext: { sessionId: "child_alice" } as never,
    };
  }

  it("manager 工具族注册 TeamReopen：入参映射 task_id，ok 回显重开后的任务卡", async () => {
    const { reopen, reopenCalls, managerContext } = reopenHarness();
    const result = (await reopen.handler({ task_id: "task_1" }, managerContext)) as {
      task: { task_id?: string; status?: string };
    };
    expect(reopenCalls()).toEqual([{ taskId: "task_1" }]);
    expect(result.task).toMatchObject({ task_id: "task_1", status: "pending" });
  });

  it("非团队会话 resolver undefined → 结构性拒（port 未解析），端口零调用", async () => {
    const { reopen, reopenCalls, outsiderContext } = reopenHarness();
    await expect(reopen.handler({ task_id: "task_1" }, outsiderContext)).rejects.toThrow(
      "team sessions only",
    );
    expect(reopenCalls()).toEqual([]);
  });

  it("hub 拒绝（普通成员 team_lead_only）经 CoreError.context 全数透传", async () => {
    const { reopen, managerContext } = reopenHarness({
      reopenResult: {
        status: "rejected",
        error: {
          code: "team_lead_only",
          message: "This action is reserved for the team lead.",
        },
      },
    });
    const error: { message?: string; context?: { code?: string } } = await reopen
      .handler({ task_id: "task_1" }, managerContext)
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught as { message?: string; context?: { code?: string } },
      );
    expect(error.context).toEqual({ code: "team_lead_only" });
  });

  it("超限/空串 task_id 工具边界拒（§17 契约 4 同门），端口零调用", async () => {
    const { reopen, reopenCalls, managerContext } = reopenHarness();
    await expect(
      reopen.handler({ task_id: "x".repeat(TEAM_LIMITS.maxIdChars + 1) }, managerContext),
    ).rejects.toThrow();
    await expect(reopen.handler({ task_id: "" }, managerContext)).rejects.toThrow();
    expect(reopenCalls()).toEqual([]);
  });
});
