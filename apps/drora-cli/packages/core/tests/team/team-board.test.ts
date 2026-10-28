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
  reopenFailedTask,
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
      expect(
        loser.result.status === "already_taken" || loser.result.status === "busy_with_open_task",
      ).toBe(true);
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

// ---------- spec §16 契约 2（2026-10-22 登记）：终态不可变补齐 ----------

describe("terminal output immutability (spec §16 契约 2, dsh terminal-immutability-append-evidence)", () => {
  /** 经真实迁移路径推进到 completed（非直接构造），保证测试面与生产行为一致。 */
  function completeViaPatch(clock: BoardClock): TeamTaskInternal {
    const task = makeTask({ status: "in_progress", assignee: "alice" });
    beginTaskAttempt(task, "alice", clock);
    const attemptId = task.attemptId ?? "";
    // claimed → in_progress（迁移表无 claimed→completed 直达边）
    const running = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId, patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(running.error).toBeUndefined();
    // 一次性 completed+output（迁移前非终态的合法提交流）
    const done = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId, patch: { status: "completed", output: "real result" } },
      "alice",
      clock,
    );
    expect(done.error).toBeUndefined();
    return task;
  }

  it("one-shot completed+output within a single update stays legal (pre-transition credential)", () => {
    const clock = makeClock();
    const task = makeTask({ status: "in_progress", assignee: "alice" });
    beginTaskAttempt(task, "alice", clock);
    // claimed → in_progress 先行；随后同一次更新内 completed+output（迁移前非终态，合法）
    const running = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: task.attemptId ?? "", patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(running.error).toBeUndefined();
    const result = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: task.attemptId ?? "",
        patch: { status: "completed", output: "final result", artifactRefs: ["out/a.txt"] },
      },
      "alice",
      clock,
    );
    expect(result.error).toBeUndefined();
    expect(task.status).toBe("completed");
    expect(task.output).toBe("final result");
    expect(task.artifactRefs).toEqual(["out/a.txt"]);
  });

  it("completed task rejects patch.output/artifactRefs regardless of attempt_id (empty/stale) and leaves the result untouched", () => {
    const clock = makeClock();
    const task = completeViaPatch(clock);
    task.artifactRefs = ["out/a.txt"];
    const staleAttemptId = "attempt_001"; // 旧代值（终态时凭证已清，任何值都无凭证意义）
    const frozenUpdatedAt = task.updatedAt;

    // 空凭证改写 output → 拒绝（不再落入「终态跳过一切校验」的旧洞）
    const empty = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: "", patch: { output: "forged" } },
      "alice",
      clock,
    );
    expect(empty.error?.code).toBe("terminal_read_only");
    expect(empty.error?.hint).toContain("acceptance_supplement");
    expect(task.output).toBe("real result");

    // 旧代/恰好同值凭证改写 → 同样拒绝，教学文案指向追补通道
    const stale = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: staleAttemptId, patch: { output: "forged" } },
      "alice",
      clock,
    );
    expect(stale.error?.code).toBe("terminal_read_only");
    expect(task.output).toBe("real result");

    // artifactRefs 追加同被拒（终态唯一合法通道只有署名追补）
    const artifact = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: "", patch: { artifactRefs: ["out/late.txt"] } },
      "mallory",
      clock,
    );
    expect(artifact.error?.code).toBe("terminal_read_only");
    expect(task.artifactRefs).toEqual(["out/a.txt"]);
    expect(task.updatedAt).toBe(frozenUpdatedAt); // 拒绝路径零副作用
  });

  it("a mixed update (output + supplement) on a terminal task is rejected whole — no partial application", () => {
    const clock = makeClock();
    const task = completeViaPatch(clock);
    const mixed = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: "",
        patch: { output: "forged" },
        acceptanceSupplement: { evidenceNote: "late note" },
      },
      "alice",
      clock,
    );
    expect(mixed.error?.code).toBe("terminal_read_only");
    expect(task.output).toBe("real result");
    expect(task.acceptanceSupplement).toBeUndefined(); // 不做部分应用
  });

  it("acceptanceSupplement on a completed task still appends (sole legal terminal channel, 既有锁定保留)", () => {
    const clock = makeClock();
    const task = completeViaPatch(clock);
    const supplement = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: "",
        patch: {},
        acceptanceSupplement: { acceptanceResults: ["late proof"] },
      },
      "alice",
      clock,
    );
    expect(supplement.error).toBeUndefined();
    expect(task.status).toBe("completed"); // 不改状态、不重认领
    expect(task.output).toBe("real result");
    expect(task.acceptanceSupplement?.acceptanceResults).toEqual(["late proof"]);
  });
});

// ---------- spec §16 契约 5（2026-10-23 登记）：任务终态恢复预算——lead 显式重开 ----------

