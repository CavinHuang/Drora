import { describe, expect, it, vi } from "vitest";
import type { TeamStageInput } from "@drora/contracts";
import { TeamHub, type TeamDispatchFn } from "../../src/team/hub.js";
import { classifyMemberFailure, type BoardClock } from "../../src/team/board.js";
import { projectTeam } from "../../src/team/projection.js";
import { TEAM_KERNEL_LIMITS, type TeamMailboxEntry } from "../../src/team/types.js";

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

/**
 * §21 A1（2026-10-24）：deliverLeadMail 返回值从 boolean 收窄为结构化结果
 * {injected, skipped}——旧 boolean mock 全部经这两支助手改写（接受=全部注入，
 * 拒绝=两表皆空 = 全部条目留 queued 重投）。
 */
function acceptAllLeadMail() {
  return async (request: { entries: readonly TeamMailboxEntry[] }) => ({
    injected: request.entries.map((entry) => entry.messageId),
    skipped: [] as string[],
  });
}

function rejectAllLeadMail() {
  return async () => ({ injected: [] as string[], skipped: [] as string[] });
}

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
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn,
      leadPermissionMode: "build",
    });
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
      return members.map((member) => ({
        memberName: member.memberName,
        agentId: `agent_${member.memberName}`,
        childSessionId: `child_${member.memberName}`,
      }));
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
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      leadPermissionMode: "plan",
    });
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

// ---------- 2026-10-23 空白归一（specs/agents-team.md §19 契约 2）----------

