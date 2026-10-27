import { describe, expect, it, vi } from "vitest";
import type { TeamStageInput } from "@drora/contracts";
import { TEAM_LIMITS } from "@drora/shared/drora-protocol-v4";
import { TeamHub, type TeamDispatchFn } from "../../src/team/hub.js";
import { replayTeamJournal, type TeamJournalEvent } from "../../src/team/journal.js";
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
  manager: { memberName: "morgana", profile: "team manager" },
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

/** §22 契约 2：to=lead 的合法发件人只剩 manager（roster 首位，spawnOk 记 agent_morgana）。 */
function managerLeadSend(
  hub: TeamHub,
  message: string,
  leadSessionId = "lead_s1",
): { status: string; delivery?: string } {
  const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
  void leadSessionId;
  return morgana.send({ to: "lead", message }) as { status: string; delivery?: string };
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
      manager: { memberName: "morgana", profile: "team manager" },
      draftMembers: [{ memberName: "carol", profile: "solo" }],
      draftTasks: STAGE_INPUT.draftTasks.map((task) =>
        task.assignee === "alice" ? { ...task, assignee: "carol" } : task,
      ),
    });
    expect(second.teamId).toBe(teamId);
    expect(hub.snapshot()?.members).toHaveLength(2);
    expect(hub.status).toBe("staged");
    expect(spawn).not.toHaveBeenCalled();

    const approve = await hub.approveStage("lead_s1");
    expect(approve.status).toBe("ok");
    expect(approve.spawnedMembers).toEqual(["morgana", "carol"]);
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
      manager: { memberName: "morgana", profile: "team manager" },
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
        manager: { memberName: "morgana", profile: "team manager" },
        draftMembers: [
          { memberName: "alice", profile: "" },
          { memberName: "bob", profile: "   " },
        ],
        draftTasks: [],
      }).status,
    ).toBe("ok");
    for (const member of hub.snapshot()?.members ?? []) {
      // manager 自带合法 profile（§22 首位）；归一断言只对空白入参的执行成员。
      if (member.memberName === "morgana") continue;
      expect("profile" in member).toBe(false);
    }
    const stagedFact = journal.find((event) => event.payload.kind === "staged") as {
      payload: { members: { profile?: string }[] };
    };
    expect(stagedFact).toBeDefined();
    for (const member of stagedFact.payload.members) {
      if (member.memberName === "morgana") continue;
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
        manager: { memberName: "morgana", profile: "team manager" },
        draftMembers: [
          {
            memberName: "alice",
            modelSelection: { provider: "provider-a", model: "model-a", thought: "   " },
          },
        ],
        draftTasks: [],
      }).status,
    ).toBe("ok");
    // §22：roster 首位是 manager——alice 断言下标移至 [1]（manager 无 modelSelection）。
    const selection = hub.snapshot()?.members[1]?.modelSelection;
    expect("thought" in (selection ?? {})).toBe(false);
    expect(selection).toEqual({ provider: "provider-a", model: "model-a" });
    const stagedFact = journal.find((event) => event.payload.kind === "staged") as {
      payload: { members: { modelSelection?: { thought?: string } }[] };
    };
    expect(stagedFact).toBeDefined();
    expect(stagedFact.payload.members[1]?.modelSelection).toEqual({
      provider: "provider-a",
      model: "model-a",
    });
  });

  it("非空白 profile 原样保留；profile 缺省（optional）照常合法落库", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    expect(
      hub.stageTeam("lead_s1", {
        manager: { memberName: "morgana", profile: "team manager" },
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
    // 中断全员（alice=working；bob/morgana=spawning 同样在列，§22 manager 同为成员
    // 参与中断），成员终态边缘在冻结期内消费。
    await vi.waitFor(() => expect(settleCalls.length).toBe(3));
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

    // 两名成员都终态（结算完成）→ 空板对终态判定空真：2026-10-27 H1 修复后终报
    // 派发在此边缘可达（修复前 maybeDispatchFinalReport 是死代码）——manager 指令
    // 邮件先入箱（待决使 active），经 kick 复活链送达后待决清空 → 收敛 idle。
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");
    await vi.waitFor(() => {
      const directive = hub
        .mailboxEntries()
        .find((entry) => entry.from === "lead" && entry.to === "morgana");
      expect(directive?.deliveredAccepted).toBe(true);
    });
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
    // 2026-10-27 M9（决策 D1，裁定 3）：转派 actor 收敛 manager——原 lead.reassign
    // 调用点全部换 manager 端口（三步交接语义不变，actor 门见新增 actor 三分用例）。
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, lead, manager, task: task!, settleCalls };
  }

  it("revokes the old attempt, waits for quiescence, and the new owner claims a fresh generation", async () => {
    const { hub, manager, task, settleCalls } = await prepare();
    const oldAttemptId = task.attemptId;
    const result = await manager.reassign({
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
    const { hub, manager, task } = await prepare();
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
    const result = await manager.reassign({ taskId: task.taskId, to: "bob", reason: "first" });
    expect(result.status).toBe("rejected"); // 再入校验失败：新者胜，拒绝覆盖
  });

  it("lead takeover is direct in_progress, unique, and returns to the pool on the lead idle edge", async () => {
    const { hub, lead, manager, task } = await prepare();
    // L7 登记：to=lead 接管分支保留（§22 后 manager 可把执行任务派给 lead）。
    const taken = await manager.reassign({ taskId: task.taskId, to: "lead", reason: "taking over" });
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
    const second = await manager.reassign({
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
      manager: { memberName: "morgana" },
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
      manager: { memberName: "morgana", profile: "team manager" },
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [
        { taskId: "t_x", title: "t1", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
        { taskId: "t_x", title: "t2", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
      ],
    });
    expect(duplicate.status).toBe("rejected");
    expect(duplicate.error?.code).toBe("draft_duplicate_task");
    const empty = hub.stageTeam("lead_s1", {
      manager: { memberName: "morgana", profile: "team manager" },
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
      manager: { memberName: "morgana", profile: "team manager" },
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
      manager: { memberName: "morgana", profile: "team manager" },
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
      manager: { memberName: "morgana", profile: "team manager" },
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
    const sent = managerLeadSend(hub, "report to lead");
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
    managerLeadSend(hub, "first report");
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
    // §22 契约 2：失败通知投 manager（中间管理事件；legacy lead 收件已随架构废除）
    const leadMail = hub.mailboxEntries().filter((entry) => entry.to === "morgana");
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
    // M9：转派 actor = manager（原 lead.reassign 调用点换 manager 端口）。
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
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
    const reassign = await manager.reassign({
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
    // §22 契约 2：失败通知（noted）投 manager——同 ① 用例口径。
    const leadMail = hub.mailboxEntries().filter((entry) => entry.to === "morgana");
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
    managerLeadSend(hub, "lead batch probe");
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
    // M9：转派 actor = manager（原 lead.reassign 调用点换 manager 端口）。
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await hub.kickMember("alice");
    const task = hub.board()?.tasks.find((candidate) => candidate.title === "work");
    return { hub, lead, manager, task: task! };
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
    const { hub, manager, task } = await prepare();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const first = alice.send({ to: "bob", message: "heads up", targetTaskId: task.taskId });
    expect(first.status).toBe("success");

    // 转派轮换世代：条目快照的 targetAttemptId 失配 → 旧条目已不 isCurrentMail，
    // 去重谓词不命中 → 同文重发正常入箱（spec §16 契约 4 不变量）。
    const rotated = await manager.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
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
    const { hub, manager, task } = await prepare();
    const staleAttemptId = task.attemptId ?? "";
    const rotated = await manager.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
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
    const { hub, manager, task } = await prepare();
    const rotated = await manager.reassign({ taskId: task.taskId, to: "bob", reason: "rotate" });
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

    // §22 契约 2：to=lead 由 manager 发（alice 口径已被 portSend 改向；终态源剥离
    // 断言对 manager 口径同样成立——sourceTaskId 引用与剥离逻辑与发送者无关）。
    const sent = managerLeadSend(hub, "report: survey done");
    expect(sent.status).toBe("success");

    // 入箱 entry 剥离 sourceAttemptId（保留 sourceTaskId 展示引用；模型报告恒无
    // sourceTaskStatus）——无绑定邮件不再受 isCurrentMail 第一谓词世代过滤。
    expect(hub.mailboxEntries()).toHaveLength(1);
    const entry = hub.mailboxEntries()[0]!;
    expect(entry.sourceAttemptId).toBeUndefined();
    // manager 口径无 source 载荷（§22）；终态源剥离的 source 断言保留在 alice→manager
    // 口径的姊妹用例（同 describe 组内）。
    expect(entry.sourceTaskId).toBeUndefined();
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

  it("③ after final-report delivery the team reaches its finale and the lead mailbox stays closed to a re-sent report (§22 契约 3 + 2026-10-27 M12)", async () => {
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
    // §22：to=lead 唯一入口是 manager——第一条 manager→lead 注入即终报送达。
    const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const first = morgana.send({ ...report, to: "lead" });
    expect(first.status).toBe("success");
    await vi.waitFor(() => expect(hub.mailboxEntries()[0]?.deliveredAccepted).toBe(true));

    // 2026-10-27 M12（决策 D3）改写旧断言「已投递后重发允许新条目」：to=lead 通道的
    // 「有意重复提醒」被 §22 契约 3 防多报 + 终局收口取代——终报送达即 completed，
    // 归档态关闭全部端口，重发被拒、不再产生 M5 登记的永久 queued 死信；成员间提醒
    // 通道（deliberate reminder）不受影响，见 ② 用例。
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    const second = morgana.send({ ...report, to: "lead" });
    expect(second.status).toBe("failed");
    expect(second.status === "failed" && second.error.code).toBe("member_removed");
    expect(hub.mailboxEntries()).toHaveLength(1);
  });
});

// ---------- spec §16 契约 5（2026-10-23 登记）：任务终态恢复预算——manager 显式重开 ----------
// 2026-10-27 M15（决策 D8）：重开 actor 随 §22 裁定 3 归 manager（memberPort.reopen /
// TeamReopen 工具）；原 leadPort.reopenTask lead 专属面有实现无生产入口，已从
// TeamLeadPort 移除。以下用例的 actor 从 lead 全部换 manager，重开语义本身不变。

describe("manager task reopen (spec §16 契约 5, failed→pending controlled edge; M15)", () => {
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

  it("① reopen is manager-only (M15/D8): lead sessions and plain members are rejected; the member update path cannot pull failed back to pending", async () => {
    const { hub, task, attemptId } = await prepareWithFailedTask();

    // M9/D1：lead 会话（含本队 lead）不再是管理 actor——isTeamActor 仅认 manager agentId
    const ownLead = hub.leadPort("lead_s1").reopen({ taskId: task.taskId });
    expect(ownLead.status).toBe("rejected");
    expect(ownLead.status === "rejected" && ownLead.error.code).toBe("team_lead_only");
    const foreign = hub.leadPort("lead_other").reopen({ taskId: task.taskId });
    expect(foreign.status).toBe("rejected");
    expect(foreign.status === "rejected" && foreign.error.code).toBe("team_lead_only");

    // 普通成员 child 同拒（manager 专属管理动作）
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const viaReopen = alice.reopen({ taskId: task.taskId });
    expect(viaReopen.status).toBe("rejected");
    expect(viaReopen.status === "rejected" && viaReopen.error.code).toBe("team_lead_only");
    expect(hub.board()!.tasks[0]!.status).toBe("failed");

    // 经 taskUpdate 携旧代凭证把 failed 拉回 pending → 通用更新面整次拒绝
    //（契约 5 wasTerminal 守卫）
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

  it("② the manager reopens the failed task: shared-pool pending with evidence cleared, journal fact, and redispatch claims a continued attempt", async () => {
    const journal: JournalRow[] = [];
    const { hub, task, attemptId } = await prepareWithFailedTask(journal);
    const failed = hub.board()!.tasks[0]!;
    expect(failed.output).toContain("replacement task"); // 契约 1 失败通知在 output（重开将清空）
    expect(failed.output).toContain("TeamReopen"); // M15：失败通知改指 manager 的 TeamReopen 通道

    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const reopened = manager.reopen({ taskId: task.taskId });
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
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });

    const unknown = manager.reopen({ taskId: "task_missing" });
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
    const openReopen = manager.reopen({ taskId: live.taskId });
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
    const completedReopen = manager.reopen({ taskId: live.taskId });
    expect(completedReopen.status === "rejected" && completedReopen.error.code).toBe(
      "invalid_transition",
    );
    const completedReassign = await manager.reassign({
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
    const cancelledReopen = manager.reopen({ taskId: dropped.taskId });
    expect(cancelledReopen.status === "rejected" && cancelledReopen.error.code).toBe(
      "invalid_transition",
    );

    // failed 任务：reassign 仍拒终态（契约 5 不动 reassign 语义）；lead 自身的通用
    // taskUpdate 同样不能消费受控出边（team_lead_only）——唯一通道是 manager 的 reopen
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
    const failedReassign = await manager.reassign({
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
    const haltedReopen = manager.reopen({ taskId: doomed.taskId });
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

    // manager reopen：recoveryRetried 重置 + parked 残留清理（failed_attempt 先例同族）
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    expect(manager.reopen({ taskId: hub.board()!.tasks[0]!.taskId }).status).toBe("ok");
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
    // §22 契约 2：失败通知投 manager（中间管理事件）；lead 通道零调用。
    expect(deliver).not.toHaveBeenCalled();
    const notice = hub.mailboxEntries().find((entry) => entry.sourceAttemptId === attemptId);
    expect(notice?.deliveredAccepted).toBe(false);

    // 重开：旧世代 attemptId 失配 → isCurrentMail 失活，重投边缘不再投旧通知
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    expect(manager.reopen({ taskId: task.taskId }).status).toBe("ok");
    await hub.kickTeam();
    // §22：失败通知走成员通道（manager 收件），lead 通道（deliver mock）全程零调用。
    expect(deliver).not.toHaveBeenCalled();
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
      manager: { memberName: "morgana", profile: "team manager" },
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

describe("approveStage 批准时刻权限覆写（specs/agents-team.md §10 增补三）", () => {
  it("options.permissionMode 覆写 record 并随 spawn 下发；缺省维持建队捕获值", async () => {
    // 缺省：维持捕获值 build，spawn 第二参仍为 build。
    const spawnA = spawnOk();
    const hubA = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnA,
      leadPermissionMode: "build",
    });
    hubA.stageTeam("lead_s1", STAGE_INPUT);
    const kept = await hubA.approveStage("lead_s1");
    expect(kept.status).toBe("ok");
    expect(hubA.snapshot()?.permissionMode).toBe("build");
    expect(spawnA.mock.calls[0]?.[1]).toBe("build");
    // 覆写：yolo 批准时刻定死并随 spawn 下发。
    const spawnB = spawnOk();
    const hubB = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnB,
      leadPermissionMode: "build",
    });
    hubB.stageTeam("lead_s1", STAGE_INPUT);
    const result = await hubB.approveStage("lead_s1", { permissionMode: "yolo" });
    expect(result.status).toBe("ok");
    expect(hubB.snapshot()?.permissionMode).toBe("yolo");
    expect(spawnB.mock.calls[0]?.[1]).toBe("yolo");
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
    // 2026-10-27 H1：空板 + workers 全终态同样触发终报派发（§22 契约 3 终态判定对
    // 空板空真）——manager 指令邮件与本用例的 bob 探针同处待决（首次 kick 已随
    // accept=false 被拒释放）。补 kick manager 送达指令后，「邮箱待决清空 → 团队
    // 收敛 idle」的重算断言照旧成立（通知补齐前该重算根本不发生）。
    await hub.kickMember("morgana");
    expect(hub.status).toBe("idle");

    // 幂等：已完成的重复 kick 边缘零新通知（§16 契约 3 现状保留）
    const settled = onChange.mock.calls.length;
    await hub.kickMember("bob");
    await hub.kickMember("bob");
    expect(onChange.mock.calls.length).toBe(settled);
  });
});

// ---------- 2026-10-27 §22 契约 3 终报链修复批（第五轮审查 H1/M3/M5/M6/M7/M11/M12/L5）----------

describe("final report chain (§22 契约 3, 2026-10-27 修复批)", () => {
  interface JournalRow {
    payload: {
      kind: string;
      messageIds?: readonly string[];
      reason?: string;
      entry?: TeamMailboxEntry;
    };
  }

  /** 单任务草案：alice 执行、bob 闲置、morgana 管理（spawnOk 记 agent_ 前缀）。 */
  const ONE_TASK_STAGE: TeamStageInput = {
    name: "finale",
    manager: { memberName: "morgana", profile: "team manager" },
    draftMembers: [
      { memberName: "alice", profile: "researcher" },
      { memberName: "bob", profile: "implementer" },
    ],
    draftTasks: [
      {
        title: "only",
        spec: { goal: "g", acceptance: ["a"] },
        dependsOn: [],
        assignee: "alice",
      },
    ],
  };

  async function prepareFinaleTeam() {
    const journal: JournalRow[] = [];
    const dispatch = vi.fn(async () => true);
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch,
      deliverLeadMail: deliver,
      journalWriter: (event) => journal.push(event as never),
    });
    hub.stageTeam("lead_s1", ONE_TASK_STAGE);
    await hub.approveStage("lead_s1");
    return { hub, journal, dispatch, deliver };
  }

  function onlyTaskId(hub: TeamHub): string {
    return hub.board()!.tasks[0]!.taskId;
  }

  /** alice 经成员端口把唯一任务推到终态（claimed→in_progress→final；cancelled 可自 claimed 直达）。 */
  function finishTask(
    hub: TeamHub,
    final: "completed" | "failed" | "cancelled",
  ): void {
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const claim = alice.taskClaim(onlyTaskId(hub));
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    if (final !== "cancelled") {
      expect(
        alice.taskUpdate({
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          patch: { status: "in_progress" },
        }).status,
      ).toBe("ok");
    }
    expect(
      alice.taskUpdate({
        taskId: claim.taskId,
        attemptId: claim.attemptId,
        patch: { status: final },
      }).status,
    ).toBe("ok");
  }

  /** workers 全终态——最后一个终态边缘触发 refreshStatus 的 idle → 终报派发（H1）。 */
  async function settleWorkers(hub: TeamHub): Promise<void> {
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");
  }

  function directiveOf(hub: TeamHub): TeamMailboxEntry | undefined {
    return hub
      .mailboxEntries()
      .find((entry) => entry.from === "lead" && entry.to === "morgana");
  }

  const kinds = (journal: JournalRow[], kind: string): JournalRow[] =>
    journal.filter((row) => row.payload.kind === kind);

  it("H1: terminal idle edge dispatches the manager directive exactly once; a second terminal edge does not re-dispatch; delivery completes the team (M12)", async () => {
    const { hub, journal } = await prepareFinaleTeam();
    finishTask(hub, "completed");
    await settleWorkers(hub);

    // 修复前死代码：refreshStatus 只在 idle 边缘调用而派发门恒要求 active——两条
    // 路径均不可达、final_report_dispatched 永不落。现在 idle 且终态即派发。
    const directive = directiveOf(hub);
    expect(directive).toBeDefined();
    expect(directive?.message).toContain("Write ONE final report");
    expect(kinds(journal, "final_report_dispatched")).toHaveLength(1);
    // 指令经 kick 复活链送达 manager（dispatch mock 接受）。
    await vi.waitFor(() => {
      const settled = directiveOf(hub);
      expect(settled?.messageId).toBe(directive?.messageId);
      expect(settled?.deliveredAccepted).toBe(true);
    });

    // 幂等：二次终态边缘不重派（dispatchedFlag 门）——事实与指令邮件均不重复。
    await hub.handleMemberTerminal("alice");
    expect(kinds(journal, "final_report_dispatched")).toHaveLength(1);
    expect(
      hub.mailboxEntries().filter((entry) => entry.from === "lead" && entry.to === "morgana"),
    ).toHaveLength(1);

    // manager 执笔终报 → lead 注入 → delivered 事实恰一条 + 终局 completed（M12）。
    const sent = managerLeadSend(hub, "final: all tasks completed");
    expect(sent.status).toBe("success");
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
  });

  it("H1 fallback + L5: manager unavailable routes the structured fallback with BOTH facts (dispatched + delivered) and completes the team", async () => {
    const { hub, journal } = await prepareFinaleTeam();
    expect(hub.removeMember("morgana").status).toBe("ok");
    finishTask(hub, "completed");
    await settleWorkers(hub);

    // 兜底路径两事实齐落（L5：此前缺 final_report_dispatched，journal 流无法区分路径）。
    await vi.waitFor(() => {
      expect(kinds(journal, "final_report_dispatched")).toHaveLength(1);
      expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
    });
    const fallback = hub.mailboxEntries().find((entry) => entry.to === "lead");
    expect(fallback?.message).toContain("only: completed");
    await vi.waitFor(() => {
      const settled = hub
        .mailboxEntries()
        .find((entry) => entry.messageId === fallback?.messageId);
      expect(settled?.deliveredAccepted).toBe(true);
      expect(settled?.deliveredVia).toBe("lead_injected");
    });
    expect(hub.status).toBe("completed");
  });

  it("M11: a team whose only task ended failed still dispatches the final report (board TERMINAL_STATUSES alignment)", async () => {
    const { hub, journal } = await prepareFinaleTeam();
    finishTask(hub, "failed");
    await settleWorkers(hub);
    // 修复前 failed 被按开放计（只认 completed/cancelled）——全 failed 收尾的团队
    // 永不终报。指令邮件随行失败结论。
    const directive = directiveOf(hub);
    expect(directive).toBeDefined();
    expect(directive?.message).toContain("only: failed");
    expect(kinds(journal, "final_report_dispatched")).toHaveLength(1);
  });

  it("M12: an all-cancelled finale derives status cancelled after the report is delivered", async () => {
    const { hub, journal } = await prepareFinaleTeam();
    finishTask(hub, "cancelled");
    await settleWorkers(hub);
    await vi.waitFor(() => expect(directiveOf(hub)).toBeDefined());
    expect(managerLeadSend(hub, "final: everything cancelled").status).toBe("success");
    // 全任务 cancelled 且无 completed → cancelled（其余终局分布一律 completed）。
    await vi.waitFor(() => expect(hub.status).toBe("cancelled"));
    expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
  });

  it("M5: member→lead is unconditionally rerouted to the manager; after the finale the member port is closed (no permanent queued dead letter)", async () => {
    const { hub } = await prepareFinaleTeam();
    finishTask(hub, "completed");
    await settleWorkers(hub);
    await vi.waitFor(() => expect(directiveOf(hub)).toBeDefined());

    // 终报周期进行中（dispatched 已落、未 delivered）：成员发 to=lead 仍一律改投
    // manager（契约 2 无条件表述；修复前条件含 !finalReportDelivered()）。
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "lead", message: "worker summary for the manager" });
    expect(sent.status).toBe("success");
    const entry = hub
      .mailboxEntries()
      .find((row) => row.message === "worker summary for the manager");
    expect(entry?.to).toBe("morgana");

    // 终报送达即终局（M12）：归档态关闭成员端口——M5 登记的「送达后成员→lead 死信
    // 钉死 active」入口结构性消失（离册 manager 的同类死信由 M3 死信化承接）。
    expect(managerLeadSend(hub, "final report").status).toBe("success");
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    const after = alice.send({ to: "lead", message: "another lead attempt" });
    expect(after.status).toBe("failed");
  });

  it("M3: member→lead with the manager removed is dead-lettered (message_dropped) and the team still reaches its finale", async () => {
    const { hub, journal } = await prepareFinaleTeam();
    expect(hub.removeMember("morgana").status).toBe("ok");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "lead", message: "late report to the lead" });
    // M5 改投（record.managerName 仍在、人已离册）→ routeMail 判定收件人离册 →
    // §21 A1 同族死信：message_dropped 事实 + 条目退出邮箱（修复前恒 queued、
    // busy 把死信计入，团队被钉死 active）。
    expect(sent.status).toBe("success");
    expect(sent.status === "success" && sent.delivery).toBe("queued");
    const dropped = kinds(journal, "message_dropped").find(
      (row) => row.payload.reason === "recipient no longer on the team",
    );
    expect(dropped?.payload.messageIds).toEqual(
      sent.status === "success" ? [sent.messageId] : [],
    );
    expect(hub.mailboxEntries().some((entry) => entry.to === "morgana")).toBe(false);

    // 死信不钉死收尾：任务终态 + workers 终态 → idle 边缘可达 → 兜底终报 → 终局。
    finishTask(hub, "completed");
    await settleWorkers(hub);
    expect(hub.status).toBe("completed");
  });

  it("M3 busy filter: mail queued to a LATER-removed manager stays in the mailbox but no longer pins the team active", async () => {
    const { hub } = await prepareFinaleTeam();
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    // manager 在册：改投条目入箱（morgana 处 spawning 态，routeMail 排队等待）。
    expect(alice.send({ to: "lead", message: "intermediate report" }).status).toBe("success");
    expect(hub.mailboxEntries().some((entry) => entry.to === "morgana")).toBe(true);
    // manager 随后被移除：routeMail 不重跑、条目留在邮箱，但 busy 谓词按收件人在册
    // 过滤（修复前恒 isCurrentMail → 永久 active，idle 边缘与终报均不可达）。
    expect(hub.removeMember("morgana").status).toBe("ok");
    finishTask(hub, "completed");
    await settleWorkers(hub);
    // idle 边缘同步推进到兜底终报终局（修复前此处被钉死 active）。
    expect(hub.status).toBe("completed");
    expect(hub.mailboxEntries().some((entry) => entry.to === "morgana")).toBe(true); // 条目如实保留，只是不再计入 busy
  });

  // ---------- M6/M7：闭箱过滤与冷恢复重臂（经手写事实流重放构造恢复态）----------

  const FINALE_AT = "2026-10-27T00:00:00.000Z";

  function finaleMail(
    messageId: string,
    from: string,
    to: string,
    message: string,
  ): TeamMailboxEntry {
    return { messageId, from, to, message, at: FINALE_AT, deliveredAccepted: false };
  }

  /** 终态团队基线事实流：创建→草案→审批→三成员出生→唯一任务 completed（seq 1-7）。 */
  function finaleBaseEvents(): TeamJournalEvent[] {
    const taskFact = {
      taskId: "t_only",
      title: "only",
      spec: { goal: "g", acceptance: ["a"] },
      attempt: 1,
      dependsOn: [],
      artifactRefs: [],
      createdAt: FINALE_AT,
      updatedAt: FINALE_AT,
    };
    const memberAdded = (seq: number, memberName: string): TeamJournalEvent => ({
      seq,
      at: FINALE_AT,
      payload: {
        kind: "member_added",
        teamId: "team_finale",
        memberName,
        agentId: `agent_${memberName}`,
        childSessionId: `child_${memberName}`,
      },
    });
    return [
      {
        seq: 1,
        at: FINALE_AT,
        payload: {
          kind: "team_created",
          teamId: "team_finale",
          leadSessionId: "lead_s1",
          managerName: "morgana",
          createdAt: FINALE_AT,
        },
      },
      {
        seq: 2,
        at: FINALE_AT,
        payload: {
          kind: "staged",
          teamId: "team_finale",
          managerName: "morgana",
          awaitingFeedback: false,
          members: [{ memberName: "morgana" }, { memberName: "alice" }, { memberName: "bob" }],
          tasks: [{ ...taskFact, status: "pending" as const, attempt: 0 }],
        },
      },
      { seq: 3, at: FINALE_AT, payload: { kind: "approved", teamId: "team_finale" } },
      memberAdded(4, "morgana"),
      memberAdded(5, "alice"),
      memberAdded(6, "bob"),
      {
        seq: 7,
        at: FINALE_AT,
        payload: {
          kind: "task_updated",
          teamId: "team_finale",
          task: { ...taskFact, status: "completed" as const },
        },
      },
    ];
  }

  const appendedFact = (seq: number, entry: TeamMailboxEntry): TeamJournalEvent => ({
    seq,
    at: FINALE_AT,
    payload: { kind: "message_appended", teamId: "team_finale", entry },
  });
  const dispatchedFact = (seq: number): TeamJournalEvent => ({
    seq,
    at: FINALE_AT,
    payload: { kind: "final_report_dispatched", teamId: "team_finale" },
  });
  const deliveredFact = (seq: number): TeamJournalEvent => ({
    seq,
    at: FINALE_AT,
    payload: { kind: "final_report_delivered", teamId: "team_finale" },
  });
  const removedFact = (seq: number, memberName: string): TeamJournalEvent => ({
    seq,
    at: FINALE_AT,
    payload: { kind: "member_removed", teamId: "team_finale", memberName },
  });

  function restoredHub(journal: JournalRow[], deliver: ReturnType<typeof vi.fn>) {
    const hub = new TeamHub({
      clock: makeClock(),
      dispatch: vi.fn(async () => true),
      deliverLeadMail: deliver,
      journalWriter: (event) => journal.push(event as never),
    });
    return hub;
  }

  it("M6: after final-report delivery the batch channel dead-letters a second manager report and reroutes a member's late lead mail to the manager", async () => {
    const report1 = finaleMail("m_report_1", "morgana", "lead", "final report");
    const report2 = finaleMail(
      "m_report_2",
      "morgana",
      "lead",
      "second report (multi-report attempt)",
    );
    const lateMember = finaleMail("m_late", "alice", "lead", "late member mail");
    const events: TeamJournalEvent[] = [
      ...finaleBaseEvents(),
      appendedFact(8, report1),
      {
        seq: 9,
        at: FINALE_AT,
        payload: {
          kind: "message_delivered",
          teamId: "team_finale",
          messageIds: ["m_report_1"],
          via: "lead_injected",
          at: FINALE_AT,
        },
      },
      dispatchedFact(10),
      appendedFact(11, report2),
      appendedFact(12, lateMember),
      deliveredFact(13),
    ];
    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    // M12 重放推导：送达事实 + 任务分布 → completed；闭箱过滤仍须可达（M6 过滤
    // 先于归档门执行——死信清理不是投递）。
    expect(record!.status).toBe("completed");

    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    expect(hub.adoptRestored(record!)).toBe(true);

    await hub.deliverPendingLeadMail();
    // 批量通道不再向 lead 注入第二条终报/成员迟到信：deliver 零调用。
    expect(deliver).not.toHaveBeenCalled();
    const droppedIds = kinds(journal, "message_dropped").flatMap((row) => [
      ...(row.payload.messageIds ?? []),
    ]);
    expect(droppedIds).toContain("m_report_2"); // manager 第二条汇报 → 死信（防多报）
    expect(hub.mailboxEntries().some((entry) => entry.messageId === "m_report_2")).toBe(false);
    // 成员迟到信 → 改投 manager：旧 id 死信 + 新 id 入册两事实（重放同形）。
    expect(droppedIds).toContain("m_late");
    const rerouted = hub
      .mailboxEntries()
      .find((entry) => entry.messageId !== "m_report_1" && entry.to === "morgana");
    expect(rerouted).toBeDefined();
    expect(rerouted?.message).toBe("late member mail");
    expect(
      kinds(journal, "message_appended").some(
        (row) => row.payload.entry?.messageId === rerouted?.messageId,
      ),
    ).toBe(true);
  });

  it("M7 arm (a): a restored terminal team whose dispatched fact was lost re-dispatches on adoption; the lead receives exactly one report", async () => {
    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    // 事实流终态但缺 final_report_dispatched（journal 刷盘半持久窗口）：
    // 修复前恢复后无人再派发，「恰一条」退化为「零条」。
    const { record } = replayTeamJournal(finaleBaseEvents());
    expect(hub.adoptRestored(record!)).toBe(true);
    await vi.waitFor(() => expect(kinds(journal, "final_report_dispatched")).toHaveLength(1));
    expect(directiveOf(hub)).toBeDefined();
    // manager 执笔（模拟 child 会话端口）→ 恰一条送达 + 终局。
    const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const sent = morgana.send({ to: "lead", message: "final report after restore" });
    expect(sent.status).toBe("success");
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
    // lead 通道恰一次注入（恰一条）。
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      deliver.mock.calls[0]?.[0]?.entries.map((entry: TeamMailboxEntry) => entry.message),
    ).toEqual(["final report after restore"]);
  });

  it("M7 arm (b): dispatched-but-undelivered with only the directive mail kicks the manager to produce exactly one report", async () => {
    const directive = finaleMail("reportreq_1", "lead", "morgana", "Write ONE final report...");
    const events: TeamJournalEvent[] = [
      ...finaleBaseEvents(),
      appendedFact(8, directive),
      dispatchedFact(9),
    ];
    const { record } = replayTeamJournal(events);
    // 指令邮件未投 → busy 推导 active（恢复臂仍可达）。
    expect(record!.status).toBe("active");
    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    expect(hub.adoptRestored(record!)).toBe(true);
    // 恢复臂 (b)：kick manager 令其产出——指令经 kick 送达。
    await vi.waitFor(() => {
      expect(
        hub.mailboxEntries().find((entry) => entry.messageId === "reportreq_1")?.deliveredAccepted,
      ).toBe(true);
    });
    const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const sent = morgana.send({ to: "lead", message: "final report (directive seam)" });
    expect(sent.status).toBe("success");
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("M7 arm (b): a queued to=lead final report entry is delivered through the existing lead channel after restore", async () => {
    const directive = finaleMail("reportreq_1", "lead", "morgana", "Write ONE final report...");
    const report = finaleMail(
      "m_final",
      "morgana",
      "lead",
      "final report (crashed before injection)",
    );
    const events: TeamJournalEvent[] = [
      ...finaleBaseEvents(),
      appendedFact(8, directive),
      dispatchedFact(9),
      appendedFact(10, report),
    ];
    const { record } = replayTeamJournal(events);
    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    expect(hub.adoptRestored(record!)).toBe(true);
    // 恢复臂 (b) 优先补投 lead：既有 deliverPendingLeadMail 通道注入恰一条。
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(
      deliver.mock.calls[0]?.[0]?.entries.map((entry: TeamMailboxEntry) => entry.messageId),
    ).toEqual(["m_final"]);
    expect(kinds(journal, "final_report_delivered")).toHaveLength(1);
  });

  it("M7 arm (b): manager unavailable after dispatch falls back to the structured direct report", async () => {
    const directive = finaleMail("reportreq_1", "lead", "morgana", "Write ONE final report...");
    const events: TeamJournalEvent[] = [
      ...finaleBaseEvents(),
      removedFact(8, "morgana"),
      appendedFact(9, directive),
      dispatchedFact(10),
    ];
    const { record } = replayTeamJournal(events);
    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    expect(hub.adoptRestored(record!)).toBe(true);
    // 恢复臂 (b) 收敛：manager 离册 → 兜底直投（恰一条）。
    const fallback = hub.mailboxEntries().find((entry) => entry.to === "lead");
    expect(fallback?.message).toContain("only: completed");
    await vi.waitFor(() => expect(kinds(journal, "final_report_delivered")).toHaveLength(1));
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
  });

  it("legacy restored team without a manager never auto-dispatches a final report nor flips the finale status (评审阻断项回归锁)", async () => {
    // §22 之前的无 manager 事实流：终报链（派发门/恢复臂/终局翻转）以 manager 架构
    // 为界——空板 + workers 全终态对 isTeamTerminal 空真也不触发派发，lead 邮箱走
    // 缺口12 普通通道、端口保持开放（install-runtime ⑤⑪⑫②⑩ 回归实证的锁）。
    const AT = "2026-10-27T00:00:00.000Z";
    const legacyAdded = (seq: number, memberName: string): TeamJournalEvent => ({
      seq,
      at: AT,
      payload: {
        kind: "member_added",
        teamId: "team_legacy",
        memberName,
        agentId: `agent_${memberName}`,
        childSessionId: `child_${memberName}`,
      },
    });
    const events: TeamJournalEvent[] = [
      {
        seq: 1,
        at: AT,
        payload: {
          kind: "team_created",
          teamId: "team_legacy",
          leadSessionId: "lead_s1",
          createdAt: AT,
        },
      },
      {
        seq: 2,
        at: AT,
        payload: {
          kind: "staged",
          teamId: "team_legacy",
          awaitingFeedback: false,
          members: [{ memberName: "alice" }, { memberName: "bob" }],
          tasks: [],
        },
      },
      { seq: 3, at: AT, payload: { kind: "approved", teamId: "team_legacy" } },
      legacyAdded(4, "alice"),
      legacyAdded(5, "bob"),
    ];
    const { record } = replayTeamJournal(events);
    expect(record!.managerName).toBeUndefined();
    const journal: JournalRow[] = [];
    const deliver = vi.fn(acceptAllLeadMail());
    const hub = restoredHub(journal, deliver);
    expect(hub.adoptRestored(record!)).toBe(true);
    // 恢复臂与派发门均不触发：零终报事实、状态维持可推导族（idle）、端口开放。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(kinds(journal, "final_report_dispatched")).toHaveLength(0);
    expect(hub.status).toBe("idle");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const sent = alice.send({ to: "lead", message: "legacy lead mail" });
    expect(sent.status).toBe("success");
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().find((row) => row.message === "legacy lead mail");
      expect(entry?.deliveredAccepted).toBe(true);
      expect(entry?.deliveredVia).toBe("lead_injected");
    });
    // legacy 注入不触发终局翻转（markFinalReportDelivered 以 manager 队伍为界）。
    expect(hub.status).toBe("idle");
    expect(kinds(journal, "final_report_delivered")).toHaveLength(0);
  });
});

// ---------- 2026-10-27 core 语义批（agents-team 第五轮全面修复 A2）----------
// 覆盖：M2/L11（再入库 managerName 刷新与 name 保留）、L2（manager↔成员重名次序防护）、
// L10（manager 草案限额/空白名）、M4（assignee=manager 任务视同可认领）、L7（reassign
// 目标忙闲校验）、M9（管理 actor 三分）、M8/L9（批准覆写权限入 approved 事实，经 port）。

describe("staged re-entry refreshes managerName and preserves the team name (M2/L11, 决策 D11)", () => {
  it("M2: 修订轮换 manager 名后 snapshot/路由改向/管理 actor 均用新名（journalStagedFact 随行）", async () => {
    const journal: { payload: { kind: string; managerName?: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      leadPermissionMode: "build",
      journalWriter: (event) => journal.push(event as never),
    });
    expect(hub.stageTeam("lead_s1", { ...STAGE_INPUT, draftTasks: [] }).status).toBe("ok");
    expect(hub.snapshot()?.managerName).toBe("morgana");

    // 再入库换 manager 名（M2 修复前 record.managerName 不刷新——旧名成幽灵管理者：
    // 邮件改投不存在成员、真 manager 被 team_lead_only 拒）
    const revised = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      manager: { memberName: "merlin", profile: "team manager" },
      draftTasks: [
        { title: "t2", spec: { goal: "g2", acceptance: ["a"] }, dependsOn: [], assignee: "merlin" },
      ],
    });
    expect(revised.status).toBe("ok");
    expect(hub.snapshot()?.managerName).toBe("merlin");
    expect(hub.snapshot()?.members[0]?.memberName).toBe("merlin");
    // journalStagedFact 读 record：最后一条 staged 事实携带新 manager 名（重放恢复）
    const stagedFacts = journal.filter((event) => event.payload.kind === "staged");
    expect(stagedFacts.at(-1)?.payload.managerName).toBe("merlin");

    // 批准后（spawnOk 记 agent_merlin）：路由改向与 actor 判定均用新名
    await hub.approveStage("lead_s1");
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    expect(alice.send({ to: "lead", message: "status report" }).status).toBe("success");
    expect(hub.mailboxEntries().at(-1)?.to).toBe("merlin"); // §22 契约 2 改投新 manager

    const task = hub.board()!.tasks.find((candidate) => candidate.title === "t2")!;
    const ghost = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const byGhost = await ghost.reassign({ taskId: task.taskId, to: "alice", reason: "stale name" });
    expect(byGhost.status).toBe("rejected"); // 旧名 agent 不再是管理 actor
    expect(byGhost.status === "rejected" && byGhost.error.code).toBe("team_lead_only");
    const merlin = hub.memberPort({ agentId: "agent_merlin", memberName: "merlin" });
    const byMerlin = await merlin.reassign({ taskId: task.taskId, to: "alice", reason: "route" });
    expect(byMerlin.status).toBe("ok"); // 新名 manager 可转派
  });

  it("L11: 再入库省略 name 键保留已命名团队（不再覆写成 undefined 并持久化）", () => {
    const journal: { payload: { kind: string; name?: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => journal.push(event as never),
    });
    expect(
      hub.stageTeam("lead_s1", { ...STAGE_INPUT, name: "named-team", draftTasks: [] }).status,
    ).toBe("ok");
    // port 直调形态：重列草案不带 name 键（L11 修复前 record.name 被清成 undefined）
    const reentry = hub.stageTeam("lead_s1", {
      manager: STAGE_INPUT.manager,
      draftMembers: STAGE_INPUT.draftMembers,
      draftTasks: [],
    });
    expect(reentry.status).toBe("ok");
    expect(hub.snapshot()?.name).toBe("named-team");
    const stagedFacts = journal.filter((event) => event.payload.kind === "staged");
    expect(stagedFacts.at(-1)?.payload.name).toBe("named-team"); // 持久化同为保留值
  });
});

describe("manager↔member duplicate name protection is carried by ordering (L2)", () => {
  it("manager 与成员重名 → draft_duplicate_member（先 add manager、成员循环查重承担防护）", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const result = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      draftMembers: [{ memberName: "morgana" }, { memberName: "alice" }],
    });
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.error.code).toBe("draft_duplicate_member");
    expect(result.status === "rejected" && result.error.message).toContain("morgana");
    expect(hub.snapshot()).toBeUndefined(); // 落库前拒绝
  });
});

describe("manager draft field limits at stageTeam (L10, §17 契约 4 同门)", () => {
  it("port 直调超长 manager 名/profile/modelSelection 被拒（draft_field_too_long，落库前）", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const overName = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      manager: { memberName: "m".repeat(TEAM_LIMITS.maxNameChars + 1) },
    });
    expect(overName.status).toBe("rejected");
    expect(overName.status === "rejected" && overName.error.code).toBe("draft_field_too_long");
    expect(overName.status === "rejected" && overName.error.message).toContain("manager.name");

    const overProfile = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      manager: {
        memberName: "morgana",
        profile: "p".repeat(TEAM_LIMITS.maxNameChars + 1),
      },
    });
    expect(overProfile.status).toBe("rejected");
    expect(overProfile.status === "rejected" && overProfile.error.message).toContain(
      "manager.profile",
    );

    const overSelection = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      manager: {
        memberName: "morgana",
        modelSelection: {
          provider: "p".repeat(TEAM_LIMITS.maxIdChars + 1),
          model: "model-a",
        },
      },
    });
    expect(overSelection.status).toBe("rejected");
    expect(overSelection.status === "rejected" && overSelection.error.message).toContain(
      "manager.modelSelection",
    );
    expect(hub.snapshot()).toBeUndefined(); // 落库前拒绝
  });

  it("空白 manager 名被拒（draft_blank_name——memberName 是联接键，不可归一为键缺席）", () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    const blank = hub.stageTeam("lead_s1", {
      ...STAGE_INPUT,
      manager: { memberName: "   " },
    });
    expect(blank.status).toBe("rejected");
    expect(blank.status === "rejected" && blank.error.code).toBe("draft_blank_name");
    expect(hub.snapshot()).toBeUndefined();
  });
});

