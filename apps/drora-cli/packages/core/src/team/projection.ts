import type {
  TeamPermissionMode,
  TeamStatus,
  TeamTaskContract,
  TeamTaskSpec,
  TeamTaskStatus,
} from "@drora/contracts";
import {
  TEAM_LIMITS,
  type TeamMailboxTailEntry,
  type TeamMemberProjection,
  type TeamProjectionState,
  type TeamStagedDraft,
  type TeamTaskCardProjection,
} from "@drora/shared/drora-protocol-v4";
import { isTerminalTaskStatus } from "./board.js";

/**
 * team 投影纯函数（PR-2.3a；specs/agents-team.md §6.3 + design §3.3.1/§3.3.2）。
 *
 * 职责：hub 内部态（TeamRecord 结构）→ shared `teamProjectionStateSchema` 形态的
 * wire 投影。裁剪规则（spec §6.3「尾窗/limit 裁剪有界」，relay envelope oversize
 * 防护）：board.tasks 截到 boardTasksMax——pending/开放任务优先保留、终态任务从
 * 最旧丢弃；mailboxTail 只保留最近 mailboxTailWindow 条；stagedDraft 仅 staged 态
 * 携带。内部交接态（handoffId/reassigning/output/acceptanceSupplement/message 正文/
 * deliveredAt/deliveredVia/target 世代）一律不入投影（design §3.3.2：wire 面只放
 * 显示需要的事实）。
 *
 * 输入是宽松 duck 类型（结构化兼容 TeamRecord，不要求 hub 暴露内部类型）；本文件
 * 不 import hub、不改任何裁决逻辑。bootstrap 帧装配（v4 snapshot/delta 的 team 键
 * 组装点）是 β 接缝，挂 PR-2.3b——本文件不含任何协议通道/订阅/emit 逻辑。
 */

// ---------- 宽松入参（duck 类型；TeamRecord / journal 重放载荷均结构兼容） ----------

/** 投影入参任务卡：wire 卡字段的超集；handoffId/reassigning/output 等内部字段即使在场也被剥离。 */
export interface TeamProjectionTaskInput {
  taskId: string;
  title: string;
  spec: TeamTaskSpec;
  status: TeamTaskStatus;
  assignee?: string;
  attempt: number;
  attemptId?: string;
  dependsOn?: readonly string[];
  artifactRefs?: readonly string[];
  createdAt: string;
  updatedAt: string;
  recoveryRetried?: boolean;
  contract?: TeamTaskContract;
}

/** 投影入参成员：`removed` 为 true 的成员不入投影（与 hub.snapshot() 的花名册语义一致）。 */
export interface TeamProjectionMemberInput {
  agentId: string;
  memberName: string;
  profile?: string;
  profileColor?: string;
  state: TeamMemberProjection["state"];
  childSessionId?: string;
  /** 路由快照（staged 草案行携带，spec §8.7）。 */
  modelSelection?: { provider: string; model: string; thought?: string };
  removed?: boolean;
}

/** 投影入参邮箱条目：正文与投递世代字段可缺席（wire 尾窗不需要，结构容缺）。 */
export interface TeamProjectionMailboxInput {
  messageId: string;
  from: string;
  to: string;
  message?: string;
  summary?: string;
  at: string;
  sourceTaskId?: string;
  sourceAttemptId?: string;
  deliveredAccepted: boolean;
}

/** 产物区引用（`.drora/team-artifacts/{teamId}`；hub v1 未落，缺席即无产物区）。 */
export interface TeamProjectionArtifactsInput {
  dir: string;
}

/**
 * 投影入参聚合记录：结构性兼容 core/src/team/types.ts 的 `TeamRecord`。
 * members/tasks/mailbox 容缺（缺席视为空集）；`awaitingFeedback` 是 staged 草案的
 * 「回对话修改」标记（design §3.3.1）——M3 PR-3.1 起 TeamRecord 有真实载体，
 * β 投影桥从 hub 标记读入；本侧保留可选容缺兼容测试侧宽松入参，缺席按 false。
 */
export interface TeamProjectionRecordInput {
  teamId: string;
  name?: string;
  /**
   * 管理者成员名（spec §22 契约 7；manager=roster 首位）。桥 teamProjectionViewOf 早已
   * 塞进 record，但此前本接口无该字段、输出键清单也不含它——wire 帧恒缺 managerName，
   * UI 管理者徽标永不渲染（§22 契约 7 断链，2026-10-27 审查 H2 补齐）。
   */
  managerName?: string;
  status: TeamStatus;
  permissionMode?: TeamPermissionMode;
  members?: readonly TeamProjectionMemberInput[];
  tasks?: readonly TeamProjectionTaskInput[];
  mailbox?: readonly TeamProjectionMailboxInput[];
  awaitingFeedback?: boolean;
  artifacts?: TeamProjectionArtifactsInput;
}

