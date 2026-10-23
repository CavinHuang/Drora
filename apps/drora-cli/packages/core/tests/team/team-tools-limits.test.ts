import { describe, expect, it } from "vitest";
import type { TeamLeadPort } from "@drora/contracts";
import { createTeamLeadToolEntries } from "../../src/team/team-tools.js";

// §17 契约 4（2026-10-23）：TeamSpawn 输入与 wire 限额同门——超限字段在工具入参边界
// 被拒（模型当场自纠），不再让坏草案落库后烧掉会话流的每一帧。

function toolEntries() {
  let staged = 0;
  const port = {
    stageTeam: () => {
      staged += 1;
      return { status: "rejected", error: { code: "team_not_present", message: "stub" } };
    },
  } as unknown as TeamLeadPort;
  const entries = createTeamLeadToolEntries(() => port);
  const spawn = entries.find((entry) => entry.metadata.name === "TeamSpawn");
  if (spawn === undefined) throw new Error("TeamSpawn entry missing");
  return {
    spawn,
    stageCalls: () => staged,
    context: { sessionId: "lead_s1" } as never,
  };
}

const COMPLIANT_INPUT = {
  name: "demo",
  members: [{ name: "alice", profile: "researcher" }],
  tasks: [{ title: "t1", goal: "g1", acceptance: ["a"] }],
};

describe("TeamSpawn input wire limits (§17 契约 4)", () => {
  it("rejects an over-limit member profile at the tool boundary", async () => {
    const { spawn, context } = toolEntries();
    await expect(
      spawn.handler(
        {
          ...COMPLIANT_INPUT,
          members: [{ name: "alice", profile: "p".repeat(200) }],
        },
        context,
      ),
    ).rejects.toThrow("128");
  });

  it("rejects over-limit task title and over-large rosters", async () => {
    const { spawn, context } = toolEntries();
    await expect(
      spawn.handler(
        {
          ...COMPLIANT_INPUT,
          tasks: [{ title: "t".repeat(8_001), goal: "g1", acceptance: ["a"] }],
        },
        context,
      ),
    ).rejects.toThrow();
    await expect(
      spawn.handler(
        {
          ...COMPLIANT_INPUT,
          members: Array.from({ length: 65 }, (_, i) => ({ name: `m${i}` })),
        },
        context,
      ),
    ).rejects.toThrow();
  });

  it("lets a compliant draft through to the port", async () => {
    const { spawn, stageCalls, context } = toolEntries();
    // stub port 固定回 team_not_present；handler 会把 stage 拒绝转成抛错——
    // 抛错消息 = stub 文案即证明「合规草案已到达 port」（schema 没拦它）。
    await expect(spawn.handler(COMPLIANT_INPUT, context)).rejects.toThrow("stub");
    expect(stageCalls()).toBe(1);
  });
});
