import type {
  CommandAck,
  CommandEnvelope,
  CommandPayloadMap,
  TeamHistoryResult,
  TeamV4CommandType,
} from "@drora/shared/drora-protocol-v4";
import { TEAM_HISTORY_QUERY, teamHistoryResultSchema } from "@drora/shared/drora-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { recordV4CommandAck } from "@/v4/commandAckObservability.js";
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
    // 2026-10-21（spec §14 缺口11 施工发现）：ack 环形缓冲（commandAckObservability
    // 头注「每条命令」）此前只在 SessionPane 的派发路径记录——团队命令走本通道，
    // e2e/现场排查 probe 不到 ACK（AT-01 首跑实证：产品链路全通、RPC OK，观测面
    // 空白）。此处补记，与 SessionPane 同口径（type/status/reasonCode）。
    recordV4CommandAck({
      type,
      status: ack.status,
      ...(ack.reasonCode ? { reasonCode: ack.reasonCode } : {}),
      at: Date.now(),
    });
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
    // 2026-10-23（specs/agents-team.md §14 缺口11 补环的 catch 半边补齐）：传输异常
    // 同属 commandAckObservability 头注「每条命令」一条账——此前只进 logger.error，
    // 环形缓冲里该命令完全缺席，e2e/现场 probe 分不清「未派发」与「已派发但传输失败」。
    // status 用派发路径同款字面量 "transport-error"（v4/SessionPane.tsx 派发 catch；
    // UI 本地观测面非跨进程契约键，不收 shared 常量，两处注释互指）。
    recordV4CommandAck({
      type,
      status: "transport-error",
      at: Date.now(),
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

/** 历史查询的连接（原 useTeamHistory 本地形态，随命令收口迁入单一出处）。 */
export interface TeamHistoryConnection {
  sessionId: string;
  sendCommand: (envelope: CommandEnvelope) => Promise<CommandAck>;
}

/**
 * team 域第九条命令：历史查询（TEAM_HISTORY_QUERY；specs/agents-team.md §19 契约 6
 * 低危项收口，2026-10-23）。此前信封在 useTeamHistory 内直构、ACK 不进
 * commandAckObservability 环形缓冲——八命令补观测环的同一理由（AT-01 实证 probe 不到
 * ACK）对历史查询同样成立；信封构造/发送/ACK 记录自此单一出处。payload 形状
 * { teamId, beforeSeq?, throughSeq? }（shared command.ts 注册表的第九条：schema 在
 * drora-protocol-v4/team-history.ts，经 TEAM_HISTORY_QUERY_SCHEMAS 挂载）。
 *
 * @returns ok=false = 被拒/载荷不合法/传输异常（ack 缺席或解析失败），调用面出错误态。
 */
export async function queryTeamHistory(
  connection: TeamHistoryConnection,
  teamId: string,
  cursor: { beforeSeq?: number; throughSeq?: number } = {},
): Promise<{ ok: boolean; data?: TeamHistoryResult }> {
  const envelope = createCommandEnvelope({
    type: TEAM_HISTORY_QUERY,
    sessionId: connection.sessionId,
    payload: { teamId, ...cursor },
  });
  try {
    const ack = await connection.sendCommand(envelope);
    recordV4CommandAck({
      type: TEAM_HISTORY_QUERY,
      status: ack.status,
      ...(ack.reasonCode ? { reasonCode: ack.reasonCode } : {}),
      at: Date.now(),
    });
    const parsed = teamHistoryResultSchema.safeParse(ack.result);
    if (
      (ack.status !== "accepted" && ack.status !== "duplicate") ||
      !parsed.success ||
      parsed.data.teamId !== teamId
    ) {
      return { ok: false };
    }
    return { ok: true, data: parsed.data };
  } catch (error) {
    logger.warn("[team-commands] 团队历史查询失败", {
      sessionId: connection.sessionId,
      teamId,
      error,
    });
    // 同 sendTeamCommand catch 半边（specs/agents-team.md §19 契约 6「recordV4CommandAck
    // 单一口径」的传输异常半边补齐）：与 SessionPane "transport-error" 同字面量互指。
    recordV4CommandAck({
      type: TEAM_HISTORY_QUERY,
      status: "transport-error",
      at: Date.now(),
    });
    return { ok: false };
  }
}
