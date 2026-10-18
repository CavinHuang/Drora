import { describe, expect, it } from "vitest";
import {
  appendToMailbox,
  discardStaleMail,
  isCurrentMail,
  mailboxTail,
  markDelivered,
  pendingMail,
  validateMessageSize,
} from "../../src/team/mailbox.js";
import { TEAM_KERNEL_LIMITS, type TeamMailboxEntry, type TeamTaskInternal } from "../../src/team/types.js";

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
    const stale = entry({ sourceTaskId: "task_1", sourceAttemptId: "att_OLD", sourceTaskStatus: "in_progress" });
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
    expect(isCurrentMail([task({ attemptId: "att_DONE", status: "failed" })], mismatched)).toBe(false);
  });

  it("task-targeted mail dies when the target task rotates assignee or leaves in-flight", () => {
    const targeted = entry({ to: "bob", targetTaskId: "task_1", targetAttemptId: "att_A" });
    expect(isCurrentMail([task({ assignee: "bob" })], targeted)).toBe(true);

    // 转派给他人 → 过时
    expect(isCurrentMail([task({ assignee: "carol" })], targeted)).toBe(false);
    // 进入终态 → 过时
    expect(isCurrentMail([task({ status: "completed", attemptId: undefined })], targeted)).toBe(false);
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
    expect(pendingMail(mailbox, tasks, "bob")).toHaveLength(1);

    const acked = markDelivered(mailbox, [undelivered.messageId], "steered", "2026-10-17T01:00:00.000Z");
    expect(acked[0]?.deliveredAccepted).toBe(true);
    expect(acked[0]?.deliveredVia).toBe("steered");
    expect(pendingMail(acked, tasks, "bob")).toHaveLength(0);
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