describe("tasks addressed to the manager are claimable by workers (M4/决策 D6)", () => {
  it("assignee=manager 的任务被 worker 认领并推进到终态（taskCreate 指派 → kickTeam → 认领）", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    // 指派给 manager（路由地址，不是执行者）：portTaskCreate 走 kickTeam 唤醒 workers。
    // M4 修复前：nextReadyTask 对 manager 早退、workers 只匹配本人/未指派——该任务
    // 永久 pending、团队到不了终态。
    hub.leadPort("lead_s1").taskCreate({
      title: "manager-routed",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "morgana",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const claimed = hub.board()!.tasks[0]!;
    expect(claimed.assignee).not.toBe("morgana"); // manager 不执行
    expect(["alice", "bob"]).toContain(claimed.assignee);
    const worker = hub.memberPort({
      agentId: `agent_${claimed.assignee}`,
      memberName: claimed.assignee!,
    });
    expect(
      worker.taskUpdate({
        taskId: claimed.taskId,
        attemptId: claimed.attemptId!,
        patch: { status: "in_progress" },
      }).status,
    ).toBe("ok");
    expect(
      worker.taskUpdate({
        taskId: claimed.taskId,
        attemptId: claimed.attemptId!,
        patch: { status: "completed", output: "done" },
      }).status,
    ).toBe("ok");
    expect(hub.board()?.tasks[0]?.status).toBe("completed");
  });

  it("reassign to=manager 同规则：交接提交后 kickTeam，workers 认领（不滞留 manager 名下）", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      interruptAndSettle: async () => undefined,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    lead.taskCreate({
      title: "work",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const task = hub.board()!.tasks[0]!;
    const result = await manager.reassign({
      taskId: task.taskId,
      to: "morgana",
      reason: "route via manager",
    });
    expect(result.status).toBe("ok");
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const rotated = hub.board()!.tasks[0]!;
    expect(rotated.assignee).not.toBe("morgana"); // worker 认领，manager 零执行面
  });
});

describe("reassign target busy check (L7, 「一成员至多一个开放任务」)", () => {
  it("目标已持开放任务 → member_busy 拒且板未动；空闲目标通过并认领", async () => {
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      interruptAndSettle: async () => undefined,
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    const lead = hub.leadPort("lead_s1");
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    lead.taskCreate({
      title: "t1",
      spec: { goal: "g", acceptance: [] },
      dependsOn: [],
      assignee: "alice",
    });
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "t1")?.status).toBe(
        "claimed",
      );
    });
    lead.taskCreate({ title: "t2", spec: { goal: "g", acceptance: [] }, dependsOn: [] });
    const t2 = hub.board()!.tasks.find((candidate) => candidate.title === "t2")!;

    // alice 忙（claimed t1）→ 拒（L7 修复前可给同一成员堆第二个开放任务）
    const busy = await manager.reassign({ taskId: t2.taskId, to: "alice", reason: "double up" });
    expect(busy.status).toBe("rejected");
    expect(busy.status === "rejected" && busy.error.code).toBe("member_busy");
    expect(busy.status === "rejected" && busy.error.message).toContain("alice");
    expect(hub.board()!.tasks.find((candidate) => candidate.title === "t2")?.status).toBe("pending");

    // bob 空闲 → 过
    const idle = await manager.reassign({ taskId: t2.taskId, to: "bob", reason: "route to bob" });
    expect(idle.status).toBe("ok");
    await vi.waitFor(() => {
      expect(hub.board()?.tasks.find((candidate) => candidate.title === "t2")?.status).toBe(
        "claimed",
      );
    });
    expect(hub.board()!.tasks.find((candidate) => candidate.title === "t2")?.assignee).toBe("bob");
  });
});

