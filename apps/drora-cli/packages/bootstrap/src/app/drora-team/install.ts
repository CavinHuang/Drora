import {
  createTeamCollabToolEntries,
  createTeamJournalSessionStoreSink,
  readTeamHistoryPage,
  createTeamLeadToolEntries,
  createTeamMemberPort,
  createToolRegistry,
  InMemoryRuntimeTaskRegistry,
  isTerminalRuntimeTask,
  restoreAgentsTeamFromJournal,
  TeamHub,
  type AgentRuntimeInternal,
} from "@drora/core";
import { DRORA_AGENTS_TEAM_ENV } from "@drora/shared";
import type { TeamMemberPort, TeamLeadPort, TraceId, TurnId } from "@drora/contracts";
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
  return enabledOverride ?? process.env[DRORA_AGENTS_TEAM_ENV] === "1";
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

  // M4 静默通道（缺口6 复用）：停掉成员在飞的后台任务并等待其终态。转派三步的第 2 步
  //（spec §16.1）与 spawn 反向回收共用；超时/失败抛错 → 调用方按各自语义兜底
  //（reassign 保持交接 in-flight；spawn 回收只 warn 不阻塞草案回滚）。
  const settleMemberTask = async (memberName: string, agentId: string): Promise<void> => {
    const task = Object.values(taskRegistry.all()).find(
      (candidate) => candidate.agentId === agentId && candidate.isBackgrounded === true,
    );
    if (task === undefined) return; // 无在飞任务即已静默
    const stop = memberPort.stopTask;
    if (stop === undefined) return;
    await stop.call(memberPort, task.taskId);
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        taskRegistry.waitForTerminal(task.taskId),
        new Promise<never>((_, reject) => {
          settleTimer = setTimeout(
            () => reject(new Error(`team member ${memberName} did not settle in time`)),
            30_000,
          );
        }),
      ]);
    } finally {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
    }
  };

  // ── 缺口2：成员进程运行态 → hub 运行态投影接线（spec §2.3 事件驱动自动派发）──
  // hub.markMemberWorking/handleMemberTerminal 此前只有测试调用，成员永远停在
  // spawning：routeMail 只认 working/terminal → 消息永远 queued、终态边缘不触发
  // kick（自动派发死寂）、team 永挂 active。接线走既有 RuntimeTaskRegistry.subscribe
  //（spec §2.4：感知成员转 idle 用既有 registry 通道，不新增端口方法）：running 边缘
  // → working；终态边缘 → handleMemberTerminal（内部刷新状态并 kick：邮箱优先/自动
  // 认领下一任务）。lastSeen 去重同态边缘，防 terminal→terminal 重复触发循环。
  const lastSeenRuntimeStatusByAgentId = new Map<string, string>();
  const syncMemberRuntimeState = (agentId: string, memberName: string): void => {
    const status = taskRegistry.get(agentId)?.status;
    if (status === undefined || lastSeenRuntimeStatusByAgentId.get(agentId) === status) return;
    lastSeenRuntimeStatusByAgentId.set(agentId, status);
    if (status === "running") {
      hub.markMemberWorking(memberName);
      return;
    }
    if (isTerminalRuntimeTask({ status })) {
      // fire-and-forget：handleMemberTerminal 的 kick 派发不在 runner 的 finalize
      // 事件链上等待；失败不影响成员终态事实本身（registry 已终态，下次边缘再触发）。
      void hub.handleMemberTerminal(memberName).catch((error: unknown) => {
        lead.logger?.warn(`agents team: member terminal edge failed for ${memberName}`, {
          event: "agents_team.member_terminal_edge",
          module: "bootstrap.agentsTeam",
          sessionId: lead.sessionId,
          error: String(error),
        });
      });
    }
  };
  taskRegistry.subscribe(() => {
    for (const member of hub.snapshot()?.members ?? []) {
      if (member.state === "removed" || member.agentId.startsWith("pending_")) continue;
      syncMemberRuntimeState(member.agentId, member.memberName);
    }
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
      // 2026-10-21 缺口1：runner 的失败返回体（createSendMessageFailure）没有 delivery
      // 字段且 status="failed"——此前只判 delivery !== "queued"，undefined 被误判为
      // 已接受，hub 侧 markDelivered + journal message_delivered 记假回执（邮件实际
      // 丢失）、派发票据不回滚、recoveryRetried 白耗。失败必须显式按 status 裁决；
      // queued 仍不算送达（spec §16.3）。
      return delivery.status === "success" && delivery.delivery !== "queued";
    },
    // M4 静默通道：停掉成员在飞的后台任务并等待其终态（转派三步的第 2 步，
    // spec §16.1）；超时/失败抛错 → hub 保持交接 in-flight（reassigning=true）。
    interruptAndSettle: async (memberName) => {
      const agentId = resolveAgentId(memberName);
      if (agentId === undefined) return;
      await settleMemberTask(memberName, agentId);
    },
    // 2026-10-21 边缘1（spec §14）：停队同时中断 lead 自身回合——AbortController 域
    // 覆盖整条前台执行（goal verifier/continuation 交界同样命中）。
    interruptLead: async () => {
      lead.stopActiveForegroundExecution({ reason: "agents team halted by the user" });
    },
    // 2026-10-21 缺口12（spec §14）：lead 邮箱投递通道 = enqueueSubagentMessage
    //（RespondToCoordinator 同通道：mid-turn 经 active-loop 以 steer 注入、idle 即刻
    // drain 为 model-only 独立轮——唤醒语义与后台任务通知同族）。enqueue 即接受；
    // 发件成员已离册时返回 false 留 queued（世代过滤/清理路径收敛）。
    deliverLeadMail: async ({ entries }) => {
      const roster = hub.snapshot();
      for (const entry of entries) {
        // snapshot 已滤 removed 成员；照 memberName 联接（E5 名字重定向防护同源）。
        const sender = roster?.members.find((candidate) => candidate.memberName === entry.from);
        if (sender === undefined || sender.childSessionId === undefined) return false;
        lead.enqueueSubagentMessage({
          responseId: `team_mail_${entry.messageId}`,
          agentId: sender.agentId,
          agentType:
            sender.profile === undefined || sender.profile === "" ? "general-purpose" : sender.profile,
          childSessionId: sender.childSessionId as never,
          childToolCallId: `team:${sender.agentId}`,
          summary: entry.summary ?? `Team message from ${entry.from}`,
          message: entry.message,
          traceContext: {
            traceId: `team_${randomId()}` as unknown as TraceId,
            sessionId: lead.sessionId,
          },
        });
      }
      return true;
    },
    spawnMembers: async (members, _permissionMode) => {
      // permissionMode 不经 launch 请求传播（上游注释见下）——成员装配从花名册
      // 记录值读取（spec §8.1，hub 传入仅为签名完整）。
      const spawned: { memberName: string; agentId: string; childSessionId: string }[] = [];
      try {
        for (const member of members) {
          // 预分配 agentId + 预登记装配期绑定（见 memberPort 的 createAgentId/resolveMemberBinding）。
          const preAssignedAgentId = `agent_${randomId()}`;
          nextSpawnAgentId = preAssignedAgentId;
          pendingSpawnBindings.set(preAssignedAgentId, member.memberName);
          const output = await memberPort.launch({
            // 父会话 = lead（与 dispatch 一致；此前误传臆造 childSessionId，成员事件与
            // 产物目录全部挂到不存在的会话上）。
            sessionId: lead.sessionId,
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
          // 2026-10-21 缺口2/6 身份回链：roster 的 agentId/childSessionId 必须是 runner
          // 分配的真实值——此前 install 臆造 agent_ 前缀 id，registry、sendMessage 派发
          // 与成员工具路由（按 childSessionId 联接）全部找不到成员。
          if (output.status !== "async_launched") {
            throw new Error(
              `team member ${member.memberName} spawn returned unexpected status ${output.status}`,
            );
          }
          spawned.push({
            memberName: member.memberName,
            agentId: output.agentId,
            childSessionId: output.childSessionId,
          });
        }
      } catch (error) {
        // 2026-10-21 缺口6 原子性回收：第 k 个成员 launch 失败时前 k-1 个已成真——
        // 反向中断已启动成员并等其终态，孤儿子代理在本进程内消亡。回收失败不吞原始
        // 错误（草案回滚照常，hub 侧零确认零 journal 污染）；孤儿最坏由进程退出兜底。
        for (const row of spawned) {
          pendingSpawnBindings.delete(row.agentId);
          try {
            await settleMemberTask(row.memberName, row.agentId);
          } catch (settleError) {
            lead.logger?.warn(
              `agents team: spawned member rollback failed for ${row.memberName}`,
              {
                event: "agents_team.spawn_rollback_failed",
                module: "bootstrap.agentsTeam",
                sessionId: lead.sessionId,
                error: settleError instanceof Error ? settleError.message : String(settleError),
              },
            );
          }
        }
        nextSpawnAgentId = undefined;
        // 失败批次的装配期绑定整体作废（含 launch 早期抛错、工厂未消费的预分配 id）：
        // 回滚路径无 roster 确认，残留绑定只会让不存在的 agentId 命中成员装配。
        pendingSpawnBindings.clear();
        throw error;
      }
      // 全部成功后才一次性确认（缺口6）：member_added journal 事实与真实身份同批落库，
      // 部分失败时零污染、草案原样保留（staged，零成员）可修订后重批。
      for (const row of spawned) {
        pendingSpawnBindings.delete(row.agentId);
        hub.confirmMemberSpawned(row.memberName, row.agentId, row.childSessionId);
        memberPortByChildSession.set(
          row.childSessionId,
          hub.memberPort({ agentId: row.agentId, memberName: row.memberName }),
        );
        // launch 期间 registry 已 register(running) 且 subscribe 边缘早于 roster 确认——
        // 确认后补一次同步，成员立即从 spawning 翻到 working（不待下一次 registry 变更）。
        syncMemberRuntimeState(row.agentId, row.memberName);
      }
      return spawned;
    },
  });

  installedHub = hub;
  if (hub.teamId !== undefined) emitTeamStateChanged(hub.teamId);

  // agentId 预分配（缺口2/6）：launch 前预分配 id 让 install 与 runner/registry 同源，
  // 并预登记装配期绑定——成员首回合构造发生在 confirmMemberSpawned 之前，roster 还是
  // pending_ 占位，没有这份预登记成员会回退 lead 当前模式而非成队定死的记录值（spec §8.1）。
  // spawnMembers 串行 launch， holder 无并发交叠；复活路径复用旧 agentId 不走工厂。
  let nextSpawnAgentId: string | undefined;
  const pendingSpawnBindings = new Map<string, string>();

  const memberPort = createTeamMemberPort({
    lead,
    leadDeps: input.leadDeps,
    registry: toolRegistry,
    resolveMemberBinding: (agentId) => {
      const roster = hub.snapshot();
      const member = roster?.members.find((candidate) => candidate.agentId === agentId);
      if (member !== undefined) {
        return {
          memberName: member.memberName,
          permissionMode: roster?.permissionMode,
          memberMaxTurns: TEAM_MEMBER_MAX_TURNS,
        };
      }
      const pendingMemberName = pendingSpawnBindings.get(agentId);
      if (pendingMemberName !== undefined) {
        return {
          memberName: pendingMemberName,
          permissionMode: roster?.permissionMode,
          memberMaxTurns: TEAM_MEMBER_MAX_TURNS,
        };
      }
      return undefined;
    },
    runtimeTaskRegistry: taskRegistry,
    createAgentId: () => {
      const id = nextSpawnAgentId ?? `agent_${randomId()}`;
      nextSpawnAgentId = undefined;
      return id;
    },
  });

  // 团队工具注册：同一注册表实例服务 lead 与全体成员；身份经 hub 在场性校验
  //（E6 成员移除/E10 lead 专属由端口实现保证）。
  for (const entry of createTeamCollabToolEntries((context) => {
    if (context.sessionId === lead.sessionId) return hub.leadPort(lead.sessionId);
    return memberPortByChildSession.get(context.sessionId);
  })) {
    toolRegistry.register(entry);
  }
  // lead 专属工具族（2026-10-21 缺口0，spec §14）：TeamSpawn 是 staged 草案的唯一
  // 生产入口——/team 命令展开后模型建花名册 + DAG，审批是用户侧 v4 命令。成员会话
  // 解析为 undefined（E10 lead 专属结构性保证）。
  for (const entry of createTeamLeadToolEntries((context) =>
    context.sessionId === lead.sessionId ? hub.leadPort(lead.sessionId) : undefined,
  )) {
    toolRegistry.register(entry);
  }

  // 2026-10-21 缺口12（spec §14）：lead 会话 TurnComplete 边缘——归还接管任务
  //（returnLeadTakeovers 生产接线，此前唯一 lead 边缘钩子零调用）+ 补投 lead 待决
  // 邮件（routeMail 即时投递失败的重试边缘）。fire-and-forget，不阻塞事件链。
  lead.eventSinks.add({
    onSessionEvent: (event) => {
      if (event.sessionId !== lead.sessionId) return;
      if (event.type !== SessionEventType.TurnComplete) return;
      hub.returnLeadTakeovers();
      void hub.deliverPendingLeadMail().catch(() => undefined);
      return undefined;
    },
  });

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
        // 2026-10-21 边缘2（spec §14）：冷恢复后按花名册重建 memberPortByChildSession
        //——此前只在 spawn 路径填充，恢复成员虽在册（member_added 事实带
        // childSessionId），成员会话的团队工具解析（按 childSessionId 联接）永远
        // miss，恢复后成员用不了任务板。
        for (const member of hub.snapshot()?.members ?? []) {
          if (member.state === "removed" || member.childSessionId === undefined) continue;
          if (member.agentId.startsWith("pending_")) continue;
          memberPortByChildSession.set(
            member.childSessionId,
            hub.memberPort({ agentId: member.agentId, memberName: member.memberName }),
          );
        }
        // 恢复窗口内积压的 lead 待决邮件补投（缺口12）。
        void hub.deliverPendingLeadMail().catch(() => undefined);
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
