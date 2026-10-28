import { describe, expect, it, vi } from "vitest";
import type { SessionEntryInfo, TeamStageInput } from "@drora/contracts";
import { TeamHub, type TeamDispatchFn, type TeamHubDeps } from "../../src/team/hub.js";
import type { BoardClock } from "../../src/team/board.js";
import {
  createTeamJournalSessionStoreSink,
  parseTeamJournalEntries,
  replayTeamJournal,
  restoreAgentsTeamFromJournal,
  TEAM_JOURNAL_ENTRY_TYPE,
  type TeamJournalEvent,
} from "../../src/team/journal.js";
import { projectTeam } from "../../src/team/projection.js";

/**
 * M3 PR-3.1（journal 持久化 + lead resume 恢复）验收测试：
 * - journal round-trip：动作序列 → 持久化 → 重放重建 → 花名册/板/邮箱/权限模式/removed 一致；
 * - removed 成员复活投递被拒（E11 持久语义，退休拒绝表）；
 * - halted 事实恢复后仍 halted（resumed 事实解除）；
 * - awaitingFeedback 置位/清位投影断言（TeamRecord 内部标记，替换 v1 容缺）。
 * 依据：specs/agents-team.md §2.6/§3.3/差异裁决#5、§16.2 退休表、M3 验收 §12。
 */

function makeClock(): BoardClock {
  let n = 0;
  return {
    now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, n++)).toISOString(),
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

function spawnOk() {
  return vi.fn(async (members: readonly { memberName: string }[]) =>
    members.map((member) => ({
      memberName: member.memberName,
      agentId: `agent_${member.memberName}`,
      childSessionId: `child_${member.memberName}`,
    })),
  );
}

/**
 * 与 install.ts spawnMembers 同款的桩：成功后回写 hub.confirmMemberSpawned——
 * member_added 事实与真实 agentId 绑定都出自这一步。
 */
function spawnConfirming(hub: TeamHub) {
  return vi.fn(async (members: readonly { memberName: string }[]) => {
    const rows = members.map((member) => ({
      memberName: member.memberName,
      agentId: `agent_${member.memberName}`,
      childSessionId: `child_${member.memberName}`,
    }));
    for (const row of rows)
      hub.confirmMemberSpawned(row.memberName, row.agentId, row.childSessionId);
    return rows;
  });
}

/** 内存版 session entry 通道（sink/reader 的既有通道保真替身）。 */
function createMemorySessionStore() {
  const entries: SessionEntryInfo[] = [];
  return {
    entries,
    async saveSessionEntry(entry: SessionEntryInfo): Promise<void> {
      const index = entries.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
    },
    async sessionEntries(input: { sessionID: string; type?: string }): Promise<SessionEntryInfo[]> {
      return entries.filter(
        (entry) =>
          entry.sessionID === input.sessionID &&
          (input.type === undefined || entry.type === input.type),
      );
    },
  };
}

/** hub 先构造、spawn 回调后绑定的委托桩（spawn 回调需要 hub 引用回写 confirm）。 */
function makeConfirmingSpawn() {
  type SpawnFn = NonNullable<TeamHubDeps["spawnMembers"]>;
  let impl: SpawnFn = async () => [];
  return {
    /** 传入 TeamHub deps 的转发闭包。 */
    forward: ((members, permissionMode) => impl(members, permissionMode)) as SpawnFn,
    /** hub 构造完成后调用，绑定真实实现。 */
    bind(hub: TeamHub): void {
      impl = spawnConfirming(hub) as unknown as SpawnFn;
    },
  };
}

type MemoryStore = ReturnType<typeof createMemorySessionStore>;

async function drainMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function journalEventsOf(store: MemoryStore, warn?: (message: string) => void) {
  await drainMicrotasks();
  return parseTeamJournalEntries(
    store.entries.filter((entry) => entry.type === TEAM_JOURNAL_ENTRY_TYPE),
    warn,
  );
}

