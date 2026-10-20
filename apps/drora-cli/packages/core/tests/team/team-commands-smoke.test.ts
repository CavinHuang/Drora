import { describe, expect, it } from "vitest";
import { createSessionId, type SessionEntryInfo } from "@drora/contracts";
import {
  COMMANDS_REQUIRING_BASE_REVISION,
  TEAM_V4_COMMAND_TYPES,
  TEAM_HISTORY_QUERY,
  type CommandType,
  type CommandEnvelope,
} from "@drora/shared/drora-protocol-v4";
import {
  getInstalledTeamHub,
  installDroraAgentsTeam,
} from "../../../bootstrap/src/app/drora-team/install.js";
import { NATIVE_HANDLERS } from "../../../bootstrap/src/drora-protocol-v4/commands/handlers/index.js";
import { teamHandlers } from "../../../bootstrap/src/drora-protocol-v4/commands/handlers/team.js";
import type {
  V4CommandCoreHost,
  V4SessionRecordView,
} from "../../../bootstrap/src/drora-protocol-v4/commands/types.js";
import { createTestAgentRuntime } from "../test-agent-runtime.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createTestModelFactory } from "../test-runtime-model.js";
import { createRecordingMessageStore } from "../runtime-output-token-continuation-test-helpers.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import type { AgentRuntimeDeps } from "../../src/runtime/types.js";

/**
 * PR-2.2 v4 团队命令 handler smoke（docs/agent-team-implementation-2026-10-16/
 * 00-master-design.md §7 PR-2.2 验收：handler 单测 + COMMANDS_REQUIRING_BASE_REVISION
 * 对照断言；specs/agents-team.md §6.3 命令面）。
 *
 * ① 未装配（灰度关形态：会话 record 在、hub 不在册）八条逐条 → 结构化错误 ACK 语义
 *   （带 reasonCode 的领域错误，gateway 据此回 failed；不抛穿网关）；
 * ② install 一个 hub 后 approve/revise/halt/resume 正路径可达（send/stop 顺带最小正路径）；
 * ③ CAS 归类对照断言：八条全部不在 COMMANDS_REQUIRING_BASE_REVISION，且注册表 wiring 生效。
 */

const hostedSessions = new Set<string>();

/** 最小 V4CommandCoreHost：只实现 handler 用到的 getRecord（requireRecord 语义）。 */
const smokeHost: V4CommandCoreHost = {
  getRecord: (sessionId: string) =>
    hostedSessions.has(sessionId)
      ? ({
          app: { sessionId },
          traceContext: { traceId: "team_smoke", sessionId },
          workspace: { workspacePath: "" },
          persistence: "immediate",
        } as unknown as V4SessionRecordView)
      : undefined,
};

let commandSeq = 0;
function teamEnvelope(
  type: CommandType,
  sessionId: string,
  payload: Record<string, unknown> = {},
): CommandEnvelope {
  commandSeq += 1;
  return {
    commandId: `team_smoke_${commandSeq}`,
    clientId: "team-commands-smoke",
    sessionId,
    type,
    payload,
    issuedAt: Date.now(),
  } as CommandEnvelope;
}

