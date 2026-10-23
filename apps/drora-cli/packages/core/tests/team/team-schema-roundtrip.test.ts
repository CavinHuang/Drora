import { describe, expect, it } from "vitest";
import {
  COMMANDS_REQUIRING_BASE_REVISION,
  TEAM_COMMAND_PAYLOAD_SCHEMAS,
  TEAM_SNAPSHOT_KEY,
  TEAM_V4_COMMAND_TYPES,
  commandTypeSchema,
  conversationSnapshotSchema,
  parseCommandEnvelope,
  statePatchSchema,
  teamProjectionStateSchema,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import { TeamHub } from "../../src/team/hub.js";
import { projectTeam } from "../../src/team/projection.js";

/**
 * PR-2.1 黄金测试（design §7 M2 验收 / §8.3）：team 投影 schema round-trip、
 * 旧快照（无 team 字段）解析不破坏、非 strict 容器剥 team 键保其余键、
 * 八条团队命令 payload 合法样例。被测面主体在 @drora/shared（纯 schema）；
 * 用例 a′ 是唯一例外（specs/agents-team.md §19 契约 2 测试要求）：经真实
 * stageTeam 落库 + projectTeam 走完投影链再过 wire schema。
 */

/** active 态全量样本：members 全可选字段、board 覆盖 attempt 字段族与 contract 预留、邮箱尾窗两态。 */
const activeTeam: TeamProjectionState = {
  teamId: "team-abc123",
  name: "重构小队",
  status: "active",
  permissionMode: "build",
  members: [
    {
      agentId: "agent-1",
      memberName: "explorer",
      profile: "explore",
      profileColor: "#4f8ef7",
      state: "working",
      currentTaskId: "task-1",
      childSessionId: "child-session-1",
    },
    { agentId: "agent-2", memberName: "writer", state: "terminal" },
  ],
  board: {
    limit: 100,
    tasks: [
      {
        taskId: "task-1",
        title: "调研模块边界",
        spec: {
          goal: "产出模块清单",
          acceptance: ["覆盖 core/shared", "结论引用 path:line"],
          outputFormat: "markdown",
        },
        status: "in_progress",
        assignee: "explorer",
        attempt: 2,
        attemptId: "attempt-uuid-2",
        dependsOn: [],
        artifactRefs: [".drora/team-artifacts/team-abc123/notes.md"],
        createdAt: "2026-10-17T08:00:00.000Z",
        updatedAt: "2026-10-17T08:30:00.000Z",
        recoveryRetried: true,
        contract: {
          objective: "给出可同步的边界清单",
          acceptance: ["逐条带 path:line"],
          inScope: ["packages/shared/**"],
          outOfScope: ["packages/ui/**"],
          verify: "grep 对口径",
          kind: "research",
        },
      },
      {
        taskId: "task-2",
        title: "汇总结论",
        spec: { goal: "汇总一行结论", acceptance: ["一行结论"] },
        status: "pending",
        attempt: 0,
        dependsOn: ["task-1"],
        artifactRefs: [],
        createdAt: "2026-10-17T08:00:00.000Z",
        updatedAt: "2026-10-17T08:00:00.000Z",
      },
    ],
  },
  mailboxTail: [
    {
      messageId: "msg-1",
      from: "lead",
      to: "explorer",
      summary: "先读 spec §6.3",
      at: "2026-10-17T08:01:00.000Z",
      sourceTaskId: "task-1",
      sourceAttemptId: "attempt-uuid-1",
      delivered: true,
    },
    {
      messageId: "msg-2",
      from: "explorer",
      to: "writer",
      at: "2026-10-17T08:02:00.000Z",
      delivered: false,
    },
  ],
  artifacts: { dir: ".drora/team-artifacts/team-abc123" },
};

/** staged 态样本：零成员 + 草案（成员行含 modelSelection 路由快照）覆盖 stagedDraft 全字段。 */
const stagedTeam: TeamProjectionState = {
  teamId: "team-def456",
  status: "staged",
  members: [],
  board: { limit: 100, tasks: [] },
  mailboxTail: [],
  stagedDraft: {
    draftMembers: [
      {
        memberName: "reader",
        profile: "explore",
        modelSelection: { provider: "provider-a", model: "model-a", thought: "high" },
      },
      { memberName: "writer" },
    ],
    draftTasks: [
      { taskId: "draft-1", title: "草案任务", assignee: "reader", dependsOn: [] },
      { taskId: "draft-2", title: "草案任务二", dependsOn: ["draft-1"] },
    ],
    awaitingFeedback: true,
  },
};

/** 旧一代快照（无任何 team 键）：v4 冻结面的最小合法 A 区。 */
const legacySnapshot = {
  protocolVersion: 1,
  sessionId: "session-1",
  logEpoch: "epoch-1",
  seq: 0,
  revision: 0,
  control: {
    phase: "draft",
    sessionEnded: false,
    canStop: false,
    stopState: "idle",
    stopTargetKind: "unknown",
    activeWorks: [],
    lastError: null,
    apiRetry: null,
  },
  availability: {
    fork: { allowed: true },
    compact: { allowed: true },
    switchModelConfig: { allowed: true },
    setFollowupMode: { allowed: true },
    queueEdit: { allowed: true },
    sendQueuedNow: { allowed: true },
    pauseGoal: { allowed: true },
    resumeGoal: { allowed: true },
  },
  inputRouting: { mode: "startNow" },
  config: { provider: "provider-a", model: "model-a", thought: "", followupMode: "queue" },
  usage: {
    contextWindow: null,
    cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  },
  queue: { items: [], autoDrain: true },
  pendingInteractions: [],
  pendingCommands: [],
  backgroundWorks: [],
  goal: null,
  plan: null,
  rows: { window: [], totalCount: 0, firstRowId: null },
};

describe("team 投影 schema round-trip（PR-2.1 黄金测试）", () => {
  it("a) 全量 team 状态 safeParse 往返一致（active / staged 两态 + JSON wire 往返）", () => {
    for (const fixture of [activeTeam, stagedTeam]) {
      const parsed = teamProjectionStateSchema.safeParse(fixture);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      // 解析输出再解析：幂等（归一化不改数据）。
      const reparsed = teamProjectionStateSchema.safeParse(parsed.data);
      expect(reparsed.success).toBe(true);
      if (!reparsed.success) continue;
      expect(reparsed.data).toEqual(parsed.data);
      // wire 序列化（JSON）后再解析：不变。
      const viaWire = teamProjectionStateSchema.safeParse(JSON.parse(JSON.stringify(fixture)));
      expect(viaWire.success).toBe(true);
      if (!viaWire.success) continue;
      expect(viaWire.data).toEqual(parsed.data);
    }
    // 任务卡（含 attempt 字段族）往返后不携带内部交接态：handoffId/reassigning 不在 wire 卡上。
    const card = teamProjectionStateSchema.parse(activeTeam).board.tasks[0];
    if (!card) throw new Error("fixture board.tasks[0] missing");
    expect(card.attempt).toBe(2);
    expect(card.attemptId).toBe("attempt-uuid-2");
    expect(card.recoveryRetried).toBe(true);
    expect("handoffId" in card).toBe(false);
    expect("reassigning" in card).toBe(false);
  });

  it("a′) §19 契约 2：含无 profile/空白 thought 成员的草案经 stageTeam→projectTeam 后 wire parse 通过", () => {
    // 唯一运行时参与用例：stageTeam 是空白归一唯一所有者（specs/agents-team.md
    // §19 契约 2②）——模型合法省略/空白 profile 与 thought 落库后必须键缺席，
    // 否则 wire 对 members[].profile / stagedDraft thought 的 min(1) 被空串击穿，
    // 投影每一帧被渲染器按 proto.frameAssemblyInvalidPayload 拒帧（§17 契约 4 烧帧）。
    const hub = new TeamHub({
      clock: { now: () => "2026-10-23T00:00:00.000Z", newId: () => "id_1" },
    });
    expect(
      hub.stageTeam("lead_s1", {
        name: "burn-guard",
        draftMembers: [
          { memberName: "alice", profile: "" },
          {
            memberName: "bob",
            modelSelection: { provider: "provider-a", model: "model-a", thought: "   " },
          },
        ],
        draftTasks: [{ title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [] }],
      }).status,
    ).toBe("ok");
    const roster = hub.snapshot();
    const board = hub.board();
    if (roster === undefined || board === undefined) throw new Error("hub snapshot/board missing");
    const projection = projectTeam({
      teamId: roster.teamId,
      ...(roster.name === undefined ? {} : { name: roster.name }),
      status: roster.status,
      members: roster.members,
      tasks: board.tasks,
      mailbox: [],
    });
    // 修复前：profile:"" 在场时此行即抛（= 渲染器 fail-closed 烧帧白屏的测试面表达）。
    const parsed = teamProjectionStateSchema.parse(projection);
    for (const member of parsed.members) {
      expect(member.profile === undefined || member.profile.trim().length > 0).toBe(true);
    }
    // 归一保留非空白事实：alice 无 profile 键；bob 的 modelSelection 剥空白 thought。
    const alice = parsed.members.find((member) => member.memberName === "alice");
    expect("profile" in (alice ?? {})).toBe(false);
    const bob = parsed.stagedDraft?.draftMembers.find((member) => member.memberName === "bob");
    expect(bob?.modelSelection).toEqual({ provider: "provider-a", model: "model-a" });
  });

  it("b) 旧快照兼容：不含 team 字段的快照 / delta patch 解析不破坏", () => {
    const snapshot = conversationSnapshotSchema.safeParse(legacySnapshot);
    expect(snapshot.success).toBe(true);
    if (snapshot.success) {
      expect(TEAM_SNAPSHOT_KEY in snapshot.data).toBe(false);
    }
    // delta：旧端 patch 无 team 键，照常解析（键集合封闭、缺席合法）。
    const patch = statePatchSchema.safeParse({ revision: 3 });
    expect(patch.success).toBe(true);
    if (patch.success) {
      expect(patch.data[TEAM_SNAPSHOT_KEY]).toBeUndefined();
    }
  });

  it("b′) 新端冷快照携带 team：整字段随快照解析回来", () => {
    // 「冷快照必须携带」是投影产出侧的义务（PR-2.3 桥负责必带）；这里锁定的是
    // schema 面：带 team 的快照必须原样解析回来，而非被剥掉或解析失败。
    const snapshot = conversationSnapshotSchema.safeParse({
      ...legacySnapshot,
      [TEAM_SNAPSHOT_KEY]: activeTeam,
    });
    expect(snapshot.success).toBe(true);
    if (!snapshot.success) return;
    expect(snapshot.data[TEAM_SNAPSHOT_KEY]).toEqual(activeTeam);
  });

  it("c) 新端发 team 键、旧容器剥离：非 strict 容器剥 team 键后其余键完好（delta.ts 注释语义）", () => {
    const patch = {
      revision: 7,
      usage: {
        contextWindow: null,
        cumulative: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      },
      plan: null,
      [TEAM_SNAPSHOT_KEY]: activeTeam,
    };
    // 新端 schema：team 键整体替换进入 patch。
    const parsed = statePatchSchema.safeParse(patch);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.revision).toBe(7);
    expect(parsed.data[TEAM_SNAPSHOT_KEY]).toEqual(activeTeam);
    // 旧端容器 = 不认识 team 键的那一代 statePatchSchema（omit 派生模拟旧编译产物）。
    // z.object 非 strict 的剥离语义：未知键被剥掉，其余键完好、整帧不失败。
    const legacyPatchSchema = statePatchSchema.omit({ [TEAM_SNAPSHOT_KEY]: true });
    const legacyParsed = legacyPatchSchema.safeParse(patch);
    expect(legacyParsed.success).toBe(true);
    if (!legacyParsed.success) return;
    expect(legacyParsed.data[TEAM_SNAPSHOT_KEY]).toBeUndefined();
    expect(legacyParsed.data.revision).toBe(7);
    expect(legacyParsed.data.usage).toEqual(patch.usage);
    expect(legacyParsed.data.plan).toBeNull();
    expect(Object.keys(legacyParsed.data).sort()).toEqual(["plan", "revision", "usage"]);
  });
});

