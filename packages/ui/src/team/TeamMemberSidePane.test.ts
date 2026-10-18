import { describe, expect, it } from "vitest";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";

import { resolveTeamMemberDrillSession } from "./TeamMemberSidePane.js";

/**
 * 成员下钻门（resolveTeamMemberDrillSession）的纯函数断言。
 *
 * 门语义（照 WorkflowActorSessionSidePane 的门 + spec §10 恢复语义）：
 * - 实时投影里的 childSessionId 优先（成员 spawn 后自愈）；
 * - 已知 childSessionId 在投影缺席/成员不在册时仍可回看（transcript 落 session store 的持久能力）；
 * - 两者皆无时如实占位（not-started / member-absent / team-absent），不猜会话 id。
 */

function teamProjection(members: TeamProjectionState["members"]): TeamProjectionState {
  return {
    teamId: "team_1",
    status: "active",
    members,
    board: { tasks: [], limit: 16 },
    mailboxTail: [],
  };
}

const ROSTER = teamProjection([
  {
    agentId: "agent_1",
    memberName: "researcher",
    state: "working",
    childSessionId: "child_live_1",
  },
  {
    agentId: "agent_2",
    memberName: "spawning",
    state: "spawning",
  },
]);

describe("resolveTeamMemberDrillSession", () => {
  it("成员在册带 childSessionId：实时 id 优先（自愈）", () => {
    expect(resolveTeamMemberDrillSession(ROSTER, "researcher", "child_stale_1")).toEqual({
      state: "ready",
      sessionId: "child_live_1",
    });
  });

  it("成员在册尚无会话：not-started 占位，不猜 id", () => {
    expect(resolveTeamMemberDrillSession(ROSTER, "spawning", undefined)).toEqual({
      state: "not-started",
    });
  });

  it("成员在册尚无会话但打开时已知 id：已知 id 兜底", () => {
    expect(resolveTeamMemberDrillSession(ROSTER, "spawning", "child_known_1")).toEqual({
      state: "ready",
      sessionId: "child_known_1",
    });
  });

  it("成员已不在册 + 无已知 id：member-absent", () => {
    expect(resolveTeamMemberDrillSession(ROSTER, "removed-member", undefined)).toEqual({
      state: "member-absent",
    });
  });

  it("成员已不在册 + 已知 id：仍可回看（transcript 持久）", () => {
    expect(resolveTeamMemberDrillSession(ROSTER, "removed-member", "child_gone_1")).toEqual({
      state: "ready",
      sessionId: "child_gone_1",
    });
  });

  it("team 投影缺席（团队归档出投影/旧 CLI）+ 无已知 id：team-absent", () => {
    expect(resolveTeamMemberDrillSession(undefined, "researcher", undefined)).toEqual({
      state: "team-absent",
    });
  });

  it("team 投影缺席 + 已知 id：直接订阅（回看唯一路径）", () => {
    expect(resolveTeamMemberDrillSession(undefined, "researcher", "child_cold_1")).toEqual({
      state: "ready",
      sessionId: "child_cold_1",
    });
  });
});