describe("failed task reopen: the controlled failed→pending edge (spec §16 契约 5)", () => {
  /** 经真实迁移路径推进到 failed（契约 1 主路径同款），保证测试面与生产行为一致。 */
  function failViaPatch(clock: BoardClock): TeamTaskInternal {
    const task = makeTask({ status: "in_progress", assignee: "alice" });
    beginTaskAttempt(task, "alice", clock);
    const attemptId = task.attemptId ?? "";
    expect(
      applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId, patch: { status: "in_progress" } },
        "alice",
        clock,
      ).error,
    ).toBeUndefined();
    expect(
      applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId, patch: { status: "failed", output: "boom" } },
        "alice",
        clock,
      ).error,
    ).toBeUndefined();
    return task;
  }

  it("transition table carries exactly one controlled outgoing edge: failed → pending", () => {
    expect(TASK_TRANSITIONS.failed).toEqual(["pending"]); // 受控出边（仅 reopenTask 消费）
    expect(TASK_TRANSITIONS.completed).toEqual([]);
    expect(TASK_TRANSITIONS.cancelled).toEqual([]);
    expect(transitionError("failed", "pending")).toBeUndefined();
    expect(transitionError("completed", "pending")).toBeDefined();
    expect(transitionError("cancelled", "pending")).toBeDefined();
  });

  it("the generic update path cannot consume the edge — terminal status writes are lead-only", () => {
    const clock = makeClock();
    const task = failViaPatch(clock);
    const staleAttemptId = "attempt_001"; // 终态时凭证已清，任何值都无凭证意义
    const frozenUpdatedAt = task.updatedAt;

    // 空凭证 / 旧凭证把 failed 拉回 pending → team_lead_only，板零副作用
    for (const attemptId of ["", staleAttemptId]) {
      const result = applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId, patch: { status: "pending" } },
        "alice",
        clock,
      );
      expect(result.error?.code).toBe("team_lead_only");
      expect(task.status).toBe("failed");
      expect(task.output).toBe("boom");
      expect(task.updatedAt).toBe(frozenUpdatedAt); // 拒绝路径零副作用
    }

    // 混带追补整次拒绝（不做部分应用，与其余拒绝路径一致）
    const mixed = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: "",
        patch: { status: "pending" },
        acceptanceSupplement: { evidenceNote: "late note" },
      },
      "alice",
      clock,
    );
    expect(mixed.error?.code).toBe("team_lead_only");
    expect(task.acceptanceSupplement).toBeUndefined();

    // 非出边的终态迁移仍走 invalid_transition（既有锁定保留）
    const nonEdge = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: "", patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(nonEdge.error?.code).toBe("invalid_transition");

    // 署名追补通道不受影响（唯一合法终态通道保留）
    const supplement = applyTaskUpdate(
      [task],
      {
        taskId: "task_1",
        attemptId: "",
        patch: {},
        acceptanceSupplement: { evidenceNote: "signed note" },
      },
      "alice",
      clock,
    );
    expect(supplement.error).toBeUndefined();
    expect(task.status).toBe("failed");
  });

  it("reopenFailedTask turns failed into a fresh-generation pending slot (evidence cleared, budget reset, attempt kept)", () => {
    const clock = makeClock();
    const task = failViaPatch(clock);
    task.attempt = 2; // 旧代计数（两次 beginTaskAttempt 到达）
    task.recoveryRetried = true;
    task.acceptanceSupplement = { evidenceNote: "signed late" };
    task.artifactRefs = ["out/a.txt"];

    expect(reopenFailedTask(task, clock)).toBe(true);
    expect(task.status).toBe("pending");
    expect(task.assignee).toBeUndefined(); // 回共享池（定向指派经 reassign）
    expect(task.attempt).toBe(2); // 计数延续：+1 由再认领的 beginTaskAttempt 重铸
    expect(task.attemptId).toBeUndefined(); // pending 无凭证
    expect(task.handoffId).toBeUndefined(); // 重开无异步静默半边（失败成员已终态）
    expect(task.reassigning).toBe(false);
    expect(task.output).toBeUndefined(); // 旧代证据清空（重试必须自证）
    expect(task.acceptanceSupplement).toBeUndefined();
    expect(task.recoveryRetried).toBeUndefined(); // 新世代仍享恰一次冷恢复（两预算独立）
    expect(task.artifactRefs).toEqual(["out/a.txt"]); // 历史产出引用不属当代证据，保留
  });

  it("reopenFailedTask is a no-op on non-failed tasks (completed/cancelled have no outgoing edge)", () => {
    const clock = makeClock();
    for (const status of ["completed", "cancelled", "claimed", "pending"] as const) {
      const task = makeTask({ status });
      expect(reopenFailedTask(task, clock)).toBe(false);
      expect(task.status).toBe(status);
    }
  });

  it("attempt continues across the reopen boundary: reclaim mints attempt+1 and revokes the old generation", () => {
    const clock = makeClock();
    const task = makeTask({ status: "in_progress", assignee: "alice" });
    beginTaskAttempt(task, "alice", clock);
    const staleAttemptId = task.attemptId ?? ""; // 旧代凭证（终态清除前捕获，作迟到写入探针）
    expect(
      applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId: staleAttemptId, patch: { status: "in_progress" } },
        "alice",
        clock,
      ).error,
    ).toBeUndefined();
    expect(
      applyTaskUpdate(
        [task],
        { taskId: "task_1", attemptId: staleAttemptId, patch: { status: "failed" } },
        "alice",
        clock,
      ).error,
    ).toBeUndefined();
    const failedAttempt = task.attempt; // 1
    expect(reopenFailedTask(task, clock)).toBe(true);

    const claim = claimTask([task], "task_1", "bob", clock);
    expect(claim.result).toMatchObject({ status: "claimed", attempt: failedAttempt + 1 });
    if (claim.result.status !== "claimed") return;
    expect(task.attemptId).toBe(claim.result.attemptId);
    expect(task.attemptId).not.toBe(staleAttemptId);

    // 旧代迟到更新 → attempt_revoked（世代纪律跨重开边界成立）
    const late = applyTaskUpdate(
      [task],
      { taskId: "task_1", attemptId: staleAttemptId, patch: { status: "in_progress" } },
      "alice",
      clock,
    );
    expect(late.error?.code).toBe("attempt_revoked");
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
    const cyclic = makeTask({
      taskId: "c",
      status: "completed",
      output: "C",
      dependsOn: ["b", "c"],
    });
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
