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
    // 2026-10-21 缺口6：spawn 失败用专用码——与邮箱持久化失败（E12）混用会误导
    // 调用方去「重发消息」而不是修订草案后重批。
    expect(result.error?.code).toBe("member_spawn_failed");
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

  it("halt interrupts in-flight members (spec §2.6) and freezes task updates too", async () => {
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
    lead.taskCreate({ title: "w", spec: { goal: "g", acceptance: [] }, dependsOn: [] });
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const taskId = hub.board()!.tasks[0]!.taskId;
    const claimed = alice.taskClaim(taskId);
    expect(claimed.status).toBe("claimed");
    hub.markMemberWorking("alice"); // 在飞成员（生产由 install 的运行态接线驱动）

    expect(hub.halt("lead_s1").status).toBe("ok");
    // 2026-10-21 缺口7：停队必须中断在飞成员——此前只翻状态，成员回合继续跑到自然终态。
    // spawning 成员同样在列（launch 在飞时即有 registry 任务；无任务时静默通道 no-op）。
    await vi.waitFor(() => expect(settleCalls).toContain("alice"));
    // 冻结面补漏：halted 后任务更新被拒（此前只有 create/claim 有 halted 门）
    const late = alice.taskUpdate({
      taskId,
      attemptId: claimed.status === "claimed" ? claimed.attemptId : "",
      patch: { status: "in_progress" },
    });
    expect(late.status).toBe("rejected");
    expect(late.error?.code).toBe("team_halted");
  });

  it("resume re-arms dispatch after halt consumed the terminal edges (缺口7 resume 半边)", async () => {
    const prompts: { memberName: string; mode: string }[] = [];
    const settleCalls: string[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async (request) => {
        prompts.push({ memberName: request.memberName, mode: request.mode });
        return true;
      },
      interruptAndSettle: async (memberName) => {
        settleCalls.push(memberName);
      },
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");

    // halt 前的板上事实：alice 在飞（指派并 kick 认领 → working），共享池留一个未指派任务。
    lead.taskCreate({
      title: "inflight",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const inFlight = hub.board()!.tasks.find((task) => task.title === "inflight")!;
    expect(inFlight.status).toBe("claimed");
    lead.taskCreate({ title: "pooled", spec: { goal: "g", acceptance: [] }, dependsOn: [] });
    hub.markMemberWorking("alice");

    expect(hub.halt("lead_s1").status).toBe("ok");
    // 中断全员（alice=working；bob=spawning 同样在列），成员终态边缘在冻结期内消费。
    await vi.waitFor(() => expect(settleCalls.length).toBe(2));
    prompts.length = 0; // 清掉 halt 前的认领派发，只观察 resume 后的派发
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");
    expect(hub.status).toBe("halted"); // 冻结不因终态边缘解除
    expect(prompts).toEqual([]); // 冻结期终态边缘不 kick（handleMemberTerminal 冻结跳过）

    // resume 前探针（评审实证的回归形态）：若 resume 只翻状态，pooled 将永远 pending。
    expect(hub.resume("lead_s1", "user asked to continue").status).toBe("ok");
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((task) => task.title === "pooled")?.status).toBe("claimed");
    });
    // 派发源是 resume 的 kickTeam：bob（终态成员）复活认领共享池任务。
    expect(prompts.some((row) => row.memberName === "bob" && row.mode === "queue")).toBe(true);
    expect(hub.board()?.tasks.find((task) => task.title === "pooled")?.assignee).toBe("bob");
    // 被中断成员的在飞任务保持 claimed+parked（sticky，只由 lead 转派轮换，spec §16.1）。
    const afterResume = hub.board()!.tasks.find((task) => task.title === "inflight")!;
    expect(afterResume.status).toBe("claimed");
    expect(afterResume.assignee).toBe("alice");
    expect(afterResume.attemptId).toBe(inFlight.attemptId);
  });

  it("removeMember interrupts the member and wakes teammates to reclaim recycled work (spec §16.2)", async () => {
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
    lead.taskCreate({
      title: "r",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((task) => task.title === "r")?.status).toBe("claimed");
    });

    expect(hub.removeMember("alice").status).toBe("ok");
    // 移除安全序：排空/中断被移除成员（裁决外静默，迟到写入已被 attempt 失效拒绝）
    await vi.waitFor(() => expect(settleCalls).toEqual(["alice"]));
    // 重新调度（缺口7）：回收任务回池后 kickTeam 唤醒其他成员认领——此前 kickTeam
    // 生产零调用，任务滞留 pending 无人接手。
    await vi.waitFor(() => {
      const recycled = hub.board()?.tasks.find((task) => task.title === "r");
      expect(recycled?.status).toBe("claimed");
      expect(recycled?.assignee).toBe("bob");
    });
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

// ---------- 2026-10-21 收口施工批次 2（spec §14）----------

describe("draft task identity + dependency validation (2026-10-21 缺口5, spec §14)", () => {
  it("preserves explicit taskIds on re-stage so dependsOn references survive revision", () => {
    const journal: { payload: { kind: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => journal.push(event as never),
    });
    const draft = {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [
        { taskId: "t_first", title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: ["t_second"] },
        { taskId: "t_second", title: "t2", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
      ],
    };
    expect(hub.stageTeam("lead_s1", draft).status).toBe("ok");
    // 修订前缺陷：materializeTask 一律换新 ID，第二次入库后 dependsOn 全部悬空。
    expect(hub.stageTeam("lead_s1", draft).status).toBe("ok");
    const taskIds = hub.board()?.tasks.map((task) => task.taskId);
    expect(taskIds).toEqual(["t_first", "t_second"]);
    // staged 事实（journal）同样携带保持后的 ID——恢复侧 DAG 不失真。
    const stagedFact = journal.filter((event) => event.payload.kind === "staged").at(-1) as {
      payload: { tasks: { taskId: string }[] };
    };
    expect(stagedFact.payload.tasks.map((task) => task.taskId)).toEqual(["t_first", "t_second"]);
  });

  it("rejects duplicate or empty explicit taskIds (draft_duplicate_task)", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const duplicate = hub.stageTeam("lead_s1", {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [
        { taskId: "t_x", title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
        { taskId: "t_x", title: "t2", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
      ],
    });
    expect(duplicate.status).toBe("rejected");
    expect(duplicate.error?.code).toBe("draft_duplicate_task");
    const empty = hub.stageTeam("lead_s1", {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [{ taskId: "", title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] }],
    });
    expect(empty.error?.code).toBe("draft_duplicate_task");
  });

  it("rejects dependsOn referencing tasks outside the draft (unknown_dependency)", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const result = hub.stageTeam("lead_s1", {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [
        { title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: ["task_missing"] },
      ],
    });
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("unknown_dependency");
    expect(result.error?.message).toContain("task_missing");
    // 被拒草案在全新 hub 上不得留下 team_created 事实（校验先于建队）。
    expect(hub.teamId).toBeUndefined();
  });

  it("rejects dependency cycles including self-dependency (dependency_cycle)", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const cycle = hub.stageTeam("lead_s1", {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [
        { taskId: "t_a", title: "a", spec: { goal: "g", acceptance: ["a"] }, dependsOn: ["t_b"] },
        { taskId: "t_b", title: "b", spec: { goal: "g", acceptance: ["a"] }, dependsOn: ["t_a"] },
      ],
    });
    expect(cycle.status).toBe("rejected");
    expect(cycle.error?.code).toBe("dependency_cycle");
    expect(cycle.error?.message).toContain("t_a -> t_b -> t_a");
    const selfDep = hub.stageTeam("lead_s1", {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [{ taskId: "t_solo", title: "s", spec: { goal: "g", acceptance: ["a"] }, dependsOn: ["t_solo"] }],
    });
    expect(selfDep.error?.code).toBe("dependency_cycle");
  });

  it("portTaskCreate rejects dangling dependsOn at runtime (permanent-pending prevention)", async () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const leadPort = hub.leadPort("lead_s1");
    const dangling = leadPort.taskCreate({
      title: "t2",
      spec: { goal: "g", acceptance: ["a"] },
      dependsOn: ["task_no_such"],
    });
    expect(dangling.status).toBe("rejected");
    expect(dangling.error?.code).toBe("unknown_dependency");
    const first = leadPort.taskCreate({ title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] });
    expect(first.status).toBe("ok");
    const chained = leadPort.taskCreate({
      title: "t2",
      spec: { goal: "g", acceptance: ["a"] },
      dependsOn: [first.status === "ok" && first.task ? first.task.taskId : ""],
    });
    expect(chained.status).toBe("ok");
  });
});

