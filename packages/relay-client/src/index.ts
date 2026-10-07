// Drora Relay Client · 公开入口与装配门面（terminal 角色，specs/mobile-relay-r3-frontend.md D3/D8）。
// 消费方 = 自建移动页（@drora/mobile-web）与 node 集成测试；浏览器装配示例：
//   const client = createRelayClient({
//     url: "wss://host/ws",
//     credential: { deviceSid, passHash },
//     transportFactory: createWebSocketTransportFactory(WebSocket),
//     clock: systemClock,
//   });
// 平台差异全部经 ports 注入（transport/codec/clock）；线协议纯逻辑单一出处
// = @drora/shared relay-wire（spec D2/P1），本包只承载有状态会话语义。
import { systemClock } from "./clock.js";
export type {
  RelayClockPort,
  RelayTimerHandle,
  RelayTransportEvents,
  RelayTransportFactory,
  RelayTransportPort,
  RelayWireCodecPort,
} from "./ports.js";
export {
  systemClock,
  MAX_PHYSICAL_FRAME_BYTES,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_JITTER_MS,
  DEFAULT_HEARTBEAT_ACK_TIMEOUT_MS,
  DEFAULT_RECONNECT_BASE_MS,
  DEFAULT_RECONNECT_MAX_MS,
  DEFAULT_WAITING_TIMEOUT_MS,
  DEFAULT_DESKTOP_OFFLINE_GRACE_MS,
  DEFAULT_RECOVER_WINDOW_MS,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS,
  jitterDelay,
} from "./clock.js";
export * from "./types.js";
export { createJsonWireCodec, parseRelayWireFrame } from "./codec.js";
export { createWebSocketTransportFactory, type WebSocketLike } from "./transportBinding.js";
export {
  AppFrameChannel,
  measureAppFrameEnvelope,
  type RelayDataEnvelope,
} from "./appFrameChannel.js";
export {
  RpcFrameChannel,
  type RpcFrameChannelEvents,
  type RpcFrameChannelOptions,
  type RpcMessageHandler,
} from "./rpcFrameChannel.js";
export { mapRelayErrorToFailure, isRelayInternalError } from "./errorMapping.js";
export {
  RelaySession,
  defaultSessionTimings,
  type RelaySessionOptions,
  type RelaySessionTimings,
} from "./relaySession.js";

import { measureAppFrameEnvelope } from "./appFrameChannel.js";
import { AppFrameChannel } from "./appFrameChannel.js";
import { RpcFrameChannel } from "./rpcFrameChannel.js";
import { RelaySession, type RelaySessionOptions } from "./relaySession.js";
import type { RelayClockPort, RelayTimerHandle } from "./ports.js";

/**
 * RelayClient 装配选项（RelaySession 选项全量直通）。
 */
export interface RelayClientOptions extends RelaySessionOptions {
  /**
   * 桥通道时钟（P1-2 ack-grace 看门狗定时器 + 重放缓冲时间戳共用；缺省
   * systemClock = 全局 setTimeout/clearTimeout/Date.now）。测试注入手控时钟。
   */
  bridgeClock?: RelayClockPort;
}

/**
 * RelayClient = RelaySession（连接/配对/重连）+ AppFrameChannel（应用帧）+
 * 桥注册表（rpc-frame 通道）。所有权：连接/配对状态在本包；业务数据在桌面 Host
 * （AGENTS.md 不变量）——本包不缓存任何任务/会话状态。
 */
export class RelayClient {
  readonly session: RelaySession;
  readonly frames: AppFrameChannel;
  private readonly bridges = new Map<string, RpcFrameChannel>();
  /** 每桥一个 ack-grace 看门狗句柄（桥销毁/降级即解除）。 */
  private readonly graceWatchdogs = new Map<string, RelayTimerHandle>();
  private readonly bridgeClock: RelayClockPort;
  /** 自增桥代数（P1-4：每 client 实例从 1 起；显式传参时跳过自增）。 */
  private nextBridgeGeneration = 1;

  constructor(options: RelayClientOptions) {
    this.bridgeClock = options.bridgeClock ?? systemClock;
    this.frames = new AppFrameChannel({
      now: () => Date.now(),
      sendText: (text) => this.session.sendRawText(text),
    });
    this.session = new RelaySession({
      ...options,
      onPayload: (payload) => this.acceptPayload(payload),
    });
  }

  connect(): void {
    this.session.connect();
  }

  disconnect(): void {
    this.clearBridgeResources();
    this.session.dispose();
  }

  /** 等待配对（四步卡第 3 步的完成信号；终态失败 reject）。 */
  whenPaired(): Promise<void> {
    return this.session.whenPaired();
  }

