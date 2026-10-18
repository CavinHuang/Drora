import { describe, expect, it } from "vitest";

import { teamPanelActionVisibility } from "./TeamPanel.js";
import type { TeamUiStatus } from "./contract.js";

/**
 * 动作区按钮可见性矩阵（PR-2.4b；任务卡 B 第 4 条：不引 DOM 渲染器，
 * 断言可见性纯函数按 team 状态机出显）。
 *
 * 矩阵与内核迁移表对齐（apps/drora-cli/packages/core/src/team/hub.ts）：
 * - hub.halt 在 staged 与归档态拒绝 → staged 无 halt、归档族无任何动作；
 * - hub.resume 只接受 halted|escalated 且理由必填 → resume 仅这两态出显；
 * - escalated 升级卡 = resume + halt 两个出口（design §3.3「继续 / 停止」二选）。
 */
describe("teamPanelActionVisibility", () => {
  it("staged：仅渲染草案编辑器三动作（approve/revise/abandon）", () => {
    expect(teamPanelActionVisibility("staged")).toEqual({
      stagedEditor: true,
      approve: true,
      revise: true,
      abandon: true,
      halt: false,
      resume: false,
      escalationCard: false,
    });
  });

  it("active：仅停止团队入口", () => {
    expect(teamPanelActionVisibility("active")).toEqual({
      stagedEditor: false,
      approve: false,
      revise: false,
      abandon: false,
      halt: true,
      resume: false,
      escalationCard: false,
    });
  });

  it("halted：仅显式恢复（理由必填）", () => {
    expect(teamPanelActionVisibility("halted")).toEqual({
      stagedEditor: false,
      approve: false,
      revise: false,
      abandon: false,
      halt: false,
      resume: true,
      escalationCard: false,
    });
  });

  it("escalated：升级卡 + resume/halt 两出口", () => {
    expect(teamPanelActionVisibility("escalated")).toEqual({
      stagedEditor: false,
      approve: false,
      revise: false,
      abandon: false,
      halt: true,
      resume: true,
      escalationCard: true,
    });
  });

  it("归档族与空闲态 v1 无动作区（收队/归档入口属后续卡）", () => {
    const none = {
      stagedEditor: false,
      approve: false,
      revise: false,
      abandon: false,
      halt: false,
      resume: false,
      escalationCard: false,
    };
    for (const status of [
      "idle",
      "completed",
      "cancelled",
      "archived",
    ] as const satisfies readonly TeamUiStatus[]) {
      expect(teamPanelActionVisibility(status), status).toEqual(none);
    }
  });
});