describe("management actor is manager-only (M9/决策 D1, §22 契约 4 收敛为裁定 3)", () => {
  it("reassign actor 三分：manager ✓ / lead 会话 ✗ / 普通成员 ✗（✗ 者 team_lead_only）", async () => {
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
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.status).toBe("claimed"));
    const task = hub.board()!.tasks[0]!;

    // lead 会话（生产经 resolveTeamToolPort 得 leadPort.reassign）→ 拒
    const byLead = await hub.leadPort("lead_s1").reassign({
      taskId: task.taskId,
      to: "bob",
      reason: "lead tries to manage",
    });
    expect(byLead.status).toBe("rejected");
    expect(byLead.status === "rejected" && byLead.error.code).toBe("team_lead_only");

    // 普通成员 child → 拒
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const byMember = await alice.reassign({
      taskId: task.taskId,
      to: "bob",
      reason: "member tries to manage",
    });
    expect(byMember.status).toBe("rejected");
    expect(byMember.status === "rejected" && byMember.error.code).toBe("team_lead_only");
    expect(hub.board()!.tasks[0]?.assignee).toBe("alice"); // 板未动

    // manager child → 过
    const manager = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    const byManager = await manager.reassign({
      taskId: task.taskId,
      to: "bob",
      reason: "manager rotates",
    });
    expect(byManager.status).toBe("ok");
    await vi.waitFor(() => expect(hub.board()?.tasks[0]?.assignee).toBe("bob"));
  });
});

