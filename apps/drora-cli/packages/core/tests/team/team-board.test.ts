import { describe, expect, it } from "vitest";
import type { TeamTaskUpdateInput } from "@drora/contracts";
import {
  TASK_TRANSITIONS,
  applyTaskUpdate,
  beginTaskAttempt,
  cancelUnfinishedTask,
  claimTask,
  collectCompletedDependencyOutputs,
  formatDependencyOutputs,
  invalidateTaskAttempt,
  ownedOpenTask,
  transitionError,
  unsatisfiedDependencies,
  type BoardClock,
} from "../../src/team/board.js";
import { teamPortError } from "../../src/team/errors.js";
import { TEAM_KERNEL_LIMITS, type TeamTaskInternal } from "../../src/team/types.js";

function makeClock(sequence = { n: 0 }): BoardClock {
  return {
    now: () => new Date(Date.UTC(2026, 9, 17, 0, 0, sequence.n++)).toISOString(),
    newId: () => `attempt_${String(sequence.n).padStart(3, "0")}`,
  };
}

function makeTask(overrides: Partial<TeamTaskInternal> = {}): TeamTaskInternal {
  return {
    taskId: "task_1",
    title: "demo",
    spec: { goal: "g", acceptance: ["a1"] },
    status: "pending",
    attempt: 0,
    reassigning: false,
    dependsOn: [],
    artifactRefs: [],
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("team board transitions", () => {
  it("allows only the frozen transition table; terminal has no outgoing edges", () => {
    expect(TASK_TRANSITIONS.pending).toEqual(["claimed", "cancelled"]);
    expect(TASK_TRANSITIONS.claimed).toEqual(["in_progress", "failed", "cancelled"]);
    expect(TASK_TRANSITIONS.in_progress).toEqual(["completed", "failed", "cancelled"]);
    expect(transitionError("claimed", "completed")).toBeDefined();
    expect(transitionError("pending", "in_progress")).toBeDefined();
    expect(transitionError("completed", "pending")).toBeDefined();
    expect(transitionError("claimed", "in_progress")).toBeUndefined();
    expect(transitionError("in_progress", "completed")).toBeUndefined();
    // 终态覆盖 ×40 全拒
    for (let i = 0; i < 40; i += 1) {
      expect(transitionError("failed", "in_progress")).toBeDefined();
    }
  });

  it("dependencies resolve only on upstream completed; failed/cancelled never unlock", () => {
    const upstreamFailed = makeTask({ taskId: "up", status: "failed" });
    const downstream = makeTask({ taskId: "down", dependsOn: ["up"] });
    expect(unsatisfiedDependencies([upstreamFailed, downstream], ["up"])).toEqual(["up"]);

    const upstreamCancelled = makeTask({ taskId: "up", status: "cancelled" });
    expect(unsatisfiedDependencies([upstreamCancelled, downstream], ["up"])).toEqual(["up"]);

    const upstreamDone = makeTask({ taskId: "up", status: "completed" });
    expect(unsatisfiedDependencies([upstreamDone, downstream], ["up"])).toEqual([]);
  });
});

describe("claim three-state adjudication", () => {
  it("serial claims: exactly one winner, second is already_taken", () => {
    const clock = makeClock();
    const tasks = [makeTask()];
    const first = claimTask(tasks, "task_1", "alice", clock);
    expect(first.result).toMatchObject({ status: "claimed", attempt: 1 });
    if (first.result.status !== "claimed") return;
    expect(first.task?.attemptId).toBe(first.result.attemptId);

    // 7 路竞争：串行裁决下其余 6 路全部 already_taken
    for (let i = 0; i < 6; i += 1) {
      const loser = claimTask(tasks, "task_1", `member_${i}`, clock);
      expect(loser.result.status === "already_taken" || loser.result.status === "busy_with_open_task").toBe(true);
    }
  });

  it("dependencies_not_ready carries blockedBy (task-state check precedes claimant-state)", () => {
    const clock = makeClock();
    const upstream = makeTask({ taskId: "up" });
    const downstream = makeTask({ taskId: "down", dependsOn: ["up"] });
    const blocked = claimTask([upstream, downstream], "down", "alice", clock);
    expect(blocked.result).toEqual({ status: "dependencies_not_ready", blockedBy: ["up"] });
  });

  it("busy member cannot claim a second open task even when dependencies are met", () => {
    const clock = makeClock();
    // alice 占住一个开放任务（claimed 未终态）
    const held = makeTask({ taskId: "held" });
    beginTaskAttempt(held, "alice", clock);
    expect(ownedOpenTask([held], "alice")?.taskId).toBe("held");

    const ready = makeTask({ taskId: "down" }); // 无依赖，人人可领
    const busy = claimTask([held, ready], "down", "alice", clock);
    expect(busy.result).toEqual({ status: "busy_with_open_task", currentTaskId: "held" });

    // 另一人可以认领
    const other = claimTask([held, ready], "down", "bob", clock);
    expect(other.result.status).toBe("claimed");
  });

  it("reassigning guard blocks claims until quiescence", () => {
    const clock = makeClock();
    const task = makeTask({ reassigning: true });
    const result = claimTask([task], "task_1", "alice", clock);
    expect(result.result.status).toBe("already_taken");
  });
});

describe("attempt staleness protocol (error copy is the protocol)", () => {
  it("E1 missing attempt_id vs E2 revoked attempt are distinct classifications", () => {
    const clock = makeClock();
    const task = makeTask();
    beginTaskAttempt(task, "alice", clock);

    // E1：任务有在飞凭证而更新缺 attempt_id → 重试本次更新，不要重启工作
    const missing = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: "", patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(missing.error?.code).toBe("missing_attempt_id");
    expect(missing.error?.hint).toContain("Do not restart the work");

    // E2：凭证对不上 → 已被转派，停止工作
    invalidateTaskAttempt(task, "bob", clock);
    const revoked = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: "attempt_001", patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(revoked.error?.code).toBe("attempt_revoked");
    expect(revoked.error?.hint).toContain("Stop working");

    // 转派后 ×50 迟到写入全拒
    for (let i = 0; i < 50; i += 1) {
      const late = applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId: "attempt_001", patch: { status: "in_progress" } },
        "alice",
        clock,
      );
      expect(late.error?.code).toBe("attempt_revoked");
    }
  });

  it("non-owner cannot update a claimed task", () => {
    const clock = makeClock();
    const task = makeTask();
    beginTaskAttempt(task, "alice", clock);
    const result = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: task.attemptId ?? "", patch: { status: "failed" } },
      "mallory",
      clock,
    );
    expect(result.error?.code).toBe("attempt_revoked");
  });

  it("new attempt clears previous evidence (retry must prove itself)", () => {
    const clock = makeClock();
    const task = makeTask({ output: "old evidence" });
    beginTaskAttempt(task, "alice", clock);
    applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: task.attemptId ?? "", patch: { output: "alice result" } },
      "alice",
      clock,
    );
    expect(task.output).toBe("alice result");

    invalidateTaskAttempt(task, "bob", clock);
    expect(task.output).toBeUndefined();
    expect(task.acceptanceSupplement).toBeUndefined();
    expect(task.status).toBe("pending");
    expect(task.attemptId).toBeUndefined();
    expect(task.handoffId).toBeDefined();
  });
});

