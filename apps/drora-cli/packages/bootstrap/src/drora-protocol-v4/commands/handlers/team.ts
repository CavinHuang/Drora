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
import {
  getInstalledTeamHub,
  getInstalledTeamHistoryReader,
} from "../../../app/drora-team/install.js";
import { TEAM_HISTORY_QUERY, TEAM_HISTORY_UNAVAILABLE } from "@drora/shared/drora-protocol-v4";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";

/** hub 缺席（未装配/灰度关/非 lead 会话）的 failed ACK reasonCode。 */
const TEAM_HUB_UNAVAILABLE = "fault.command.teamHubUnavailable";

/** 团队命令打到无 hub 的会话（灰度关 = install 从未发生；成员 child 会话不在册同理）。 */
export class V4TeamHubUnavailableError extends Error {
  readonly reasonCode = TEAM_HUB_UNAVAILABLE;

  constructor(sessionId: string) {
    super(`agents team hub is not installed for session ${sessionId}`);
    this.name = "V4TeamHubUnavailableError";
  }
}

/**
 * hub 拒绝（TeamPortErrorCode 透传为 reasonCode 后缀，文案单一出处 core errors.ts）。
 * §21 D 例外登记（2026-10-24）：getTeamHistory 的 teamId 不匹配拒绝用 handler 层
 * 局部码 historyTeamMismatch（fault.command.teamRejected.historyTeamMismatch，文案
 * 内联英文）——它是命令面路由校验（请求的 teamId 与该会话 hub 现役 team 不符）而非
 * 内核裁决语义，**不进 TeamPortErrorCode 联合**（21 码封闭）与 core errors.ts；
 * 持久化缺席路径仍用既有 TEAM_HISTORY_UNAVAILABLE。
 */
export class V4TeamRejectedError extends Error {
  readonly reasonCode: string;