describe("team journal round-trip (M3 PR-3.1)", () => {
  it("动作序列→持久化→重放重建：花名册/板/邮箱/权限模式/removed 全一致", async () => {
    const store = createMemorySessionStore();
    const warns: string[] = [];
    const sink = createTeamJournalSessionStoreSink({
      sessionStore: store,
      sessionId: "lead_s1",
      warn: (message) => warns.push(message),
    });
    const dispatch: TeamDispatchFn = vi.fn(async () => false);
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      dispatch,
      leadPermissionMode: "guarded",
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);

    // 用户动作：成队（权限模式成队定死）→ 审批
    hub.stageTeam("lead_s1", STAGE_INPUT);
    const approved = await hub.approveStage("lead_s1");
    expect(approved.status).toBe("ok");

    // 成员协议动作：alice 认领 t1 → in_progress → completed（含产出）
    const alice = hub.memberPort({ agentId: "agent_alice", memberName: "alice" });
    const t1 = hub.board()!.tasks.find((task) => task.title === "t1")!;
    const claim = alice.taskClaim(t1.taskId);
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") return;
    const progress = alice.taskUpdate({
      taskId: t1.taskId,
      attemptId: claim.attemptId,
      patch: { status: "in_progress" },
    });
    expect(progress.status).toBe("ok");
    const done = alice.taskUpdate({
      taskId: t1.taskId,
      attemptId: claim.attemptId,
      patch: { status: "completed", output: "ship it" },
    });
    expect(done.status).toBe("ok");

    // 邮箱事实：alice→bob 与 lead→alice
    const peerSend = alice.send({ to: "bob", message: "hi bob" });
    expect(peerSend.status).toBe("success");
    const leadSend = hub.leadPort("lead_s1").send({ to: "alice", message: "hello alice" });
    expect(leadSend.status).toBe("success");

    // 用户动作：移除 bob（退休拒绝表）+ 停队
    expect(hub.removeMember("bob").status).toBe("ok");
    expect(hub.halt("lead_s1").status).toBe("ok");
    expect(hub.status).toBe("halted");

    await sink.flush();
    const events = await journalEventsOf(store, (message) => warns.push(message));
    expect(warns).toEqual([]);
    const kinds = events.map((event) => event.payload.kind);
    expect(kinds[0]).toBe("team_created");
    expect(kinds).toContain("staged");
    expect(kinds).toContain("approved");
    expect(kinds.filter((kind) => kind === "member_added")).toEqual([
      "member_added",
      "member_added",
      "member_added",
    ]);
    // 草案任务随 staged 事实整体持久化，不走 task_created（那是运行期建任务的出口）
    expect(kinds).not.toContain("task_created");
    expect(kinds.filter((kind) => kind === "task_updated").length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((kind) => kind === "message_appended").length).toBe(2);
    expect(kinds).toContain("member_removed");
    expect(kinds.at(-1)).toBe("halted");
    // entry 通道形态：type = team.journal（TEAM_JOURNAL_KEY_PREFIX 家族）、touchSession 不扰动会话
    expect(store.entries.every((entry) => entry.type === TEAM_JOURNAL_ENTRY_TYPE)).toBe(true);
    expect(store.entries.every((entry) => entry.touchSession === false)).toBe(true);

    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    expect(record!.status).toBe("halted"); // halted 事实保留
    expect(record!.permissionMode).toBe("guarded"); // 权限模式记录值恢复
    expect(record!.name).toBe("demo");
    expect(record!.members).toHaveLength(3);
    const restoredAlice = record!.members.find((member) => member.memberName === "alice");
    const restoredBob = record!.members.find((member) => member.memberName === "bob");
    expect(restoredAlice).toMatchObject({ agentId: "agent_alice", childSessionId: "child_alice" });
    expect(restoredAlice!.removed).toBe(false);
    expect(restoredBob).toMatchObject({ agentId: "agent_bob", removed: true, state: "removed" }); // 退休拒绝表（removed 标记持久化）
    expect(record!.tasks.find((task) => task.title === "t1")).toMatchObject({
      status: "completed",
      attempt: 1,
      output: "ship it",
    });
    expect(record!.tasks.find((task) => task.title === "t2")).toMatchObject({
      status: "pending",
      attempt: 0,
      assignee: "alice",
    });
    expect(record!.mailbox.map((entry) => [entry.from, entry.to])).toEqual([
      ["alice", "bob"],
      ["lead", "alice"],
    ]);

    // 重放 record 装入新 hub（lead resume 恢复）
    const hub2 = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    expect(hub2.adoptRestored(record!)).toBe(true);
    expect(hub2.snapshot()).toMatchObject({
      teamId: record!.teamId,
      permissionMode: "guarded",
      status: "halted",
    });
    expect(hub2.snapshot()!.members.map((member) => member.memberName)).toEqual(["morgana", "alice"]);
    expect(hub2.board()!.tasks.map((task) => task.status)).toEqual(["completed", "pending"]);

    // 恢复后的 halted 队仍需显式带理由 resume；空理由拒绝
    expect(hub2.resume("lead_s1", "").status).toBe("rejected");
    expect(hub2.resume("lead_s1", "continue the work").status).toBe("ok");
    expect(hub2.status).toBe("idle"); // 重放后无 working 成员/未投邮件 → idle

    // E11 持久语义：removed 成员复活投递被拒（退休拒绝表跨进程生效；
    // halted 先拦——先显式 resume 解除冻结，拒绝码才落到 E11 本身）
    const revivedSend = hub2.leadPort("lead_s1").send({ to: "bob", message: "revive?" });
    expect(revivedSend.status).toBe("failed");
    expect(revivedSend.status === "failed" && revivedSend.error.code).toBe(
      "message_target_terminal_retired",
    );
  });

  it("resume 事实解除冻结：halted→resumed 序列恢复后按 busy 推导而非 halted", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);
    hub.stageTeam("lead_s1", STAGE_INPUT);
    await hub.approveStage("lead_s1");
    hub.halt("lead_s1");
    hub.resume("lead_s1", "user asked to continue");
    await sink.flush();

    const events = await journalEventsOf(store);
    const { record } = replayTeamJournal(events);
    expect(record!.status).not.toBe("halted");
    expect(record!.status).toBe("idle"); // 重放成员皆 terminal、无未投邮件
  });

  it("送达 ack 与未投邮件事实：恢复后已投不重投、未投邮件推导 active", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    let acceptDispatch = true;
    const dispatch: TeamDispatchFn = vi.fn(async () => acceptDispatch);
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      dispatch,
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);
    hub.stageTeam("lead_s1", STAGE_INPUT);
    await hub.approveStage("lead_s1");

    // 运行中成员 steer 送达（ack 只认注入）
    hub.markMemberWorking("alice");
    expect(hub.leadPort("lead_s1").send({ to: "alice", message: "m1" }).status).toBe("success");
    await drainMicrotasks();
    // 终态成员复活送达
    await hub.handleMemberTerminal("alice");
    expect(hub.leadPort("lead_s1").send({ to: "alice", message: "m2" }).status).toBe("success");
    await drainMicrotasks();
    // 第三封投递失败：保持未投递（不 ack）
    acceptDispatch = false;
    expect(hub.leadPort("lead_s1").send({ to: "alice", message: "m3" }).status).toBe("success");
    await drainMicrotasks();

    await sink.flush();
    const events = await journalEventsOf(store);
    const deliveredEvents = events.filter((event) => event.payload.kind === "message_delivered");
    expect(deliveredEvents.map((event) => event.payload).map((payload) => payload.kind)).toEqual([
      "message_delivered",
      "message_delivered",
    ]);
    const { record } = replayTeamJournal(events);
    expect(record!.mailbox.map((entry) => entry.deliveredAccepted)).toEqual([true, true, false]);
    // 未投世代当前邮件 → busy 推导 active
    expect(record!.status).toBe("active");
  });
});

