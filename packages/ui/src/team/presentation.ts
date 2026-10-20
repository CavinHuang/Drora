import { TEAM_LEAD_ASSIGNEE } from "@drora/shared/drora-protocol-v4";
import { teamTasks } from "./relations.js";
import type { TeamPanelModel, TeamPanelTaskView } from "./view-model.js";

export function teamMemberFor(model: TeamPanelModel, id: string) {
  return model.members.find((member) => member.agentId === id || member.memberName === id);
}
export function teamActor(model: TeamPanelModel, id: string, lead: string) {
  return id === TEAM_LEAD_ASSIGNEE ? lead : (teamMemberFor(model, id)?.memberName ?? id);
}
export function waitingDependencies(model: TeamPanelModel, task: TeamPanelTaskView) {
  const byId = new Map(teamTasks(model).map((candidate) => [candidate.taskId, candidate]));
  return task.dependsOn.filter((id) => byId.get(id)?.status !== "completed");
}
export function teamFacts(model: TeamPanelModel) {
  const tasks = teamTasks(model);
  return {
    working: model.members.filter((member) => member.state === "working").length,
    blocked: tasks.filter(
      (task) => task.status === "pending" && waitingDependencies(model, task).length > 0,
    ).length,
    completed: model.board.completed.length,
    total: tasks.length,
  };
}