  constructor(code: string, message: string) {
    super(message);
    this.reasonCode = `fault.command.teamRejected.${code}`;
    this.name = "V4TeamRejectedError";
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
  // §10 增补三：载荷 optional permissionMode（wire 枚举已验）随批准覆写成员权限
  //（载荷形态断言照姊妹 handler 同款）。
  const payload = envelope.payload as CommandPayloadMap["approveTeamPlan"];
  assertMutationOk(
    "approveTeamPlan",
    await hub.approveStage(sessionId, {
      ...(payload.permissionMode === undefined ? {} : { permissionMode: payload.permissionMode }),
    }),
  );
  return undefined;
}

/**
 * 「回对话修改」：草案标记等待反馈并取消规划回合（追问面在对话侧），hub 侧映射为
 * stageTeam(同一草案)——staged 再次 stageTeam = 原子更新同一 teamId，不另建 team（spec §10）。
 *
 * 2026-10-21 缺口10 修复：重建草案入参时原样回写 roster.name 与逐成员
 * modelSelection（hub 查询面已补齐这两项回读）——stageTeam 整体替换 members 且经
 * journalStagedFact 持久化，此前不回写会把 team 名与建队时刻定死的路由快照
 * （spec §8.7）静默清空；v1 无生产 stager 携带 modelSelection 时为潜在回归，
 * UI staged 编辑器展示路由标签后即成真回归。决策记录见 specs/agents-team.md §8.7。
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
      ...(roster.name === undefined ? {} : { name: roster.name }),
      draftMembers: roster.members.map((member) => ({
        memberName: member.memberName,
        // §19 契约 2：透传 optional profile（缺省即键缺席），不再 `?? ""`——空白与
        // 缺席由 hub.stageTeam 落库归一兜住，空串落库会破 wire min(1) 烧帧。
        profile: member.profile,
        ...(member.modelSelection === undefined ? {} : { modelSelection: member.modelSelection }),
      })),
      draftTasks: board.tasks.map((task) => ({
        // 2026-10-21 缺口5（spec §14）：回传原 taskId——stageTeam 身份保持后
        // dependsOn 引用不悬空（不传则全部换新 ID，DAG 被静默摧毁）。
        taskId: task.taskId,
        title: task.title,
        spec: {
          goal: task.spec.goal,
          acceptance: [...task.spec.acceptance],
          ...(task.spec.outputFormat === undefined ? {} : { outputFormat: task.spec.outputFormat }),
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

/**
 * 成员改名（缺口10 实现，spec §2.4 名字重定向防护的草案期基线）。
 *
 * 修复依据：本 handler 此前是 v1 stub（固定抛 V4TeamUnsupportedError），但 spec §6.3
 * 已把 setTeamMemberName 列入用户面命令、shared wire schema（TEAM_COMMAND_PAYLOAD_
 * SCHEMAS）与 UI（team/commands.ts setTeamMemberName + staged 编辑器改名入口）两侧
 * 齐备，命令链只差内核消费。实读 hub 能力：TeamHub 无 rename 端口、TeamMemberInternal
 * 无 displayName 字段（memberName 即联接键），spawn 后改名属内核改名端口（M3+，归
 * core/src/team 面）；既有 hub 查询面支持的改名窗口只有 staged 草案——与 reviseTeamPlan
 * 同一机制：以 snapshot/board 重建草案并 stageTeam 原子更新同一 teamId（staged 再次
 * stageTeam = 原子更新，不另建 team，spec §10），改名成员的任务 assignee 同批重定向
 * （否则草案校验 draft_unknown_assignee 拒绝，hub.ts E13/E14）。journal 的 staged
 * 事实随 stageTeam 落盘（改名事实即草案更新事实，恢复语义与 revise 一致）。
 *
 * 已知边界（仍登记）：非 staged 态（已 spawn）明确拒绝——team_not_present 文案即
 * 「无 staged 草案可改名」，不静默降级；spawn 后改名待内核改名端口（M3+）。
 * 2026-10-21 缺口10 修复：重建草案时原样回写 roster.name 与逐成员 modelSelection
 * （与 reviseTeamPlan 同款；hub 查询面已补齐回读，stageTeam 整体替换 + journal
 * 持久化不再静默清空路由快照与 team 名）。决策记录见 specs/agents-team.md §8.7。
 */
async function setTeamMemberName(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const { hub, sessionId } = requireTeamHub(host, envelope);
  const payload = envelope.payload as CommandPayloadMap["setTeamMemberName"];
  const roster = hub.snapshot();
  const board = hub.board();
  if (roster === undefined || board === undefined || roster.status !== "staged") {
    throw new V4TeamRejectedError(
      "team_not_present",
      "setTeamMemberName requires a staged draft in this session (renaming spawned members arrives with the hub rename port).",
    );
  }
  if (!roster.members.some((member) => member.memberName === payload.memberName)) {
    // 与 hub.removeMember 的「不在册」语义同码（member_removed），不另造错误码。
    throw new V4TeamRejectedError(
      "member_removed",
      `setTeamMemberName: member '${payload.memberName}' is not in the staged draft.`,
    );
  }
  assertMutationOk(
    "setTeamMemberName",
    hub.stageTeam(sessionId, {
      ...(roster.name === undefined ? {} : { name: roster.name }),
      draftMembers: roster.members.map((member) => ({
        memberName: member.memberName === payload.memberName ? payload.newName : member.memberName,
        // §19 契约 2：透传 optional profile（缺省即键缺席），不再 `?? ""`——
        // 同 reviseTeamPlan，空串落库会破 wire min(1) 烧帧。
        profile: member.profile,
        ...(member.modelSelection === undefined ? {} : { modelSelection: member.modelSelection }),
      })),
      draftTasks: board.tasks.map((task) => ({
        // 2026-10-21 缺口5（spec §14）：回传原 taskId（同 reviseTeamPlan——身份保持，
        // dependsOn 引用不悬空）。
        taskId: task.taskId,
        title: task.title,
        spec: {
          goal: task.spec.goal,
          acceptance: [...task.spec.acceptance],
          ...(task.spec.outputFormat === undefined ? {} : { outputFormat: task.spec.outputFormat }),
        },
        ...(task.assignee === undefined
          ? {}
          : { assignee: task.assignee === payload.memberName ? payload.newName : task.assignee }),
        dependsOn: [...task.dependsOn],
      })),
    }),
  );
  return undefined;
}

export const teamHandlers = {
  [TEAM_HISTORY_QUERY]: async (
    host: V4CommandCoreHost,
    envelope: CommandEnvelope,
  ): Promise<CommandResult> => {
    const { hub, sessionId } = requireTeamHub(host, envelope);
    const query = envelope.payload as CommandPayloadMap[typeof TEAM_HISTORY_QUERY];
    if (hub.teamId !== query.teamId)
      throw new V4TeamRejectedError(
        "historyTeamMismatch",
        "Team history belongs to a different team",
      );
    const read = getInstalledTeamHistoryReader(sessionId);
    if (!read)
      throw Object.assign(new Error("Team history is unavailable"), {
        reasonCode: TEAM_HISTORY_UNAVAILABLE,
      });
    return read(query);
  },
  approveTeamPlan,
  reviseTeamPlan,
  abandonTeamPlan,
  sendTeamMessage,
  stopTeamMember,
  haltTeam,
  resumeTeam,
  setTeamMemberName,
};
