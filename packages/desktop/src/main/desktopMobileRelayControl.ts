// 移动端远程控制·官方 relay 云中继客户端（M4a，spec: mobile-web-remote.md）。
// 复用 z.ai 官方 relay（wss://zcode.z.ai/ws）与托管手机页（remote/v4）实现跨网络远控；
// 协议常量/纯逻辑见 desktopMobileRelayProtocol.ts（逐项取证并经最小探测复核）。
// 边界：relay 只做转发；官方可随时变更协议——本传输与 LAN 直连并存，弹层内可选。
/* eslint-disable max-lines -- 传输状态机/心跳/应用帧路由集中在一个生命周期单元里，
   与 botsService/desktopMainIpcPlatform 同例；纯协议逻辑已拆至 RelayProtocol 模块。 */
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { basename } from "node:path";
import type { MessagePortMain, UtilityProcess } from "electron";
import { messagePortFlowControl, type MessagePortFlowState } from "@drora/rpc";
import type {
  MobilePairingFailure,
  MobilePairingRuntimeState,
  MobileRelayTaskSyncEntry,
  MobileRelayTransport,
  MobileRelayWorkspaceSyncEntry,
} from "@drora/shared";
import {
  // 遥测维度纯函数（shared 单一出处，还原官方同名 helper，见各调用点偏移）。
  classifyRemoteUsageError,
  resolveWorkspaceTelemetryDetail,
} from "@drora/shared";
import {
  RpcFrameAssembler,
  buildRpcFrameAck,
  createRelayReplayBuffer,
  encodeRpcTransportMessage,
  parseRpcTransportFrame,
  toExternalBridge,
  HEARTBEAT_ACK_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_JITTER_MAX_MS,
  QR_READY_TIMEOUT_MS,
  RECONNECT_DELAY_MS,
  RELAY_REPLAY_DEGRADED_ACK_GRACE,
  RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED,
  RELAY_REPLAY_DEGRADED_FUTURE_ACK,
  OFFICIAL_REMOTE_PAGE_URL,
  OFFICIAL_RELAY_WS_URL,
  OFFICIAL_REMOTE_PAGE_APP_VERSION,
  buildRelayQrUrl,
  calculateRelayProof,
  createRelayPassword,
  derivePassHash,
  mapTransportState,
  isBridgeableRemoteTarget,
  mapWorkspaceBridgeFailureReason,
  mergeRuntimeWorkspace,
  normalizeRelayAttachError,
  RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE,
  relayWorkspaceKey,
  buildBootstrapResult,
  buildWorkspaceListResult,
  type RelayDeviceCredential,
  type RelayReplayBuffer,
  type RpcFrameIdentity,
  type RelayMobileViewState,
  type RelayTaskSummary,
  type RelayTransportState,
  type RelayWorkspaceSummary,
} from "./desktopMobileRelayProtocol.js";
import { createMobileServiceAttacher } from "./desktopMobileServiceAttach.js";
import { serveMobilePageAction, type MobilePageActionFrame } from "./desktopMobilePageBridge.js";

// —— 宿主：relay 控制器 ——

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error", listener: (...args: unknown[]) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
};

type WebSocketCtor = new (
  url: string,
  options: {
    perMessageDeflate: boolean;
    headers: Record<string, string>;
  },
) => WebSocketLike;

/**
 * 凭据仓结构面（specs/mobile-relay-server.md §12.2）：装配处注入按 effective origin
 * 路由的凭据仓（云端/LAN 内嵌 sid 命名空间独立），测试注入单文件仓——都只需这三个方法。
 */
export interface RelayCredentialStoreLike {
  load(): Promise<RelayDeviceCredential | null>;
  save(credential: RelayDeviceCredential): Promise<void>;
  clear(): Promise<void>;
}

/** 端点解析入参：transport 告知装配处本次启动走云中继还是内嵌 LAN relay。 */
export interface RelayEndpointRequest {
  transport: MobileRelayTransport;
}

