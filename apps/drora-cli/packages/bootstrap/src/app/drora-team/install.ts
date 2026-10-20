import {
  createTeamCollabToolEntries,
  createTeamJournalSessionStoreSink,
  readTeamHistoryPage,
  createTeamMemberPort,
  createToolRegistry,
  InMemoryRuntimeTaskRegistry,
  restoreAgentsTeamFromJournal,
  TeamHub,
  type AgentRuntimeInternal,
} from "@drora/core";
import type { SessionId, TeamMemberPort, TeamLeadPort, TraceId, TurnId } from "@drora/contracts";
import { SessionEventType } from "@drora/contracts";
import type { TeamHistoryQuery, TeamHistoryResult } from "@drora/shared/drora-protocol-v4";

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
  /** 成员数上限（settings agentsTeam.membersMax；缺省 5，spec §1）。 */
  membersMax?: number;
  /** 接缝 α/2 创建的团队工具注册表（已注入 lead deps.toolRegistry）。 */
  registry: ReturnType<typeof createToolRegistry>;
  /**
   * 灰度显式开关（M2.5 设置面接缝）：显式值优先于 env DRORA_AGENTS_TEAM=1
   * （spec §11 v1 过渡），裁决统一走 {@link resolveAgentsTeamEnabled}。install 的
   * 装配前提是调用点先用该函数把门裁成开（再创建 registry）；显式 false 到达这里
   * 即装配顺序矛盾，就地暴露（照 commandFactory CAS 缺参 throw 同精神）。
   * create-app 接缝 v1 暂不传（行为不变），设置面 M2.5 接入时只改调用点。
   */
  enabledOverride?: boolean;
}

/**
 * 灰度门唯一裁决：显式入参优先，缺省回落 env DRORA_AGENTS_TEAM=1（spec §11 v1 过渡）。
 * 装配门（create-app 的 registry 创建）与 /team 命令分发门（builtin-prompt-command）
 * 都引用本函数——env 字面量收口为单一出处（AGENTS.md 契约键单一出处）。
 */
