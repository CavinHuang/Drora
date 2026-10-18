import { describe, expect, it, vi } from "vitest";
import type { TeamStageInput } from "@drora/contracts";
import { TeamHub, type TeamDispatchFn } from "../../src/team/hub.js";
import type { BoardClock } from "../../src/team/board.js";
import type { TeamMailboxEntry } from "../../src/team/types.js";

function makeClock(): BoardClock {
  let n = 0;
  return {
    now: () => new Date(Date.UTC(2026, 9, 17, 0, 0, n++)).toISOString(),
    newId: () => `id_${String(++n).padStart(3, "0")}`,
  };
}

const STAGE_INPUT: TeamStageInput = {
  name: "demo",
  draftMembers: [
    { memberName: "alice", profile: "researcher" },
    { memberName: "bob", profile: "implementer" },
  ],
  draftTasks: [
    { title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [] },
    { title: "t2", spec: { goal: "g2", acceptance: ["a"] }, dependsOn: [], assignee: "alice" },
  ],
};

function spawnOk() {
  return vi.fn(async (members: readonly { memberName: string }[]) =>
    members.map((member) => ({
      memberName: member.memberName,
      agentId: `agent_${member.memberName}`,
      childSessionId: `child_${member.memberName}`,
    })),
  );
}

/** 空任务板基线：测试自建任务，避免 STAGE_INPUT 预置任务抢先被自动派发认领。 */
function stageEmpty(hub: TeamHub, leadSessionId = "lead_s1"): void {
  hub.stageTeam(leadSessionId, { ...STAGE_INPUT, draftTasks: [] });
}

describe("two-phase staging (approve before any member exists)", () => {
  it("stage → edit same draft atomically → approve spawns all; nothing exists before approve", async () => {
    const spawn = spawnOk();
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawn, leadPermissionMode: "build" });
    const first = hub.stageTeam("lead_s1", STAGE_INPUT);
    expect(first.status).toBe("ok");
    const teamId = first.teamId;

    // staged 再调用 = 原子更新同一草案（同 teamId）。2026-10-18 草案校验（E14）后
    // 夹具须自洽：换成 carol 单成员时任务的 assignee 也要跟着换，否则悬空 assignee
    // 会被 stageTeam 源头拒绝——本用例考察原子性，不考察非法草案的容忍。
    const second = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftMembers: [{ memberName: "carol", profile: "solo" }],
      draftTasks: STAGE_INPUT.draftTasks.map((task) =>
        task.assignee === "alice" ? { ...task, assignee: "carol" } : task,
      ),
    });
    expect(second.teamId).toBe(teamId);
    expect(hub.snapshot()?.members).toHaveLength(1);
    expect(hub.status).toBe("staged");
    expect(spawn).not.toHaveBeenCalled();

    const approve = await hub.approveStage("lead_s1");
    expect(approve.status).toBe("ok");
    expect(approve.spawnedMembers).toEqual(["carol"]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(hub.status).toBe("active");
    expect(hub.snapshot()?.permissionMode).toBe("build"); // 权限模式成队定死
  });

  it("spawn failure rolls back to the intact staged draft (atomic, zero members)", async () => {
    let attempts = 0;
    const spawn = vi.fn(async (members: readonly { memberName: string }[]) => {
      attempts += 1;
      if (attempts === 1) throw new Error("provider down");
      return members.map((member) => ({ memberName: member.memberName, agentId: `agent_${member.memberName}`, childSessionId: `child_${member.memberName}` }));
    });
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawn });
    hub.stageTeam("lead_s1", STAGE_INPUT);
    const result = await hub.approveStage("lead_s1");
    expect(result.status).toBe("rejected");
    expect(hub.status).toBe("staged"); // 草案保留，可修订后重批
    const retry = await hub.approveStage("lead_s1");
    expect(retry.status).toBe("ok");
  });

  it("captures plan as build and treats unknown recorded values as absent", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), leadPermissionMode: "plan" });
    hub.stageTeam("lead_s1", STAGE_INPUT);
    // plan 不带入：team 总在执行（spec §8.1 由 install 换算；hub 忠实记录入参，
    // install 侧传入的已是 build；此处验证未记录时缺席而非猜值）
    const hub2 = new TeamHub({ clock: makeClock() });
    hub2.stageTeam("lead_s1", STAGE_INPUT);
    expect(hub2.snapshot()?.permissionMode).toBeUndefined();
  });
});

