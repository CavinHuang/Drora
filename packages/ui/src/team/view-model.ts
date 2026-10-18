import type { TeamProjectionState, TeamTaskCardProjection } from "@drora/shared/drora-protocol-v4";
import type { TeamUiStatus } from "./contract.js";

/**
 * 视图模型映射（specs/agents-team.md §10：TeamPanel 只消费 v4 投影派生模型，
 * 不建第二真相；命令动作经 v4 命令链路，由宿主注入回调——本模块纯派生，零副作用）。
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
  attempt: number;
  dependsOn: readonly string[];
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

export interface TeamPanelModel {
  teamId: string;
  status: TeamUiStatus;
  permissionMode?: "build" | "edit" | "yolo" | "guarded" | "auto";
  members: readonly TeamPanelMemberView[];
  board: {
    pending: readonly TeamPanelTaskView[];
    inProgress: readonly TeamPanelTaskView[];
    completed: readonly TeamPanelTaskView[];
    limit: number;
  };
  mailboxTail: readonly { messageId: string; from: string; summary?: string }[];
  stagedDraft?: TeamPanelStagedDraftView;
}

/** 投影 → 面板模型（纯派生；任务板三列分组，内部交接态不在投影中）。 */
export function mapTeamProjectionToViewModel(team: TeamProjectionState): TeamPanelModel {
  const tasks = team.board.tasks;
  const pending: TeamPanelTaskView[] = [];
  const inProgress: TeamPanelTaskView[] = [];
  const completed: TeamPanelTaskView[] = [];
  for (const task of tasks) {
    const view: TeamPanelTaskView = {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      attempt: task.attempt,
      dependsOn: task.dependsOn,
    };
    if (task.status === "pending") pending.push(view);
    else if (task.status === "claimed" || task.status === "in_progress") inProgress.push(view);
    else completed.push(view);
  }
  return {
    teamId: team.teamId,
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
    board: { pending, inProgress, completed, limit: team.board.limit },
    mailboxTail: team.mailboxTail.map((entry) => ({
      messageId: entry.messageId,
      from: entry.from,
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
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
