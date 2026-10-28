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
 * - 报告世代（第一谓词）：attemptId 相等先行——源任务仍处于该 attempt 且仍指派给
 *   发送者。任务终态时板上 attemptId 已随终态清空（applyTaskUpdate 终态分支），
 *   等值必假、整链为 false——后置的「终态宽容」子句在终态场景因此**不可达**（2026-10-23
 *   补审计订正：旧头注宣称宽容子句令终态报告「仍算当前」，与 && 链求值顺序矛盾）。
 *   终态源报告由 portSend 入箱侧剥离 sourceAttemptId（spec §20 契约 1）按无绑定
 *   邮件投递，不依赖该子句。
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
      // 「终态宽容」子句（spec §20 契约 1 处置裁决：保留并注明，不删是最小 diff）。
      // 求值顺序上位于 attemptId 相等之后，而任务终态时板上 attemptId 已清空、等值
      // 必假——本子句在终态场景不可达（头注同此订正）。首分支
      // `entry.sourceTaskStatus === undefined` 对模型报告条目是 load-bearing：
      // TeamSendInputSchema 无 source_task_status 键（team-tools.ts），模型报告该键
      // 恒 undefined、整组对模型报告恒真；携带 sourceTaskStatus 的内部条目现仅
      // 契约 1 失败通知路径（hub.ts enqueueLeadFailureNotice 三键齐写，其入箱
      // 先于置 failed、凭证在场当次投递，等值仍真）。
      (entry.sourceTaskStatus === undefined ||
        source.status === entry.sourceTaskStatus ||
        !(
          source.status === "completed" ||
          source.status === "failed" ||
          source.status === "cancelled"
        ));
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

/**
 * 内容级幂等去重谓词（spec §16 契约 4，dsh「identical report retries reuse one
 * durable message」补1/补6）：候选与既有条目 from/to/message 逐字相同、source
 * 三元组（sourceTaskId/sourceAttemptId/sourceTaskStatus）与 target 双键
 * （targetTaskId/targetAttemptId——spec §20 契约 2，2026-10-23 补审计增补）相同、
 * 且旧条目仍 isCurrentMail → 命中并返回既有条目（多条命中取最新一条——复用最新
 * 持久消息）。
 * target 双键是必比维度：targetAttemptId 是每次发送对板上任务 attempt 的投递时
 * 快照（hub portSend 构造 entry 时独立快照），换目标任务或旧条目未投递期间任务
 * 换代后快照值天然不同——不比较会让同文不同定向被旧条目吞并（命中返回旧
 * messageId，新目标任务定向静默丢失）。undefined === undefined 同规：双方均无
 * target 定向的邮件行为零变化；同任务同 attempt 的重发快照同值仍归并（幂等意图
 * 保留，dsh 补1 同报告重试复用同一条持久消息）。
 * 不对称语义照 dsh 补1：任务绑定报告（sourceAttemptId 有值）无论旧条目是否已投递
 * 都去重（同报告重试复用同一条持久消息）；未绑定任务的普通引导仅旧条目未投递时
 * 去重——已投递后重发允许新条目（有意重复提醒通道保留）。逐字比较对措辞变化不
 * 敏感是设计取向（dsh 同款）：不引入 content-hash/dedup key，避免 wire 与内部态
 * 双词汇（spec §16 契约 4「不做」、§20 契约 2「不做」）。
 */
export function findDuplicateMail(
  mailbox: readonly TeamMailboxEntry[],
  candidate: TeamMailboxEntry,
  tasks: readonly TeamTaskInternal[],
): TeamMailboxEntry | undefined {
  return mailbox.findLast(
    (existing) =>
      existing.from === candidate.from &&
      existing.to === candidate.to &&
      existing.message === candidate.message &&
      existing.sourceTaskId === candidate.sourceTaskId &&
      existing.sourceAttemptId === candidate.sourceAttemptId &&
      existing.sourceTaskStatus === candidate.sourceTaskStatus &&
      // target 双键直比（spec §20 契约 2）：缺键双方同为 undefined 视为相同
      // （无定向邮件零变化）；任一不同即不归并，由调用方追加新条目。
      existing.targetTaskId === candidate.targetTaskId &&
      existing.targetAttemptId === candidate.targetAttemptId &&
      isCurrentMail(tasks, existing) &&
      (candidate.sourceAttemptId !== undefined || existing.deliveredAccepted === false),
  );
}

