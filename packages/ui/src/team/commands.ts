import type {
  CommandAck,
  CommandEnvelope,
  CommandPayloadMap,
  TeamV4CommandType,
} from "@drora/shared/drora-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { logger } from "@/logger.js";

/**
 * 八条团队 v4 命令的构造/发送 helper（specs/agents-team.md §10、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1/§3.3、
 * 00-master-design.md §6.2 命令清单）。
 *
 * 形态照 v4 交互先例（interactionAutoResolutionCommand.ts / V4InteractionDialogs.tsx
 * 的 resolveInteraction）：createCommandEnvelope 构造 + 宿主注入 sendCommand 发送 +
 * ACK 成功族判定（accepted | duplicate | noop）。团队命令与 workflow 命令同类：
 * 不入 COMMANDS_REQUIRING_BASE_REVISION（shared command.ts 注册表挂载注释），也
 * 不入 pendingCommandReplayFor（pendingCommandReplay.ts 无 team 条目 → registry.record
 * 是 no-op），因此不走 pendingCommandRegistry 对账账本（照 WorkflowRunSidePane 的
 * cancelBackgroundWork/resumeWorkflowRun 同款处理）。
 *
 * payload 类型一律取 CommandPayloadMap（shared TEAM_COMMAND_PAYLOAD_SCHEMAS 单一出处，
 * spec §6.4 契约键单一出处）——本文件不复制任何载荷形状；sendTeamMessage 的溯源字段
 * （sourceTaskId/sourceAttemptId/targetTaskId）属 core 层 TeamSendInput（hub 内部，
 * design §3.2），不在 v4 wire 载荷上（design §6.2 权威表）。
 */

/** 宿主注入的 v4 发送通道（ConversationTransport["sendCommand"] 同形；测试可注入 stub）。 */
export type TeamCommandSender = (envelope: CommandEnvelope) => Promise<CommandAck>;

export interface TeamCommandInput {
  /** lead 会话 id。团队命令只对 lead 会话有意义（成员 child 会话会被 hub 按「不在册」拒绝）。 */
  sessionId: string;
  sendCommand: TeamCommandSender;
}

/**
 * 统一的命令 ACK 语义结果。ok = accepted | duplicate | noop（v4 交互先例的成功族）；
 * 拒绝/失败时调用方读 `ack.status`/`ack.reasonCode` 出文案；传输异常（断线、握手失败、
 * 能力缺席）时 `ack` 缺席、`error` 在场。
 */
export interface TeamCommandOutcome {
  ok: boolean;
  ack?: CommandAck;
  error?: unknown;
}

async function sendTeamCommand<T extends TeamV4CommandType>(
  input: TeamCommandInput,
  type: T,
  payload: CommandPayloadMap[T],
): Promise<TeamCommandOutcome> {
  const envelope = createCommandEnvelope({ type, sessionId: input.sessionId, payload });
  try {
    const ack = await input.sendCommand(envelope);
    const ok = ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop";
    if (!ok) {
      logger.warn("[team-commands] 团队命令被拒绝", {
        type,
        sessionId: input.sessionId,
        commandId: envelope.commandId,
        status: ack.status,
        reasonCode: ack.reasonCode,
      });
    }
    return { ok, ack };
  } catch (error) {
    logger.error("[team-commands] 团队命令发送失败", {
      type,
      sessionId: input.sessionId,
      commandId: envelope.commandId,
      error,
    });
    return { ok: false, error };
  }
}

/** staged 草案「确认并启动」：唯一创建成员入口（design §6.2；载荷为空，草案全文在 hub）。 */
export function approveTeamPlan(input: TeamCommandInput): Promise<TeamCommandOutcome> {
  return sendTeamCommand(input, "approveTeamPlan", {});
}

/** 「回对话修改」：草案标记等待反馈并取消规划回合；修改方向由用户在对话里说（spec §10）。 */
export function reviseTeamPlan(
  input: TeamCommandInput & CommandPayloadMap["reviseTeamPlan"],
): Promise<TeamCommandOutcome> {
  const { note } = input;
  return sendTeamCommand(input, "reviseTeamPlan", note === undefined ? {} : { note });
}

/** 「放弃」：归档草案（status=archived）并禁止自动重建（spec §2.6）。 */
export function abandonTeamPlan(input: TeamCommandInput): Promise<TeamCommandOutcome> {
  return sendTeamCommand(input, "abandonTeamPlan", {});
}

/**
 * 用户对成员说话的唯一通道（spec §1：必须经 lead 侧团队命令走邮箱投递；teammate
 * 会话本体只读——v4-bridge 只读守卫兜底，成员下钻 TeamMemberSidePane 的输入框用）。
 */
export function sendTeamMessage(
  input: TeamCommandInput & CommandPayloadMap["sendTeamMessage"],
): Promise<TeamCommandOutcome> {
  const { to, message, summary } = input;
  return sendTeamCommand(input, "sendTeamMessage", {
    to,
    message,
    ...(summary === undefined ? {} : { summary }),
  });
}

/** 成员移除 v1 只走用户命令（spec 实现设计裁决第 7 条：不给 lead 模型移除工具）。 */
export function stopTeamMember(
  input: TeamCommandInput & CommandPayloadMap["stopTeamMember"],
): Promise<TeamCommandOutcome> {
  const { memberName, reason } = input;
  return sendTeamCommand(input, "stopTeamMember", {
    memberName,
    ...(reason === undefined ? {} : { reason }),
  });
}

/** 成员改名（spec §2.4 名字重定向防护基线：花名册 name→agentId 绑定更新）。 */
export function setTeamMemberName(
  input: TeamCommandInput & CommandPayloadMap["setTeamMemberName"],
): Promise<TeamCommandOutcome> {
  const { memberName, newName } = input;
  return sendTeamCommand(input, "setTeamMemberName", { memberName, newName });
}

/** 用户停队：halted ≠ escalated（spec §1）；halted 后普通建任务不得静默恢复。 */
export function haltTeam(
  input: TeamCommandInput & CommandPayloadMap["haltTeam"],
): Promise<TeamCommandOutcome> {
  const { reason } = input;
  return sendTeamCommand(input, "haltTeam", reason === undefined ? {} : { reason });
}

/** 显式恢复：reason 必填（spec §1「显式 TeamResume 且带理由」；wire schema 同款约束）。 */
export function resumeTeam(
  input: TeamCommandInput & CommandPayloadMap["resumeTeam"],
): Promise<TeamCommandOutcome> {
  const { reason } = input;
  return sendTeamCommand(input, "resumeTeam", { reason });
}
