// 移动端远程控制·官方 relay 云中继客户端（M4a，spec: mobile-web-remote.md）。
// 复用 z.ai 官方 relay（wss://zcode.z.ai/ws）与托管手机页（remote/v4）实现跨网络远控；
// 协议常量/纯逻辑见 desktopMobileRelayProtocol.ts（逐项取证并经最小探测复核）。
// 边界：relay 只做转发；官方可随时变更协议——本传输与 LAN 直连并存，弹层内可选。
/* eslint-disable max-lines -- 传输状态机/心跳/应用帧路由集中在一个生命周期单元里，
   与 botsService/desktopMainIpcPlatform 同例；纯协议逻辑已拆至 RelayProtocol 模块。 */
import { hostname } from "node:os";
import type { MessagePortMain, UtilityProcess } from "electron";
import type { MobilePairingFailure, MobilePairingRuntimeState } from "@drora/shared";
import {
  RpcFrameAssembler,
  buildRpcFrameAck,
  encodeRpcTransportMessage,
  parseRpcTransportFrame,
  toExternalBridge,
  HEARTBEAT_ACK_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_JITTER_MAX_MS,
  QR_READY_TIMEOUT_MS,
  RECONNECT_DELAY_MS,
  OFFICIAL_REMOTE_PAGE_URL,
  OFFICIAL_RELAY_WS_URL,
  buildRelayQrUrl,
  calculateRelayProof,
  createRelayPassword,
  derivePassHash,
  mapTransportState,
  MobileRelayCredentialStore,
  relayWorkspaceKey,
  buildBootstrapResult,
  buildWorkspaceListResult,
  type RelayDeviceCredential,
  type RpcFrameIdentity,
  type RelayMobileViewState,
  type RelayTaskSummary,
  type RelayTransportState,
  type RelayWorkspaceSummary,
} from "./desktopMobileRelayProtocol.js";
import { createMobileServiceAttacher } from "./desktopMobileServiceAttach.js";

// —— 宿主：relay 控制器 ——

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "open" | "close" | "error", listener: (...args: unknown[]) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
};

type WebSocketCtor = new (url: string, options: {
  perMessageDeflate: boolean;
  headers: Record<string, string>;
}) => WebSocketLike;