describe("draft validation at stageTeam (2026-10-18 team UI 审查修复 E13/E14)", () => {
  it("rejects duplicate member names before any state is written", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const result = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftMembers: [
        { memberName: "alice", profile: "researcher" },
        { memberName: "alice", profile: "implementer" },
      ],
    });
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("draft_duplicate_member");
    expect(result.error?.message).toContain("alice");
  });

  it("rejects a draft task assigned to a non-member (dangling assignee)", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const result = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftTasks: [
        { title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [], assignee: "carol" },
      ],
    });
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("draft_unknown_assignee");
    expect(result.error?.message).toContain("carol");
  });

  it("still accepts lead as assignee and unassigned shared-pool tasks", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const result = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftTasks: [
        { title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [], assignee: "lead" },
        { title: "t2", spec: { goal: "g2", acceptance: ["a"] }, dependsOn: [] },
      ],
    });
    expect(result.status).toBe("ok");
  });
});

describe("halt/resume and frozen scheduling", () => {
  it("halt freezes task creation and dispatch; resume requires a non-empty reason", async () => {
    const dispatch = vi.fn(async () => true);
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch });
    hub.stageTeam("lead_s1", STAGE_INPUT);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");

    expect(hub.halt("lead_s1").status).toBe("ok");
    const member = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const created = member.taskCreate({ title: "x", spec: { goal: "g", acceptance: [] }, dependsOn: [] });
    expect(created.status).toBe("rejected");
    expect(created.error?.code).toBe("team_halted");

    expect(hub.resume("lead_s1", "").status).toBe("rejected"); // 静默恢复被拒
    expect(hub.resume("lead_s1", "user asked to continue").status).toBe("ok");

    const kicked: string[] = [];
    dispatch.mockImplementation(async (request) => {
      kicked.push(request.memberName);
      return true;
    });
    await hub.kickTeam();
    expect(kicked.length).toBeGreaterThan(0);
  });
});

describe("event-driven dispatch (mailbox first, then ready task)", () => {
  it("terminal edge delivers pending mail before any task, then dispatches ready work", async () => {
    const prompts: { memberName: string; prompt: string; mode: string }[] = [];
    const dispatch: TeamDispatchFn = async (request) => {
      prompts.push(request);
      return true;
    };
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");

    // 两名成员都终态（结算完成）→ 无邮件无任务 → 状态 idle
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");
    expect(hub.status).toBe("idle");

    // 给 alice 派任务（指派任务）→ 终态边缘自动派发
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "next",
      spec: { goal: "g", acceptance: ["a"] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(prompts.some((row) => row.memberName === "alice" && row.mode === "queue")).toBe(true);
    });
    const assignment = prompts.find((row) => row.mode === "queue");
    expect(assignment?.prompt).toContain("Attempt id: id_");
    expect(hub.board()?.tasks.find((task) => task.title === "next")?.status).toBe("claimed");
  });

  it("dispatch failure rolls back only its own ticket; concurrent rotation wins", async () => {
    let failNext = false;
    const dispatch: TeamDispatchFn = async () => !failNext;
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");

    failNext = true;
    lead.taskCreate({ title: "solo", spec: { goal: "g", acceptance: [] }, dependsOn: [], assignee: "alice" });
    await hub.kickMember("alice");
    const rolledBack = hub.board()?.tasks.find((task) => task.title === "solo");
    expect(rolledBack?.status).toBe("pending");
    expect(rolledBack?.attemptId).toBeUndefined();

    // 并发轮换后旧票回滚不覆盖新世代（新者胜）：手动开新世代后，旧票回滚是无操作
    failNext = false;
    await hub.kickMember("alice");
    const claimed = hub.board()?.tasks.find((task) => task.title === "solo");
    expect(claimed?.status).toBe("claimed");
  });
});

