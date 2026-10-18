// Agents Team 命令组（八条 v4 用户面命令；specs/agents-team.md §6.3/§6.4、
// docs/agent-team-implementation-2026-10-16/00-master-design.md §6.2/§7 PR-2.2）。
//
// handler 纯函数 (host, envelope) → CommandResult|undefined（照 model-config.ts 体例）；
// 决策逻辑直驱装配面 TeamHub（经 install.ts 的模块级登记 getInstalledTeamHub 查询，
// 不经旧协议 op，也不在本文件自持第二份 hub 引用——状态所有者唯一，spec §2.2）。
//
// ACK 语义（PR-2.2 验收「八命令 ACK 语义」）：
// - 全部八条成功 → accepted（无 result）：commandResultSchema 无 team 变体（additive 纪律，
//   PR-2.1 未加即不伪造）；下游感知 team 变更走 delta/snapshot 的 team 键投影（PR-2.3）。
// - hub 缺席（未装配/灰度关/非 lead 会话）→ 抛带 reasonCode 的领域错误 → gateway 映射
//   failed ACK（v4-gateway.ts:2552-2562 的 domainReasonCode 通道），不抛穿网关。
// - hub 拒绝 → failed ACK，reasonCode = fault.command.teamRejected.<TeamPortErrorCode>，
//   message 用 hub errors.ts 的单一出处文案（照 fault.command.workflowRunResumeRejected.<reason>
//   的前缀家族先例，command.ts:278）。
// - CAS 归类：八条全部不落 conversation 行，不携 baseRevision（TEAM_COMMAND_PAYLOAD_SCHEMAS
//   注册处注释，shared/command.ts:298-302；对照断言在 team-commands-smoke.test.ts）。
import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@drora/shared/drora-protocol-v4";
import type { TeamMutationResult, TeamSendResult } from "@drora/contracts";
import type { TeamHub } from "@drora/core";
import { getInstalledTeamHub } from "../../../app/drora-team/install.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";

/** hub 缺席（未装配/灰度关/非 lead 会话）的 failed ACK reasonCode。 */
const TEAM_HUB_UNAVAILABLE = "fault.command.teamHubUnavailable";
/** v1 未支持命令（setTeamMemberName，登记 M3 成员改名面）的 failed ACK reasonCode。 */
const TEAM_COMMAND_UNSUPPORTED = "fault.command.teamCommandUnsupported";

/** 团队命令打到无 hub 的会话（灰度关 = install 从未发生；成员 child 会话不在册同理）。 */
export class V4TeamHubUnavailableError extends Error {
  readonly reasonCode = TEAM_HUB_UNAVAILABLE;

  constructor(sessionId: string) {
    super(`agents team hub is not installed for session ${sessionId}`);
    this.name = "V4TeamHubUnavailableError";
  }
}

/** hub 拒绝（TeamPortErrorCode 透传为 reasonCode 后缀，文案单一出处 core errors.ts）。 */
export class V4TeamRejectedError extends Error {
  readonly reasonCode: string;

  constructor(code: string, message: string) {
    super(message);
    this.reasonCode = `fault.command.teamRejected.${code}`;
    this.name = "V4TeamRejectedError";
  }
}

/** v1 未支持：能力声明独立于装配状态（hub 在场与否都是未支持）。 */
export class V4TeamUnsupportedError extends Error {
  readonly reasonCode = TEAM_COMMAND_UNSUPPORTED;

  constructor(command: string) {
    super(`${command} is not supported in v1 (planned for M3)`);
    this.name = "V4TeamUnsupportedError";
  }
}

/**
 * 会话 → 装配面查询：requireRecord 照最近邻语义（null/未知会话 → V4SessionNotFoundError），
 * 再按 lead sessionId 查 install 登记表；登记 key = lead sessionId，成员 child 会话
 * 天然不在册（E10 lead 专属的结构性保证）。
 */
function requireTeamHub(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): { hub: TeamHub; sessionId: string } {
  const record = requireRecord(host, envelope.sessionId);
  const sessionId = record.app.sessionId;
  const hub = getInstalledTeamHub(sessionId);
  if (hub === undefined) throw new V4TeamHubUnavailableError(sessionId);
  return { hub, sessionId };
}

/** hub 变更结果统一收口：rejected ≠ accepted，绝不静默吞（spec §16.1 错误分类即协议）。 */
function assertMutationOk(command: string, result: TeamMutationResult): void {
  if (result.status !== "ok") {
    throw new V4TeamRejectedError(
      result.error?.code ?? "unknown",
      result.error?.message ?? `${command} rejected by team hub`,
    );
  }
}