/** 投影裁剪限额（协议面单一出处 = shared TEAM_LIMITS；调用方可传 PROTOCOL_V4_LIMITS.team 同值）。 */
export interface TeamProjectionLimits {
  boardTasksMax: number;
  mailboxTailWindow: number;
}

/** 默认限额引用 shared 常量（契约键单一出处，不自定义数字）。 */
export const DEFAULT_TEAM_PROJECTION_LIMITS: TeamProjectionLimits = {
  boardTasksMax: TEAM_LIMITS.boardTasksMax,
  mailboxTailWindow: TEAM_LIMITS.teamMailboxTailWindow,
};

// ---------- 裁剪纯函数 ----------

/**
 * 任务板裁剪（保序；spec §6.3「尾窗/limit 裁剪有界」）：
 * 1. 总数 ≤ limit → 全保留；
 * 2. 超限时终态任务（completed/failed/cancelled）从最旧开始丢弃；
 * 3. 只要还有终态任务可丢，pending/claimed/in_progress 等开放任务绝不被丢弃
 *   （terminal 不挤占 pending 窗）；
 * 4. 开放任务自身 ≥ limit 时，pending 保护退化为保序尾窗（保留最新 limit 条）。
 * limit 非正整数时按 1 处理（投影必须有界；wire schema 要求 limit 为正整数）。
 */
export function trimBoardTasks<T>(
  tasks: readonly T[],
  limit: number,
  isTerminal: (task: T) => boolean,
): T[] {
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1;
  if (tasks.length <= effectiveLimit) return [...tasks];
  const open: T[] = [];
  const terminal: T[] = [];
  for (const task of tasks) {
    (isTerminal(task) ? terminal : open).push(task);
  }
  if (open.length >= effectiveLimit) {
    return open.slice(open.length - effectiveLimit);
  }
  const keepTerminal = new Set(
    terminal.slice(terminal.length - (effectiveLimit - open.length)),
  );
  // 保序归并：开放任务全保留，终态保最新的 (limit - open) 条（= 从最旧丢弃）。
  return tasks.filter((task) => !isTerminal(task) || keepTerminal.has(task));
}

/**
 * 邮箱尾窗（最近 window 条，保序；与 mailbox.ts `mailboxTail` 同一语义——此处独立
 * 实现，因为入参是宽松 duck 类型、不依赖内部 TeamMailboxEntry 完整形态）。
 */
export function mailboxTailWindowOf<T>(entries: readonly T[], window: number): T[] {
  const effectiveWindow = Number.isFinite(window) ? Math.max(0, Math.trunc(window)) : 0;
  return entries.slice(Math.max(0, entries.length - effectiveWindow));
}

// ---------- 投影主函数 ----------

/**
 * hub 记录 → wire 投影（纯函数）。返回对象逐键显式构造：缺席字段以「键缺席」表达
 * （照 taskCardOf / workflow-actor-permission.ts 同规，不写 undefined 值）。
 */
export function projectTeam(
  record: TeamProjectionRecordInput,
  limits: TeamProjectionLimits = DEFAULT_TEAM_PROJECTION_LIMITS,
): TeamProjectionState {
  const tasks = record.tasks ?? [];
  const members = record.members ?? [];
  const mailbox = record.mailbox ?? [];
  const draft = stagedDraftOf(record);

  return {
    teamId: record.teamId,
    ...(record.name === undefined ? {} : { name: record.name }),
    // §22 契约 7（2026-10-27 审查 H2 修复）：managerName 此前在桥塞进 record 后于本跳
    // 被静默丢弃（接口无字段、输出无键），wire 恒缺该键——UI 管理者徽标依赖它渲染。
    ...(record.managerName === undefined ? {} : { managerName: record.managerName }),
    status: record.status,
    ...(record.permissionMode === undefined ? {} : { permissionMode: record.permissionMode }),
    members: presentMembers(members).map((member) =>
      memberProjectionOf(member, tasks),
    ),
    board: {
      tasks: trimBoardTasks(tasks, limits.boardTasksMax, (task) =>
        isTerminalTaskStatus(task.status),
      ).map(taskCardProjectionOf),
      limit: limits.boardTasksMax,
    },
    mailboxTail: mailboxTailWindowOf(mailbox, limits.mailboxTailWindow).map(
      mailboxTailEntryOf,
    ),
    ...(draft === undefined ? {} : { stagedDraft: draft }),
    ...(record.artifacts === undefined ? {} : { artifacts: { dir: record.artifacts.dir } }),
  };
}

// ---------- 逐字段映射（显式挑选：内部字段结构性不入 wire） ----------

function presentMembers(
  members: readonly TeamProjectionMemberInput[],
): readonly TeamProjectionMemberInput[] {
  // removed 成员不入花名册投影（与 hub.snapshot() 一致；journal 侧 member_removed 重放同语义）。
  return members.filter((member) => member.removed !== true);
}