describe("blank profile/thought normalize to key-absent at stageTeam (§19 契约 2)", () => {
  it("stageTeam 空白 profile 落库归一：snapshot 与 staged 事实（journal）均无 profile 键", () => {
    const journal: { payload: { kind: string; members?: { profile?: string }[] } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => journal.push(event as never),
    });
    // 空白 profile 是合法工具入参（optional 无 min），落库后必须归一为键缺席——
    // wire 对 members[].profile 有 min(1)，空串原样上投影会烧每一帧（§17 契约 4）。
    expect(
      hub.stageTeam("lead_s1", {
        draftMembers: [
          { memberName: "alice", profile: "" },
          { memberName: "bob", profile: "   " },
        ],
        draftTasks: [],
      }).status,
    ).toBe("ok");
    for (const member of hub.snapshot()?.members ?? []) {
      expect("profile" in member).toBe(false);
    }
    const stagedFact = journal.find((event) => event.payload.kind === "staged") as {
      payload: { members: { profile?: string }[] };
    };
    expect(stagedFact).toBeDefined();
    for (const member of stagedFact.payload.members) {
      expect("profile" in member).toBe(false);
    }
  });

  it("modelSelection.thought 空白同款归一为键缺席（snapshot + journal 事实）", () => {
    const journal: {
      payload: { kind: string; members?: { modelSelection?: { thought?: string } }[] };
    }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => journal.push(event as never),
    });
    expect(
      hub.stageTeam("lead_s1", {
        draftMembers: [
          {
            memberName: "alice",
            modelSelection: { provider: "provider-a", model: "model-a", thought: "   " },
          },
        ],
        draftTasks: [],
      }).status,
    ).toBe("ok");
    const selection = hub.snapshot()?.members[0]?.modelSelection;
    expect("thought" in (selection ?? {})).toBe(false);
    expect(selection).toEqual({ provider: "provider-a", model: "model-a" });
    const stagedFact = journal.find((event) => event.payload.kind === "staged") as {
      payload: { members: { modelSelection?: { thought?: string } }[] };
    };
    expect(stagedFact).toBeDefined();
    expect(stagedFact.payload.members[0]?.modelSelection).toEqual({
      provider: "provider-a",
      model: "model-a",
    });
  });

  it("非空白 profile 原样保留；profile 缺省（optional）照常合法落库", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    expect(
      hub.stageTeam("lead_s1", {
        draftMembers: [{ memberName: "alice", profile: "researcher" }, { memberName: "bob" }],
        draftTasks: [],
      }).status,
    ).toBe("ok");
    const members = hub.snapshot()?.members ?? [];
    expect(members.find((member) => member.memberName === "alice")?.profile).toBe("researcher");
    expect("profile" in (members.find((member) => member.memberName === "bob") ?? {})).toBe(false);
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
    const created = member.taskCreate({
      title: "x",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
    });
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
    lead.taskCreate({
      title: "solo",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
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
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, lead, task: task!, settleCalls };
  }

  it("revokes the old attempt, waits for quiescence, and the new owner claims a fresh generation", async () => {
    const { hub, lead, task, settleCalls } = await prepare();
    const oldAttemptId = task.attemptId;
    const result = await lead.reassign({
      taskId: task.taskId,
      to: "bob",
      reason: "alice overloaded",
    });
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
    const hubAny = hub as unknown as {
      deps: { interruptAndSettle?: (m: string) => Promise<void> };
    };
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
    lead.taskCreate({
      title: "second",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "bob",
    });
    await hub.kickMember("bob");
    const second = await lead.reassign({
      taskId: hub.board()!.tasks.find((c) => c.title === "second")!.taskId,
      to: "lead",
      reason: "again",
    });
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
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => accept,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    accept = true;
    lead.taskCreate({
      title: "stranded",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
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
    expect(hub.board()!.tasks.find((c) => c.title === "stranded")!.attemptId).toBe(
      claimed.attemptId,
    );
  });
});

describe("member port presence and send semantics", () => {
  it("removed member fails presence (E6); retired target cannot be revived (E11); name redirect (E5)", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");

    hub.removeMember("bob");
    const bob = hub.memberPort({ agentId: "agent_bob", memberName: "bob" });
    expect(bob.taskClaim("nope").status).toBe("rejected");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    await hub.handleMemberTerminal("bob");
    const toRemoved = alice.send({ to: "bob", message: "hello?" });
    expect(toRemoved.status).toBe("failed");
    expect(toRemoved.status === "failed" && toRemoved.error.code).toBe(
      "message_target_terminal_retired",
    );

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
    const sent = alice.send({
      to: "bob",
      message: "please sync",
      sourceTaskId: "task_x",
      sourceAttemptId: "att_9",
    });
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
        {
          taskId: "t_first",
          title: "t1",
          spec: { goal: "g", acceptance: ["a"] },
          dependsOn: ["t_second"],
        },
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
      draftTasks: [
        { taskId: "", title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
      ],
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
      draftTasks: [
        {
          taskId: "t_solo",
          title: "s",
          spec: { goal: "g", acceptance: ["a"] },
          dependsOn: ["t_solo"],
        },
      ],
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
    const first = leadPort.taskCreate({
      title: "t1",
      spec: { goal: "g", acceptance: ["a"] },
      dependsOn: [],
    });
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
    const deliver = vi.fn(acceptAllLeadMail());
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
      const deliveredFact = journal.find((event) => event.payload.kind === "message_delivered") as
        | { payload: { via?: string } }
        | undefined;
      expect(deliveredFact?.payload.via).toBe("lead_injected");
    });
  });

  it("keeps failed lead mail queued and retries on kickTeam; halted freezes delivery until resume", async () => {
    const deliver = vi.fn(rejectAllLeadMail());
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      deliverLeadMail: deliver,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    alice.send({ to: "lead", message: "first report" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(false);

    // halted 冻结门：kickTeam 不投递。
    hub.halt("lead_s1");
    deliver.mockImplementation(acceptAllLeadMail());
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

  it("§21 A2 blank resume reason is rejected as team_halted (not team_lead_only)", async () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    stageEmpty(hub);
    await hub.approveStage("lead_s1"); // halt 拒 staged：先过两阶段门再冻结
    hub.halt("lead_s1");
    // 空理由防御分支：调用方就是 lead，被拒因是 reason 空白——team_halted 的 hint
    //（explicit resume with a reason）才是正确教学；生产不可达（wire schema
    // reason min(1) 网关先拒），仅直调 hub 的测试/工具路径可触达。
    const rejected = hub.resume("lead_s1", "   ");
    expect(rejected.status).toBe("rejected");
    expect(rejected.status === "rejected" && rejected.error?.code).toBe("team_halted");
    expect(hub.status).toBe("halted"); // 冻结不动
    // 非空理由照常恢复（回归半边）。
    expect(hub.resume("lead_s1", "continue").status).toBe("ok");
  });
  // ---------- §21 A1（2026-10-24 登记）：deliverLeadMail 结构化结果——逐条容错， ----------
  // ---------- 离册死件丢弃（message_dropped）+ 部分注入不重投。                          ----------

  it("§21 A1 partial injection: injected entries deliver exactly once, skipped entries drop with a message_dropped fact, and later edges never re-inject", async () => {
    const journal: { payload: { kind: string; messageIds?: readonly string[]; via?: string } }[] =
      [];
    const batchSizes: number[] = [];
    let releaseDeliver: ((result: { injected: string[]; skipped: string[] }) => void) | undefined;
    const deliver = vi.fn((request: { entries: TeamMailboxEntry[] }) => {
      batchSizes.push(request.entries.length);
      return new Promise<{ injected: string[]; skipped: string[] }>((resolve) => {
        releaseDeliver = resolve;
      });
    });
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      deliverLeadMail: deliver,
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    // halted 冻结窗口构造同批 pending：halt 下 routeMail 的 fire-and-forget 投递被
    // deliverPendingLeadMail 冻结门挡住（不盖租约），两条 lead 邮件同时留 queued。
    hub.halt("lead_s1");
    const leadMail = (message: string): TeamMailboxEntry => ({
      messageId: `mail_${message.split(" ")[0]}`,
      from: "alice",
      to: "lead",
      message,
      at: "2026-10-24T00:00:00.000Z",
      deliveredAccepted: false,
    });
    hub.enqueueMail(leadMail("deliverable report"));
    hub.enqueueMail(leadMail("dead letter from a removed sender"));
    expect(hub.mailboxEntries()).toHaveLength(2);
    expect(deliver).not.toHaveBeenCalled();

    // resume 唤醒 kickTeam → deliverPendingLeadMail：两条 pending 同批一次 deliver 调用。
    hub.resume("lead_s1", "continue");
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(batchSizes).toEqual([2]);
    const deliveredId = hub.mailboxEntries()[0]!.messageId;
    const droppedId = hub.mailboxEntries()[1]!.messageId;

    // 通道逐条容错结果：可投条注入、发件人离册条跳过。
    releaseDeliver?.({ injected: [deliveredId], skipped: [droppedId] });
    await vi.waitFor(() => {
      // 可投条：恰注入一次并 markDelivered(lead_injected)；不可投条：从邮箱丢弃。
      const remaining = hub.mailboxEntries();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.messageId).toBe(deliveredId);
      expect(remaining[0]?.deliveredAccepted).toBe(true);
      expect(remaining[0]?.deliveredVia).toBe("lead_injected");
    });
    // journal 双事实：message_delivered(lead_injected) 与 message_dropped（reason 载荷）。
    await vi.waitFor(() => {
      const deliveredFact = journal.find(
        (event) =>
          event.payload.kind === "message_delivered" && event.payload.via === "lead_injected",
      );
      expect(deliveredFact?.payload.messageIds).toEqual([deliveredId]);
      const droppedFact = journal.find((event) => event.payload.kind === "message_dropped") as
        | { payload: { messageIds?: readonly string[]; reason?: string } }
        | undefined;
      expect(droppedFact?.payload.messageIds).toEqual([droppedId]);
      expect(droppedFact?.payload.reason).toBeTruthy();
    });

    // 重投边缘（deliverPendingLeadMail/kickTeam 同族）：已注入条 deliveredAccepted=true
    // 退出 pendingMail 选取集、已丢弃条不在邮箱——deliver 零再调用（零重复注入）。
    await hub.deliverPendingLeadMail();
    await hub.kickTeam();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(journal.filter((event) => event.payload.kind === "message_delivered")).toHaveLength(1);
    expect(journal.filter((event) => event.payload.kind === "message_dropped")).toHaveLength(1);
  });

  it("§21 A1 unreached entries keep their lease released and stay queued for the next edge", async () => {
    // 注入动作失败但非永久不可投（两表缺席）：仅释放该条租约留 queued 重投——
    // 「失败」不再触发整批重投已注入条目（旧 accepted=false 整批释放路径已删）。
    const journal: { payload: { kind: string; messageIds?: readonly string[] } }[] = [];
    let failAll = false;
    const deliver = vi.fn(async () => {
      if (failAll) return { injected: [], skipped: [] };
      throw new Error("enqueue channel unavailable");
    });
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      deliverLeadMail: deliver,
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.halt("lead_s1");
    // 同上：halt 冻结窗口留 queued，resume 边缘触发首投（抛错形态）。
    hub.enqueueMail({
      messageId: "mail_transient",
      from: "alice",
      to: "lead",
      message: "transient failure probe",
      at: "2026-10-24T00:00:00.000Z",
      deliveredAccepted: false,
    });
    hub.resume("lead_s1", "continue");
    await vi.waitFor(() => expect(deliver).toHaveBeenCalled());

    // 抛错与拒绝同责（收窄到未注入条目）：条目留 queued、无租约残留、零送达/丢弃事实。
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries()[0] as TeamMailboxEntry;
      expect(entry.deliveredAccepted).toBe(false);
      expect(entry.deliveryClaimedAt).toBeUndefined();
    });
    expect(journal.filter((event) => event.payload.kind === "message_delivered")).toHaveLength(0);
    expect(journal.filter((event) => event.payload.kind === "message_dropped")).toHaveLength(0);

    // 下一边缘重投恰一次，接受后收敛（spec §16 契约 3 重投语义维持）。
    failAll = true;
    deliver.mockImplementation(async (request: { entries: TeamMailboxEntry[] }) => ({
      injected: request.entries.map((entry) => entry.messageId),
      skipped: [],
    }));
    await hub.kickTeam();
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries()[0] as TeamMailboxEntry;
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

// ---------- spec §16 契约 1（2026-10-22 登记）：成员终态失败处置分类器 ----------

describe("member terminal failure disposition (spec §16 契约 1, dsh-agent-teams 好设计)", () => {
  interface JournalRow {
    payload: { kind: string; task?: { status?: string } };
  }

  /** 基线：alice 被自动派发持有 claimed 任务（世代当前）。 */
  async function prepareHubWithClaimedTask(journal: JournalRow[] = []) {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.leadPort("lead_s1").taskCreate({
      title: "doomed",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    return { hub, task: hub.board()!.tasks[0]! };
  }

  it("① failure with the current generation marks the task failed, notifies the lead exactly once, and journals task_updated", async () => {
    const journal: JournalRow[] = [];
    const { hub, task } = await prepareHubWithClaimedTask(journal);
    const attemptId = task.attemptId!;

    await hub.handleMemberFailed("alice", { status: "failed", agentId: "agent_alice", attemptId });

    const failed = hub.board()!.tasks[0]!;
    expect(failed.status).toBe("failed"); // 仅该代标 failed（claimed→failed 合法边）
    expect(failed.assignee).toBe("alice");
    expect(failed.attemptId).toBeUndefined(); // 终态凭证关闭
    expect(failed.output).toContain("fallback"); // 可行动文案（§16.2：路由命名 + fallback 提示）
    // 终态不可转派（复核修正）：reassign 拒终态，通知不再建议 TeamReassign/接管，
    // 补救路径是新建替代任务再指派；同时锁定「失败通知写入 output」行为（契约 1 裁决③）
    expect(failed.output).toContain("replacement task");
    expect(failed.output).not.toContain("TeamReassign");
    expect(failed.output).not.toContain("take it over");
    // lead 邮箱恰一条（from=成员、to=lead、携 source_task_id/source_attempt_id）
    const leadMail = hub.mailboxEntries().filter((entry) => entry.to === "lead");
    expect(leadMail).toHaveLength(1);
    expect(leadMail[0]?.from).toBe("alice");
    expect(leadMail[0]?.sourceTaskId).toBe(task.taskId);
    expect(leadMail[0]?.sourceAttemptId).toBe(attemptId);
    // journal task_updated（板事实）
    const fact = journal.filter((event) => event.payload.kind === "task_updated").at(-1);
    expect(fact?.payload.task?.status).toBe("failed");
    // 运行态事实收敛（与 handleMemberTerminal 同表；不自动重试、无新派发面）
    expect(hub.snapshot()?.members.find((member) => member.memberName === "alice")?.state).toBe(
      "terminal",
    );
  });

  it("② a stale failure (attemptId mismatch after reassignment) leaves the board untouched and stays fully silent", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      interruptAndSettle: async () => undefined,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "shifted",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const stale = hub.board()!.tasks[0]!;
    const staleAttemptId = stale.attemptId!;

    // 失败前任务已转派给 bob（旧世代失效），alice 另开新代任务
    const reassign = await lead.reassign({
      taskId: stale.taskId,
      to: "bob",
      reason: "alice overloaded",
    });
    expect(reassign.status).toBe("ok");
    lead.taskCreate({
      title: "fresh-gen",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "fresh-gen")?.status).toBe(
        "claimed",
      );
    });
    const fresh = hub.board()!.tasks.find((candidate) => candidate.title === "fresh-gen")!;

    // 旧世代（attemptId 失配）的失败边缘迟到到达 → ignored 全静默
    await hub.handleMemberFailed("alice", {
      status: "failed",
      agentId: "agent_alice",
      attemptId: staleAttemptId,
    });

    const shifted = hub.board()!.tasks.find((candidate) => candidate.title === "shifted")!;
    expect(shifted.status).toBe("claimed"); // bob 的世代不被误伤
    expect(shifted.assignee).toBe("bob");
    expect(fresh.status).toBe("claimed"); // alice 的新代不被误伤
    expect(fresh.attemptId).not.toBe(staleAttemptId);
    expect(hub.mailboxEntries().filter((entry) => entry.to === "lead")).toHaveLength(0); // 全静默
  });

  it("③ failure when the task is already completed leaves the board unchanged but still notifies the lead once (noted)", async () => {
    const { hub, task } = await prepareHubWithClaimedTask();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    // 任务先被持有凭证的工作者正常推进到 completed
    expect(
      alice.taskUpdate({
        taskId: task.taskId,
        attemptId: task.attemptId!,
        patch: { status: "in_progress" },
      }).status,
    ).toBe("ok");
    expect(
      alice.taskUpdate({
        taskId: task.taskId,
        attemptId: task.attemptId!,
        patch: { status: "completed" },
      }).status,
    ).toBe("ok");

    await hub.handleMemberFailed("alice", { status: "failed" });

    expect(hub.board()!.tasks[0]!.status).toBe("completed"); // 板零改动
    const leadMail = hub.mailboxEntries().filter((entry) => entry.to === "lead");
    expect(leadMail).toHaveLength(1); // lead 仍收一次通知（noted）
    expect(leadMail[0]?.sourceTaskId).toBeUndefined(); // noted 无任务绑定
    expect(leadMail[0]?.message).toContain("No open task");
    expect(leadMail[0]?.message).not.toContain("TeamReassign"); // noted 无任务可转派，不含转派建议
  });

  it("④ a failed edge consumed during the halted freeze is not classified (task stays sticky-parked)", async () => {
    const journal: JournalRow[] = [];
    const { hub, task } = await prepareHubWithClaimedTask(journal);
    const attemptId = task.attemptId!;
    expect(hub.halt("lead_s1").status).toBe("ok");

    await hub.handleMemberFailed("alice", { status: "failed", agentId: "agent_alice", attemptId });

    const frozen = hub.board()!.tasks[0]!;
    expect(frozen.status).toBe("claimed"); // §2.6 冻结面：不标 failed
    expect(frozen.attemptId).toBe(attemptId); // sticky park 凭证保持
    expect(hub.mailboxEntries().filter((entry) => entry.to === "lead")).toHaveLength(0); // 无失败通知
    expect(
      journal.filter(
        (event) => event.payload.kind === "task_updated" && event.payload.task?.status === "failed",
      ),
    ).toHaveLength(0); // 无板事实
    expect(hub.snapshot()?.members.find((member) => member.memberName === "alice")?.state).toBe(
      "terminal",
    );

    // resume 后不补分类（边缘已消费 + lastSeen 去重）：任务仍 sticky 由 lead 转派兜底
    expect(hub.resume("lead_s1", "continue").status).toBe("ok");
    await vi.waitFor(() => expect(hub.status).not.toBe("halted"));
    expect(hub.board()!.tasks[0]!.status).toBe("claimed");
  });

  it("⑤ killed/stopped/cancelled terminal edges never mark failed — the route keeps sticky park (契约 1 适配修正)", async () => {
    const { hub, task } = await prepareHubWithClaimedTask();
    // killed/stopped/cancelled 走既有 handleMemberTerminal（install 分诊，spec 契约 1
    // 适配修正：成员停机路径不写 stopInitiator，无法甄别用户中断；照 §2.6 sticky park）：
    // 任务不标 failed、凭证保持、lead 不收失败通知。
    await hub.handleMemberTerminal("alice");
    const parked = hub.board()!.tasks[0]!;
    expect(parked.status).toBe("claimed");
    expect(parked.attemptId).toBe(task.attemptId);
    expect(hub.mailboxEntries().filter((entry) => entry.to === "lead")).toHaveLength(0);
  });
});

describe("classifyMemberFailure boundary table (board 纯函数, spec §16 契约 1)", () => {
  const task = { taskId: "t1", attemptId: "att1", assignee: "alice", status: "claimed" as const };

  it("maps removed/rotated/mismatched scenes to ignored, task-less scenes to noted, exact matches to failed_attempt", () => {
    // ignored：已移除 / agentId 换代 / taskId·attemptId·assignee 任一失配（迟到失败不误伤新代）
    expect(
      classifyMemberFailure(
        { memberName: "alice" },
        { member: { agentId: "a1", removed: true }, task },
      ),
    ).toBe("ignored");
    expect(
      classifyMemberFailure(
        { memberName: "alice", agentId: "a2" },
        { member: { agentId: "a1" }, task },
      ),
    ).toBe("ignored");
    expect(
      classifyMemberFailure(
        { memberName: "alice", taskId: "t9" },
        { member: { agentId: "a1" }, task },
      ),
    ).toBe("ignored");
    expect(
      classifyMemberFailure(
        { memberName: "alice", attemptId: "att0" },
        { member: { agentId: "a1" }, task },
      ),
    ).toBe("ignored");
    expect(
      classifyMemberFailure(
        { memberName: "alice", assignee: "bob" },
        { member: { agentId: "a1" }, task },
      ),
    ).toBe("ignored");
    // noted：无开放任务（缺席或已终态）——板零改动，仅通知
    expect(classifyMemberFailure({ memberName: "alice" }, { member: { agentId: "a1" } })).toBe(
      "noted",
    );
    expect(
      classifyMemberFailure(
        { memberName: "alice" },
        { member: { agentId: "a1" }, task: { ...task, status: "completed" } },
      ),
    ).toBe("noted");
    // failed_attempt：精确匹配（世代字段缺省 = 无从核对，不参与失配判定）
    expect(
      classifyMemberFailure(
        { memberName: "alice", taskId: "t1", attemptId: "att1", assignee: "alice" },
        { member: { agentId: "a1" }, task },
      ),
    ).toBe("failed_attempt");
    expect(
      classifyMemberFailure({ memberName: "alice" }, { member: { agentId: "a1" }, task }),
    ).toBe("failed_attempt");
  });
});

// ---------- spec §16 契约 2（2026-10-22 登记）：终态不可变补齐 ----------

describe("terminal output immutability through the member port (spec §16 契约 2, dsh terminal-immutability)", () => {
  it("member port rejects rewriting a completed task's output; the board keeps the original", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.leadPort("lead_s1").taskCreate({
      title: "delivered",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const task = hub.board()!.tasks[0]!;
    // claimed → in_progress（迁移表无 claimed→completed 直达边）
    expect(
      alice.taskUpdate({
        taskId: task.taskId,
        attemptId: task.attemptId!,
        patch: { status: "in_progress" },
      }).status,
    ).toBe("ok");

    // 一次性 completed+output（迁移前非终态）→ 合法提交流不受影响
    const finish = alice.taskUpdate({
      taskId: task.taskId,
      attemptId: task.attemptId!,
      patch: { status: "completed", output: "real result" },
    });
    expect(finish.status).toBe("ok");

    // 终态后经成员端口改写（无凭证 + 错凭证各一次）→ rejected 且板上 output 不变
    for (const attemptId of ["", task.attemptId!]) {
      const rewrite = alice.taskUpdate({
        taskId: task.taskId,
        attemptId,
        patch: { output: "forged" },
      });
      expect(rewrite.status).toBe("rejected");
      expect(rewrite.status === "rejected" && rewrite.error.code).toBe("terminal_read_only");
      expect(hub.board()!.tasks.find((c) => c.taskId === task.taskId)?.output).toBe("real result");
    }

    // 唯一合法终态通道：署名追补仍可经端口追加
    const supplement = alice.taskUpdate({
      taskId: task.taskId,
      attemptId: "",
      patch: {},
      acceptanceSupplement: { evidenceNote: "late proof" },
    });
    expect(supplement.status).toBe("ok");
    expect(hub.board()!.tasks.find((c) => c.taskId === task.taskId)?.output).toBe("real result");
  });
});

// ---------- spec §16 契约 3（2026-10-22 登记）：邮箱投递租约（claim/release） ----------

describe("mailbox delivery lease (spec §16 契约 3, dsh 投递 claim 互斥 + 60s 崩溃租约)", () => {
  /** 可手动推进的 fake clock（租约时长谓词按墙钟差比较，推进即可测到期重投）。 */
  function makeStepClock(): BoardClock & { advanceMs: (ms: number) => void } {
    let t = Date.UTC(2026, 9, 22, 0, 0, 0);
    let n = 0;
    return {
      now: () => new Date(t).toISOString(),
      newId: () => `id_${String(++n).padStart(3, "0")}`,
      advanceMs: (ms: number) => {
        t += ms;
      },
    };
  }

  it("① pending dispatch holds the lease: a concurrent kickTeam skips the claimed mail (dispatch sees the body exactly once)", async () => {
    const prompts: { memberName: string; prompt: string; mode: string }[] = [];
    let releaseDispatch: ((accepted: boolean) => void) | undefined;
    const dispatch: TeamDispatchFn = (request) =>
      new Promise<boolean>((resolve) => {
        prompts.push(request);
        releaseDispatch = resolve;
      });
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.markMemberWorking("bob"); // working → routeMail 即时 steer（fire-and-forget 双投窗口）

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "bob", message: "double window probe" });
    expect(sent.status === "success" && sent.delivery).toBe("steered");
    expect(prompts).toHaveLength(1); // dispatch 已发起但未 resolve：租约持有中

    // 窗口内并发 kickTeam（routeMail×kick 双投窗口）：第二条路径按租约过滤跳过本条
    await hub.kickTeam();
    expect(prompts).toHaveLength(1); // dispatch 恰一次收到该邮件体
    expect(prompts[0]?.prompt).toContain("double window probe");
    expect(hub.mailboxEntries()[0]?.deliveryClaimedAt).toBeDefined();

    // dispatch 被接受 → markDelivered 覆盖（claim 清除），此后投递调用零副作用
    releaseDispatch?.(true);
    await vi.waitFor(() => {
      const delivered = hub.mailboxEntries().at(-1);
      expect(delivered?.deliveredAccepted).toBe(true);
      expect(delivered?.deliveredVia).toBe("steered");
      expect(delivered?.deliveryClaimedAt).toBeUndefined();
    });
    await hub.kickTeam();
    expect(prompts).toHaveLength(1);
  });

  it("② rejected dispatch releases the claim: the next delivery edge redelivers exactly once", async () => {
    const prompts: string[] = [];
    let accept = false;
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async (request) => {
        prompts.push(request.prompt);
        return accept;
      },
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    await hub.handleMemberTerminal("bob"); // 终态成员 → routeMail 走复活投递（第一条路径）

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    alice.send({ to: "bob", message: "retry probe" });
    await vi.waitFor(() => {
      expect(prompts).toHaveLength(1);
      const current = hub.mailboxEntries().at(-1);
      expect(current?.deliveredAccepted).toBe(false);
      // 拒绝 → claim 释放（不因失败丢件、不因失败卡件）
      expect(current?.deliveryClaimedAt).toBeUndefined();
    });

    // 下一投递边缘重投恰一次
    accept = true;
    await hub.kickTeam();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("retry probe");
    const delivered = hub.mailboxEntries().at(-1);
    expect(delivered?.deliveredAccepted).toBe(true);

    // 送达后重复边缘零副作用
    await hub.kickTeam();
    expect(prompts).toHaveLength(2);
  });

  it("③ advancing the fake clock past the lease makes in-flight claimed mail re-deliverable", async () => {
    const clock = makeStepClock();
    const prompts: string[] = [];
    const releaseDispatches: ((accepted: boolean) => void)[] = [];
    const dispatch: TeamDispatchFn = (request) =>
      new Promise<boolean>((resolve) => {
        prompts.push(request.prompt);
        releaseDispatches.push(resolve);
      });
    const hub = new TeamHub({ clock, spawnMembers: spawnOk(), dispatch });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.markMemberWorking("bob");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    alice.send({ to: "bob", message: "lease expiry probe" });
    expect(prompts).toHaveLength(1); // routeMail 即时投递，dispatch 挂起，租约持有中

    // 租约内的并发边缘不重投（挂起中的 dispatch 不主动续租，也不提前让位）
    await hub.kickTeam();
    expect(prompts).toHaveLength(1);

    // fake clock 推进超租约（60s，TEAM_KERNEL_LIMITS.deliveryLeaseMs）→ 租约失效可重投
    // （dsh 崩溃租约同款已知边界：投递耗时超租约会提前重投，幂等兜底靠 ack 只认注入）
    clock.advanceMs(TEAM_KERNEL_LIMITS.deliveryLeaseMs + 1);
    // kickTeam 内部 await 第二条 dispatch：先发起再等派发出现，避免死等挂起通道
    const secondKick = hub.kickTeam();
    await vi.waitFor(() => expect(prompts).toHaveLength(2));
    expect(prompts[1]).toContain("lease expiry probe");
    releaseDispatches[1]?.(true);
    await secondKick;

    // 第二条路径被接受 → 送达；慢路径迟到接受不改变送达事实（markDelivered 幂等覆盖）
    releaseDispatches[1]?.(true);
    await vi.waitFor(() => expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(true));
    releaseDispatches[0]?.(true);
    await vi.waitFor(() => {
      const delivered = hub.mailboxEntries().at(-1);
      expect(delivered?.deliveredAccepted).toBe(true);
      expect(delivered?.deliveryClaimedAt).toBeUndefined();
    });
    expect(prompts).toHaveLength(2);
  });

  it("④ concurrent lead-mail triggers deliver the pending batch exactly once (routeMail × kickTeam × turn-complete)", async () => {
    const batchSizes: number[] = [];
    let releaseDeliver: ((result: { injected: string[]; skipped: string[] }) => void) | undefined;
    const deliver = vi.fn((request: { entries: TeamMailboxEntry[] }) => {
      batchSizes.push(request.entries.length);
      return new Promise<{ injected: string[]; skipped: string[] }>((resolve) => {
        releaseDeliver = resolve;
      });
    });
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      deliverLeadMail: deliver,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    alice.send({ to: "lead", message: "lead batch probe" });
    // routeMail 的 fire-and-forget 触发点已盖 claim 并发起注入
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(batchSizes).toEqual([1]);

    // 并发第二/第三触发点（kickTeam 末尾与 lead turn-complete sink 同形）：跳过已 claim 批
    await hub.deliverPendingLeadMail();
    await hub.kickTeam();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(batchSizes).toEqual([1]);

    // 注入被接受 → 整批 markDelivered；此后触发点零副作用
    releaseDeliver?.({
      injected: [hub.mailboxEntries()[0]!.messageId],
      skipped: [],
    });
    await vi.waitFor(() => {
      const delivered = hub.mailboxEntries().at(-1);
      expect(delivered?.deliveredAccepted).toBe(true);
      expect(delivered?.deliveredVia).toBe("lead_injected");
      expect(delivered?.deliveryClaimedAt).toBeUndefined();
    });
    await hub.deliverPendingLeadMail();
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

// ---------- spec §16 契约 4（2026-10-22 登记）：TeamSend 世代纪律——内容级幂等去重 + source 配对校验 ----------

describe("TeamSend generation discipline: content-level dedup + source pairing (spec §16 契约 4, dsh-agent-teams 好设计)", () => {
  /** 基线：alice 持有已认领任务（kick 自动认领出 attemptId），bob 空闲可收件。 */
  async function prepare() {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      interruptAndSettle: async () => undefined,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, lead, task: task! };
  }

  it("① resending the identical report twice keeps exactly one mailbox entry and returns the same messageId", async () => {
    const { hub, task } = await prepare();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const report = {
      to: "lead",
      message: "report: survey done",
      sourceTaskId: task.taskId,
      sourceAttemptId: task.attemptId ?? "",
    };
    const first = alice.send(report);
    const second = alice.send(report);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    // dsh 补1/补6：同报告重试复用同一条持久消息——同 messageId 返回即去重信号
    // （TeamSendDelivery 闭合枚举不加 "duplicate" 值，spec §16 契约 4）。
    expect(first.status === "success" && second.status === "success" && second.messageId).toBe(
      first.messageId,
    );
    expect(hub.mailboxEntries()).toHaveLength(1);
  });

  it("② a delivered plain guidance can be re-sent as a new entry (deliberate reminder channel stays open)", async () => {
    const { hub } = await prepare();
    hub.markMemberWorking("bob");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const first = alice.send({ to: "bob", message: "please sync" });
    expect(first.status === "success" && first.delivery).toBe("steered");
    await vi.waitFor(() => {
      expect(hub.mailboxEntries()[0]?.deliveredAccepted).toBe(true);
    });

    // 不对称语义（dsh 补1）「未绑定」半边：已投递的普通引导重发允许新条目。
    const second = alice.send({ to: "bob", message: "please sync" });
    expect(second.status).toBe("success");
    expect(first.status === "success" && second.status === "success" && second.messageId).not.toBe(
      first.messageId,
    );
    expect(hub.mailboxEntries()).toHaveLength(2);
  });

  it("③ resending the same text after a generation rotation enters normally (the old entry is no longer current)", async () => {
    const { hub, lead, task } = await prepare();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const first = alice.send({ to: "bob", message: "heads up", targetTaskId: task.taskId });
    expect(first.status).toBe("success");

    // 转派轮换世代：条目快照的 targetAttemptId 失配 → 旧条目已不 isCurrentMail，
    // 去重谓词不命中 → 同文重发正常入箱（spec §16 契约 4 不变量）。
    const rotated = await lead.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
    expect(rotated.status).toBe("ok");
    const second = alice.send({ to: "bob", message: "heads up", targetTaskId: task.taskId });
    expect(second.status).toBe("success");
    expect(first.status === "success" && second.status === "success" && second.messageId).not.toBe(
      first.messageId,
    );
    expect(hub.mailboxEntries()).toHaveLength(2);
  });

  it("④ sourceTaskId without sourceAttemptId is rejected (missing_attempt_id) and nothing is appended", async () => {
    const { hub, task } = await prepare();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const result = alice.send({
      to: "lead",
      message: "report without credential",
      sourceTaskId: task.taskId,
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("missing_attempt_id");
    expect(hub.mailboxEntries()).toHaveLength(0);
  });

  it("⑤ a stale sourceAttemptId after reassignment is rejected (attempt_revoked) and nothing is appended", async () => {
    const { hub, lead, task } = await prepare();
    const staleAttemptId = task.attemptId ?? "";
    const rotated = await lead.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
    expect(rotated.status).toBe("ok");

    // 世代纪律（dsh tools.ts 语义）：非终态源任务上报告不能靠携带旧代穿透——
    // 省略 sourceAttemptId 曾全量绕过 isCurrentMail，现在精确核对当前代。
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const result = alice.send({
      to: "lead",
      message: "stale report",
      sourceTaskId: task.taskId,
      sourceAttemptId: staleAttemptId,
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("attempt_revoked");
    expect(hub.mailboxEntries()).toHaveLength(0);
  });

  it("⑥ the current owner's sourceAttemptId passes the pairing check and enters the mailbox", async () => {
    const { hub, lead, task } = await prepare();
    const rotated = await lead.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
    expect(rotated.status).toBe("ok");
    const fresh = hub.board()?.tasks.find((candidate) => candidate.taskId === task.taskId);

    const bob = hub.memberPort({ agentId: "agent_bob", memberName: "bob" });
    const result = bob.send({
      to: "lead",
      message: "fresh report",
      sourceTaskId: task.taskId,
      sourceAttemptId: fresh?.attemptId ?? "",
    });
    expect(result.status).toBe("success");
    expect(hub.mailboxEntries()).toHaveLength(1);
    expect(hub.mailboxEntries()[0]?.sourceTaskId).toBe(task.taskId);
    expect(hub.mailboxEntries()[0]?.sourceAttemptId).toBe(fresh?.attemptId);
  });
});

// ---------- spec §20 契约 1（2026-10-23 补审计登记）：终态源报告剥离 sourceAttemptId 入箱 ----------

describe("terminal-source report strips sourceAttemptId at portSend (spec §20 契约 1, 修订 §16 契约 4 终态分支)", () => {
  /**
   * 基线：alice 持已认领任务（kick 自动认领出 attemptId），lead 注入走显式
   * deliverLeadMail 探针（缺省依赖下无法断言「恰一次」与 deliveredAccepted）。
   */
  async function prepare(
    deliver: (request: {
      entries: readonly TeamMailboxEntry[];
    }) => Promise<{ injected: readonly string[]; skipped: readonly string[] }>,
  ) {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      deliverLeadMail: deliver,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, task: task! };
  }

  /** 成员端口完成任务：claimed → in_progress → completed（迁移表无 claimed→completed 直达边）。 */
  function completeTask(hub: TeamHub, taskId: string, attemptId: string): void {
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    expect(alice.taskUpdate({ taskId, attemptId, patch: { status: "in_progress" } }).status).toBe(
      "ok",
    );
    expect(alice.taskUpdate({ taskId, attemptId, patch: { status: "completed" } }).status).toBe(
      "ok",
    );
  }

  it("① report sent after the source task completed enters stripped (no sourceAttemptId) and delivers to lead exactly once", async () => {
    const deliver = vi.fn(acceptAllLeadMail());
    const { hub, task } = await prepare(deliver);
    const attemptId = task.attemptId!;
    completeTask(hub, task.taskId, attemptId);
    // 终态清凭证（applyTaskUpdate 终态分支）：提交的 attemptId 必非任务当前代。
    expect(hub.board()?.tasks.find((c) => c.taskId === task.taskId)?.attemptId).toBeUndefined();

    // 成员自然顺序（spec §20 契约 1 现状缺口场景）：先 TeamTaskUpdate{completed} 再补报告。
    const sent = hub.memberPort({ agentId: "agent_alice", memberName: "alice" }).send({
      to: "lead",
      message: "report: survey done",
      sourceTaskId: task.taskId,
      sourceAttemptId: attemptId,
    });
    expect(sent.status).toBe("success");

    // 入箱 entry 剥离 sourceAttemptId（保留 sourceTaskId 展示引用；模型报告恒无
    // sourceTaskStatus）——无绑定邮件不再受 isCurrentMail 第一谓词世代过滤。
    expect(hub.mailboxEntries()).toHaveLength(1);
    const entry = hub.mailboxEntries()[0]!;
    expect(entry.sourceAttemptId).toBeUndefined();
    expect(entry.sourceTaskId).toBe(task.taskId);
    expect(entry.sourceTaskStatus).toBeUndefined();

    // lead 侧 pendingMail 可投递：deliverPendingLeadMail 恰一次注入该条并接受。
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(deliver.mock.calls[0]?.[0]?.entries.map((item) => item.messageId)).toEqual([
      entry.messageId,
    ]);
    await vi.waitFor(() =>
      expect(
        hub.mailboxEntries().find((item) => item.messageId === entry.messageId)?.deliveredAccepted,
      ).toBe(true),
    );
  });

  it("② retrying the identical stripped report while undelivered merges into the same messageId (unbound dedup half)", async () => {
    // 注入恒拒 → 旧条目保持未投递（无绑定去重半边的前提）。
    const deliver = vi.fn(rejectAllLeadMail());
    const { hub, task } = await prepare(deliver);
    const attemptId = task.attemptId!;
    completeTask(hub, task.taskId, attemptId);
    const report = {
      to: "lead",
      message: "report: survey done",
      sourceTaskId: task.taskId,
      sourceAttemptId: attemptId,
    };
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const first = alice.send(report);
    const second = alice.send(report);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    // 有意收敛（spec §20 契约 1 登记，用例锁定）：剥离后按无绑定邮件半边去重——
    // 旧条目未投递 → 归并复用同一 messageId，不重复入箱。
    expect(first.status === "success" && second.status === "success" && second.messageId).toBe(
      first.messageId,
    );
    expect(hub.mailboxEntries()).toHaveLength(1);
  });

  it("③ after delivery a re-sent identical stripped report enters as a new entry (deliberate reminder channel stays open)", async () => {
    const deliver = vi.fn(acceptAllLeadMail());
    const { hub, task } = await prepare(deliver);
    const attemptId = task.attemptId!;
    completeTask(hub, task.taskId, attemptId);
    const report = {
      to: "lead",
      message: "report: survey done",
      sourceTaskId: task.taskId,
      sourceAttemptId: attemptId,
    };
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const first = alice.send(report);
    expect(first.status).toBe("success");
    await vi.waitFor(() => expect(hub.mailboxEntries()[0]?.deliveredAccepted).toBe(true));

    // 不对称语义（dsh 补1）「未绑定」半边照常适用：已投递后重发允许新条目。
    const second = alice.send(report);
    expect(second.status).toBe("success");
    expect(first.status === "success" && second.status === "success" && second.messageId).not.toBe(
      first.messageId,
    );
    expect(hub.mailboxEntries()).toHaveLength(2);
  });
});

// ---------- spec §16 契约 5（2026-10-23 登记）：任务终态恢复预算——lead 显式重开 ----------

describe("lead-only task reopen (spec §16 契约 5, failed→pending controlled edge)", () => {
  interface JournalRow {
    payload: { kind: string; task?: { status?: string; attempt?: number } };
  }

  /** 基线：alice 被自动派发持有 claimed 任务并经契约 1 主路径带进 failed。 */
  async function prepareWithFailedTask(journal: JournalRow[] = []) {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.leadPort("lead_s1").taskCreate({
      title: "doomed",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const task = hub.board()!.tasks[0]!;
    const attemptId = task.attemptId!;
    await hub.handleMemberFailed("alice", {
      status: "failed",
      agentId: "agent_alice",
      attemptId,
    });
    expect(hub.board()!.tasks[0]!.status).toBe("failed");
    return { hub, journal, task, attemptId };
  }

  it("① reopen is lead-only: a foreign lead session is rejected and the member update path cannot pull failed back to pending", async () => {
    const { hub, task, attemptId } = await prepareWithFailedTask();

    // 非 lead 会话（TeamLeadPort 结构性通道，requireLeadRecord 拒绝）
    const foreign = hub.leadPort("lead_other").reopenTask({ taskId: task.taskId });
    expect(foreign.status).toBe("rejected");
    expect(foreign.status === "rejected" && foreign.error.code).toBe("team_lead_only");
    expect(hub.board()!.tasks[0]!.status).toBe("failed");

    // 成员端口无重开通道（TeamMemberPort 类型面即无此方法）；经 taskUpdate 携旧代
    // 凭证把 failed 拉回 pending → 通用更新面整次拒绝（契约 5 wasTerminal 守卫）
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const viaUpdate = alice.taskUpdate({
      taskId: task.taskId,
      attemptId,
      patch: { status: "pending" },
    });
    expect(viaUpdate.status).toBe("rejected");
    expect(viaUpdate.status === "rejected" && viaUpdate.error.code).toBe("team_lead_only");
    expect(hub.board()!.tasks[0]!.status).toBe("failed");
    expect(hub.board()!.tasks[0]!.output).toBeDefined(); // 失败通知记录不被绕过重开清掉
  });

  it("② lead reopens the failed task: shared-pool pending with evidence cleared, journal fact, and redispatch claims a continued attempt", async () => {
    const journal: JournalRow[] = [];
    const { hub, task, attemptId } = await prepareWithFailedTask(journal);
    const failed = hub.board()!.tasks[0]!;
    expect(failed.output).toContain("replacement task"); // 契约 1 失败通知在 output（重开将清空）

    const reopened = hub.leadPort("lead_s1").reopenTask({ taskId: task.taskId });
    expect(reopened.status).toBe("ok");
    const card = reopened.status === "ok" ? reopened.task : undefined;
    expect(card?.status).toBe("pending");
    expect(card?.assignee).toBeUndefined(); // 回共享池
    expect(card?.attempt).toBe(1); // 计数延续未跳变
    expect(card?.output).toBeUndefined(); // 旧代证据清空（失败通知只留在 lead 邮箱/journal）
    expect(card?.recoveryRetried).toBeUndefined();

    // journal task_updated 板事实（不新增 journal kind，契约 5）
    const fact = journal.filter((event) => event.payload.kind === "task_updated").at(-1);
    expect(fact?.payload.task?.status).toBe("pending");

    // kickTeam 重臂（reopenTask 内 fire-and-forget）：alice 复活认领，attempt 延续 +1
    await vi.waitFor(() => {
      const reclaimed = hub.board()?.tasks.find((candidate) => candidate.taskId === task.taskId);
      expect(reclaimed?.status).toBe("claimed");
      expect(reclaimed?.attempt).toBe(2);
    });
    const reclaimed = hub.board()!.tasks.find((candidate) => candidate.taskId === task.taskId)!;
    expect(reclaimed.attemptId).not.toBe(attemptId);

    // 旧代迟到更新被拒（世代纪律跨重开边界）
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const late = alice.taskUpdate({
      taskId: task.taskId,
      attemptId,
      patch: { status: "in_progress" },
    });
    expect(late.status).toBe("rejected");
    expect(late.status === "rejected" && late.error.code).toBe("attempt_revoked");
  });

  it("③ reopen boundaries: only failed is reopenable (lead's own taskUpdate included); reassign still refuses terminal", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });

    const unknown = lead.reopenTask({ taskId: "task_missing" });
    expect(unknown.status).toBe("rejected");
    expect(unknown.status === "rejected" && unknown.error.code).toBe("team_not_present");

    // 开放中（claimed）任务不可重开
    lead.taskCreate({
      title: "live",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "live")?.status).toBe(
        "claimed",
      );
    });
    const live = hub.board()!.tasks.find((candidate) => candidate.title === "live")!;
    const liveCredential = live.attemptId!;
    const openReopen = lead.reopenTask({ taskId: live.taskId });
    expect(openReopen.status === "rejected" && openReopen.error.code).toBe("invalid_transition");

    // completed 任务不可重开；reassign 对 completed 仍拒（锁定保留）
    expect(
      alice.taskUpdate({
        taskId: live.taskId,
        attemptId: liveCredential,
        patch: { status: "in_progress" },
      }).status,
    ).toBe("ok");
    expect(
      alice.taskUpdate({
        taskId: live.taskId,
        attemptId: liveCredential,
        patch: { status: "completed", output: "done" },
      }).status,
    ).toBe("ok");
    const completedReopen = lead.reopenTask({ taskId: live.taskId });
    expect(completedReopen.status === "rejected" && completedReopen.error.code).toBe(
      "invalid_transition",
    );
    const completedReassign = await lead.reassign({
      taskId: live.taskId,
      to: "bob",
      reason: "nope",
    });
    expect(completedReassign.status === "rejected" && completedReassign.error.code).toBe(
      "invalid_transition",
    );

    // cancelled 任务不可重开（lead 用当前凭证置 cancelled，claimed→cancelled 合法边）
    lead.taskCreate({
      title: "dropped",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "dropped")?.status).toBe(
        "claimed",
      );
    });
    const dropped = hub.board()!.tasks.find((candidate) => candidate.title === "dropped")!;
    expect(
      lead.taskUpdate({
        taskId: dropped.taskId,
        attemptId: dropped.attemptId!,
        patch: { status: "cancelled" },
      }).status,
    ).toBe("ok");
    const cancelledReopen = lead.reopenTask({ taskId: dropped.taskId });
    expect(cancelledReopen.status === "rejected" && cancelledReopen.error.code).toBe(
      "invalid_transition",
    );

    // failed 任务：reassign 仍拒终态（契约 5 不动 reassign 语义）；lead 自身的通用
    // taskUpdate 同样不能消费受控出边（team_lead_only）——唯一通道是 reopenTask
    lead.taskCreate({
      title: "doomed",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "doomed")?.status).toBe(
        "claimed",
      );
    });
    const doomed = hub.board()!.tasks.find((candidate) => candidate.title === "doomed")!;
    await hub.handleMemberFailed("alice", {
      status: "failed",
      agentId: "agent_alice",
      attemptId: doomed.attemptId!,
    });
    expect(hub.board()!.tasks.find((candidate) => candidate.title === "doomed")!.status).toBe(
      "failed",
    );
    const failedReassign = await lead.reassign({
      taskId: doomed.taskId,
      to: "bob",
      reason: "nope",
    });
    expect(failedReassign.status === "rejected" && failedReassign.error.code).toBe(
      "invalid_transition",
    );
    const leadViaUpdate = lead.taskUpdate({
      taskId: doomed.taskId,
      attemptId: "",
      patch: { status: "pending" },
    });
    expect(leadViaUpdate.status === "rejected" && leadViaUpdate.error.code).toBe("team_lead_only");

    // halted 冻结门（照 reassign 先例）
    expect(hub.halt("lead_s1").status).toBe("ok");
    const haltedReopen = lead.reopenTask({ taskId: doomed.taskId });
    expect(haltedReopen.status === "rejected" && haltedReopen.error.code).toBe("team_halted");
  });

  it("④ reopen resets the automatic recovery budget and clears stale parked credentials", async () => {
    const queueAttempts: string[] = [];
    let accept = true;
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async (request) => {
        if (request.mode === "queue") queueAttempts.push(request.attemptId ?? "");
        return accept;
      },
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "stranded",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const firstAttemptId = hub.board()!.tasks[0]!.attemptId!;

    // 自动冷恢复预算用掉：投递失败 → recoveryRetried 置位、原世代恢复、保持 parked
    accept = false;
    await hub.handleMemberTerminal("alice");
    expect(await hub.recoverOpenAttempt("alice")).toBe(false);
    expect(hub.board()!.tasks[0]!.recoveryRetried).toBe(true);
    expect(hub.board()!.tasks[0]!.attemptId).toBe(firstAttemptId);

    // lead 用当前凭证强制置 failed（claimed→failed 合法边）→ parked 残留悬挂
    expect(
      lead.taskUpdate({
        taskId: hub.board()!.tasks[0]!.taskId,
        attemptId: firstAttemptId,
        patch: { status: "failed" },
      }).status,
    ).toBe("ok");
    const parkedAttempts = (hub as unknown as { parkedAttempts: Map<string, string> })
      .parkedAttempts;
    expect(parkedAttempts.get("agent_alice")).toBe(firstAttemptId); // 残留探针

    // reopenTask：recoveryRetried 重置 + parked 残留清理（failed_attempt 先例同族）
    expect(lead.reopenTask({ taskId: hub.board()!.tasks[0]!.taskId }).status).toBe("ok");
    expect(hub.board()!.tasks[0]!.recoveryRetried).toBeUndefined();
    expect(parkedAttempts.has("agent_alice")).toBe(false);

    // 新世代冷恢复预算恰一次：再认领（attempt 延续）→ 终态 park → 这次恢复真的重试了
    accept = true;
    await hub.kickTeam();
    const reclaimed = hub.board()!.tasks[0]!;
    expect(reclaimed.status).toBe("claimed");
    expect(reclaimed.assignee).toBe("alice");
    const reclaimedAttemptId = reclaimed.attemptId!;
    accept = false;
    await hub.handleMemberTerminal("alice");
    const dispatchesBeforeRecovery = queueAttempts.length;
    expect(await hub.recoverOpenAttempt("alice")).toBe(false);
    // 恢复确实发起了派发（预算已被重置——若未重置此处不会新增派发）；失败回滚保持
    // 原世代且预算重新置位
    expect(queueAttempts).toHaveLength(dispatchesBeforeRecovery + 1);
    expect(queueAttempts[queueAttempts.length - 1]).not.toBe(reclaimedAttemptId);
    expect(hub.board()!.tasks[0]!.attemptId).toBe(reclaimedAttemptId);
    expect(hub.board()!.tasks[0]!.recoveryRetried).toBe(true);

    // 预算用尽后不再重试（无新派发）
    const dispatchesBefore = queueAttempts.length;
    expect(await hub.recoverOpenAttempt("alice")).toBe(false);
    expect(queueAttempts).toHaveLength(dispatchesBefore);
  });

  it("⑤ stale-generation mail is not resurrected after reopen; the new generation dedups independently", async () => {
    const deliver = vi.fn(rejectAllLeadMail()); // lead 注入恒拒 → 失败通知留 queued（世代探针）
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      deliverLeadMail: deliver,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    lead.taskCreate({
      title: "doomed",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const task = hub.board()!.tasks[0]!;
    const attemptId = task.attemptId!;

    // 契约 1 主路径失败：lead 收到失败通知（source 三元组绑定旧世代），注入失败留 queued
    await hub.handleMemberFailed("alice", {
      status: "failed",
      agentId: "agent_alice",
      attemptId,
    });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    const notice = hub.mailboxEntries().find((entry) => entry.sourceAttemptId === attemptId);
    expect(notice?.deliveredAccepted).toBe(false);

    // 重开：旧世代 attemptId 失配 → isCurrentMail 失活，重投边缘不再投旧通知
    expect(lead.reopenTask({ taskId: task.taskId }).status).toBe("ok");
    await hub.kickTeam();
    expect(deliver).toHaveBeenCalledTimes(1); // 仅 enqueue 时的即时投递尝试
    expect(
      hub.mailboxEntries().find((entry) => entry.sourceAttemptId === attemptId)?.deliveredAccepted,
    ).toBe(false);

    // kickTeam 重臂已让 alice 认领新世代；新世代同文报告去重正常（契约 4 语义照常）
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const fresh = hub.board()!.tasks[0]!;
    expect(fresh.attempt).toBe(2);
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const report = {
      to: "lead",
      message: "report: status",
      sourceTaskId: task.taskId,
      sourceAttemptId: fresh.attemptId ?? "",
    };
    const first = alice.send(report);
    const second = alice.send(report);
    expect(first.status).toBe("success");
    expect(first.status === "success" && second.status === "success" && second.messageId).toBe(
      first.messageId,
    );
  });
});

describe("draft field wire limits (specs/agents-team.md §17 契约 4)", () => {
  it("rejects a draft whose member profile exceeds the wire limit (E15)", () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      leadPermissionMode: "build",
    });
    const result = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftMembers: [{ memberName: "alice", profile: "p".repeat(200) }],
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error.code).toBe("draft_field_too_long");
      expect(result.error.message).toContain("128");
      // 拒绝发生在落库前：投影不得带病（零成员零草案状态被创建）。
      expect(hub.snapshot()).toBeUndefined();
    }
  });
});

