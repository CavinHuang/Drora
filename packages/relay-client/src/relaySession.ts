/* oxlint-disable eslint(max-lines) -- RelaySession 九态状态机集中在单模块：配对窗/心跳/
   宽限/重连/恢复定时器共享同一状态边界与终态守卫，拆分会打散过渡原子性（desktop
   desktopMobileRelayControl 同款豁免先例）。 */
// ZCode Relay Client · RelaySession（terminal 角色）九态状态机。
// 状态与过渡表 = specs/mobile-relay-r3-frontend.md §2（官方 3.14.3 RelaySession 对齐）：
//   idle → connecting → authenticating → waiting/paired → (reconnecting|suspended)
//   → kicked/error（终态）。
// 关键语义（官方取证，clock.ts 常量注释随注）：
//   - 心跳 pair_status_query 10s±2s，ack 看门狗 30s 超时按死链强制重连；
//   - waiting 配对窗 30s 超时 → invalid-mobile-connection 终态；waiting 期间停心跳
//     （P0 乒乓修复：配对进度由服务端 attach 推送驱动，见 relay-server
//     attach.statusChanged 主动推送；重复 waiting ack 不再重启心跳/重挂配对窗）；
//   - paired 态收 waiting ack（P2-2）＝桌面离开：迁回 waiting + 停心跳 + 重挂配对窗；
//   - DEVICE_OFFLINE 不立即判死：15s 宽限窗内回到 matched 即撤销，超时才终态
//     desktop-disconnected（spec §2「宽限期而非立即判死」）；
//   - KICKED 终态不再重连（防乒乓）；
//   - 从未配对过（pairedGeneration===0）的 socket close/error → relay-unavailable
//     终态，不再无限重连（P1-5②，官方 close 分派 hadPairedSession 分支对齐）；
//   - INTERNAL：paired 迁回 waiting / 非 paired 立即重连，均不落失败卡（P1-5③）；
//   - 未知错误码 → relay-unavailable 终态（P1-5①，官方 default 分支）；
//   - 挂起恢复：15s 恢复窗（跨重连存活）+ 3s 健康检查快路径（P2-3，官方
//     recoverConnection：3s 未回 paired → 主动断开触发重连）；
//   - 重连退避 500ms×2ⁿ 封顶 10s，attempt 计数 matched 归零；
//   - 重新配对（非首次）= onSendReady：全量重放未确认 rpc 帧（桌面 applyPairStatus
//     @379650/@404330 同款），由 bridge 层经 onResendReady 回调接入。
import { jitterDelay } from "./clock.js";
import {
  DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS,
  DEFAULT_DESKTOP_OFFLINE_GRACE_MS,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_ACK_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_JITTER_MS,
  DEFAULT_RECONNECT_BASE_MS,
  DEFAULT_RECONNECT_MAX_MS,
  DEFAULT_RECOVER_WINDOW_MS,
  DEFAULT_WAITING_TIMEOUT_MS,
} from "./clock.js";
import { createJsonWireCodec } from "./codec.js";
import {
  isGraceEligibleError,
  isRelayInternalError,
  isTerminalKick,
  mapRelayErrorToFailure,
} from "./errorMapping.js";
import type {
  RelayClockPort,
  RelayTransportFactory,
  RelayTransportPort,
  RelayWireCodecPort,
} from "./ports.js";
import type {
  RelayDiagnostic,
  RelayFailure,
  RelayPairStatus,
  RelaySessionState,
  RelayWireFrame,
} from "./types.js";

export interface RelaySessionTimings {
  heartbeatIntervalMs: number;
  heartbeatJitterMs: number;
  heartbeatAckTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  waitingTimeoutMs: number;
  desktopOfflineGraceMs: number;
  recoverWindowMs: number;
  authChallengeTimeoutMs: number;
  /** 挂起恢复 3s 健康检查窗（官方 healthCheckTimeoutMs??3e3，P2-3）。 */
  healthCheckTimeoutMs: number;
}

export const defaultSessionTimings: RelaySessionTimings = {
  heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
  heartbeatJitterMs: DEFAULT_HEARTBEAT_JITTER_MS,
  heartbeatAckTimeoutMs: DEFAULT_HEARTBEAT_ACK_TIMEOUT_MS,
  reconnectBaseMs: DEFAULT_RECONNECT_BASE_MS,
  reconnectMaxMs: DEFAULT_RECONNECT_MAX_MS,
  waitingTimeoutMs: DEFAULT_WAITING_TIMEOUT_MS,
  desktopOfflineGraceMs: DEFAULT_DESKTOP_OFFLINE_GRACE_MS,
  recoverWindowMs: DEFAULT_RECOVER_WINDOW_MS,
  authChallengeTimeoutMs: DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS,
  healthCheckTimeoutMs: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
};

