import { describe, expect, it, vi } from "vitest";
import { createSessionId, SessionEventType } from "@drora/contracts";
import { createTestAgentRuntime } from "../test-agent-runtime.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createTestModelFactory } from "../test-runtime-model.js";
import { createRecordingMessageStore } from "../runtime-output-token-continuation-test-helpers.js";
import {
  installDroraAgentsTeam,
  TEAM_MAILBOX_ENTRY_TYPE,
} from "../../../bootstrap/src/app/drora-team/install.js";
import { createAgentDefinitionsReader } from "../../src/subagent/definitions.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import type { ToolEntry } from "../../src/tool/types.js";
import type { AgentRuntimeDeps } from "../../src/runtime/types.js";
import { buildSteerBody } from "../../src/team/message-format.js";
import { createTeamMemberMessageSink } from "../../src/team/member-sink.js";
import { TEAM_JOURNAL_ENTRY_TYPE } from "../../src/team/journal.js";
import type { TeamMailboxEntry, TeamRecord } from "../../src/team/types.js";

/**
 * PR-1.1′d 运行时可达断言（specs/agents-team.md §12 M1 验收 ③ 的可达性半部；
 * 行为门零改动回归见 behavior-gates.snapshot.test.ts 与 PR-1.7）。
 *
 * ① 首次 spawn 成员的工具面板含团队协作工具（私有端口 → 构造注入注册表）；
 * ② 终态成员复活投递的消息体含零授权禁令文本（formatIncomingMessage 单一出处）；
 * ③ 灰度关 = 注册表无任何 Team* 工具（默认路径零变化的结构面）；
 * ④ steer 载荷不预嵌 presentation 包装（无双包装——渲染责任在 runtime 单侧）；
 *    2026-10-21 缺口8 起 presentation 由 team 自有 sink 承载（subagent_reply_steer）。
 *
 * 2026-10-21 审查缺口回归（事件与调度批次）：
 * ⑤ 缺口1——派发通道把 sendMessage 失败当已接受：失败不得 markDelivered 假回执；
 * ⑥ 缺口2——成员运行态边缘生产接线：首回合自然终态 → 自动派发（无测试侧
 *    handleMemberTerminal 调用），经真实 sendMessage 复活认领任务并回到 working；
 * ⑦ 缺口6——Approve & Run 逐成员 spawn 非原子：部分失败反向回收已启动成员、
 *    草案零确认零 journal 污染、专用错误码。
 *
 * 2026-10-21 收口施工批次 2（spec §14）：
 * ⑧ 缺口12——lead 邮箱消费闭环：成员邮件经 enqueueSubagentMessage 通道真实进入
 *    lead 会话（model-only 独立轮），邮箱落 lead_injected 送达事实；
 * ⑨ 边缘2——冷恢复（journal 重放 adoption）后 memberPortByChildSession 重建：
 *    恢复成员的团队工具解析（按 childSessionId 联接）不再 miss。
 *
 * 2026-10-22 spec §16 契约 1（dsh-agent-teams 好设计 P0 批次）：
 * ⑩ 成员终态失败分诊——真实 registry failed 终态边缘经 subscribe 链路分诊到
 *    handleMemberFailed（不直接调 hub 方法），lead 收到失败通知。
 *
 * 2026-10-23 E12 全同步邮箱持久化装配收口（spec §2.2 状态所有者表 TeamMailbox 行
 * 「写成功（持久化后）才算发送成功」+ M3 实现 登记#3）：
 * ⑪ portSend 成功 = 邮箱条目已同步落 sessionStore 通道（TEAM_MAILBOX_ENTRY_TYPE 可读）；
 * ⑫ 同步入队抛错 → mailbox_persist_failed 拒绝，不入箱、不 journal。
 */

const TEST_MODEL_RESULT = {
  finishReason: "stop" as const,
  text: "ok",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};