describe("lead mailbox delivery (2026-10-21 缺口12, spec §14)", () => {
  it("routes lead mail through deliverLeadMail and records lead_injected on acceptance", async () => {
    const deliver = vi.fn(async () => true);
    const journal: { payload: { kind: string; via?: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      deliverLeadMail: deliver,
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "lead", message: "report to lead" });
    // wire 返回值保持 queued（送达事实只认邮箱 deliveredAccepted，spec §14）。
    expect(sent.status).toBe("success");
    expect(sent.status === "success" && sent.delivery).toBe("queued");
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    const request = deliver.mock.calls[0]?.[0] as { entries: TeamMailboxEntry[] };
    expect(request.entries.map((entry) => entry.message)).toEqual(["report to lead"]);
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
      expect(entry.deliveredAccepted).toBe(true);
      expect(entry.deliveredVia).toBe("lead_injected");
    });
    // journal message_delivered(lead_injected) 在 markDelivered 之后同序贯写入，
    // 但仍以 waitFor 收口（mailbox 断言通过时 journal 可能尚未可见的竞态窗口）。
    await vi.waitFor(() => {
      const deliveredFact = journal.find(
        (event) => event.payload.kind === "message_delivered",
      ) as { payload: { via?: string } } | undefined;
      expect(deliveredFact?.payload.via).toBe("lead_injected");
    });
  });

  it("keeps failed lead mail queued and retries on kickTeam; halted freezes delivery until resume", async () => {
    const deliver = vi.fn(async () => false);
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), deliverLeadMail: deliver });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    alice.send({ to: "lead", message: "first report" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(false);

    // halted 冻结门：kickTeam 不投递。
    hub.halt("lead_s1");
    deliver.mockImplementation(async () => true);
    await hub.kickTeam();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(false);

    hub.resume("lead_s1", "continue");
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
      expect(entry.deliveredAccepted).toBe(true);
      expect(entry.deliveredVia).toBe("lead_injected");
    });
  });
});

describe("halt interrupts the lead's own turn (2026-10-21 边缘1, spec §14)", () => {
  it("halt calls interruptLead fire-and-forget; a failing interrupt does not roll back the freeze", async () => {
    const interruptLead = vi.fn(async () => {
      throw new Error("no active execution");
    });
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      interruptLead,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const result = hub.halt("lead_s1");
    expect(result.status).toBe("ok"); // 静默失败不回滚冻结
    expect(hub.status).toBe("halted");
    await vi.waitFor(() => expect(interruptLead).toHaveBeenCalledTimes(1));
  });
});
