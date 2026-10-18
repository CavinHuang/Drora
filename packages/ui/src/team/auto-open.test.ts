import { describe, expect, it } from "vitest";

import type { TeamUiStatus } from "./contract.js";
import { shouldAutoOpenTeamPanel } from "./auto-open.js";

const STATUSES: TeamUiStatus[] = [
  "staged",
  "active",
  "idle",
  "completed",
  "halted",
  "escalated",
  "cancelled",
  "archived",
];

describe("shouldAutoOpenTeamPanel", () => {
  it("fires on the primary edge: no team projection → staged, panel closed", () => {
    // 草案出现前的常态就是没有 team 键——undefined → staged 是主路径（设计 01 §3.1）。
    expect(shouldAutoOpenTeamPanel(undefined, "staged", false)).toBe(true);
  });

  it("never fires while the panel is open, whatever the edge", () => {
    // 任务卡口径「仅当面板未开」；面板开着时重复打开虽幂等，但抢聚焦不属于本语义。
    expect(shouldAutoOpenTeamPanel(undefined, "staged", true)).toBe(false);
    expect(shouldAutoOpenTeamPanel("active", "staged", true)).toBe(false);
    expect(shouldAutoOpenTeamPanel("archived", "staged", true)).toBe(false);
  });

  it("does not refire while the draft stays staged (staged → staged)", () => {
    // 投影反复刷新同一份 staged 草案不算新边沿。
    expect(shouldAutoOpenTeamPanel("staged", "staged", false)).toBe(false);
  });

  it("fires again for a new draft after the previous team ended (non-staged → staged)", () => {
    // 归档/取消/停止后再来新草案：需要新审批，边沿重新成立。
    for (const prev of [
      "active",
      "idle",
      "completed",
      "halted",
      "escalated",
      "cancelled",
      "archived",
    ] as const) {
      expect(shouldAutoOpenTeamPanel(prev, "staged", false)).toBe(true);
    }
  });

  it("never fires when the projection is absent in the observed frame", () => {
    // 灰度关 / 旧 CLI / 归档出投影：team 键缺席，行为自然关闭（无显式开关）。
    expect(shouldAutoOpenTeamPanel(undefined, undefined, false)).toBe(false);
    expect(shouldAutoOpenTeamPanel("staged", undefined, false)).toBe(false);
    expect(shouldAutoOpenTeamPanel("active", undefined, false)).toBe(false);
  });

  it("does not fire for non-staged transitions", () => {
    // 生命周期正常推进（启动/空闲/收队）都不是「草案出现」。
    for (const next of STATUSES.filter((s) => s !== "staged")) {
      expect(shouldAutoOpenTeamPanel(undefined, next, false)).toBe(false);
      expect(shouldAutoOpenTeamPanel("active", next, false)).toBe(false);
    }
  });
});
