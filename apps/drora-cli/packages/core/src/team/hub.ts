import type {
  TeamApproveResult,
  TeamLeadPort,
  TeamMemberPort,
  TeamMutationResult,
  TeamPermissionMode,
  TeamRosterSnapshot,
  TeamReassignInput,
  TeamSendDelivery,
  TeamSendInput,
  TeamSendResult,
  TeamStageInput,
  TeamStageResult,
  TeamStatus,
  TeamTaskClaimResult,
  TeamTaskCreateInput,
  TeamTaskMutationResult,
  TeamTaskUpdateInput,
  TeamBoardSnapshot,
} from "@drora/contracts";
import {
  applyTaskUpdate,
  beginTaskAttempt,
  claimTask,
  collectCompletedDependencyOutputs,
  formatDependencyOutputs,
  invalidateTaskAttempt,
  isTerminalTaskStatus,
  ownedOpenTask,
  unsatisfiedDependencies,
  type BoardClock,
} from "./board.js";
import { teamPortError } from "./errors.js";
import {
  appendToMailbox,
  isCurrentMail,
  markDelivered,
  pendingMail,
  validateMessageSize,
} from "./mailbox.js";
import { buildRevivalBody, buildSteerPayload } from "./message-format.js";
import {
  taskJournalFactOf,
  type TeamJournalPayload,
  type TeamJournalWriter,
} from "./journal.js";
import {
  LEAD_ASSIGNEE_KEY,
  TEAM_KERNEL_LIMITS,
  type TeamInternalLimits,
  type TeamMailboxEntry,
  type TeamMemberInternal,
  type TeamRecord,
  type TeamTaskInternal,
  taskCardOf,
} from "./types.js";

/**
 * TeamHub——花名册/任务板/邮箱的唯一所有者（specs/agents-team.md §2.2）。
 *
 * 并发模型（spec §16.1）：hub 是进程内唯一写者，方法级串行（单线程裁决）；
 * 中断与静默是异步的，交接用「裁决内失效 → 裁决外静默 → 再入校验 handoffId
 * （新者胜）」三步（reassign）。派发失败回滚只撤销自己的票（attemptId 对账）。
 * 事件驱动自动派发（spec §2.3）：成员终态边缘触发 kick，邮箱优先于新任务；
 * 无轮询，lead 离线时调度静止。
 */

export type TeamDispatchFn = (request: {
  memberName: string;
  prompt: string;
  mode: "steer" | "queue";
  attemptId?: string;
}) => Promise<boolean>;

export interface TeamHubDeps {
  clock?: BoardClock;
  /** 建队时捕获的 lead 会话权限模式（spec §8.1 成队定死；plan 不带入由 install 换算）。 */
  leadPermissionMode?: TeamPermissionMode;
  /** 派发通道（PR-1.6 接真实投递；测试注入假通道）。缺席 = 派发永远不被接受。 */
  dispatch?: TeamDispatchFn;
  /** 转派静默通道：中断旧成员并等待其终态结算；抛错 = 静默失败（交接保持 in-flight）。 */
  interruptAndSettle?: (memberName: string) => Promise<void>;
  /**
   * 邮箱持久化（写成功才算发送成功，E12）：同步入队契约——抛错即发送失败、
   * 消息不进邮箱；journal 的异步刷盘由 M3 的 writer 内部保证。
   */
  persistMailboxEntry?: (entry: TeamMailboxEntry) => void;
  /**
   * Approve & Run 的原子 spawn：全部成员创建成功返回 agentId 表；任一失败抛错
   * （hub 回滚草案为 staged，零成员）。PR-1.6 接私有端口；测试注入。
   */
  spawnMembers?: (
    members: readonly { memberName: string; profile: string; modelSelection?: { provider: string; model: string; thought?: string } }[],
    permissionMode: TeamPermissionMode | undefined,
  ) => Promise<readonly { memberName: string; agentId: string; childSessionId: string }[]>;
  membersMax?: number;
  limits?: TeamInternalLimits;
  /** 状态变化通知(β 接缝):install 借此向 v4 投影发 TeamStateChanged 会话事件。 */
  onChange?: () => void;
  /**
   * journal 写入（M3 PR-3.1，spec 差异裁决#5）：动作点的「用户/协议动作与板/邮箱
   * 数据事实」追加。同步入队契约（同 persistMailboxEntry）——hub 不等待刷盘、
   * 不因 journal 失败中断裁决；实现（journal.ts sink）内部串行异步刷盘并兜错。
   */
  journalWriter?: TeamJournalWriter;
}

const DEFAULT_CLOCK: BoardClock = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
};

interface DispatchTicket {
  taskId: string;
  memberName: string;
  attemptId: string;
  attempt: number;
  previousAssignee?: string;
  recoveredOwned: boolean;
  previousStatus?: "claimed" | "in_progress";
  previousAttemptId?: string;
}

export class TeamHub {
  private readonly clock: BoardClock;
  private readonly limits: TeamInternalLimits;
  private readonly membersMax: number;
  private record: TeamRecord | undefined;
  private readonly parkedAttempts = new Map<string, string>();
  private readonly dispatch: TeamDispatchFn;
  private readonly deps: Pick<TeamHubDeps, "interruptAndSettle" | "persistMailboxEntry" | "spawnMembers">;
  private readonly dispatchQueues = new Map<string, Promise<unknown>>();
  private readonly notifyChange: () => void;
  /** journal 追加（缺席 = no-op；异常吞并——journal 是旁路事实流，不得中断裁决）。 */
  private readonly journalWriter: TeamJournalWriter;

  constructor(private readonly depsOrUndefined: TeamHubDeps = {}) {
    this.clock = depsOrUndefined.clock ?? DEFAULT_CLOCK;
    this.limits = depsOrUndefined.limits ?? TEAM_KERNEL_LIMITS;
    this.membersMax = depsOrUndefined.membersMax ?? 5;
    this.dispatch =
      depsOrUndefined.dispatch ??
      (async () => false);
    this.notifyChange = depsOrUndefined.onChange ?? (() => undefined);
    this.journalWriter = depsOrUndefined.journalWriter ?? (() => undefined);
    this.deps = depsOrUndefined;
  }

  // ---------- 查询 ----------

  get teamId(): string | undefined {
    return this.record?.teamId;
  }

  get status(): TeamStatus | undefined {
    return this.record?.status;
  }