describe("awaitingFeedback 回填（TeamRecord 内部标记）", () => {
  it("reviseTeamPlan 语义置位、approveStage 清位，投影从标记读（替换 v1 容缺）", async () => {
    const hub = new TeamHub({ clock: makeClock(), spawnMembers: spawnOk() });
    hub.stageTeam("lead_s1", STAGE_INPUT);
    expect(hub.awaitingFeedback).toBe(false);

    expect(hub.markStageAwaitingFeedback("lead_s1").status).toBe("ok");
    expect(hub.awaitingFeedback).toBe(true);

    const snapshot = hub.snapshot()!;
    const projection = projectTeam({
      teamId: snapshot.teamId,
      status: snapshot.status,
      members: snapshot.members,
      tasks: hub.board()!.tasks,
      mailbox: hub.mailboxEntries(),
      awaitingFeedback: hub.awaitingFeedback,
    });
    expect(projection.status).toBe("staged");
    expect(projection.stagedDraft?.awaitingFeedback).toBe(true);

    // 非 lead 会话拒绝
    expect(hub.markStageAwaitingFeedback("other_session").status).toBe("rejected");
    // 非 staged 态拒绝
    await hub.approveStage("lead_s1");
    expect(hub.awaitingFeedback).toBe(false);
    expect(hub.markStageAwaitingFeedback("lead_s1").status).toBe("rejected");
    const after = projectTeam({
      teamId: hub.teamId!,
      status: hub.status!,
      members: hub.snapshot()!.members,
      tasks: hub.board()!.tasks,
      mailbox: hub.mailboxEntries(),
      awaitingFeedback: hub.awaitingFeedback,
    });
    expect(after.stagedDraft).toBeUndefined(); // 仅 staged 态携带草案投影
  });

  it("staged 事实随 journal 持久化：恢复后草案与等待反馈标记不丢", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const hub = new TeamHub({
      clock: makeClock(),
      journalWriter: (event) => sink.append(event),
    });
    hub.stageTeam("lead_s1", STAGE_INPUT);
    expect(hub.markStageAwaitingFeedback("lead_s1").status).toBe("ok");
    await sink.flush();

    const events = await journalEventsOf(store);
    const stagedPayloads = events
      .filter((event) => event.payload.kind === "staged")
      .map((event) => event.payload);
    expect(stagedPayloads.at(-1)).toMatchObject({ awaitingFeedback: true });
    const { record } = replayTeamJournal(events);
    expect(record!.status).toBe("staged");
    expect(record!.awaitingFeedback).toBe(true);

    // 审批清除标记的事实链：approve 后重放不再带标记
    const spawn2 = makeConfirmingSpawn();
    const hub2 = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn2.forward,
      journalWriter: (event) => sink.append(event),
    });
    spawn2.bind(hub2);
    hub2.adoptRestored(record!);
    expect(hub2.awaitingFeedback).toBe(true);
    await hub2.approveStage("lead_s1");
    await sink.flush();
    const eventsAfter = await journalEventsOf(store);
    const { record: recordAfter } = replayTeamJournal(eventsAfter);
    // 审批后的重放按事实推导：成员运行态不入 journal → 皆 terminal、无未投邮件 → idle
    expect(recordAfter!.status).toBe("idle");
    expect(recordAfter!.awaitingFeedback).toBeUndefined();
  });
});