describe("abandonStage 归档通知半边（specs/agents-team.md §19 契约 1）", () => {
  it("abandon 成功在 journal archived 后恰发一次 onChange，快照翻 archived；重复 abandon 照现状拒绝且零通知", () => {
    const onChange = vi.fn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      leadPermissionMode: "build",
      onChange,
    });
    // stage 成队路径自带 2 次通知（建队 + 草案物化），基线只记数不锚定具体值。
    expect(hub.stageTeam("lead_s1", STAGE_INPUT).status).toBe("ok");
    const before = onChange.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    const result = hub.abandonStage("lead_s1");
    expect(result.status).toBe("ok");
    // 契约 1 主断言：成功路径恰 +1（此前为 0——零 TeamStateChanged → 零 delta 缺口）。
    expect(onChange).toHaveBeenCalledTimes(before + 1);
    expect(hub.snapshot()?.status).toBe("archived");

    // 归档后草案不可再动（requireLeadRecord 对 archival 一律 team_not_present），
    // 且拒绝路径零通知——通知补齐后正常 UI 流不可达（dock 已随 delta 消失）。
    const again = hub.abandonStage("lead_s1");
    expect(again.status).toBe("rejected");
    if (again.status === "rejected") expect(again.error.code).toBe("team_not_present");
    expect(onChange).toHaveBeenCalledTimes(before + 1);
  });

  it("无队/会话不符的拒绝路径维持零通知（通知只随成功归档）", () => {
    const onChange = vi.fn();
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), onChange });
    // 无队：team_not_present（requireLeadRecord 现状），零通知。
    const missing = hub.abandonStage("lead_s1");
    expect(missing.status).toBe("rejected");
    if (missing.status === "rejected") expect(missing.error.code).toBe("team_not_present");
    expect(onChange).not.toHaveBeenCalled();

    expect(hub.stageTeam("lead_s1", STAGE_INPUT).status).toBe("ok");
    // staged + 会话不符：requireLeadRecord 现状回 team_not_present（非 team_lead_only），
    // 零通知、草案不被归档。
    const baseline = onChange.mock.calls.length;
    const foreign = hub.abandonStage("lead_other");
    expect(foreign.status).toBe("rejected");
    if (foreign.status === "rejected") expect(foreign.error.code).toBe("team_not_present");
    expect(hub.snapshot()?.status).toBe("staged");
    expect(onChange).toHaveBeenCalledTimes(baseline);
  });
});