export interface RelaySessionOptions {
  /** relay WS 端点（ws(s)://host:port/ws；mid 查询串可选追加）。 */
  url: string;
  credential: { deviceSid: string; passHash: string };
  transportFactory: RelayTransportFactory;
  clock: RelayClockPort;
  codec?: RelayWireCodecPort;
  /** 抖动随机源（测试注入；缺省 Math.random）。 */
  random?: () => number;
  timings?: Partial<RelaySessionTimings>;
  diagnostics?: (diagnostic: RelayDiagnostic) => void;
  /** data 应用帧入站（rpc-frame/rpc-frame-ack 之外的透传面）。 */
  onPayload?: (payload: Record<string, unknown>) => void;
  /** error 帧透传（已按宽限/终态分派后仍回调，供页面诊断）。 */
  onError?: (code: string, message: string) => void;
  /** 终态失败（十一卡 reason；会话随后停止重连）。 */
  onFailure?: (failure: RelayFailure) => void;
  /** 每次进入 paired（含重连后）回调。 */
  onPaired?: (info: { generation: number }) => void;
}

type Timer = ReturnType<RelayClockPort["setTimeout"]> | undefined;

/**
 * 会话实例。一个 relay 连接生命周期一个；`frames`/`attachBridge` 见 appFrameChannel /
 * rpcFrameChannel。平台无关：传输/编解码/时钟全部注入（ports.ts）。
 */
export class RelaySession {
  private stateValue: RelaySessionState = "idle";
  private transport: RelayTransportPort | undefined;
  private transportGen = 0;
  private reconnectAttempt = 0;
  private readonly timers = new Set<Timer>();
  private heartbeatTimer: Timer;
  private heartbeatWatchdog: Timer;
  private waitingWatchdog: Timer;
  private offlineGraceTimer: Timer;
  private recoverTimer: Timer;
  private healthCheckTimer: Timer;
  private reconnectTimer: Timer;
  private authWatchdog: Timer;
  private pairedGeneration = 0;
  private pairedResolve: (() => void) | undefined;
  private pairedReject: ((failure: RelayFailure) => void) | undefined;
  private ended = false;
  /**
   * 自发关闭标记（P1-5②）：鉴权监督/心跳看门狗/挂起健康检查等主动 close 不得触发
   * 「从未配对过 → relay-unavailable 终态」——这些路径依赖 close 后的重连重试
   * （官方以 socket 引 volunteered 置空使 close 事件失配，等效语义）。
   */
  private intentionalClose = false;
  /** 最近一次 pair_status_ack 到达时刻（官方 lastPairStatusAckAt；诊断/语义对齐用）。 */
  private lastPairStatusAckAt = 0;

  readonly timings: RelaySessionTimings;
  private readonly codec: RelayWireCodecPort;
  private readonly random: () => number;

  constructor(private readonly options: RelaySessionOptions) {
    this.timings = { ...defaultSessionTimings, ...options.timings };
    this.codec = options.codec ?? createJsonWireCodec();
    this.random = options.random ?? Math.random;
  }

  get state(): RelaySessionState {
    return this.stateValue;
  }

  /** 首次配对 promise（成功 resolve；终态失败 reject）。 */
  whenPaired(): Promise<void> {
    if (this.pairedGeneration > 0) return Promise.resolve();
    if (this.pairedResolve === undefined) {
      return new Promise<void>((resolve, reject) => {
        this.pairedResolve = resolve;
        this.pairedReject = reject;
      });
    }
    return new Promise<void>((resolve, reject) => {
      const previousResolve = this.pairedResolve;
      const previousReject = this.pairedReject;
      this.pairedResolve = () => {
        previousResolve?.();
        resolve();
      };
      this.pairedReject = (failure) => {
        previousReject?.(failure);
        reject(failure);
      };
    });
  }

  // —— 生命周期 ——

  /** 建连（幂等：非 idle 状态忽略）。 */
  connect(): void {
    if (this.ended || this.stateValue !== "idle") return;
    this.openTransport();
  }