describe("journal 防御与续写（design §9：未知事件跳过 + warn，不劫持）", () => {
  it("畸形条目与未知 kind 跳过；事件先于 team_created 跳过；未知权限模式回退缺席", async () => {
    const warns: string[] = [];
    const warn = (message: string): void => {
      warns.push(message);
    };
    const base = {
      seq: 1,
      at: new Date(Date.UTC(2026, 9, 18)).toISOString(),
    };
    const entries: SessionEntryInfo[] = [
      {
        id: "e1",
        sessionID: "lead_s1" as never,
        type: TEAM_JOURNAL_ENTRY_TYPE,
        touchSession: false,
        time: { created: 0, updated: 0 },
        data: {
          ...base,
          payload: {
            kind: "team_created",
            teamId: "team_x",
            leadSessionId: "lead_s1",
            permissionMode: "quantum", // 未知模式值 → 缺席回退，不猜
            createdAt: base.at,
          },
        },
      },
      {
        id: "e2",
        sessionID: "lead_s1" as never,
        type: TEAM_JOURNAL_ENTRY_TYPE,
        touchSession: false,
        time: { created: 0, updated: 0 },
        data: { at: base.at, payload: { kind: "halted", teamId: "team_x" } }, // 缺 seq → 畸形跳过
      },
      {
        id: "e3",
        sessionID: "lead_s1" as never,
        type: TEAM_JOURNAL_ENTRY_TYPE,
        touchSession: false,
        time: { created: 0, updated: 0 },
        data: { ...base, payload: { kind: "future_thing", teamId: "team_x" } }, // 未知 kind
      },
      {
        id: "e4",
        sessionID: "lead_s1" as never,
        type: TEAM_JOURNAL_ENTRY_TYPE,
        touchSession: false,
        time: { created: 0, updated: 0 },
        data: undefined, // 无 data
      },
    ];
    const events = parseTeamJournalEntries(entries, warn);
    expect(events.map((event) => event.payload.kind)).toEqual(["team_created"]);
    expect(warns.length).toBe(3);

    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    expect(record!.permissionMode).toBeUndefined();
    expect(record!.status).toBe("staged");

    // 未知 kind 事件混入重放：跳过不抛，lastSeq 仍计入
    const unknown: TeamJournalEvent = {
      seq: 7,
      at: base.at,
      payload: { kind: "future_thing", teamId: "team_x" } as never,
    };
    const replayed = replayTeamJournal([...events, unknown], warn);
    expect(replayed.lastSeq).toBe(7);
    expect(replayed.record!.status).toBe("staged");
  });

  it("跨进程续写：restore 返回 lastSeq，sink.setNextSeq 后新事件接续单调 seq", async () => {
    const store = createMemorySessionStore();
    const first = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const spawn1 = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn1.forward,
      journalWriter: (event) => first.append(event),
    });
    spawn1.bind(hub);
    hub.stageTeam("lead_s1", STAGE_INPUT);
    await hub.approveStage("lead_s1");
    await first.flush();

    // 新进程：restore + seq 续写，hub2 的动作经同一 store 续写
    const second = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const hub2 = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => second.append(event),
    });
    const outcome = await restoreAgentsTeamFromJournal({
      hub: hub2,
      sessionStore: store,
      sessionId: "lead_s1",
    });
    expect(outcome).toMatchObject({ adopted: true });
    expect(outcome!.lastSeq).toBe(first.lastSeq());
    expect(outcome!.lastSeq).toBeGreaterThan(0);
    second.setNextSeq(outcome!.lastSeq + 1);
    // 重放成员皆 terminal、无未投邮件 → idle（诚实推导，不冒充 active）
    expect(hub2.status).toBe("idle");
    expect(hub2.snapshot()!.members.map((member) => member.memberName)).toEqual(["morgana", "alice", "bob"]);

    // 恢复后的用户动作照常入 journal，seq 接续单调
    hub2.halt("lead_s1");
    hub2.resume("lead_s1", "again");
    await second.flush();

    const events = await journalEventsOf(store);
    const seqs = events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // 全流单调
    expect(new Set(seqs).size).toBe(seqs.length); // 无碰撞
    // resume 的 kickTeam（缺口7，2026-10-21）会在 resumed 事实后追发派发尝试的任务
    // 事实：本夹具无派发通道（dispatch 缺席 = 永不接受），世代先落 + 回滚各记一条
    // task_updated——两者都是持久真相（spec §16.1「先于派发结果持久化新世代」）。
    // 序列断言改为：halted→resumed 按序在场，resumed 之后只允许任务事实族。
    const kinds = events.map((event) => event.payload.kind);
    const haltedAt = kinds.lastIndexOf("halted");
    const resumedAt = kinds.lastIndexOf("resumed");
    expect(haltedAt).toBeGreaterThan(0);
    expect(resumedAt).toBeGreaterThan(haltedAt);
    expect(kinds.slice(resumedAt + 1).every((kind) => kind === "task_updated")).toBe(true);
    const { record } = replayTeamJournal(events);
    expect(record!.status).toBe("idle"); // resumed 解除冻结 → busy 推导
  });

  it("装配竞态让位：hub 已有在库记录时 restore 不覆盖（adopted=false）", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const old = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawnOk(),
      journalWriter: (event) => sink.append(event),
    });
    old.stageTeam("lead_s1", STAGE_INPUT);
    await old.approveStage("lead_s1");
    await sink.flush();

    const live = new TeamHub({ clock: makeClock() });
    live.stageTeam("lead_s1", { ...STAGE_INPUT, name: "fresh" });
    const freshTeamId = live.teamId;
    const outcome = await restoreAgentsTeamFromJournal({
      hub: live,
      sessionStore: store,
      sessionId: "lead_s1",
    });
    expect(outcome).toMatchObject({ adopted: false });
    expect(live.teamId).toBe(freshTeamId); // 现役记录保持（未被恢复覆盖）
    expect(live.status).toBe("staged");
  });

  it("无 journal 事实的会话 restore 返回 undefined（新会话 no-op）", async () => {
    const store = createMemorySessionStore();
    const hub = new TeamHub({ clock: makeClock() });
    const outcome = await restoreAgentsTeamFromJournal({
      hub,
      sessionStore: store,
      sessionId: "lead_s1",
    });
    expect(outcome).toBeUndefined();
    expect(hub.teamId).toBeUndefined();
  });
});

