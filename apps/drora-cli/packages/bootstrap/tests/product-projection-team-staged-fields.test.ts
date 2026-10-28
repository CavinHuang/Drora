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
 * specs/agents-team.md §19 契约 3（2026-10-23）：投影桥 teamProjectionViewOf 补
 * roster.name 与 member.modelSelection 两处映射——此前桥的显式字段清单漏了这两项，
 * hub.snapshot()（缺口10）携带的队名与建队路由快照（spec §8.7）到不了 wire：
 * 队名恒显 fallback、staged 审批面成员行恒显「未设置路由」，违背 §10「审批面定义
 * 即全量呈现」。本文件锁两件事：
 * ① 草案带 name/modelSelection 时，冷快照与 delta 两显示链（同源桥）的 team 键
 *    wire 全帧（teamProjectionStateSchema）safeParse 必过且两字段在场；
 * ② 前置依赖（契约 2→3 施工次序）的投影端证据：thought=""/profile="" 草案经
 *    hub 落库归一为键缺席（§19 契约 2②）后，投影不含空串——补映射不会让空白
 *    thought 复现 §17 契约 4 的 wire min(1) 烧帧。
 *
 * hub 登记表是 install.ts 的模块级单例（key = lead sessionId），无测试出口；本文件以
 * 真实 TeamHub 注入替身（手法同 product-projection-team-archived.test.ts）——
 * TeamStateChanged → teamProjectionViewOf → projectTeam → JSON diff → delta 全链为真，
 * 仅「登记查询」一跳被 mock。
 */
const mocks = vi.hoisted(() => ({ hub: { current: undefined as unknown } }));

vi.mock("../src/app/drora-team/install.js", () => ({
  getInstalledTeamHub: (sessionId: string) =>
    sessionId === "lead" ? mocks.hub.current : undefined,
  getInstalledTeamHistoryReader: () => undefined,
}));

const STAGE_INPUT_NAMED: TeamStageInput = {
  name: "research-squad",
  manager: { memberName: "morgan", profile: "team manager" },
  draftMembers: [
    {
      memberName: "alice",
      profile: "researcher",
      modelSelection: { provider: "zai", model: "glm-4.7", thought: "deep route" },
    },
  ],
  draftTasks: [{ title: "t1", spec: { goal: "g1", acceptance: ["a"] }, dependsOn: [] }],
};

const STAGE_INPUT_UNNAMED: TeamStageInput = {
  manager: { memberName: "morgan", profile: "team manager" },
  draftMembers: [{ memberName: "bob", profile: "writer" }],
  draftTasks: [{ title: "t2", spec: { goal: "g2", acceptance: ["b"] }, dependsOn: [] }],
};