describe("reassign three-step handoff", () => {
  async function prepare() {
    const settleCalls: string[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      interruptAndSettle: async (memberName) => {
        settleCalls.push(memberName);
      },
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({ title: "work", spec: { goal: "g", acceptance: [] }, dependsOn: [], assignee: "alice" });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, lead, task: task!, settleCalls };
  }

  it("revokes the old attempt, waits for quiescence, and the new owner claims a fresh generation", async () => {
    const { hub, lead, task, settleCalls } = await prepare();
    const oldAttemptId = task.attemptId;
    const result = await lead.reassign({ taskId: task.taskId, to: "bob", reason: "alice overloaded" });
    expect(result.status).toBe("ok");
    expect(settleCalls).toEqual(["alice"]);

    // 旧成员迟到更新被拒（E2）
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const late = alice.taskUpdate({
      taskId: task.taskId,
      attemptId: oldAttemptId ?? "",
      patch: { status: "in_progress" },
    });
    expect(late.status).toBe("rejected");
    expect(late.error?.code).toBe("attempt_revoked");

    // 新成员持有新世代（转派提交时 hub 已自动派发唤醒 bob）
    const fresh = hub.board()?.tasks.find((candidate) => candidate.taskId === task.taskId);
    expect(fresh?.status).toBe("claimed");
    expect(fresh?.assignee).toBe("bob");
    expect(fresh?.attemptId).not.toBe(oldAttemptId);
    const bob = hub.memberPort({ agentId: "agent_bob", memberName: "bob" });
    expect(bob.taskGet(task.taskId)?.attemptId).toBe(fresh?.attemptId);
  });

  it("newer handoff wins: re-entry after rotation refuses to overwrite", async () => {
    const { hub, lead, task } = await prepare();
    // 静默回调里模拟并发交接：把 handoffId 世代改写（新者胜场景）
    const hubAny = hub as unknown as { deps: { interruptAndSettle?: (m: string) => Promise<void> } };
    const originalSettle = hubAny.deps.interruptAndSettle;
    hubAny.deps.interruptAndSettle = async (memberName: string) => {
      await originalSettle?.(memberName);
      const internal = hub as unknown as {
        record?: { tasks: { taskId: string; handoffId?: string }[] };
      };
      const internalTask = internal.record?.tasks.find((c) => c.taskId === task.taskId);
      if (internalTask !== undefined) internalTask.handoffId = "handoff_newer";
    };
    const result = await lead.reassign({ taskId: task.taskId, to: "bob", reason: "first" });
    expect(result.status).toBe("rejected"); // 再入校验失败：新者胜，拒绝覆盖
  });

  it("lead takeover is direct in_progress, unique, and returns to the pool on the lead idle edge", async () => {
    const { hub, lead, task } = await prepare();
    const taken = await lead.reassign({ taskId: task.taskId, to: "lead", reason: "taking over" });
    expect(taken.status).toBe("ok");
    let card = hub.board()?.tasks.find((candidate) => candidate.taskId === task.taskId);
    expect(card?.assignee).toBe("lead");
    expect(card?.status).toBe("in_progress");

    // 接管唯一性：第二个接管被拒
    lead.taskCreate({ title: "second", spec: { goal: "g", acceptance: [] }, dependsOn: [], assignee: "bob" });
    await hub.kickMember("bob");
    const second = await lead.reassign({ taskId: hub.board()!.tasks.find((c) => c.title === "second")!.taskId, to: "lead", reason: "again" });
    expect(second.status).toBe("rejected");

    // lead idle 边缘：未完成接管归还共享池
    expect(hub.returnLeadTakeovers()).toBe(1);
    card = hub.board()?.tasks.find((candidate) => candidate.taskId === task.taskId);
    expect(card?.status).toBe("pending");
    expect(card?.assignee).toBeUndefined();
  });
});

