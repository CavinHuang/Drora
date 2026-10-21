import type { TeamMailboxEntry } from "./types.js";
import { TEAM_KERNEL_LIMITS } from "./types.js";
import type { TeamTaskInternal } from "./types.js";

/**
 * 团队邮箱纯内核（spec §2.3 TeamMailbox + §16.3 通信协议）。
 * 不变量：写成功（持久化）才算发送成功——持久化在 hub/journal 层，这里维护
 * 世代过滤与投递状态机的纯语义。
 */

export function validateMessageSize(
  message: string,
  limit = TEAM_KERNEL_LIMITS.messageMaxChars,
): boolean {
  return message.length <= limit;
}

/** 每成员保留上限（spec §3.3.5 retention；超出丢最旧）。 */
export function appendToMailbox(
  mailbox: TeamMailboxEntry[],
  entry: TeamMailboxEntry,
  retentionPerMember = TEAM_KERNEL_LIMITS.mailboxRetentionPerMember,
): TeamMailboxEntry[] {
  const next = [...mailbox, entry];
  return trimMailbox(next, entry.to, retentionPerMember);
}

export function trimMailbox(
  mailbox: readonly TeamMailboxEntry[],
  recipient: string,
  retentionPerMember: number,
): TeamMailboxEntry[] {
  const forRecipient = mailbox.filter((entry) => entry.to === recipient);
  if (forRecipient.length <= retentionPerMember) return [...mailbox];
  const evicted = new Set(
    forRecipient.slice(0, forRecipient.length - retentionPerMember).map((entry) => entry.messageId),
  );
  return mailbox.filter((entry) => !evicted.has(entry.messageId));
}

/**
 * 世代过滤（isCurrentMail 语义，spec §16.3）：attempt 轮换后旧工作者的报告在
 * 准入/读取/兜底三条路径上都被自动废弃。
 * - 报告世代（第一谓词）：源任务仍处于该 attempt 且仍指派给发送者（终态宽容：
 *   携带的终态与任务当前终态一致时仍算当前——报告先于状态可见的竞态窗口）。
 * - 任务定向世代（第二谓词）：目标任务仍处于投递时快照的 attempt、仍指派给
 *   收件者且未终态。
 */
export function isCurrentMail(
  tasks: readonly TeamTaskInternal[],
  entry: TeamMailboxEntry,
): boolean {
  if (entry.sourceAttemptId !== undefined) {
    const source = tasks.find((task) => task.taskId === entry.sourceTaskId);
    const sourceCurrent =
      source !== undefined &&
      source.attemptId === entry.sourceAttemptId &&
      source.assignee === entry.from &&
      (entry.sourceTaskStatus === undefined ||
        source.status === entry.sourceTaskStatus ||
        !(source.status === "completed" || source.status === "failed" || source.status === "cancelled"));
    if (!sourceCurrent) return false;
  }
  if (entry.targetAttemptId !== undefined) {
    const target = tasks.find((task) => task.taskId === entry.targetTaskId);
    return (
      target !== undefined &&
      target.attemptId === entry.targetAttemptId &&
      target.assignee === entry.to &&
      (target.status === "claimed" || target.status === "in_progress")
    );
  }
  return true;
}

/** 尾窗投影（mailboxTail；完整消息在 journal/成员下钻）。 */
export function mailboxTail(
  mailbox: readonly TeamMailboxEntry[],
  window = TEAM_KERNEL_LIMITS.mailboxTailWindow,
): readonly TeamMailboxEntry[] {
  return mailbox.slice(Math.max(0, mailbox.length - window));
}

/** 未读（未注入）且世代当前的待投递集合。 */
export function pendingMail(
  mailbox: readonly TeamMailboxEntry[],
  tasks: readonly TeamTaskInternal[],
  recipient: string,
): TeamMailboxEntry[] {
  return mailbox.filter(
    (entry) =>
      entry.to === recipient &&
      entry.deliveredAccepted === false &&
      isCurrentMail(tasks, entry),
  );
}

/**
 * 注入被接受后才标记送达（ack 只认注入，spec §16.3）；
 * 失败释放投递权留待重试由调用方不写 deliveredAt 表达。
 * lead_injected（2026-10-21 缺口12）：lead 邮箱经 enqueueSubagentMessage 通道注入
 * （spec §14）——enqueue 即接受，与成员 steer/resumed 的同步注入同表登记。
 */
export function markDelivered(
  mailbox: TeamMailboxEntry[],
  messageIds: readonly string[],
  via: "steered" | "resumed" | "lead_injected",
  at: string,
): TeamMailboxEntry[] {
  const ids = new Set(messageIds);
  return mailbox.map((entry) =>
    ids.has(entry.messageId)
      ? { ...entry, deliveredAt: at, deliveredVia: via, deliveredAccepted: true }
      : entry,
  );
}

/** 废弃世代过时邮件（读取路径的清理语义；幂等）。 */
export function discardStaleMail(
  mailbox: readonly TeamMailboxEntry[],
  tasks: readonly TeamTaskInternal[],
): { mailbox: TeamMailboxEntry[]; discardedIds: string[] } {
  const discardedIds: string[] = [];
  const next = mailbox.filter((entry) => {
    if (entry.deliveredAccepted) return true;
    if (isCurrentMail(tasks, entry)) return true;
    discardedIds.push(entry.messageId);
    return false;
  });
  return { mailbox: next, discardedIds };
}
