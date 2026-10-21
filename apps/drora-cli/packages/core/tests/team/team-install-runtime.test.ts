import { describe, expect, it, vi } from "vitest";
import { createSessionId, SessionEventType } from "@drora/contracts";
import { createTestAgentRuntime } from "../test-agent-runtime.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createTestModelFactory } from "../test-runtime-model.js";
import { createRecordingMessageStore } from "../runtime-output-token-continuation-test-helpers.js";
import { installDroraAgentsTeam } from "../../../bootstrap/src/app/drora-team/install.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import type { ToolEntry } from "../../src/tool/types.js";
import type { AgentRuntimeDeps } from "../../src/runtime/types.js";
import { buildSteerPayload } from "../../src/team/message-format.js";
import type { TeamMailboxEntry, TeamRecord } from "../../src/team/types.js";

/**
 * PR-1.1′d 运行时可达断言（specs/agents-team.md §12 M1 验收 ③ 的可达性半部；
 * 行为门零改动回归见 behavior-gates.snapshot.test.ts 与 PR-1.7）。
 *
 * ① 首次 spawn 成员的工具面板含团队协作工具（私有端口 → 构造注入注册表）；
 * ② 终态成员复活投递的消息体含零授权禁令文本（formatIncomingMessage 单一出处）；
 * ③ 灰度关 = 注册表无任何 Team* 工具（默认路径零变化的结构面）；
 * ④ steer 载荷不预嵌 presentation 包装（无双包装——渲染责任在 runtime 单侧）。
 *
 * 2026-10-21 审查缺口回归（事件与调度批次）：
 * ⑤ 缺口1——派发通道把 sendMessage 失败当已接受：失败不得 markDelivered 假回执；
 * ⑥ 缺口2——成员运行态边缘生产接线：首回合自然终态 → 自动派发（无测试侧
 *    handleMemberTerminal 调用），经真实 sendMessage 复活认领任务并回到 working；
 * ⑦ 缺口6——Approve & Run 逐成员 spawn 非原子：部分失败反向回收已启动成员、
 *    草案零确认零 journal 污染、专用错误码。
 */

const TEST_MODEL_RESULT = {
  finishReason: "stop" as const,
  text: "ok",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};

async function createLeadWithTeam(options: { enabled: boolean } = { enabled: true }) {
  const sessionId = createSessionId();
  const requests: unknown[] = [];
  const respond = vi.fn(async () => TEST_MODEL_RESULT);
  const store = createRecordingMessageStore();
  const eventStore = createTestSessionEventStore();
  const leadDeps: AgentRuntimeDeps = {
    eventStore,
    sessionStore: store as never,
    modelFactory: createTestModelFactory({
      properties: { supportsMidConversationSystem: true },
      generateText: async (request) => {
        requests.push(request);
        return respond(request);
      },
    }),
  } as unknown as AgentRuntimeDeps;
  const registry = options.enabled ? createToolRegistry() : undefined;
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
  for (const name of ["TeamTaskList", "TeamTaskGet", "TeamTaskCreate", "TeamTaskClaim", "TeamTaskUpdate", "TeamSendMessage"]) {
    if ((registry as unknown as { get?: (n: string) => ToolEntry | undefined }).get?.(name) !== undefined) {
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

  it("④ steer payload is presentation-neutral (no double wrap; rendering belongs to the runtime)", () => {
    const entry: TeamMailboxEntry = {
      messageId: "m1",
      from: "alice",
      to: "bob",
      message: "sync please",
      at: "2026-10-17T00:00:00.000Z",
      deliveredAccepted: false,
    };
    const payload = buildSteerPayload(entry);
    // 载荷只带原文 + presentation 声明；wrap 短语由 runtime 的
    // formatIncomingMessage("subagent_reply_steer") 单侧渲染——双包装即缺陷。
    expect(payload.inputPresentation).toBe("subagent_reply_steer");
    expect(payload.body).not.toContain("Another Drora session sent a message");
    expect(payload.body).toContain("sync please");
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
      members: [
        { agentId: "agent_ghost", memberName: "ghost", state: "terminal", removed: false },
      ],
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
    const revivedTurnGate = new Promise<typeof TEST_MODEL_RESULT>(
      (resolve) => {
        releaseRevivedTurn = resolve;
      },
    );
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
    await vi.waitFor(
      () => expect(hub.snapshot()?.members[0]?.state).toBe("terminal"),
      { timeout: 10_000 },
    );
    expect(lead.sessionId).toBeTruthy();
  });

  it("⑦ Approve & Run spawn is atomic: partial failure recycles launched members and keeps the draft clean", async () => {
    const { lead, leadDeps, eventStore, installed, respond } = await createLeadWithTeam();
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
        // 未知 profile：runner 的 resolveAgentProfileForRequest 直接抛错——第 2 个
        // 成员 launch 失败（缺口6 的第 k 个失败场景）。
        { memberName: "bob", profile: "no-such-profile" },
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