export function resolveAgentsTeamEnabled(enabledOverride?: boolean): boolean {
  return enabledOverride ?? process.env.DRORA_AGENTS_TEAM === "1";
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
const installedHistoryReaders = new Map<
  string,
  (query: TeamHistoryQuery) => Promise<TeamHistoryResult>
>();

export function getInstalledTeamHistoryReader(sessionId: string) {
  return installedHistoryReaders.get(sessionId);
}

/** 按 lead sessionId 查已装配的 TeamHub；未装配/灰度关返回 undefined（handler 据此回错误 ACK）。 */
export function getInstalledTeamHub(leadSessionId: string): TeamHub | undefined {
  return installedHubsByLeadSession.get(leadSessionId);
}

export function installDroraAgentsTeam(input: AgentsTeamInstallInput): AgentsTeamInstallResult {
  // 灰度收口：显式 false 与装配前提矛盾（门在调用点的 resolveAgentsTeamEnabled），
  // 不静默吞——静默装一半比立即失败更难查。
  if (input.enabledOverride === false) {
    throw new Error(
      "installDroraAgentsTeam: enabledOverride=false 与装配前提矛盾——" +
        "调用点应先用 resolveAgentsTeamEnabled 裁门（关则不创建 registry、不到达 install）",
    );
  }
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

  // journal 持久化通道（M3 PR-3.1）：sessionStore 既有 session entry 通道
  //（type = team.journal，键前缀单一出处 contracts TEAM_JOURNAL_KEY_PREFIX）；
  // 同步入队 + 串行异步刷盘，刷盘失败只 warn（journal 丢失只退化崩溃恢复，不劫持裁决）。
  const journalSink = createTeamJournalSessionStoreSink({
    sessionStore: input.leadDeps.sessionStore,
    sessionId: lead.sessionId,
    warn: (message, error) => {
      lead.logger?.warn(message, {
        error: error instanceof Error ? error.message : String(error ?? ""),
        event: "agents_team.journal_write_failed",
        module: "bootstrap.agentsTeam",
        sessionId: lead.sessionId,
      });
    },
  });

  const hub = new TeamHub({
    leadPermissionMode: input.leadPermissionMode,
    membersMax: input.membersMax ?? 5,
    onChange: () => {
      const current = installedHub;
      if (current !== undefined && current.teamId !== undefined)
        emitTeamStateChanged(current.teamId);
    },
    // journal 写入：hub 动作点的用户/协议动作与板/邮箱数据事实（spec 差异裁决#5）。
    journalWriter: (event) => journalSink.append(event),
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
    // M4 静默通道：停掉成员在飞的后台任务并等待其终态（转派三步的第 2 步，
    // spec §16.1）；超时/失败抛错 → hub 保持交接 in-flight（reassigning=true）。
    interruptAndSettle: async (memberName) => {
      const agentId = resolveAgentId(memberName);
      if (agentId === undefined) return;
      const task = Object.values(taskRegistry.all()).find(
        (candidate) => candidate.agentId === agentId && candidate.isBackgrounded === true,
      );
      if (task === undefined) return; // 无在飞任务即已静默
      const stop = memberPort.stopTask;
      if (stop !== undefined) await stop.call(memberPort, task.taskId);
      await Promise.race([
        taskRegistry.waitForTerminal(task.taskId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`team member ${memberName} did not settle in time`)),
            30_000,
          ),
        ),
      ]);
    },
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
  installedHistoryReaders.set(lead.sessionId, async (query) => {
    await journalSink.flush();
    return readTeamHistoryPage({
      ...query,
      sessionStore: input.leadDeps.sessionStore,
      sessionId: lead.sessionId,
    });
  });
  // 装配完成即广播初始 TeamStateChanged(PR-2.5b):启动窗口期渲染进程可能已用
  // 「无 team」目录装配了首份快照;此事件让网关重拉配置,slashCommands 补上 /team。
  emitTeamStateChanged(hub.teamId ?? "");

  // lead resume 恢复（M3 PR-3.1）：install 随装配调用一次——本装配点同时服务新会话与
  // resume 会话（create-app 的 runtime 构造共用此路径），journal 无事实时是 no-op。
  // 调用时机约束：恢复是 fire-and-forget 的异步重放；装配完成到恢复完成之间存在竞态
  // 窗口（团队工具/命令此刻看到「无 team」，冷快照可能缺 team 键——恢复完成后经
  // TeamStateChanged 补发 delta 收敛）；窗口内若已创建新 team，恢复结果让位（hub 内
  // 不覆盖现役记录）。恢复失败只 warn，绝不阻断装配与 lead 运行主循环。
  void restoreAgentsTeamFromJournal({
    hub,
    sessionStore: input.leadDeps.sessionStore,
    sessionId: lead.sessionId,
    warn: (message) => {
      lead.logger?.warn(message, {
        event: "agents_team.journal_restore",
        module: "bootstrap.agentsTeam",
        sessionId: lead.sessionId,
      });
    },
  })
    .then((outcome) => {
      if (outcome === undefined) return; // 新会话/无 journal 事实：seq 从 1 起即无碰撞
      journalSink.setNextSeq(outcome.lastSeq + 1);
      if (outcome.adopted && hub.teamId !== undefined) {
        emitTeamStateChanged(hub.teamId);
        // M4 冷恢复自动重试（spec §2.3：恰一次，失败不退 pending）：恢复后对每个
        // 持开放 attempt 的成员各试一次；recoveryRetried 已持久化，天然防重复。
        for (const member of hub.snapshot()?.members ?? []) {
          if (member.state === "removed") continue;
          void hub.recoverOpenAttempt(member.memberName).catch((error: unknown) => {
            lead.logger?.warn(`agents team: cold recovery failed for ${member.memberName}`, {
              event: "agents_team.cold_recovery",
              module: "bootstrap.agentsTeam",
              error: String(error),
            });
          });
        }
      }
    })
    .catch(() => undefined); // restoreAgentsTeamFromJournal 内部已兜错；此处防御性收口

  function resolveAgentId(memberName: string): string | undefined {
    return hub
      .snapshot()
      ?.members.find(
        (candidate) => candidate.memberName === memberName && candidate.state !== "removed",
      )?.agentId;
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