  /** 用户侧拆除：停一切定时器、关 socket、回 idle（可再次 connect）。 */
  disconnect(): void {
    this.clearAllTimers();
    // 先失效当前代事件再关 socket：同步 onClose 分派不得触发重连（官方 dispose
    // 置 intentionallyClosed 同语义）。
    this.transportGen += 1;
    this.intentionalClose = true;
    this.transport?.close();
    this.transport = undefined;
    this.setState("idle");
  }

  /** 永久销毁：disconnect + 拒绝未决 whenPaired。 */
  dispose(failure?: RelayFailure): void {
    this.ended = true;
    const pendingReject = this.pairedReject;
    this.disconnect();
    pendingReject?.(failure ?? { reason: "unexpected-error", message: "session disposed" });
  }

  /** 页面隐藏（官方 suspended 入口：UI 监听 visibilitychange 后调用）。 */
  notifyHidden(): void {
    if (this.stateValue === "paired" || this.stateValue === "waiting") {
      // 官方 suspended：socket 保留，心跳继续由服务端踢；本地停心跳防半开写。
      this.stopHeartbeat();
      this.setState("suspended");
    }
  }

  /**
   * 页面恢复：15s 恢复窗（未回 paired → connection-recovery-timeout；跨重连存活，
   * 官方 waitForPaired 截止不受 reconnectNow 重开影响）+ socket 存活时立即
   * pair_status_query 并挂 3s 健康检查（P2-3，官方 recoverConnection 快路径：
   * healthCheckTimeoutMs??3e3 内未回 paired → 主动断开触发重连）。
   */
  notifyVisible(): void {
    if (this.stateValue !== "suspended") return;
    this.emit({ type: "recover-start", state: this.stateValue });
    this.clearTimer(this.recoverTimer);
    this.recoverTimer = this.setTimer(this.timings.recoverWindowMs, () => {
      this.failTerminal({ reason: "connection-recovery-timeout" });
    });
    this.clearTimer(this.healthCheckTimer);
    if (this.transport?.isOpen()) {
      this.sendFrame({
        type: "pair_status_query",
        device_sid: this.options.credential.deviceSid,
        client_ts: this.options.clock.now(),
      });
      this.healthCheckTimer = this.setTimer(this.timings.healthCheckTimeoutMs, () => {
        // 3s 内 matched 回归（suspended+matched 分支）已清本定时器；到点仍挂起 =
        // 死链，主动断开走重连（官方 reconnectNow 语义）。
        if (this.stateValue !== "suspended") return;
        this.closeForReconnect();
      });
    } else {
      this.openTransport();
    }
  }

  /** 桥重放钩子（rpc 通道注册后由 session 在重配对沿调用）。 */
  onResendReady: ((generation: number) => void) | undefined;

  /**
   * 应用帧出口（AppFrameChannel/RpcFrameChannel 装配用）：socket 未就绪时由传输口
   * 静默丢弃（官方 send 语义）；不校验状态——连接面状态机自己负责。
   */
  sendRawText(text: string): void {
    if (!this.ended) this.transport?.sendText(text);
  }

  // —— 状态机内部 ——

  private setState(next: RelaySessionState): void {
    if (this.stateValue === next) return;
    const previous = this.stateValue;
    this.stateValue = next;
    this.options.diagnostics?.({ type: "state-transition", previousState: previous, state: next });
  }

  private setTimer(ms: number, handler: () => void): Timer {
    const handle = this.options.clock.setTimeout(() => {
      this.timers.delete(handle);
      handler();
    }, ms);
    this.timers.add(handle);
    return handle;
  }

  private clearTimer(timer: Timer): void {
    if (timer === undefined) return;
    this.options.clock.clearTimeout(timer);
    this.timers.delete(timer);
  }

  /**
   * 清定时器。preserveRecovery=true 时保留 15s 恢复窗（openTransport 重开连接不得
   * 吞掉 notifyVisible 的恢复截止——官方 waitForPaired 的 15s 跨 reconnectNow 存活）。
   */
  private clearAllTimers(preserveRecovery = false): void {
    // Set 迭代语义允许删除当前/已访问元素（clearTimer 只删正在清的这一项）。
    for (const timer of this.timers) {
      if (preserveRecovery && timer === this.recoverTimer) continue;
      this.clearTimer(timer);
    }
    this.heartbeatTimer = undefined;
    this.heartbeatWatchdog = undefined;
    this.waitingWatchdog = undefined;
    this.offlineGraceTimer = undefined;
    this.healthCheckTimer = undefined;
    this.reconnectTimer = undefined;
    this.authWatchdog = undefined;
    if (!preserveRecovery) this.recoverTimer = undefined;
  }