describe("approval-time permission override rides the approved fact via the port (M8/决策 D7 + L9/决策 D10)", () => {
  it("leadPort.approveStage({permissionMode}) 覆写生效且 approved 事实随行（重放回写见 team-journal.test.ts）", async () => {
    const journal: { payload: { kind: string; permissionMode?: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      leadPermissionMode: "build",
      journalWriter: (event) => journal.push(event as never),
    });
    hub.stageTeam("lead_s1", { ...STAGE_INPUT, draftTasks: [] });
    // L9：经 port 携带 options（§10 增补三；修复前 port 契约签名无 options）
    const approved = await hub.leadPort("lead_s1").approveStage({ permissionMode: "yolo" });
    expect(approved.status).toBe("ok");
    expect(hub.snapshot()?.permissionMode).toBe("yolo"); // 批准时刻覆写生效
    // M8：approved 事实携带覆写值（缺省会随行建队捕获值——additive 键总在）
    const fact = journal.find((event) => event.payload.kind === "approved");
    expect(fact?.payload.permissionMode).toBe("yolo");
  });
});

describe("halt reason lands in the halted journal fact (L8/决策 D9)", () => {
  it("halt 带 reason → halted 事实携带；不带 → 键缺席（与 resumed.reason 对称）", async () => {
    const journal: { payload: { kind: string; reason?: string } }[] = [];
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => journal.push(event as never),
    });
    stageEmpty(hub);
    await hub.approveStage("lead_s1");
    expect(hub.halt("lead_s1", "pause for review").status).toBe("ok");
    const halted = journal.find((event) => event.payload.kind === "halted");
    expect(halted?.payload.reason).toBe("pause for review");

    expect(hub.resume("lead_s1", "go on").status).toBe("ok");
    expect(hub.halt("lead_s1").status).toBe("ok");
    const haltedAgain = [...journal].reverse().find((event) => event.payload.kind === "halted");
    expect(haltedAgain).toBeDefined();
    expect("reason" in (haltedAgain?.payload ?? {})).toBe(false);
  });
});