describe("terminal immutability and signed supplement", () => {
  it("terminal tasks reject status changes but accept append-only supplements", () => {
    const clock = makeClock();
    const task = makeTask({ status: "in_progress", assignee: "alice" });
    beginTaskAttempt(task, "alice", clock);
    const attemptId = task.attemptId ?? "";
    // 迁移表：claimed → in_progress → completed
    const step = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId, patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(step.error).toBeUndefined();
    applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId, patch: { status: "completed" } },
      "alice",
      clock,
    );
    expect(task.status).toBe("completed");
    expect(task.attemptId).toBeUndefined();

    // 终态覆盖 ×40 全拒
    for (let i = 0; i < 40; i += 1) {
      const override = applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId: "", patch: { status: "in_progress" } },
        "alice",
        clock,
      );
      expect(override.error?.code).toBe("invalid_transition");
    }

    // 署名追补：append-only，不改状态，不需重认领
    const supplementInput: TeamTaskUpdateInput = {
      taskId: "task_1",
      attemptId: "",
      patch: {},
      acceptanceSupplement: { acceptanceResults: ["late proof 1"], evidenceNote: "note A" },
    };
    const first = applyTaskUpdate([task], supplementInput, "alice", clock);
    expect(first.error).toBeUndefined();
    const second = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: "",
        patch: {},
        acceptanceSupplement: { acceptanceResults: ["late proof 2"], evidenceNote: "note B" },
      },
      "lead",
      clock,
    );
    expect(second.error).toBeUndefined();
    expect(task.acceptanceSupplement?.acceptanceResults).toEqual(["late proof 1", "late proof 2"]);
    expect(task.acceptanceSupplement?.evidenceNote).toBe("note A\nnote B");
    expect(task.status).toBe("completed");
  });

  it("cancelUnfinishedTask is a no-op on terminal tasks", () => {
    const clock = makeClock();
    const done = makeTask({ status: "completed" });
    expect(cancelUnfinishedTask(done, clock)).toBe(false);
    const running = makeTask({ status: "in_progress" });
    expect(cancelUnfinishedTask(running, clock, "halted by user")).toBe(true);
    expect(running.status).toBe("cancelled");
    expect(running.output).toBe("halted by user");
  });
});