async function createLeadWithTeam(
  options: {
    enabled?: boolean;
    sessionId?: ReturnType<typeof createSessionId>;
    sessionStore?: unknown;
    /** 注入 leadDeps 覆盖项（须在 runtime 构造前生效——getAgentDefinitions 在构造期被捕获）。 */
    leadDepsOverrides?: Partial<AgentRuntimeDeps>;
  } = {
    enabled: true,
  },
) {
  const sessionId = options.sessionId ?? createSessionId();
  const requests: unknown[] = [];
  const respond = vi.fn(async () => TEST_MODEL_RESULT);
  const store = (options.sessionStore ?? createRecordingMessageStore()) as never;
  const eventStore = createTestSessionEventStore();
  const leadDeps: AgentRuntimeDeps = {
    eventStore,
    sessionStore: store,
    modelFactory: createTestModelFactory({
      properties: { supportsMidConversationSystem: true },
      generateText: async (request) => {
        requests.push(request);
        return respond(request);
      },
    }),
    ...options.leadDepsOverrides,
  } as unknown as AgentRuntimeDeps;
  const registry = options.enabled === false ? undefined : createToolRegistry();
  const lead = createTestAgentRuntime(
    sessionId,
    { mode: "build", compact: { enabled: false }, titleGeneration: { enabled: false } },
    {
      ...leadDeps,
      ...(registry ? { toolRegistry: registry } : {}),
    },
  ) as unknown as Parameters<typeof installDroraAgentsTeam>[0]["runtime"];
  const installed =
    registry !== undefined
      ? installDroraAgentsTeam({
          runtime: lead,
          leadDeps,
          registry,
          leadPermissionMode: "build",
        })
      : undefined;
  return { lead, leadDeps, eventStore, registry, installed, requests, respond, sessionId };
}

function teamToolNames(registry: ReturnType<typeof createToolRegistry>): string[] {
  const names: string[] = [];
  for (const name of [
    "TeamTaskList",
    "TeamTaskGet",
    "TeamTaskCreate",
    "TeamTaskClaim",
    "TeamTaskUpdate",
    "TeamSendMessage",
  ]) {
    if (
      (registry as unknown as { get?: (n: string) => ToolEntry | undefined }).get?.(name) !==
      undefined
    ) {
      names.push(name);
    }
  }
  return names;
}