/** staged 草案「确认并启动」：唯一创建成员入口；草案全文是 hub 的服务端事实，载荷为空。 */
async function approveTeamPlan(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  assertMutationOk("approveTeamPlan", await hub.approveStage(sessionId));
  return undefined;
}

/**
 * 「回对话修改」：草案标记等待反馈并取消规划回合（追问面在对话侧），hub 侧映射为
 * stageTeam(同一草案)——staged 再次 stageTeam = 原子更新同一 teamId，不另建 team（spec §10）。
 *
 * 已知边界（登记）：hub 查询面（snapshot/board）不暴露草案 name 与逐成员 modelSelection，
 * 本 handler 以查询面重建入参时这两项不回写（v1 无生产 stage 调用方携带它们，无实际回归；
 * 草案只读读取面随 M3 投影桥一并在 core 补齐后收口）。
 */
async function reviseTeamPlan(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  const roster = hub.snapshot();
  const board = hub.board();
  if (roster === undefined || board === undefined || roster.status !== "staged") {
    throw new V4TeamRejectedError(
      "team_not_present",
      "reviseTeamPlan requires a staged draft in this session.",
    );
  }
  assertMutationOk(
    "reviseTeamPlan",
    hub.stageTeam(sessionId, {
      draftMembers: roster.members.map((member) => ({
        memberName: member.memberName,
        profile: member.profile ?? "",
      })),
      draftTasks: board.tasks.map((task) => ({
        title: task.title,
        spec: {
          goal: task.spec.goal,
          acceptance: [...task.spec.acceptance],
          ...(task.spec.outputFormat === undefined
            ? {}
            : { outputFormat: task.spec.outputFormat }),
        },
        ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
        dependsOn: [...task.dependsOn],
      })),
    }),
  );
  // M3 PR-3.1（awaitingFeedback 回填）：「回对话修改」把草案标记为等待反馈；
  // approveTeamPlan 审批时由 hub 清除（TeamRecord 内部标记，投影 stagedDraft 读）。
  assertMutationOk("reviseTeamPlan", hub.markStageAwaitingFeedback(sessionId));
  return undefined;
}

/** 「放弃」：归档草案（status=archived）并禁止自动重建（spec §2.6）。 */
async function abandonTeamPlan(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  assertMutationOk("abandonTeamPlan", hub.abandonStage(sessionId));
  return undefined;
}

/** 用户停队：halted ≠ escalated（spec §2.6）；payload.reason v1 无 hub 消费面（hub.halt 不收）。 */
async function haltTeam(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  assertMutationOk("haltTeam", hub.halt(sessionId));
  return undefined;
}

/** 显式恢复：reason 必填（wire schema 已强制），空理由 hub 侧也拒绝（用户停的队不得静默恢复）。 */
async function resumeTeam(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  const payload = envelope.payload as CommandPayloadMap["resumeTeam"];
  assertMutationOk("resumeTeam", hub.resume(sessionId, payload.reason));
  return undefined;
}

/**
 * 用户对成员说话的唯一通道：走 lead 端口邮箱投递（teammate 会话本体只读，spec §1）。
 * queued 也算发送成功（ack 只认注入——送达确认在邮箱 deliveredAccepted，spec §16.3）。
 */
async function sendTeamMessage(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  const payload = envelope.payload as CommandPayloadMap["sendTeamMessage"];
  const result: TeamSendResult = hub.leadPort(sessionId).send({
    to: payload.to,
    message: payload.message,
    ...(payload.summary === undefined ? {} : { summary: payload.summary }),
  });
  if (result.status !== "success") {
    throw new V4TeamRejectedError(
      result.error?.code ?? "unknown",
      result.error?.message ?? "sendTeamMessage rejected by team hub",
    );
  }
  return undefined;
}

/** 成员移除（hub 移除安全序：失效 → 回收任务 → 标记移除，spec §16.2）；payload.reason v1 无 hub 消费面。 */
async function stopTeamMember(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub } = requireTeamHub(host, envelope);
  const payload = envelope.payload as CommandPayloadMap["stopTeamMember"];
  assertMutationOk("stopTeamMember", hub.removeMember(payload.memberName));
  return undefined;
}

/** 成员改名 v1 未支持（名字重定向防护的完整面随 M3 落，spec §2.4）——明确未支持 ACK，不静默。 */
async function setTeamMemberName(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  requireRecord(host, envelope.sessionId);
  throw new V4TeamUnsupportedError("setTeamMemberName");
}

export const teamHandlers = {
  approveTeamPlan,
  reviseTeamPlan,
  abandonTeamPlan,
  sendTeamMessage,
  stopTeamMember,
  haltTeam,
  resumeTeam,
  setTeamMemberName,
};
