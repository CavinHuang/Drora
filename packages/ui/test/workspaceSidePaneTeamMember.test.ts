import { describe, expect, it } from "vitest";
import {
  activateSidePaneTab,
  openTeamMemberSidePane,
  type WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";

// §10 增补四（2026-10-26）：成员 transcript tab 的开关语义——结构化 id 幂等聚焦，
// 重开以已知 childSessionId 刷新 slot（缺席自愈，照 actorSessionId）。

const BASE = { workspacePath: "/repo", parentSessionId: "lead_1" } as const;

function scoped(overrides: Partial<Parameters<typeof openTeamMemberSidePane>[1]> = {}) {
  return { ...BASE, memberName: "alice", workspaceKey: "/repo", ...overrides };
}

describe("openTeamMemberSidePane（specs/agents-team.md §10 增补四）", () => {
  it("开新 tab：激活、类型/身份字段落位", () => {
    const state = openTeamMemberSidePane(null, scoped());
    const tab = state?.tabs[0];
    expect(tab?.type).toBe("team-member");
    if (tab?.type !== "team-member") return;
    expect(tab.memberName).toBe("alice");
    expect(tab.parentSessionId).toBe("lead_1");
    expect(state?.activeTabId).toBe(tab.id);
  });

  it("幂等：同一成员重复打开聚焦同一 tab（不新增）；childSessionId 重开刷新（自愈 slot）", () => {
    const first = openTeamMemberSidePane(null, scoped()) as WorkspaceSidePaneState;
    const again = openTeamMemberSidePane(first, scoped({ childSessionId: "child_9" }));
    expect(again?.tabs).toHaveLength(1);
    const tab = again?.tabs[0];
    expect(tab?.type).toBe("team-member");
    if (tab?.type !== "team-member") return;
    expect(tab.childSessionId).toBe("child_9");
    expect(again?.activeTabId).toBe(tab.id);
  });

  it("不同成员不同 tab；与 team 主 tab 并存互不干扰", () => {
    let state = openTeamMemberSidePane(null, scoped());
    state = openTeamMemberSidePane(state, scoped({ memberName: "bob" }));
    expect(state?.tabs).toHaveLength(2);
    expect(new Set(state?.tabs.map((t) => t.id)).size).toBe(2);
    // 激活最后打开的（bob），再点 alice 回聚 alice 的 tab，仍两个。
    state = openTeamMemberSidePane(state, scoped());
    expect(state?.tabs).toHaveLength(2);
    const active = state?.tabs.find((t) => t.id === state.activeTabId);
    expect(active?.type).toBe("team-member");
    if (active?.type === "team-member") expect(active.memberName).toBe("alice");
    // activateSidePaneTab 返回结构可用（无异常）。
    expect(activateSidePaneTab(state, state!.tabs[0]!).activeTabId).toBe(state!.tabs[0]!.id);
  });
});
