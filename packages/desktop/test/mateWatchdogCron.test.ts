/**
 * mate watchdog host cron 挂载单测（04 详设 §1 落地注记）：tick 驱动 face 调用、
 * face 换代动态解析、face 缺席跳过、慢轮不堆积、dispose 清定时器。
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMateWatchdogCron, type MateWatchdogCronHandle } from "../src/host/cronMateWatchdog.js";

const handles: MateWatchdogCronHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

describe("startMateWatchdogCron", () => {
  it("每个 tick 调当前 face 的 runWatchdogRound（服务侧到轮判定另测）", async () => {
    const runWatchdogRound = vi.fn(async () => ({
      ran: true,
      atMs: 0,
      markedStaleTicketIds: [],
      clearedStaleCount: 0,
      notifiedCount: 0,
      aggregatedCount: 0,
    }));
    const handle = startMateWatchdogCron({
      resolveFace: () => ({ runWatchdogRound }),
      logWarn: () => undefined,
      tickMs: 20,
    });
    handles.push(handle);
    await vi.waitFor(() => expect(runWatchdogRound.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    });
  });

  it("face 缺席 → tick 跳过不报错；face 换代 → 动态跟随新实例", async () => {
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => null);
    let current: { runWatchdogRound: () => Promise<unknown> } | null = null;
    const handle = startMateWatchdogCron({
      resolveFace: () => current,
      logWarn: () => undefined,
      tickMs: 15,
    });
    handles.push(handle);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(first).not.toHaveBeenCalled();
    current = { runWatchdogRound: second };
    await vi.waitFor(() => expect(second.mock.calls.length).toBeGreaterThanOrEqual(1), {
      timeout: 2_000,
    });
    expect(first).not.toHaveBeenCalled();
  });

  it("慢轮（上一 tick 未返回）→ 跳过 tick 不堆积并发轮", async () => {
    let resolveSlow: (() => void) | null = null;
    let calls = 0;
    const handle = startMateWatchdogCron({
      resolveFace: () => ({
        runWatchdogRound: () =>
          new Promise((resolve) => {
            calls += 1;
            resolveSlow = () => resolve({ ran: true, atMs: 0, markedStaleTicketIds: [], clearedStaleCount: 0, notifiedCount: 0, aggregatedCount: 0 });
          }),
      }),
      logWarn: () => undefined,
      tickMs: 10,
    });
    handles.push(handle);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // 慢轮期间多个 tick 只产生一次在途调用。
    expect(calls).toBe(1);
    resolveSlow?.();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("轮失败只 warn，下一 tick 重试（不中断定时器）", async () => {
    const warnings: unknown[] = [];
    let calls = 0;
    const handle = startMateWatchdogCron({
      resolveFace: () => ({
        runWatchdogRound: async () => {
          calls += 1;
          if (calls === 1) throw new Error("boom");
          return { ran: true, atMs: 0, markedStaleTicketIds: [], clearedStaleCount: 0, notifiedCount: 0, aggregatedCount: 0 };
        },
      }),
      logWarn: (_message, error) => warnings.push(error),
      tickMs: 15,
    });
    handles.push(handle);
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 2_000 });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
  });
});