  /** bootstrap（四步卡第 4 步数据）：null = 超时/失败，页面按失败面降级。 */
  bootstrap(timeoutMs = 20_000): Promise<Record<string, unknown> | null> {
    return this.frames.request({ zcode_type: "bootstrap-request" }, timeoutMs, setTimeout).response;
  }

  /** 工作区清单（首页分组列表数据源）。 */
  listWorkspaces(timeoutMs = 20_000): Promise<Record<string, unknown> | null> {
    return this.frames.request({ zcode_type: "workspace-list-request" }, timeoutMs, setTimeout)
      .response;
  }

  /**
   * 打开工作区桥：发送 workspace-bridge-open，等待 bridge-ready/error 回声。
   * ready → 注册 rpc-frame 通道；error/超时 → 抛出（reason=官方失败卡词汇）。
   *
   * P1-4：bridgeSessionId 由客户端生成（`bridge-<uuid>`，匹配 shared
   * TRANSPORT_ID_PATTERN）随 open 请求上行；桌面 openWorkspaceBridge 原样回显
   * identity（desktopMobileRelayControl `String(frame.bridgeSessionId ?? "")`），
   * ready 按 bridgeSessionId 匹配注册（旧端不回显时按生成 id 兜底）。
   * bridgeGeneration 缺省自增（每实例从 1 起），显式传参覆盖（恢复路径）。
   */
  async openWorkspaceBridge(params: {
    workspaceKey: string;
    taskId?: string;
    bridgeGeneration?: number;
    recoveryId?: string;
    timeoutMs?: number;
  }): Promise<RpcFrameChannel> {
    const bridgeSessionId = `bridge-${globalThis.crypto.randomUUID()}`;
    const bridgeGeneration = params.bridgeGeneration ?? this.nextBridgeGeneration++;
    const identity = {
      bridgeSessionId,
      bridgeGeneration,
      ...(params.recoveryId ? { recoveryId: params.recoveryId } : {}),
    };
    const bridge = new RpcFrameChannel(
      {
        identity,
        sendAppFrame: (payload) => {
          this.frames.send(payload);
        },
        measureEnvelopeBytes: (payload) => measureAppFrameEnvelope(payload, Date.now()),
        // 重放缓冲时间戳与 grace 看门狗同一时钟域（测试注入手控时钟）。
        now: () => this.bridgeClock.now(),
      },
      {
        onDegraded: (reasonCode) => {
          this.clearGraceWatchdog(identity.bridgeSessionId);
          this.onBridgeDegraded?.(identity.bridgeSessionId, reasonCode);
        },
        onSaturationChange: (saturated) => {
          this.onBridgeSaturationChange?.(identity.bridgeSessionId, saturated);
        },
        // P1-2：按最旧未确认批次挂 ack-grace 看门狗（桌面 armBridgeGraceTimer 同式：
        // deadline+grace(+1ms 判定边界)-now）；null = 排空解除。
        onGraceDeadline: (oldestQueuedAtMs) => {
          this.armGraceWatchdog(identity.bridgeSessionId, oldestQueuedAtMs);
        },
      },
    );
    bridge.onMessage = (message) => this.onBridgeMessage?.(identity.bridgeSessionId, message);
    // P4b E2E 实证（spec §17）：Host Initialize 在 bridge-ready 回声**之前**到达
    // （真 host 附着即发）——桥通道必须先于 open 请求注册，否则桥内字节被
    // bridges 注册表静默丢弃、页面 ChannelClient 永久等握手。
    this.bridges.set(bridgeSessionId, bridge);
    // 重新配对沿（onSendReady）：重放全部未降级桥的未确认帧（官方 applyPairStatus 语义）。
    this.session.onResendReady = () => {
      for (const channel of this.bridges.values()) channel.replayUnacknowledged();
    };
    const response = await this.frames.request(
      {
        zcode_type: "workspace-bridge-open",
        workspaceKey: params.workspaceKey,
        bridgeSessionId,
        bridgeGeneration,
        ...(params.taskId ? { taskId: params.taskId } : {}),
        ...(params.recoveryId ? { recoveryId: params.recoveryId } : {}),
      },
      params.timeoutMs ?? 30_000,
      setTimeout,
    ).response;
    if (!response) {
      this.releaseBridge(bridgeSessionId);
      throw new Error("workspace bridge open timed out");
    }
    if (response.zcode_type === "workspace-bridge-error") {
      this.releaseBridge(bridgeSessionId);
      const reason = typeof response.reason === "string" ? response.reason : "unexpected-error";
      throw new Error(`workspace bridge error: ${reason}`);
    }
    if (response.zcode_type !== "workspace-bridge-ready") {
      this.releaseBridge(bridgeSessionId);
      throw new Error("unexpected bridge response");
    }
    // 回声 id 校验：桌面原样回显生成 id；不一致按错误处理（防跨桥错配）。
    const echoId = typeof response.bridgeSessionId === "string" ? response.bridgeSessionId : "";
    if (echoId && echoId !== bridgeSessionId) {
      this.releaseBridge(bridgeSessionId);
      throw new Error("workspace bridge ready identity mismatch");
    }
    return bridge;
  }