  private openTransport(): void {
    this.clearAllTimers(this.recoverTimer !== undefined);
    // 新一代 socket：自发关闭标记复位（仅对当前代连接的异常关闭判从未配对终态）。
    this.intentionalClose = false;
    const generation = ++this.transportGen;
    this.setState("connecting");
    const port = this.options.transportFactory({
      url: this.options.url,
      events: {
        onOpen: () => {
          if (generation !== this.transportGen || this.ended) return;
          this.emit({ type: "socket-open", state: this.stateValue });
          this.setState("authenticating");
          this.sendFrame({
            type: "auth_init",
            role: "terminal",
            device_sid: this.options.credential.deviceSid,
            client_ts: this.options.clock.now(),
          });
          // challenge/ack 监督：超时重开连接（宽松重试，relay-server spec §7 ①）。
          this.clearTimer(this.authWatchdog);
          this.authWatchdog = this.setTimer(this.timings.authChallengeTimeoutMs, () => {
            if (this.stateValue === "authenticating") {
              this.intentionalClose = true;
              this.transport?.close();
            }
          });
        },
        onText: (text) => {
          if (generation !== this.transportGen || this.ended) return;
          const frame = this.codec.parseFrame(text);
          if (frame) this.acceptFrame(frame);
        },
        onClose: (info) => {
          if (generation !== this.transportGen || this.ended) return;
          this.emit({
            type: "socket-close",
            code: info.code,
            reason: info.reason,
            wasClean: info.wasClean,
            wasPaired: this.pairedGeneration > 0,
            state: this.stateValue,
          });
          this.handleSocketClosed();
        },
        onError: (message) => {
          if (generation !== this.transportGen || this.ended) return;
          this.emit({ type: "socket-error", state: this.stateValue, message });
          // P1-5②：从未配对过的连接故障按 relay-unavailable 终态，不再无限重连
          //（随后 close 由 failTerminal 终态守卫吸收；配对过仅记诊断，走 close 重连）。
          if (this.pairedGeneration === 0 && this.stateValue !== "suspended") {
            this.failTerminal({
              reason: "relay-unavailable",
              message: message || "relay connection failed before pairing",
            });
          }
        },
      },
    });
    this.transport = port;
    port.connect();
  }

  /**
   * socket 关闭分派（官方 close 监听器 @280952-280962）：挂起态关闭不自动重连
   *（恢复路径处理）；从未配对过且非自发关闭 → relay-unavailable 终态，不再无限
   * 重连；其余走退避重连。
   */
  private handleSocketClosed(): void {
    this.stopHeartbeat();
    if (this.stateValue === "suspended") return;
    if (this.pairedGeneration === 0 && !this.intentionalClose) {
      this.failTerminal({
        reason: "relay-unavailable",
        message: "relay connection closed before pairing",
      });
      return;
    }
    this.scheduleReconnect();
  }

  /** 自发断开并触发重连（挂起健康检查用，官方 reconnectNow 语义）。 */
  private closeForReconnect(): void {
    this.intentionalClose = true;
    // 先迁出 suspended，close 分派的挂起守卫才放行重连。
    this.setState("reconnecting");
    this.transport?.close();
  }

