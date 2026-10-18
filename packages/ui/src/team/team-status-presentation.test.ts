import { describe, expect, it } from "vitest";

import type { TeamUiStatus } from "./contract.js";
import {
  TEAM_STATUS_DOT_TONE,
  TEAM_STATUS_I18N_KEYS,
  TONE_DOT_CLASS,
} from "./team-status-presentation.js";

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

describe("team status presentation maps", () => {
  it("covers every TeamUiStatus in both maps with the same key set", () => {
    // 色与文字必须并行（DESIGN 纪律「不以色独行」）：两表键集同构，缺一个状态就会
    // 只剩色点没有文字（或反之）。
    expect(Object.keys(TEAM_STATUS_DOT_TONE).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(TEAM_STATUS_I18N_KEYS).sort()).toEqual([...STATUSES].sort());
  });

  it("matches the semantic tone rules from design 01 §4", () => {
    // 「pending=neutral、working=accent、completed=success、halted/escalated=warning」
    // 在 team 状态机上的映射；staged 是待用户审批的行动项，归 accent。
    expect(TEAM_STATUS_DOT_TONE.staged).toBe("accent");
    expect(TEAM_STATUS_DOT_TONE.active).toBe("accent");
    expect(TEAM_STATUS_DOT_TONE.completed).toBe("success");
    expect(TEAM_STATUS_DOT_TONE.halted).toBe("warning");
    expect(TEAM_STATUS_DOT_TONE.escalated).toBe("warning");
    expect(TEAM_STATUS_DOT_TONE.idle).toBe("neutral");
    expect(TEAM_STATUS_DOT_TONE.cancelled).toBe("neutral");
    expect(TEAM_STATUS_DOT_TONE.archived).toBe("neutral");
  });

  it("has a dot class for every tone in use", () => {
    // 消费方按 tone 查类名；映射表漏 tone 会在运行时渲染出无色点。
    for (const tone of new Set(Object.values(TEAM_STATUS_DOT_TONE))) {
      expect(TONE_DOT_CLASS[tone]).toBeTruthy();
    }
  });

  it("keeps i18n keys under the team.status.* namespace", () => {
    for (const key of Object.values(TEAM_STATUS_I18N_KEYS)) {
      expect(key.startsWith("team.status.")).toBe(true);
    }
  });
});
