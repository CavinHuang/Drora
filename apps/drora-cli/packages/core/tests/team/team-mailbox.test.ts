import { describe, expect, it } from "vitest";
import {
  appendToMailbox,
  claimDeliveryLease,
  discardStaleMail,
  findDuplicateMail,
  isCurrentMail,
  isDeliveryLeaseActive,
  mailboxTail,
  markDelivered,
  pendingMail,
  reconcilePersistedMailEntries,
  releaseDeliveryLease,
  validateMessageSize,
} from "../../src/team/mailbox.js";
import {
  TEAM_KERNEL_LIMITS,
  type TeamMailboxEntry,
  type TeamTaskInternal,
} from "../../src/team/types.js";

let sequence = 0;
function entry(overrides: Partial<TeamMailboxEntry> = {}): TeamMailboxEntry {
  sequence += 1;
  return {
    messageId: `msg_${String(sequence).padStart(3, "0")}`,
    from: "alice",
    to: "bob",
    message: `m${sequence}`,
    at: "2026-10-17T00:00:00.000Z",
    deliveredAccepted: false,
    ...overrides,
  };
}

function task(overrides: Partial<TeamTaskInternal> = {}): TeamTaskInternal {
  return {
    taskId: "task_1",
    title: "t",
    spec: { goal: "g", acceptance: [] },
    status: "in_progress",
    assignee: "alice",
    attempt: 1,
    attemptId: "att_A",
    reassigning: false,
    dependsOn: [],
    artifactRefs: [],
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("mailbox generation filter (isCurrentMail)", () => {
  it("keeps a report while its source attempt still owns the task", () => {
    const tasks = [task()];
    const mail = entry({ sourceTaskId: "task_1", sourceAttemptId: "att_A" });
    expect(isCurrentMail(tasks, mail)).toBe(true);
  });

  it("discards stale reports after reassignment rotates the attempt", () => {
    // 旧 attempt 的报告
    const stale = entry({
      sourceTaskId: "task_1",
      sourceAttemptId: "att_OLD",
      sourceTaskStatus: "in_progress",
    });
    // 新世代在飞
    const tasks = [task({ attemptId: "att_NEW", attempt: 2 })];
    expect(isCurrentMail(tasks, stale)).toBe(false);

    // 终态宽容窗口：报告携带的终态与任务当前终态一致 → 仍当前
    const terminalMatch = entry({
      sourceTaskId: "task_1",
      sourceAttemptId: "att_DONE",
      sourceTaskStatus: "completed",
    });
    const done = task({ attemptId: "att_DONE", status: "completed" });
    expect(isCurrentMail([done], terminalMatch)).toBe(true);

    // 终态不一致（声称 completed 实为 failed）→ 过时
    const mismatched = entry({
      sourceTaskId: "task_1",
      sourceAttemptId: "att_DONE",
      sourceTaskStatus: "completed",
    });
    expect(isCurrentMail([task({ attemptId: "att_DONE", status: "failed" })], mismatched)).toBe(
      false,
    );
  });

  it("task-targeted mail dies when the target task rotates assignee or leaves in-flight", () => {
    const targeted = entry({ to: "bob", targetTaskId: "task_1", targetAttemptId: "att_A" });
    expect(isCurrentMail([task({ assignee: "bob" })], targeted)).toBe(true);

    // 转派给他人 → 过时
    expect(isCurrentMail([task({ assignee: "carol" })], targeted)).toBe(false);
    // 进入终态 → 过时
    expect(isCurrentMail([task({ status: "completed", attemptId: undefined })], targeted)).toBe(
      false,
    );
    // attempt 轮换 → 过时
    expect(isCurrentMail([task({ attemptId: "att_B" })], targeted)).toBe(false);
  });

  it("plain mail without attempt generations is always current", () => {
    expect(isCurrentMail([], entry())).toBe(true);
  });
});

describe("mailbox retention, tail, delivery semantics", () => {
  it("burst ×42 keeps order and retention per member (oldest dropped)", () => {
    let mailbox: TeamMailboxEntry[] = [];
    for (let i = 0; i < 42; i += 1) {
      mailbox = appendToMailbox(mailbox, entry({ to: "bob", message: `burst_${i}` }));
    }
    const bobMail = mailbox.filter((m) => m.to === "bob");
    expect(bobMail).toHaveLength(TEAM_KERNEL_LIMITS.mailboxRetentionPerMember);
    expect(bobMail[0]?.message).toBe("burst_22");
    expect(bobMail[bobMail.length - 1]?.message).toBe("burst_41");
    // 其他成员不受影响裁剪
    expect(mailbox.some((m) => m.to === "carol")).toBe(false);
  });

  it("rejects oversize messages and projects a bounded tail window", () => {
    expect(validateMessageSize("x".repeat(TEAM_KERNEL_LIMITS.messageMaxChars))).toBe(true);
    expect(validateMessageSize("x".repeat(TEAM_KERNEL_LIMITS.messageMaxChars + 1))).toBe(false);

    const mailbox: TeamMailboxEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      mailbox.push(entry({ to: "bob", message: `tail_${i}` }));
    }
    const tail = mailboxTail(mailbox);
    expect(tail).toHaveLength(TEAM_KERNEL_LIMITS.mailboxTailWindow);
    expect(tail[0]?.message).toBe("tail_20");
  });

  it("ack only on admission: pending excludes delivered, markDelivered is explicit", () => {
    const tasks = [task()];
    const undelivered = entry({ to: "bob" });
    const mailbox = [undelivered];
    const lease = { now: "2026-10-17T00:00:00.000Z", leaseMs: TEAM_KERNEL_LIMITS.deliveryLeaseMs };
    expect(pendingMail(mailbox, tasks, "bob", lease)).toHaveLength(1);

    const acked = markDelivered(
      mailbox,
      [undelivered.messageId],
      "steered",
      "2026-10-17T01:00:00.000Z",
    );
    expect(acked[0]?.deliveredAccepted).toBe(true);
    expect(acked[0]?.deliveredVia).toBe("steered");
    expect(pendingMail(acked, tasks, "bob", lease)).toHaveLength(0);
  });

  it("discardStaleMail drops only undelivered stale mail, idempotently", () => {
    const freshTasks = [task()];
    const staleTasks = [task({ attemptId: "att_NEW" })];
    const stale = entry({ sourceTaskId: "task_1", sourceAttemptId: "att_OLD" });
    const deliveredStale = entry({
      sourceTaskId: "task_1",
      sourceAttemptId: "att_OLD",
      deliveredAccepted: true,
      deliveredAt: "2026-10-17T01:00:00.000Z",
    });
    const fresh = entry({ to: "bob" });

    const { mailbox, discardedIds } = discardStaleMail([stale, deliveredStale, fresh], staleTasks);
    expect(discardedIds).toEqual([stale.messageId]);
    expect(mailbox.some((m) => m.messageId === deliveredStale.messageId)).toBe(true);
    // 已无过时项可清：幂等
    const again = discardStaleMail(mailbox, freshTasks);
    expect(again.discardedIds).toEqual([]);
  });
});

// ---------- spec §16 契约 3（2026-10-22 登记）：邮箱投递租约（claim/release） ----------

describe("mailbox delivery lease (spec §16 契约 3, dsh 投递 claim 互斥 + 60s 崩溃租约)", () => {
  const T0 = "2026-10-22T00:00:00.000Z";
  const LEASE_MS = TEAM_KERNEL_LIMITS.deliveryLeaseMs;
  const leaseAt = (now: string) => ({ now, leaseMs: LEASE_MS });

  it("pendingMail claim filter: unexpired claims are skipped, expired or absent claims pass", () => {
    const tasks = [task()];
    const mailbox = [
      // 未过期（恰在租约边界内）→ 跳过
      entry({ to: "bob", messageId: "m_hold", deliveryClaimedAt: T0 }),
      // 已过期（盖戳早于 now-60s）→ 放行
      entry({
        to: "bob",
        messageId: "m_expired",
        deliveryClaimedAt: new Date(Date.parse(T0) - LEASE_MS - 1).toISOString(),
      }),
      // 无 claim → 放行
      entry({ to: "bob", messageId: "m_fresh" }),
      // 非收件人（即便持有租约）→ 本就不入集合
      entry({ to: "carol", messageId: "m_other", deliveryClaimedAt: T0 }),
    ];
    const ready = pendingMail(mailbox, tasks, "bob", leaseAt(T0));
    expect(ready.map((row) => row.messageId)).toEqual(["m_expired", "m_fresh"]);
  });

  it("isDeliveryLeaseActive: exact lease boundary expires, unparseable stamps never hold", () => {
    const held = entry({ to: "bob", deliveryClaimedAt: T0 });
    expect(isDeliveryLeaseActive(held, T0, LEASE_MS)).toBe(true);
    // 恰到租约时长 = 过期（< 比较不取等）→ 放行重投
    const boundary = new Date(Date.parse(T0) + LEASE_MS).toISOString();
    expect(isDeliveryLeaseActive(held, boundary, LEASE_MS)).toBe(false);
    // 脏盖戳（不可解析）不永久卡件
    const dirty = entry({ to: "bob", deliveryClaimedAt: "not-a-timestamp" });
    expect(isDeliveryLeaseActive(dirty, T0, LEASE_MS)).toBe(false);
  });

  it("markDelivered overwrites the claim; delivered entries keep no lease stamp", () => {
    const tasks = [task()];
    const held = entry({ to: "bob", deliveryClaimedAt: T0 });
    const acked = markDelivered([held], [held.messageId], "steered", "2026-10-22T00:00:01.000Z");
    expect(acked[0]?.deliveredAccepted).toBe(true);
    expect(acked[0]?.deliveryClaimedAt).toBeUndefined();
    expect(pendingMail(acked, tasks, "bob", leaseAt("2026-10-22T00:00:02.000Z"))).toHaveLength(0);
  });

  it("claim stamps then release restores pickup; owner-mismatched release keeps a newer claim", () => {
    const tasks = [task()];
    // 盖戳 → 租约内跳过；释放 → 放行（dispatch 拒绝后下一边缘可重投）
    let mailbox = claimDeliveryLease(
      [entry({ to: "bob", messageId: "m_release" })],
      ["m_release"],
      T0,
    );
    expect(mailbox[0]?.deliveryClaimedAt).toBe(T0);
    expect(pendingMail(mailbox, tasks, "bob", leaseAt(T0))).toHaveLength(0);
    mailbox = releaseDeliveryLease(mailbox, ["m_release"], T0);
    expect(mailbox[0]?.deliveryClaimedAt).toBeUndefined();
    expect(pendingMail(mailbox, tasks, "bob", leaseAt(T0))).toHaveLength(1);

    // 迟到释放 owner 不符：慢投递超租约后其他路径盖下的新租约不被误删
    const newerClaim = new Date(Date.parse(T0) + LEASE_MS + 1_000).toISOString();
    const recharged = claimDeliveryLease(
      [entry({ to: "bob", messageId: "m_recharge" })],
      ["m_recharge"],
      newerClaim,
    );
    const kept = releaseDeliveryLease(recharged, ["m_recharge"], T0);
    expect(kept[0]?.deliveryClaimedAt).toBe(newerClaim);
    expect(pendingMail(kept, tasks, "bob", leaseAt(newerClaim))).toHaveLength(0);
  });
});

// ---------- spec §16 契约 4（2026-10-22 登记）：TeamSend 内容级幂等去重谓词 ----------

describe("mailbox content-level dedup (spec §16 契约 4, dsh identical-report-retries-reuse-one-durable-message)", () => {
  const currentTasks = [task()]; // task_1 in_progress，att_A，assignee alice

  it("bound report: verbatim text + identical triple dedups whether or not the old entry was delivered", () => {
    // dsh 补1 不对称语义的「绑定」半边：任务绑定报告（sourceAttemptId 有值）
    // 无论旧条目是否已投递都去重——同报告重试复用同一条持久消息。
    const existing = entry({
      to: "lead",
      message: "same report",
      sourceTaskId: "task_1",
      sourceAttemptId: "att_A",
    });
    const candidate = entry({
      to: "lead",
      message: "same report",
      sourceTaskId: "task_1",
      sourceAttemptId: "att_A",
    });
    expect(findDuplicateMail([existing], candidate, currentTasks)?.messageId).toBe(
      existing.messageId,
    );
    expect(
      findDuplicateMail([{ ...existing, deliveredAccepted: true }], candidate, currentTasks)
        ?.messageId,
    ).toBe(existing.messageId);
  });

  it("never dedups on any difference: text, source triple, target keys, sender/recipient, or a stale old entry", () => {
    const existing = entry({
      to: "lead",
      message: "same report",
      sourceTaskId: "task_1",
      sourceAttemptId: "att_A",
    });
    const like = (overrides: Partial<TeamMailboxEntry>): TeamMailboxEntry =>
      entry({ to: "lead", message: "same report", sourceTaskId: "task_1", ...overrides });

    // 措辞不同 → 不命中（逐字比较，dsh 同款设计取向）
    expect(
      findDuplicateMail([existing], like({ message: "same report (retried)" }), currentTasks),
    ).toBeUndefined();
    // source 三元组任一不同 → 不命中
    expect(
      findDuplicateMail([existing], like({ sourceAttemptId: "att_B" }), currentTasks),
    ).toBeUndefined();
    expect(
      findDuplicateMail(
        [existing],
        like({ sourceAttemptId: "att_A", sourceTaskStatus: "in_progress" }),
        currentTasks,
      ),
    ).toBeUndefined();
    // target 双键任一不同 → 不命中（spec §20 契约 2，2026-10-23 补审计：
    // targetAttemptId 是每次发送对板上任务 attempt 的投递时快照，无 target 比较时
    // 同文不同定向被旧条目吞并——T1 旧条目未投递、再发携 T2 命中去重返回旧
    // messageId，T2 定向静默丢失）。未命中 → 调用方追加新条目并返回其新 messageId
    // （hub enqueueMail 未命中分支既有语义）。
    const targeted = entry({
      to: "alice",
      message: "please proceed",
      targetTaskId: "task_1",
      targetAttemptId: "att_A",
    });
    // 换目标任务（T1 → T2）：不归并
    expect(
      findDuplicateMail(
        [targeted],
        entry({
          to: "alice",
          message: "please proceed",
          targetTaskId: "task_2",
          targetAttemptId: "att_T2",
        }),
        currentTasks,
      ),
    ).toBeUndefined();
    // 同目标任务未投递期间换代（投递时快照 att_A → att_B）：不归并
    expect(
      findDuplicateMail(
        [targeted],
        entry({
          to: "alice",
          message: "please proceed",
          targetTaskId: "task_1",
          targetAttemptId: "att_B",
        }),
        currentTasks,
      ),
    ).toBeUndefined();
    // from/to 不同 → 不命中
    expect(
      findDuplicateMail(
        [existing],
        like({ from: "carol", sourceAttemptId: "att_A" }),
        currentTasks,
      ),
    ).toBeUndefined();
    // 旧条目世代过期（isCurrentMail 不再成立）→ 不命中，重发正常追加
    const rotated = [task({ attemptId: "att_NEW", attempt: 2 })];
    expect(
      findDuplicateMail([existing], like({ sourceAttemptId: "att_A" }), rotated),
    ).toBeUndefined();
  });

  it("unbound plain guidance: dedups only while the old entry is undelivered; delivery re-opens the channel", () => {
    // dsh 补1 不对称语义的「未绑定」半边：普通引导仅未投递时去重，
    // 已投递后重发允许新条目（有意重复提醒通道保留）。
    const plain = entry({ to: "bob", message: "please sync" });
    const resend = entry({ to: "bob", message: "please sync" });
    expect(findDuplicateMail([plain], resend, currentTasks)?.messageId).toBe(plain.messageId);
    expect(
      findDuplicateMail([{ ...plain, deliveredAccepted: true }], resend, currentTasks),
    ).toBeUndefined();
  });

  it("target-directed guidance: same task + same attempt snapshot still merges (idempotent intent preserved)", () => {
    // spec §20 契约 2 幂等半边：targetAttemptId 是投递时快照，同任务同 attempt 的
    // 两次同文发送快照同值 → 仍归并复用既有 messageId（幂等重试语义不变，照 dsh
    // 补1「同报告重试复用同一条持久消息」）。
    const first = entry({
      to: "alice",
      message: "please proceed",
      targetTaskId: "task_1",
      targetAttemptId: "att_A",
    });
    const resend = entry({
      to: "alice",
      message: "please proceed",
      targetTaskId: "task_1",
      targetAttemptId: "att_A",
    });
    expect(findDuplicateMail([first], resend, currentTasks)?.messageId).toBe(first.messageId);
  });
});

describe("cold-restore mailbox reconcile (§21 A13 B 案, 2026-10-24)", () => {
  it("journal-unseen persisted entries are appended (half-persisted window recovered into pending set)", () => {
    // 半持久窗口：邮箱条目已持久化（team.mailbox 通道）、journal message_appended
    // 事实未刷——对账补入，恢复后仍在待投（pending）语义（deliveredAccepted=false）。
    const persisted = entry({ messageId: "m_window", to: "lead", message: "half persisted" });
    const result = reconcilePersistedMailEntries([], new Set(), [persisted]);
    expect(result.appended).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.mailbox).toHaveLength(1);
    expect(result.mailbox[0]).toMatchObject({
      messageId: "m_window",
      deliveredAccepted: false,
    });
  });

  it("journal-seen ids are skipped (union idempotent — neither side's surplus is lost or duplicated)", () => {
    // journal 已见（appendedMessageIds 含该 messageId）→ 跳过补入：两源都有的
    // messageId 恰一条（幂等）；journal 有而持久化无的同样不重复。
    const replayed = entry({ messageId: "m_seen" });
    const persistedSameId = entry({ messageId: "m_seen", message: "same id snapshot" });
    const seen = new Set(["m_seen"]);
    let result = reconcilePersistedMailEntries([replayed], seen, [persistedSameId]);
    expect(result.appended).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.mailbox).toHaveLength(1);
    expect(result.mailbox[0].message).toBe(replayed.message); // 字段主体以重放侧为准
    // journal 有、持久化无：邮箱只来自重放侧，零重复。
    result = reconcilePersistedMailEntries([replayed], seen, []);
    expect(result.appended).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.mailbox).toHaveLength(1);
  });

  it("dropped/retention-evicted ids stay gone (journal-seen but absent from mailbox is not revived)", () => {
    // §21 A1 丢弃事实只清 hub 内存态（持久化条目仍在库）：已见但已不在邮箱 =
    // 运行态裁决结果（dropped 或保留期裁掉），对账不得复活。
    const droppedPersisted = entry({ messageId: "m_dropped", to: "lead" });
    const evictedPersisted = entry({ messageId: "m_evicted", to: "lead" });
    const result = reconcilePersistedMailEntries([], new Set(["m_dropped", "m_evicted"]), [
      droppedPersisted,
      evictedPersisted,
    ]);
    expect(result.appended).toBe(0);
    expect(result.mailbox).toHaveLength(0);
  });

  it("delivered takes the union (newer source wins): persisted-delivered flips, replay-delivered stays", () => {
    // 两源较新者为准：持久化条目带 delivered（deliveredAccepted=true）而重放侧
    // 未 delivered → 采用持久化侧（merged，带 deliveredAt/deliveredVia）；反向
    // （重放侧已有 message_delivered 事实）→ 保留重放侧形态（merged=0）。
    const undelivered = entry({ messageId: "m_p_deliv" });
    const deliveredReplay = entry({
      messageId: "m_j_deliv",
      deliveredAccepted: true,
      deliveredAt: "2026-10-24T00:30:00.000Z",
      deliveredVia: "lead_injected",
    });
    const replayMailbox = [undelivered, deliveredReplay];
    const persisted = [
      entry({
        messageId: "m_p_deliv",
        deliveredAccepted: true,
        deliveredAt: "2026-10-24T01:00:00.000Z",
        deliveredVia: "steered",
      }),
      entry({ messageId: "m_j_deliv", deliveredAccepted: false }),
    ];
    const result = reconcilePersistedMailEntries(
      replayMailbox,
      new Set(["m_p_deliv", "m_j_deliv"]),
      persisted,
    );
    expect(result.appended).toBe(0);
    expect(result.merged).toBe(1);
    const flipped = result.mailbox.find((row) => row.messageId === "m_p_deliv");
    expect(flipped).toMatchObject({
      deliveredAccepted: true,
      deliveredAt: "2026-10-24T01:00:00.000Z",
      deliveredVia: "steered",
    });
    expect(flipped?.deliveryClaimedAt).toBeUndefined(); // delivered 覆盖租约盖戳（markDelivered 同款形态）
    const kept = result.mailbox.find((row) => row.messageId === "m_j_deliv");
    expect(kept?.deliveredAccepted).toBe(true);
  });

  it("appended entries go through per-recipient retention trimming (same as replay/runtime)", () => {
    // 缺口12 同款：补入走 appendToMailbox 的每收件人保留期裁剪——重放邮箱与
    // 运行态形状一致，对账补入不例外（超出保留期的最旧补入条目被裁）。
    const retention = TEAM_KERNEL_LIMITS.mailboxRetentionPerMember;
    const persisted: TeamMailboxEntry[] = [];
    for (let index = 0; index < retention + 2; index += 1) {
      persisted.push(entry({ messageId: `m_retention_${index}`, to: "lead" }));
    }
    const result = reconcilePersistedMailEntries([], new Set(), persisted);
    expect(result.appended).toBe(retention + 2);
    expect(result.mailbox).toHaveLength(retention);
    expect(result.mailbox[0].messageId).toBe(`m_retention_2`); // 最旧两条被裁
    expect(result.mailbox.at(-1)?.messageId).toBe(`m_retention_${retention + 1}`);
  });
});