/** 尾窗投影（mailboxTail；完整消息在 journal/成员下钻）。 */
export function mailboxTail(
  mailbox: readonly TeamMailboxEntry[],
  window = TEAM_KERNEL_LIMITS.mailboxTailWindow,
): readonly TeamMailboxEntry[] {
  return mailbox.slice(Math.max(0, mailbox.length - window));
}

/**
 * 投递租约活跃判定（spec §16 契约 3，dsh「投递 claim 互斥 + 60s 崩溃租约」）：
 * 无盖戳 = 不活跃（放行）；盖戳与 now 按墙钟差比较（时钟经 BoardClock 注入，
 * fake clock 推进超租约即可测重投）；时间不可解析视为不活跃（防脏数据永久卡件）。
 * 挂起中的 dispatch 不主动续租，到期自然失效。
 */
export function isDeliveryLeaseActive(
  entry: TeamMailboxEntry,
  now: string,
  leaseMs: number,
): boolean {
  if (entry.deliveryClaimedAt === undefined) return false;
  const claimedAt = Date.parse(entry.deliveryClaimedAt);
  const at = Date.parse(now);
  if (Number.isNaN(claimedAt) || Number.isNaN(at)) return false;
  return at - claimedAt < leaseMs;
}

/** 盖投递租约（spec §16 契约 3）：投递路径发起 dispatch 前同步领取（clock.now()）。 */
export function claimDeliveryLease(
  mailbox: readonly TeamMailboxEntry[],
  messageIds: readonly string[],
  at: string,
): TeamMailboxEntry[] {
  const ids = new Set(messageIds);
  return mailbox.map((entry) =>
    ids.has(entry.messageId) ? { ...entry, deliveryClaimedAt: at } : entry,
  );
}

/**
 * 释放投递租约（dispatch 拒绝或抛错 → 释放，下一投递边缘重投恰一次，spec §16 契约 3）。
 * ownerClaimedAt 给出时仅当盖戳仍是本次所盖才清除——防慢投递超租约后的迟到释放
 * 误删其他路径盖下的新租约（否则会开出第三个重投窗口）；缺省时无条件清除。
 */
export function releaseDeliveryLease(
  mailbox: readonly TeamMailboxEntry[],
  messageIds: readonly string[],
  ownerClaimedAt?: string,
): TeamMailboxEntry[] {
  const ids = new Set(messageIds);
  return mailbox.map((entry) => {
    if (!ids.has(entry.messageId)) return entry;
    if (entry.deliveryClaimedAt === undefined) return entry;
    if (ownerClaimedAt !== undefined && entry.deliveryClaimedAt !== ownerClaimedAt) return entry;
    const { deliveryClaimedAt: _releasedClaim, ...rest } = entry;
    return rest;
  });
}

/**
 * 未读（未注入）、世代当前且未被有效投递租约持有的待投递集合。
 * 租约过滤（spec §16 契约 3）：claim 未过期的条目已被某条投递路径领取，跳过——
 * 消除 routeMail 即时投递（fire-and-forget）×kickTeam/终态边缘 再捡同一批的双投窗口。
 */
export function pendingMail(
  mailbox: readonly TeamMailboxEntry[],
  tasks: readonly TeamTaskInternal[],
  recipient: string,
  lease: { now: string; leaseMs: number },
): TeamMailboxEntry[] {
  return mailbox.filter(
    (entry) =>
      entry.to === recipient &&
      entry.deliveredAccepted === false &&
      isCurrentMail(tasks, entry) &&
      !isDeliveryLeaseActive(entry, lease.now, lease.leaseMs),
  );
}

