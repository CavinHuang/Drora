/**
 * ui-team 托管模块契约（specs/agents-team.md §10；交互设计
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md）。
 *
 * 边界纪律：
 * - 只消费 v4 team 投影（conversationProjectionStore 派生），不建第二真相；
 * - 所有用户动作走 v4 命令（approveTeamPlan 等），不直连 runtime；
 * - 派生视图状态入 packages/ui/src/store/teamStore.ts（M2 落地）。
 */
export const TEAM_UI_MODULE_ID = "ui-team";

/** 只传父会话地址，不携带业务状态；远程身份不能退化为路径。 */
export interface TeamUiNavigationTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  parentSessionId: string;
  focus?: TeamUiFocus;
}

/** 只属于 UI 的定位请求；不进入 wire、tab 身份或团队业务状态。 */
export type TeamUiFocus = { teamId: string } & (
  | { kind: "overview" | "process" | "collaboration" }
  | { kind: "member" | "task" | "message"; id: string }
);

/** team 状态机 wire 枚举（与 shared team.ts 八值一致；M2 落 schema 后改为引用）。 */
export type TeamUiStatus = import("@drora/shared/drora-protocol-v4").TeamStatusWire;

/** TeamPanel 的输入视图模型（M2 由 team 投影派生；此处先行冻结形状供消费方对齐）。 */
export interface TeamPanelViewModel {
  teamId: string;
  status: TeamUiStatus;
  memberCount: number;
  boardProgress: { total: number; completed: number };
}

/** TeamPanel 容器契约：实现于 M2（PR-2.4）。骨架期仅暴露形状。 */
export interface TeamPanelController {
  open(sessionId: string): void;
  close(): void;
}

export function createTeamPanelController(): TeamPanelController {
  throw new Error("ui-team skeleton: TeamPanel lands in PR-2.4 (specs/agents-team.md §12 M2).");
}