  private scheduleReconnect(): void {
    if (this.ended || this.stateValue === "kicked" || this.stateValue === "error") return;
    this.stopHeartbeat();
    this.setState("reconnecting");
    const delay = Math.min(
      this.timings.reconnectMaxMs,
      this.timings.reconnectBaseMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    this.emit({
      type: "recover-scheduled",
      state: this.stateValue,
      attempt: this.reconnectAttempt,
      delayMs: delay,
    });
    this.clearTimer(this.reconnectTimer);
    this.reconnectTimer = this.setTimer(delay, () => this.openTransport());
  }

  private acceptFrame(frame: RelayWireFrame): void {
    switch (frame.type) {
      case "auth_challenge": {
        void Promise.resolve(
          this.codec.computeProof({
            passHash: this.options.credential.passHash,
            nonce: frame.nonce,
            role: "terminal",
            deviceSid: this.options.credential.deviceSid,
          }),
        ).then((proof) => {
          this.sendFrame({
            type: "auth_response",
            device_sid: this.options.credential.deviceSid,
            proof,
            client_ts: this.options.clock.now(),
          });
        });
        return;
      }
      case "auth_ack":
      case "pair_status_ack": {
        this.applyPairStatus(frame.pair_status);
        return;
      }
      case "data":
        this.options.onPayload?.(frame.payload);
        return;
      case "error": {
        this.options.onError?.(frame.code, frame.message ?? "");
        if (isTerminalKick(frame.code)) {
          // 终态：failTerminal 统一落 kicked 态并拒绝 whenPaired（关 socket/清定时器
          // 都在其内；此处提前 setState 会让 failTerminal 的终态守卫吞掉 onFailure）。
          this.failTerminal({ reason: "session-conflict", message: frame.message });
          return;
        }
        if (isGraceEligibleError(frame.code)) {
          // DEVICE_OFFLINE：15s 宽限，matched 回归即撤销（超时才终态）。
          this.clearTimer(this.offlineGraceTimer);
          this.offlineGraceTimer = this.setTimer(this.timings.desktopOfflineGraceMs, () => {
            this.failTerminal({ reason: "desktop-disconnected", message: frame.message });
          });
          return;
        }
        if (frame.code === "AUTH_FAILED" || frame.code === "WRONG_PARAM") {
          this.failTerminal({ reason: mapRelayErrorToFailure(frame.code), message: frame.message });
          return;
        }
        if (isRelayInternalError(frame.code)) {
          // P1-5③（官方 INTERNAL 分派 @281119-281124）：paired（或曾配对的 waiting）
          // → 迁回 waiting 等桌面回归（本仓 P2-2 语义：停心跳 + 重挂配对窗）；
          // 非 paired → 立即重连（recoverFromRelayInternal）。
          if (
            this.stateValue === "paired" ||
            (this.pairedGeneration > 0 && this.stateValue === "waiting")
          ) {
            this.enterWaiting();
            return;
          }
          this.scheduleReconnect();
          return;
        }
        // 其余未知错误码（官方 default 分支 @281125-281127）：relay-unavailable 终态。
        this.failTerminal({
          reason: mapRelayErrorToFailure(frame.code),
          message: frame.message,
        });
        return;
      }
      default:
        return;
    }
  }

  /**
   * pair_status 分派（官方 hVn.applyPairStatus @281088-281093 对齐）。
   * - 首次 waiting（authenticating 或 paired 丢失后）：停心跳 + 配对窗只挂一次；
   *   停心跳即不再发 pair_status_query，配对进度由服务端 matched 推送驱动
   *   （relay-server attach.statusChanged 主动推送），重复 waiting ack 无帧可答——
   *   P0 乒乓（query↔ack 互驱 + 配对窗反复重挂）由此根除。
   * - waiting 态再收 waiting ack：仅刷新 ack 时刻语义，不动任何定时器。
   * - matched：清全部相关定时器 → paired。
   */
  private applyPairStatus(pairStatus: RelayPairStatus): void {
    const matched = pairStatus === "matched";
    this.lastPairStatusAckAt = this.options.clock.now();
    if (matched) {
      // ack 到达：心跳看门狗解除（下一查询单独重挂）。
      this.clearTimer(this.heartbeatWatchdog);
      this.clearTimer(this.offlineGraceTimer);
    }
    this.emit({ type: "pair-status", pairStatus, state: this.stateValue });
    if (this.stateValue === "suspended") {
      // 挂起恢复：matched 回归 → 清恢复窗 + 3s 健康检查（P2-3）→ paired。
      if (matched) this.enterPaired();
      return;
    }
    switch (this.stateValue) {
      case "authenticating":
        this.clearTimer(this.authWatchdog);
        if (matched) {
          this.enterPaired();
        } else {
          this.enterWaiting();
        }
        return;
      case "waiting":
        if (matched) {
          this.clearTimer(this.waitingWatchdog);
          this.enterPaired();
        }
        // waiting 再收 waiting ack：仅刷新 lastPairStatusAckAt（上方），不清配对窗、
        // 不重启心跳、不重挂配对窗（P0 乒乓修复核心）。
        return;
      case "paired":
        if (!matched) {
          // P2-2（桌面 applyPairStatus waiting 分支迁移语义）：paired → waiting =
          // 桌面离开。迁回 waiting + 停心跳 + 重挂配对窗；桌面回归由服务端 matched
          // 推送驱动（relay-server attach.statusChanged），超时按配对窗终态。
          this.enterWaiting();
        }
        // matched 重申：心跳看门狗已解除（上方），onPaired 生成代数不回退。
        return;
      default:
        return;
    }
  }

  /**
   * 进入 waiting（首次握手或 paired 丢失）：停心跳 + 配对窗挂一次（官方 waiting
   * 分支 stopHeartbeat → setState(waiting) → startWaitingTimer；配对窗不随重复
   * waiting ack 刷新）。
   */
  private enterWaiting(): void {
    this.stopHeartbeat();
    // paired 丢失沿可能残留的宽限/重连定时器一并解除（官方 wasPaired 分支清理面）。
    this.clearTimer(this.offlineGraceTimer);
    this.clearTimer(this.reconnectTimer);
    this.setState("waiting");
    this.clearTimer(this.waitingWatchdog);
    // 官方 waitingTimeoutMs??3e4：配对窗超时 → invalid-mobile-connection 终态。
    this.waitingWatchdog = this.setTimer(this.timings.waitingTimeoutMs, () => {
      this.failTerminal({ reason: "invalid-mobile-connection" });
    });
  }

  private enterPaired(): void {
    // matched 回归：恢复窗 + 3s 健康检查一并解除（P2-3；挂起恢复与重连恢复共用）。
    this.clearTimer(this.recoverTimer);
    this.clearTimer(this.healthCheckTimer);
    this.setState("paired");
    this.reconnectAttempt = 0;
    this.pairedGeneration += 1;
    const firstPair = this.pairedGeneration === 1;
    this.options.diagnostics?.({
      type: "pair-status",
      pairStatus: "matched",
      state: "paired",
    });
    this.startHeartbeat();
    const resolve = this.pairedResolve;
    this.pairedResolve = undefined;
    if (firstPair) resolve?.();
    this.options.onPaired?.({ generation: this.pairedGeneration });
    // 官方 applyPairStatus：非首次配对即 onSendReady → 重放未确认 rpc 帧。
    if (!firstPair) this.onResendReady?.(this.pairedGeneration);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const tick = () => {
      this.sendFrame({
        type: "pair_status_query",
        device_sid: this.options.credential.deviceSid,
        client_ts: this.options.clock.now(),
      });
      // ack 看门狗：30s 无 ack 按死链强制重开（官方 heartbeat ack 超时语义）。
      // 只在无未决看门狗时挂——后续 query 不解除上一查询的监督，否则"从未收到
      // ack"的半开连接永远判不出来（ack 到达时统一清除，见 applyPairStatus）。
      if (this.heartbeatWatchdog === undefined) {
        this.heartbeatWatchdog = this.setTimer(this.timings.heartbeatAckTimeoutMs, () => {
          this.heartbeatWatchdog = undefined;
          this.intentionalClose = true;
          this.transport?.close();
        });
      }
      const delay = jitterDelay(
        this.timings.heartbeatIntervalMs,
        this.timings.heartbeatJitterMs,
        this.random,
      );
      this.heartbeatTimer = this.setTimer(this.timings.heartbeatIntervalMs + delay, tick);
    };
    tick();
  }

  private stopHeartbeat(): void {
    this.clearTimer(this.heartbeatTimer);
    this.clearTimer(this.heartbeatWatchdog);
  }

  private sendFrame(frame: RelayWireFrame): void {
    this.transport?.sendText(this.codec.serializeFrame(frame));
  }

  private emit(diagnostic: RelayDiagnostic): void {
    this.options.diagnostics?.(diagnostic);
  }

  /** 终态失败：只发一次；停一切定时器并关 socket（state=error/kicked 不再重连）。 */
  private failTerminal(failure: RelayFailure): void {
    if (this.stateValue === "error" || this.stateValue === "kicked" || this.ended) return;
    // 先关 socket 再清定时器：close 的同步 onClose 分派（handleSocketClosed）在终态
    // 置位前运行，可能挂上重连定时器（彼时 state 尚非 error/kicked），清定时器必须
    // 兜底在其后收回，否则终态后仍会重连。
    this.intentionalClose = true;
    this.transport?.close();
    this.clearAllTimers();
    this.setState(failure.reason === "session-conflict" ? "kicked" : "error");
    this.options.onFailure?.(failure);
    const reject = this.pairedReject;
    this.pairedReject = undefined;
    this.pairedResolve = undefined;
    reject?.(failure);
  }
}
