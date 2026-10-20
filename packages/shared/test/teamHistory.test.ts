import { describe, expect, it } from "vitest";
import { commandAckSchema, commandPayloadSchemas } from "../src/drora-protocol-v4/command.js";
import {
  TEAM_HISTORY_QUERY,
  teamHistoryQuerySchema,
} from "../src/drora-protocol-v4/team-history.js";

describe("team history wire bounds", () => {
  it("validates the additive read query without changing mutation payloads", () => {
    expect(commandPayloadSchemas[TEAM_HISTORY_QUERY].parse({ teamId: "t" })).toEqual({
      teamId: "t",
    });
    expect(teamHistoryQuerySchema.safeParse({ teamId: "t", limit: 31 }).success).toBe(false);
    expect(teamHistoryQuerySchema.safeParse({ teamId: "t", beforeSeq: 0 }).success).toBe(false);
    expect(teamHistoryQuerySchema.safeParse({ teamId: "t", throughSeq: -1 }).success).toBe(false);
    expect(commandPayloadSchemas.approveTeamPlan.parse({})).toEqual({});
  });
  it("accepts only bounded historical results", () => {
    const ack = {
      commandId: "c",
      status: "accepted",
      revisionAtDecision: 1,
      result: {
        type: TEAM_HISTORY_QUERY,
        teamId: "t",
        events: [],
        throughSeq: 0,
        skippedEntries: 0,
      },
    };
    expect(commandAckSchema.safeParse(ack).success).toBe(true);
    expect(
      commandAckSchema.safeParse({
        ...ack,
        result: { ...ack.result, events: Array(31).fill({ seq: 1, at: "now", kind: "halted" }) },
      }).success,
    ).toBe(false);
  });
});