  snapshot(): TeamRosterSnapshot | undefined {
    const record = this.record;
    if (record === undefined) return undefined;
    return {
      teamId: record.teamId,
      leadSessionId: record.leadSessionId,
      ...(record.permissionMode === undefined ? {} : { permissionMode: record.permissionMode }),
      status: record.status,
      // 2026-10-21 缺口10：查询面补齐草案 name 与逐成员路由快照回读——
      // reviseTeamPlan/setTeamMemberName 以 snapshot/board 重建草案入参，缺这两项
      // 会让 stageTeam 整体替换 + journalStagedFact 把 team 名与 modelSelection
      // （spec §8.7 建队时刻定死）静默清空并持久化。additive optional，投影侧
      // （product-projection teamProjectionViewOf）逐字段映射不受影响。
      ...(record.name === undefined ? {} : { name: record.name }),
      members: record.members
        .filter((member) => !member.removed)
        .map((member) => ({
          agentId: member.agentId,
          memberName: member.memberName,
          ...(member.profile === undefined ? {} : { profile: member.profile }),
          ...(member.profileColor === undefined ? {} : { profileColor: member.profileColor }),
          state: member.state,
          ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
          ...(member.modelSelection === undefined ? {} : { modelSelection: member.modelSelection }),
        })),
    };
  }

  board(): TeamBoardSnapshot | undefined {
    const record = this.record;
    if (record === undefined) return undefined;
    return {
      teamId: record.teamId,
      tasks: record.tasks.map(taskCardOf),
      limit: this.limits.boardTasksMax,
    };
  }

  /** 邮箱全量（M2 投影取尾窗前的数据源；测试断言用）。 */
  mailboxEntries(): readonly TeamMailboxEntry[] {
    return this.record?.mailbox ?? [];
  }

  /**
   * staged 草案的「回对话修改」等待反馈标记（M3 PR-3.1 回填：TeamRecord 内部标记，
   * 仅 staged 态有语义）。β 投影桥经此读，替换 v1 投影侧容缺（缺席按 false）。
   */
  get awaitingFeedback(): boolean {
    return this.record?.status === "staged" && this.record.awaitingFeedback === true;
  }

  // ---------- 两阶段成队（spec §1 / §2.6；设计差异 D3） ----------

  stageTeam(leadSessionId: string, input: TeamStageInput): TeamStageResult {
    if (this.record !== undefined && !isStageEditable(this.record.status)) {
      return { status: "rejected", error: teamPortError("team_not_present") };
    }
    if (input.draftMembers.length > this.membersMax) {
      return {
        status: "rejected",
        error: teamPortError("board_limit_reached", { limit: String(this.membersMax) }),
      };
    }
    // 2026-10-18 team UI 审查修复（E13/E14）：wire 面的 agent↔task 关系全部按
    // memberName 联接（assignee/下钻门/邮箱 from-to），重名会让联接错位、悬空
    // assignee 会显示不存在的负责人——在草案落库前源头拦截，而不是让投影带病展示。
    const draftNames = new Set<string>();
    for (const member of input.draftMembers) {
      if (draftNames.has(member.memberName)) {
        return {
          status: "rejected",
          error: teamPortError("draft_duplicate_member", { name: member.memberName }),
        };
      }
      draftNames.add(member.memberName);
    }
    for (const task of input.draftTasks) {
      if (
        task.assignee !== undefined &&
        task.assignee !== LEAD_ASSIGNEE_KEY &&
        !draftNames.has(task.assignee)
      ) {
        return {
          status: "rejected",
          error: teamPortError("draft_unknown_assignee", { name: task.assignee }),
        };
      }
    }
    const now = this.clock.now();
    if (this.record === undefined) {
      // 权限模式成队定死（spec §8.1）：plan 由 install 换算为 build 后传入；
      // 未记录（undefined）= 旧宿主/未知值，读回时回退继承 lead 当前模式。
      this.record = {
        teamId: `team_${this.clock.newId()}`,
        ...(input.name === undefined ? {} : { name: input.name }),
        leadSessionId,
        ...(this.depsOrUndefined.leadPermissionMode === undefined
          ? {}
          : { permissionMode: this.depsOrUndefined.leadPermissionMode }),
        status: input.skipApproval === true ? "staged" : "staged",
        members: [],
        tasks: [],
        mailbox: [],
        createdAt: now,
        updatedAt: now,
      };
      this.notifyChange();
      // journal（差异裁决#5）：成队是用户动作，权限模式记录值随 team_created 事实持久化。
      this.journal({
        kind: "team_created",
        teamId: this.record.teamId,
        leadSessionId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(this.depsOrUndefined.leadPermissionMode === undefined
          ? {}
          : { permissionMode: this.depsOrUndefined.leadPermissionMode }),
        createdAt: now,
      });
    }
    // staged 再次调用 = 原子更新同一草案（同 teamId，不另建）。
    this.record.name = input.name;
    this.record.updatedAt = now;
    this.record.tasks = input.draftTasks.map((draft) =>
      this.materializeTask(draft, now),
    );
    this.record.members = input.draftMembers.map((draft) => ({
      agentId: `pending_${draft.memberName}`,
      memberName: draft.memberName,
      profile: draft.profile,
      ...(draft.modelSelection === undefined ? {} : { modelSelection: draft.modelSelection }),
      state: "spawning" as const,
      removed: false,
    }));
    this.notifyChange();
    this.journalStagedFact();
    return { status: "ok", teamId: this.record.teamId };
  }

