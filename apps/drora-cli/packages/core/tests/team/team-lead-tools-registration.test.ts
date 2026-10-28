import { describe, expect, it } from "vitest";
import { createSessionId, type SessionEntryInfo } from "@drora/contracts";
import { installDroraAgentsTeam } from "../../../bootstrap/src/app/drora-team/install.js";
import { createTestAgentRuntime } from "../test-agent-runtime.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createTestModelFactory } from "../test-runtime-model.js";
import { createRecordingMessageStore } from "../runtime-output-token-continuation-test-helpers.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import type { AgentRuntimeDeps } from "../../src/runtime/types.js";

// specs/agents-team.md §19 契约 4（2026-10-23）bootstrap 注册冒烟：installDroraAgentsTeam
// 把 TeamReassign 注册进共享注册表（specImpact「已有契约未实现」的收口面——此前生产
// 零调用方）。锁三跳：
// ① TeamReassign 在生产装配路径真注册（§22 契约 4 起归属 manager 工具族
//   createTeamManagerToolEntries，非构造函数直测；M15 后同族另有 TeamReopen）；
// ② 非团队会话经 install 的 resolver 解析 undefined → 结构性拒（port 未配置）；
// ③ lead 会话解析到真实 hub 端口：无队 → hub 拒绝语义透传（2026-10-27 M9/裁定 3 后
//   lead 会话同样被 isTeamActor 拒 team_lead_only——resolver 命中 + 拒绝转译两跳
//   都在生产链上）。
// 工具边界单测见 team-tools-reassign.test.ts；hub 语义见 team-hub.test.ts。

describe("TeamReassign manager tool registration smoke (§22 契约 4)", () => {
  it("install registers TeamReassign; non-team sessions are structurally excluded; sessions reach the real hub port", async () => {
    const sessionId = createSessionId();
    const journalEntries: SessionEntryInfo[] = [];
    const leadDeps = {
      eventStore: createTestSessionEventStore(),
      sessionStore: {
        ...createRecordingMessageStore(),
        saveSessionEntry: async (entry: SessionEntryInfo) => {
          journalEntries.push(structuredClone(entry));
        },
        sessionEntries: async () => structuredClone(journalEntries),
      } as never,
      modelFactory: createTestModelFactory({
        properties: { supportsMidConversationSystem: true },
        generateText: async () => ({
          finishReason: "stop" as const,
          text: "ok",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      }),
    } as unknown as AgentRuntimeDeps;
    const registry = createToolRegistry();
    const lead = createTestAgentRuntime(
      sessionId,
      { mode: "build", compact: { enabled: false }, titleGeneration: { enabled: false } },
      { ...leadDeps, toolRegistry: registry },
    ) as unknown as Parameters<typeof installDroraAgentsTeam>[0]["runtime"];
    const installed = installDroraAgentsTeam({
      runtime: lead,
      leadDeps,
      registry,
      leadPermissionMode: "build",
    });

    const entry = installed.toolRegistry.get("TeamReassign");
    expect(entry).toBeDefined();

    await expect(
      entry!.handler({ task_id: "task_1", to: "lead", reason: "smoke" }, {
        sessionId: "sess_child_not_lead",
      } as never),
    ).rejects.toThrow("team sessions only");

    const error: { context?: { code?: string } } = await entry!
      .handler({ task_id: "task_1", to: "lead", reason: "smoke" }, { sessionId } as never)
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught as { context?: { code?: string } },
      );
    expect(error.context).toEqual({ code: "team_lead_only" });
  });
});