  /** 桥内完整 rpc 消息出口（协议适配层消费：ChannelClient 字节流）。 */
  onBridgeMessage: ((bridgeSessionId: string, message: Uint8Array) => void) | undefined;

  /** 桥终态降级上抛（页面诊断面；reasonCode = 官方 remote.rpcFrame.* 词汇）。 */
  onBridgeDegraded: ((bridgeSessionId: string, reasonCode: string) => void) | undefined;

  /** 桥饱和状态变化上抛（页面诊断面：越过高水位/回落低水位）。 */
  onBridgeSaturationChange: ((bridgeSessionId: string, saturated: boolean) => void) | undefined;

  /** 取消桥注册（桥重建/离开任务面）。 */
  releaseBridge(bridgeSessionId: string): void {
    this.clearGraceWatchdog(bridgeSessionId);
    this.bridges.get(bridgeSessionId)?.dispose();
    this.bridges.delete(bridgeSessionId);
  }

  /** 手机视图状态上报（桌面 mobileViewState 投影，bootstrap/workspace-list 回显）。 */
  reportViewState(viewState: Record<string, unknown>): void {
    this.frames.send({ zcode_type: "mobile-view-state-update", viewState });
  }

  /** 手机端诊断事件（桌面侧只记日志，白名单见 desktopMobileRelayControl）。 */
  reportDiagnostic(detail: Record<string, unknown>): void {
    this.frames.send({ zcode_type: "mobile-diagnostic", ...detail });
  }

  /** data 信封计量（rpc 通道水位口径同源）。 */
  static readonly measureEnvelope = measureAppFrameEnvelope;

  private acceptPayload(payload: Record<string, unknown>): void {
    if (payload.zcode_type === "rpc-frame") {
      // 按 bridgeSessionId 路由到桥通道（未注册的桥帧静默丢弃，桌面 handleRpcFrame
      // 的 bridge 校验同款）。
      const bridgeSessionId = String(payload.bridgeSessionId ?? "");
      this.bridges.get(bridgeSessionId)?.acceptFrame(payload);
      return;
    }
    if (payload.zcode_type === "rpc-frame-ack") {
      const bridgeSessionId = String(payload.bridgeSessionId ?? "");
      this.bridges.get(bridgeSessionId)?.acceptAck(payload);
      return;
    }
    this.frames.acceptIncoming(payload);
  }

  /**
   * ack-grace 看门狗：有未确认批次 → 按 oldestQueuedAt+graceMs(+1ms 判定边界，
   * RelayReplayBuffer.graceExceeded 为严格大于) 挂定；到点经 channel.graceExceeded
   * 复核成立 → degradeAckGrace（终态降级，桌面 armBridgeGraceTimer 同语义）。
   */
  private armGraceWatchdog(bridgeSessionId: string, oldestQueuedAtMs: number | null): void {
    this.clearGraceWatchdog(bridgeSessionId);
    if (oldestQueuedAtMs === null) return;
    const channel = this.bridges.get(bridgeSessionId);
    if (!channel || channel.degraded) return;
    const delayMs = Math.max(
      0,
      oldestQueuedAtMs + channel.graceMs + 1 - this.bridgeClock.now(),
    );
    const handle = this.bridgeClock.setTimeout(() => {
      this.graceWatchdogs.delete(bridgeSessionId);
      const current = this.bridges.get(bridgeSessionId);
      if (!current || current.degraded) return;
      if (!current.graceExceeded(this.bridgeClock.now())) return;
      current.degradeAckGrace();
    }, delayMs);
    // 看门狗不阻止进程退出（桌面 timer.unref 同款；非 node 句柄无 unref 时忽略）。
    (handle as { unref?: () => void }).unref?.();
    this.graceWatchdogs.set(bridgeSessionId, handle);
  }

  private clearGraceWatchdog(bridgeSessionId: string): void {
    const handle = this.graceWatchdogs.get(bridgeSessionId);
    if (handle === undefined) return;
    this.bridgeClock.clearTimeout(handle);
    this.graceWatchdogs.delete(bridgeSessionId);
  }

  private clearBridgeResources(): void {
    for (const bridgeSessionId of this.graceWatchdogs.keys()) {
      this.clearGraceWatchdog(bridgeSessionId);
    }
    for (const bridge of this.bridges.values()) bridge.dispose();
    this.bridges.clear();
  }
}

/** 装配入口（选项直通 RelaySession；onFailure 同时作为终态失败出口）。 */
export function createRelayClient(options: RelayClientOptions): RelayClient {
  return new RelayClient(options);
}