// ---------- 2026-10-21 收口施工批次 2（spec §14）----------

describe("replay retention + lead delivery facts (2026-10-21 缺口12, spec §14)", () => {
  it("replays the mailbox through per-recipient retention (shape parity with the live hub)", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);
    hub.stageTeam("lead_s1", STAGE_INPUT);
    await hub.approveStage("lead_s1");
    // §22 契约 2：to=lead 的合法发件人只剩 manager（成员→lead 在 portSend 改向）——
    // 保留期对账用 manager 口径重证（alice 口径已由路由改向用例承接）。
    const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    // 25 封 lead 邮件（保留期 20）：运行态入队即裁——修复前重放裸 push 会重建 25 封。
    for (let index = 0; index < 25; index += 1) {
      const sent = morgana.send({ to: "lead", message: `m${String(index).padStart(2, "0")}` });
      expect(sent.status).toBe("success");
    }
    await sink.flush();
    const live = hub.mailboxEntries();
    expect(live.length).toBeLessThanOrEqual(25); // §22 manager +1 员

    const entries = await store.sessionEntries({
      sessionID: "lead_s1",
      type: TEAM_JOURNAL_ENTRY_TYPE,
    });
    const { record } = replayTeamJournal(parseTeamJournalEntries(entries));
    expect(record!.mailbox.map((entry) => entry.message)).toEqual(
      live.map((entry) => entry.message),
    );
    expect(record!.mailbox.at(-1)?.message).toBe("m24"); // 最旧被裁、最新保留
  });

  it("replays lead_injected delivery facts (well-formed + deliveredAccepted)", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      deliverLeadMail: async (request: { entries: readonly { messageId: string }[] }) => ({
        // §21 A1：结构化结果（原 boolean true 的等价改写：全部注入）。
        injected: request.entries.map((entry) => entry.messageId),
        skipped: [] as string[],
      }),
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);
    hub.stageTeam("lead_s1", { ...STAGE_INPUT, draftTasks: [] });
    await hub.approveStage("lead_s1");
    // §22：manager 是 lead 邮箱唯一入口。
    const morgana = hub.memberPort({ agentId: "agent_morgana", memberName: "morgana" });
    expect(morgana.send({ to: "lead", message: "report" }).status).toBe("success");
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().at(-1);
      expect(entry?.deliveredAccepted).toBe(true);
    });
    await sink.flush();

    const entries = await store.sessionEntries({
      sessionID: "lead_s1",
      type: TEAM_JOURNAL_ENTRY_TYPE,
    });
    const parsed = parseTeamJournalEntries(entries);
    // 修复前：via 只认 steered/resumed，lead_injected 事实会被重放守卫整条跳过。
    expect(parsed.some((event) => event.payload.kind === "message_delivered")).toBe(true);
    const { record } = replayTeamJournal(parsed);
    expect(record!.mailbox.at(-1)?.deliveredAccepted).toBe(true);
    expect(record!.mailbox.at(-1)?.deliveredVia).toBe("lead_injected");
  });

  it("replays message_dropped facts as idempotent drops (§21 A1)", () => {
    // §21 A1 重放语义：丢弃事实等同丢弃——按 seq 顺序 message_appended 先入、
    // message_dropped 后清；重放多次幂等，被丢条目不进恢复邮箱。
    const entry = (messageId: string, message: string) => ({
      messageId,
      from: "alice",
      to: "lead",
      message,
      at: "2026-10-24T00:00:00.000Z",
      deliveredAccepted: false,
    });
    const events: TeamJournalEvent[] = [
      {
        seq: 1,
        at: "2026-10-24T00:00:00.000Z",
        payload: {
          kind: "team_created",
          teamId: "team_drop",
          leadSessionId: "lead_s1",
          createdAt: "2026-10-24T00:00:00.000Z",
        },
      },
      {
        seq: 2,
        at: "2026-10-24T00:00:01.000Z",
        payload: {
          kind: "message_appended",
          teamId: "team_drop",
          entry: entry("m_dead", "dead letter"),
        },
      },
      {
        seq: 3,
        at: "2026-10-24T00:00:02.000Z",
        payload: {
          kind: "message_appended",
          teamId: "team_drop",
          entry: entry("m_live", "live report"),
        },
      },
      {
        seq: 4,
        at: "2026-10-24T00:00:03.000Z",
        payload: {
          kind: "message_dropped",
          teamId: "team_drop",
          messageIds: ["m_dead"],
          reason: "sender no longer on the team",
          at: "2026-10-24T00:00:03.000Z",
        },
      },
    ];
    const first = replayTeamJournal(events);
    expect(first.record!.mailbox.map((row) => row.messageId)).toEqual(["m_live"]);
    // 同一事实流重放多次：终态一致（幂等丢弃，不复活也不重复清除）。
    const second = replayTeamJournal(events);
    expect(second.record!.mailbox.map((row) => row.messageId)).toEqual(["m_live"]);
    // 畸形丢弃事实（缺 messageIds）整条跳过，不劫持其余事实。
    const malformed = replayTeamJournal(
      events.map((event) =>
        event.seq === 4
          ? {
              ...event,
              payload: { ...event.payload, messageIds: undefined } as never,
            }
          : event,
      ),
    );
    expect(malformed.record!.mailbox.map((row) => row.messageId)).toEqual(["m_dead", "m_live"]);
  });
});