const STAGE_INPUT_BLANK: TeamStageInput = {
  name: "blank-demo",
  manager: { memberName: "morgan", profile: "team manager" },
  draftMembers: [
    {
      memberName: "carol",
      profile: "",
      modelSelection: { provider: "zai", model: "glm-4.7", thought: "" },
    },
  ],
  draftTasks: [{ title: "t3", spec: { goal: "g3", acceptance: ["c"] }, dependsOn: [] }],
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

/** 按 memberName 定位草案成员行（§22 后 manager 恒为首位，位置断言会随 roster 结构漂移）。 */
type DraftMemberRow = NonNullable<TeamProjectionState["stagedDraft"]>["draftMembers"][number];
function draftMemberOf(
  team: TeamProjectionState | undefined,
  memberName: string,
): DraftMemberRow | undefined {
  return team?.stagedDraft?.draftMembers.find((member) => member.memberName === memberName);
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

describe("teamProjectionViewOf 补 name/modelSelection 映射（specs/agents-team.md §19 契约 3）", () => {
  it("草案带 name + modelSelection：冷快照与 delta 两链 wire 全帧可解析且两字段在场，花名册行不携带 modelSelection", () => {
    const { hub, publisher, ingestTeamChanged, live } = setupTeamProjectionHarness();
    const initial = requireSnapshot(live.frame!);
    expect(initial.team).toBeUndefined();

    expect(hub.stageTeam("lead", STAGE_INPUT_NAMED).status).toBe("ok");
    ingestTeamChanged();
    const deltas = requireDeltas(publisher.flush(live.ack.subscriptionId));
    const deltaTeam = teamPatchOf(deltas);
    // 契约主断言：补映射后 team 键是合法 wire 载荷（此前 name/modelSelection 缺席
    // 虽也可解析，但 §17 契约 4 的烧帧形态证明「全帧可解析」必须连同字段一起锁）。
    expect(() => teamProjectionStateSchema.parse(deltaTeam)).not.toThrow();
    expect(deltaTeam?.name).toBe("research-squad");
    expect(draftMemberOf(deltaTeam, "alice")?.modelSelection).toEqual({
      provider: "zai",
      model: "glm-4.7",
      thought: "deep route",
    });
    // 花名册行有意不映射（登记免误补）：modelSelection 只经 stagedDraft 行上 wire。
    const rosterAlice = deltaTeam?.members.find((member) => member.memberName === "alice");
    expect(rosterAlice).toBeDefined();
    expect(rosterAlice).not.toHaveProperty("modelSelection");

    // 冷快照链（刷新/重连）与 delta 同源同形。
    const cold = publisher.subscribe({ connectionId: "cold", deliveryProfile: "continuous" });
    const coldTeam = requireSnapshot(cold.frame!).team;
    expect(() => teamProjectionStateSchema.parse(coldTeam)).not.toThrow();
    expect(coldTeam?.name).toBe("research-squad");
    expect(draftMemberOf(coldTeam, "alice")?.modelSelection).toEqual({
      provider: "zai",
      model: "glm-4.7",
      thought: "deep route",
    });

    // delta 施加语义自洽：施加到初始快照后与冷快照一致。
    const applied = applyConversationDeltas(initial, deltas);
    expect(applied.team?.name).toBe("research-squad");
    expect(draftMemberOf(applied.team, "alice")?.modelSelection).toEqual({
      provider: "zai",
      model: "glm-4.7",
      thought: "deep route",
    });
  });

  it("无名草案 name 键缺席、无路由成员 modelSelection 键缺席（缺席照旧键缺席，旧数据兼容）", () => {
    const { publisher, ingestTeamChanged, live, hub } = setupTeamProjectionHarness();
    expect(hub.stageTeam("lead", STAGE_INPUT_UNNAMED).status).toBe("ok");
    ingestTeamChanged();
    const deltaTeam = teamPatchOf(requireDeltas(publisher.flush(live.ack.subscriptionId)));
    expect(deltaTeam).toBeDefined();
    expect(() => teamProjectionStateSchema.parse(deltaTeam)).not.toThrow();
    expect(deltaTeam).not.toHaveProperty("name");
    expect(draftMemberOf(deltaTeam, "bob")).toBeDefined();
    expect(draftMemberOf(deltaTeam, "bob")).not.toHaveProperty("modelSelection");
  });

  it('thought=""/profile="" 草案经 hub 落库归一后投影不含空串（§19 契约 2→3 次序依赖的投影端证据）', () => {
    const { hub, publisher, ingestTeamChanged, live } = setupTeamProjectionHarness();
    expect(hub.stageTeam("lead", STAGE_INPUT_BLANK).status).toBe("ok");
    ingestTeamChanged();
    const deltaTeam = teamPatchOf(requireDeltas(publisher.flush(live.ack.subscriptionId)));
    const draftMember = draftMemberOf(deltaTeam, "carol");
    expect(draftMember).toBeDefined();
    // §19 契约 2②：空白 profile/thought 落库归一为键缺席——桥补映射后空串不再
    // 进投影，wire min(1)（shared team.ts thought min(1)）不会烧帧。
    expect(draftMember).not.toHaveProperty("profile");
    expect(draftMember?.modelSelection).toBeDefined();
    expect(draftMember?.modelSelection).not.toHaveProperty("thought");
    expect(() => teamProjectionStateSchema.parse(deltaTeam)).not.toThrow();
  });
});
