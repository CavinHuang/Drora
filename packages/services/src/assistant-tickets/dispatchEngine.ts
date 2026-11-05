/**
 * 派发引擎（P2 host 内核；02 详设 §1.3/§2/§3/§4/§5 的执行侧）。
 *
 * 从 assistantTicketsService 抽出的派发生命周期唯一执行者（单一写者纪律不变：全部
 * 台账写经 db 事务）：Mode A/B 派发（带序 commandId+锚回写）、Mode C 附着、follow-up
 * 锚校验（Tier1）、换代重派（spec §8 三触发源）、软预算 queued FIFO 释放、W1 worktree
 * 建/清（终态保留分支）、ticketLedger 归账终点（turn/teamActivity 第三信号）。
 *
 * 事件顺序（approve → 引擎）：
 *   服务事务建票 → engine.dispatchNewTicket
 *     ├─ probe/写域规划（W1: git worktree add，幂等续用）
 *     ├─ dispatch/attach 端口（commandId=<ticketId>-<seq>）
 *     ├─ 成功 → 事务回写 incarnation{sessionId,anchor,seq} + status=running + 挂帧订阅
 *     └─ 失败 → markTicketFailed（fail_reason+mandate revoked，不重试）
 *   终态（ledger onTicketTerminal）→ worktree 清理（分支保留）→ queued FIFO 释放一笔。
 * 触发源仅事件与校验（禁超时兜底）：turn/team 帧、session.removed、锚对账。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_GENERATION_CAUSES,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import { createTicketLedger, parseTicketFrameEvents } from "./ticketLedger.js";
import type { AssistantResult } from "./assistantTickets.js";
import { getAssistantPorts } from "./assistantPorts.js";
import type { AssistantDispatchResult } from "./assistantPorts.js";
import {
  parseIncarnation,
  serializeIncarnation,
  composeDispatchCommandId,
  resolveAnchorVerdict,
  type AnchorProbe,
  type AssistantIncarnation,
} from "./incarnation.js";
import { createGenerationRollover } from "./generationRollover.js";
import { composeTeamLeadBrief } from "./routerShell.js";
import { parseDispatchIntent } from "./dispatchIntent.js";
import {
  detectWriteDomainOverlap,
  parseWriteDomainColumn,
  planWriteDomain,
  isSameWorktreeDomain,
  type AssistantWriteDomain,
} from "./writeDomain.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

function fail<T>(code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES], reason?: string): AssistantResult<T> {
  return { ok: false, error: { code, reason } };
}

interface EngineTicketRow {
  id: string;
  brief: string;
  status: string;
  write_domain: string | null;
  dispatch_mode: string | null;
  dispatch_intent: string | null;
  queued_reason: string | null;
  target_workspace_identity: string;
  incarnation_current: string;
  incarnation_generations: string;
  usage_accum: string;
  output_summary: string | null;
  fail_reason: string | null;
  updated_ms: number;
}

function readEngineTicketRow(raw: AssistantDatabaseRaw, ticketId: string): EngineTicketRow | undefined {
  return raw.prepare("SELECT id, brief, status, write_domain, dispatch_mode, dispatch_intent, queued_reason, target_workspace_identity, incarnation_current, incarnation_generations, usage_accum, output_summary, fail_reason, updated_ms FROM ticket WHERE id = ?").get(ticketId) as
    | EngineTicketRow
    | undefined;
}

export interface DispatchEngineDeps {
  readonly db: AssistantDatabase;
  readonly publish: () => void;
  /** kv 配置读取（软预算/W1 开关；服务闭包注入避免双份实现）。 */
  readonly readConfig: (raw: AssistantDatabaseRaw) => {
    readonly budgetMaxActivePerWorkspace: number;
    readonly worktreeDisabled: boolean;
  };
}