describe("approveStage 竞态复查（specs/agents-team.md §19 契约 6）", () => {
  it("spawn 期间 status 被并发改写（直调 abandon）→ 整批拒绝 team_lead_only，record 不被翻 active", async () => {
    // 并发写者绕过命令通道直调 port（生产面不可达：v4 命令经 per-session FIFO 串行；
    // 本用例锁的是纵深防御半边——await spawn 期间 status 不再是 staged 时，不得把
    // 已 spawn 的成员身份登记进被改写的 record，也不得无条件翻 active 腐蚀记录）。
    const hijack = vi.fn(async (members: readonly { memberName: string }[]) => {
      const rows = members.map((member) => ({
        memberName: member.memberName,
        agentId: `agent_${member.memberName}`,
        childSessionId: `child_${member.memberName}`,
      }));
      const abandoned = hub.abandonStage("lead_s1");
      expect(abandoned.status).toBe("ok");
      return rows;
    });
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: hijack,
      leadPermissionMode: "build",
    });
    expect(hub.stageTeam("lead_s1", STAGE_INPUT).status).toBe("ok");
    const result = await hub.approveStage("lead_s1");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.error.code).toBe("team_lead_only");
    // 记录保持并发写者的结果（archived），未被 approve 覆写为 active；成员零登记。
    expect(hub.status).toBe("archived");
    expect(hub.snapshot()?.members.every((member) => member.agentId.startsWith("pending_"))).toBe(
      true,
    );
  });
});

