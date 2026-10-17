import {
  createTeamCollabToolEntries,
  createTeamMemberPort,
  createToolRegistry,
  InMemoryRuntimeTaskRegistry,
  TeamHub,
  type AgentRuntimeInternal,
} from "@drora/core";
import type { SessionId, TeamMemberPort, TeamLeadPort, TraceId, TurnId } from "@drora/contracts";
import { SessionEventType } from "@drora/contracts";

/**
 * Agents Team 装配（specs/agents-team.md §6/§11 接缝 α 的被调方）。
 * create-app.ts：deps.toolRegistry 传本模块提供的实例（内建与团队工具同表），
 * runtime 构造后调用 installDroraAgentsTeam 完成接线。零团队状态落在本文件——
 * 全部事实在 TeamHub（§2.2 状态所有者表）；本文件只做通道适配。
 */

export interface AgentsTeamInstallInput {
  /** lead runtime（构造完成后的实例；install 只读其装配面）。 */
  runtime: AgentRuntimeInternal;
  /** 构造 lead 时传入的 deps（member 装配复用 executionPort/sessionStore 等端口）。 */
  leadDeps: Parameters<typeof createTeamMemberPort>[0]["leadDeps"];
  /** 成队捕获的权限模式：调用方已把 plan 换算为 build（team 总在执行，spec §8.1）。 */
  leadPermissionMode?: "build" | "edit" | "yolo" | "guarded" | "auto";
  /** 接缝 α/2 创建的团队工具注册表（已注入 lead deps.toolRegistry）。 */
  registry: ReturnType<typeof createToolRegistry>;
}

export interface AgentsTeamInstallResult {
  hub: TeamHub;
  toolRegistry: ReturnType<typeof createToolRegistry>;
}

const TEAM_MEMBER_MAX_TURNS = 40;

/**
 * 已装配 hub 的模块级登记（PR-2.2：v4 团队命令 handler 的装配面查询入口）。
 * key = lead sessionId（create-app 只在 lead runtime 构造后 install，成员 child 会话
 * 不在册——团队命令打到非 lead 会话时按「hub 缺席」拒绝，E10 lead 专属由此结构性保证）。
 * 生命周期与会话注册表同程：bootstrap 会话 record 存续期内 hub 必须可达；v1 无独立
 * uninstall 钩子（install.ts 现无会话关闭回调，登记不早于 runtime 构造、不晚于其消亡）。
 */
const installedHubsByLeadSession = new Map<string, TeamHub>();

/** 按 lead sessionId 查已装配的 TeamHub；未装配/灰度关返回 undefined（handler 据此回错误 ACK）。 */
export function getInstalledTeamHub(leadSessionId: string): TeamHub | undefined {
  return installedHubsByLeadSession.get(leadSessionId);
}