export function createDispatchEngine(deps: DispatchEngineDeps): {
  applyTicketTurnEvent: ReturnType<typeof createTicketLedger>["applyTicketTurnEvent"];
  applyTicketTeamEvent: ReturnType<typeof createTicketLedger>["applyTicketTeamEvent"];
  /** Mode B 第三信号入口：按 sessionId 反查工单后走 teamActivity 归账。 */
  applyTeamActivityForSession(input: {
    sessionId: string;
    teamStatus: string;
    atMs: number;
  }): boolean;
  /** 写域规划（W1 worktree 实建/续用；服务在排队闸之前调用；allowWorktree=false=Mode B）。 */
  planDispatchTarget(input: {
    ticketId: string;
    targetIdentity: string;
    existingDomain?: AssistantWriteDomain;
    allowWorktree?: boolean;
  }): Promise<
    { ok: true; hostPath?: string; domain?: AssistantWriteDomain } | { ok: false; reason: string }
  >;
  dispatchNewTicket(input: {
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: "build" | "guarded";
    mode: "A" | "B";
    hostPath?: string;
    domain?: AssistantWriteDomain;
  }): Promise<AssistantDispatchResult>;
  attachDispatch(input: {
    ticketId: string;
    text: string;
    targetIdentity: string;
    sessionId: string;
  }): Promise<AssistantDispatchResult>;
  /** Tier2 预检（放行事务前；不消费决策卡）。 */
  probeAttachTarget(input: { targetIdentity: string; sessionId: string }): Promise<AnchorProbe>;
  followUp(input: { ticketId: string; text: string }): Promise<AssistantDispatchResult>;
  recycle(input: {
    ticketId: string;
    cause: string;
    note?: string;
  }): Promise<AssistantDispatchResult>;
  notifySessionRemoved(sessionId: string): void;
  unwatchSession(sessionId: string): void;
  activeCountFor(identity: string, excludeTicketId?: string): number;
  listActiveWriteDomains(identity: string): Array<{ ticketId: string; domain: AssistantWriteDomain }>;
  setWriteDomain(ticketId: string, domain: AssistantWriteDomain): void;
  queueTicket(ticketId: string, reason: string): void;
  markTicketFailed(ticketId: string, reason: string): void;
  /** 用户 stop 直改终态后的清理+queued 释放（不经 ledger 的路径）。 */
  handleManualStop(ticketId: string): void;
} {
  const { db } = deps;
  /** sessionId → 订阅句柄（派发/附着成功即挂，终态/stop 即卸；P1 语义原样迁移）。 */
  const sessionWatches = new Map<string, { dispose(): void; ticketId: string }>();
  /** sessionId → sessions-index 订阅句柄（Mode B teamActivity + session.removed 触发源②）。 */
  const sessionsIndexWatches = new Map<string, { dispose(): void }>();

  const ledger = createTicketLedger({
    db,
    publish: deps.publish,
    onTicketTerminal: (entry) => {
      cleanupWorktree(entry.ticketId);
      releaseNextQueued(entry.workspaceIdentity);
    },
  });

  // ----------------------------------------------------------------
  // 帧订阅（P1 watchTicket 语义 + hostPath 定位）
  // ----------------------------------------------------------------

  function watchTicket(ticketId: string, sessionId: string, workspaceIdentity: string, hostPath?: string): void {
    const { frameSource } = getAssistantPorts();
    if (!frameSource) return;
    const existing = sessionWatches.get(sessionId);
    if (existing) {
      existing.dispose();
      sessionWatches.delete(sessionId);
    }
    const handle = frameSource.subscribe(sessionId, workspaceIdentity || undefined, hostPath, (candidate) => {
      let becameTerminal = false;
      for (const event of parseTicketFrameEvents(candidate, sessionId)) {
        if (ledger.applyTicketTurnEvent({ ...event, ticketId })) {
          becameTerminal = true;
        }
      }
      if (becameTerminal) unwatchSession(sessionId);
    });
    sessionWatches.set(sessionId, { dispose: handle.dispose, ticketId });
    // sessions-index 增量（02 §5 teamActivity 第三信号 + §3 触发源②生命周期）——
    // 端口未装配时缺席合法（P1 形态），装配层负责真实订阅。
    const { sessionsIndex } = getAssistantPorts();
    if (sessionsIndex) {
      const indexHandle = sessionsIndex.watchSessions(
        workspaceIdentity || "",
        hostPath,
        (delta) => {
          if (delta.kind === "removed") {
            if (delta.sessionId === sessionId) notifySessionRemoved(sessionId);
            return;
          }
          const teamStatus = delta.summary.teamActivity?.status;
          if (teamStatus) {
            ledger.applyTicketTeamEvent({ ticketId, teamStatus, atMs: Date.now() });
          }
        },
      );
      sessionsIndexWatches.set(sessionId, indexHandle);
    }
  }

  function unwatchSession(sessionId: string): void {
    const handle = sessionWatches.get(sessionId);
    if (!handle) return;
    sessionWatches.delete(sessionId);
    handle.dispose();
    sessionsIndexWatches.get(sessionId)?.dispose();
    sessionsIndexWatches.delete(sessionId);
  }

  // ----------------------------------------------------------------
  // 锚与带序 commandId（02 §3：投递序号落为 incarnation.dispatchSeq 行内记账，
  // 与锚回写同事务，避免 kv/行双写漂移——详设偏差已登记）
  // ----------------------------------------------------------------

  // ----------------------------------------------------------------
  // 写域规划与 W1 worktree（02 §4；git 端口未装配时 W1 计划如实失败——不假装隔离）
  // ----------------------------------------------------------------

  async function resolveWorktree(input: {
    ticketId: string;
    targetIdentity: string;
    existingDomain?: AssistantWriteDomain;
    /** false=Mode B 建队（02 §5）：lead 团队会话跑主工作区，不做 W1 worktree。 */
    allowWorktree?: boolean;
  }): Promise<{ ok: true; hostPath?: string; domain?: AssistantWriteDomain } | { ok: false; reason: string }> {
    const { workspaceProbe, gitWorktree } = getAssistantPorts();
    if (input.allowWorktree === false) {
      if (!workspaceProbe || !input.targetIdentity) {
        // P1 形态：无探测通道/无目标 identity → 共享对话目录（装配层回退）。
        return { ok: true };
      }
      const probe = await workspaceProbe(input.targetIdentity);
      if (!probe.ok) {
        return { ok: false, reason: `workspace 探测失败：${probe.reason}` };
      }
      return { ok: true, hostPath: probe.workspacePath, domain: { kind: "workspace" } };
    }
    if (!workspaceProbe || !input.targetIdentity) {
      // P1 形态：无探测通道/无目标 identity → 共享对话目录 + workspace 域（未隔离，UI 明示）。
      return { ok: true };
    }
    const probe = await workspaceProbe(input.targetIdentity);
    if (!probe.ok) {
      return { ok: false, reason: `workspace 探测失败：${probe.reason}` };
    }
    const config = deps.readConfig(db.raw);
    const plan = planWriteDomain({
      ticketId: input.ticketId,
      probe,
      worktreeDisabled: config.worktreeDisabled,
    });
    if (!plan.ok) {
      return { ok: false, reason: plan.reason };
    }
    if (plan.domain.kind !== "worktree" || !plan.worktreeRequest) {
      return { ok: true, hostPath: probe.workspacePath, domain: plan.domain };
    }
    if (input.existingDomain && isSameWorktreeDomain(input.existingDomain, plan.domain)) {
      // 换代续用（02 §4：已检出则续用不重复 add——git 端口实现亦幂等，双保险）。
      return { ok: true, hostPath: plan.domain.path, domain: plan.domain };
    }
    if (!gitWorktree) {
      return { ok: false, reason: "W1 worktree 通道未装配（git 端口缺省）" };
    }
    const added = await gitWorktree.addWorktree({
      workspacePath: probe.workspacePath,
      path: plan.worktreeRequest.path,
      branch: plan.worktreeRequest.branch,
    });
    if (!added.ok) {
      return { ok: false, reason: `worktree add 失败：${added.reason}` };
    }
    return { ok: true, hostPath: plan.domain.path, domain: plan.domain };
  }

  // ----------------------------------------------------------------
  // 派发核心（A/B/C 共用）：带序 commandId → 端口 → 回写锚/status → 挂帧
  // ----------------------------------------------------------------

  async function runDispatchCall(input: {
    ticketId: string;
    targetIdentity: string;
    briefOrText: string;
    tier: "build" | "guarded";
    mode: "A" | "B" | "C";
    hostPath?: string;
    attachSessionId?: string;
  }): Promise<AssistantDispatchResult> {
    const ports = getAssistantPorts();
    const row = readEngineTicketRow(db.raw, input.ticketId);
    if (!row) return fail(ASSISTANT_ERROR_CODES.ticketNotFound, `ticket ${input.ticketId} 不存在`);
    const incarnation = parseIncarnation(row.incarnation_current);
    const seq = (incarnation.dispatchSeq ?? 0) + 1;
    const commandId = composeDispatchCommandId(input.ticketId, seq);
    if (input.mode === "C") {
      if (!ports.attach) {
        return fail(ASSISTANT_ERROR_CODES.dispatchRejected, "附着通道未装配（attach port 未注入）");
      }
      const result = await ports.attach({
        ticketId: input.ticketId,
        text: input.briefOrText,
        targetWorkspaceIdentity: input.targetIdentity,
        sessionId: input.attachSessionId ?? "",
        commandId,
        ...(input.hostPath ? { hostPath: input.hostPath } : {}),
      });
      if (!result.ok) return result;
      commitDispatchSuccess(input.ticketId, result.value.sessionId, commandId, seq, "C", input.hostPath);
      watchTicket(input.ticketId, result.value.sessionId, input.targetIdentity, input.hostPath);
      return result;
    }
    if (!ports.dispatch) {
      return fail(ASSISTANT_ERROR_CODES.dispatchRejected, "派发通道未装配（dispatch port 未注入）");
    }
    const result = await ports.dispatch({
      ticketId: input.ticketId,
      brief: input.briefOrText,
      targetWorkspaceIdentity: input.targetIdentity,
      permissionTier: input.tier,
      commandId,
      dispatchMode: input.mode === "B" ? "B" : "A",
      ...(input.hostPath ? { hostPath: input.hostPath } : {}),
    });
    if (!result.ok) return result;
    commitDispatchSuccess(input.ticketId, result.value.sessionId, commandId, seq, input.mode === "B" ? "B" : "A", input.hostPath);
    watchTicket(input.ticketId, result.value.sessionId, input.targetIdentity, input.hostPath);
    return result;
  }

  /** 派发成功回写：incarnation{sessionId,anchor,seq,hostPath} + status=running + mode（闭包内事务）。 */
  function commitDispatchSuccess(
    ticketId: string,
    sessionId: string,
    commandId: string,
    seq: number,
    mode: "A" | "B" | "C",
    hostPath?: string,
  ): void {
    try {
      db.transaction((raw) => {
        const row = raw
          .prepare("SELECT incarnation_current FROM ticket WHERE id = ?")
          .get(ticketId) as { incarnation_current: string } | undefined;
        if (!row) return;
        const incarnation = parseIncarnation(row.incarnation_current);
        const next: AssistantIncarnation = {
          ...incarnation,
          sessionId,
          anchorCommandId: commandId,
          dispatchSeq: seq,
          ...(hostPath ? { hostPath } : {}),
        };
        raw
          .prepare(
            "UPDATE ticket SET incarnation_current = ?, status = ?, dispatch_mode = ?, updated_ms = ? WHERE id = ?",
          )
          .run(serializeIncarnation(next), ASSISTANT_TICKET_STATUSES.running, mode, nowMs(), ticketId);
      });
    } catch (error) {
      logger.error("assistant-tickets 派发回写异常", error);
    }
  }

  function markTicketFailed(ticketId: string, reason: string): void {
    try {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET status = ?, fail_reason = ?, updated_ms = ? WHERE id = ?")
          .run(ASSISTANT_TICKET_STATUSES.failed, reason, nowMs(), ticketId);
        raw
          .prepare(
            "UPDATE mandate SET state = 'revoked', ended_ms = ?, end_reason = ? WHERE ticket_id = ? AND state = 'active'",
          )
          .run(nowMs(), `dispatch_failed: ${reason}`, ticketId);
      });
      deps.publish();
    } catch (error) {
      logger.error("assistant-tickets 失败落账异常", error);
    }
  }

  // ----------------------------------------------------------------
  // 对外入口
  // ----------------------------------------------------------------

  async function dispatchNewTicket(input: {
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: "build" | "guarded";
    mode: "A" | "B";
    /** 服务侧已规划（engine.planDispatchTarget）；引擎不再二次探测。 */
    hostPath?: string;
    domain?: AssistantWriteDomain;
  }): Promise<AssistantDispatchResult> {
    // 写域落列（建票事务未写列；派发前落列——queued/running 行都带域，冲突比对可见）。
    if (input.domain) {
      try {
        db.transaction((raw) => {
          raw
            .prepare("UPDATE ticket SET write_domain = ? WHERE id = ?")
            .run(JSON.stringify(input.domain), input.ticketId);
        });
        deps.publish();
      } catch (error) {
        logger.warn("assistant-tickets 写域落列失败", error);
      }
    }
    const result = await runDispatchCall({
      ticketId: input.ticketId,
      targetIdentity: input.targetIdentity,
      briefOrText: input.brief,
      tier: input.tier,
      mode: input.mode,
      ...(input.hostPath ? { hostPath: input.hostPath } : {}),
    });
    if (!result.ok) {
      markTicketFailed(input.ticketId, result.error.reason ?? result.error.code);
      return result;
    }
    return result;
  }

  async function attachDispatch(input: {
    ticketId: string;
    text: string;
    targetIdentity: string;
    sessionId: string;
  }): Promise<AssistantDispatchResult> {
    // 附着目标落位（W3：用户自己的工作目录）——探测可用即取真实路径，缺省装配层回退。
    const { workspaceProbe } = getAssistantPorts();
    let hostPath: string | undefined;
    if (workspaceProbe && input.targetIdentity) {
      const probe = await workspaceProbe(input.targetIdentity);
      if (probe.ok) hostPath = probe.workspacePath;
    }
    // Tier2 派发桥校验（02 §2）：存在/归属 identity 校验后才可投（busy 排队合法）。
    const probe = await probeAnchor(input.targetIdentity, input.sessionId, hostPath);
    if (probe.kind !== "ok") {
      return fail(
        ASSISTANT_ERROR_CODES.attachTargetInvalid,
        `附着目标校验失败：${resolveAnchorVerdict(probe).reason}`,
      );
    }
    const row = readEngineTicketRow(db.raw, input.ticketId);
    if (!row) return fail(ASSISTANT_ERROR_CODES.ticketNotFound, `ticket ${input.ticketId} 不存在`);
    const result = await runDispatchCall({
      ticketId: input.ticketId,
      targetIdentity: input.targetIdentity,
      briefOrText: input.text,
      tier: "build",
      mode: "C",
      attachSessionId: input.sessionId,
      ...(hostPath ? { hostPath } : {}),
    });
    if (!result.ok) {
      markTicketFailed(input.ticketId, result.error.reason ?? result.error.code);
      return result;
    }
    // 附着写回 cause='attached'（02 §2：绑定只存 TicketService，不进任何会话上下文）。
    try {
      db.transaction((raw) => {
        const current = raw
          .prepare("SELECT incarnation_current FROM ticket WHERE id = ?")
          .get(input.ticketId) as { incarnation_current: string } | undefined;
        if (!current) return;
        const incarnation = parseIncarnation(current.incarnation_current);
        raw
          .prepare("UPDATE ticket SET incarnation_current = ? WHERE id = ?")
          .run(serializeIncarnation({ ...incarnation, cause: "attached" }), input.ticketId);
      });
      deps.publish();
    } catch (error) {
      logger.warn("assistant-tickets 附着 cause 回写失败", error);
    }
    return result;
  }

  async function probeAnchor(
    identity: string,
    sessionId: string,
    hostPath?: string,
  ): Promise<AnchorProbe> {
    const { sessionsIndex } = getAssistantPorts();
    if (!sessionsIndex) {
      return { kind: "unavailable", reason: "会话索引通道未装配（fail-closed，不猜锚位）" };
    }
    return sessionsIndex.probeSession(identity, sessionId, hostPath);
  }

  // ----------------------------------------------------------------
  // follow-up（Tier1 直读投递）与换代（spec §8）：执行细节在 generationRollover.ts
  // （≤800 行纪律拆分）；引擎注入 runDispatchCall/attachDispatch 复用执行链。
  // ----------------------------------------------------------------

  const rollover = createGenerationRollover({
    db,
    publish: deps.publish,
    readTicketRow: readEngineTicketRow,
    runDispatchCall,
    attachDispatch,
    markTicketFailed,
    resolveWorktree,
    unwatchTicketRow: unwatchTicketByRow,
    hasWatchForTicket: (ticketId) => {
      for (const handle of sessionWatches.values()) {
        if (handle.ticketId === ticketId) return true;
      }
      return false;
    },
  });

  function unwatchTicketByRow(row: { incarnation_current: string }): void {
    const incarnation = parseIncarnation(row.incarnation_current);
    if (incarnation.sessionId) unwatchSession(incarnation.sessionId);
  }

  /** 触发源②：sessions-index session.removed → 该会话若被监听即换代重派（无损重启）。 */
  function notifySessionRemoved(sessionId: string): void {
    const handle = sessionWatches.get(sessionId);
    if (!handle) return;
    unwatchSession(sessionId);
    void rollover.recycle({
      ticketId: handle.ticketId,
      cause: ASSISTANT_GENERATION_CAUSES.lost,
      note: "sessions-index session.removed（会话删除/归档）",
    }).catch((error) => logger.warn("assistant-tickets 会话移除换代失败", error));
  }

  /**
   * Mode B 第三信号入口（02 §5）：sessions-index 桥把被监听会话的 teamActivity 状态喂给
   * 台账；按 incarnation.sessionId 反查工单（监听面只对被监听会话，通常即命中）。
   */
  function applyTeamActivityForSession(input: {
    sessionId: string;
    teamStatus: string;
    atMs: number;
  }): boolean {
    const handle = sessionWatches.get(input.sessionId);
    const ticketId =
      handle?.ticketId ??
      findActiveTicketIdBySessionId(input.sessionId) ??
      "";
    if (!ticketId) return false;
    return ledger.applyTicketTeamEvent({
      ticketId,
      teamStatus: input.teamStatus,
      atMs: input.atMs,
    });
  }

  function findActiveTicketIdBySessionId(sessionId: string): string | null {
    const rows = db.raw
      .prepare("SELECT id, incarnation_current FROM ticket WHERE status IN (?, ?, ?)")
      .all(
        ASSISTANT_TICKET_STATUSES.dispatched,
        ASSISTANT_TICKET_STATUSES.running,
        ASSISTANT_TICKET_STATUSES.queued,
      ) as Array<{ id: string; incarnation_current: string }>;
    for (const row of rows) {
      try {
        const incarnation = parseIncarnation(row.incarnation_current);
        if (incarnation.sessionId === sessionId) return row.id;
      } catch {
        // 坏 JSON 行跳过（诚实不猜；由其他路径暴露）。
      }
    }
    return null;
  }

  // ----------------------------------------------------------------
  // 软预算 queued FIFO（spec §9）与终态清理（02 §4）
  // ----------------------------------------------------------------

  function activeCountFor(identity: string, excludeTicketId?: string): number {
    const rows = db.raw
      .prepare(
        "SELECT id FROM ticket WHERE target_workspace_identity = ? AND status IN (?, ?)",
      )
      .all(identity, ASSISTANT_TICKET_STATUSES.dispatched, ASSISTANT_TICKET_STATUSES.running) as Array<{ id: string }>;
    return rows.filter((row) => row.id !== excludeTicketId).length;
  }

  /** 同 workspace 活动工单的写域清单（W2/W3 冲突比对原料；queued 不参与）。 */
  function listActiveWriteDomains(identity: string): Array<{ ticketId: string; domain: AssistantWriteDomain }> {
    const rows = db.raw
      .prepare(
        "SELECT id, write_domain FROM ticket WHERE target_workspace_identity = ? AND status IN (?, ?)",
      )
      .all(identity, ASSISTANT_TICKET_STATUSES.dispatched, ASSISTANT_TICKET_STATUSES.running) as Array<{
      id: string;
      write_domain: string | null;
    }>;
    const result: Array<{ ticketId: string; domain: AssistantWriteDomain }> = [];
    for (const row of rows) {
      const domain = parseWriteDomainColumn(row.write_domain) ?? { kind: "workspace" as const };
      result.push({ ticketId: row.id, domain });
    }
    return result;
  }

  function setWriteDomain(ticketId: string, domain: AssistantWriteDomain): void {
    try {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET write_domain = ? WHERE id = ?")
          .run(JSON.stringify(domain), ticketId);
      });
      deps.publish();
    } catch (error) {
      logger.warn("assistant-tickets 写域落列失败", error);
    }
  }

  /** 软预算/写域冲突排队（spec §9：超出排队+告知卡；reason 进 queued_reason 供告知卡）。 */
  function queueTicket(ticketId: string, reason: string): void {
    try {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET status = ?, queued_reason = ?, updated_ms = ? WHERE id = ?")
          .run(ASSISTANT_TICKET_STATUSES.queued, reason, nowMs(), ticketId);
      });
      logger.info("assistant-tickets 工单进入 queued（软预算/写域冲突）", { ticketId });
      deps.publish();
    } catch (error) {
      logger.error("assistant-tickets 排队落账异常", error);
    }
  }

  /**
   * queued FIFO 释放（spec §9；P2 审查修复后语义）：
   * - 预算复检（原有）：活动工单仍满 → 不释放；
   * - 写域冲突复检（修复审查发现：此前只在放行闸判定，无关工单终态即可让与仍在活动
   *   的对手并存的队头直接派发，破坏「两两写域不相交」不变式）：队头与当前活动工单
   *   仍重叠 → 该工单保持 queued 并终止本轮释放（FIFO 不越位跳过，后续终态再试）；
   * - 按落库 dispatch_intent 重放派发形态（修复审查发现：此前按派发成功才写入的
   *   dispatch_mode 判型——queued 行恒 NULL → Mode B 建队退化为 Mode A 直派、
   *   Mode C 附着退化为开新会话、放行权限档降为 build）：
   *   B → composeTeamLeadBrief 幂等重套 /team 指示后 Mode B 派发；
   *   C → attachDispatch 附着原目标（attachDispatch 内先重过 Tier2 校验，失败诚实落 failed）；
   *   A/缺列（v2 旧行）→ Mode A 直派原文。
   */
  function releaseNextQueued(identity: string): void {
    void (async () => {
      const config = deps.readConfig(db.raw);
      if (activeCountFor(identity) >= config.budgetMaxActivePerWorkspace) return;
      const released = db.transaction(
        (raw):
          | {
              id: string;
              brief: string;
              write_domain: string | null;
              intent: ReturnType<typeof parseDispatchIntent>;
            }
          | null => {
          const next = raw
            .prepare(
              "SELECT id, brief, dispatch_intent, write_domain FROM ticket WHERE status = ? AND target_workspace_identity = ? ORDER BY created_ms ASC LIMIT 1",
            )
            .get(ASSISTANT_TICKET_STATUSES.queued, identity) as
            | { id: string; brief: string; dispatch_intent: string | null; write_domain: string | null }
            | undefined;
          if (!next) return null;
          // 写域冲突复检（同 evaluateQueueGate 的 overlap 分支口径）：队头写域沿用建票
          // 时落列；queued 行不进活动集（listActiveWriteDomains 只查 dispatched/running），
          // 须显式比对。冲突 → 不出队（保持 queued），终止本轮释放（FIFO 不越位）。
          const ownDomain = parseWriteDomainColumn(next.write_domain) ?? { kind: "workspace" as const };
          const rows = raw
            .prepare(
              "SELECT id, write_domain FROM ticket WHERE target_workspace_identity = ? AND status IN (?, ?)",
            )
            .all(identity, ASSISTANT_TICKET_STATUSES.dispatched, ASSISTANT_TICKET_STATUSES.running) as Array<{
            id: string;
            write_domain: string | null;
          }>;
          const conflict = rows.some((entry) => {
            if (entry.id === next.id) return false;
            const domain = parseWriteDomainColumn(entry.write_domain) ?? { kind: "workspace" as const };
            return detectWriteDomainOverlap(domain, ownDomain);
          });
          if (conflict) {
            logger.info("assistant-tickets queued 队头写域仍与活动工单重叠，保持排队", {
              ticketId: next.id,
            });
            return null;
          }
          raw
            .prepare("UPDATE ticket SET status = ?, queued_reason = NULL, updated_ms = ? WHERE id = ?")
            .run(ASSISTANT_TICKET_STATUSES.dispatched, nowMs(), next.id);
          return { ...next, intent: parseDispatchIntent(next.dispatch_intent) };
        },
      );
      if (!released) return;
      // 释放派发不重过预算闸（已复检）；写域沿用建票时规划（worktree 已检出则 git 端口幂等续用）。
      const domain = parseWriteDomainColumn(released.write_domain);
      const intent = released.intent;
      const tier = intent?.tier ?? "build";
      const result =
        intent?.mode === "C" && intent.attachSessionId
          ? await attachDispatch({
              ticketId: released.id,
              text: released.brief,
              targetIdentity: identity,
              sessionId: intent.attachSessionId,
            })
          : await dispatchNewTicket({
              ticketId: released.id,
              // Mode B：释放重套建队指示（brief 列恒存原文，指示不落库、幂等重套——02 §5）。
              brief: intent?.mode === "B" ? composeTeamLeadBrief(released.brief) : released.brief,
              targetIdentity: identity,
              tier,
              mode: intent?.mode === "B" ? "B" : "A",
              ...(domain?.kind === "worktree" ? { hostPath: domain.path } : {}),
              ...(domain && intent?.mode !== "C" ? { domain } : {}),
            });
      if (!result.ok) {
        logger.warn("assistant-tickets queued 释放派发失败", { ticketId: released.id });
      } else {
        logger.info("assistant-tickets queued 工单按 FIFO 释放", {
          ticketId: released.id,
          mode: intent?.mode ?? "A",
        });
      }
      deps.publish();
    })().catch((error) => logger.warn("assistant-tickets queued 释放异常", error));
  }

  /** 终态清理：W1 worktree remove（分支保留）；失败动作追加 fail_reason 附属日志（02 §4）。 */
  function cleanupWorktree(ticketId: string): void {
    void (async () => {
      const { gitWorktree } = getAssistantPorts();
      const row = readEngineTicketRow(db.raw, ticketId);
      const domain = parseWriteDomainColumn(row?.write_domain ?? null);
      if (!gitWorktree || domain?.kind !== "worktree") return;
      const removed = await gitWorktree.removeWorktree({ path: domain.path });
      if (removed.ok) return;
      const note = `[worktree清理失败] ${removed.reason}`;
      try {
        db.transaction((raw) => {
          raw
            .prepare("UPDATE ticket SET fail_reason = COALESCE(fail_reason || char(10), '') || ? WHERE id = ?")
            .run(note, ticketId);
        });
        deps.publish();
      } catch (error) {
        logger.warn("assistant-tickets 清理失败留痕异常", error);
      }
    })().catch((error) => logger.warn("assistant-tickets worktree 清理异常", error));
  }

  /** 用户 stop 的终态后续（不经 ledger 的直改终态也要走清理+queued 释放）。 */
  function handleManualStop(ticketId: string): void {
    const row = readEngineTicketRow(db.raw, ticketId);
    if (!row) return;
    cleanupWorktree(ticketId);
    releaseNextQueued(row.target_workspace_identity);
  }

  return {
    applyTicketTurnEvent: ledger.applyTicketTurnEvent,
    applyTicketTeamEvent: ledger.applyTicketTeamEvent,
    applyTeamActivityForSession,
    planDispatchTarget: resolveWorktree,
    dispatchNewTicket,
    attachDispatch,
    probeAttachTarget: rollover.probeAttachTarget,
    followUp: rollover.followUp,
    recycle: rollover.recycle,
    notifySessionRemoved,
    unwatchSession,
    activeCountFor,
    listActiveWriteDomains,
    setWriteDomain,
    queueTicket,
    markTicketFailed,
    handleManualStop,
  };
}