// ---------- 2026-10-23 legacy staged 事实空白归一（specs/agents-team.md §19 契约 2④）----------

describe("legacy staged 事实空白 profile/thought 重放归一（§19 契约 2④）", () => {
  it("legacy 空串 profile / 空白 thought 事实重放后归一为键缺席，烧帧草案不复燃", () => {
    // legacy 形态直接手写事实：旧版本 journalStagedFact 曾把 optional 缺省写成
    // profile: "" 落库。重放侧归一 = 与 stageTeam 物化处同一规范形（§19 契约 2②/④）——
    // 不修则烧帧草案在 CLI 重启后复燃，且 fail-closed 下用户连 abandon 都不可达。
    const events: TeamJournalEvent[] = [
      {
        seq: 1,
        at: "2026-10-23T00:00:00.000Z",
        payload: {
          kind: "team_created",
          teamId: "team_legacy",
          leadSessionId: "lead_s1",
          name: "legacy",
          createdAt: "2026-10-23T00:00:00.000Z",
        },
      },
      {
        seq: 2,
        at: "2026-10-23T00:00:01.000Z",
        payload: {
          kind: "staged",
          teamId: "team_legacy",
          awaitingFeedback: false,
          members: [
            { memberName: "alice", profile: "" },
            { memberName: "bob", profile: "researcher" },
            {
              memberName: "carol",
              modelSelection: { provider: "provider-a", model: "model-a", thought: "  " },
            },
          ],
          tasks: [],
        },
      },
    ];
    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    const alice = record!.members.find((member) => member.memberName === "alice");
    const bob = record!.members.find((member) => member.memberName === "bob");
    const carol = record!.members.find((member) => member.memberName === "carol");
    expect("profile" in (alice ?? {})).toBe(false);
    expect(bob?.profile).toBe("researcher");
    expect("thought" in (carol?.modelSelection ?? {})).toBe(false);
    expect(carol?.modelSelection).toEqual({ provider: "provider-a", model: "model-a" });
  });
});

describe("replay appendedMessageIds (§21 A13 B 案冷恢复对账的已见判定)", () => {
  const mailEvent = (
    seq: number,
    messageId: string,
    extra: Partial<TeamJournalEvent["payload"]> = {},
  ): TeamJournalEvent => ({
    seq,
    at: "2026-10-24T00:00:00.000Z",
    payload: {
      kind: "message_appended",
      teamId: "team_reconcile",
      entry: {
        messageId,
        from: "alice",
        to: "lead",
        message: `m-${messageId}`,
        at: "2026-10-24T00:00:00.000Z",
        deliveredAccepted: false,
      },
      ...extra,
    },
  });
  const created = (seq: number, teamId: string): TeamJournalEvent => ({
    seq,
    at: "2026-10-24T00:00:00.000Z",
    payload: {
      kind: "team_created",
      teamId,
      leadSessionId: "lead_s1",
      createdAt: "2026-10-24T00:00:00.000Z",
    },
  });

  it("collects the full appended id set including entries later delivered or dropped (dropped dead letters stay seen)", () => {
    // 「已见」= message_appended 全集（含其后 delivered/dropped 的）：dropped 死件
    // 的持久化条目仍在库，对账按全集跳过 → 不复活（§21 A1 × A13 交界）。
    const events: TeamJournalEvent[] = [
      created(1, "team_reconcile"),
      mailEvent(2, "m_pending"),
      mailEvent(3, "m_delivered"),
      mailEvent(4, "m_dropped"),
      {
        seq: 5,
        at: "2026-10-24T00:00:01.000Z",
        payload: {
          kind: "message_delivered",
          teamId: "team_reconcile",
          messageIds: ["m_delivered"],
          via: "steered",
          at: "2026-10-24T00:00:01.000Z",
        },
      },
      {
        seq: 6,
        at: "2026-10-24T00:00:02.000Z",
        payload: {
          kind: "message_dropped",
          teamId: "team_reconcile",
          messageIds: ["m_dropped"],
          reason: "sender removed",
          at: "2026-10-24T00:00:02.000Z",
        },
      },
    ];
    const { appendedMessageIds } = replayTeamJournal(events);
    expect([...appendedMessageIds].sort()).toEqual(["m_delivered", "m_dropped", "m_pending"]);
  });

  it("resets the seen set when team_created rebuilds the team (old ids do not leak into the new team)", () => {
    // 同会话重建 team（abandon 后再建）：旧 team 的 messageId 不参与新 team 对账
    // ——旧集重置；新 team 内的条目正常入集。
    const events: TeamJournalEvent[] = [
      created(1, "team_old"),
      mailEvent(2, "m_old_team"),
      created(3, "team_new"),
      mailEvent(4, "m_new_team"),
    ];
    const { appendedMessageIds } = replayTeamJournal(events);
    expect([...appendedMessageIds]).toEqual(["m_new_team"]);
  });
});

// ---------- 2026-10-27 终报链修复批（journal 侧：L4 manager 口径 + M12 终局重放推导）----------