  /**
   * 「回对话修改」等待反馈标记（M3 PR-3.1）：仅 staged 态有语义；reviseTeamPlan
   * 命令置 true，approveStage 清除。staged 事实（含标记）随 journal 更新，恢复后
   * 草案的等待反馈态不丢。
   */
  markStageAwaitingFeedback(leadSessionId: string): TeamMutationResult {
    const record = this.record;
    if (record === undefined || record.status !== "staged") {
      return { status: "rejected", error: teamPortError("team_not_present") };
    }
    if (record.leadSessionId !== leadSessionId) {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    record.awaitingFeedback = true;
    record.updatedAt = this.clock.now();
    this.notifyChange();
    this.journalStagedFact();
    return { status: "ok" };
  }

  /** staged 草案事实（成员/任务/等待反馈标记整体快照；重放 = 原子替换草案）。 */
  private journalStagedFact(): void {
    const record = this.record;
    if (record === undefined || record.status !== "staged") return;
    this.journal({
      kind: "staged",
      teamId: record.teamId,
      ...(record.name === undefined ? {} : { name: record.name }),
      awaitingFeedback: record.awaitingFeedback === true,
      members: record.members.map((member) => ({
        memberName: member.memberName,
        ...(member.profile === undefined ? {} : { profile: member.profile }),
        ...(member.modelSelection === undefined ? {} : { modelSelection: member.modelSelection }),
      })),
      tasks: record.tasks.map(taskJournalFactOf),
    });
  }

  abandonStage(leadSessionId: string): TeamMutationResult {
    const record = this.requireLeadRecord(leadSessionId);
    if (typeof record === "string") return { status: "rejected", error: teamPortError(record) };
    if (record.status !== "staged") {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    record.status = "archived";
    record.updatedAt = this.clock.now();
    // 归档事实入 journal：恢复后草案不得「复活」为 staged（spec §2.6 禁止自动重建）。
    this.journal({ kind: "archived", teamId: record.teamId });
    return { status: "ok" };
  }

  /** Approve & Run：唯一创建成员的裁决入口；全败回滚草案（spec §1 两阶段成队）。 */
  async approveStage(leadSessionId: string): Promise<TeamApproveResult> {
    const record = this.requireLeadRecord(leadSessionId);
    if (typeof record === "string") return { status: "rejected", error: teamPortError(record) };
    if (record.status !== "staged") {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    const draft = record.members.filter((member) => !member.removed);
    const spawn = this.deps.spawnMembers;
    if (spawn === undefined) {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    try {
      const spawned = await spawn(
        draft.map((member) => ({
          memberName: member.memberName,
          profile: member.profile ?? "",
          ...(member.modelSelection === undefined ? {} : { modelSelection: member.modelSelection }),
        })),
        record.permissionMode,
      );
      const byName = new Map(spawned.map((row) => [row.memberName, row] as const));
      for (const member of record.members) {
        const row = byName.get(member.memberName);
        if (row === undefined) continue;
        member.agentId = row.agentId;
        member.childSessionId = row.childSessionId;
        member.state = "spawning";
      }
      record.status = "active";
      record.updatedAt = this.clock.now();
      // 审批清除「等待反馈」标记（标记仅 staged 态有语义；退出 staged 即清）。
      delete record.awaitingFeedback;
      this.notifyChange();
      // journal：审批是用户动作；成员 agentId 事实由 spawn 回调里的 member_added 逐条记。
      this.journal({ kind: "approved", teamId: record.teamId });
      return { status: "ok", spawnedMembers: spawned.map((row) => row.memberName) };
    } catch {
      // 原子性：spawn 失败 → 草案原样保留（staged，零真实成员），可修订后重批。
      // 2026-10-21 缺口6：错误码与邮箱持久化失败（E12）分开——spawn 失败是成员进程
      // 创建问题（该重批草案），不是消息未发出（该重发消息），混用会误导调用方。
      return { status: "rejected", error: teamPortError("member_spawn_failed") };
    }
  }

  // ---------- 停止与恢复（spec §2.6：halted ≠ escalated） ----------

  halt(leadSessionId: string): TeamMutationResult {
    const record = this.requireLeadRecord(leadSessionId);
    if (typeof record === "string") return { status: "rejected", error: teamPortError(record) };
    if (record.status === "staged" || isArchival(record.status)) {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    record.status = "halted";
    record.updatedAt = this.clock.now();
    // 冻结态事实入 journal（差异裁决#5：状态迁移本身不记，用户裁决结果保留）。
    this.journal({ kind: "halted", teamId: record.teamId });
    this.notifyChange();
    // 2026-10-21 缺口7：停队必须中断在飞成员（spec §2.6「中断全员 + 冻结调度」的
    // 中断半边；此前只翻状态，在飞成员回合继续跑到自然终态）。裁决外静默（同
    // reassign 第 2 步，不持裁决等待）；静默失败不回滚冻结——冻结面已生效，被中断
    // 成员的终态边缘由 install 的运行态接线收敛到 terminal。
    const settle = this.deps.interruptAndSettle;
    if (settle !== undefined) {
      for (const member of record.members) {
        if (member.removed || (member.state !== "working" && member.state !== "spawning")) continue;
        void Promise.resolve(settle(member.memberName)).catch(() => undefined);
      }
    }
    return { status: "ok" };
  }

  resume(leadSessionId: string, reason: string): TeamMutationResult {
    const record = this.requireLeadRecord(leadSessionId);
    if (typeof record === "string") return { status: "rejected", error: teamPortError(record) };
    if (record.status !== "halted" && record.status !== "escalated") {
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    if (reason.trim() === "") {
      // 用户停的队不得静默恢复（spec §2.6）。
      return { status: "rejected", error: teamPortError("team_lead_only") };
    }
    record.status = this.hasWorkingMember(record) ? "active" : "idle";
    record.updatedAt = this.clock.now();
    // resumed 事实解除恢复侧的冻结推导（halted→resumed 序列保留，spec §2.6）。
    this.journal({ kind: "resumed", teamId: record.teamId, reason });
    this.notifyChange();
    // 2026-10-21 缺口7（resume 半边）：halt 中断的成员其终态边缘在冻结期内被消费
    // （handleMemberTerminal 冻结跳过 kick，hub.ts:483），resume 后不再有任何可等的
    // 派发边缘——共享池 pending 任务与待投递邮箱将无派发源（事件驱动无轮询，spec
    // §2.3），投影显示 idle 看似健康实则调度死寂。resume 即唤醒边缘：kickTeam 重新
    // 武装调度（终态成员复活派发共享池/邮箱任务）；被中断成员的开放 attempt 仍
    // sticky park（只由 lead 转派轮换，spec §16.1）。escalated→resume 同理受益
    // （成员循环到上限的终态边缘在 escalated 冻结期同样不 kick）。fire-and-forget
    // （同 removeMember 先例，hub.ts:536-543），不阻塞同步裁决返回。
    void this.kickTeam().catch(() => undefined);
    return { status: "ok" };
  }

  /** 自动循环到上限时调用（M5 接线）；escalated 只能由用户 resume 解除。 */
  markEscalated(): TeamMutationResult {
    const record = this.record;
    if (record === undefined || record.status === "staged" || isArchival(record.status)) {
      return { status: "rejected", error: teamPortError("team_not_present") };
    }
    record.status = "escalated";
    record.updatedAt = this.clock.now();
    this.journal({ kind: "escalated", teamId: record.teamId });
    this.notifyChange();
    return { status: "ok" };
  }

  // ---------- 成员生命周期 ----------

  /** 注册真实成员（approveStage 的 spawn 回调成功后由 install 侧确认，或测试直接用）。 */
  confirmMemberSpawned(memberName: string, agentId: string, childSessionId: string): void {
    const record = this.record;
    if (record === undefined) return;
    const member = record.members.find(
      (candidate) => candidate.memberName === memberName && !candidate.removed,
    );
    if (member === undefined) return;
    member.agentId = agentId;
    member.childSessionId = childSessionId;
    // journal：成员出生事实（恢复侧据此把草案成员锚定到真实 child 会话）。
    this.journal({ kind: "member_added", teamId: record.teamId, memberName, agentId, childSessionId });
  }

  markMemberWorking(memberName: string): void {
    const member = this.findMember(memberName);
    if (member === undefined || member.removed) return;
    member.state = "working";
    this.refreshStatus();
  }

  /**
   * 成员终态边缘（自动派发的触发点，spec §2.3）：持开放 attempt 的驻留成员
   * 被 sticky park（只有 lead 转派可轮换）；随后刷新状态并 kick（邮箱/新任务）。
   */
  async handleMemberTerminal(memberName: string): Promise<void> {
    const record = this.record;
    const member = this.findMember(memberName);
    if (record === undefined || member === undefined || member.removed) return;
    member.state = "terminal";
    const owned = ownedOpenTask(record.tasks, memberName);
    if (owned?.attemptId !== undefined) {
      this.parkedAttempts.set(member.agentId, owned.attemptId);
    } else if (member.agentId !== undefined) {
      this.parkedAttempts.delete(member.agentId);
    }
    this.refreshStatus();
    if (record.status === "active" || record.status === "idle") {
      await this.kickMember(memberName);
    }
  }

  /**
   * 冷恢复单次重试（spec §2.3）：开放 attempt 且成员已终态离场 → 自动重试恰一次；
   * 恢复投递失败恢复原世代并保持 parked，**不退回 pending**（防无限重派）。
   */
  async recoverOpenAttempt(memberName: string): Promise<boolean> {
    const record = this.record;
    if (record === undefined || record.status === "halted" || record.status === "staged") return false;
    const member = this.findMember(memberName);
    const owned = ownedOpenTask(record.tasks, memberName);
    if (member === undefined || owned === undefined || owned.attemptId === undefined) return false;
    if (owned.recoveryRetried === true) return false;
    const ticket = this.beginDispatchTicket(owned, member, true);
    const accepted = await this.dispatchTicket(ticket);
    if (accepted) {
      owned.recoveryRetried = true;
      this.parkedAttempts.set(member.agentId, owned.attemptId ?? "");
      return true;
    }
    this.rollbackTicket(ticket);
    owned.recoveryRetried = true;
    if (member.agentId !== "") this.parkedAttempts.set(member.agentId, ticket.previousAttemptId ?? "");
    return false;
  }

  /** 成员移除安全序（spec §16.2）：失效 → 回收任务 → 标记移除（→静默/重派由 install 驱动）。 */
  removeMember(memberName: string): TeamMutationResult {
    const record = this.record;
    if (record === undefined) return { status: "rejected", error: teamPortError("team_not_present") };
    const member = this.findMember(memberName);
    if (member === undefined || member.removed) {
      return { status: "rejected", error: teamPortError("member_removed") };
    }
    const owned = ownedOpenTask(record.tasks, memberName);
    if (owned !== undefined) {
      invalidateTaskAttempt(owned, undefined, this.clock, false);
      this.journalTaskFact(owned);
    }
    member.removed = true;
    member.state = "removed";
    this.parkedAttempts.delete(member.agentId);
    this.refreshStatus();
    // journal：移除事实 = 退休拒绝表持久化（被移除成员永不复活，E6/E11，spec §16.2）。
    this.journal({ kind: "member_removed", teamId: record.teamId, memberName });
    this.notifyChange();
    // 2026-10-21 缺口7：补齐移除安全序的「排空/中断 → 等待结算 → 重新调度」后两步
    //（spec §16.2；此前任务回收回池后无人唤醒，滞留 pending）。先裁决外静默被移除
    // 成员（其驻留回合的迟到写入已被 attempt 失效 + 在场性校验双重拒绝），结算完成后
    // kickTeam 唤醒其余成员认领回收任务；两步均 fire-and-forget，不阻塞同步裁决返回。
    const settle = this.deps.interruptAndSettle;
    if (settle !== undefined) {
      void Promise.resolve(settle(memberName))
        .catch(() => undefined)
        .then(() => this.kickTeam().catch(() => undefined));
    } else {
      void this.kickTeam().catch(() => undefined);
    }
    return { status: "ok" };
  }

  // ---------- 派发（邮箱优先 + 回滚只撤己票，spec §16.1/§16.3） ----------

  /** 成员级派发串行（同成员两次 kick 不并发派两张票）。 */
  async kickMember(memberName: string): Promise<void> {
    const record = this.record;
    if (
      record === undefined ||
      record.status === "staged" ||
      record.status === "halted" ||
      isArchival(record.status)
    ) {
      return;
    }
    const previous = this.dispatchQueues.get(memberName) ?? Promise.resolve();
    const tail = previous.catch(() => undefined).then(() => this.doKickMember(memberName));
    this.dispatchQueues.set(
      memberName,
      tail.finally(() => {
        if (this.dispatchQueues.get(memberName) === tail) this.dispatchQueues.delete(memberName);
      }),
    );
    await tail;
  }

  async kickTeam(): Promise<void> {
    const record = this.record;
    if (record === undefined) return;
    for (const member of record.members.filter((candidate) => !candidate.removed)) {
      await this.kickMember(member.memberName);
    }
  }

  private async doKickMember(memberName: string): Promise<void> {
    const record = this.record;
    if (record === undefined || record.status === "staged" || record.status === "halted" || isArchival(record.status)) {
      return;
    }
    const member = this.findMember(memberName);
    if (member === undefined || member.removed) return;

    // 邮箱优先：pending 邮件是真实的待处理工作（spec §16.3）。
    const ready = pendingMail(record.mailbox, record.tasks, memberName);
    if (ready.length > 0) {
      const ids = ready.map((item) => item.messageId);
      const body = ready
        .map((item) => `${buildRevivalBody(item, { teamId: record.teamId, ...(record.name === undefined ? {} : { teamName: record.name }) })}`)
        .join("\n\n---\n\n");
      const accepted = await this.dispatch({
        memberName,
        prompt: body,
        mode: "steer",
      });
      if (accepted) {
        record.mailbox = markDelivered(record.mailbox, ids, "steered", this.clock.now());
        record.updatedAt = this.clock.now();
        // journal：送达 ack 是邮箱数据事实（ack 只认注入；恢复后不重复投递）。
        this.journal({
          kind: "message_delivered",
          teamId: record.teamId,
          messageIds: ids,
          via: "steered",
          at: this.clock.now(),
        });
      }
      // 未接受 → 保留未投递（下次终态边缘/复活再投），不 ack 不丢弃。
      return;
    }

    // 驻留成员 idle 边缘持开放 attempt → sticky park（只有 lead 转派可轮换）。
    const owned = ownedOpenTask(record.tasks, memberName);
    if (owned !== undefined) {
      this.parkedAttempts.set(member.agentId, owned.attemptId ?? "");
      return;
    }

    // 自动派发：指派给自己的 ready 任务优先，其次共享池未指派任务。
    const task = this.nextReadyTask(record, memberName);
    if (task === undefined) return;
    const ticket = this.beginDispatchTicket(task, member, false);
    await this.dispatchTicket(ticket);
  }

  private nextReadyTask(record: TeamRecord, memberName: string): TeamTaskInternal | undefined {
    const ready = record.tasks.filter(
      (task) =>
        task.status === "pending" &&
        task.reassigning !== true &&
        unsatisfiedDependencies(record.tasks, task.dependsOn).length === 0,
    );
    return ready.find((task) => task.assignee === memberName) ?? ready.find((task) => task.assignee === undefined);
  }

  private beginDispatchTicket(
    task: TeamTaskInternal,
    member: TeamMemberInternal,
    recoveredOwned: boolean,
  ): DispatchTicket {
    // 前世代必须在 beginTaskAttempt 改写之前捕获（回滚/恢复依据）。
    const previousStatus: "claimed" | "in_progress" | undefined = recoveredOwned
      ? task.status === "in_progress"
        ? "in_progress"
        : "claimed"
      : undefined;
    const previousAttemptId = recoveredOwned ? task.attemptId : undefined;
    const previousAssignee = task.assignee;
    const attemptId = beginTaskAttempt(task, member.memberName, this.clock);
    // journal：先于派发结果持久化新世代——若进程在「已派发、未结算」间崩溃，
    // 恢复侧看到 claimed+attemptId 才不会把成员手里的凭证当 stale（spec §16.1）。
    this.journalTaskFact(task);
    return {
      taskId: task.taskId,
      memberName: member.memberName,
      attemptId,
      attempt: task.attempt,
      recoveredOwned,
      ...(previousStatus === undefined ? {} : { previousStatus }),
      ...(previousAttemptId === undefined ? {} : { previousAttemptId }),
      ...(previousAssignee === undefined ? {} : { previousAssignee }),
    };
  }

  private async dispatchTicket(ticket: DispatchTicket): Promise<boolean> {
    const record = this.record;
    const task = record?.tasks.find((candidate) => candidate.taskId === ticket.taskId);
    if (record === undefined || task === undefined) return false;
    const digest = formatDependencyOutputs(
      collectCompletedDependencyOutputs(record.tasks, task.taskId),
      {
        perItemChars: this.limits.dependencyDigestPerItemChars,
        totalChars: this.limits.dependencyDigestTotalChars,
      },
    );
    const prompt = [
      `Agents Team automatic task assignment from the shared task list.`,
      ``,
      `Task: ${task.taskId} — ${task.title}`,
      `Goal: ${task.spec.goal}`,
      `Acceptance: ${task.spec.acceptance.join("; ") || "(none)"}`,
      ...(task.spec.outputFormat === undefined ? [] : [`Output format: ${task.spec.outputFormat}`]),
      `Completed dependency results:\n${digest}`,
      ``,
      `Attempt: ${ticket.attempt}`,
      `Attempt id: ${ticket.attemptId}`,
      ``,
      `Claim this task (attempt_id ${ticket.attemptId} will be returned), then include attempt_id=${ticket.attemptId} in every task update. If an update is rejected as stale, the task was reassigned: stop working on it. claimed cannot jump to completed. Do not approve your own implementation. Work only this task in this turn.`,
    ].join("\n");
    const accepted = await this.dispatch({
      memberName: ticket.memberName,
      prompt,
      mode: "queue",
      attemptId: ticket.attemptId,
    });
    if (accepted) return true;

    // 回滚只撤销自己的票：并发交接已轮换世代时新者胜，不覆盖（spec §16.1）。
    this.rollbackTicket(ticket);
    return false;
  }

  private rollbackTicket(ticket: DispatchTicket): void {
    const record = this.record;
    const task = record?.tasks.find((candidate) => candidate.taskId === ticket.taskId);
    const member = record?.members.find((candidate) => candidate.memberName === ticket.memberName);
    if (task === undefined || task.attemptId !== ticket.attemptId) return;
    if (ticket.recoveredOwned && ticket.previousAttemptId !== undefined) {
      // 恢复投递失败：恢复原世代并保持 parked，不退回 pending（防无限重派）。
      task.status = ticket.previousStatus ?? "claimed";
      task.attemptId = ticket.previousAttemptId;
      task.assignee = ticket.previousAssignee;
    } else {
      task.status = "pending";
      task.attemptId = undefined;
      task.assignee = ticket.previousAssignee;
    }
    task.updatedAt = this.clock.now();
    this.journalTaskFact(task);
    if (member !== undefined && !member.removed) member.state = "terminal";
    this.refreshStatus();
  }

  // ---------- 转派三步（lead 专属；spec §16.1） ----------

  async reassign(leadSessionId: string, input: TeamReassignInput): Promise<TeamMutationResult> {
    const record = this.requireLeadRecord(leadSessionId);
    if (typeof record === "string") return { status: "rejected", error: teamPortError(record) };
    if (record.status === "staged" || isArchival(record.status) || record.status === "halted") {
      return { status: "rejected", error: teamPortError("team_halted") };
    }
    const task = record.tasks.find((candidate) => candidate.taskId === input.taskId);
    if (task === undefined) return { status: "rejected", error: teamPortError("team_not_present") };
    if (isTerminalTaskStatus(task.status)) {
      return { status: "rejected", error: teamPortError("invalid_transition", { from: task.status, to: "pending" }) };
    }
    if (task.reassigning) {
      return { status: "rejected", error: teamPortError("attempt_revoked") };
    }
    if (input.to !== LEAD_ASSIGNEE_KEY && this.findMember(input.to) === undefined) {
      return { status: "rejected", error: teamPortError("name_redirect", { name: input.to }) };
    }
    if (input.to === LEAD_ASSIGNEE_KEY) {
      // lead 接管唯一性（失效之前检查——失效不可回滚）。
      const openTakeover = record.tasks.find(
        (candidate) =>
          candidate !== task &&
          candidate.assignee === LEAD_ASSIGNEE_KEY &&
          (candidate.status === "claimed" || candidate.status === "in_progress"),
      );
      if (openTakeover !== undefined) {
        return { status: "rejected", error: teamPortError("team_lead_only") };
      }
    }

    // 第 1 步（裁决内）：失效旧凭证 + 铸交接世代。
    const previousAssignee = task.assignee;
    const handoffId = invalidateTaskAttempt(task, input.to === LEAD_ASSIGNEE_KEY ? LEAD_ASSIGNEE_KEY : input.to, this.clock, true);
    // journal：失效事实先落（后续静默失败时「凭证已清、交接在途」也是持久真相）。
    this.journalTaskFact(task);

    // 第 2 步（裁决外）：中断旧成员并等待静默（不持裁决等待）。
    if (previousAssignee !== undefined && previousAssignee !== LEAD_ASSIGNEE_KEY) {
      const settle = this.deps.interruptAndSettle;
      if (settle !== undefined) {
        try {
          await settle(previousAssignee);
        } catch {
          // 静默失败：交接保持 in-flight（reassigning=true），调用方感知失败。
          return { status: "rejected", error: teamPortError("attempt_revoked") };
        }
      }
    }

    // 第 3 步（再入校验）：handoffId 未变才提交；变了说明有更新交接在途，新者胜。
    const fresh = record.tasks.find((candidate) => candidate.taskId === input.taskId);
    if (fresh === undefined || fresh.handoffId !== handoffId || fresh.reassigning !== true) {
      return { status: "rejected", error: teamPortError("attempt_revoked") };
    }
    if (input.to === LEAD_ASSIGNEE_KEY) {
      beginTaskAttempt(fresh, LEAD_ASSIGNEE_KEY, this.clock);
      // lead 已在发起接管的回合内，无 claim 握手 → 直接 in_progress。
      fresh.status = "in_progress";
      fresh.updatedAt = this.clock.now();
      this.journalTaskFact(fresh);
    }
    fresh.reassigning = false;
    fresh.updatedAt = this.clock.now();
    this.journalTaskFact(fresh);
    // 新目标唤醒（邮箱派发其认领提示/任务卡）。
    if (input.to !== LEAD_ASSIGNEE_KEY) await this.kickMember(input.to);
    return { status: "ok" };
  }

  /** lead idle 边缘：未完成接管归还共享池（lead 无调度通道，防永久 parked）。 */
  returnLeadTakeovers(): number {
    const record = this.record;
    if (record === undefined) return 0;
    let returned = 0;
    for (const task of record.tasks) {
      if (
        task.assignee === LEAD_ASSIGNEE_KEY &&
        !isTerminalTaskStatus(task.status)
      ) {
        invalidateTaskAttempt(task, undefined, this.clock, false);
        this.journalTaskFact(task);
        returned += 1;
      }
    }
    if (returned > 0) this.refreshStatus();
    return returned;
  }

  // ---------- 恢复（M3 PR-3.1：lead resume 路径，journal.ts restoreAgentsTeamFromJournal 调用） ----------

  /**
   * 装入 journal 重放重建的 TeamRecord（仅当 hub 尚无在库记录——装配竞态窗口内
   * 已创建的新 team 让位于现役记录，不覆盖）。并按重放事实重建驻留 attempt 的
   * sticky park 表（成员终态离场 + 开放 attempt = 冷恢复单次重试的触发前提，spec §2.3）。
   */
  adoptRestored(record: TeamRecord): boolean {
    if (this.record !== undefined) return false;
    this.record = record;
    for (const member of record.members) {
      if (member.removed || member.agentId === "") continue;
      const owned = ownedOpenTask(record.tasks, member.memberName);
      if (owned?.attemptId !== undefined) this.parkedAttempts.set(member.agentId, owned.attemptId);
    }
    this.notifyChange();
    return true;
  }

  // ---------- 端口工厂（两级接口；身份由装配结构性决定） ----------

  memberPort(binding: { agentId: string; memberName: string }): TeamMemberPort {
    return {
      roster: () => this.requireSnapshot(binding) ?? { teamId: "", leadSessionId: "", status: "archived", members: [] },
      boardRead: () =>
        this.board() ?? { teamId: "", tasks: [], limit: this.limits.boardTasksMax },
      taskGet: (taskId) => {
        if (!this.checkPresence(binding)) return undefined;
        const task = this.record?.tasks.find((candidate) => candidate.taskId === taskId);
        return task === undefined ? undefined : taskCardOf(task);
      },
      taskCreate: (input) => this.portTaskCreate(binding, input),
      taskUpdate: (input) => this.portTaskUpdate(binding, input),
      taskClaim: (taskId) => this.portTaskClaim(binding, taskId),
      send: (input) => this.portSend(binding, input),
    };
  }

  leadPort(leadSessionId: string): TeamLeadPort {
    const member = this.memberPort({ agentId: leadSessionId, memberName: LEAD_ASSIGNEE_KEY });
    return {
      ...member,
      taskCreate: (input) => this.portTaskCreate({ agentId: leadSessionId, memberName: LEAD_ASSIGNEE_KEY }, input),
      taskUpdate: (input) => this.portTaskUpdate({ agentId: leadSessionId, memberName: LEAD_ASSIGNEE_KEY }, input),
      taskClaim: (taskId) => this.portTaskClaim({ agentId: leadSessionId, memberName: LEAD_ASSIGNEE_KEY }, taskId),
      stageTeam: (input) => this.stageTeam(leadSessionId, input),
      approveStage: () => this.approveStage(leadSessionId),
      reassign: (input) => this.reassign(leadSessionId, input),
      resume: (reason) => this.resume(leadSessionId, reason),
    };
  }

  private portTaskCreate(
    binding: { agentId: string; memberName: string },
    input: TeamTaskCreateInput,
  ): TeamTaskMutationResult {
    if (!this.checkPresence(binding)) {
      return { status: "rejected", error: teamPortError("member_removed") };
    }
    const record = this.record;
    if (record === undefined) return { status: "rejected", error: teamPortError("team_not_present") };
    if (record.status === "halted") return { status: "rejected", error: teamPortError("team_halted") };
    if (record.status === "staged") return { status: "rejected", error: teamPortError("team_not_present") };
    if (record.tasks.length >= this.limits.boardTasksMax) {
      return { status: "rejected", error: teamPortError("board_limit_reached", { limit: String(this.limits.boardTasksMax) }) };
    }
    const now = this.clock.now();
    const task = this.materializeTask(input, now);
    record.tasks.push(task);
    record.updatedAt = now;
    // 指派任务立即唤醒被指派者（spec §16.2 唤醒与认领分离）。
    if (input.assignee !== undefined && input.assignee !== LEAD_ASSIGNEE_KEY) {
      void this.kickMember(input.assignee);
    }
    this.journal({ kind: "task_created", teamId: record.teamId, task: taskJournalFactOf(task) });
    return { status: "ok", task: taskCardOf(task) };
  }

  private portTaskUpdate(
    binding: { agentId: string; memberName: string },
    input: TeamTaskUpdateInput,
  ): TeamTaskMutationResult {
    if (!this.checkPresence(binding)) {
      return { status: "rejected", error: teamPortError("member_removed") };
    }
    const record = this.record;
    if (record === undefined) return { status: "rejected", error: teamPortError("team_not_present") };
    // 2026-10-21 缺口7：冻结面补漏——halted 后任务更新同样被拒（此前只有 create/claim
    // 有 halted 门，在飞成员回合仍可推进板状态，违背 spec §2.6「冻结调度」）。
    if (record.status === "halted") return { status: "rejected", error: teamPortError("team_halted") };
    const caller = binding.memberName;
    const { task, error } = applyTaskUpdate(record.tasks, input, caller, this.clock);
    if (error !== undefined) return { status: "rejected", error };
    this.refreshStatus();
    // journal：board 数据事实（含终态与署名追补；状态机迁移本身由事实推导，不另记）。
    if (task !== undefined) this.journalTaskFact(task);
    return { status: "ok", ...(task === undefined ? {} : { task: taskCardOf(task) }) };
  }

  private portTaskClaim(
    binding: { agentId: string; memberName: string },
    taskId: string,
  ): TeamTaskClaimResult {
    if (!this.checkPresence(binding)) {
      return { status: "rejected", error: teamPortError("member_removed") };
    }
    const record = this.record;
    if (record === undefined) return { status: "rejected", error: teamPortError("team_not_present") };
    if (record.status === "halted") return { status: "rejected", error: teamPortError("team_halted") };
    const claimant = binding.memberName === LEAD_ASSIGNEE_KEY ? LEAD_ASSIGNEE_KEY : binding.memberName;
    const { task, result } = claimTask(record.tasks, taskId, claimant, this.clock);
    // journal：认领成功 = 板事实变化（attempt 世代是冷恢复单次重试的依据）。
    if (result.status === "claimed" && task !== undefined) this.journalTaskFact(task);
    return result;
  }

  private portSend(
    binding: { agentId: string; memberName: string },
    input: TeamSendInput,
  ): TeamSendResult {
    if (!this.checkPresence(binding)) {
      return { status: "failed", error: teamPortError("member_removed") };
    }
    const record = this.record;
    if (record === undefined) return { status: "failed", error: teamPortError("team_not_present") };
    if (record.status === "halted") return { status: "failed", error: teamPortError("team_halted") };
    if (!validateMessageSize(input.message, this.limits.messageMaxChars)) {
      return { status: "failed", error: teamPortError("message_too_large", { limit: String(this.limits.messageMaxChars) }) };
    }

    // 目标解析：名字必须仍指向原成员（E5 名字重定向防护，spec §2.4）；
    // 已移除/退休成员 → E11（不可复活，找 lead 转派）。
    let targetName = input.to;
    if (input.to !== LEAD_ASSIGNEE_KEY) {
      const direct = this.findMember(input.to);
      const byAgent = record.members.find((candidate) => candidate.agentId === input.to && !candidate.removed);
      if (byAgent !== undefined) {
        targetName = byAgent.memberName;
      } else if (direct !== undefined && direct.removed) {
        return { status: "failed", error: teamPortError("message_target_terminal_retired", { name: input.to }) };
      } else if (direct !== undefined) {
        targetName = direct.memberName;
      } else {
        return { status: "failed", error: teamPortError("name_redirect", { name: input.to }) };
      }
    }
    if (targetName !== LEAD_ASSIGNEE_KEY) {
      const target = this.findMember(targetName);
      if (target === undefined || target.removed) {
        return { status: "failed", error: teamPortError("message_target_terminal_retired", { name: targetName }) };
      }
    }

    // 任务定向邮件：投递时快照板上该任务当前 attemptId（世代过滤载体，spec §16.3）。
    let targetAttemptId: string | undefined;
    if (input.targetTaskId !== undefined) {
      const targetTask = record.tasks.find((candidate) => candidate.taskId === input.targetTaskId);
      targetAttemptId = targetTask?.attemptId;
    }

    const entry: TeamMailboxEntry = {
      messageId: this.clock.newId(),
      from: binding.memberName,
      to: targetName,
      message: input.message,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      at: this.clock.now(),
      ...(input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId }),
      ...(input.sourceAttemptId === undefined ? {} : { sourceAttemptId: input.sourceAttemptId }),
      ...(input.targetTaskId === undefined ? {} : { targetTaskId: input.targetTaskId }),
      ...(targetAttemptId === undefined ? {} : { targetAttemptId }),
      deliveredAccepted: false,
    };

    return this.enqueueMail(entry);
  }

  /** 写成功（持久化）才算发送成功（E12 不变量）；随后投递并只在被接受时 ack。 */
  enqueueMail(entry: TeamMailboxEntry): TeamSendResult {
    const record = this.record;
    if (record === undefined) return { status: "failed", error: teamPortError("team_not_present") };
    const persist = this.deps.persistMailboxEntry;
    if (persist !== undefined) {
      try {
        persist(entry);
      } catch {
        return { status: "failed", error: teamPortError("mailbox_persist_failed") };
      }
    }
    record.mailbox = appendToMailbox(record.mailbox, entry, this.limits.mailboxRetentionPerMember);
    record.updatedAt = this.clock.now();
    // journal：邮箱数据事实（design §3.3.3——journal 就是邮箱的持久化通道）。
    this.journal({ kind: "message_appended", teamId: record.teamId, entry });

    const delivery = this.routeMail(entry);
    this.refreshStatus();
    this.notifyChange();
    return { status: "success", messageId: entry.messageId, delivery };
  }

  private routeMail(entry: TeamMailboxEntry): TeamSendDelivery {
    const record = this.record;
    if (record === undefined || entry.to === LEAD_ASSIGNEE_KEY) return "queued";
    const target = this.findMember(entry.to);
    if (target === undefined || target.removed) return "queued";
    if (target.state === "working") {
      // 运行中成员：steer 注入（presentation=subagent_reply_steer 渲染禁令）。
      const payload = buildSteerPayload(entry);
      const recordNow = record;
      const journalNow = this.journal.bind(this);
      const clockNow = this.clock;
      void this.dispatch({
        memberName: target.memberName,
        prompt: payload.body,
        mode: "steer",
      }).then((accepted) => {
        if (accepted) {
          recordNow.mailbox = markDelivered(
            recordNow.mailbox,
            [entry.messageId],
            "steered",
            clockNow.now(),
          );
          journalNow({
            kind: "message_delivered",
            teamId: recordNow.teamId,
            messageIds: [entry.messageId],
            via: "steered",
            at: clockNow.now(),
          });
        }
      });
      return "steered";
    }
    if (target.state === "terminal") {
      // 终态成员：复活投递（消息体预格式化自嵌禁令，经私有端口 revive 链）。
      const body = buildRevivalBody(entry, {
        teamId: record.teamId,
        ...(record.name === undefined ? {} : { teamName: record.name }),
      });
      const recordNow = record;
      const journalNow = this.journal.bind(this);
      const clockNow = this.clock;
      void this.dispatch({
        memberName: target.memberName,
        prompt: body,
        mode: "queue",
      }).then((accepted) => {
        if (accepted) {
          record.mailbox = markDelivered(
            record.mailbox,
            [entry.messageId],
            "resumed",
            this.clock.now(),
          );
          journalNow({
            kind: "message_delivered",
            teamId: recordNow.teamId,
            messageIds: [entry.messageId],
            via: "resumed",
            at: clockNow.now(),
          });
        }
      });
      return "resumed";
    }
    return "queued";
  }

  // ---------- 内部 ----------

  /**
   * journal 追加入口：动作点只给「数据事实载荷」，这里统一补事实时间戳并包成事件
   * （事实时间与裁决同源 clock，测试可确定性重放）。吞并实现异常——旁路事实流
   * 不得中断裁决（实现内部已兜错，此处防御契约违背）。
   */
  private journal(payload: TeamJournalPayload): void {
    try {
      this.journalWriter({ at: this.clock.now(), payload });
    } catch {
      // journal 写入失败不回滚裁决——运行态保持正确，最坏退化为本进程崩溃后无法恢复。
    }
  }

  /** 任务板事实统一出口（避免逐动作点手拼载荷漏字段）。 */
  private journalTaskFact(task: TeamTaskInternal): void {
    const record = this.record;
    if (record === undefined) return;
    this.journal({ kind: "task_updated", teamId: record.teamId, task: taskJournalFactOf(task) });
  }

  private materializeTask(input: TeamTaskCreateInput, now: string): TeamTaskInternal {
    return {
      taskId: `task_${this.clock.newId()}`,
      title: input.title,
      spec: input.spec,
      status: "pending",
      attempt: 0,
      reassigning: false,
      dependsOn: [...input.dependsOn],
      artifactRefs: [...(input.artifactRefs ?? [])],
      createdAt: now,
      updatedAt: now,
      ...(input.contract === undefined ? {} : { contract: input.contract }),
      ...(input.assignee === undefined ? {} : { assignee: input.assignee }),
    };
  }

  private findMember(memberName: string): TeamMemberInternal | undefined {
    return this.record?.members.find((candidate) => candidate.memberName === memberName);
  }

  /** 在场性校验（spec §16.2）：每次端口调用验证成员仍在花名册（E6）且团队活跃。 */
  private checkPresence(binding: { agentId: string; memberName: string }): boolean {
    const record = this.record;
    if (record === undefined || isArchival(record.status) || record.status === "staged") return false;
    if (binding.memberName === LEAD_ASSIGNEE_KEY) {
      return record.leadSessionId === binding.agentId;
    }
    const member = this.findMember(binding.memberName);
    return member !== undefined && !member.removed && (binding.agentId === "" || member.agentId === binding.agentId);
  }

  private requireLeadRecord(leadSessionId: string): TeamRecord | "team_not_present" | "team_lead_only" {
    const record = this.record;
    if (record === undefined || isArchival(record.status) || record.status === "staged") {
      return record !== undefined && record.status === "staged" && record.leadSessionId === leadSessionId
        ? record
        : "team_not_present";
    }
    if (record.leadSessionId !== leadSessionId) return "team_lead_only";
    return record;
  }

  private requireSnapshot(binding: { agentId: string; memberName: string }): TeamRosterSnapshot | undefined {
    return this.checkPresence(binding) ? this.snapshot() : undefined;
  }

  private hasWorkingMember(record: TeamRecord): boolean {
    return record.members.some(
      (member) => !member.removed && (member.state === "working" || member.state === "spawning"),
    );
  }

  /** 状态机事件驱动迁移（hub 唯一裁决；成员运行态 + 邮箱待决推导，非第二份状态）。 */
  private refreshStatus(): void {
    const record = this.record;
    if (
      record === undefined ||
      record.status === "staged" ||
      record.status === "halted" ||
      record.status === "escalated" ||
      isArchival(record.status)
    ) {
      return;
    }
    const busy =
      this.hasWorkingMember(record) ||
      record.mailbox.some((entry) => !entry.deliveredAccepted && isCurrentMail(record.tasks, entry));
    record.status = busy ? "active" : "idle";
    record.updatedAt = this.clock.now();
    this.notifyChange();
  }
}

function isStageEditable(status: TeamStatus): boolean {
  return status === "staged";
}

function isArchival(status: TeamStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "archived";
}