export function createDesktopMobileRelayControl(deps: {
  logger: Logger;
  deviceMid: string;
  credentialStore: RelayCredentialStoreLike;
  resolveHostChild: () => UtilityProcess | null;
  onStatusChanged?: (state: MobilePairingRuntimeState) => void;
  /**
   * 手机页 platform-request 可调用的桌面平台方法（对齐官方 platformHandlers 注册表）：
   * docker/wsl/ssh 列表、临时附件、MCP 配置读写。装配处复用 main IPC 同名实现。
   */
  platformHandlers?: Record<string, (args: unknown) => Promise<unknown>>;
  /** 手机遥测事件转发（对齐官方 reportRendererTelemetryEvent）；缺省仅记日志。 */
  reportPhoneTelemetryEvent?: (event: unknown) => Promise<void>;
  /**
   * 动态端点解析（specs/mobile-relay-server.md §8/§12）：每次 start 时调用，读设置键
   * relayServerUrl（→ env → 官方默认）；transport=lan 时装配处返回内嵌 relay 的固定
   * 注入端点。返回 undefined 则沿用固定注入端点。
   */
  resolveEndpoints?: (request: RelayEndpointRequest) => Promise<
    | {
        relayWsUrl: string;
        remotePageUrl: string;
      }
    | undefined
  >;
  /**
   * 桌面用量遥测（对齐官方 reportRemoteUsageEvent）：配对/桥/启动结果事件族
   * （web_remote_control_start_result / pair_result / bridge_result）经此上报。
   */
  reportUsageEvent?: (event: {
    elementName: string;
    eventRegion: string;
    eventType: string;
    eventExtraDetail: Record<string, string>;
  }) => void;
  /**
   * 重启自动恢复的持久化上下文（对齐官方 startupRestoreStorageProvider）：
   * start 成功 save、手动 stop clear、应用重启后经 restorePreviouslyEnabled 恢复。
   * context.transport（specs/mobile-relay-server.md §12.4）：按记录的传输恢复对应链路。
   */
  startupRestoreStorage?: {
    load(): Promise<{
      workspacePath: string;
      workspaceIdentity?: string;
      transport?: MobileRelayTransport;
    } | null>;
    save(context: {
      workspacePath: string;
      workspaceIdentity?: string;
      transport?: MobileRelayTransport;
    }): Promise<void>;
    clear(): Promise<void>;
  };
  /**
   * 测试注入 WebSocket 构造器与端点；生产用 ws 包与官方端点。
   * 显式传 null = 模拟"构造器不可用"（require ws 失败的生产形态），测试快速失败路径；
   * 缺省（undefined）= 懒加载 ws 包。
   */
  webSocketCtor?: WebSocketCtor | null;
  relayWsUrl?: string;
  remotePageUrl?: string;
  /**
   * 桥附着端口构造注入（测试：plain node 无 electron MessageChannelMain 无法真实
   * 开桥）；生产不注入 = attacher.attachBridgePort 走 electron 创建路径。
   * 允许返回 Promise（对齐官方 attachWorkspaceHost 为异步附着，index.js@396694：
   * await 后校验 superseded）——测试用挂起的 Promise 制造异步窗口。
   */
  attachBridgePort?: () => MessagePortMain | Promise<MessagePortMain>;
  /**
   * 远程工作区开桥的 remote-scoped attach（M4c，对齐官方 attachWorkspaceHost 远程
   * 分支 index.js@584400 → attachRemoteWorkspaceSessionHost @577400）：按
   * remoteSessionId 在 Main 远程连接注册表校验（REMOTE_SESSION_MISSING/OFFLINE/
   * WINDOW_MISMATCH、REMOTE_WORKSPACE_IDENTITY_MISMATCH，错误码与官方同名）后向
   * 窗口 Host 发 scope kind=remote 的附着端口。装配处接 remoteSessionManager。
   */
  attachRemoteBridgePort?: (params: {
    remoteSessionId: string;
    workspacePath: string;
    workspaceIdentity: string;
  }) => { port: MessagePortMain; remoteKind: string };
  /**
   * 手机 workspace-reconnect-request 的重连委托（对齐官方 e.reconnectWorkspace =
   * reconnectWebRemoteControlWorkspaceInRenderer，index.js@409793）：main 经 IPC
   * 请属主窗口 renderer 重连远程工作区（重连事实归窗口），拒绝/超时/失败以
   * rejection 传递，message 原样回手机（官方 respondToWorkspaceReconnectRequest
   * @399799 语义：success:false + error）。
   */
  reconnectWorkspace?: (workspaceKey: string) => Promise<void>;
  /**
   * 重放缓冲参数注入（M4c 测试缩短 graceMs / 缩小水位；生产缺省 = 官方常量，
   * 见 protocol 常量区：1MiB/256KiB/8MiB/45s）。
   */
  replayBufferOptions?: {
    graceMs?: number;
    highWaterMarkBytes?: number;
    lowWaterMarkBytes?: number;
    maxBytes?: number;
  };
  /**
   * 出站应用帧硬上限注入（测试 envelopeTooLarge 降级路径；生产缺省 = 官方
   * maxPhysicalFrameBytes 1MiB）。
   */
  maxAppFrameBytes?: number;
}) {
  const logger = deps.logger;
  // 出站应用帧硬上限（对齐官方 maxPhysicalFrameBytes=1MiB，取证 chunk-GJUBRD53.js et 表；
  // 测试可注入缩小以驱动 envelopeTooLarge 路径）。
  const MAX_APP_FRAME_BYTES = deps.maxAppFrameBytes ?? 1024 * 1024;
  // 生产未注入时回退到 ws 包（测试注入 fake 构造器走纯逻辑路径；显式 null =
  // 模拟构造器不可用，驱动 connect() 的快速失败分支）。
  // 懒 require：与 electron 懒加载同法，保持模块在 plain node 下的可测性。
  const WebSocketCtor: WebSocketCtor | null =
    deps.webSocketCtor !== undefined
      ? deps.webSocketCtor
      : (() => {
          try {
            const requireNode = createRequire(import.meta.url);
            const loaded = requireNode("ws") as unknown as WebSocketCtor & {
              WebSocket?: WebSocketCtor;
            };
            return loaded.WebSocket ?? loaded;
          } catch {
            return null;
          }
        })();
  const relayWsUrl = deps.relayWsUrl ?? OFFICIAL_RELAY_WS_URL;
  const remotePageUrl = deps.remotePageUrl ?? OFFICIAL_REMOTE_PAGE_URL;
  /**
   * 动态端点解析（specs/mobile-relay-server.md §8）：设置键 relayServerUrl / env
   * 优先于固定注入——设置在启动后才可变，必须每次 start 时解析。
   * 返回 undefined 则回落固定注入值（默认官方）。
   */
  let effectiveRelayWsUrl = relayWsUrl;
  let effectiveRemotePageUrl = remotePageUrl;
  const attacher = createMobileServiceAttacher({
    resolveHostChild: deps.resolveHostChild,
    logger,
  });

  let socket: WebSocketLike | null = null;
  let manuallyClosed = true;
  let terminalError = false;
  let transportState: RelayTransportState = "idle";
  let credential: RelayDeviceCredential | null = null;
  let authMode: "register" | "persisted" = "register";
  let invalidPersistedRetryUsed = false;
  let socketGeneration = 0;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatAckWatchdog: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let lastPairStatusAckAt = 0;
  let startParams: {
    workspacePath: string;
    workspaceIdentity?: string;
    transport: MobileRelayTransport;
  } | null = null;
  let mobileViewState: RelayMobileViewState | undefined;
  /** 手机端设备信息（mobile-view-state-update 携带；对齐官方 mobileDeviceInfo）。 */
  let mobileDeviceInfo: Record<string, unknown> | undefined;
  /** M4b rpc 桥：手机页 workspace-bridge-open 建立，端口直连窗口 Host 附着。 */
  let bridge: {
    identity: RpcFrameIdentity;
    workspaceKey: string;
    initialTaskId?: string;
    port: Electron.MessagePortMain;
    assembler: RpcFrameAssembler;
    outboundAssemblerSeq: number;
    outboundMessageSeq: number;
    readyAnnounced: boolean;
    pendingOutbound: Uint8Array[];
    /** M4c 发送侧流控/重放：已发送未确认批次的簿记（官方 AcknowledgedRelayProtocol）。 */
    replayBuffer: RelayReplayBuffer;
    /** 终态降级（官方 enterDegraded）：后续 sendFrame 拒绝、入站帧丢弃。 */
    degraded: boolean;
    /** grace 看门狗（官方 deadline）：有未确认批次时挂定，超时 → 终态降级。 */
    graceTimer: NodeJS.Timeout | null;
  } | null = null;
  let runtimeFailure: MobilePairingFailure | null = null;
  let qrUrl: string | null = null;
  let qrReadyWaiter: (() => void) | null = null;
  /** 注册凭据的落盘 promise；start 就绪前必须等它（对齐原版 start 路径 await save）。 */
  let pendingCredentialSave: Promise<void> | null = null;

  function runtimeState(): MobilePairingRuntimeState {
    return {
      running: manuallyClosed === false,
      status: mapTransportState(transportState),
      connected: transportState === "paired",
      url: qrUrl,
      workspacePath: startParams?.workspacePath ?? null,
      workspaceIdentity: startParams?.workspaceIdentity ?? null,
      failure: runtimeFailure,
      // 弹层按传输过滤状态推送（specs/mobile-relay-server.md §12.4：两传输共用控制
      // 链，未运行时为 null）。
      transport: startParams?.transport ?? null,
    };
  }

  function emitStatus(): void {
    deps.onStatusChanged?.(runtimeState());
  }

  function transition(next: RelayTransportState): void {
    if (transportState === next) return;
    transportState = next;
    if (next !== "error") runtimeFailure = null;
    // pair_result 随状态沿上报（对齐官方 mapTransportState nI，index.js@401850-402465）：
    // paired→success；kicked/error→failure+error_category="relay"；pair_kind 取
    // hasEverPaired 活值（官方在 paired 沿 emit 之后才 hasEverPaired=!0，因此首次
    // 配对为 initial）。kicked/error 与状态同值早退保证每沿至多一次。
    if (next === "paired") {
      pairResultEvent("success", "", hasEverPaired ? "reconnect" : "initial");
      hasEverPaired = true;
    } else if (next === "kicked" || next === "error") {
      pairResultEvent("failure", "relay", hasEverPaired ? "reconnect" : "initial");
    }
    emitStatus();
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatAckWatchdog) {
      clearTimeout(heartbeatAckWatchdog);
      heartbeatAckWatchdog = null;
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // 用量遥测事件（对齐官方 Af 信封构造，取证 chunk-GJUBRD53.js@741857：
  // {elementName, eventRegion:"web_remote_control", eventType, eventExtraDetail}）。
  // 2026-09-28 修正：eventRegion 此前误写 "result"，官方信封恒为 "web_remote_control"。
  function emitUsageEvent(elementName: string, extra: Record<string, string>): void {
    try {
      deps.reportUsageEvent?.({
        elementName,
        eventRegion: "web_remote_control",
        eventType: "result",
        eventExtraDetail: extra,
      });
    } catch {
      // 遥测失败不影响主链路
    }
  }

  /**
   * 运行时工作区遥测维度（对齐官方 resolveRuntimeWorkspaceDimensions，取证
   * index.js@387232：workspaceKind = identity||remoteSessionId ? "remote" : "local"、
   * remoteKind = parseRemoteWorkspaceIdentity(identity)?.kind）。shared 的
   * resolveWorkspaceTelemetryDetail 为该 helper 的逐字还原，单一出处。
   */
  function runtimeWorkspaceDims(): { workspace_kind: "local" | "remote"; remote_kind: string } {
    return resolveWorkspaceTelemetryDetail({
      workspaceIdentity: startParams?.workspaceIdentity ?? null,
      remoteSessionId: null,
    });
  }

  /**
   * pair_result（对齐官方 cee 构造 chunk-GJUBRD53.js@742450 + mapTransportState
   * 状态沿调用 index.js@401850-402465）：pairKind 由调用方显式传入——官方在
   * paired 沿 emit 时 hasEverPaired 尚未置位（nI 内 emit 后才 hasEverPaired=!0），
   * 不能在构造函数里读活值。
   */
  function pairResultEvent(
    result: "success" | "failure",
    errorCategory: string,
    pairKind: "initial" | "reconnect",
  ): void {
    const dims = runtimeWorkspaceDims();
    emitUsageEvent("web_remote_control_pair_result", {
      result,
      error_category: result === "success" ? "" : errorCategory || "unknown",
      pair_kind: pairKind,
      workspace_kind: dims.workspace_kind,
      remote_kind: dims.remote_kind,
    });
  }

  /**
   * start_result（对齐官方 see 构造 chunk-GJUBRD53.js@742235 + runStartOperation
   * 调用点 index.js@658155：StartWebRemoteControl IPC 完成沿上发，成功/失败都发，
   * 失败面 errorCategory=classifyRemoteUsageError）。dims 由调用方传入——官方在
   * start 上下文入口解析（@658168），而本仓 start 失败路径会先 stop() 清空
   * startParams，emit 时再解析会丢维度。
   */
  function startResultEvent(
    result: "success" | "failure",
    error: unknown,
    dims: { workspace_kind: "local" | "remote"; remote_kind: string },
  ): void {
    emitUsageEvent("web_remote_control_start_result", {
      result,
      error_category: result === "success" ? "" : classifyRemoteUsageError(error),
      workspace_kind: dims.workspace_kind,
      remote_kind: dims.remote_kind,
    });
  }

  /**
   * 桥结果遥测（对齐官方 lee 构造 chunk-GJUBRD53.js@742684 + createWorkspaceBridge
   * 调用点 index.js@398405/398537）：workspaceKind 取目标工作区 kind、entryKind 按
   * taskId 区分 task/home；remoteKind 官方经 resolveRemoteKind（index.js@387052）
   * 解析——remote 目标优先 attach 结果的 remoteKind，缺失回退 workspaceIdentity
   * 解析，非远程恒空（ctor 对 undefined 落空串）。
   */
  function bridgeResultEvent(
    result: "success" | "failure",
    errorCategory?: string,
    dimensions?: {
      workspaceKind?: "local" | "remote";
      entryKind?: "task" | "home";
      remoteKind?: string;
    },
  ): void {
    emitUsageEvent("web_remote_control_bridge_result", {
      result,
      error_category: result === "success" ? "" : (errorCategory ?? "unknown"),
      workspace_kind: dimensions?.workspaceKind ?? "local",
      remote_kind: dimensions?.remoteKind ?? "",
      entry_kind: dimensions?.entryKind ?? "home",
    });
  }

  /**
   * 官方 resolveRemoteKind 同构（index.js@387052：`if(kind==="remote") return
   * attach?.remoteKind ?? (workspaceIdentity ? parse(workspaceIdentity)?.kind : void 0)`）。
   * attach 结果来自远程连接注册表（RemoteTarget.kind，desktopRemoteSessions.ts），
   * identity 解析兜底覆盖 attach 未发生/失败的路径（未连接拒绝面、附着失败面）。
   */
  function resolveTargetRemoteKind(
    target: { kind: string; workspaceIdentity?: string; remoteSessionId?: string },
    attachedRemoteKind?: string,
  ): string {
    if (target.kind !== "remote") return "";
    if (attachedRemoteKind) return attachedRemoteKind;
    return resolveWorkspaceTelemetryDetail({
      workspaceIdentity: target.workspaceIdentity ?? null,
      remoteSessionId: target.remoteSessionId ?? null,
    }).remote_kind;
  }

  // stale-waiting 恢复（对齐官方 scheduleStaleWaitingRecovery/reconnectAfterStaleWaiting）：
  // 手机离开进入 waiting 15s 后仍未配对，或反复抖动，则重连设备 socket 重置会话。
  function clearStaleWaitingRecoveryTimer(): void {
    if (staleWaitingRecoveryTimer) {
      clearTimeout(staleWaitingRecoveryTimer);
      staleWaitingRecoveryTimer = null;
    }
  }

  function scheduleStaleWaitingRecovery(): void {
    if (staleWaitingRecoveryTimer) return;
    const timer = setTimeout(() => {
      staleWaitingRecoveryTimer = null;
      if ((transportState === "paired" || staleWaitingCount > 0) && !manuallyClosed) {
        reconnectAfterStaleWaiting();
      }
    }, STALE_WAITING_RECOVERY_MS);
    timer.unref?.();
    staleWaitingRecoveryTimer = timer;
  }

  function reconnectAfterStaleWaiting(): void {
    clearStaleWaitingRecoveryTimer();
    stopHeartbeat();
    clearReconnectTimer();
    staleWaitingCount = 0;
    wasPaired = false;
    logger.warn("[mobile-relay] stale waiting，重连", { transportState });
    reconnect(0);
  }

  function jitterDelay(base: number, max: number): number {
    return Math.floor(Math.random() * Math.min(max, Math.floor(base * 0.2) + 1));
  }

  function armHeartbeatAckWatchdog(): void {
    if (transportState !== "paired" && transportState !== "waiting_terminal") return;
    if (heartbeatAckWatchdog) clearTimeout(heartbeatAckWatchdog);
    heartbeatAckWatchdog = setTimeout(() => {
      heartbeatAckWatchdog = null;
      if (transportState !== "paired" && transportState !== "waiting_terminal") return;
      const staleMs = Date.now() - lastPairStatusAckAt;
      logger.warn("[mobile-relay] heartbeat ack 超时，重连", { state: transportState, staleMs });
      reconnect();
    }, HEARTBEAT_ACK_TIMEOUT_MS);
    heartbeatAckWatchdog.unref?.();
  }

  function scheduleHeartbeat(): void {
    if (heartbeatTimer) return;
    const tick = () => {
      heartbeatTimer = null;
      if (!credential || (transportState !== "paired" && transportState !== "waiting_terminal")) {
        return;
      }
      send({
        type: "pair_status_query",
        device_sid: credential.deviceSid,
        client_ts: Date.now(),
      });
      heartbeatTimer = setTimeout(
        tick,
        HEARTBEAT_INTERVAL_MS + jitterDelay(HEARTBEAT_INTERVAL_MS, HEARTBEAT_JITTER_MAX_MS),
      );
      heartbeatTimer.unref?.();
    };
    heartbeatTimer = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  function startHeartbeat(): void {
    armHeartbeatAckWatchdog();
    scheduleHeartbeat();
  }

  function send(message: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * 应用帧下行分发结果：sent=已交给 socket；oversize=超限拒收（官方 Q sendFrame
   * 抛 envelopeTooLarge → 终态降级，index.js@397000 附近）；not-ready=socket 未就绪。
   */
  type AppFrameDispatch =
    | { status: "sent"; bytes: number }
    | { status: "oversize" }
    | { status: "not-ready" };

  /**
   * 应用帧下行（对齐原版 routePayload 的 M4a 子集；frame 自带 zcode_type）。
   * 桥出站 rpc-frame 以 sent.bytes 做 outerBytes 计量（对齐官方 measureFrameBytes
   * 口径），oversize/not-ready 供桥发送侧区分处置。
   */
  function dispatchAppFrame(frame: Record<string, unknown>): AppFrameDispatch {
    // 出站应用帧信封逐字段对齐官方 payloadSerializer（取证 chunk-C6VCYWB4.js）：
    // {type:"data", payload, client_ts}。relay 消息族一律要求 client_ts——缺字段时
    // 裸帧被 WRONG_PARAM 拒收；有 type 缺 client_ts 则被接受但静默不转发给手机端
    // （2026-09-27 真机取证：页面收不到 bootstrap-response 而无限重试）。
    const message = { type: "data", payload: frame, client_ts: Date.now() };
    const json = JSON.stringify(message);
    // 字节数而非码元数（中文 3 字节/字），对齐官方 TextEncoder byteLength 度量。
    const jsonBytes = Buffer.byteLength(json, "utf8");
    if (jsonBytes > MAX_APP_FRAME_BYTES) {
      // 对齐官方 isOversize 拒收（maxPhysicalFrameBytes=1MiB，取证 et 常量表）：
      // 超限帧 warn 并丢弃——relay 会整帧丢弃，发了也到不了手机。
      logger.warn("[mobile-relay] rejected oversize app payload", {
        zcodeType: frame.zcode_type,
        bytes: jsonBytes,
        maxBytes: MAX_APP_FRAME_BYTES,
      });
      return { status: "oversize" };
    }
    logger.info("[mobile-relay] 出站应用帧", {
      zcodeType: frame.zcode_type,
      bytes: jsonBytes,
      ...(frame.zcode_type === "bootstrap-response" ||
      frame.zcode_type === "workspace-list-response"
        ? {
            workspaces: (
              frame.result as { workspaces?: Array<{ workspacePath: string }> }
            )?.workspaces?.map((w) => w.workspacePath),
          }
        : {}),
    });
    return send(message) ? { status: "sent", bytes: jsonBytes } : { status: "not-ready" };
  }

  /** 应用帧下行（字节计量口径；0 = 超限拒收或 socket 未就绪未发出）。 */
  function sendAppFrame(frame: Record<string, unknown>): number {
    const dispatched = dispatchAppFrame(frame);
    return dispatched.status === "sent" ? dispatched.bytes : 0;
  }

  function reconnect(delayMs = RECONNECT_DELAY_MS): void {
    stopHeartbeat();
    clearReconnectTimer();
    const old = socket;
    socket = null;
    try {
      old?.close();
    } catch {
      // 已关闭属正常路径
    }
    if (manuallyClosed || terminalError) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!manuallyClosed && !terminalError) connect();
    }, delayMs);
    reconnectTimer.unref?.();
  }

  // —— 多工作区聚合（spec M4a：对齐官方 syncWebRemoteControlWorkspaces/Tasks）——
  // 事实源 = renderer 推送（tab 变化时经 IPC 同步窗口全部工作区/任务摘要），
  // main 在 relay start 时灌入缓存；推送到达时向已配对手机广播
  // workspace-list-updated。官方 getAvailableWorkspaces = 推送清单 + 运行时目标。
  let syncedWorkspaces: MobileRelayWorkspaceSyncEntry[] = [];
  let syncedTasks: MobileRelayTaskSyncEntry[] = [];
  let restoredThisRun = false;
  // stale-waiting 恢复状态（对齐官方 applyPairStatus/scheduleStaleWaitingRecovery）。
  let wasPaired = false;
  // pair_result 的 pair_kind 维度旗标（对齐官方运行时 hasEverPaired，index.js@404928
  // 仅在 start 建会话时置 false、paired 沿置 true，stale 恢复重连不重置——与 stale
  // 探测旗标 wasPaired（reconnectAfterStaleWaiting 会重置，index.js@382894）是两个
  // 变量，不可合并：合并会让 stale 恢复后的重配误报 initial）。
  let hasEverPaired = false;
  // 上次配对成功时的 socket 代（官方 lastPairedSocketGeneration）：0=尚未配对过。
  // matched 时非 0 即非首次配对 → onSendReady（same-socket/reconnected-socket）→ 重放。
  let lastPairedSocketGeneration = 0;
  let staleWaitingCount = 0;
  let staleWaitingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const STALE_WAITING_RECOVERY_MS = 15_000;
  let lastWorkspaceListFingerprint: string | null = null;

  function syncAvailableWorkspaces(workspaces: MobileRelayWorkspaceSyncEntry[]): void {
    // 空推送防护（2026-09-29 回归修复）：renderer 重载/标签恢复窗口会推送空快照；
    // relay 会话附着在真实工作区上，"无工作区"不是有效状态——运行中忽略空推送，
    // 避免把 syncedWorkspaces 清空（手机页 list 的工作区分组随之消失，实锤见
    // specs/mobile-relay-server.md「R2 list workspaces:0」）。非空推送保持官方
    // replace 语义；下次正常推送仍会覆盖本清单。
    if (workspaces.length === 0 && startParams) {
      logger.warn("[mobile-relay] 忽略空工作区推送（保持当前清单）", {
        workspacePath: startParams.workspacePath,
      });
      return;
    }
    syncedWorkspaces = workspaces;
    pushWorkspaceListUpdatedIfChanged();
  }

  function syncAvailableTasks(tasks: MobileRelayTaskSyncEntry[]): void {
    syncedTasks = tasks;
    pushWorkspaceListUpdatedIfChanged();
  }

  /** 对齐官方 pushWorkspaceListUpdated：指纹变化才向已配对手机广播清单更新。 */
  function pushWorkspaceListUpdatedIfChanged(): void {
    const workspace = currentWorkspaceSummary();
    if (!workspace || transportState !== "paired") return;
    const result = buildWorkspaceListResult({
      workspaces: currentWorkspaceSummaries(),
      fallbackWorkspace: workspace,
      tasks: currentTaskSummaries(),
      mobileViewState,
    });
    const fingerprint = JSON.stringify(result);
    if (fingerprint === lastWorkspaceListFingerprint) return;
    lastWorkspaceListFingerprint = fingerprint;
    sendAppFrame({ zcode_type: "workspace-list-updated", result });
  }

  function currentWorkspaceSummaries(): RelayWorkspaceSummary[] {
    return syncedWorkspaces.map((entry) => ({
      workspacePath: entry.workspacePath,
      ...(entry.workspaceIdentity ? { workspaceIdentity: entry.workspaceIdentity } : {}),
      ...(entry.remoteSessionId ? { remoteSessionId: entry.remoteSessionId } : {}),
      label: entry.label || basename(entry.workspacePath) || entry.workspacePath,
      kind: entry.kind,
      connectionState: entry.connectionState ?? "connected",
    }));
  }

  function currentTaskSummaries(): RelayTaskSummary[] {
    // 对齐官方 isBridgeableRemoteTask：远程工作区任务须带 identity+remoteSessionId
    // 才可桥接/读取，缺失者从手机任务清单剔除。
    return syncedTasks
      .filter((entry) => !entry.remoteSessionId || Boolean(entry.workspaceIdentity))
      .map((entry) => ({
        taskId: entry.taskId,
        title: entry.title,
        status: "",
        updatedAt: entry.updatedAt,
        workspacePath: entry.workspacePath,
        workspaceLabel: basename(entry.workspacePath) || entry.workspacePath,
        workspaceKind: entry.remoteSessionId || entry.workspaceIdentity ? "remote" : "local",
        createdAt: entry.createdAt,
      }));
  }

  async function fetchTaskSummaries(): Promise<RelayTaskSummary[]> {

    // startParams 为可变闭包变量，await 之后 TS 丢失收窄——先固化到局部。
    const params = startParams;
    if (!params) return [];
    // renderer 已推送跨工作区任务摘要（官方 syncWebRemoteControlTasks）时直接采用。
    if (syncedTasks.length > 0) return currentTaskSummaries();
    try {
      const { task } = attacher.ensure();
      const [tasks, pinnedIds, archivedMetas] = await Promise.all([
        task.listTasks({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        }),
        task.listPinnedTaskIds(),
        task.listArchivedTasks({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        }),
      ]);
      const pinnedSet = new Set(pinnedIds);
      const archivedSet = new Set(archivedMetas.map((m) => String(m.taskId)));
      const workspaceLabel = basename(params.workspacePath) || params.workspacePath;
      return tasks.map((meta) => ({
        taskId: String(meta.taskId ?? ""),
        title: String(meta.title ?? ""),
        status: String(meta.status ?? ""),
        updatedAt: Number(meta.updatedAt ?? 0),
        workspacePath: params.workspacePath,
        workspaceLabel,
        workspaceKind: "local" as const,
        createdAt: Number(meta.createdAt ?? 0),
        pinned: pinnedSet.has(String(meta.taskId)),
        archived: archivedSet.has(String(meta.taskId)),
        unreadAt: meta.unreadAt,
      }));
    } catch (error) {
      logger.warn("[mobile-relay] 任务列表拉取失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  function currentWorkspaceSummary(): RelayWorkspaceSummary | null {
    if (!startParams) return null;
    return {
      workspacePath: startParams.workspacePath,
      ...(startParams.workspaceIdentity
        ? { workspaceIdentity: startParams.workspaceIdentity }
        : {}),
      label: basename(startParams.workspacePath) || startParams.workspacePath,
      kind: "local",
      connectionState: "connected",
    };
  }

  /** Host 端口二进制 → rpc-frame 封装 → relay（ready 前先缓冲）。 */
  function forwardHostBytesToPhone(bytes: Uint8Array): void {
    // 终态降级：静默丢弃（对齐官方 reserveMessage 的 degraded 早退）。
    if (!bridge || bridge.degraded) return;
    if (!bridge.readyAnnounced) {
      bridge.pendingOutbound.push(bytes);
      return;
    }
    flushBridgeOutbound(bytes);
  }

  function flushBridgeOutbound(extra?: Uint8Array): void {
    if (!bridge) return;
    const batch = extra
      ? [...bridge.pendingOutbound.splice(0), extra]
      : bridge.pendingOutbound.splice(0);
    for (const bytes of batch) {
      // 终态降级：后续 sendFrame 拒绝（对齐官方 enterDegraded 后的发送早退）。
      if (bridge.degraded) break;
      try {
        const encoded = encodeRpcTransportMessage({
          message: bytes,
          identity: bridge.identity,
          firstPhysicalSeq: bridge.outboundAssemblerSeq,
          messageSeq: bridge.outboundMessageSeq,
        });
        bridge.outboundAssemblerSeq = encoded.nextPhysicalSeq;
        const messageSeq = bridge.outboundMessageSeq;
        bridge.outboundMessageSeq += 1;
        let outerBytes = 0;
        let fullySent = true;
        for (const frame of encoded.frames) {
          const dispatched = dispatchAppFrame(frame as unknown as Record<string, unknown>);
          if (dispatched.status === "oversize") {
            // 发送侧超限（M4c，官方 Q 的 sendFrame 取证 index.js@397000 附近）：
            // 显式抛 envelopeTooLarge 而非静默丢帧——协议侧语义为终态降级。
            enterBridgeDegraded(RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE);
            fullySent = false;
            break;
          }
          if (dispatched.status !== "sent") {
            fullySent = false;
            break;
          }
          outerBytes += dispatched.bytes;
        }
        if (!fullySent) {
          // 消息不完整未上线（超限拒收/socket 未就绪）：不入重放缓冲，与改动前丢帧行为一致。
          continue;
        }
        // 发送后逐批 reserve（M4c 定案顺序；官方为先入队后 flush）。未确认字节记账
        // 是 ack 释放、水位与 grace 看门狗的依据。
        const wasSaturated = bridge.replayBuffer.saturated;
        const reserved = bridge.replayBuffer.reserve(messageSeq, outerBytes, encoded.frames);
        if (reserved.overflow) {
          // 缓冲超限（官方 replayBufferExceeded → enterDegraded，批次不入队不记账）。
          enterBridgeDegraded(RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED);
          break;
        }
        if (!wasSaturated && reserved.saturated) {
          logger.warn("[mobile-relay] 桥未确认字节越过饱和高水位", {
            unackedBytes: bridge.replayBuffer.unacknowledgedBytes,
            bridgeSessionId: bridge.identity.bridgeSessionId,
          });
          // 宿主背压（M4c，官方 createWorkspaceBridge 接线取证 index.js@397846）：
          // onSaturated 沿向 Host 附着端口发 flow-state "saturated"，Host 侧
          // （host/index.ts onFlowState → setTransportFlowState）暂停 CLI 出站。
          sendBridgeFlowState("saturated");
        }
        armBridgeGraceTimer();
      } catch (error) {
        // 超限/编码失败：丢帧并记日志（对齐原版 degraded 语义的保守子集，不拆桥）。
        logger.warn("[mobile-relay] rpc-frame 编码失败，丢弃该消息", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function clearBridgeGraceTimer(): void {
    if (bridge?.graceTimer) {
      clearTimeout(bridge.graceTimer);
      bridge.graceTimer = null;
    }
  }

  /**
   * grace 看门狗（官方 deadline 语义）：按最旧未确认批次挂定时，armBridgeGraceTimer
   * 在每次 reserve/ack 后重挂（对齐官方 deadline.refresh）；无未确认批次时解除。
   */
  function armBridgeGraceTimer(): void {
    if (!bridge || bridge.degraded) return;
    clearBridgeGraceTimer();
    const oldestQueuedAt = bridge.replayBuffer.oldestQueuedAt();
    if (oldestQueuedAt === null) return;
    const delayMs = Math.max(0, oldestQueuedAt + bridge.replayBuffer.graceMs - Date.now());
    const timer = setTimeout(() => {
      if (!bridge || bridge.degraded) return;
      if (!bridge.replayBuffer.graceExceeded()) return;
      enterBridgeDegraded(RELAY_REPLAY_DEGRADED_ACK_GRACE);
    }, delayMs);
    timer.unref?.();
    bridge.graceTimer = timer;
  }

  /**
   * 桥终态降级（对齐官方 enterDegraded）：清重放缓冲与看门狗，后续 sendFrame 拒绝、
   * 入站帧丢弃。不发 app-error、不拆桥——页面上层靠超时失败面恢复（官方接线同款）。
   */
  function enterBridgeDegraded(reason: string): void {
    if (!bridge || bridge.degraded) return;
    bridge.degraded = true;
    clearBridgeGraceTimer();
    bridge.replayBuffer.clear();
    logger.warn("[mobile-relay] 桥终态降级，后续 rpc 帧拒绝", {
      reason,
      bridgeSessionId: bridge.identity.bridgeSessionId,
    });
  }

  function disposeBridge(): void {
    if (!bridge) return;
    clearBridgeGraceTimer();
    bridge.replayBuffer.clear();
    try {
      bridge.port.close();
    } catch {
      // 已关闭属正常路径
    }
    bridge = null;
  }

  /**
   * 开桥请求代（M4c superseded 判定）：对齐官方 currentBridge 槽位语义
   * （isCurrentBridgeRuntime v，index.js@388704）——异步预热/附着完成后校验本请求
   * 仍是最新开桥请求，被更新请求取代（superseded）则释放端口并回错误。
   */
  let bridgeOpenEpoch = 0;

  /**
   * workspace-bridge-open：附着 Host 端口并双向接管 rpc 帧（对齐原版
   * createWorkspaceBridge，index.js@395979）。M4c 起支持远程工作区：可桥判定、
   * remote-scoped attach、superseded 校验、reason 词汇表逐项对齐官方。
   */
  async function openWorkspaceBridge(frame: Record<string, unknown>): Promise<void> {
    const requestId = frame.requestId;
    const bridgeSessionId = String(frame.bridgeSessionId ?? "");
    const bridgeGeneration =
      typeof frame.bridgeGeneration === "number" ? frame.bridgeGeneration : undefined;
    const recoveryId = typeof frame.recoveryId === "string" ? frame.recoveryId : undefined;
    const initialTaskId = typeof frame.taskId === "string" ? frame.taskId : undefined;
    const identity: RpcFrameIdentity = {
      bridgeSessionId,
      ...(bridgeGeneration !== undefined ? { bridgeGeneration } : {}),
      ...(recoveryId ? { recoveryId } : {}),
    };
    bridgeOpenEpoch += 1;
    const myEpoch = bridgeOpenEpoch;
    const respondError = (
      reason: string,
      error: string,
      dims?: {
        workspaceKind?: "local" | "remote";
        entryKind?: "task" | "home";
        remoteKind?: string;
      },
    ) => {
      sendAppFrame({
        zcode_type: "workspace-bridge-error",
        requestId,
        ...identity,
        reason,
        error,
      });
      bridgeResultEvent("failure", reason, dims);
    };
    if (!startParams || transportState !== "paired") {
      respondError("desktop-disconnected", "relay session is not paired");
      return;
    }
    const workspaceKey = String(frame.workspaceKey ?? "");
    // 多工作区目标解析（对齐官方 getAvailableWorkspaces 合并语义，index.js@393711：
    // 推送清单为基集 + 运行时目标不缺席，按 workspaceKey 查找）。
    const runtimeTarget = currentWorkspaceSummary();
    const target =
      syncedWorkspaces.find((entry) => relayWorkspaceKey(entry) === workspaceKey) ??
      (runtimeTarget && relayWorkspaceKey(runtimeTarget) === workspaceKey
        ? runtimeTarget
        : undefined);
    // 未知工作区（官方 Q 校验一，无 code → FW 映射 unexpected-error，
    // 文案取官方原文 index.js@395979）。
    if (!target) {
      respondError(
        mapWorkspaceBridgeFailureReason(new Error()),
        "目标工作区不在当前桌面窗口中，无法创建 Web 远程控制 bridge。",
      );
      return;
    }
    // 可桥判定（官方 isBridgeableRemoteTarget pl @385786）：远程工作区须带
    // workspaceIdentity+remoteSessionId（即已连接代理），否则要求先重连。
    if (!isBridgeableRemoteTarget(target)) {
      respondError(
        mapWorkspaceBridgeFailureReason(new Error()),
        "目标远程工作区尚未连接，无法创建 bridge，请先重连。",
        {
          workspaceKind: "remote",
          // 未连接即 attach 未发生：remote_kind 走 identity 解析兜底（官方
          // resolveRemoteKind index.js@387052 的 fallback 支路）。
          remoteKind: resolveTargetRemoteKind(target),
        },
      );
      return;
    }
    // 预热目标工作区的 CLI 运行时（M4b 自研步骤，官方无）：手机页随后的
    // sessions-index 订阅与 readSession 都是 existing-only/需要活运行时，冷工作区
    // 会直接 "runtime is not running"/"Session is not active"。listSessions
    // 默认 start-if-needed——既拉起运行时又拿到该工作区的权威会话清单。
    // 20s 兜底：预热失败不阻塞开桥（手机端按各自错误面重试）。
    // 仅本地工作区执行：远程 scope 的服务面在 remote attach 端口上，本地 Host 的
    // agent.listSessions 覆盖不到远程路径。
    if (target.kind !== "remote") {
      try {
        const { agent } = attacher.ensure();
        await Promise.race([
          agent.listSessions({
            workspacePath: target.workspacePath,
            ...(target.workspaceIdentity || startParams.workspaceIdentity
              ? {
                  workspaceIdentity: target.workspaceIdentity ?? startParams.workspaceIdentity,
                }
              : {}),
          }),
          new Promise((resolve) => setTimeout(resolve, 20_000)),
        ]);
      } catch (error) {
        logger.warn("[mobile-relay] 开桥预热运行时失败，继续开桥", {
          workspaceKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // superseded 校验一（预热 await 之后；对齐官方 attach 后校验位）。
      if (myEpoch !== bridgeOpenEpoch) {
        respondError(
          mapWorkspaceBridgeFailureReason(new Error()),
          "Workspace bridge request was superseded.",
        );
        return;
      }
    }
    disposeBridge();
    let port: MessagePortMain;
    let remoteKind: string | undefined;
    try {
      if (target.kind === "remote") {
        // remote-scoped attach（官方 attachWorkspaceHost 远程分支 @584400）：按
        // remoteSessionId 经 Main 远程连接注册表校验后附着远程 Host 服务面。
        // 未注入（装配缺位）与注册表拒绝（未连接/窗口不符/身份不匹配）都按
        // Error.code 映射官方 reason 词汇表。
        if (!deps.attachRemoteBridgePort) {
          throw new Error("remote-scoped attach is not wired for this relay control");
        }
        const attached = deps.attachRemoteBridgePort({
          remoteSessionId: target.remoteSessionId ?? "",
          workspacePath: target.workspacePath,
          workspaceIdentity: target.workspaceIdentity ?? "",
        });
        port = attached.port;
        remoteKind = attached.remoteKind;
      } else {
        // 测试注入端口（plain node 无 electron MessageChannelMain）；生产走 electron
        // 创建。注入可返回挂起 Promise（对齐官方异步附着，测试制造 superseded 窗口）。
        port = await (deps.attachBridgePort
          ? deps.attachBridgePort()
          : attacher.attachBridgePort());
      }
    } catch (error) {
      // 附着失败（官方 Q catch）：release 后回 bridge-error，reason 按 Error.code
      // 经 FW 词汇表映射（DESKTOP_HOST_MISSING→desktop-disconnected、
      // REMOTE_SESSION_*→workspace-closed、REMOTE_WORKSPACE_IDENTITY_*→unsupported-action）。
      logger.warn("[mobile-relay] workspace bridge attach 失败", {
        bridgeSessionId,
        workspaceKey,
        error: error instanceof Error ? error.message : String(error),
      });
      const normalized = normalizeRelayAttachError(error);
      respondError(
        mapWorkspaceBridgeFailureReason(normalized),
        normalized instanceof Error ? normalized.message : String(normalized),
        {
          workspaceKind: target.kind === "remote" ? "remote" : "local",
          // attach 失败无 attach remoteKind：identity 解析兜底（官方 catch 面
          // wc({remoteKind:i(T,te)}) 在 te 缺失时同走 fallback，index.js@398537）。
          remoteKind: resolveTargetRemoteKind(target),
        },
      );
      return;
    }
    // superseded 校验二（异步附着完成之后，官方 index.js@396694：isCurrentBridgeRuntime
    // 不满足 → release attachment + throw superseded；此处等价为本请求已被更新
    // 请求取代——关掉本请求的端口并回错误，不覆盖新桥）。
    if (myEpoch !== bridgeOpenEpoch) {
      try {
        port.close();
      } catch {
        // 已关闭属正常路径
      }
      respondError(
        mapWorkspaceBridgeFailureReason(new Error()),
        "Workspace bridge request was superseded.",
        {
          workspaceKind: target.kind === "remote" ? "remote" : "local",
          // 异步附着已完成：attach remoteKind 可用（官方 superseded 失败面同款，
          // index.js@396694 → catch 统一 emit）。
          remoteKind: resolveTargetRemoteKind(target, remoteKind),
        },
      );
      return;
    }
    port.on("message", (event: { data: unknown }) => {
      const data = event.data;
      // 只转发二进制；流控 sideband 对象（__droraRpcControl）不进 relay。
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : null;
      if (bytes) forwardHostBytesToPhone(bytes);
    });
    port.start();
    bridge = {
      identity,
      workspaceKey,
      ...(initialTaskId ? { initialTaskId } : {}),
      port,
      assembler: new RpcFrameAssembler(identity),
      outboundAssemblerSeq: 1,
      outboundMessageSeq: 1,
      readyAnnounced: false,
      pendingOutbound: [],
      // M4c 发送侧流控/重放：常量对齐官方（1MiB/256KiB/8MiB/45s）；graceMs 可注入缩短（测试）。
      replayBuffer: createRelayReplayBuffer({
        graceMs: deps.replayBufferOptions?.graceMs,
        highWaterMarkBytes: deps.replayBufferOptions?.highWaterMarkBytes,
        lowWaterMarkBytes: deps.replayBufferOptions?.lowWaterMarkBytes,
        maxBytes: deps.replayBufferOptions?.maxBytes,
      }),
      degraded: false,
      graceTimer: null,
    };
    const targetKind = target.kind === "remote" ? "remote" : "local";
    sendAppFrame({
      zcode_type: "workspace-bridge-ready",
      requestId,
      ...identity,
      bridge: toExternalBridge({
        identity,
        workspaceKey,
        // bridge-ready 如实携带被桥接的工作区（多工作区下可能是推送清单中的任一工作区）；
        // 远程桥附 workspaceIdentity+remoteSessionId（官方 toExternalBridge zW @386100）。
        workspacePath: target.workspacePath,
        ...(initialTaskId ? { initialTaskId } : {}),
        kind: targetKind,
        ...(targetKind === "remote"
          ? {
              workspaceIdentity: target.workspaceIdentity ?? "",
              remoteSessionId: target.remoteSessionId ?? "",
            }
          : {}),
      }),
    });
    bridge.readyAnnounced = true;
    flushBridgeOutbound();
    bridgeResultEvent("success", undefined, {
      workspaceKind: targetKind,
      // 官方 entryKind=taskId?"task":"home"（lee 构造调用 index.js@398405）。
      entryKind: initialTaskId ? "task" : "home",
      // remote_kind 已填充（2026-09-28 缺口收口）：attach 结果优先/identity 解析
      // 兜底，官方 resolveRemoteKind 同构（index.js@387052）。
      remoteKind: resolveTargetRemoteKind(target, remoteKind),
    });
    logger.info("[mobile-relay] workspace bridge 已建立", {
      bridgeSessionId,
      workspaceKey,
      kind: targetKind,
      ...(remoteKind ? { remoteKind } : {}),
    });
  }

  /**
   * workspace-reconnect-request 真实处理（M4c，对齐官方
   * respondToWorkspaceReconnectRequest，lt，index.js@399799）：委托属主窗口
   * renderer 重连该远程工作区（官方 e.reconnectWorkspace → IPC
   * zcode:web-remote-control-reconnect-workspace；重连事实归窗口），成功回
   * `{zcode_type, requestId, workspaceKey, success:true}`，任何失败回
   * `success:false + error=错误消息`——官方无独立 reason 字段，requestId 与
   * workspaceKey 必须回显（手机页按两者匹配响应，托管页取证 @6086587；
   * success:false 时页面 throw Error(error) 走失败面）。
   */
  async function respondToWorkspaceReconnectRequest(frame: Record<string, unknown>): Promise<void> {
    const requestId = frame.requestId;
    const workspaceKey = frame.workspaceKey;
    try {
      if (!deps.reconnectWorkspace) {
        throw new Error("workspace reconnect is not available on this desktop build");
      }
      if (typeof workspaceKey !== "string" || !workspaceKey.trim()) {
        throw new Error("workspace reconnect request is missing workspaceKey");
      }
      await deps.reconnectWorkspace(workspaceKey);
      sendAppFrame({
        zcode_type: "workspace-reconnect-response",
        requestId,
        workspaceKey,
        success: true,
      });
    } catch (error) {
      sendAppFrame({
        zcode_type: "workspace-reconnect-response",
        requestId,
        workspaceKey,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** rpc-frame 入站：重组 → Host 端口；完整消息回 ack（对端流控依赖）。 */
  function handleRpcFrame(value: unknown): void {
    // 终态降级：入站帧丢弃（官方 acceptPayload 的 degraded 早退）。
    if (!bridge || bridge.degraded) return;
    const frame = parseRpcTransportFrame(value);
    if (!frame) return;
    const assembled = bridge.assembler.accept(frame);
    if (!assembled) return;
    sendAppFrame(
      buildRpcFrameAck({ identity: bridge.identity, ackMessageSeq: assembled.messageSeq }),
    );
    bridge.port.postMessage(Buffer.from(assembled.message));
  }

  /**
   * rpc-frame-ack 入站：releaseThrough 释放未确认批次并降水位（官方 processAck）。
   * future-ack → 终态降级；饱和回落低水位发 flow-state "drained" 恢复 Host 发送。
   */
  function handleRpcFrameAck(frame: Record<string, unknown>): void {
    if (!bridge || bridge.degraded) return;
    const ackMessageSeq = frame.ackMessageSeq;
    if (typeof ackMessageSeq !== "number" || !Number.isSafeInteger(ackMessageSeq)) return;
    const result = bridge.replayBuffer.ack(ackMessageSeq);
    if (result.futureAck) {
      enterBridgeDegraded(RELAY_REPLAY_DEGRADED_FUTURE_ACK);
      return;
    }
    if (result.drained) {
      logger.info("[mobile-relay] 桥未确认字节回落到排空低水位", {
        unackedBytes: bridge.replayBuffer.unacknowledgedBytes,
        bridgeSessionId: bridge.identity.bridgeSessionId,
      });
      // 宿主背压解除（M4c，官方 createWorkspaceBridge 接线取证 index.js@397922）：
      // onDrained 沿向 Host 附着端口发 flow-state "drained"，Host 恢复 CLI 出站。
      sendBridgeFlowState("drained");
    }
    // 官方 deadline.refresh：按剩余最旧未确认批次重挂看门狗（释放完则解除）。
    armBridgeGraceTimer();
  }

  /**
   * 宿主背压 sideband（M4c）：经桥附着端口发 connection-flow-v1 控制对象。
   *
   * 线格式与走向（官方 3.14.3 取证，specs/mobile-web-remote.md「flow-state sideband」）：
   * MessagePortProtocol.sendFlowState（chunk-BMP2VTTL.js@7872）postMessage
   * {__zcodeRpcControl:"connection-flow-v1", state:"saturated"|"drained"}——官方
   * 字面量为 __zcodeRpcControl，本仓按改名规则用 __droraRpcControl（rpc 包
   * messagePortFlowControl 工厂，单一出处）。这是 main→Host 本地 sideband，
   * 不进 relay 数据面；护栏对齐官方事件接线（index.js@397846/397922）：
   * 桥存活且未降级才发。
   */
  function sendBridgeFlowState(state: MessagePortFlowState): void {
    if (!bridge || bridge.degraded) return;
    try {
      bridge.port.postMessage(messagePortFlowControl(state));
    } catch (error) {
      // sideband 失败不影响数据面（Host 侧靠下一次水位沿自行恢复一致）。
      logger.warn("[mobile-relay] flow-state 发送失败", {
        state,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * onSendReady 重放（M4c）：设备 socket 重连/重新配对后全量重发未确认帧。
   *
   * 官方依据（3.14.3，main index.js）：
   * - 触发：applyPairStatus matched 分支（@379650）——非首次配对
   *   （lastPairedSocketGeneration>0）即 onSendReady({kind:"same-socket"|"reconnected-socket"})；
   * - 处理（@404240）：flushPendingOutboundPayloads 后
   *   `currentBridge.relayProtocol.replayUnacknowledged()`（@404330，degraded 跳过）。
   * 记账语义（chunk-C6VCYWB4.js@12892）：resetReplay+flushPendingFrames——只重发，
   * 不重新 reserve、不改未确认水位、不刷新 grace 看门狗（queuedAt 不变）。
   * 顺序：先重放旧批次再 flush 新 pending（官方 flushPendingFrames 按 reserve
   * 顺序出帧，旧在前）。
   */
  function replayUnacknowledgedForBridge(): void {
    if (!bridge || bridge.degraded) return;
    const frames = bridge.replayBuffer.replayFrames();
    if (frames.length === 0) {
      flushBridgeOutbound();
      return;
    }
    logger.info("[mobile-relay] onSendReady：重发未确认 rpc 帧", {
      frames: frames.length,
      unackedBytes: bridge.replayBuffer.unacknowledgedBytes,
      bridgeSessionId: bridge.identity.bridgeSessionId,
    });
    try {
      for (const frame of frames) {
        // 终态降级中途出现（理论上重放路径不触发）：停止保留剩余批次。
        if (bridge.degraded) return;
        // 与首次发送同路径同编码；帧内 messageSeq/seq 不变（重放语义）。
        // 重放遇超限与首次发送同罚：enterDegraded（官方 sendFrame 抛 envelopeTooLarge）。
        const dispatched = dispatchAppFrame(frame as unknown as Record<string, unknown>);
        if (dispatched.status === "oversize") {
          enterBridgeDegraded(RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE);
          return;
        }
        if (dispatched.status !== "sent") return;
      }
    } catch (error) {
      logger.warn("[mobile-relay] 重放发送失败，保留缓冲待下次 onSendReady", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    flushBridgeOutbound();
  }

  async function handleAppFrame(frame: Record<string, unknown>): Promise<void> {
    const zcodeType = frame.zcode_type;
    if (zcodeType !== "telemetry-report" && zcodeType !== "mobile-diagnostic") {
      // 调试可见性：非噪音应用帧逐条记录（手机侧失败定位第一手证据）。
      logger.info("[mobile-relay] 入站应用帧", { zcodeType, requestId: frame.requestId });
    }
    switch (zcodeType) {
      case "bootstrap-request": {
        const workspace = currentWorkspaceSummary();
        if (!workspace || !credential) {
          sendAppFrame({
            zcode_type: "bootstrap-response",
            requestId: frame.requestId,
            success: false,
            error: "workspace context is not available",
          });
          return;
        }
        const tasks = await fetchTaskSummaries();
        sendAppFrame({
          zcode_type: "bootstrap-response",
          requestId: frame.requestId,
          success: true,
          result: buildBootstrapResult({
            deviceSid: credential.deviceSid,
            // 手机页用 desktopAppVersion 构造规范化 URL（重载即按该版本请求页面资源），
            // 真实版本 0.0.1 不在托管页白名单会 404——relay 协议面统一上报还原协议版本。
            appVersion: OFFICIAL_REMOTE_PAGE_APP_VERSION,
            workspaces: currentWorkspaceSummaries(),
            fallbackWorkspace: workspace,
            tasks,
            mobileViewState,
          }),
        });
        return;
      }
      case "workspace-list-request": {
        const workspace = currentWorkspaceSummary();
        if (!workspace) {
          sendAppFrame({
            zcode_type: "workspace-list-response",
            requestId: frame.requestId,
            success: false,
            error: "workspace context is not available",
          });
          return;
        }
        const tasks = await fetchTaskSummaries();
        sendAppFrame({
          zcode_type: "workspace-list-response",
          requestId: frame.requestId,
          success: true,
          result: buildWorkspaceListResult({
            workspaces: currentWorkspaceSummaries(),
            fallbackWorkspace: workspace,
            tasks,
            mobileViewState,
          }),
        });
        return;
      }
      case "drora-page-request": {
        // 自建手机页动作帧（R2，specs/mobile-relay-server.md）：v1 动作 → 服务调用
        // （serveMobilePageAction 共享单一实现，LAN 同款）；Host 缺失等错误回
        // ok:false 结果帧，页面按各自失败面降级。
        const requestId = frame.requestId;
        const pageFrame = (frame as { frame?: MobilePageActionFrame }).frame;
        if (!pageFrame || !startParams) {
          sendAppFrame({
            zcode_type: "drora-page-response",
            requestId,
            success: false,
            error: "workspace context is not available",
          });
          return;
        }
        try {
          const fallbackWorkspace = currentWorkspaceSummary();
          // list 动作 = 全工作区任务聚合（对齐官方 getAvailableTasks 语义）：
          // renderer 已推送跨工作区任务摘要（syncedTasks）时直接采用；
          // 否则（如设置页场景无推送）回落启动工作区的单工作区清单。
          // list 不强制附着 Host——缓存可答时纯快照响应，Host 重启/附着窗口期
          // 手机页清单不闪断（回落 listTasks 的路径自带 Host 容错）。
          if (pageFrame.type === "list") {
            sendAppFrame({
              zcode_type: "drora-page-response",
              requestId,
              success: true,
              frame: {
                type: "taskList",
                tasks: syncedTasks.length > 0 ? currentTaskSummaries() : await fetchTaskSummaries(),
                // 工作区清单与 PC 侧栏同一集合（renderer 推送快照），手机页据此
                // 渲染与 PC 一致的工作区分组（含无任务的工作区）。与 bootstrap/
                // workspace-list 同款 merge：推送快照为空时并入启动工作区，保证
                // 手机页至少渲染 relay 附着的这一组（2026-09-29 workspaces:0 回归）。
                workspaces: fallbackWorkspace
                  ? mergeRuntimeWorkspace(currentWorkspaceSummaries(), fallbackWorkspace)
                  : currentWorkspaceSummaries(),
              },
            });
            return;
          }
          const { task, session } = attacher.ensure();
          // 任务类动作按任务所属工作区路由（跨工作区任务的会话读取/输入发送/
          // 权限答复必须落到正确工作区的服务面）：从 syncedTasks 按 taskId 解析；
          // 未命中（如启动工作区任务）回落 startParams。
          const taskEntry =
            "taskId" in pageFrame && typeof pageFrame.taskId === "string"
              ? syncedTasks.find((entry) => entry.taskId === pageFrame.taskId)
              : undefined;
          const frameResponse = await serveMobilePageAction({
            task,
            session,
            frame: pageFrame,
            workspace: taskEntry
              ? {
                  workspacePath: taskEntry.workspacePath,
                  ...(taskEntry.workspaceIdentity
                    ? { workspaceIdentity: taskEntry.workspaceIdentity }
                    : {}),
                }
              : {
                  workspacePath: startParams.workspacePath,
                  ...(startParams.workspaceIdentity
                    ? { workspaceIdentity: startParams.workspaceIdentity }
                    : {}),
                },
          });
          sendAppFrame({
            zcode_type: "drora-page-response",
            requestId,
            success: true,
            frame: frameResponse,
          });
        } catch (error) {
          sendAppFrame({
            zcode_type: "drora-page-response",
            requestId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      case "workspace-list-updated":
        // 上行帧，忽略（本端不消费自己的广播）。
        return;
      case "mobile-view-state-update": {
        const viewState = frame.viewState as RelayMobileViewState | undefined;
        if (viewState && typeof viewState === "object") {
          mobileViewState = { ...viewState, updatedAt: Date.now() };
          emitStatus();
        }
        // 对齐官方 applyMobileViewStateUpdate：deviceInfo 一并存入运行时
        // （供遥测/诊断；当前无消费方，属信息面）。
        const deviceInfo = frame.deviceInfo;
        if (deviceInfo && typeof deviceInfo === "object") {
          mobileDeviceInfo = deviceInfo as Record<string, unknown>;
        }
        return;
      }
      case "workspace-bridge-open": {
        await openWorkspaceBridge(frame);
        return;
      }
      case "workspace-reconnect-request": {
        await respondToWorkspaceReconnectRequest(frame);
        return;
      }
      case "rpc-frame":
        handleRpcFrame(frame);
        return;
      case "rpc-frame-ack":
        // 手机确认我们的出站消息：释放未确认批次/降水位/future-ack 降级（M4c）。
        handleRpcFrameAck(frame);
        return;
      case "telemetry-report": {
        // 对齐官方 routePayload：telemetry-report 转发进桌面遥测管道
        // （reportRendererTelemetryEvent 等价）；未注入转发器时保持仅记日志。
        const event = (frame as { event?: unknown }).event;
        if (deps.reportPhoneTelemetryEvent && event) {
          void deps.reportPhoneTelemetryEvent(event).catch((error: unknown) => {
            logger.warn("[mobile-relay] 手机遥测转发失败", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        } else {
          logger.info("[mobile-relay] 手机端帧（遥测未转发）", { zcodeType });
        }
        return;
      }
      case "mobile-diagnostic":
        // 只记日志，不上报（保守姿态，官方 logMobileDiagnostic 同款）。载荷是页面
        // 状态机事件（event/state/previousState），是手机侧失败定位的第一手证据。
        logger.info("[mobile-relay] 手机端帧", {
          zcodeType,
          ...(["event", "state", "previousState", "reason", "detail"] as const).reduce<
            Record<string, unknown>
          >((acc, key) => {
            const value = (frame as Record<string, unknown>)[key];
            if (value !== undefined) acc[key] = value;
            return acc;
          }, {}),
        });
        return;
      case "platform-request": {
        // 对齐官方 q 处理器：方法表内执行并回 platform-response；失败/未知方法
        // 回 success:false（手机端按各自错误面降级，不重试）。
        const method = String(frame.method ?? "");
        const requestId = frame.requestId;
        try {
          const handler = deps.platformHandlers?.[method];
          if (!handler) throw new Error(`unsupported platform method: ${method}`);
          const result = await handler((frame as { args?: unknown }).args);
          sendAppFrame({
            zcode_type: "platform-response",
            requestId,
            method,
            success: true,
            result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("[mobile-relay] platform request failed", { method, message });
          sendAppFrame({
            zcode_type: "platform-response",
            requestId,
            method,
            success: false,
            error: message,
          });
        }
        return;
      }
      default:
        // 未知帧静默丢弃（workspace-reconnect-request/bridge-open 等已有独立分支）。
        return;
    }
  }

  async function handleMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case "device_register_ack": {
        const deviceSid = String(message.device_sid ?? "");
        if (!deviceSid) break;
        credential = { deviceSid, passHash: credential?.passHash ?? "" };
        if (authMode === "register" && credential.passHash) {
          // 对齐原版：注册凭据在 start 就绪前完成落盘（start 会 await 本 promise）。
          pendingCredentialSave = deps.credentialStore.save(credential).catch((error: unknown) => {
            logger.warn("[mobile-relay] 设备凭据保存失败", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
        authMode = "persisted";
        transition("authenticating");
        sendAuthInit(deviceSid);
        break;
      }
      case "auth_challenge": {
        if (!credential) break;
        send({
          type: "auth_response",
          device_sid: credential.deviceSid,
          proof: calculateRelayProof({
            passHash: credential.passHash,
            nonce: String(message.nonce ?? ""),
            role: "device",
            sessionId: credential.deviceSid,
          }),
          client_ts: Date.now(),
        });
        break;
      }
      case "auth_ack":
      case "pair_status_ack": {
        lastPairStatusAckAt = Date.now();
        armHeartbeatAckWatchdog();
        const pairStatus = message.pair_status;
        if (pairStatus === "waiting") {
          // 对齐官方 applyPairStatus 的 stale-waiting 恢复：paired 后又回到 waiting
          // （手机离开）≠ 首次等待——首次挂 15s 恢复计时，仍未配对或反复抖动则
          // 重连设备 socket 重置会话；新配对（matched）清零计数。两分支都要把
          // 状态迁回 waiting_terminal（状态面回二维码，对齐官方 setState("waiting")）。
          if (wasPaired) {
            staleWaitingCount += 1;
            transition("waiting_terminal");
            startHeartbeat();
            if (staleWaitingCount === 1) {
              scheduleStaleWaitingRecovery();
            } else {
              reconnectAfterStaleWaiting();
            }
            return;
          }
          transition("waiting_terminal");
          startHeartbeat();
          notifyQrReady();
        } else if (pairStatus === "matched") {
          // onSendReady 触发判定（官方 applyPairStatus matched 分支，index.js@379650）：
          // 上次配对代为 0 = 首次配对不触发；同代 = same-socket（手机离开后同 socket
          // 重配）；跨代 = reconnected-socket（设备 WS 重连）——后两者都触发重放。
          const sendReadyKind =
            lastPairedSocketGeneration === 0
              ? null
              : lastPairedSocketGeneration === socketGeneration
                ? "same-socket"
                : "reconnected-socket";
          staleWaitingCount = 0;
          clearStaleWaitingRecoveryTimer();
          // 对齐官方 matched 分支顺序（index.js@379706）：先 setState("paired")
          // （pair_result 在该沿 emit，hasEverPaired 尚为旧值）再置位配对旗标。
          transition("paired");
          wasPaired = true;
          hasEverPaired = true;
          lastPairedSocketGeneration = socketGeneration;
          startHeartbeat();
          notifyQrReady();
          if (sendReadyKind) replayUnacknowledgedForBridge();
        }
        break;
      }
      case "data": {
        if (transportState !== "paired") break;
        const payload = message.payload;
        if (!payload || typeof payload !== "object") break;
        void handleAppFrame(payload as Record<string, unknown>);
        break;
      }
      case "error": {
        void handleRelayError(String(message.code ?? ""), String(message.message ?? ""));
        break;
      }
      default:
        break;
    }
  }

  async function handleRelayError(code: string, messageText: string): Promise<void> {
    if (code === "KICKED") {
      // 对齐原版：单会话被新页面接管；上报一次失败面后重连回 waiting。
      // pair_result failure 由 transition("kicked") 状态沿统一上报（官方 nI kicked 分支）。
      logger.warn("[mobile-relay] 设备被 KICKED，重连", { message: messageText });
      transition("kicked");
      runtimeFailure = {
        reason: "session-conflict",
        message: "Web remote control connection was kicked by relay.",
      };
      emitStatus();
      reconnect();
      return;
    }
    if (code === "AUTH_FAILED" && authMode === "persisted" && !invalidPersistedRetryUsed) {
      // persisted 凭据失效：丢弃后走一次重注册。
      invalidPersistedRetryUsed = true;
      logger.warn("[mobile-relay] persisted 凭据鉴权失败，重注册");
      await deps.credentialStore.clear();
      const password = createRelayPassword();
      credential = { deviceSid: "", passHash: derivePassHash(password) };
      authMode = "register";
      reconnect(0);
      return;
    }
    if (
      code === "WRONG_PARAM" &&
      (transportState === "paired" || transportState === "waiting_terminal")
    ) {
      // 对齐官方 3.14.3（取证 /d/software/ZCode bundle handleError）：
      // `WRONG_PARAM && (paired || waiting_terminal)` 走 options.onError——官方接线
      // 只 logger.warn，不断连、不停心跳。relay 在手机接管/离开的过渡期会对
      // pair_status_query 周期性回 WRONG_PARAM（真机实测 10s 心跳节奏），属链路常态
      // 噪音；期间手机帧继续流动。WRONG_PARAM 不刷新 ack 时间戳，30s 看门狗到期
      // 自然重连自愈（重连重新鉴权回 waiting，二维码恢复有效）——此前按终态处理
      // 会把刚配对上的会话 10s 内误杀（2026-09-27 真机首配实锤）。
      logger.warn("[mobile-relay] external relay device error", {
        code,
        message: messageText,
      });
      return;
    }
    if (
      code === "INTERNAL" &&
      (transportState === "paired" || transportState === "waiting_terminal")
    ) {
      // waiting/paired 态的 INTERNAL 视为可恢复：重连（对齐原版 enterWaitingForPairAfterRelayError）。
      logger.warn("[mobile-relay] relay INTERNAL（可恢复），重连", { message: messageText });
      reconnect();
      return;
    }
    terminalError = true;
    stopHeartbeat();
    transition("error");
    runtimeFailure = { reason: "internal", message: messageText || code };
    emitStatus();
    notifyQrReady();
    try {
      socket?.close();
    } catch {
      // 已关闭属正常路径
    }
  }

  function sendAuthInit(deviceSid: string): void {
    transition("authenticating");
    send({
      type: "auth_init",
      role: "device",
      device_sid: deviceSid,
      meta: {
        platform: process.platform,
        version: OFFICIAL_REMOTE_PAGE_APP_VERSION,
        name: hostname(),
      },
      client_ts: Date.now(),
    });
  }

  function notifyQrReady(): void {
    const waiter = qrReadyWaiter;
    if (waiter) {
      qrReadyWaiter = null;
      waiter();
    }
  }

  function connect(): void {
    stopHeartbeat();
    clearReconnectTimer();
    socketGeneration += 1;
    const generation = socketGeneration;
    transition("connecting");
    lastPairStatusAckAt = Date.now();
    if (!WebSocketCtor) {
      terminalError = true;
      transition("error");
      runtimeFailure = { reason: "internal", message: "WebSocket constructor unavailable" };
      emitStatus();
      // 快速失败：唤醒 start 的 QR 就绪等待，立刻向上抛错而不是拖满 30s 超时。
      // 依赖 start 的挂载顺序——QR 等待器先于 connect() 挂载（见 start 内注释），
      // 这里的同步 notifyQrReady() 才有等待者可唤醒。
      notifyQrReady();
      return;
    }
    const url = new URL(effectiveRelayWsUrl);
    url.searchParams.set("mid", deps.deviceMid);
    const created = new WebSocketCtor(url.toString(), {
      perMessageDeflate: true,
      headers: { "X-Device-ID": deps.deviceMid },
    });
    socket = created;
    created.on("open", () => {
      if (socket !== created) return;
      if (authMode === "register" || !credential) {
        transition("registering");
        const password = createRelayPassword();
        credential = { deviceSid: "", passHash: derivePassHash(password) };
        send({
          type: "device_register_init",
          device_mid: deps.deviceMid,
          pass_hash: credential.passHash,
          meta: {
            platform: process.platform,
            version: OFFICIAL_REMOTE_PAGE_APP_VERSION,
            name: hostname(),
          },
          client_ts: Date.now(),
        });
        return;
      }
      sendAuthInit(credential.deviceSid);
    });
    created.on("message", (raw: unknown) => {
      if (socket !== created) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        logger.warn("[mobile-relay] 非 JSON 帧丢弃");
        return;
      }
      void handleMessage(message);
    });
    created.on("error", (error: unknown) => {
      if (socket !== created) return;
      logger.warn("[mobile-relay] socket 错误", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    created.on("close", () => {
      if (socket !== created) return;
      if (generation !== socketGeneration) return;
      socket = null;
      stopHeartbeat();
      if (!manuallyClosed && !terminalError) {
        reconnect();
      }
    });
  }

  async function start(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    /** 传输维度（specs/mobile-relay-server.md §12）：lan=内嵌自建 relay；cloud=云中继（缺省）。 */
    transport?: MobileRelayTransport;
  }): Promise<{ url: string; sessionId: string }> {
    if (!manuallyClosed) {
      await stop();
    }
    const transport = params.transport ?? "cloud";
    manuallyClosed = false;
    terminalError = false;
    wasPaired = false;
    // 对齐官方：hasEverPaired 仅随新会话重置（index.js@404928 运行时初始化）。
    hasEverPaired = false;
    lastPairedSocketGeneration = 0;
    staleWaitingCount = 0;
    clearStaleWaitingRecoveryTimer();
    invalidPersistedRetryUsed = false;
    runtimeFailure = null;
    mobileViewState = undefined;
    mobileDeviceInfo = undefined;
    startParams = {
      workspacePath: params.workspacePath,
      ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
      transport,
    };
    // start_result 维度在 start 上下文入口解析（对齐官方 runStartOperation
    // index.js@658168：失败路径会先 stop() 清 startParams，emit 时解析会丢维度）。
    const startDims = runtimeWorkspaceDims();
    const persisted = await deps.credentialStore.load();
    if (persisted) {
      credential = persisted;
      authMode = "persisted";
    } else {
      credential = null;
      authMode = "register";
    }
    // 动态端点（设置键 relayServerUrl → env → 固定注入/官方；lan=内嵌固定注入）：
    // 每次 start 解析一次。装配处按 transport 准备链路（lan 先 ensureStarted）。
    if (deps.resolveEndpoints) {
      try {
        const endpoints = await deps.resolveEndpoints({ transport });
        if (endpoints) {
          effectiveRelayWsUrl = endpoints.relayWsUrl;
          effectiveRemotePageUrl = endpoints.remotePageUrl;
        } else {
          effectiveRelayWsUrl = relayWsUrl;
          effectiveRemotePageUrl = remotePageUrl;
        }
      } catch (error: unknown) {
        logger.warn("[mobile-relay] 端点解析失败，沿用当前端点", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // QR 就绪等待器必须先于 connect() 挂载：connect() 内 WebSocket 构造器缺失的
    // 快速失败路径是同步调 notifyQrReady()——旧顺序（先 connect() 再挂载）下通知
    // 落空，start 只能拖满 30s 超时才失败。挂载前移后快速失败做真：等待被立即唤醒，
    // 经下方 terminalError 检查以真实原因（"WebSocket constructor unavailable"）
    // 上抛（2026-09-29 修正注释与行为不符）。
    // QR 就绪 = 到达 waiting/matched（拿到 deviceSid 才能构造 URL）且注册凭据已落盘；
    // 超时对齐原版 BW。
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        qrReadyWaiter = null;
        reject(new Error("External relay device did not reach QR-ready state before timeout."));
      }, QR_READY_TIMEOUT_MS);
      timer.unref?.();
      qrReadyWaiter = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    connect();
    try {
      await ready;
      if (pendingCredentialSave) await pendingCredentialSave;
    } catch (error) {
      await stop();
      // start_result failure（对齐官方 runStartOperation catch，index.js@658475：
      // 失败面也上报，errorCategory=classifyRemoteUsageError）。
      startResultEvent("failure", error, startDims);
      throw error;
    }
    pendingCredentialSave = null;
    if (
      terminalError ||
      !credential ||
      (transportState !== "waiting_terminal" && transportState !== "paired")
    ) {
      const failure = runtimeFailure;
      await stop();
      // 未达 QR 就绪的终态失败同样上报 start_result（官方 StartWebRemoteControl
      // handler 对 operation rejection 统一走 catch 失败面）。
      const error = new Error(failure?.message ?? "relay did not reach QR-ready state");
      startResultEvent("failure", error, startDims);
      throw error;
    }
    qrUrl = buildRelayQrUrl({
      baseUrl: effectiveRemotePageUrl,
      deviceSid: credential.deviceSid,
      passHash: credential.passHash,
      deviceMid: deps.deviceMid,
      deviceName: hostname(),
      // app_version 由 buildRelayQrUrl 固定上报 OFFICIAL_REMOTE_PAGE_APP_VERSION：
      // 托管页按版本清单 404 未知版本，真实版本 0.0.1 手机扫码必 404。
    });
    // 对齐官方：start 成功即持久化恢复上下文（手动 stop 清除，应用重启后恢复）。
    // transport 一并记录：恢复时按原传输重启对应链路（§12.4）。
    try {
      await deps.startupRestoreStorage?.save({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        transport,
      });
    } catch (error) {
      logger.warn("[mobile-relay] 恢复上下文保存失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    emitStatus();
    // start_result success（对齐官方 runStartOperation 成功沿 index.js@658465：
    // operation 完成后、返回前上报）。
    startResultEvent("success", undefined, startDims);
    return { url: qrUrl, sessionId: credential.deviceSid };
  }

  async function stop(): Promise<void> {
    manuallyClosed = true;
    terminalError = false;
    stopHeartbeat();
    clearReconnectTimer();
    const old = socket;
    socket = null;
    try {
      old?.close();
    } catch {
      // 已关闭属正常路径
    }
    if (qrReadyWaiter) {
      const waiter = qrReadyWaiter;
      qrReadyWaiter = null;
      waiter();
    }
    pendingCredentialSave = null;
    disposeBridge();
    // 在途开桥请求一并作废（superseded）：stop 后异步预热/附着完成的请求不得重建桥。
    bridgeOpenEpoch += 1;
    syncedWorkspaces = [];
    clearStaleWaitingRecoveryTimer();
    wasPaired = false;
    hasEverPaired = false;
    lastPairedSocketGeneration = 0;
    staleWaitingCount = 0;
    syncedTasks = [];
    lastWorkspaceListFingerprint = null;
    attacher.dispose();
    transportState = "idle";
    runtimeFailure = null;
    qrUrl = null;
    startParams = null;
    mobileViewState = undefined;
    mobileDeviceInfo = undefined;
    try {
      await deps.startupRestoreStorage?.clear();
    } catch (error) {
      logger.warn("[mobile-relay] 恢复上下文清除失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    emitStatus();
  }

  /**
   * 应用重启后的自动恢复（对齐官方 restorePreviouslyEnabled）：每次运行至多一次；
   * 已在运行则跳过；持久化上下文的工作区必须仍在 renderer 推送清单中才恢复
   * （对齐官方"工作区不匹配不恢复"）。
   */
  async function restorePreviouslyEnabled(
    workspaces: MobileRelayWorkspaceSyncEntry[],
  ): Promise<boolean> {
    if (restoredThisRun || manuallyClosed === false) return false;
    if (!deps.startupRestoreStorage) return false;
    const context = await deps.startupRestoreStorage.load();
    if (restoredThisRun || manuallyClosed === false) return false;
    if (!context) return false;
    const contextKey = context.workspaceIdentity?.trim() || context.workspacePath;
    const target = workspaces.find(
      (entry) => (entry.workspaceIdentity?.trim() || entry.workspacePath) === contextKey,
    );
    if (!target) return false;
    restoredThisRun = true;
    logger.info("[mobile-relay] restoring previous enabled state", {
      workspacePath: target.workspacePath,
    });
    try {
      await start({
        workspacePath: target.workspacePath,
        workspaceIdentity: target.workspaceIdentity,
        // 恢复语义（§12.4）：按记录的传输重启对应链路（缺省 cloud 兼容旧记录）。
        transport: context.transport ?? "cloud",
      });
      return true;
    } catch (error) {
      restoredThisRun = false;
      logger.warn("[mobile-relay] restore previous enabled state failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** 轮换设备凭据并重启（二维码泄露语义，对齐原版 resetPairing 的 rotate）。 */
  async function reset(): Promise<{ url: string; sessionId: string }> {
    const params = startParams;
    await stop();
    await deps.credentialStore.clear();
    credential = null;
    authMode = "register";
    if (!params) throw new Error("mobile relay control is not running");
    return start(params);
  }

  return {
    runtimeState,
    isRunning: () => manuallyClosed === false,
    start,
    stop,
    reset,
    syncAvailableWorkspaces,
    syncAvailableTasks,
    restorePreviouslyEnabled,
  };
}
