import { formatIncomingMessage } from "../system-reminder/incoming-message.js";
// §21 A7（2026-10-24）：lead 寻址键改引 types.ts 的 LEAD_ASSIGNEE_KEY 再导出
//（= shared TEAM_LEAD_ASSIGNEE 单一出处）——原两处手写 "lead" 字面量在寻址键改动
// 时会静默漂移（把 lead 显示成 "member lead"）。
import { LEAD_ASSIGNEE_KEY, type TeamMailboxEntry } from "./types.js";

/**
 * 成员消息体格式化（spec §7 / §16.3；v2 接缝替代——禁令文本经**导出的**
 * formatIncomingMessage 渲染，单一出处天然保持，incoming-message.ts 零编辑）。
 *
 * 双路承载（spec §7 表）：
 * - 运行中成员（steer）：选用现有枚举值 subagent_reply_steer，注入时由 runtime
 *   的 formatIncomingMessage 渲染（禁令 + 回复指引自动附加）——本模块只声明
 *   presentation，不预格式化，避免双包装；
 * - 终态复活成员：runner 复活链以裸 body 为 prompt，本模块**预格式化**
 *   （formatIncomingMessage(body, "subagent_reply")），禁令随消息体自嵌。
 */

/** 运行中成员注入用的 presentation 值（RuntimeInputPresentation 现有枚举，零加值）。 */
export const MEMBER_STEER_PRESENTATION = "subagent_reply_steer" as const;

/** 团队消息头：报告溯源（spec §16.3 结构化溯源行）。 */
export function sourceProvenanceHeader(
  entry: Pick<TeamMailboxEntry, "sourceTaskId" | "sourceAttemptId" | "sourceTaskStatus">,
): string {
  if (entry.sourceTaskId === undefined) return "";
  return `[Source task ${entry.sourceTaskId}, attempt_id ${entry.sourceAttemptId ?? "n/a"}${entry.sourceTaskStatus === undefined ? "" : `, status=${entry.sourceTaskStatus}`}]\n`;
}

/** 终态复活消息体：团队头 + 溯源 + 正文，经 formatIncomingMessage 渲染禁令。 */
export function buildRevivalBody(
  entry: TeamMailboxEntry,
  context: { teamId: string; teamName?: string },
): string {
  const teamHeader =
    context.teamName === undefined
      ? `[Agents Team ${context.teamId}] `
      : `[Agents Team ${context.teamId} · ${context.teamName}] `;
  const from = entry.from === LEAD_ASSIGNEE_KEY ? "the team lead" : `member ${entry.from}`;
  const raw = `${teamHeader}Message from ${from}:\n\n${sourceProvenanceHeader(entry)}${entry.message}`;
  // "subagent_reply" 渲染 = "Another Drora session sent a message:" + PEER_PERMISSION_GUIDANCE（零授权禁令）。
  return formatIncomingMessage(raw, "subagent_reply");
}

/**
 * 运行中成员注入载荷（spec §7 / §14 缺口8）：presentation 的唯一消费方是
 * team 自有 message sink（member-sink.ts 经 MEMBER_STEER_PRESENTATION 注入，
 * 2026-10-21 起不再复用硬编码 coordinator_steer 的通用 sink）；本模块只组正文，
 * 渲染（禁令 + 回信指引）由 runtime 的 formatIncomingMessage 统一做。
 */
export function buildSteerBody(entry: TeamMailboxEntry): string {
  const from = entry.from === LEAD_ASSIGNEE_KEY ? "the team lead" : `member ${entry.from}`;
  const provenance =
    entry.targetTaskId === undefined
      ? ""
      : `\n\n(Context: task ${entry.targetTaskId}, attempt_id ${entry.targetAttemptId ?? "n/a"})`;
  return `Message from ${from}:${provenance}\n\n${entry.message}`;
}

/**
 * 终态汇报指令邮件（specs/agents-team.md §22 契约 3，2026-10-26）：团队到达终态时
 * hub 发给 manager——指示其写恰好一条最终汇报发给 lead（收件人写 lead），涵盖成败、
 * 各任务终态与产物指引；此后不得再向 lead 发任何消息。
 */
export function buildFinalReportRequestBody(record: {
  tasks: readonly { title: string; status: string; artifactRefs: readonly string[] }[];
}): string {
  const taskLines = record.tasks
    .map((task) => `- ${task.title}: ${task.status}${task.artifactRefs.length > 0 ? ` (artifacts: ${task.artifactRefs.join(", ")})` : ""}`)
    .join("\n");
  return [
    "All team tasks and members have reached terminal states.",
    "Write ONE final report and send it to the lead (to=lead) now:",
    "overall success or failure, each task's outcome, key deliverables or artifacts, and any follow-up the user should know.",
    "This is the only message you may ever send to the lead — after it, do not message the lead again.",
    "",
    "Task outcomes:",
    taskLines,
  ].join("\n");
}
