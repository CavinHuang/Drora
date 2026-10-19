import type { TeamPanelController, TeamPanelViewModel } from "./contract.js";
import type { TeamUiNavigationTarget } from "./contract.js";

export const teamNavigationExample: TeamUiNavigationTarget = {
  workspacePath: "/workspace/project",
  workspaceIdentity: "remote-identity",
  remoteSessionId: "attachment-1",
  parentSessionId: "lead-session",
};

/**
 * 用法示例：消费方（app-shell 侧栏）从 v4 投影派生视图模型后交给面板控制器；
 * 面板永不自建 team 状态（specs/agents-team.md §2.2 UI teamStore 行）。
 */
export function exampleTeamPanelViewModel(): TeamPanelViewModel {
  return {
    teamId: "team_demo_01",
    status: "staged",
    memberCount: 0,
    boardProgress: { total: 3, completed: 0 },
  };
}

export function exampleControllerHook(controller: TeamPanelController): void {
  controller.open("session_lead_01");
  controller.close();
}