// ---------- 2026-10-23 送达翻转通知补齐（留档项「成员邮件 delivered 翻转不通知」）----------

describe("mail delivered flip notifies (2026-10-23 留档项「成员邮件 delivered 翻转不通知」)", () => {
  /**
   * 桥同形最小投影（packages/bootstrap product-projection.ts teamProjectionViewOf）：
   * projectTeam 对 members/tasks 容缺，mailboxTail[].delivered 即 deliveredAccepted
   * 映射（core/src/team/projection.ts mailboxTailEntryOf）——经 wire 投影面断言送达
   * 事实，而非只看内核 entry。
   */
  function projectedTailOf(hub: TeamHub) {
    const roster = hub.snapshot();
    if (roster === undefined) return [];
    return projectTeam({
      teamId: roster.teamId,
      status: roster.status,
      mailbox: hub.mailboxEntries(),
    }).mailboxTail;
  }

  it("① working 成员 steer 异步接受后 onChange 触发、投影尾窗 delivered 翻 true；重复投递边缘零放大", async () => {
    const onChange = vi.fn();
    const prompts: string[] = [];
    let releaseDispatch: ((accepted: boolean) => void) | undefined;
    const dispatch: TeamDispatchFn = (request) =>
      new Promise<boolean>((resolve) => {
        prompts.push(request.prompt);
        releaseDispatch = resolve;
      });
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk(), dispatch, onChange });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    hub.markMemberWorking("bob"); // working → routeMail 即时 steer（fire-and-forget 异步完成）

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "bob", message: "steer notify probe" });
    expect(sent.status === "success" && sent.delivery).toBe("steered");
    // 同步入箱路径按现状已通知（enqueueMail 收尾），但送达未翻转：尾窗仍 delivered=false
    const afterSend = onChange.mock.calls.length;
    expect(afterSend).toBeGreaterThan(0);
    expect(projectedTailOf(hub).at(-1)?.delivered).toBe(false);

    // dispatch 被接受 → 送达翻转；异步完成路径补发通知（本卡主断言：此前为零——
    // routeMail 异步分支只改邮箱不通知，UI 尾窗 delivered 恒滞留 false）
    releaseDispatch?.(true);
    await vi.waitFor(() => expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(true));
    expect(onChange.mock.calls.length).toBeGreaterThan(afterSend);
    expect(projectedTailOf(hub).at(-1)?.delivered).toBe(true);

    // 幂等（spec §16 契约 3「markDelivered 成功后条目退出 pending 集，重复投递调用
    // 零副作用」现状保留）：送达完成后重复投递边缘零新通知零新 dispatch
    const settled = onChange.mock.calls.length;
    await hub.kickTeam();
    await hub.kickTeam();
    expect(onChange.mock.calls.length).toBe(settled);
    expect(prompts).toHaveLength(1);
  });

  it("② terminal 成员复活投递接受后同样补发通知且尾窗翻 true", async () => {
    const onChange = vi.fn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      onChange,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    await hub.handleMemberTerminal("bob"); // 终态成员 → routeMail 走复活投递分支

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const baseline = onChange.mock.calls.length;
    const sent = alice.send({ to: "bob", message: "revival notify probe" });
    expect(sent.status === "success" && sent.delivery).toBe("resumed");
    await vi.waitFor(() => expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(true));
    // 复活投递接受后的送达翻转此前同样零通知（同一缺口），补齐后 onChange 必触发
    expect(onChange.mock.calls.length).toBeGreaterThan(baseline);
    expect(projectedTailOf(hub).at(-1)?.delivered).toBe(true);

    // 幂等：送达后重复边缘零新通知
    const settled = onChange.mock.calls.length;
    await hub.kickTeam();
    expect(onChange.mock.calls.length).toBe(settled);
  });

  it("③ doKickMember steer 接受后 onChange 触发、待决清空推导收敛 idle；重复 kick 零放大", async () => {
    const onChange = vi.fn();
    let accept = false;
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => accept,
      onChange,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    // 全员终态化：内核无 idle 成员态赋值点（成员运行态只有 spawning/working/terminal/
    // removed，hub.ts），本卡要断言「待决清空 → 团队收敛 idle」就必须无 busy 成员
    // （hasWorkingMember 计 spawning/working）。
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");

    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    // routeMail 即时复活投递先拒绝（照租约案② 先例：留 queued），邮件改由 kick 边缘
    // 经 doKickMember 的 steer dispatch 接受——隔离出本卡考察的第三处完成路径
    const sent = alice.send({ to: "bob", message: "kick notify probe" });
    expect(sent.status).toBe("success");
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().at(-1);
      expect(entry?.deliveryClaimedAt).toBeUndefined();
      expect(entry?.deliveredAccepted).toBe(false);
    });
    const baseline = onChange.mock.calls.length;

    accept = true;
    await hub.kickMember("bob");
    expect(onChange.mock.calls.length).toBeGreaterThan(baseline);
    expect(hub.mailboxEntries().at(-1)?.deliveredAccepted).toBe(true);
    expect(projectedTailOf(hub).at(-1)?.delivered).toBe(true);
    // refreshStatus 重算（邮箱待决清空 + 无 working/spawning 成员）→ 团队收敛 idle
    // 而非滞留 active（通知补齐前该重算根本不发生）
    expect(hub.status).toBe("idle");

    // 幂等：已完成的重复 kick 边缘零新通知（§16 契约 3 现状保留）
    const settled = onChange.mock.calls.length;
    await hub.kickMember("bob");
    await hub.kickMember("bob");
    expect(onChange.mock.calls.length).toBe(settled);
  });
});
