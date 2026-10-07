// Drora Relay Client · 常量与默认时钟。
// 数值逐项对齐官方 3.14.3 手机页 bundle 取证（.tmp-work/official-phone-bundle.js，
// hVn RelaySession 段）与 specs/mobile-web-remote.md「协议常量」节。
import type { RelayClockPort, RelayTimerHandle } from "./ports.js";

/** 物理帧硬上限（官方 maxPhysicalFrameBytes=1MiB；与 relay-server MAX_WS_PAYLOAD_BYTES 同源）。 */
export const MAX_PHYSICAL_FRAME_BYTES = 1024 * 1024;

/** 心跳 pair_status_query 间隔 10s、抖动 ≤2s、ack 看门狗 30s（官方协议常量节取证）。 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEFAULT_HEARTBEAT_JITTER_MS = 2_000;
export const DEFAULT_HEARTBEAT_ACK_TIMEOUT_MS = 30_000;

/**
 * 重连退避：500ms×2ⁿ 封顶 10s（官方 scheduleReconnect：
 * `Math.min(1e4, 500*2**this.reconnectAttempt)`，attempt 计满自增、matched 归零）。
 */
export const DEFAULT_RECONNECT_BASE_MS = 500;
export const DEFAULT_RECONNECT_MAX_MS = 10_000;

/** 首次 waiting 配对窗 30s（官方 waitingTimeoutMs??3e4 → invalid-mobile-connection 终态）。 */
export const DEFAULT_WAITING_TIMEOUT_MS = 30_000;

/**
 * DEVICE_OFFLINE 桌面离线宽限：默认 15s（官方 desktopOfflineGraceMs??15e3，
 * bundle 取证 `this.desktopOfflineFailureTimer||=setTimeout(...,15e3)`），
 * 超时才终态 desktop-disconnected（spec §2「宽限期而非立即判死」）。
 */
export const DEFAULT_DESKTOP_OFFLINE_GRACE_MS = 15_000;

/** 挂起恢复窗：notifyVisible 后 15s 未回 paired → connection-recovery-timeout（spec §2）。 */
export const DEFAULT_RECOVER_WINDOW_MS = 15_000;
/** 恢复快路径健康检查窗（官方 healthCheckTimeoutMs??3e3）。 */
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 3_000;

/** 鉴权 challenge/ack 监督窗：超时重发 auth_init=重新挑战（宽松重试，relay-server spec §7 ①）。 */
export const DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS = 10_000;

/** 抖动上限：min(max, base*0.2+1)，与 desktop 端 jitterDelay 同式（官方 10s±2s 抖动）。 */
export function jitterDelay(base: number, max: number, random: () => number): number {
  return Math.floor(random() * Math.min(max, Math.floor(base * 0.2) + 1));
}

/** 平台定时器原语（浏览器=number，node=Timeout 对象），本文件内部桥接用。 */
type PlatformTimer = ReturnType<typeof setTimeout>;

/** 系统时钟（生产装配缺省；测试注入手控时钟，避免依赖 mock.timers）。 */
export const systemClock: RelayClockPort = {
  now(): number {
    return Date.now();
  },
  setTimeout(handler: () => void, timeoutMs: number): RelayTimerHandle {
    return setTimeout(handler, timeoutMs) as unknown as RelayTimerHandle;
  },
  clearTimeout(handle: RelayTimerHandle): void {
    clearTimeout(handle as unknown as PlatformTimer);
  },
};
