/**
 * 系统级听写全局触发服务（specs/voice-agent-integration.md §5.6，2026-11-08）。
 *
 * 生命周期：设置开→spawn 常驻 key-tap helper（native/macos-key-tap Swift，CGEventTap
 * 监听右 ⌥+右 ⌘ 弦）；stdout 行协议 JSON：listening/trigger/denied。trigger → main 按
 * 前台 App 判定 target（Drora 任一窗聚焦=composer，否则=global）推 renderer；denied →
 * 推权限态（设置页引导「输入监控」）。helper 意外退出→指数退避重启（1s/5s/20s，收到
 * listening 清零）；denied 不重启（授权后用户重新打开开关或设置页触发重试）。
 *
 * spawn/时钟注入（测试脱离真实进程）；平台守卫在装配点（darwin + 二进制存在）。
 */

import { createServiceLogger } from "@drora/services/node";
import type { VoiceGlobalTriggerEvent, VoiceGlobalTriggerStateFrame } from "@drora/shared";

const logger = createServiceLogger("voice.globalTrigger");

/** helper 行协议事件。 */
export type KeyTapEvent = { event: "listening" } | { event: "trigger" } | { event: "denied" };

/** 最小子进程形状（spawn 注入 / 测试 fake）。 */
export interface KeyTapProcessLike {
  once(event: "error", cb: (error: Error) => void): unknown;
  once(event: "close", cb: (code: number | null) => void): unknown;
  kill(): void;
}

export interface VoiceGlobalKeyTapDeps {
  spawnHelper(): KeyTapProcessLike;
  /** 逐行读取 helper stdout；行到达回调。 */
  readLines(process: KeyTapProcessLike, onLine: (line: string) => void): void;
  /** 前台判定：Drora 任一窗口聚焦=composer（应用内注入链），否则=global（注入服务）。 */
  resolveTarget(): "composer" | "global";
  sendTrigger(event: VoiceGlobalTriggerEvent): void;
  sendState(frame: VoiceGlobalTriggerStateFrame): void;
  restartDelaysMs?: number[];
}

export function parseKeyTapLine(line: string): KeyTapEvent | null {
  try {
    const parsed = JSON.parse(line) as { event?: unknown };
    if (parsed.event === "listening" || parsed.event === "trigger" || parsed.event === "denied") {
      return { event: parsed.event };
    }
  } catch {
    // 非 JSON 行（helper 诊断输出）：忽略。
  }
  return null;
}

export function createVoiceGlobalKeyTapService(deps: VoiceGlobalKeyTapDeps): {
  start(): void;
  stop(): void;
  isRunning(): boolean;
} {
  const restartDelays = deps.restartDelaysMs ?? [1000, 5000, 20000];
  let helper: KeyTapProcessLike | null = null;
  let running = false; // 用户开关语义（start 请求在）。
  let restartAttempts = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRestartTimer = () => {
    if (restartTimer != null) clearTimeout(restartTimer);
    restartTimer = null;
  };

  const spawnOnce = (): void => {
    let child: KeyTapProcessLike;
    try {
      child = deps.spawnHelper();
    } catch (error) {
      logger.warn("key-tap spawn failed", {
        message: error instanceof Error ? error.message.slice(0, 120) : String(error),
      });
      scheduleRestart();
      return;
    }
    helper = child;
    deps.readLines(child, (line) => {
      const event = parseKeyTapLine(line);
      if (!event) return;
      if (event.event === "listening") {
        restartAttempts = 0;
        deps.sendState({ status: "listening" });
        return;
      }
      if (event.event === "denied") {
        // 输入监控未授权：不退避重启（起了也被拒）；引导授权后由用户重新开启。
        logger.warn("key-tap input monitoring denied");
        deps.sendState({ status: "denied" });
        running = false;
        return;
      }
      deps.sendTrigger({ target: deps.resolveTarget() });
    });
    child.once("error", (error) => {
      logger.warn("key-tap process error", { message: error.message.slice(0, 120) });
      helper = null;
      if (running) scheduleRestart();
    });
    child.once("close", (code) => {
      helper = null;
      // denied 路径 exit 2 且已置 running=false；其余非零码=意外退出。
      if (running) {
        logger.info("key-tap exited unexpectedly, restarting", { code });
        scheduleRestart();
      }
    });
  };

  const scheduleRestart = (): void => {
    if (!running || restartTimer != null) return;
    const delay = restartDelays[Math.min(restartAttempts, restartDelays.length - 1)]!;
    restartAttempts += 1;
    logger.info("key-tap restart scheduled", { delayMs: delay, attempt: restartAttempts });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (running) spawnOnce();
    }, delay);
  };

  return {
    start() {
      if (running) return;
      running = true;
      restartAttempts = 0;
      spawnOnce();
    },
    stop() {
      running = false;
      clearRestartTimer();
      if (helper) {
        try {
          helper.kill();
        } catch {
          // 已退出：忽略。
        }
      }
      helper = null;
    },
    isRunning() {
      return running;
    },
  };
}