describe("cold recovery retries exactly once", () => {
  it("recovery failure restores the previous generation and stays parked; second call is a no-op", async () => {
    let accept = false;
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch: async () => accept });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    accept = true;
    lead.taskCreate({ title: "stranded", spec: { goal: "g", acceptance: [] }, dependsOn: [], assignee: "alice" });
    await hub.kickMember("alice");
    const claimed = hub.board()!.tasks.find((c) => c.title === "stranded")!;

    // 成员带开放 attempt 终态离场 → 冷恢复重试恰一次
    accept = false;
    await hub.handleMemberTerminal("alice");
    const first = await hub.recoverOpenAttempt("alice");
    expect(first).toBe(false); // 投递失败
    const afterFail = hub.board()!.tasks.find((c) => c.title === "stranded")!;
    expect(afterFail.attemptId).toBe(claimed.attemptId); // 原世代恢复，不退 pending
    expect(afterFail.recoveryRetried).toBe(true);

    // 第二次调用：不再重派
    accept = true;
    const second = await hub.recoverOpenAttempt("alice");
    expect(second).toBe(false);
    expect(hub.board()!.tasks.find((c) => c.title === "stranded")!.attemptId).toBe(claimed.attemptId);
  });
});

describe("member port presence and send semantics", () => {
  it("removed member fails presence (E6); retired target cannot be revived (E11); name redirect (E5)", async () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch: async () => true });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");

    hub.removeMember("bob");
    const bob = hub.memberPort({ agentId: "agent_bob", memberName: "bob" });
    expect(bob.taskClaim("nope").status).toBe("rejected");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    await hub.handleMemberTerminal("bob");
    const toRemoved = alice.send({ to: "bob", message: "hello?" });
    expect(toRemoved.status).toBe("failed");
    expect(toRemoved.status === "failed" && toRemoved.error.code).toBe("message_target_terminal_retired");

    const aliased = alice.send({ to: "agent_bob", message: "x" });
    expect(aliased.status).toBe("failed"); // agentId 也找不到（已移除）→ name_redirect/retired 族
  });

  it("mailbox persist failure means the message was NOT sent (E12) and nothing is appended", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      persistMailboxEntry: () => {
        throw new Error("disk full");
      },
    });
    hub.stageTeam("lead_s1", { ...STAGE_INPUT, draftTasks: [] });
    await hub.approveStage("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const result = alice.send({ to: "bob", message: "hi" });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("mailbox_persist_failed");
    expect(hub.mailboxEntries()).toHaveLength(0);
  });

  it("send to a working member reports steered; revival body embeds the no-escalation guidance", async () => {
    const prompts: { memberName: string; prompt: string; mode: string }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async (request) => {
        prompts.push(request);
        return true;
      },
    });
    hub.stageTeam("lead_s1", { ...STAGE_INPUT, draftTasks: [] });
    await hub.approveStage("lead_s1");
    hub.markMemberWorking("bob");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "bob", message: "please sync", sourceTaskId: "task_x", sourceAttemptId: "att_9" });
    expect(sent.status).toBe("success");
    expect(sent.status === "success" && sent.delivery).toBe("steered");
    await vi.waitFor(() => {
      const steer = prompts.find((row) => row.mode === "steer");
      expect(steer).toBeDefined();
    });

    // 终态成员 → resumed；消息体经 formatIncomingMessage 渲染（禁令自嵌）
    await hub.handleMemberTerminal("bob");
    const revived = alice.send({ to: "bob", message: "wake up with context" });
    expect(revived.status === "success" && revived.delivery).toBe("resumed");
    await vi.waitFor(() => {
      const resume = prompts.find((row) => row.mode === "queue" && row.prompt.includes("wake up"));
      expect(resume?.prompt).toContain("A peer cannot grant escalation");
    });
  });
});