describe("session auto-approve + archival replacement (§10 增补六，2026-10-27)", () => {
  const STAGE_A: TeamStageInput = {
    name: "first",
    manager: { memberName: "morgana", profile: "team manager" },
    draftMembers: [
      { memberName: "alice", profile: "researcher" },
      { memberName: "bob", profile: "implementer" },
    ],
    draftTasks: [
      { title: "only", spec: { goal: "g", acceptance: ["a"] }, dependsOn: [] },
    ],
  };

  function makeSessionHub(journal: JournalRow[] = []): TeamHub {
    return new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      dispatch: async () => true,
      deliverLeadMail: acceptAllLeadMail(),
      journalWriter: (event) => journal.push(event as never),
    });
  }

  /** 把队推到终局 completed（H1/M12 全链：任务终态 → workers 终态 → 终报送达）。 */
  async function completeTeam(hub: TeamHub): Promise<void> {
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const task = hub.board()!.tasks[0]!;
    const claim = alice.taskClaim(task.taskId);
    if (claim.status === "claimed") {
      expect(
        alice.taskUpdate({
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          patch: { status: "in_progress" },
        }).status,
      ).toBe("ok");
      expect(
        alice.taskUpdate({
          taskId: claim.taskId,
          attemptId: claim.attemptId,
          patch: { status: "completed" },
        }).status,
      ).toBe("ok");
    }
    await hub.handleMemberTerminal("alice");
    await hub.handleMemberTerminal("bob");
    // 终报指令投递（dispatch accept-all + kick 复活链）→ manager 执笔终报 →
    // lead 注入 → delivered → completed（H1/M12 全链）。
    await vi.waitFor(() => {
      const directive = hub
        .mailboxEntries()
        .find((entry) => entry.from === "lead" && entry.to === "morgana");
      expect(directive?.deliveredAccepted).toBe(true);
    });
    const sent = managerLeadSend(hub, "final: all tasks completed");
    expect(sent.status).toBe("success");
    await vi.waitFor(() => expect(hub.status).toBe("completed"));
  }

  it("archival replacement：completed 队可被新草案替换（新 teamId），在途态仍拒绝", async () => {
    const journal: JournalRow[] = [];
    const hub = makeSessionHub(journal);
    expect(hub.stageTeam("lead_s1", STAGE_A).status).toBe("ok");
    const firstTeamId = hub.snapshot()!.teamId;
    await hub.approveStage("lead_s1");
    await completeTeam(hub);
    expect(hub.status).toBe("completed");

    // 替换：终局队上再 stageTeam = 新建记录（新 teamId），不再是 team_not_present。
    const second = hub.stageTeam("lead_s1", { ...STAGE_A, name: "second" });
    expect(second.status).toBe("ok");
    expect(hub.snapshot()!.teamId).not.toBe(firstTeamId);
    expect(hub.status).toBe("staged");
    // 流中两队各自成序：两次 team_created，旧队事实位于其前（重放不跨队）。
    const created = journal.filter((row) => row.payload.kind === "team_created");
    expect(created).toHaveLength(2);
  });

  it("approve with rememberForSession：后续草案落库即自动批准（cause=session_allow），revise 草案不自动", async () => {
    const journal: JournalRow[] = [];
    const hub = makeSessionHub(journal);
    expect(hub.stageTeam("lead_s1", STAGE_A).status).toBe("ok");
    // 用户选「本会话内始终允许」= 批准 + 置会话免问标志。
    await hub.approveStage("lead_s1", { rememberForSession: true });
    await completeTeam(hub);

    // 第二队：stageTeam 落库即自动批准（异步推进；无 awaitingFeedback）。
    expect(hub.stageTeam("lead_s1", { ...STAGE_A, name: "second" }).status).toBe("ok");
    await vi.waitFor(() => expect(hub.status).toBe("active"));
    const autoApproved = journal
      .filter((row) => row.payload.kind === "approved")
      .find((row) => "cause" in row.payload && row.payload.cause === "session_allow");
    expect(autoApproved).toBeDefined();

    // 反例：revise（awaitingFeedback）草案不被自动批准——用户明确要改，等待反馈优先。
    hub.abandonStage("lead_s1");
    await completeTeam(hub);
    hub.stageTeam("lead_s1", { ...STAGE_A, name: "third" });
    hub.markStageAwaitingFeedback("lead_s1");
    expect(hub.status).toBe("staged");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hub.status).toBe("staged");
    const causes = journal
      .filter((row) => row.payload.kind === "approved")
      .map((row) => ("cause" in row.payload ? row.payload.cause : undefined));
    expect(causes.filter((cause) => cause === "session_allow")).toHaveLength(1);
  });

  it("无 rememberForSession 的普通批准不置标志：第二队照常 staged 等待人工批准", async () => {
    const journal: JournalRow[] = [];
    const hub = makeSessionHub(journal);
    expect(hub.stageTeam("lead_s1", STAGE_A).status).toBe("ok");
    await hub.approveStage("lead_s1");
    await completeTeam(hub);
    expect(hub.stageTeam("lead_s1", { ...STAGE_A, name: "second" }).status).toBe("ok");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hub.status).toBe("staged");
    expect(
      journal.some(
        (row) => row.payload.kind === "approved" && "cause" in row.payload,
      ),
    ).toBe(false);
  });
});
