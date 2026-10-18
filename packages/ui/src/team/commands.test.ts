import { describe, expect, it } from "vitest";
import type { CommandAck, CommandEnvelope } from "@drora/shared/drora-protocol-v4";

import {
  abandonTeamPlan,
  approveTeamPlan,
  haltTeam,
  resumeTeam,
  reviseTeamPlan,
  sendTeamMessage,
  setTeamMemberName,
  stopTeamMember,
  type TeamCommandOutcome,
  type TeamCommandSender,
} from "./commands.js";

/**
 * 八条团队 v4 命令 helper 的 payload 构造断言（任务卡 A-4：八条各一样例）。
 * sendCommand 注入 stub 捕获信封，断言 wire 形状与 shared
 * TEAM_COMMAND_PAYLOAD_SCHEMAS（CommandPayloadMap 单一出处）一致：
 * 可选字段缺席时键必须真缺席（toStrictEqual 区分 present-undefined），
 * 否则 exactOptionalPropertyTypes 下的 wire 载荷带脏键。
 */

const SESSION_ID = "session_lead_1";

interface CapturedCall {
  envelopes: CommandEnvelope[];
  sendCommand: TeamCommandSender;
}

function captureSend(ack?: Partial<CommandAck>): CapturedCall {
  const envelopes: CommandEnvelope[] = [];
  const sendCommand: TeamCommandSender = async (envelope) => {
    envelopes.push(envelope);
    return {
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: 7,
      ...ack,
    } as CommandAck;
  };
  return { envelopes, sendCommand };
}

describe("team v4 command helpers construct wire payloads per shared schema", () => {
  it("approveTeamPlan sends an empty payload to the lead session", async () => {
    const { envelopes, sendCommand } = captureSend();
    const outcome = await approveTeamPlan({ sessionId: SESSION_ID, sendCommand });
    expect(outcome.ok).toBe(true);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.type).toBe("approveTeamPlan");
    expect(envelopes[0]?.sessionId).toBe(SESSION_ID);
    expect(envelopes[0]?.payload).toStrictEqual({});
  });

  it("reviseTeamPlan carries note only when provided", async () => {
    const withNote = captureSend();
    await reviseTeamPlan({
      sessionId: SESSION_ID,
      sendCommand: withNote.sendCommand,
      note: "把 alice 的路由换成 deepseek",
    });
    expect(withNote.envelopes[0]?.type).toBe("reviseTeamPlan");
    expect(withNote.envelopes[0]?.payload).toStrictEqual({
      note: "把 alice 的路由换成 deepseek",
    });

    const withoutNote = captureSend();
    await reviseTeamPlan({ sessionId: SESSION_ID, sendCommand: withoutNote.sendCommand });
    expect(withoutNote.envelopes[0]?.payload).toStrictEqual({});
  });

  it("abandonTeamPlan sends an empty payload", async () => {
    const { envelopes, sendCommand } = captureSend();
    const outcome = await abandonTeamPlan({ sessionId: SESSION_ID, sendCommand });
    expect(outcome.ok).toBe(true);
    expect(envelopes[0]?.type).toBe("abandonTeamPlan");
    expect(envelopes[0]?.payload).toStrictEqual({});
  });

  it("sendTeamMessage carries to/message and optional summary (wire face has no trace fields)", async () => {
    const full = captureSend();
    await sendTeamMessage({
      sessionId: SESSION_ID,
      sendCommand: full.sendCommand,
      to: "alice",
      message: "请优先完成 task_1 的定价页抓取",
      summary: "催办 task_1",
    });
    expect(full.envelopes[0]?.type).toBe("sendTeamMessage");
    expect(full.envelopes[0]?.payload).toStrictEqual({
      to: "alice",
      message: "请优先完成 task_1 的定价页抓取",
      summary: "催办 task_1",
    });

    const minimal = captureSend();
    await sendTeamMessage({
      sessionId: SESSION_ID,
      sendCommand: minimal.sendCommand,
      to: "lead",
      message: "hello",
    });
    expect(minimal.envelopes[0]?.payload).toStrictEqual({ to: "lead", message: "hello" });
  });

  it("stopTeamMember carries memberName and optional reason", async () => {
    const withReason = captureSend();
    await stopTeamMember({
      sessionId: SESSION_ID,
      sendCommand: withReason.sendCommand,
      memberName: "bob",
      reason: "预算收紧",
    });
    expect(withReason.envelopes[0]?.type).toBe("stopTeamMember");
    expect(withReason.envelopes[0]?.payload).toStrictEqual({
      memberName: "bob",
      reason: "预算收紧",
    });

    const minimal = captureSend();
    await stopTeamMember({
      sessionId: SESSION_ID,
      sendCommand: minimal.sendCommand,
      memberName: "bob",
    });
    expect(minimal.envelopes[0]?.payload).toStrictEqual({ memberName: "bob" });
  });

  it("setTeamMemberName carries memberName + newName (both required)", async () => {
    const { envelopes, sendCommand } = captureSend();
    await setTeamMemberName({
      sessionId: SESSION_ID,
      sendCommand,
      memberName: "bob",
      newName: "bobby",
    });
    expect(envelopes[0]?.type).toBe("setTeamMemberName");
    expect(envelopes[0]?.payload).toStrictEqual({ memberName: "bob", newName: "bobby" });
  });

  it("haltTeam carries optional reason", async () => {
    const withReason = captureSend();
    await haltTeam({
      sessionId: SESSION_ID,
      sendCommand: withReason.sendCommand,
      reason: "先停一停，等评审结论",
    });
    expect(withReason.envelopes[0]?.type).toBe("haltTeam");
    expect(withReason.envelopes[0]?.payload).toStrictEqual({
      reason: "先停一停，等评审结论",
    });

    const minimal = captureSend();
    await haltTeam({ sessionId: SESSION_ID, sendCommand: minimal.sendCommand });
    expect(minimal.envelopes[0]?.payload).toStrictEqual({});
  });

  it("resumeTeam always carries the required reason", async () => {
    const { envelopes, sendCommand } = captureSend();
    const outcome = await resumeTeam({
      sessionId: SESSION_ID,
      sendCommand,
      reason: "评审通过，继续推进",
    });
    expect(outcome.ok).toBe(true);
    expect(envelopes[0]?.type).toBe("resumeTeam");
    expect(envelopes[0]?.payload).toStrictEqual({ reason: "评审通过，继续推进" });
  });
});

describe("team command ACK semantics", () => {
  it("treats rejected ACK as not-ok and carries the ack for reasonCode rendering", async () => {
    const { envelopes, sendCommand } = captureSend({
      status: "failed",
      reasonCode: "fault.command.teamHubUnavailable",
    });
    const outcome: TeamCommandOutcome = await haltTeam({
      sessionId: SESSION_ID,
      sendCommand,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ack?.status).toBe("failed");
    expect(outcome.ack?.reasonCode).toBe("fault.command.teamHubUnavailable");
    expect(envelopes).toHaveLength(1);
  });

  it("carries the transport error when sendCommand throws (ack absent)", async () => {
    const sendCommand: TeamCommandSender = async () => {
      throw new Error("fault.subscription.runtimeRestarted");
    };
    const outcome = await approveTeamPlan({ sessionId: SESSION_ID, sendCommand });
    expect(outcome.ok).toBe(false);
    expect(outcome.ack).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Error);
  });
});
