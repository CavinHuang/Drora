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

  // ---- P9（09 详设 §2.1 v2）：自主评估轮 tick 同源触发，fire-and-forget 不进 watchdog
  // await 链；入口可缺席（旧 face）；异常只 warn。 ----
  it("P9：每 tick 同源触发 runAutonomyRound（与 watchdog 轮各自独立计数）", async () => {
    const runWatchdogRound = vi.fn(async () => ({
      ran: false,
      atMs: 0,
      markedStaleTicketIds: [],
      clearedStaleCount: 0,
      notifiedCount: 0,
      aggregatedCount: 0,
    }));
    const runAutonomyRound = vi.fn(async () => ({ ran: false, atMs: 0, skipReason: "throttled" as const }));
    const handle = startMateWatchdogCron({
      resolveFace: () => ({ runWatchdogRound, runAutonomyRound }),
      logWarn: () => undefined,
      tickMs: 15,
    });
    handles.push(handle);
    await vi.waitFor(() => expect(runAutonomyRound.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    });
    expect(runWatchdogRound.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("P9：自主轮慢/挂起不阻塞 watchdog 轮（fire-and-forget 不进 await 链）", async () => {
    let watchdogCalls = 0;
    const handle = startMateWatchdogCron({
      resolveFace: () => ({
        runWatchdogRound: async () => {
          watchdogCalls += 1;
          return { ran: false, atMs: 0, markedStaleTicketIds: [], clearedStaleCount: 0, notifiedCount: 0, aggregatedCount: 0 };
        },
        // 自主轮永不 settle（慢评估在途）——watchdog 轮照常推进。
        runAutonomyRound: () => new Promise(() => undefined),
      }),
      logWarn: () => undefined,
      tickMs: 15,
    });
    handles.push(handle);
    await vi.waitFor(() => expect(watchdogCalls).toBeGreaterThanOrEqual(3), { timeout: 2_000 });
  });

  it("P9：旧 face（runAutonomyRound 缺席）tick 跳过不报错；自主轮异常只 warn", async () => {
    const warnings: unknown[] = [];
    let watchdogCalls = 0;
    let withAutonomy = true;
    const handle = startMateWatchdogCron({
      resolveFace: () =>
        withAutonomy
          ? {
              runWatchdogRound: async () => {
                watchdogCalls += 1;
                return { ran: false, atMs: 0, markedStaleTicketIds: [], clearedStaleCount: 0, notifiedCount: 0, aggregatedCount: 0 };
              },
              runAutonomyRound: async () => {
                throw new Error("autonomy boom");
              },
            }
          : {
              runWatchdogRound: async () => {
                watchdogCalls += 1;
                return { ran: false, atMs: 0, markedStaleTicketIds: [], clearedStaleCount: 0, notifiedCount: 0, aggregatedCount: 0 };
              },
            },
      logWarn: (message, error) => warnings.push(`${message}:${String(error)}`),
      tickMs: 15,
    });
    handles.push(handle);
    await vi.waitFor(() => expect(watchdogCalls).toBeGreaterThanOrEqual(2), { timeout: 2_000 });
    // 自主轮异常只 warn（不中断 tick——watchdog 照常推进即证）。
    expect(warnings.some((entry) => String(entry).includes("autonomy boom"))).toBe(true);
    const autonomyWarningsBefore = warnings.filter((entry) =>
      String(entry).includes("autonomy boom"),
    ).length;
    // 换代到旧 face：无 runAutonomyRound 入口——optional-call 跳过，watchdog 照常；
    // 自主 warn 不再新增（异常面随 face 消失）。
    withAutonomy = false;
    await vi.waitFor(() => expect(watchdogCalls).toBeGreaterThanOrEqual(6), { timeout: 2_000 });
    expect(
      warnings.filter((entry) => String(entry).includes("autonomy boom")).length,
    ).toBe(autonomyWarningsBefore);
  });
});
