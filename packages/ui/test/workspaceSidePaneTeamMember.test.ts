import { describe, expect, it } from "vitest";
import {
  activateSidePaneTab,
  openBrowserSidePane,
  openTeamMemberSidePane,
  selectSidePaneTabsForScope,
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

describe("team-member tab 的 scope 自动激活偏好（L17，与 workflow-actor-session 先例对称）", () => {
  it("切回对话 scope：active 失效时优先续选 team-member，而非退回其后打开的普通 tab", () => {
    // 顺序刻意「先 member 后 browser」：若 team-member 不在偏好列表，
    // findLast 落空后会回退 visibleTabs.at(-1)（browser），用例即失败——真正区分两种实现。
    const withMember = openTeamMemberSidePane(null, scoped());
    const withBrowser = openBrowserSidePane(withMember, {
      tabId: "browser:1",
      ownerTaskId: "lead_1",
      workspaceKey: "/repo",
    });
    const memberTab = withBrowser?.tabs.find((tab) => tab.type === "team-member");
    expect(memberTab).toBeDefined();

    const selected = selectSidePaneTabsForScope(
      { ...withBrowser!, activeTabId: "missing" },
      { workspaceKey: "/repo", ownerTaskId: "lead_1" },
    );
    expect(selected?.activeTabId).toBe(memberTab?.id);
  });
});
