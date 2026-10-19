import type { TeamProjectionState, TeamTaskCardProjection } from "@drora/shared/drora-protocol-v4";
import { TEAM_LEAD_ASSIGNEE } from "@drora/shared/drora-protocol-v4";
import type { TeamUiStatus } from "./contract.js";

/**
 * 视图模型映射（specs/agents-team.md §10：TeamPanel 只消费 v4 投影派生模型，
 * 不建第二真相；命令动作经 v4 命令链路，由宿主注入回调——本模块纯派生，零副作用）。
 *
 * 2026-10-18 team UI 审查修复（对齐设计 01 §3.3.2 的既有承诺）：
 * - failed/cancelled 不再落入「已完成」列——归入 board.attention，由待办列头部
 *   以 error/取消态卡片渲染（设计原文「failed 入 pending 列头部 error 态卡片」）；
 * - 补 dependsDepth（依赖以缩进表达）、assigneeColor（负责人头像点）、
 *   artifactRefs（任务卡产物引用摘录）与邮箱尾窗的 to/fromColor。
 */

export interface TeamPanelMemberView {
  agentId: string;
  memberName: string;
  profile?: string;
  profileColor?: string;
  state: "spawning" | "working" | "terminal" | "removed";
  currentTaskId?: string;
  childSessionId?: string;
}

export interface TeamPanelTaskView {
  taskId: string;
  title: string;
  status: TeamTaskCardProjection["status"];
  assignee?: string;
  /** assignee 对应成员的 profileColor（成员↔任务的视觉纽带；lead/未匹配为 undefined）。 */
  assigneeColor?: string;
  attempt: number;
  dependsOn: readonly string[];
  /** 依赖链深度（0 = 无依赖；按全任务图计算，上限 3 防深链溢出布局）——缩进量数据源。 */
  dependsDepth: number;
  artifactRefs: readonly string[];
}

/**
 * staged 草案成员行（shared teamStagedDraftMemberSchema 同形派生；PR-2.4b 起编辑器
 * 消费整行数据，取代 PR-2.4a 的只读计数——单一派生通道不变：投影 → 本模型 → 视图）。
 * v1 只读展示（名称/角色/路由），行内编辑属后续卡。
 */
export interface TeamPanelStagedMemberView {
  memberName: string;
  profile?: string;
  /** 建队时刻的路由快照（spec §8.7）；缺席 = 未指定路由。 */
  modelSelection?: { provider: string; model: string; thought?: string };
}

/** staged 草案任务行（shared teamStagedDraftTaskSchema 同形派生；v1 只读展示）。 */
export interface TeamPanelStagedTaskView {
  taskId: string;
  title: string;
  assignee?: string;
  dependsOn: readonly string[];
}

/** staged 草案整体（仅 staged 态携带；TeamStagedEditor 的数据输入）。 */
export interface TeamPanelStagedDraftView {
  members: readonly TeamPanelStagedMemberView[];
  tasks: readonly TeamPanelStagedTaskView[];
  awaitingFeedback: boolean;
}

export interface TeamPanelMailboxEntryView {
  messageId: string;
  /** memberName 或 TEAM_LEAD_ASSIGNEE。 */
  from: string;
  /** memberName 或 agentId（wire 契约；展示按原样）。 */
  to: string;
  summary?: string;
  /** 发件人成员的 profileColor（尾窗色点；lead/未匹配为 undefined → 中性色兜底）。 */
  fromColor?: string;
  at?: string;
  delivered?: boolean;
  sourceTaskId?: string;
  sourceAttemptId?: string;
}

export interface TeamPanelModel {
  teamId: string;
  name?: string;
  status: TeamUiStatus;
  permissionMode?: "build" | "edit" | "yolo" | "guarded" | "auto";
  members: readonly TeamPanelMemberView[];
  board: {
    /** failed/cancelled 任务（待办列头部 error/取消态卡片；不算入已完成）。 */
    attention: readonly TeamPanelTaskView[];
    pending: readonly TeamPanelTaskView[];
    inProgress: readonly TeamPanelTaskView[];
    completed: readonly TeamPanelTaskView[];
    limit: number;
  };
  mailboxTail: readonly TeamPanelMailboxEntryView[];
  stagedDraft?: TeamPanelStagedDraftView;
}

/** 依赖深度上限：更深链按 3 级缩进封顶，避免长链把列宽吃光。 */
const MAX_DEPENDS_DEPTH = 3;

