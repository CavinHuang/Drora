/**
 * 写域 W1/W2/W3 与代际纯模块测试（02 详设 §3/§4；spec §8/§9 不变式）。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  detectWriteDomainOverlap,
  isBudgetActiveStatus,
  MATE_WORKTREE_BRANCH_PREFIX,
  MATE_WORKTREE_DIR_SEGMENTS,
  planBudgetAdmission,
  planWriteDomain,
} from "../src/assistant-tickets/writeDomain.js";
import {
  appendGeneration,
  composeDispatchCommandId,
  composeGenerationDigest,
  normalizeGenerationCause,
  parseIncarnation,
  resolveAnchorVerdict,
  serializeIncarnation,
} from "../src/assistant-tickets/incarnation.js";
import {
  parseDispatchIntent,
  serializeDispatchIntent,
} from "../src/assistant-tickets/dispatchIntent.js";
import { ASSISTANT_DEFAULTS, ASSISTANT_GENERATION_CAUSES } from "@drora/shared";

describe("writeDomain 规划（02 §4）", () => {
  it("W1：git 根 + W1 开 → worktree .drora/mate/<id> + 分支 mate/<id>", () => {
    const plan = planWriteDomain({
      ticketId: "T-abc",
      probe: { ok: true, workspacePath: "D:/repo", isGitRoot: true },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // node:path join 在 Windows 产出反斜杠——期望值同源构造（字面量分段锁定设计原文）。
    expect(plan.domain).toEqual({
      kind: "worktree",
      path: join("D:/repo", ...MATE_WORKTREE_DIR_SEGMENTS, "T-abc"),
      branch: `${MATE_WORKTREE_BRANCH_PREFIX}T-abc`,
    });
    expect(plan.worktreeRequest).toEqual({
      path: plan.domain.kind === "worktree" ? plan.domain.path : "",
      branch: `${MATE_WORKTREE_BRANCH_PREFIX}T-abc`,
    });
  });

  it("W2：非 git 根或用户关闭 W1 → 声明域（P2 默认空集，决策卡可编辑）", () => {
    const nonGit = planWriteDomain({
      ticketId: "T-1",
      probe: { ok: true, workspacePath: "D:/docs", isGitRoot: false },
    });
    expect(nonGit.ok).toBe(true);
    if (nonGit.ok) expect(nonGit.domain).toEqual({ kind: "paths", paths: [] });
    const disabled = planWriteDomain({
      ticketId: "T-1",
      probe: { ok: true, workspacePath: "D:/repo", isGitRoot: true },
      worktreeDisabled: true,
    });
    expect(disabled.ok).toBe(true);
    if (disabled.ok) expect(disabled.domain.kind).toBe("paths");
  });

  it("probe 失败 → 计划失败（引擎侧降级 workspace 域，见 dispatchEngine 测试）", () => {
    const plan = planWriteDomain({
      ticketId: "T-1",
      probe: { ok: false, reason: "目标非本地绝对路径" },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("探测失败");
  });
});

describe("写域冲突矩阵（不变式：两两写域不相交）", () => {
  const worktreeA = { kind: "worktree" as const, path: "D:/repo/.drora/mate/T-a", branch: "mate/T-a" };
  const worktreeB = { kind: "worktree" as const, path: "D:/repo/.drora/mate/T-b", branch: "mate/T-b" };
  const workspace = { kind: "workspace" as const };
  const declared = { kind: "paths" as const, paths: ["D:/repo/src"] };

  it("worktree 彼此不冲突（独立检出目录）；与 workspace/paths 也不冲突（隔离即此设计）", () => {
    expect(detectWriteDomainOverlap(worktreeA, worktreeB)).toBe(false);
    expect(detectWriteDomainOverlap(worktreeA, workspace)).toBe(false);
    expect(detectWriteDomainOverlap(worktreeA, declared)).toBe(false);
  });

  it("workspace vs workspace / workspace vs paths 冲突；空声明集=待声明整域彼此冲突", () => {
    expect(detectWriteDomainOverlap(workspace, workspace)).toBe(true);
    expect(detectWriteDomainOverlap(workspace, declared)).toBe(true);
    expect(
      detectWriteDomainOverlap(worktreeA, { ...worktreeA }),
    ).toBe(false);
    const undeclared = { kind: "paths" as const, paths: [] };
    expect(detectWriteDomainOverlap(workspace, undeclared)).toBe(true);
    // 两个 W2 空声明工单（同一非 git 目录）互斥——否则不变式「两两写域不相交」被绕过。
    expect(detectWriteDomainOverlap(undeclared, undeclared)).toBe(true);
  });

  it("路径前缀边界：mate 不误配 mate2（Windows/POSIX 分隔符均可）", () => {
    const a = { kind: "paths" as const, paths: ["D:/repo/src/mate"] };
    const b = { kind: "paths" as const, paths: ["D:/repo/src/mate2/inner"] };
    expect(detectWriteDomainOverlap(a, b)).toBe(false);
    const nested = { kind: "paths" as const, paths: ["D:/repo/src"] };
    expect(detectWriteDomainOverlap(a, nested)).toBe(true);
  });
});

describe("软预算（spec §9：默认 3、超出排队；queued 不占预算）", () => {
  it("默认预算=ASSISTANT_DEFAULTS（3）", () => {
    expect(planBudgetAdmission({ activeCount: 2 }).action).toBe("admit");
    const queue = planBudgetAdmission({ activeCount: 3 });
    expect(queue.action).toBe("queue");
    if (queue.action === "queue") expect(queue.reason).toContain("3");
    expect(planBudgetAdmission({ activeCount: 1, budgetMaxActivePerWorkspace: 1 }).action).toBe(
      "queue",
    );
    expect(ASSISTANT_DEFAULTS.budgetMaxActivePerWorkspace).toBe(3);
  });

  it("活动状态口径（单一出处）：dispatched/running/awaiting_output 占预算，其余不占", () => {
    expect(isBudgetActiveStatus("dispatched")).toBe(true);
    expect(isBudgetActiveStatus("running")).toBe(true);
    expect(isBudgetActiveStatus("awaiting_output")).toBe(true); // P4 §3：滞留占预算位
    expect(isBudgetActiveStatus("queued")).toBe(false);
    expect(isBudgetActiveStatus("done")).toBe(false);
    expect(isBudgetActiveStatus("failed")).toBe(false);
  });
});

describe("代际（02 §3；spec §8）", () => {
  it("带序 commandId：<ticketId>-<seq>", () => {
    expect(composeDispatchCommandId("T-1", 1)).toBe("T-1-1");
    expect(composeDispatchCommandId("T-1", 12)).toBe("T-1-12");
  });

  it("incarnation JSON 往返；P1 行（无新字段）兼容读取", () => {
    const incarnation = {
      workspaceIdentity: "ws-a",
      sessionId: "sess-1",
      boundAtMs: 1,
      cause: "dispatched",
      anchorCommandId: "T-1-1",
      dispatchSeq: 1,
    };
    expect(parseIncarnation(serializeIncarnation(incarnation))).toEqual(incarnation);
    const legacy = parseIncarnation(JSON.stringify({ workspaceIdentity: "ws-a", sessionId: "s" }));
    expect(legacy.anchorCommandId).toBeNull();
    expect(legacy.dispatchSeq).toBe(0);
  });

  it("换代纪律：未闭合代不能追加（最多一代 active 的结构化表达）", () => {
    const closed = [
      { sessionId: "s1", fromMs: 1, toMs: 2, cause: ASSISTANT_GENERATION_CAUSES.superseded },
    ];
    const appended = appendGeneration(closed, {
      sessionId: "s2",
      fromMs: 2,
      toMs: 3,
      cause: ASSISTANT_GENERATION_CAUSES.lost,
    });
    expect(appended).toHaveLength(2);
    expect(() =>
      appendGeneration(
        appended.concat([{ sessionId: "s3", fromMs: 3, toMs: 0, cause: ASSISTANT_GENERATION_CAUSES.lost }]),
        { sessionId: "s4", fromMs: 4, toMs: 5, cause: ASSISTANT_GENERATION_CAUSES.lost },
      ),
    ).toThrow(/未闭合代/);
  });

  it("cause 归一：越界值如实记 lost 并保留原词于 note 后缀", () => {
    expect(normalizeGenerationCause("user_picked").cause).toBe("user_picked");
    const weird = normalizeGenerationCause("whatever");
    expect(weird.cause).toBe("lost");
    expect(weird.noteSuffix).toBe("cause=whatever");
  });

  it("浓缩段：产出摘要 + usage 合计 + 未确认增量标注（诚实规则）", () => {
    const digest = composeGenerationDigest({
      nextGeneration: 2,
      outputSummaries: [{ atMs: 5, summary: "改了一半" }],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(digest).toContain("第 2 代重启");
    expect(digest).toContain("改了一半");
    expect(digest).toContain("input 100 / output 50");
    expect(digest).toContain("未确认增量");
    expect(digest).toContain("第 1 代末尾改动未汇报");
    const custom = composeGenerationDigest({
      nextGeneration: 3,
      outputSummaries: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      unconfirmedNote: "第 2 代 fork 后未汇报",
    });
    expect(custom).toContain("前代无产出摘要");
    expect(custom).toContain("第 2 代 fork 后未汇报");
  });

  it("换代原因与未确认增量分列（P2 审查修复：原因不顶替增量标注）", () => {
    const digest = composeGenerationDigest({
      nextGeneration: 2,
      outputSummaries: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      causeNote: "锚会话已删除",
    });
    // 原因行与增量行并存：触发原因不进未确认增量位，spec §2.4 增量语义恒在。
    expect(digest).toContain("换代原因：锚会话已删除");
    expect(digest).toContain("未确认增量：第 1 代末尾改动未汇报");
    expect(digest.indexOf("换代原因")).toBeLessThan(digest.indexOf("未确认增量"));
    const noCause = composeGenerationDigest({
      nextGeneration: 2,
      outputSummaries: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(noCause).not.toContain("换代原因：");
    expect(noCause).toContain("未确认增量：");
  });

  it("锚校验判定（spec §8 触发源①②）", () => {
    expect(resolveAnchorVerdict({ kind: "ok" }).mismatch).toBe(false);
    expect(resolveAnchorVerdict({ kind: "missing", deleted: true }).reason).toContain("删除");
    expect(resolveAnchorVerdict({ kind: "missing", deleted: false }).reason).toContain("fork/rewind");
  });
});

describe("dispatchIntent（P2 审查修复：queued 释放按落库意图重放派发形态）", () => {
  it("序列化往返：A/B/C 三模式（C 必带 attachSessionId）", () => {
    const intentA = { mode: "A" as const, tier: "build" as const };
    expect(parseDispatchIntent(serializeDispatchIntent(intentA))).toEqual(intentA);
    const intentB = { mode: "B" as const, tier: "guarded" as const };
    expect(parseDispatchIntent(serializeDispatchIntent(intentB))).toEqual(intentB);
    const intentC = { mode: "C" as const, tier: "build" as const, attachSessionId: "sess-u" };
    expect(parseDispatchIntent(serializeDispatchIntent(intentC))).toEqual(intentC);
  });

  it("诚实降级：缺列/坏 JSON/未知 mode/yolo tier/C 缺 sessionId → undefined（回退 Mode A/build）", () => {
    expect(parseDispatchIntent(null)).toBeUndefined();
    expect(parseDispatchIntent("")).toBeUndefined();
    expect(parseDispatchIntent("not-json")).toBeUndefined();
    expect(parseDispatchIntent(JSON.stringify({ mode: "Z", tier: "build" }))).toBeUndefined();
    expect(parseDispatchIntent(JSON.stringify({ mode: "A", tier: "yolo" }))).toBeUndefined();
    expect(parseDispatchIntent(JSON.stringify({ mode: "C", tier: "build" }))).toBeUndefined();
    expect(parseDispatchIntent(JSON.stringify({ mode: "A" }))).toBeUndefined();
  });
});