describe("dependency output budget", () => {
  function completed(id: string, output: string): TeamTaskInternal {
    return makeTask({ taskId: id, status: "completed", output });
  }

  it("collects completed ancestors topologically, truncating cycles per branch", () => {
    const warn: string[] = [];
    const a = completed("a", "A");
    const b = makeTask({ taskId: "b", status: "completed", output: "B", dependsOn: ["a"] });
    const cyclic = makeTask({ taskId: "c", status: "completed", output: "C", dependsOn: ["b", "c"] });
    const outputs = collectCompletedDependencyOutputs([a, b, cyclic], "c", (m) => warn.push(m));
    expect(outputs.map((item) => item.taskId)).toEqual(["a", "b"]);
    expect(warn.some((m) => m.includes("dependency cycle"))).toBe(true);
  });

  it("truncates per item (2k) and total (12k), dropping oldest first", () => {
    const perItem = TEAM_KERNEL_LIMITS.dependencyDigestPerItemChars;
    const total = TEAM_KERNEL_LIMITS.dependencyDigestTotalChars;
    // 8 项 × ~2k（单项截断后）≈ 16k > 12k 总量 → 丢最旧直至 ≤ 总量
    const items = Array.from({ length: 8 }, (_, i) => ({
      taskId: `item_${i}`,
      title: `t${i}`,
      output: "y".repeat(perItem + 100),
    }));
    const rendered = formatDependencyOutputs(items, { perItemChars: perItem, totalChars: total });
    expect(rendered).toContain("[truncated]");
    expect(rendered.length).toBeLessThanOrEqual(total + TRUNCATION_LENGTH_GUARD);
    expect(rendered).toContain("- item_7 "); // 最新保留
    expect(rendered).not.toContain("- item_0 "); // 超总量丢最旧

    const single = formatDependencyOutputs(
      [{ taskId: "huge", title: "huge", output: "z".repeat(total + 1) }],
      { perItemChars: perItem, totalChars: total },
    );
    expect(single.length).toBeLessThanOrEqual(total + TRUNCATION_LENGTH_GUARD);
  });

  it("errors factory keeps E1/E2 copy single-sourced", () => {
    expect(teamPortError("missing_attempt_id").message).toContain("attempt_id");
    expect(teamPortError("attempt_revoked").hint).toContain("Stop working");
    expect(teamPortError("board_limit_reached", { limit: "100" }).message).toContain("100");
  });
});

const TRUNCATION_LENGTH_GUARD = 32;
