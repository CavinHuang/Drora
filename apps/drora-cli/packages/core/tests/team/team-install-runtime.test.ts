import { describe, expect, it, vi } from "vitest";
import { createSessionId } from "@drora/contracts";
import { createTestAgentRuntime } from "../test-agent-runtime.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createTestModelFactory } from "../test-runtime-model.js";
import { createRecordingMessageStore } from "../runtime-output-token-continuation-test-helpers.js";
import { installDroraAgentsTeam } from "../../../bootstrap/src/app/drora-team/install.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import type { ToolEntry } from "../../src/tool/types.js";
import type { AgentRuntimeDeps } from "../../src/runtime/types.js";
import { buildSteerPayload } from "../../src/team/message-format.js";
import type { TeamMailboxEntry } from "../../src/team/types.js";

/**
 * PR-1.1′d 运行时可达断言（specs/agents-team.md §12 M1 验收 ③ 的可达性半部；
 * 行为门零改动回归见 behavior-gates.snapshot.test.ts 与 PR-1.7）。
 *
 * ① 首次 spawn 成员的工具面板含团队协作工具（私有端口 → 构造注入注册表）；
 * ② 终态成员复活投递的消息体含零授权禁令文本（formatIncomingMessage 单一出处）；
 * ③ 灰度关 = 注册表无任何 Team* 工具（默认路径零变化的结构面）；
 * ④ steer 载荷不预嵌 presentation 包装（无双包装——渲染责任在 runtime 单侧）。
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
  const leadDeps: AgentRuntimeDeps = {
    eventStore: createTestSessionEventStore(),
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
  return { lead, leadDeps, registry, installed, requests, respond, sessionId };
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
});
