import { describe, expect, it } from "vitest";
import {
  TEAM_UI_MODULE_ID,
  createTeamPanelController,
  type TeamPanelViewModel,
} from "./contract.js";
import { teamUiModule } from "./module.js";

describe("ui-team module contract", () => {
  it("declares the managed module identity", () => {
    expect(teamUiModule.id).toBe("ui-team");
    expect(teamUiModule.requires).toEqual(["ui", "shared"]);
    expect(teamUiModule.publicEntrypoints).toEqual(["index.ts", "contract.ts"]);
    expect(TEAM_UI_MODULE_ID).toBe("ui-team");
  });

  it("freezes the panel view-model shape consumed from the v4 projection", () => {
    const viewModel: TeamPanelViewModel = {
      teamId: "team_01",
      status: "active",
      memberCount: 2,
      boardProgress: { total: 5, completed: 1 },
    };
    expect(viewModel.boardProgress.completed).toBeLessThanOrEqual(
      viewModel.boardProgress.total,
    );
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