describe("replay busy derivation excludes the manager (2026-10-27 L4, §22 口径对齐)", () => {
  const AT = "2026-10-27T00:00:00.000Z";

  it("a manager still in its spawning placeholder does not pin the restored team active", () => {
    // crash 窗口事实流：approved 已落、manager 的 member_added 未刷盘——manager 保持
    // pending_ 占位（重放的 spawning 态），workers 已全部真实出生（重放统一终态化）。
    // 修复前 derivedActiveIdle 不排除 manager：busy 误判 active，与 hub
    // hasWorkingMember 的 §22 口径分叉（workers 全终态应 idle——终报派发边缘挂
    // idle，分叉会让恢复后的团队永不再触发派发）。
    const events: TeamJournalEvent[] = [
      {
        seq: 1,
        at: AT,
        payload: {
          kind: "team_created",
          teamId: "team_l4",
          leadSessionId: "lead_s1",
          managerName: "morgana",
          createdAt: AT,
        },
      },
      {
        seq: 2,
        at: AT,
        payload: {
          kind: "staged",
          teamId: "team_l4",
          managerName: "morgana",
          awaitingFeedback: false,
          members: [{ memberName: "morgana" }, { memberName: "alice" }],
          tasks: [],
        },
      },
      { seq: 3, at: AT, payload: { kind: "approved", teamId: "team_l4" } },
      {
        seq: 4,
        at: AT,
        payload: {
          kind: "member_added",
          teamId: "team_l4",
          memberName: "alice",
          agentId: "agent_alice",
          childSessionId: "child_alice",
        },
      },
    ];
    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    expect(record!.status).toBe("idle"); // 修复前：manager 的 spawning 占位 → active
  });
});

describe("replay busy derivation filters off-roster recipients (2026-10-27 M3 口径对齐)", () => {
  const AT = "2026-10-27T00:00:00.000Z";

  it("an undelivered entry addressed to a removed member does not pin the restored team active", () => {
    // crash 窗口：bob 已移除、其滞留邮件的 message_dropped 事实未刷盘——重放邮箱含
    // to=bob 的未投条目。hub 侧 busy 谓词按收件人在册过滤（M3 isRecipientOnRoster）；
    // 重放侧同口径（recipientOnRoster），否则未终报未派发的恢复团队得到重放 active /
    // 运行态 idle 的分叉初值。
    const events: TeamJournalEvent[] = [
      {
        seq: 1,
        at: AT,
        payload: {
          kind: "team_created",
          teamId: "team_dead",
          leadSessionId: "lead_s1",
          managerName: "morgana",
          createdAt: AT,
        },
      },
      {
        seq: 2,
        at: AT,
        payload: {
          kind: "staged",
          teamId: "team_dead",
          managerName: "morgana",
          awaitingFeedback: false,
          members: [{ memberName: "morgana" }, { memberName: "alice" }, { memberName: "bob" }],
          tasks: [],
        },
      },
      { seq: 3, at: AT, payload: { kind: "approved", teamId: "team_dead" } },
      {
        seq: 4,
        at: AT,
        payload: {
          kind: "member_added",
          teamId: "team_dead",
          memberName: "alice",
          agentId: "agent_alice",
          childSessionId: "child_alice",
        },
      },
      {
        seq: 5,
        at: AT,
        payload: {
          kind: "member_added",
          teamId: "team_dead",
          memberName: "bob",
          agentId: "agent_bob",
          childSessionId: "child_bob",
        },
      },
      {
        seq: 6,
        at: AT,
        payload: { kind: "member_removed", teamId: "team_dead", memberName: "bob" },
      },
      {
        seq: 7,
        at: AT,
        payload: {
          kind: "message_appended",
          teamId: "team_dead",
          entry: {
            messageId: "m_stale",
            from: "alice",
            to: "bob",
            message: "stale mail to a removed recipient",
            at: AT,
            deliveredAccepted: false,
          },
        },
      },
    ];
    const { record } = replayTeamJournal(events);
    expect(record).toBeDefined();
    expect(record!.status).toBe("idle"); // 修复前：离册收件人的滞留条目被计忙 → active
  });
});