describe("八条团队 v4 命令 payload（design §6.2）", () => {
  const samples: Record<(typeof TEAM_V4_COMMAND_TYPES)[number], unknown> = {
    approveTeamPlan: {},
    reviseTeamPlan: { note: "把 writer 的任务拆小一点" },
    abandonTeamPlan: {},
    sendTeamMessage: { to: "explorer", message: "请把验收标准写成可 grep 的断言" },
    stopTeamMember: { memberName: "writer", reason: "方向变了" },
    setTeamMemberName: { memberName: "writer", newName: "composer" },
    haltTeam: { reason: "先看阶段结论" },
    resumeTeam: { reason: "用户确认继续" },
  };

  it("d) 八条命令 payload 各一条合法样例解析通过", () => {
    expect(TEAM_V4_COMMAND_TYPES).toHaveLength(8);
    for (const type of TEAM_V4_COMMAND_TYPES) {
      const parsed = TEAM_COMMAND_PAYLOAD_SCHEMAS[type].safeParse(samples[type]);
      expect(parsed.success, `${type} payload should parse`).toBe(true);
    }
  });

  it("d′) 八条已挂进命令全集，且全部不入 CAS 集合（非行级，design §6.2 归类）", () => {
    for (const type of TEAM_V4_COMMAND_TYPES) {
      expect(commandTypeSchema.safeParse(type).success).toBe(true);
      expect(COMMANDS_REQUIRING_BASE_REVISION.has(type)).toBe(false);
    }
    // 信封级端到端：parseCommandEnvelope 按 type 路由到挂载后的 payload schema。
    const envelope = parseCommandEnvelope({
      commandId: "cmd-1",
      clientId: "client-1",
      sessionId: "session-1",
      type: "resumeTeam",
      payload: { reason: "用户确认继续" },
      issuedAt: 1_760_000_000_000,
    });
    expect(envelope.ok).toBe(true);
  });
});
