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
 * specs/agents-team.md §19 契约 1 投影半边（2026-10-23）：abandonStage 归档后 hub 发
 * TeamStateChanged（通知半边由 core team-hub 单测锁定），投影桥必须把它收敛成 archived
 * 键级 delta——stagedDraft 仅 status=staged 携带（core projection.ts stagedDraftOf），
 * abandon 后该键缺席，SessionPane 审批 dock 的
 * `snapshot.team.status === "staged"` 守卫随之失败、dock 消失（零投影层/UI 改动的
 * 自洽收敛链的投影端证据）。
 *
 * hub 登记表是 install.ts 的模块级单例（key = lead sessionId），无测试出口；本文件以
 * 真实 TeamHub 注入替身——TeamStateChanged → teamProjectionViewOf → projectTeam →
 * JSON diff → delta 全链为真，仅「登记查询」一跳被 mock。事件形状照 install.ts
 * emitTeamStateChanged 的真实载荷（payload 只带 teamId，投影只消费 sessionId）。
 */
const mocks = vi.hoisted(() => ({ hub: { current: undefined as unknown } }));

vi.mock("../src/app/drora-team/install.js", () => ({
  getInstalledTeamHub: (sessionId: string) =>
    sessionId === "lead" ? mocks.hub.current : undefined,
  getInstalledTeamHistoryReader: () => undefined,
}));

// §22 契约 1（2026-10-27 补 manager）：TeamStageInput.manager 自 a1af8bb3 起为必填
// （hub.stageTeam 直接读 input.manager.memberName）——本文件 STAGE_INPUT 自 05625f17
// 后未随 §22 同步，缺 manager 会让 stageTeam 在入口即 TypeError。照同批 core 测试
// 更新口径补 manager（roster 首位）。
const STAGE_INPUT: TeamStageInput = {
  name: "demo",
  manager: { memberName: "morgan", profile: "team manager" },
  draftMembers: [{ memberName: "alice", profile: "researcher" }],
  draftTasks: [{ title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [] }],
};

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

describe("TeamStateChanged → team 键级 delta（specs/agents-team.md §19 契约 1 投影半边）", () => {
  it("abandon 后 delta 的 team.status 为 archived 且 stagedDraft 键缺席；冷快照与 delta 施加终态同形", () => {
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

    // 初始冷快照无 team（未成队）；staged 通知产出 staged 投影（带 stagedDraft）。
    const live = publisher.subscribe({ connectionId: "live", deliveryProfile: "continuous" });
    const initial = requireSnapshot(live.frame!);
    expect(initial.team).toBeUndefined();

    expect(hub.stageTeam("lead", STAGE_INPUT).status).toBe("ok");
    ingestTeamChanged();
    const stagedDeltas = requireDeltas(publisher.flush(live.ack.subscriptionId));
    const stagedTeam = teamPatchOf(stagedDeltas);
    expect(stagedTeam?.status).toBe("staged");
    expect(stagedTeam?.stagedDraft).toBeDefined();

    // 契约主断言：abandon 后的下一条 TeamStateChanged 收敛为 archived 键级 delta，
    // stagedDraft 键缺席（非空对象）——dock 守卫失败、三动作随键一起消失。
    expect(hub.abandonStage("lead").status).toBe("ok");
    ingestTeamChanged();
    const archivedDeltas = requireDeltas(publisher.flush(live.ack.subscriptionId));
    const archivedTeam = teamPatchOf(archivedDeltas);
    expect(archivedTeam?.status).toBe("archived");
    expect(archivedTeam && "stagedDraft" in archivedTeam).toBe(false);
    // archived 投影仍是合法 wire 载荷（花名册保留、schema 必过）。
    expect(() => teamProjectionStateSchema.parse(archivedTeam)).not.toThrow();

    // 归档后新订户（刷新/重连）的冷快照同形：archived + stagedDraft 缺席。
    const cold = publisher.subscribe({ connectionId: "cold", deliveryProfile: "continuous" });
    const coldTeam = requireSnapshot(cold.frame!).team;
    expect(coldTeam?.status).toBe("archived");
    expect(coldTeam && "stagedDraft" in coldTeam).toBe(false);

    // delta 施加语义自洽：staged→archived 两条依序施加到初始快照，终态与冷快照一致。
    const applied = applyConversationDeltas(initial, [...stagedDeltas, ...archivedDeltas]);
    expect(applied.team?.status).toBe("archived");
    expect(applied.team && "stagedDraft" in applied.team).toBe(false);
  });
});
