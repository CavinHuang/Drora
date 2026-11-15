import { describe, expect, it } from "vitest";
import {
  TEAM_UI_MODULE_ID,
  createTeamPanelController,
  type TeamPanelViewModel,
} from "./contract.js";
import { teamUiModule } from "./module.js";
import { teamNavigationExample } from "./contract.example.js";

describe("ui-team module contract", () => {
  it("carries remote identity and attachment independently of filesystem path", () => {
    expect(teamNavigationExample.workspaceIdentity).not.toBe(teamNavigationExample.workspacePath);
    expect(teamNavigationExample.remoteSessionId).toBe("attachment-1");
    expect(teamNavigationExample.parentSessionId).toBe("lead-session");
    expect(teamNavigationExample.focus).toEqual({
      teamId: "team_demo_01",
      kind: "task",
      id: "task_demo_01",
    });
  });
  it("declares the managed module identity", () => {
    expect(teamUiModule.id).toBe("ui-team");
    expect(teamUiModule.requires).toEqual(["ui", "shared", "services"]); // services：workspace-config-catalog-sync 订阅 Host 装配事实（v3.16.1 S6 登记）
    // session-line.ts 为 58f3f595a 新增轻量公共入口（会话列表条目投影）；module.ts
    // 已声明而本断言未跟（基线已知红）。对齐声明面，入口增删仍由 module.ts 单一出处。
    expect(teamUiModule.publicEntrypoints).toEqual(["index.ts", "contract.ts", "session-line.ts"]);
    expect(TEAM_UI_MODULE_ID).toBe("ui-team");
  });

  it("freezes the panel view-model shape consumed from the v4 projection", () => {
    const viewModel: TeamPanelViewModel = {
      teamId: "team_01",
      status: "active",
      memberCount: 2,
      boardProgress: { total: 5, completed: 1 },
    };
    expect(viewModel.boardProgress.completed).toBeLessThanOrEqual(viewModel.boardProgress.total);
    const statuses: TeamPanelViewModel["status"][] = [
      "staged",
      "active",
      "idle",
      "completed",
      "halted",
      "escalated",
      "cancelled",
      "archived",
    ];
    expect(statuses).toHaveLength(8);
  });

  it("keeps the controller a skeleton until PR-2.4", () => {
    expect(() => createTeamPanelController()).toThrowError(/PR-2\.4/);
  });
});
