import type { AssistantTicketsHostFace } from "@drora/services/node";

/**
 * Drora Mate watchdog 的 host cron 挂载（04 详设 §1 落地注记；spec §10 P4）。
 *
 * 形态照 startManualClaimHeartbeat（cronRunLifecycle.ts）的 setInterval 先例：本文件
 * 只负责 tick——每 tick 调一次服务内部 watchdog 轮入口，「是否到轮」（kv
 * watchdog_interval_ms 可调，缺省 15 分钟）由服务按 kv 裁决，kv 改值即时生效、定时器
 * 不重启。**不进任何会话**：watchdog 轮纯读台账+标记+配额判定，无会话/进程操作
 * （spec §10：永不自动终止/换代/重试）。
 *
 * tick 粒度（60s）远小于最小可配轮间隔：轮询节流在服务侧，tick 失败只 warn 不中断
 * （下一 tick 重试，事件侧台账不受影响）。host 进程退出随进程回收（mateActivityBridge
 * 同款生命周期语义：服务集合换代经 resolveFace 动态解析新实例，句柄不重建）。
 */

const MATE_WATCHDOG_TICK_MS = 60_000;

export interface MateWatchdogCronHandle {
  dispose(): void;
}

export function startMateWatchdogCron(params: {
  /** 每次 tick 解析当前服务集合的 watchdog face（服务集合换代动态跟随；null=跳过）。 */
  resolveFace: () => AssistantTicketsHostFace | null;
  logWarn: (message: string, error: unknown) => void;
  /** 仅供测试收紧；生产固定 60s。 */
  tickMs?: number;
}): MateWatchdogCronHandle {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // 上一 tick 的轮未返回（慢 IO）时跳过本轮 tick，不排队堆积
    running = true;
    const face = params.resolveFace();
    if (!face) {
      running = false;
      return; // 能力位未装配（旧 host/降级面）：无 watchdog，合法
    }
    void face
      .runWatchdogRound()
      .catch((error: unknown) => {
        params.logWarn("mate watchdog 轮执行失败（下一 tick 重试）", error);
      })
      .finally(() => {
        running = false;
      });
  }, params.tickMs ?? MATE_WATCHDOG_TICK_MS);
  // host 进程 shutdown 不依赖本句柄（定时器随进程回收）；dispose 供显式回收路径使用。
  return {
    dispose: () => clearInterval(timer),
  };
}