describe("team v4 command handlers smoke (PR-2.2)", () => {
  it("① uninstalled session: all eight commands answer structured error ACKs, none throw through", async () => {
    const sessionId = createSessionId();
    hostedSessions.add(sessionId);
    for (const type of TEAM_V4_COMMAND_TYPES) {
      const payload = type === "resumeTeam" ? { reason: "smoke" } : {};
      await expect(
        teamHandlers[type](smokeHost, teamEnvelope(type, sessionId, payload)),
      ).rejects.toMatchObject({
        reasonCode:
          type === "setTeamMemberName"
            ? // v1 未支持是能力声明，独立于装配状态（登记 M3）。
              "fault.command.teamCommandUnsupported"
            : // hub 缺席（未装配/灰度关/非 lead 会话）→ 统一 teamHubUnavailable。
              "fault.command.teamHubUnavailable",
      });
    }
    hostedSessions.delete(sessionId);
  });

  it("② with a hub installed: approve/revise/halt/resume positive path reachable, send/stop land the hub", async () => {
    const sessionId = createSessionId();
    const journalEntries: SessionEntryInfo[] = [];
    const leadDeps: AgentRuntimeDeps = {
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
    hostedSessions.add(sessionId);

    // 登记查询：install 即在册（PR-2.2 hub 获取通道）。
    expect(getInstalledTeamHub(sessionId)).toBe(installed.hub);
    const hub = installed.hub;

    // staging 不在八条 v4 命令面（由 TeamSpawn 工具面/lead 端口承载）：先造 staged 草案。
    const leadPort = hub.leadPort(sessionId);
    const staged = leadPort.stageTeam({
      name: "smoke-team",
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [{ title: "t1", spec: { goal: "g", acceptance: ["a1"] }, dependsOn: [] }],
    });
    expect(staged.status).toBe("ok");
    const teamId = staged.teamId as string;
    const history = await teamHandlers[TEAM_HISTORY_QUERY](
      smokeHost,
      teamEnvelope(TEAM_HISTORY_QUERY, sessionId, { teamId }),
    );
    expect(history.type).toBe(TEAM_HISTORY_QUERY);
    if (history.type === TEAM_HISTORY_QUERY) {
      expect(history.events.map((event) => event.kind)).toEqual(["team_created", "staged"]);
    }
    await expect(
      teamHandlers[TEAM_HISTORY_QUERY](
        smokeHost,
        teamEnvelope(TEAM_HISTORY_QUERY, sessionId, { teamId: "other" }),
      ),
    ).rejects.toMatchObject({ reasonCode: "fault.command.teamRejected.historyTeamMismatch" });
    expect(COMMANDS_REQUIRING_BASE_REVISION.has(TEAM_HISTORY_QUERY)).toBe(false);

    // revise 正路径：原子更新同一草案（同 teamId、仍 staged，不另建 team）。
    await teamHandlers.reviseTeamPlan(
      smokeHost,
      teamEnvelope("reviseTeamPlan", sessionId, { note: "keep the draft" }),
    );
    expect(hub.teamId).toBe(teamId);
    expect(hub.status).toBe("staged");

    // approve 正路径：唯一创建成员入口。
    await teamHandlers.approveTeamPlan(smokeHost, teamEnvelope("approveTeamPlan", sessionId));
    expect(hub.status).toBe("active");
    expect(hub.snapshot()?.members.some((member) => member.memberName === "alice")).toBe(true);

    // halt → resume 正路径（用户停队/显式带理由恢复，spec §2.6）。
    await teamHandlers.haltTeam(
      smokeHost,
      teamEnvelope("haltTeam", sessionId, { reason: "pause" }),
    );
    expect(hub.status).toBe("halted");
    await teamHandlers.resumeTeam(
      smokeHost,
      teamEnvelope("resumeTeam", sessionId, { reason: "go on" }),
    );
    expect(["active", "idle"]).toContain(hub.status);

    // send 正路径：spawning 成员投递为 queued（ack 只认注入），但发送即入账邮箱。
    const mailboxBefore = hub.mailboxEntries().length;
    await teamHandlers.sendTeamMessage(
      smokeHost,
      teamEnvelope("sendTeamMessage", sessionId, { to: "alice", message: "hello alice" }),
    );
    expect(hub.mailboxEntries().length).toBe(mailboxBefore + 1);
    expect(hub.mailboxEntries().at(-1)?.message).toBe("hello alice");

    // stop 正路径：hub 移除安全序标记 removed；花名册投影不再含该成员
    //（snapshot() 过滤 removed——移除成功 = 从投影消失，hub.ts snapshot 的口径）。
    await teamHandlers.stopTeamMember(
      smokeHost,
      teamEnvelope("stopTeamMember", sessionId, { memberName: "alice" }),
    );
    expect(hub.snapshot()?.members.some((member) => member.memberName === "alice")).toBe(false);

    // 拒绝路径收口：非 staged 调 abandon → hub 拒绝语义透传为结构化 failed ACK reasonCode。
    await expect(
      teamHandlers.abandonTeamPlan(smokeHost, teamEnvelope("abandonTeamPlan", sessionId)),
    ).rejects.toMatchObject({ reasonCode: "fault.command.teamRejected.team_lead_only" });

    hostedSessions.delete(sessionId);
  });

  it("③ CAS classification: none of the eight commands requires baseRevision, and the registry wires all eight", () => {
    for (const type of TEAM_V4_COMMAND_TYPES) {
      expect(COMMANDS_REQUIRING_BASE_REVISION.has(type)).toBe(false);
      expect(type in NATIVE_HANDLERS).toBe(true);
    }
  });
});