/** 成员当前持有的未完成任务 = claimed/in_progress 且 assignee 是本人（hub 不变量：至多一个）。 */
function currentTaskIdOf(
  memberName: string,
  tasks: readonly TeamProjectionTaskInput[],
): string | undefined {
  return tasks.find(
    (task) =>
      task.assignee === memberName &&
      (task.status === "claimed" || task.status === "in_progress"),
  )?.taskId;
}

function memberProjectionOf(
  member: TeamProjectionMemberInput,
  tasks: readonly TeamProjectionTaskInput[],
): TeamMemberProjection {
  const currentTaskId = currentTaskIdOf(member.memberName, tasks);
  return {
    agentId: member.agentId,
    memberName: member.memberName,
    ...(member.profile === undefined ? {} : { profile: member.profile }),
    ...(member.profileColor === undefined ? {} : { profileColor: member.profileColor }),
    state: member.state,
    ...(currentTaskId === undefined ? {} : { currentTaskId }),
    ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
  };
}

/**
 * 内部任务 → wire 任务卡。刻意剥离：`output`（结果正文经消息/产物引用回传，spec §2.3
 * 交接纪律；shared teamTaskCardSchema 无此字段——contracts TeamTaskCard 的 output 只
 * 服务工具面读卡）、`handoffId`/`reassigning`（hub 内部交接态，转派中状态由
 * assignee + attempt 轮换表达）、`acceptanceSupplement`（终态署名追补，非显示事实）。
 */
function taskCardProjectionOf(task: TeamProjectionTaskInput): TeamTaskCardProjection {
  return {
    taskId: task.taskId,
    title: task.title,
    spec: specProjectionOf(task.spec),
    status: task.status,
    ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    attempt: task.attempt,
    ...(task.attemptId === undefined ? {} : { attemptId: task.attemptId }),
    dependsOn: [...(task.dependsOn ?? [])],
    artifactRefs: [...(task.artifactRefs ?? [])],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.recoveryRetried === undefined ? {} : { recoveryRetried: task.recoveryRetried }),
    ...(task.contract === undefined ? {} : { contract: contractProjectionOf(task.contract) }),
  };
}

function specProjectionOf(spec: TeamTaskSpec): TeamTaskSpec {
  return {
    goal: spec.goal,
    acceptance: [...spec.acceptance],
    ...(spec.outputFormat === undefined ? {} : { outputFormat: spec.outputFormat }),
  };
}

function contractProjectionOf(contract: TeamTaskContract): TeamTaskContract {
  return {
    objective: contract.objective,
    acceptance: [...contract.acceptance],
    ...(contract.inScope === undefined ? {} : { inScope: [...contract.inScope] }),
    ...(contract.outOfScope === undefined ? {} : { outOfScope: [...contract.outOfScope] }),
    ...(contract.verify === undefined ? {} : { verify: contract.verify }),
    ...(contract.kind === undefined ? {} : { kind: contract.kind }),
  };
}

/**
 * 邮箱条目 → 尾窗条目。`delivered` 映射 `deliveredAccepted`（ack 只认注入，spec §16.3：
 * queued 不算送达）。正文 message、deliveredAt/deliveredVia、targetTaskId/targetAttemptId
 * 是 hub 裁决语义/journal 事实，不上 wire（design §3.3.3）。
 */
function mailboxTailEntryOf(entry: TeamProjectionMailboxInput): TeamMailboxTailEntry {
  return {
    messageId: entry.messageId,
    from: entry.from,
    to: entry.to,
    ...(entry.summary === undefined ? {} : { summary: entry.summary }),
    at: entry.at,
    ...(entry.sourceTaskId === undefined ? {} : { sourceTaskId: entry.sourceTaskId }),
    ...(entry.sourceAttemptId === undefined ? {} : { sourceAttemptId: entry.sourceAttemptId }),
    delivered: entry.deliveredAccepted === true,
  };
}

/**
 * staged 草案（仅 status=staged 携带，design §3.3.1）：draftMembers/draftTasks 直接
 * 取自花名册占位与板（hub.stageTeam 把草案物化进 record.members/record.tasks）；
 * awaitingFeedback 缺席按 false。
 */
function stagedDraftOf(record: TeamProjectionRecordInput): TeamStagedDraft | undefined {
  if (record.status !== "staged") return undefined;
  return {
    draftMembers: presentMembers(record.members ?? []).map((member) => ({
      memberName: member.memberName,
      ...(member.profile === undefined ? {} : { profile: member.profile }),
      ...(member.modelSelection === undefined
        ? {}
        : {
            modelSelection: {
              provider: member.modelSelection.provider,
              model: member.modelSelection.model,
              ...(member.modelSelection.thought === undefined
                ? {}
                : { thought: member.modelSelection.thought }),
            },
          }),
    })),
    draftTasks: (record.tasks ?? []).map((task) => ({
      taskId: task.taskId,
      title: task.title,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      dependsOn: [...(task.dependsOn ?? [])],
    })),
    awaitingFeedback: record.awaitingFeedback === true,
  };
}
