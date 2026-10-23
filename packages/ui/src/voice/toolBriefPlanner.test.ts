import { beforeEach, describe, expect, it } from "vitest";
import {
  createToolBriefPlanner,
  type ToolCallBriefSource,
} from "./toolBriefPlanner.js";

/**
 * 工具简报六规则守护（specs/voice-agent-integration.md §4.2 / §9.6.7-1 / §9.6.8-S5）：
 * ①从无到有触发源收窄（进度更新不生成）②同类 10s 窗合并（只播最新目标）③最小间隔
 * 5s 不足即弃不排队 ④每 turn ≤6 上限 ⑤开关关闭零简报； FD-3 插播时机归
 * turnSpeechPlanner（见 turnSpeechPlanner.interrupt.test）。
 */

function source(overrides: {
  toolCallId: string;
  toolName?: string;
  turnId?: string;
  status?: string;
  target?: string;
}): ToolCallBriefSource {
  return {
    toolCallId: overrides.toolCallId,
    toolName: overrides.toolName ?? "Edit",
    turnId: overrides.turnId ?? "turn-1",
    status: overrides.status ?? "running",
    target: overrides.target,
  };
}

interface Harness {
  briefs: Array<{ briefId: string; toolName: string; target: string }>;
  clock: { now: number };
  setEnabled(enabled: boolean): void;
  feed(rows: ToolCallBriefSource[]): void;
  resetTurnCounters(): void;
  advance(ms: number): void;
}

function createHarness(): Harness {
  const briefs: Harness["briefs"] = [];
  const clock = { now: 1_000_000 };
  let enabled = true;
  const planner = createToolBriefPlanner({
    isBriefEnabled: () => enabled,
    consumeBrief: (briefId, toolName, target) => {
      briefs.push({ briefId, toolName, target });
    },
    now: () => clock.now,
  });
  return {
    briefs,
    clock,
    setEnabled: (next) => {
      enabled = next;
    },
    feed: (rows) => planner.consumeToolCallSnapshot(rows),
    resetTurnCounters: () => planner.resetTurnCounters(),
    advance: (ms) => {
      clock.now += ms;
    },
  };
}

beforeEach(() => {
  // 每用例独立 harness（无跨用例状态）。
});

