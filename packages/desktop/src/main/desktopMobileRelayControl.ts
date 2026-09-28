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
import type {
  MobilePairingFailure,
  MobilePairingRuntimeState,
  MobileRelayTaskSyncEntry,
  MobileRelayWorkspaceSyncEntry,
} from "@drora/shared";
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
  OFFICIAL_REMOTE_PAGE_APP_VERSION,
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

export function createDesktopMobileRelayControl(deps: {
  logger: Logger;
  deviceMid: string;
  credentialStore: MobileRelayCredentialStore;
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
   * 动态端点解析（specs/mobile-relay-server.md §8）：每次 start 时调用，读设置键
   * relayServerUrl（→ env → 官方默认）。返回 undefined 则沿用固定注入端点。
   */
  resolveEndpoints?: () => Promise<
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
   */
  startupRestoreStorage?: {
    load(): Promise<{ workspacePath: string; workspaceIdentity?: string } | null>;
    save(context: { workspacePath: string; workspaceIdentity?: string }): Promise<void>;
    clear(): Promise<void>;
  };
  /** 测试注入 WebSocket 构造器与端点；生产用 ws 包与官方端点。 */
  webSocketCtor?: WebSocketCtor;
  relayWsUrl?: string;
  remotePageUrl?: string;
}) {
  const logger = deps.logger;
  // 出站应用帧硬上限（对齐官方 maxPhysicalFrameBytes=1MiB，取证 chunk-GJUBRD53.js et 表）。
  const MAX_APP_FRAME_BYTES = 1024 * 1024;
  // 生产未注入时回退到 ws 包（测试注入 fake 构造器走纯逻辑路径）。
  // 懒 require：与 electron 懒加载同法，保持模块在 plain node 下的可测性。
  const WebSocketCtor: WebSocketCtor | null =
    deps.webSocketCtor ??
    (() => {
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
  let startParams: { workspacePath: string; workspaceIdentity?: string } | null = null;
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

  // 用量遥测事件（对齐官方 buildWebRemoteControl*Telemetry 构造族，取证 chunk-GJUBRD53）。
  function emitUsageEvent(elementName: string, extra: Record<string, string>): void {
    try {
      deps.reportUsageEvent?.({
        elementName,
        eventRegion: "result",
        eventType: "result",
        eventExtraDetail: extra,
      });
    } catch {
      // 遥测失败不影响主链路
    }
  }

  function pairResultEvent(result: "success" | "failure", errorCategory?: string): void {
    emitUsageEvent("web_remote_control_pair_result", {
      result,
      error_category: result === "success" ? "" : (errorCategory ?? "unknown"),
      pair_kind: wasPaired ? "reconnect" : "initial",
      workspace_kind: "local",
      remote_kind: "",
    });
  }

  function bridgeResultEvent(result: "success" | "failure", errorCategory?: string): void {
    emitUsageEvent("web_remote_control_bridge_result", {
      result,
      error_category: result === "success" ? "" : (errorCategory ?? "unknown"),
      workspace_kind: "local",
      remote_kind: "",
      entry_kind: "workspace",
    });
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

  /** 应用帧下行（对齐原版 routePayload 的 M4a 子集；frame 自带 zcode_type）。 */
  function sendAppFrame(frame: Record<string, unknown>): boolean {
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
      return false;
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
    return send(message);
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
  let staleWaitingCount = 0;
  let staleWaitingRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const STALE_WAITING_RECOVERY_MS = 15_000;
  let lastWorkspaceListFingerprint: string | null = null;

  function syncAvailableWorkspaces(workspaces: MobileRelayWorkspaceSyncEntry[]): void {
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
      const tasks = await task.listTasks({
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
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
    if (!bridge) return;
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
      bridgeResultEvent("failure", reason);
    };
    if (!startParams || transportState !== "paired") {
      respondError("desktop-disconnected", "relay session is not paired");
      return;
    }
    const workspaceKey = String(frame.workspaceKey ?? "");
    // 多工作区（官方 getAvailableWorkspaces 语义）：bootstrap 列出的任意本地工作区
    // 都可开桥——窗口 Host 的服务面覆盖全部本地工作区（attach scope=local 不按路径
    // 切分）；远程工作区的桥接依赖 remote-scoped attach，属 M4c。
    const knownWorkspace = [relayWorkspaceKey(startParams)]
      .concat(syncedWorkspaces.map((entry) => relayWorkspaceKey(entry)))
      .some((key) => key === workspaceKey);
    const isRemoteWorkspace = syncedWorkspaces.some(
      (entry) => relayWorkspaceKey(entry) === workspaceKey && entry.kind === "remote",
    );
    if (isRemoteWorkspace) {
      respondError(
        "workspace-not-found",
        "remote workspace bridging lands in M4c; reconnect from desktop first",
      );
      return;
    }
    if (!knownWorkspace) {
      respondError("workspace-not-found", "目标工作区不在当前远控会话中");
      return;
    }
    // 预热目标工作区的 CLI 运行时（对齐桌面端打开工作区 tab 时的 warmup 行为）：
    // 手机页随后的 sessions-index 订阅与 readSession 都是 existing-only/需要活运行时，
    // 冷工作区会直接 "runtime is not running"/"Session is not active"。listSessions
    // 默认 start-if-needed——既拉起运行时又拿到该工作区的权威会话清单。
    // 20s 兜底：预热失败不阻塞开桥（手机端按各自错误面重试）。
    const warmTarget = syncedWorkspaces.find((entry) => relayWorkspaceKey(entry) === workspaceKey);
    try {
      const { agent } = attacher.ensure();
      await Promise.race([
        agent.listSessions({
          workspacePath: warmTarget?.workspacePath ?? startParams.workspacePath,
          ...(warmTarget?.workspaceIdentity || startParams.workspaceIdentity
            ? {
                workspaceIdentity: warmTarget?.workspaceIdentity ?? startParams.workspaceIdentity,
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
    disposeBridge();
    let port: MessagePortMain;
    try {
      port = attacher.attachBridgePort();
    } catch (error) {
      respondError("desktop-host-missing", error instanceof Error ? error.message : String(error));
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
        // bridge-ready 如实携带被桥接的工作区（多工作区下可能是推送清单中的任一本地工作区）。
        workspacePath:
          syncedWorkspaces.find((entry) => relayWorkspaceKey(entry) === workspaceKey)
            ?.workspacePath ?? startParams.workspacePath,
        ...(initialTaskId ? { initialTaskId } : {}),
        kind: "local",
      }),
    });
    bridge.readyAnnounced = true;
    flushBridgeOutbound();
    bridgeResultEvent("success");
    logger.info("[mobile-relay] workspace bridge 已建立", { bridgeSessionId, workspaceKey });
  }

  /** rpc-frame 入站：重组 → Host 端口；完整消息回 ack（对端流控依赖）。 */
  function handleRpcFrame(value: unknown): void {
    if (!bridge) return;
    const frame = parseRpcTransportFrame(value);
    if (!frame) return;
    const assembled = bridge.assembler.accept(frame);
    if (!assembled) return;
    sendAppFrame(
      buildRpcFrameAck({ identity: bridge.identity, ackMessageSeq: assembled.messageSeq }),
    );
    bridge.port.postMessage(Buffer.from(assembled.message));
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
          const { task, session } = attacher.ensure();
          // list 动作 = 全工作区任务聚合（对齐官方 getAvailableTasks 语义）：
          // renderer 已推送跨工作区任务摘要（syncedTasks）时直接采用；
          // 否则（如设置页场景无推送）回落启动工作区的单工作区清单。
          if (pageFrame.type === "list") {
            sendAppFrame({
              zcode_type: "drora-page-response",
              requestId,
              success: true,
              frame: {
                type: "taskList",
                tasks: syncedTasks.length > 0 ? currentTaskSummaries() : await fetchTaskSummaries(),
              },
            });
            return;
          }
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
        // workspace-reconnect-request 需远程会话重连机器（M4c，有独立错误响应分支）；
        // 其余未知帧静默丢弃。
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
          staleWaitingCount = 0;
          clearStaleWaitingRecoveryTimer();
          wasPaired = true;
          transition("paired");
          startHeartbeat();
          notifyQrReady();
          pairResultEvent("success");
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
      pairResultEvent("failure", "relay");
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
  }): Promise<{ url: string; sessionId: string }> {
    if (!manuallyClosed) {
      await stop();
    }
    manuallyClosed = false;
    terminalError = false;
    wasPaired = false;
    staleWaitingCount = 0;
    clearStaleWaitingRecoveryTimer();
    invalidPersistedRetryUsed = false;
    runtimeFailure = null;
    mobileViewState = undefined;
    mobileDeviceInfo = undefined;
    startParams = params;
    const persisted = await deps.credentialStore.load();
    if (persisted) {
      credential = persisted;
      authMode = "persisted";
    } else {
      credential = null;
      authMode = "register";
    }
    // 动态端点（设置键 relayServerUrl → env → 固定注入/官方）：每次 start 解析一次。
    if (deps.resolveEndpoints) {
      try {
        const endpoints = await deps.resolveEndpoints();
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
    if (
      terminalError ||
      !credential ||
      (transportState !== "waiting_terminal" && transportState !== "paired")
    ) {
      const failure = runtimeFailure;
      await stop();
      throw new Error(failure?.message ?? "relay did not reach QR-ready state");
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
    try {
      await deps.startupRestoreStorage?.save({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
      });
    } catch (error) {
      logger.warn("[mobile-relay] 恢复上下文保存失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    syncedWorkspaces = [];
    clearStaleWaitingRecoveryTimer();
    wasPaired = false;
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
