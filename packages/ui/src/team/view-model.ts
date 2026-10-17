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
  stagedDraft?: {
    memberCount: number;
    taskCount: number;
    awaitingFeedback: boolean;
  };
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
            memberCount: team.stagedDraft.draftMembers.length,
            taskCount: team.stagedDraft.draftTasks.length,
            awaitingFeedback: team.stagedDraft.awaitingFeedback,
          },
        }),
  };
}