describe("final-report finale status replay derivation (2026-10-27 M12-core, 决策 D3)", () => {
  const AT = "2026-10-27T00:00:00.000Z";

  function finaleEvents(
    taskStatus: "completed" | "failed" | "cancelled",
    extra: TeamJournalEvent[] = [],
  ): TeamJournalEvent[] {
    const taskFact = (
      status: "pending" | "completed" | "failed" | "cancelled",
    ) => ({
      taskId: "t1",
      title: "t1",
      spec: { goal: "g", acceptance: ["a"] },
      status,
      attempt: 1,
      dependsOn: [],
      artifactRefs: [],
      createdAt: AT,
      updatedAt: AT,
    });
    return [
      {
        seq: 1,
        at: AT,
        payload: {
          kind: "team_created",
          teamId: "team_fin",
          leadSessionId: "lead_s1",
          managerName: "morgana",
          createdAt: AT,
        },
      },
      {
        seq: 2,
        at: AT,
        payload: {
          kind: "staged",
          teamId: "team_fin",
          managerName: "morgana",
          awaitingFeedback: false,
          members: [{ memberName: "morgana" }, { memberName: "alice" }],
          tasks: [taskFact("pending")],
        },
      },
      { seq: 3, at: AT, payload: { kind: "approved", teamId: "team_fin" } },
      {
        seq: 4,
        at: AT,
        payload: {
          kind: "task_updated",
          teamId: "team_fin",
          task: taskFact(taskStatus),
        },
      },
      // 评审修正：worker 的 member_added 必在场——否则 alice 保持 pending_/spawning
      // 占位（finalizeMemberStates 跳过 pending_ 前缀），busy 推导按既有语义正确计忙，
      // 「无送达事实维持 idle」的用例会被夹具自身弄红（非 L4/M12 修复缺陷）。
      {
        seq: 5,
        at: AT,
        payload: {
          kind: "member_added",
          teamId: "team_fin",
          memberName: "alice",
          agentId: "agent_alice",
          childSessionId: "child_alice",
        },
      },
      ...extra,
      { seq: 99, at: AT, payload: { kind: "final_report_delivered", teamId: "team_fin" } },
    ];
  }

  it("final_report_delivered + a completed/failed task derives status completed (no new journal kinds)", () => {
    const { record: completed } = replayTeamJournal(finaleEvents("completed"));
    expect(completed!.status).toBe("completed");
    // 失败结论的收尾汇报亦是完成（全 failed ≠ 全 cancelled）。
    const { record: failed } = replayTeamJournal(finaleEvents("failed"));
    expect(failed!.status).toBe("completed");
  });

  it("final_report_delivered with every task cancelled derives status cancelled", () => {
    const { record } = replayTeamJournal(finaleEvents("cancelled"));
    expect(record!.status).toBe("cancelled");
  });

  it("without the delivered fact the derivation stays in the busy family (idle), and halted still wins", () => {
    // 无送达事实：终态团队照旧推导 idle（completed 不得凭任务分布凭空出现）。
    const withoutDelivered = finaleEvents("completed").filter(
      (event) => event.payload.kind !== "final_report_delivered",
    );
    const { record } = replayTeamJournal(withoutDelivered);
    expect(record!.status).toBe("idle");
    // frozen（halted 最后事实）优先于终局推导——防御性保持（事实序上送达后端口
    // 全关，冻结后置不可达）。
    const halted = replayTeamJournal([
      ...finaleEvents("completed"),
      { seq: 100, at: AT, payload: { kind: "halted", teamId: "team_fin" } },
    ]);
    expect(halted.record!.status).toBe("halted");
  });
});

// ---------- 2026-10-27 M8（决策 D7）：approved 事实的 permissionMode 重放回写 ----------

describe("approved fact writes back the approval-time permissionMode on replay (M8/决策 D7)", () => {
  it("批准覆写 → 冷恢复重放回写批准值，不回退建队捕获值", async () => {
    const store = createMemorySessionStore();
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "lead_s1" });
    const warns: string[] = [];
    const spawn = makeConfirmingSpawn();
    const hub = new TeamHub({
      clock: makeClock(),
      spawnMembers: spawn.forward,
      leadPermissionMode: "build", // 建队捕获值
      journalWriter: (event) => sink.append(event),
    });
    spawn.bind(hub);
    hub.stageTeam("lead_s1", STAGE_INPUT);
    // §10 增补三：批准时刻覆写（经 port 携带 options，L9）
    const approved = await hub.leadPort("lead_s1").approveStage({ permissionMode: "yolo" });
    expect(approved.status).toBe("ok");
    await sink.flush();

    const events = await journalEventsOf(store, (message) => warns.push(message));
    expect(warns).toEqual([]);
    // 事实面：approved 事实携带覆写值（M8）
    const approvedFact = events.find((event) => event.payload.kind === "approved") as {
      payload: { permissionMode?: string };
    };
    expect(approvedFact?.payload.permissionMode).toBe("yolo");

    // 重放回写：恢复后的 record 保持批准值（修复前回退 team_created 的 build）
    const { record } = replayTeamJournal(events);
    expect(record!.permissionMode).toBe("yolo");
  });

  it("approved 事实无 permissionMode 键（legacy 流）→ 维持建队捕获值；未知值 warn + 缺席", () => {
    const base: TeamJournalEvent[] = [
      {
        seq: 1,
        at: "t0",
        payload: {
          kind: "team_created",
          teamId: "team_x",
          leadSessionId: "lead_s1",
          permissionMode: "guarded",
          createdAt: "t0",
        },
      },
      { seq: 2, at: "t0", payload: { kind: "approved", teamId: "team_x" } },
    ];
    expect(replayTeamJournal(base).record!.permissionMode).toBe("guarded");

    const warns: string[] = [];
    // 未知模式值（旧版本/损坏流）：结构守卫通过（string），重放 warn + 缺席不猜语义。
    const withUnknown: TeamJournalEvent[] = [
      ...base,
      {
        seq: 3,
        at: "t0",
        payload: {
          kind: "approved",
          teamId: "team_x",
          permissionMode: "wild-mode",
        } as unknown as TeamJournalEvent["payload"],
      },
    ];
    const unknown = replayTeamJournal(withUnknown, (message) => warns.push(message));
    expect(unknown.record!.permissionMode).toBe("guarded"); // 不猜语义（spec §8.1）
    expect(warns.join("\n")).toContain("wild-mode");
  });
});
