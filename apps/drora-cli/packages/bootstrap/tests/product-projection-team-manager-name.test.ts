import { describe, expect, it, vi } from "vitest";
import { SessionEventType, type SessionEvent, type TeamStageInput } from "@drora/contracts";
import { TeamHub } from "@drora/core";
import {
  applyConversationDeltas,
  teamProjectionStateSchema,
  type ConversationDelta,
  type ConversationSnapshot,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import { ConversationTopicPublisher } from "../src/drora-protocol-v4/index.js";

/**
 * specs/agents-team.md §22 契约 7 投影半边（2026-10-27 审查 H2 修复）：桥
 * teamProjectionViewOf 自 353e1e24 起就把 roster.managerName 塞进投影入参 record，
 * 但 core projection.ts 的 TeamProjectionRecordInput 无该字段、projectTeam 输出键
 * 清单也不含它——managerName 在 projectTeam 一跳被静默丢弃，wire 帧恒缺该键，
 * UI 管理者徽标（team.ui.managerBadge）永不渲染。本文件锁断链修复后的全链：
 * TeamStateChanged → teamProjectionViewOf → projectTeam（managerName 透传）→
 * JSON diff → delta / 冷快照的 team 键 wire 全帧携带 managerName（= roster 首位
 * manager 成员名，§22 契约 1）。
 *
 * hub 登记表是 install.ts 的模块级单例（key = lead sessionId），无测试出口；本文件以
 * 真实 TeamHub 注入替身（手法同 product-projection-team-staged-fields.test.ts）——
 * 仅「登记查询」一跳被 mock。
 */
const mocks = vi.hoisted(() => ({ hub: { current: undefined as unknown } }));

vi.mock("../src/app/drora-team/install.js", () => ({
  getInstalledTeamHub: (sessionId: string) =>
    sessionId === "lead" ? mocks.hub.current : undefined,
  getInstalledTeamHistoryReader: () => undefined,
}));

/** §22 契约 1：manager 是 TeamStageInput 必填项，hub 物化为 roster 首位成员。 */
const STAGE_INPUT_WITH_MANAGER: TeamStageInput = {
  name: "managed-squad",
  manager: { memberName: "morgana", profile: "team manager" },
  draftMembers: [{ memberName: "alice", profile: "researcher" }],
  draftTasks: [{ title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [] }],
};

function setupTeamProjectionHarness() {
  const hub = new TeamHub({});
  mocks.hub.current = hub;
  const publisher = new ConversationTopicPublisher("lead", "epoch");
  let sequence = 0;
  // 形状照 install.ts emitTeamStateChanged：payload 只带 teamId。
  const ingestTeamChanged = () => {
    publisher.ingest({
      id: `team_evt_${++sequence}`,
      sessionId: "lead",
      turnId: "turn",
      traceId: "trace",
      timestamp: new Date(1700000000000 + sequence),
      sequenceNumber: sequence,
      type: SessionEventType.TeamStateChanged,
      payload: { teamId: hub.teamId },
    } as SessionEvent);
  };
  const live = publisher.subscribe({ connectionId: "live", deliveryProfile: "continuous" });
  return { hub, publisher, ingestTeamChanged, live };
}

function teamPatchOf(deltas: readonly ConversationDelta[]): TeamProjectionState | undefined {
  const delta = deltas.find(
    (candidate) => candidate.op === "state.updated" && candidate.patch.team !== undefined,
  );
  return delta?.op === "state.updated" ? delta.patch.team : undefined;
}

function requireSnapshot(frame: { payload: { kind: string } }): ConversationSnapshot {
  if (frame.payload.kind !== "snapshot") throw new Error("expected snapshot frame");
  return (frame.payload as { snapshot: ConversationSnapshot }).snapshot;
}

function requireDeltas(frame: { payload: { kind: string } } | undefined): ConversationDelta[] {
  if (frame === undefined || frame.payload.kind !== "deltas")
    throw new Error("expected deltas frame");
  return (frame.payload as { deltas: ConversationDelta[] }).deltas;
}

describe("teamProjectionViewOf → projectTeam 的 managerName 投影（specs/agents-team.md §22 契约 7，审查 H2）", () => {
  it("stageTeam 后 delta 与冷快照两链的 team 键携带 managerName（= roster 首位 manager 名），wire 全帧可解析", () => {
    const { hub, publisher, ingestTeamChanged, live } = setupTeamProjectionHarness();
    const initial = requireSnapshot(live.frame!);
    expect(initial.team).toBeUndefined();

    expect(hub.stageTeam("lead", STAGE_INPUT_WITH_MANAGER).status).toBe("ok");
    ingestTeamChanged();
    const deltas = requireDeltas(publisher.flush(live.ack.subscriptionId));
    const deltaTeam = teamPatchOf(deltas);
    // 契约主断言：managerName 到 wire（修复前 projectTeam 一跳静默丢弃，键恒缺席）。
    expect(() => teamProjectionStateSchema.parse(deltaTeam)).not.toThrow();
    expect(deltaTeam?.managerName).toBe("morgana");
    // §22 契约 1：manager 物化为 roster 首位成员（投影花名册首行 = manager）。
    expect(deltaTeam?.members[0]?.memberName).toBe("morgana");

    // 冷快照链（刷新/重连）与 delta 同源同形。
    const cold = publisher.subscribe({ connectionId: "cold", deliveryProfile: "continuous" });
    const coldTeam = requireSnapshot(cold.frame!).team;
    expect(() => teamProjectionStateSchema.parse(coldTeam)).not.toThrow();
    expect(coldTeam?.managerName).toBe("morgana");

    // delta 施加语义自洽：施加到初始快照后与冷快照一致。
    const applied = applyConversationDeltas(initial, deltas);
    expect(applied.team?.managerName).toBe("morgana");
  });

  it("staged 草案行同样携带 managerName（stagedDraft.draftMembers 首行 = manager）", () => {
    const { hub, publisher, ingestTeamChanged, live } = setupTeamProjectionHarness();
    expect(hub.stageTeam("lead", STAGE_INPUT_WITH_MANAGER).status).toBe("ok");
    ingestTeamChanged();
    const deltaTeam = teamPatchOf(requireDeltas(publisher.flush(live.ack.subscriptionId)));
    expect(deltaTeam?.status).toBe("staged");
    expect(deltaTeam?.stagedDraft?.draftMembers[0]?.memberName).toBe("morgana");
    expect(() => teamProjectionStateSchema.parse(deltaTeam)).not.toThrow();
  });
});