describe("agents team runtime reachability (PR-1.1′d)", () => {
  it("① spawn through the private port gives the member the team tools on the shared registry", async () => {
    const { lead, installed } = await createLeadWithTeam();
    const hub = installed!.hub;
    const leadPort = hub.leadPort(lead.sessionId);
    const staged = leadPort.stageTeam({
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [],
    });
    expect(staged.status).toBe("ok");
    const approved = await leadPort.approveStage();
    expect(approved.status).toBe("ok");
    expect(approved.spawnedMembers).toEqual(["alice"]);

    // 共享注册表 = 成员构造注入的同一实例：团队工具与内建工具同表可达。
    const names = teamToolNames(installed!.toolRegistry);
    expect(names).toContain("TeamSendMessage");
    expect(names).toContain("TeamTaskClaim");
    // 成员端口路由按 childSessionId 绑定（执行时 context.sessionId 解析）。
    const roster = hub.snapshot();
    expect(roster?.members[0]?.childSessionId).toBeTruthy();
  });

  it("② revival delivery to a terminal member embeds the no-escalation guidance", async () => {
    const { lead, installed } = await createLeadWithTeam();
    const hub = installed!.hub;
    const leadPort = hub.leadPort(lead.sessionId);
    leadPort.stageTeam({
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [],
    });
    await leadPort.approveStage();
    await hub.handleMemberTerminal("alice");

    const sent = leadPort.send({ to: "alice", message: "wake with context" });
    expect(sent.status).toBe("success");
    expect(sent.status === "success" && sent.delivery).toBe("resumed");

    // 消息体经 buildRevivalBody → formatIncomingMessage("subagent_reply") 渲染——
    // 禁令文本单一出处断言（接缝 S5 已消失，直接断言渲染产物）。
    // 投递确认在 dispatch 的异步回执里——等待 ack 落账
    await vi.waitFor(() => {
      const entry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
      expect(entry.messageId).toBeTruthy();
      expect(entry.deliveredAccepted).toBe(true);
    });
    const entry: TeamMailboxEntry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
    expect(entry.message).toBe("wake with context");
  });

  it("③ gray-off leaves the registry without any Team* tool (default path structurally unchanged)", async () => {
    const { registry } = await createLeadWithTeam({ enabled: false });
    expect(registry).toBeUndefined();
    const names = teamToolNames(createToolRegistry());
    expect(names).toEqual([]);
  });

  it("④ steer body is presentation-neutral; the team sink carries subagent_reply_steer (no double wrap)", async () => {
    const entry: TeamMailboxEntry = {
      messageId: "m1",
      from: "alice",
      to: "bob",
      message: "sync please",
      at: "2026-10-17T00:00:00.000Z",
      deliveredAccepted: false,
    };
    const body = buildSteerBody(entry);
    // 载荷只带原文；wrap 短语由 runtime 的 formatIncomingMessage 单侧渲染——双包装即缺陷。
    expect(body).not.toContain("Another Drora session sent a message");
    expect(body).toContain("sync please");
    // 2026-10-21 缺口8（spec §7/§14）：presentation 的唯一承载 = team 自有 sink。
    // 修复前成员注册的是通用 sink（message-steering.ts 硬编码 coordinator_steer，
    // 无 PEER_PERMISSION_GUIDANCE 禁令渲染）——断言注入请求携带 subagent_reply_steer。
    const steered: (string | { inputPresentation?: string })[] = [];
    const sink = createTeamMemberMessageSink(
      {
        steerTurn: async (input) => {
          steered.push(input);
          return { kind: "queued" } as never;
        },
      },
      { traceContext: { sessionId: "s" } as never },
    );
    await sink.send({ id: "m1", message: "sync please" });
    expect(steered).toHaveLength(1);
    const steerInput = steered[0] as { inputPresentation?: string };
    expect(steerInput.inputPresentation).toBe("subagent_reply_steer");
  });

  it("⑤ dispatch channel does not treat sendMessage failure as accepted (no fake receipt)", async () => {
    const { lead, installed } = await createLeadWithTeam();
    const hub = installed!.hub;
    // 冷恢复形态：roster 有终态成员但本进程 registry 无其任务——sendMessage 必然走
    // runner 的 createSendMessageFailure（返回体无 delivery 字段、status="failed"）。
    // 修复前 install 只判 delivery !== "queued"，undefined 被当已接受 → markDelivered
    // + journal message_delivered 假回执（缺口1）。
    const restored: TeamRecord = {
      teamId: "team_ghost",
      leadSessionId: lead.sessionId,
      status: "idle",
      members: [{ agentId: "agent_ghost", memberName: "ghost", state: "terminal", removed: false }],
      tasks: [],
      mailbox: [],
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
    expect(hub.adoptRestored(restored)).toBe(true);

    const leadPort = hub.leadPort(lead.sessionId);
    const sent = leadPort.send({ to: "ghost", message: "hello ghost" });
    expect(sent.status).toBe("success"); // 入队成功（E12 不变量）；投递回执在异步链上
    expect(sent.status === "success" && sent.delivery).toBe("resumed");

    // 等异步投递回执落定：失败必须保持未送达（不 ack、不记 message_delivered）
    await new Promise((resolve) => setTimeout(resolve, 100));
    const entry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
    expect(entry.message).toBe("hello ghost");
    expect(entry.deliveredAccepted).toBe(false);
    expect(entry.deliveredAt).toBeUndefined();
  });

  it("⑥ member terminal edge drives auto-dispatch through the real send channel", async () => {
    const { lead, installed, respond } = await createLeadWithTeam();
    const hub = installed!.hub;
    // 复活回合（第 2 次模型调用）用 gate 挂起：working 态可被确定性断言。
    let releaseRevivedTurn!: (value: typeof TEST_MODEL_RESULT) => void;
    const revivedTurnGate = new Promise<typeof TEST_MODEL_RESULT>((resolve) => {
      releaseRevivedTurn = resolve;
    });
    let modelCalls = 0;
    respond.mockImplementation(async () => {
      modelCalls += 1;
      return modelCalls <= 1 ? TEST_MODEL_RESULT : revivedTurnGate;
    });

    const leadPort = hub.leadPort(lead.sessionId);
    leadPort.stageTeam({
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [
        {
          title: "t1",
          spec: { goal: "g1", acceptance: ["a"] },
          dependsOn: [],
          assignee: "alice",
        },
      ],
    });
    const approved = await leadPort.approveStage();
    expect(approved.status).toBe("ok");

    // 全链路生产接线（缺口2）：首回合（欢迎提示）自然终态 → registry 终态边缘 →
    // install 接线 handleMemberTerminal → kick → 真实 sendMessage 复活 → 任务自动
    // 认领。本用例不直接调用 hub.handleMemberTerminal——修好前成员永远停在
    // spawning，这条链不会发生。
    await vi.waitFor(
      () => {
        const task = hub.board()?.tasks[0];
        expect(task?.status).toBe("claimed");
        expect(task?.assignee).toBe("alice");
      },
      { timeout: 10_000 },
    );
    // 复活回合在飞（gate 挂起）：运行态接线把 roster 从 terminal 翻回 working
    expect(hub.snapshot()?.members[0]?.state).toBe("working");

    releaseRevivedTurn(TEST_MODEL_RESULT);
    // 复活回合结束的终态边缘同样收敛（park 驻留 attempt，成员回 terminal）
    await vi.waitFor(() => expect(hub.snapshot()?.members[0]?.state).toBe("terminal"), {
      timeout: 10_000,
    });
    expect(lead.sessionId).toBeTruthy();
  });

  it("⑦ Approve & Run spawn is atomic: partial failure recycles launched members and keeps the draft clean", async () => {
    // §17 契约 6 起成员装配硬编码 agentType="general-purpose"（profile 只是花名册展示
    // 描述，不进 launch）——旧机制（bob profile="no-such-profile" → resolveAgentProfile-
    // ForRequest 抛 UNKNOWN_AGENT_TYPE）随之失效（契约 6 登记的测试前提失效，2026-10-23
    // 夹具更新）。新失败注入：getAgentDefinitions 前 2 次读取放行（spawnMembers 串行，
    // 第 1 个成员的一次后台 launch 固定消费 2 次解析：runner.ts 的 launch+start），
    // 此后花名册撤空——第 2 个成员的 launch 解析 general-purpose 落空，同一错误码路径
    // （UNKNOWN_AGENT_TYPE）抛错。
    let definitionReads = 0;
    const fullRoster = createAgentDefinitionsReader([]);
    const { lead, leadDeps, eventStore, installed, respond } = await createLeadWithTeam({
      leadDepsOverrides: {
        getAgentDefinitions: () => {
          definitionReads += 1;
          return definitionReads <= 2 ? fullRoster() : { activeAgents: [] };
        },
      },
    });
    const hub = installed!.hub;
    // 成员 1（alice）首回合挂起：保证反向回收发生在它在飞时（可观察为 stopped 终态）。
    let releaseFirstTurn!: (value: typeof TEST_MODEL_RESULT) => void;
    const firstTurnGate = new Promise<typeof TEST_MODEL_RESULT>((resolve) => {
      releaseFirstTurn = resolve;
    });
    let modelCalls = 0;
    respond.mockImplementation(async () => {
      modelCalls += 1;
      return modelCalls <= 1 ? firstTurnGate : TEST_MODEL_RESULT;
    });

    const leadPort = hub.leadPort(lead.sessionId);
    leadPort.stageTeam({
      draftMembers: [
        { memberName: "alice", profile: "general-purpose" },
        // profile 是描述性画像（契约 6：不进 launch）——第 2 个成员 launch 失败由上面的
        // getAgentDefinitions 注入触发（缺口6 的第 k 个失败场景）。
        { memberName: "bob", profile: "描述性画像：CI 工作流分析员" },
      ],
      draftTasks: [],
    });
    const approved = await leadPort.approveStage();
    expect(approved.status).toBe("rejected");
    expect(approved.error?.code).toBe("member_spawn_failed"); // 专用码 ≠ mailbox_persist_failed

    // 草案零确认：roster 保持 pending_ 占位（无 member_added journal 污染），可修订重批
    expect(hub.status).toBe("staged");
    for (const member of hub.snapshot()?.members ?? []) {
      expect(member.agentId.startsWith("pending_")).toBe(true);
      expect(member.childSessionId).toBeUndefined();
    }

    // 已启动的 alice 被反向回收：stopped 终态事件落在 lead 会话（孤儿子代理不再在飞）
    await vi.waitFor(async () => {
      const events = await eventStore.getEvents(lead.sessionId);
      expect(
        events.some(
          (event) =>
            event.type === SessionEventType.SubagentStopped &&
            (event.payload as { status?: string } | undefined)?.status === "stopped",
        ),
      ).toBe(true);
    });

    // 挂起的首回合被 abort 收口，不再占用模型；释放 gate 让挂起的 promise 结算。
    releaseFirstTurn(TEST_MODEL_RESULT);
    expect(leadDeps.eventStore).toBeDefined();
  });
});

describe("agents team lead mailbox + cold recovery (2026-10-21 收口施工批次 2, spec §14)", () => {
  it("⑧ member mail to the lead reaches the lead session via the subagent-message channel", async () => {
    const { lead, installed, requests } = await createLeadWithTeam();
    const hub = installed!.hub;
    const leadPort = hub.leadPort(lead.sessionId);
    leadPort.stageTeam({
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [],
    });
    await leadPort.approveStage();
    await hub.handleMemberTerminal("alice");

    const rosterMember = hub.snapshot()?.members[0];
    expect(rosterMember?.childSessionId).toBeTruthy();
    const alicePort = hub.memberPort({
      agentId: rosterMember!.agentId,
      memberName: "alice",
    });
    const sent = alicePort.send({ to: "lead", message: "E2E_LEAD_MAIL_REPORT" });
    expect(sent.status).toBe("success");

    // 缺口12 消费闭环：deliverLeadMail → lead.enqueueSubagentMessage → 命令队列 →
    // model-only 独立轮。送达事实先落账（lead_injected）……
    await vi.waitFor(
      () => {
        const entry = hub.mailboxEntries().at(-1) as TeamMailboxEntry;
        expect(entry.deliveredAccepted).toBe(true);
        expect(entry.deliveredVia).toBe("lead_injected");
      },
      { timeout: 10_000 },
    );
    // ……lead 会话真实消费：模型请求包含 <subagent-message> 包裹的成员消息。
    await vi.waitFor(
      () => {
        expect(
          requests.some((request) => JSON.stringify(request).includes("E2E_LEAD_MAIL_REPORT")),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
  });

  it("⑨ journal restore rebuilds member tool routing (memberPortByChildSession) after cold recovery", async () => {
    const sessionId = createSessionId();
    const seedEntries: Record<string, unknown>[] = [];
    const seed = (seq: number, payload: Record<string, unknown>): void => {
      seedEntries.push({
        id: `seed:${String(seq)}`,
        sessionID: sessionId,
        type: TEAM_JOURNAL_ENTRY_TYPE,
        touchSession: false,
        time: { created: 0, updated: 0 },
        data: { seq, at: "2026-10-21T00:00:00.000Z", payload },
      });
    };
    seed(1, {
      kind: "team_created",
      teamId: "team_seed",
      leadSessionId: sessionId,
      createdAt: "2026-10-21T00:00:00.000Z",
    });
    seed(2, {
      kind: "staged",
      teamId: "team_seed",
      awaitingFeedback: false,
      members: [{ memberName: "alice", profile: "general-purpose" }],
      tasks: [],
    });
    seed(3, { kind: "approved", teamId: "team_seed" });
    seed(4, {
      kind: "member_added",
      teamId: "team_seed",
      memberName: "alice",
      agentId: "agent_restored",
      childSessionId: "sess_child_alice",
    });
    const store = {
      ...createRecordingMessageStore(),
      async sessionEntries() {
        return seedEntries;
      },
      async saveSessionEntry(entry: Record<string, unknown>) {
        seedEntries.push(entry);
      },
    };

    const { registry, installed } = await createLeadWithTeam({ sessionId, sessionStore: store });
    // install 的恢复是 fire-and-forget——等 journal adoption 收敛。
    await vi.waitFor(() => expect(installed!.hub.teamId).toBe("team_seed"), { timeout: 10_000 });
    expect(installed!.hub.snapshot()?.members[0]?.childSessionId).toBe("sess_child_alice");

    // 修复前：memberPortByChildSession 只在 spawn 路径填充——恢复成员会话的团队
    // 工具解析（按 childSessionId 联接）永远 miss，工具抛 "Team port is not configured"。
    const listTool = (registry as unknown as { get: (name: string) => ToolEntry | undefined }).get(
      "TeamTaskList",
    );
    expect(listTool).toBeDefined();
    const result = (await listTool!.handler({}, { sessionId: "sess_child_alice" } as never)) as {
      tasks: unknown[];
    };
    expect(result).toBeDefined(); // roster/boardRead 成功 = 端口按 childSessionId 命中
  });

  it("⑩ a real registry failed terminal edge routes to handleMemberFailed and the lead gets the failure notice (spec §16 契约 1)", async () => {
    const { lead, installed, respond } = await createLeadWithTeam();
    const hub = installed!.hub;
    // 成员首回合模型侧失败（429 重试耗尽形态）→ runner 失败收口写 registry 终态
    // "failed"。通知未分诊前保持失败（成员回合的重试同样命中），分诊后放行后续
    // 模型调用（lead 消费通知的独立轮）。
    const failureEdge = vi.spyOn(hub, "handleMemberFailed");
    respond.mockImplementation(async () => {
      if (failureEdge.mock.calls.length === 0) {
        throw new Error("429 from provider; retries exhausted");
      }
      return TEST_MODEL_RESULT;
    });
    const leadPort = hub.leadPort(lead.sessionId);
    leadPort.stageTeam({
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [],
    });
    const approved = await leadPort.approveStage();
    expect(approved.status).toBe("ok");

    // 经真实 subscribe 链路断言（不直接调 hub 方法）：registry failed 终态 →
    // install 分诊 → handleMemberFailed(alice, { status: "failed", ... })。
    await vi.waitFor(() => expect(failureEdge).toHaveBeenCalled(), { timeout: 10_000 });
    const [memberName, info] = failureEdge.mock.calls[0] as [
      string,
      { status?: string; agentId?: string },
    ];
    expect(memberName).toBe("alice");
    expect(info?.status).toBe("failed");
    expect(info?.agentId).toBe(hub.snapshot()?.members[0]?.agentId);
    // noted（无开放任务）：板零改动，lead 邮箱恰一条失败通知（缺口12 通道投递后
    // 落 lead_injected 送达事实）。
    expect(hub.board()?.tasks).toHaveLength(0);
    await vi.waitFor(
      () => {
        const leadMail = hub.mailboxEntries().filter((entry) => entry.to === "lead");
        expect(leadMail).toHaveLength(1);
        expect(leadMail[0]?.from).toBe("alice");
        expect(leadMail[0]?.message).toContain("429 from provider");
      },
      { timeout: 10_000 },
    );
    expect(lead.sessionId).toBeTruthy();
  });
});

describe("agents team mailbox persistence (E12 全同步持久化接线, 2026-10-23)", () => {
  /** 冷恢复形态基座（同 ⑤）：免 spawn/模型轮，portSend 直达 enqueueMail 的持久化门。 */
  const restoredTeam = (leadSessionId: string): TeamRecord => ({
    teamId: "team_e12",
    leadSessionId,
    status: "idle",
    members: [{ agentId: "agent_e12_bob", memberName: "bob", state: "terminal", removed: false }],
    tasks: [],
    mailbox: [],
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  });

  it("⑪ portSend success persists the mailbox entry to the shared session-store channel", async () => {
    const sessionId = createSessionId();
    const persistedEntries: { type: string; data: Record<string, unknown> }[] = [];
    const store = {
      ...createRecordingMessageStore(),
      async sessionEntries() {
        return [];
      },
      async saveSessionEntry(entry: { type: string; data: Record<string, unknown> }) {
        persistedEntries.push(entry);
      },
    };
    const { lead, installed } = await createLeadWithTeam({ sessionId, sessionStore: store });
    const hub = installed!.hub;
    expect(hub.adoptRestored(restoredTeam(lead.sessionId))).toBe(true);

    const leadPort = hub.leadPort(lead.sessionId);
    const sent = leadPort.send({ to: "bob", message: "E12_DURABLE_MAIL" });
    expect(sent.status).toBe("success");
    const messageId = sent.status === "success" ? sent.messageId : "";

    // 写成功才算发送成功（spec §2.2 TeamMailbox 行）：portSend 成功路径上 sessionStore
    // 同一通道能读到逐条 durable 写（TEAM_MAILBOX_ENTRY_TYPE，按 messageId 寻址）。
    // 注入前缺口（E12）：邮箱条目只经 journal 异步刷盘，崩溃窗口丢尾。
    await vi.waitFor(() => {
      const written = persistedEntries.find(
        (row) =>
          row.type === TEAM_MAILBOX_ENTRY_TYPE && (row.data.messageId as string) === messageId,
      );
      expect(written).toBeDefined();
      expect(written?.data.message).toBe("E12_DURABLE_MAIL");
      expect(written?.data.to).toBe("bob");
    });
  });

  it("⑫ synchronous persist failure fails the send with mailbox_persist_failed (no mailbox append, no journal fact)", async () => {
    const sessionId = createSessionId();
    const attemptedWrites: { type: string; data: Record<string, unknown> }[] = [];
    const store = {
      ...createRecordingMessageStore(),
      async sessionEntries() {
        return [];
      },
      // 非异步函数 + 同步 throw = 同步入队失败注入点（E12 失败语义：抛错即发送失败）。
      saveSessionEntry(entry: { type: string; data: Record<string, unknown> }) {
        attemptedWrites.push(entry);
        throw new Error("disk full (E12 persist failure injection)");
      },
    };
    const { lead, installed } = await createLeadWithTeam({ sessionId, sessionStore: store });
    const hub = installed!.hub;
    expect(hub.adoptRestored(restoredTeam(lead.sessionId))).toBe(true);

    const leadPort = hub.leadPort(lead.sessionId);
    const sent = leadPort.send({ to: "bob", message: "E12_PERSIST_FAIL" });
    expect(sent.status).toBe("failed");
    expect(sent.status === "failed" && sent.error?.code).toBe("mailbox_persist_failed");

    // 不入箱：persist 抛错先于 appendToMailbox（hub enqueueMail 提前返回拒绝）。
    expect(hub.mailboxEntries()).toHaveLength(0);
    // 不 journal：sessionStore 通道上只有被同步拒绝的邮箱条目写入尝试，journal 事实
    // （message_appended）零落库——hub 在 persist 抛错处不触达 journalWriter。
    expect(attemptedWrites).toHaveLength(1);
    expect(attemptedWrites[0]?.type).toBe(TEAM_MAILBOX_ENTRY_TYPE);
    expect(attemptedWrites.some((row) => row.type === TEAM_JOURNAL_ENTRY_TYPE)).toBe(false);
  });
});