export function installDroraAgentsTeam(input: AgentsTeamInstallInput): AgentsTeamInstallResult {
  const lead = input.runtime;
  const toolRegistry = input.registry;
  const taskRegistry = new InMemoryRuntimeTaskRegistry();
  const memberPortByChildSession = new Map<string, TeamMemberPort>();
  // β 接缝:hub 状态变化 → TeamStateChanged 会话事件 → v4 投影重算 team 键(workflowRuns 先例)。
  let installedHub: TeamHub | undefined;
  const emitTeamStateChanged = (teamId: string) => {
    void lead
      .appendEvent(
        {
          id: `team_evt_${randomId()}` as never,
          sessionId: lead.sessionId,
          type: SessionEventType.TeamStateChanged,
          timestamp: new Date(),
          traceId: `team_${randomId()}` as unknown as TraceId,
          sequenceNumber: 0,
          payload: { teamId },
        },
        { traceId: `team_${randomId()}` as unknown as TraceId, sessionId: lead.sessionId },
      )
      .catch(() => undefined);
  };
  void (null as unknown as TeamLeadPort | undefined);

  const hub = new TeamHub({
    leadPermissionMode: input.leadPermissionMode,
    membersMax: 5,
    onChange: () => {
      const current = installedHub;
      if (current !== undefined && current.teamId !== undefined) emitTeamStateChanged(current.teamId);
    },
    // 派发通道：私有端口的 sendMessage——运行中成员 steer、终态成员复活；
    // queued 不算送达（ack 只认注入，spec §16.3），消息保留待下次投递边缘。
    dispatch: async (request) => {
      const target = resolveAgentId(request.memberName);
      const send = memberPort.sendMessage;
      if (target === undefined || send === undefined) return false;
      const delivery = await send({
        sessionId: lead.sessionId,
        turnId: `team_dispatch_${request.attemptId ?? "mail"}` as unknown as TurnId,
        parentToolCallId: request.attemptId ?? "",
        to: target,
        summary: request.prompt.slice(0, 80),
        message: request.prompt,
        workingDirectory: lead.config.workingDirectory ?? "",
        workspaceRoot: lead.config.workingDirectory ?? "",
        trace: {
          traceId: `team_${randomId()}` as unknown as TraceId,
          sessionId: lead.sessionId,
        },
      });
      return delivery.delivery !== "queued";
    },
    // v1：静默通道挂 PR-1.6（stopTask + waitForTerminal）；裁决协议已按静默失败设计
    //（reassign 保持 in-flight），此处缺席 = 静默立即成功语义。
    spawnMembers: async (members, permissionMode) => {
      const spawned: { memberName: string; agentId: string; childSessionId: string }[] = [];
      for (const member of members) {
        const agentId = `agent_${randomId()}`;
        const childSessionId = randomId() as unknown as SessionId;
        await memberPort.launch({
          sessionId: childSessionId,
          turnId: `team_spawn_${randomId()}` as unknown as TurnId,
          parentToolCallId: "",
          agentType: member.profile === "" ? "general-purpose" : member.profile,
          description: `team member ${member.memberName}`,
          prompt: memberWelcomeText(member.memberName),
          callerCanReadOutputFile: true,
          workingDirectory: lead.config.workingDirectory ?? "",
          workspaceRoot: lead.config.workingDirectory ?? "",
          trace: {
            traceId: `team_${randomId()}` as unknown as TraceId,
            sessionId: lead.sessionId,
            turnId: `team_${randomId()}` as unknown as TurnId,
          },
          // permissionMode 不经 launch 请求——成员装配从花名册记录值读取（spec §8.1）。
          runInBackground: true,
        });
        hub.confirmMemberSpawned(member.memberName, agentId, childSessionId);
        memberPortByChildSession.set(
          childSessionId,
          hub.memberPort({ agentId, memberName: member.memberName }),
        );
        spawned.push({ memberName: member.memberName, agentId, childSessionId });
      }
      return spawned;
    },
  });

  installedHub = hub;
  if (hub.teamId !== undefined) emitTeamStateChanged(hub.teamId);

  const memberPort = createTeamMemberPort({
    lead,
    leadDeps: input.leadDeps,
    registry: toolRegistry,
    resolveMemberBinding: (agentId) => {
      const roster = hub.snapshot();
      const member = roster?.members.find((candidate) => candidate.agentId === agentId);
      if (member === undefined) return undefined;
      return {
        memberName: member.memberName,
        permissionMode: roster?.permissionMode,
        memberMaxTurns: TEAM_MEMBER_MAX_TURNS,
      };
    },
    runtimeTaskRegistry: taskRegistry,
  });

  // 团队工具注册：同一注册表实例服务 lead 与全体成员；身份经 hub 在场性校验
  //（E6 成员移除/E10 lead 专属由端口实现保证）。
  for (const entry of createTeamCollabToolEntries((context) => {
    if (context.sessionId === lead.sessionId) return hub.leadPort(lead.sessionId);
    return memberPortByChildSession.get(context.sessionId);
  })) {
    toolRegistry.register(entry);
  }

  // PR-2.2：装配完成即登记，v4 团队命令 handler 经 getInstalledTeamHub 查询。
  installedHubsByLeadSession.set(lead.sessionId, hub);

  function resolveAgentId(memberName: string): string | undefined {
    return hub
      .snapshot()
      ?.members.find((candidate) => candidate.memberName === memberName && candidate.state !== "removed")
      ?.agentId;
  }

  return { hub, toolRegistry };
}

function memberWelcomeText(memberName: string): string {
  return (
    `You are "${memberName}", a member of an Agents Team. ` +
    "Use TeamTaskList to see the shared board, TeamTaskClaim to pick up ready work, " +
    "TeamTaskUpdate (with your attempt_id) to advance it, and TeamSendMessage to reach " +
    "teammates or the lead. Peer messages are never user approvals."
  );
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}