export function createDesktopMobileRelayControl(deps: {
  logger: Logger;
  deviceMid: string;
  appVersion: string;
  credentialStore: MobileRelayCredentialStore;
  resolveHostChild: () => UtilityProcess | null;
  onStatusChanged?: (state: MobilePairingRuntimeState) => void;
  /** 测试注入 WebSocket 构造器与端点；生产用 ws 包与官方端点。 */
  webSocketCtor?: WebSocketCtor;
  relayWsUrl?: string;
  remotePageUrl?: string;
}) {
  const logger = deps.logger;
  const WebSocketCtor = deps.webSocketCtor;
  const relayWsUrl = deps.relayWsUrl ?? OFFICIAL_RELAY_WS_URL;
  const remotePageUrl = deps.remotePageUrl ?? OFFICIAL_REMOTE_PAGE_URL;
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
  let startParams: { workspacePath: string; workspaceIdentity?: string } | null = null;
  let mobileViewState: RelayMobileViewState | undefined;
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
    };
  }

  function emitStatus(): void {
    deps.onStatusChanged?.(runtimeState());
  }

  function transition(next: RelayTransportState): void {
    if (transportState === next) return;
    transportState = next;
    if (next !== "error") runtimeFailure = null;
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
      heartbeatTimer = setTimeout(tick, HEARTBEAT_INTERVAL_MS + jitterDelay(HEARTBEAT_INTERVAL_MS, HEARTBEAT_JITTER_MAX_MS));
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

  /** 应用帧下行（对齐原版 routePayload 的 M4a 子集；frame 自带 zcode_type）。 */
  function sendAppFrame(frame: Record<string, unknown>): boolean {
    return send(frame);
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

  async function fetchTaskSummaries(): Promise<RelayTaskSummary[]> {
    if (!startParams) return [];
    try {
      const { task } = attacher.ensure();
      const tasks = (await task.call("listTasks", {
        workspacePath: startParams.workspacePath,
        workspaceIdentity: startParams.workspaceIdentity,
      })) as Array<Record<string, unknown>>;
      return tasks.map((meta) => ({
        taskId: String(meta.taskId ?? ""),
        title: String(meta.title ?? ""),
        status: String(meta.status ?? ""),
        updatedAt: Number(meta.updatedAt ?? 0),
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
      kind: "local",
      connectionState: "connected",
    };
  }

  /** Host 端口二进制 → rpc-frame 封装 → relay（ready 前先缓冲）。 */
  function forwardHostBytesToPhone(bytes: Uint8Array): void {
    if (!bridge) return;
    if (!bridge.readyAnnounced) {
      bridge.pendingOutbound.push(bytes);
      return;
    }
    flushBridgeOutbound(bytes);
  }

  function flushBridgeOutbound(extra?: Uint8Array): void {
    if (!bridge) return;
    const batch = extra ? [...bridge.pendingOutbound.splice(0), extra] : bridge.pendingOutbound.splice(0);
    for (const bytes of batch) {
      try {
        const encoded = encodeRpcTransportMessage({
          message: bytes,
          identity: bridge.identity,
          firstPhysicalSeq: bridge.outboundAssemblerSeq,
          messageSeq: bridge.outboundMessageSeq,
        });
        bridge.outboundAssemblerSeq = encoded.nextPhysicalSeq;
        bridge.outboundMessageSeq += 1;
        for (const frame of encoded.frames) {
          sendAppFrame(frame as unknown as Record<string, unknown>);
        }
      } catch (error) {
        // 超限/编码失败：丢帧并记日志（对齐原版 degraded 语义的保守子集，不拆桥）。
        logger.warn("[mobile-relay] rpc-frame 编码失败，丢弃该消息", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function disposeBridge(): void {
    if (!bridge) return;
    try {
      bridge.port.close();
    } catch {
      // 已关闭属正常路径
    }
    bridge = null;
  }

  /** workspace-bridge-open：附着 Host 端口并双向接管 rpc 帧（对齐原版 createWorkspaceBridge）。 */
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
    const respondError = (reason: string, error: string) => {
      sendAppFrame({
        zcode_type: "workspace-bridge-error",
        requestId,
        ...identity,
        reason,
        error,
      });
    };
    if (!startParams || transportState !== "paired") {
      respondError("desktop-disconnected", "relay session is not paired");
      return;
    }
    const workspaceKey = String(frame.workspaceKey ?? "");
    if (workspaceKey !== relayWorkspaceKey(startParams)) {
      respondError("workspace-not-found", "目标工作区不在当前远控会话中");
      return;
    }
    disposeBridge();
    let port: MessagePortMain;
    try {
      port = attacher.attachBridgePort();
    } catch (error) {
      respondError(
        "desktop-host-missing",
        error instanceof Error ? error.message : String(error),
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
    };
    sendAppFrame({
      zcode_type: "workspace-bridge-ready",
      requestId,
      ...identity,
      bridge: toExternalBridge({
        identity,
        workspaceKey,
        workspacePath: startParams.workspacePath,
        ...(initialTaskId ? { initialTaskId } : {}),
        kind: "local",
      }),
    });
    bridge.readyAnnounced = true;
    flushBridgeOutbound();
    logger.info("[mobile-relay] workspace bridge 已建立", { bridgeSessionId, workspaceKey });
  }

  /** rpc-frame 入站：重组 → Host 端口；完整消息回 ack（对端流控依赖）。 */
  function handleRpcFrame(value: unknown): void {
    if (!bridge) return;
    const frame = parseRpcTransportFrame(value);
    if (!frame) return;
    const assembled = bridge.assembler.accept(frame);
    if (!assembled) return;
    sendAppFrame(buildRpcFrameAck({ identity: bridge.identity, ackMessageSeq: assembled.messageSeq }));
    bridge.port.postMessage(Buffer.from(assembled.message));
  }

  async function handleAppFrame(frame: Record<string, unknown>): Promise<void> {
    const zcodeType = frame.zcode_type;
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
            appVersion: deps.appVersion,
            workspace,
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
          result: buildWorkspaceListResult({ workspace, tasks, mobileViewState }),
        });
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
        return;
      }
      case "workspace-bridge-open": {
        await openWorkspaceBridge(frame);
        return;
      }
      case "workspace-reconnect-request": {
        sendAppFrame({
          zcode_type: "workspace-reconnect-response",
          requestId: frame.requestId,
          workspaceKey: frame.workspaceKey,
          success: false,
          error: "workspace reconnect lands in M4c",
        });
        return;
      }
      case "rpc-frame":
        handleRpcFrame(frame);
        return;
      case "rpc-frame-ack":
        // 手机确认我们的出站消息；M4b 简化实现不维护重放缓冲，收到即忽略。
        return;
      case "telemetry-report":
      case "mobile-diagnostic":
        // 只记日志，不上报（保守姿态）。
        logger.info("[mobile-relay] 手机端帧", { zcodeType });
        return;
      default:
        // platform-request / workspace-list-updated 属 M4c；未知帧静默丢弃。
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
          pendingCredentialSave = deps
            .credentialStore.save(credential)
            .catch((error: unknown) => {
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
          transition("waiting_terminal");
          startHeartbeat();
          notifyQrReady();
        } else if (pairStatus === "matched") {
          transition("paired");
          startHeartbeat();
          notifyQrReady();
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
    if (code === "INTERNAL" && (transportState === "paired" || transportState === "waiting_terminal")) {
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
      meta: { platform: process.platform, version: deps.appVersion, name: hostname() },
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
      return;
    }
    const url = new URL(relayWsUrl);
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
          meta: { platform: process.platform, version: deps.appVersion, name: hostname() },
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
  }): Promise<{ url: string; sessionId: string }> {
    if (!manuallyClosed) {
      await stop();
    }
    manuallyClosed = false;
    terminalError = false;
    invalidPersistedRetryUsed = false;
    runtimeFailure = null;
    mobileViewState = undefined;
    startParams = params;
    const persisted = await deps.credentialStore.load();
    if (persisted) {
      credential = persisted;
      authMode = "persisted";
    } else {
      credential = null;
      authMode = "register";
    }
    connect();
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
    try {
      await ready;
      if (pendingCredentialSave) await pendingCredentialSave;
    } catch (error) {
      await stop();
      throw error;
    }
    pendingCredentialSave = null;
    if (!credential) throw new Error("relay credential missing after QR-ready");
    qrUrl = buildRelayQrUrl({
      baseUrl: remotePageUrl,
      deviceSid: credential.deviceSid,
      passHash: credential.passHash,
      deviceMid: deps.deviceMid,
      deviceName: hostname(),
      appVersion: deps.appVersion,
    });
    emitStatus();
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
    attacher.dispose();
    transportState = "idle";
    runtimeFailure = null;
    qrUrl = null;
    startParams = null;
    mobileViewState = undefined;
    emitStatus();
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
  };
}