describe("toolBriefPlanner 六规则（§4.2 EG-1）", () => {
  it("规则1：同一 toolCallId 只在从无到有时生成一次，进度更新不重复", () => {
    const harness = createHarness();
    harness.feed([source({ toolCallId: "tc-1" })]);
    // 同一调用的进度级更新（status 变化/再次出现）：不生成。
    harness.feed([source({ toolCallId: "tc-1", status: "success" })]);
    expect(harness.briefs).toHaveLength(1);
  });

  it("规则2/4（EG-1 拍板：基准=最近一次实际播出）：同类工具播出后 10s 窗内合并，只播最新目标（连续编辑 5 个文件 → 1 条）", () => {
    const harness = createHarness();
    harness.feed([source({ toolCallId: "tc-1", target: "a.ts" })]);
    expect(harness.briefs).toHaveLength(1);
    for (const file of ["b.ts", "c.ts", "d.ts", "e.ts"]) {
      harness.advance(1_000); // 窗内（<10s，基准=首条播出时刻）
      harness.feed([source({ toolCallId: `tc-${file}`, target: file })]);
    }
    // 合并窗内后续候选不生成新简报（窗内保留 pending 只刷目标）：防机关枪——至多 1 条。
    expect(harness.briefs).toHaveLength(1);
    expect(harness.briefs[0]?.target).toBe("a.ts");
  });

  it("规则2（EG-1 拍板）：窗内合并的最新目标在窗过期后的下一条候选播出（更新不丢）", () => {
    const harness = createHarness();
    harness.feed([source({ toolCallId: "tc-1", target: "a.ts" })]);
    expect(harness.briefs).toHaveLength(1);
    // 窗内连续到达，目标刷新为 e.ts；窗过期后下一条候选 f.ts 上交时一并播出最新目标。
    for (const file of ["b.ts", "c.ts", "d.ts", "e.ts"]) {
      harness.advance(1_000);
      harness.feed([source({ toolCallId: `tc-${file}`, target: file })]);
    }
    harness.advance(10_000); // 合并窗过期
    harness.feed([source({ toolCallId: "tc-f", target: "f.ts" })]);
    // §4.2-4「只播最新」：窗内合并未播的 e.ts 被更新的 f.ts 覆盖，不补播。
    expect(harness.briefs.map((brief) => brief.target)).toEqual([
      "a.ts",
      "f.ts",
    ]);
  });

  it("规则2：合并窗过期后同名工具生成新简报", () => {
    const harness = createHarness();
    harness.feed([
      source({ toolCallId: "tc-1", toolName: "Edit", target: "a.ts" }),
    ]);
    harness.advance(10_001);
    harness.advance(5_000); // 满足最小间隔
    harness.feed([
      source({ toolCallId: "tc-2", toolName: "Edit", target: "b.ts" }),
    ]);
    expect(harness.briefs).toHaveLength(2);
    expect(harness.briefs[1]?.target).toBe("b.ts");
  });

  it("规则3：最小间隔 5s 内的候选丢弃且不排队（间隔恢复后恢复播报）", () => {
    const harness = createHarness();
    harness.feed([source({ toolCallId: "tc-1", target: "a.ts" })]);
    expect(harness.briefs).toHaveLength(1);
    harness.advance(1_000); // <5s
    harness.feed([
      source({ toolCallId: "tc-2", toolName: "Bash", target: "build" }),
    ]);
    expect(harness.briefs).toHaveLength(1); // 间隔不足 → 丢弃不排队
    harness.advance(5_000); // 距上次播报 ≥5s
    harness.feed([
      source({ toolCallId: "tc-3", toolName: "Bash", target: "test" }),
    ]);
    expect(harness.briefs).toHaveLength(2);
    expect(harness.briefs[1]?.target).toBe("test");
  });

  it("规则6：每 turn ≤6 条，超出静默丢弃；turn 切换后计数重置", () => {
    const harness = createHarness();
    for (let i = 0; i < 8; i += 1) {
      harness.advance(5_000);
      harness.feed([
        source({
          toolCallId: `tc-${i}`,
          toolName: `Tool${i}`,
          turnId: "turn-1",
        }),
      ]);
    }
    expect(harness.briefs).toHaveLength(6); // 第 7 条起被每 turn 上限挡掉。
  });

  it("resetTurnCounters 后新 turn 恢复简报配额（同一 planner 实例）", () => {
    const harness = createHarness();
    // 用互异 toolName 隔离合并窗（本用例只验证每 turn 配额，不测窗合并）。
    for (let i = 0; i < 6; i += 1) {
      harness.advance(5_000);
      harness.feed([
        source({
          toolCallId: `tc-${i}`,
          toolName: `Tool${i}`,
          turnId: "turn-1",
        }),
      ]);
    }
    expect(harness.briefs).toHaveLength(6);
    harness.resetTurnCounters(); // wiring 在 turn 切换时调用：清 per-turn 计数
    harness.advance(5_000);
    harness.feed([
      source({ toolCallId: "tc-new", toolName: "ToolNew", turnId: "turn-2" }),
    ]);
    expect(harness.briefs).toHaveLength(7);
  });

  it("规则⑤：开关关闭 → 零简报（seen 照常消化，避免开启瞬间旧行涌入）", () => {
    const harness = createHarness();
    harness.setEnabled(false);
    harness.feed([
      source({ toolCallId: "tc-1" }),
      source({ toolCallId: "tc-2" }),
    ]);
    expect(harness.briefs).toHaveLength(0);
    harness.setEnabled(true);
    harness.feed([source({ toolCallId: "tc-3" })]);
    // 已 seen 的旧行不回放；新行正常出简报。
    expect(harness.briefs).toHaveLength(1);
  });

  it("首见即终态（快速完成）也算从无到有", () => {
    const harness = createHarness();
    harness.feed([source({ toolCallId: "tc-1", status: "success" })]);
    expect(harness.briefs).toHaveLength(1);
  });

  it("规则2×3 偏差区间（C1 修复钉死）：a 播出后 6s（全局间隔已满足但 <10s 合并窗）同类候选不播", () => {
    const harness = createHarness();
    harness.feed([
      source({ toolCallId: "tc-1", toolName: "Edit", target: "a.ts" }),
    ]);
    expect(harness.briefs).toEqual([
      expect.objectContaining({ target: "a.ts" }),
    ]);
    // 修复前缺陷：minGap（5s）满足时窗内候选被立即上交 → 机关枪。修复后合并窗
    // （基准=a.ts 播出时刻）真实强制：6s 候选保留 pending 不上交。
    harness.advance(6_000); // ≥minGap(5s) 但 <sameToolMergeWindow(10s)
    harness.feed([
      source({ toolCallId: "tc-2", toolName: "Edit", target: "b.ts" }),
    ]);
    expect(harness.briefs.map((brief) => brief.target)).toEqual(["a.ts"]);
    // 10s 窗过期后的下一次快照驱动上交（目标=最新到达者）。
    harness.advance(5_000); // 距 a.ts 播出 11s ≥10s，距上次播报 ≥5s
    harness.feed([
      source({ toolCallId: "tc-3", toolName: "Edit", target: "c.ts" }),
    ]);
    expect(harness.briefs.map((brief) => brief.target)).toEqual([
      "a.ts",
      "c.ts",
    ]);
  });

  it("规则合并：窗内合并 + 间隔丢弃叠加时只播满足条件的最新目标", () => {
    const harness = createHarness();
    harness.feed([
      source({ toolCallId: "tc-1", toolName: "Edit", target: "a.ts" }),
    ]);
    harness.advance(3_000); // 合并窗内（3s <10s）→ 保留 pending 不播（minGap 亦不足）
    harness.feed([
      source({ toolCallId: "tc-2", toolName: "Edit", target: "b.ts" }),
    ]);
    expect(harness.briefs.map((brief) => brief.target)).toEqual(["a.ts"]);
    // 窗过期（距 a.ts 播出 11s）→ 上交最新目标（b.ts 被 c.ts 替换，不补播）。
    harness.advance(8_000);
    harness.feed([
      source({ toolCallId: "tc-3", toolName: "Edit", target: "c.ts" }),
    ]);
    expect(harness.briefs.map((brief) => brief.target)).toEqual([
      "a.ts",
      "c.ts",
    ]);
  });

  it("规则2：窗内 pending 在窗过期后的无新候选快照中也上交（drain 由快照驱动）", () => {
    const harness = createHarness();
    harness.feed([
      source({ toolCallId: "tc-1", toolName: "Edit", target: "a.ts" }),
    ]);
    harness.advance(6_000);
    harness.feed([
      source({ toolCallId: "tc-2", toolName: "Edit", target: "b.ts" }),
    ]);
    expect(harness.briefs).toHaveLength(1); // 窗内：保留 pending
    harness.advance(5_000); // 窗过期，但本轮快照无新 toolCallId
    harness.feed([]); // 空快照仍触发 drain → 上交 pending 最新目标
    expect(harness.briefs.map((brief) => brief.target)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("规则6 归属（终审角落）：跨 turn 挂起的 pending 上交时计入当前 turn 账面", () => {
    const harness = createHarness();
    // turn-1：Edit 首条即时上交。
    harness.feed([source({ toolCallId: "tc-a1", turnId: "turn-1" })]);
    expect(harness.briefs).toHaveLength(1);
    // +1s：turn-1 的第二条 Edit 候选进合并窗 → 挂起 pending（目标取最新）。
    harness.advance(1_000);
    harness.feed([source({ toolCallId: "tc-a2", turnId: "turn-1", target: "b.ts" })]);
    expect(harness.briefs).toHaveLength(1);
    // turn 切换：清 per-turn 计数；turn-2 的行推进「当前 turn」（该候选距上次播报
    // <minGap 被 rule 3 弃，但行本身已把 currentTurnId 推到 turn-2）。
    harness.resetTurnCounters();
    harness.advance(2_000);
    harness.feed([source({ toolCallId: "tc-b0", toolName: "Bash", turnId: "turn-2" })]);
    // +8s：Edit 合并窗（基准=tc-a1 播出时刻）过期，空快照驱动 drain → 挂起 Edit 上交。
    harness.advance(8_000);
    harness.feed([]);
    expect(harness.briefs).toHaveLength(2);
    // 修复口径：挂起 Edit 计入 turn-2 账面（=1）。再喂 5 条 turn-2 新工具（间隔 ≥minGap）
    // → turn-2 账面到 6，第 7 条候选被规则 6 前置门丢弃。若无此修复，挂起计入已清零的
    // turn-1，turn-2 账面只有 5，第 7 条会通过（共 8 条）。
    for (let i = 1; i <= 5; i++) {
      harness.advance(5_100);
      harness.feed([
        source({ toolCallId: "tc-b" + i, toolName: "Bash" + i, turnId: "turn-2" }),
      ]);
    }
    expect(harness.briefs).toHaveLength(7);
    harness.advance(5_100);
    harness.feed([source({ toolCallId: "tc-b-over", toolName: "BashOver", turnId: "turn-2" })]);
    expect(harness.briefs).toHaveLength(7);
  });
});