/**
 * 全任务图依赖深度（DAG per spec §2.2；带环守卫——回边按 0 计，只为不崩，不构成语义）。
 * 跨列依赖照常计数：pending 依赖已 completed 的任务同样缩进（依赖关系不随状态消失）。
 */
function dependsDepthOf(
  taskId: string,
  depsByTask: Map<string, readonly string[]>,
  cache: Map<string, number>,
  visiting: Set<string>,
): number {
  const cached = cache.get(taskId);
  if (cached !== undefined) return cached;
  if (visiting.has(taskId)) return 0;
  const deps = depsByTask.get(taskId);
  if (deps === undefined || deps.length === 0) {
    cache.set(taskId, 0);
    return 0;
  }
  visiting.add(taskId);
  let depth = 0;
  for (const dep of deps) {
    depth = Math.max(depth, dependsDepthOf(dep, depsByTask, cache, visiting));
  }
  visiting.delete(taskId);
  const settled = Math.min(depth + 1, MAX_DEPENDS_DEPTH);
  cache.set(taskId, settled);
  return settled;
}

/** 投影 → 面板模型（纯派生；attention 单列归桶，内部交接态不在投影中）。 */
export function mapTeamProjectionToViewModel(team: TeamProjectionState): TeamPanelModel {
  const tasks = team.board.tasks;
  const colorByName = new Map<string, string>();
  for (const member of team.members) {
    if (member.profileColor !== undefined) colorByName.set(member.memberName, member.profileColor);
  }
  const depsByTask = new Map<string, readonly string[]>();
  for (const task of tasks) depsByTask.set(task.taskId, task.dependsOn);
  const depthCache = new Map<string, number>();

  const attention: TeamPanelTaskView[] = [];
  const pending: TeamPanelTaskView[] = [];
  const inProgress: TeamPanelTaskView[] = [];
  const completed: TeamPanelTaskView[] = [];
  for (const task of tasks) {
    const view: TeamPanelTaskView = {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      ...(task.assignee === undefined || task.assignee === TEAM_LEAD_ASSIGNEE
        ? {}
        : { assigneeColor: colorByName.get(task.assignee) }),
      attempt: task.attempt,
      dependsOn: task.dependsOn,
      dependsDepth: dependsDepthOf(task.taskId, depsByTask, depthCache, new Set<string>()),
      artifactRefs: task.artifactRefs,
    };
    if (task.status === "failed" || task.status === "cancelled") attention.push(view);
    else if (task.status === "pending") pending.push(view);
    else if (task.status === "claimed" || task.status === "in_progress") inProgress.push(view);
    else completed.push(view);
  }
  return {
    teamId: team.teamId,
    ...(team.name === undefined ? {} : { name: team.name }),
    status: team.status,
    ...(team.permissionMode === undefined ? {} : { permissionMode: team.permissionMode }),
    members: team.members.map((member) => ({
      agentId: member.agentId,
      memberName: member.memberName,
      ...(member.profile === undefined ? {} : { profile: member.profile }),
      ...(member.profileColor === undefined ? {} : { profileColor: member.profileColor }),
      state: member.state,
      ...(member.currentTaskId === undefined ? {} : { currentTaskId: member.currentTaskId }),
      ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
    })),
    board: { attention, pending, inProgress, completed, limit: team.board.limit },
    mailboxTail: team.mailboxTail.map((entry) => ({
      messageId: entry.messageId,
      from: entry.from,
      to: entry.to,
      at: entry.at,
      delivered: entry.delivered,
      sourceTaskId: entry.sourceTaskId,
      sourceAttemptId: entry.sourceAttemptId,
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
      ...(entry.from === TEAM_LEAD_ASSIGNEE ? {} : { fromColor: colorByName.get(entry.from) }),
    })),
    ...(team.stagedDraft === undefined
      ? {}
      : {
          stagedDraft: {
            members: team.stagedDraft.draftMembers.map((member) => ({
              memberName: member.memberName,
              ...(member.profile === undefined ? {} : { profile: member.profile }),
              ...(member.modelSelection === undefined
                ? {}
                : { modelSelection: member.modelSelection }),
            })),
            tasks: team.stagedDraft.draftTasks.map((task) => ({
              taskId: task.taskId,
              title: task.title,
              ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
              dependsOn: task.dependsOn,
            })),
            awaitingFeedback: team.stagedDraft.awaitingFeedback,
          },
        }),
  };
}
