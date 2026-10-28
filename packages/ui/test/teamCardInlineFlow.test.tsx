// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveTeamCardAnchorTurnKey } from "../src/v4/ConversationTimeline.js";

// specs/agents-team.md §10 增补五（2026-10-27）：团队卡锚定轮判定（纯函数）——
// 最后一个含 TeamSpawn 工具行的 turn；无锚定 → undefined（宿主回退 footerSlot）。

function unit(key: string, toolNames: string[]) {
  return {
    key,
    renderRows: toolNames.map((toolName, i) => ({ kind: "toolCall", toolName, rowId: i })),
  };
}

describe("resolveTeamCardAnchorTurnKey（§10 增补五）", () => {
  it("锚定在含 TeamSpawn 的轮；取最后一个（重建团队跟新锚）", () => {
    const units = [
      unit("t1", ["TeamSpawn"]),
      unit("t2", ["Read"]),
      unit("t3", ["TeamSpawn", "TeamTaskUpdate"]),
    ];
    expect(resolveTeamCardAnchorTurnKey(units)).toBe("t3");
  });

  it("无 TeamSpawn 行 → undefined（回退 footerSlot 钉底）", () => {
    expect(resolveTeamCardAnchorTurnKey([unit("t1", ["Read"]), unit("t2", [])])).toBeUndefined();
  });

  it("空列表 → undefined", () => {
    expect(resolveTeamCardAnchorTurnKey([])).toBeUndefined();
  });

  it("非 toolCall 行的 toolName 不误判（kind 判别）", () => {
    const units = [
      {
        key: "t1",
        renderRows: [{ kind: "assistantText", toolName: "TeamSpawn" }],
      },
    ];
    expect(resolveTeamCardAnchorTurnKey(units)).toBeUndefined();
  });
});