/**
 * 注入被接受后才标记送达（ack 只认注入，spec §16.3）；
 * 失败释放投递权留待重试由调用方不写 deliveredAt 表达。
 * 送达事实覆盖投递租约（spec §16 契约 3）：deliveredAccepted=true 后 claim 无语义，
 * 清除盖戳保持条目形态单一（退出 pending 集由 deliveredAccepted 主导）。
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
  return mailbox.map((entry) => {
    if (!ids.has(entry.messageId)) return entry;
    const { deliveryClaimedAt: _coveredClaim, ...rest } = entry;
    return { ...rest, deliveredAt: at, deliveredVia: via, deliveredAccepted: true };
  });
}

/** 废弃世代过时邮件（读取路径的清理语义；幂等）。 */
export function discardStaleMail(
  mailbox: TeamMailboxEntry[],
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

/**
 * 按 messageId 移除邮箱条目（§21 A1，2026-10-24 登记）：lead 邮箱投递通道判定
 * 「永久不可投」（发件人离册/childSessionId 缺席——任何重投边缘都不可能成功）的
 * skipped 条目由此丢弃，动作与 discardStaleMail 的清除同族（条目退出 pendingMail
 * 选取集，重投边缘不再捡起）。幂等：不存在的 messageId 零副作用。journal 重放
 * message_dropped 事实走同一函数（重放多次终态一致）。
 */
export function dropMailEntries(
  mailbox: readonly TeamMailboxEntry[],
  messageIds: readonly string[],
): TeamMailboxEntry[] {
  const ids = new Set(messageIds);
  return mailbox.filter((entry) => !ids.has(entry.messageId));
}

/** reconcilePersistedMailEntries 的结果计数（appended = 补入条数，merged = 既有条目形态被更新数）。 */
export interface ReconcilePersistedMailResult {
  mailbox: TeamMailboxEntry[];
  appended: number;
  merged: number;
}

/**
 * 冷恢复对账合并（§21 A13 B 案裁决，2026-10-24）：journal 重放邮箱 × 持久化
 * team.mailbox 条目按 messageId 并集——两源谁多都不丢。
 * - journal 已见（appendedMessageIds 含该 messageId，含其后 delivered/dropped 的）
 *   → 跳过补入：dropped 死件与保留期裁掉的条目经此**不复活**（它们是 hub 运行态
 *   裁决的结果，非刷盘丢失）；仍在邮箱的做 delivered 并集——持久化条目带
 *   delivered 而重放侧未 delivered 时采用持久化侧（两源较新者为准；反向保留
 *   重放侧的 message_delivered 事实形态），字段主体以重放侧为准（journal 是更
 *   完整的时序视图）。
 * - journal 未见 → 补入（半持久窗口：邮箱条目已持久化、journal 事实未刷），
 *   走 appendToMailbox 的每收件人保留期裁剪（与重放/运行态同源，缺口12 同款）。
 * - 语义边界（spec 如实登记）：「两侧都未刷」的尾部丢失不在对账可恢复面内。
 */
export function reconcilePersistedMailEntries(
  mailbox: readonly TeamMailboxEntry[],
  appendedMessageIds: ReadonlySet<string>,
  persisted: readonly TeamMailboxEntry[],
  retentionPerMember = TEAM_KERNEL_LIMITS.mailboxRetentionPerMember,
): ReconcilePersistedMailResult {
  let next = [...mailbox];
  let appended = 0;
  let merged = 0;
  for (const entry of persisted) {
    if (!appendedMessageIds.has(entry.messageId)) {
      next = appendToMailbox(next, entry, retentionPerMember);
      appended += 1;
      continue;
    }
    if (entry.deliveredAccepted !== true) continue; // 无 delivered 半边可并：保留重放侧形态
    const index = next.findIndex((row) => row.messageId === entry.messageId);
    if (index < 0) continue; // 已被 dropped/裁剪清出邮箱：不复活
    const existing = next[index];
    if (existing.deliveredAccepted) continue; // 重放侧已有 delivered 事实：保留
    const { deliveryClaimedAt: _coveredClaim, ...rest } = existing;
    next[index] = {
      ...rest,
      deliveredAt: entry.deliveredAt,
      ...(entry.deliveredVia === undefined ? {} : { deliveredVia: entry.deliveredVia }),
      deliveredAccepted: true,
    };
    merged += 1;
  }
  return { mailbox: next, appended, merged };
}

/** 原子替换单条邮箱条目（§22 契约 2：路由改投时保序替换；id 缺席不动）。 */
export function replaceMailEntry(
  mailbox: readonly TeamMailboxEntry[],
  next: TeamMailboxEntry,
): TeamMailboxEntry[] {
  const index = mailbox.findIndex((entry) => entry.messageId === next.messageId);
  if (index < 0) return [...mailbox];
  const copy = [...mailbox];
  copy[index] = next;
  return copy;
}
