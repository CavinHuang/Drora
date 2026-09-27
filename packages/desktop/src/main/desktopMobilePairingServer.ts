/* oxlint-disable eslint(max-lines) -- 配对服务必须把 HTTP/WS/桥接/手机页收在一个生命周期单元里。 */
// 移动端远程控制·配对服务宿主（架构与安全模型见 specs/mobile-web-remote.md）：
// - HTTP 提供手机静态页（/p/<pairToken> 与 / 同一份 SPA，配对态由页面 WS 握手决定）；
// - WS /ws 承载手机协议 v1 JSON 帧，首帧必须是 hello（配对令牌）或 resume（会话令牌）；
// - 认证通过后按需向窗口 Host 发 AttachServicePort（scope=local，
//   clientMode=web-remote-replayable），用 @drora/rpc ChannelClient 调
//   IDroraTaskService / IDroraSessionService，把手机帧翻译成服务调用。
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { WebSocketServer, type WebSocket } from "ws";
import {
  ChannelClient,
  MessagePortProtocol,
  type IChannel,
  type MessagePortPayload,
} from "@drora/rpc";
import { HostMessageTypes } from "@drora/shared";
import type {
  MessagePortMain,
  UtilityProcess,
} from "electron";
import type { MobilePairingRuntimeState } from "@drora/shared";
import {
  attemptPair,
  buildPairingUrl,
  createPairingCoreState,
  issuePairTicket,
  isSessionTokenValid,
  pickLanAddress,
  type PairingCoreState,
} from "./desktopMobilePairingCore.js";

export interface MobilePairingStartParams {
  workspacePath: string;
  workspaceIdentity?: string;
  /**
   * 发起窗口的 Host 解析器（对齐原版"手机认证后才惰性附着"的桥接时序）：
   * start 时不持有 Host 实例；手机认证或重连时惰性解析，Host 重启后可换新实例重附着。
   */
  resolveHostChild: () => UtilityProcess | null;
}

export interface MobilePairingStartResult {
  url: string;
  port: number;
  pairToken: string;
}

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

/** 手机协议 v1 入站帧（spec: mobile-web-remote.md）。 */
type PhoneInboundFrame =
  | { type: "hello"; pairToken: string }
  | { type: "resume"; sessionToken: string }
  | { type: "list" }
  | { type: "open"; taskId: string }
  | { type: "send"; taskId: string; content: string }
  | {
      type: "permission";
      taskId: string;
      runId?: string;
      requestId: string;
      optionId: string;
      decision: "allow" | "deny" | "escalate" | "modify";
    }
  | { type: "stop"; taskId: string }
  /** 增量拉取会话事件日志（seq 单调），手机端据此投影流式内容与待决权限。 */
  | { type: "events"; taskId: string; afterSeq: number };

interface AuthedPhoneConnection {
  socket: WebSocket;
  sessionToken: string;
}

/**
 * 运行状态对齐原版 runtime status（idle/starting/running/connecting/active/error）：
 * Main 通过 onStatusChanged 推送给 renderer（替代轮询），快照供 state 查询。
 * connecting = 手机已建立 WS 但尚未完成配对握手（原版"正在连接手机"）。
 */
export function createDesktopMobilePairingServer(deps: {
  logger: Logger;
  onStatusChanged?: (state: MobilePairingRuntimeState) => void;
}) {
  const logger = deps.logger;
  let httpServer: Server | null = null;
  let wss: WebSocketServer | null = null;
  let state: PairingCoreState = createPairingCoreState();
  let startParams: MobilePairingStartParams | null = null;
  let startResult: MobilePairingStartResult | null = null;
  let authedConnection: AuthedPhoneConnection | null = null;
  /** 已建立 WS 但尚未通过握手认证的连接（connecting 态的判定依据）。 */
  const pendingSockets = new Set<WebSocket>();
  let serviceChannel: IChannel | null = null;
  let sessionChannel: IChannel | null = null;
  /** 当前附着端口所属的 Host 实例；resolver 返回不同实例时重建（Host 重启场景）。 */
  let attachedHostChild: UtilityProcess | null = null;
  let clientPort: MessagePortMain | null = null;
  let runtimeStatus: MobilePairingRuntimeState["status"] = "idle";
  let runtimeFailure: MobilePairingRuntimeState["failure"] = null;
  let boundAddress: string | null = null;
  let boundPort = 0;

  function isRunning(): boolean {
    return httpServer !== null;
  }

  function runtimeState(): MobilePairingRuntimeState {
    return {
      running: httpServer !== null,
      status: runtimeStatus,
      connected: authedConnection !== null,
      url: startResult?.url ?? null,
      workspacePath: startParams?.workspacePath ?? null,
      workspaceIdentity: startParams?.workspaceIdentity ?? null,
      failure: runtimeFailure,
    };
  }

  /** 状态变化即推送（对齐原版 StatusChanged；emit 的快照必须是转移后的新值）。 */
  function emitStatus(): void {
    deps.onStatusChanged?.(runtimeState());
  }

  function transition(status: MobilePairingRuntimeState["status"]): void {
    if (runtimeStatus === status) return;
    runtimeStatus = status;
    if (status !== "error") runtimeFailure = null;
    emitStatus();
  }

  /**
   * 未认证连接增减后的过渡态归位：有 pending → connecting（原版"手机正在连接"），
   * 全部离开且无人认证成功 → 回 running（等待手机连接）。
   */
  function reconcilePendingPhase(): void {
    if (authedConnection) return;
    if (runtimeStatus !== "connecting" && runtimeStatus !== "running") return;
    transition(pendingSockets.size > 0 ? "connecting" : "running");
  }

  /**
   * 踢除当前已连手机（对齐原版 relay KICKED 语义）：先送达 kicked 错误帧再断开，
   * 手机页据此显示"会话已被其他配对页面接管"而不是无限重连。
   */
  function kickActivePhone(reason: string): void {
    const connection = authedConnection;
    if (!connection) return;
    authedConnection = null;
    try {
      if (connection.socket.readyState === 1) {
        connection.socket.send(JSON.stringify({ type: "error", code: "kicked" }));
      }
    } catch (error) {
      logger.warn("[mobile-pairing] 踢除帧发送失败（socket 可能已关闭）", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    connection.socket.close();
    logger.info("[mobile-pairing] 已踢除已连手机", { reason });
  }

  /**
   * 服务终止给手机一个终态失败面（对齐原版 failure 语义）：
   * restarted=被新的配对服务接管（kicked）；window-closed=承载工作区的窗口已关闭
   * （workspace-closed）；其余=桌面端主动停止（desktop-stopped）。
   */
  function stop(reason: string): void {
    const connection = authedConnection;
    authedConnection = null;
    if (connection) {
      const code =
        reason === "restarted"
          ? "kicked"
          : reason === "window-closed"
            ? "workspace-closed"
            : "desktop-stopped";
      try {
        if (connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({ type: "error", code }));
        }
      } catch {
        // socket 已关闭属正常路径
      }
      try {
        connection.socket.close();
      } catch {
        // socket 已关闭属正常路径
      }
    }
    for (const socket of pendingSockets) {
      try {
        socket.close();
      } catch {
        // socket 已关闭属正常路径
      }
    }
    pendingSockets.clear();
    if (wss) {
      wss.close();
      wss = null;
    }
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
    serviceChannel = null;
    sessionChannel = null;
    attachedHostChild = null;
    if (clientPort) {
      clientPort.close();
      clientPort = null;
    }
    state = createPairingCoreState();
    startParams = null;
    startResult = null;
    boundAddress = null;
    boundPort = 0;
    runtimeStatus = "idle";
    runtimeFailure = null;
    logger.info("[mobile-pairing] 配对服务已停止", { reason });
    emitStatus();
  }

  function sendToPhone(frame: Record<string, unknown>): void {
    if (authedConnection?.socket.readyState === 1) {
      authedConnection.socket.send(JSON.stringify(frame));
    }
  }

  /**
   * 向窗口 Host 申请 local scoped service 端口并建立 rpc 客户端（惰性，首次认证才连）。
   * 对齐原版 workspace-bridge 语义：Host 实例变化（窗口 Host 重启）时旧端口作废，重附着新实例。
   */
  function ensureServiceChannels(): { task: IChannel; session: IChannel } {
    if (!startParams || !startResult) {
      throw new Error("pairing server is not running");
    }
    const hostChild = startParams.resolveHostChild();
    if (!hostChild || hostChild.pid === undefined) {
      // 对齐原版 DESKTOP_HOST_MISSING：窗口/工作区不可用 → 手机端 workspace-closed 失败面。
      const error: Error & { code?: string } = new Error(
        "window host process is not ready for pairing attachment",
      );
      error.code = "workspace-closed";
      throw error;
    }
    if (serviceChannel && sessionChannel && attachedHostChild === hostChild) {
      return { task: serviceChannel, session: sessionChannel };
    }
    // Host 实例变化：旧端口/通道随旧进程一起失效，先丢弃再重建。
    if (attachedHostChild !== hostChild) {
      serviceChannel = null;
      sessionChannel = null;
      if (clientPort) {
        clientPort.close();
        clientPort = null;
      }
      attachedHostChild = hostChild;
    }
    // electron API 懒加载：plain node（协议级测试）里 require("electron") 拿不到
    // MessageChannelMain，new 时抛错并走错误帧路径；Electron 运行时里是完整 API。
    const requireElectron = createRequire(import.meta.url);
    const { MessageChannelMain: MessageChannelMainCtor } = requireElectron(
      "electron",
    ) as typeof import("electron");
    const { port1, port2 } = new MessageChannelMainCtor();
    hostChild.postMessage(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: randomUUID(),
        attachmentId: randomUUID(),
        // 手机是可恢复的远程客户端；与桌面 continuous 链路明确区分（AGENTS.md 进程协议边界）。
        clientMode: "web-remote-replayable",
        scope: { kind: "local" },
      },
      [port2],
    );
    clientPort = port1;
    // 与 host/electronPort.ts 同构的适配：main/host 是两个编译段，不能跨段 import。
    const portLike = {
      addEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
        port1.on("message", listener);
      },
      removeEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
        port1.off("message", listener);
      },
      postMessage(data: MessagePortPayload) {
        port1.postMessage(data);
      },
      start() {
        port1.start();
      },
      close() {
        port1.close();
      },
    };
    const protocol = new MessagePortProtocol(portLike);
    const client = new ChannelClient(protocol);
    serviceChannel = client.getChannel("drora-task");
    sessionChannel = client.getChannel("drora-session");
    logger.info("[mobile-pairing] scoped service 端口已附着", {
      workspacePath: startParams.workspacePath,
    });
    return { task: serviceChannel, session: sessionChannel };
  }

  async function handleAuthedFrame(frame: PhoneInboundFrame): Promise<void> {
    if (!startParams) return;
    const { workspacePath, workspaceIdentity } = startParams;
    try {
      switch (frame.type) {
        case "list": {
          const { task } = ensureServiceChannels();
          const tasks = (await task.call("listTasks", {
            workspacePath,
            workspaceIdentity,
          })) as Array<Record<string, unknown>>;
          sendToPhone({
            type: "taskList",
            tasks: tasks.map((meta) => ({
              taskId: meta.taskId,
              title: meta.title,
              status: meta.status,
              updatedAt: meta.updatedAt,
            })),
          });
          return;
        }
        case "open": {
          const { session } = ensureServiceChannels();
          const messages = (await session.call("readSessionMessages", {
            sessionId: frame.taskId,
            limit: 200,
          })) as unknown[];
          sendToPhone({ type: "timeline", taskId: frame.taskId, messages });
          return;
        }
        case "send": {
          const content = frame.content.trim();
          if (!content) return;
          const { task } = ensureServiceChannels();
          await task.call("sendPrompt", {
            taskId: frame.taskId,
            workspacePath,
            workspaceIdentity,
            traceId: randomUUID(),
            content,
            clientMode: "web-remote-replayable",
            clientLabel: "mobile-web",
          });
          sendToPhone({ type: "accepted", taskId: frame.taskId });
          return;
        }
        case "permission": {
          const { task } = ensureServiceChannels();
          await task.call("respondPermission", {
            taskId: frame.taskId,
            workspacePath,
            workspaceIdentity,
            runId: frame.runId,
            requestId: frame.requestId,
            optionId: frame.optionId,
            response: { decision: frame.decision },
          });
          return;
        }
        case "stop": {
          const { task } = ensureServiceChannels();
          await task.call("stopGeneration", {
            taskId: frame.taskId,
            workspacePath,
            workspaceIdentity,
          });
          return;
        }
        case "events": {
          // 会话事件日志按 seq 单调递增；手机端用 afterSeq 增量拉，
          // 投影出流式文本与待决权限卡片（permission.requested/resolved）。
          const { session } = ensureServiceChannels();
          const result = (await session.call("readSessionEvents", {
            sessionId: frame.taskId,
            afterSeq: frame.afterSeq,
            limit: 200,
          })) as { events?: Array<Record<string, unknown>> };
          const events = result.events ?? [];
          const lastEvent = events[events.length - 1] as { seq?: number } | undefined;
          sendToPhone({
            type: "events",
            taskId: frame.taskId,
            events,
            lastSeq:
              lastEvent && typeof lastEvent.seq === "number" ? lastEvent.seq : frame.afterSeq,
            hasMore: events.length >= 200,
          });
          return;
        }
        default:
          return;
      }
    } catch (error) {
      logger.warn("[mobile-pairing] 手机帧处理失败", {
        type: frame.type,
        error: error instanceof Error ? error.message : String(error),
      });
      // Host 缺失（窗口/工作区已不可用）对齐原版 DESKTOP_HOST_MISSING → workspace-closed 失败面。
      const code =
        (error as { code?: string }).code === "workspace-closed"
          ? "workspace-closed"
          : "bridge-call-failed";
      sendToPhone({
        type: "error",
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleSocketMessage(socket: WebSocket, raw: unknown): void {
    let frame: PhoneInboundFrame;
    try {
      frame = JSON.parse(String(raw)) as PhoneInboundFrame;
    } catch {
      return;
    }
    if (!authedConnection || authedConnection.socket !== socket) {
      // 握手帧：hello（配对令牌）或 resume（会话令牌）。
      if (frame.type === "hello" && typeof frame.pairToken === "string") {
        const outcome = attemptPair(state, frame.pairToken);
        state = outcome.state;
        if (!outcome.ok || !outcome.sessionToken) {
          socket.send(JSON.stringify({ type: "error", code: outcome.failure ?? "pair-failed" }));
          socket.close();
          return;
        }
        // 单设备语义：新配对生效即接管，旧连接按 relay KICKED 语义踢除。
        kickActivePhone("re-paired-by-new-device");
        pendingSockets.delete(socket);
        authedConnection = { socket, sessionToken: outcome.sessionToken };
        socket.send(
          JSON.stringify({
            type: "paired",
            workspacePath: startParams?.workspacePath ?? "",
            sessionToken: outcome.sessionToken,
          }),
        );
        transition("active");
        socket.on("close", () => {
          if (authedConnection?.socket === socket) {
            authedConnection = null;
            // 设备断开后服务保持运行（对齐原版：无空闲自停，等待重连/显式停止）。
            transition("running");
          }
        });
        void handleAuthedFrame({ type: "list" });
        return;
      }
      if (frame.type === "resume" && typeof frame.sessionToken === "string") {
        if (isSessionTokenValid(state, frame.sessionToken)) {
          // resume 走的是既有会话恢复，不产生"接管"语义；理论上不会与旧连接并存，保险起见仍踢旧。
          kickActivePhone("resume-replaced-connection");
          pendingSockets.delete(socket);
          authedConnection = { socket, sessionToken: frame.sessionToken };
          socket.send(
            JSON.stringify({
              type: "paired",
              workspacePath: startParams?.workspacePath ?? "",
              sessionToken: frame.sessionToken,
            }),
          );
          transition("active");
          socket.on("close", () => {
            if (authedConnection?.socket === socket) {
              authedConnection = null;
              transition("running");
            }
          });
          void handleAuthedFrame({ type: "list" });
          return;
        }
        socket.send(JSON.stringify({ type: "error", code: "invalid-session" }));
        socket.close();
        return;
      }
      socket.send(JSON.stringify({ type: "error", code: "not-authenticated" }));
      socket.close();
      return;
    }
    void handleAuthedFrame(frame);
  }

  return {
    isRunning,
    runtimeState,

    async start(params: MobilePairingStartParams): Promise<MobilePairingStartResult> {
      // 对齐原版 start 语义：服务已在运行时重启而不是拒绝（换窗口/换工作区即接管）。
      if (httpServer) {
        stop("restarted");
      }
      runtimeStatus = "starting";
      runtimeFailure = null;
      emitStatus();
      const lan = pickLanAddress();
      if (!lan) {
        runtimeStatus = "error";
        runtimeFailure = {
          reason: "internal",
          message: "no routable LAN IPv4 address available",
        };
        emitStatus();
        throw new Error("no routable LAN IPv4 address available");
      }
      startParams = params;
      const issued = issuePairTicket();
      state = issued.state;
      const server = createServer((_request, response) => {
        // 任何路径都回手机 SPA；配对令牌校验发生在 WS 握手，不在页面资源层。
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(PHONE_PAGE_HTML);
      });
      httpServer = server;
      wss = new WebSocketServer({ server, path: "/ws" });
      wss.on("connection", (socket) => {
        // 对齐原版 connecting 过渡态：WS 已建立、握手未完成 = "正在连接手机"。
        pendingSockets.add(socket);
        reconcilePendingPhase();
        socket.on("close", () => {
          pendingSockets.delete(socket);
          reconcilePendingPhase();
        });
        socket.on("message", (raw) => handleSocketMessage(socket, raw));
      });
      const result: MobilePairingStartResult = {
        url: "",
        port: 0,
        pairToken: issued.ticket.pairToken,
      };
      startResult = result;
      // 端口绑定是异步的；URL 含实际端口，必须等 listen 完成再返回给 UI 生成二维码。
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "0.0.0.0", () => {
          server.off("error", reject);
          const address = server.address();
          const bound = typeof address === "object" && address ? address.port : 0;
          boundPort = bound;
          boundAddress = lan.address;
          result.port = bound;
          result.url = buildPairingUrl({
            address: lan.address,
            port: bound,
            pairToken: issued.ticket.pairToken,
          });
          logger.info("[mobile-pairing] 配对服务已启动", {
            url: result.url,
            interface: lan.interfaceName,
          });
          resolve();
        });
      }).catch((error: unknown) => {
        // listen 失败：状态落 error（推送失败面），并清理半开资源后向上抛。
        const message = error instanceof Error ? error.message : String(error);
        stop("listen-failed");
        runtimeStatus = "error";
        runtimeFailure = { reason: "internal", message };
        emitStatus();
        throw error;
      });
      transition("running");
      return result;
    },

    /**
     * 重置配对（对齐原版 resetPairing/"刷新二维码"）：踢除已连手机、作废旧票据、
     * 换发新票据；服务与端口保持不变，避免"刷新"抖动整条监听链路。
     */
    async resetPairing(): Promise<MobilePairingStartResult> {
      if (!httpServer || !startParams || !boundAddress) {
        throw new Error("mobile pairing server is not running");
      }
      kickActivePhone("pairing-reset");
      const issued = issuePairTicket();
      state = issued.state;
      const result: MobilePairingStartResult = {
        url: buildPairingUrl({
          address: boundAddress,
          port: boundPort,
          pairToken: issued.ticket.pairToken,
        }),
        port: boundPort,
        pairToken: issued.ticket.pairToken,
      };
      startResult = result;
      logger.info("[mobile-pairing] 配对已重置（换发票据并踢除旧连接）");
      transition("running");
      return result;
    },
    stop,
  };
}

const PHONE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Drora</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0e0f11; color: #e8e8e6; font-family: system-ui, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid #2a2b2e; display: flex; align-items: center; gap: 8px; position: sticky; top: 0; background: #0e0f11; z-index: 2; }
  header h1 { font-size: 16px; margin: 0; flex: 1; }
  main { padding: 12px 16px 40px; }
  .card { background: #17181b; border: 1px solid #2a2b2e; border-radius: 12px; padding: 12px; margin-bottom: 10px; }
  .task { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 2px; border-bottom: 1px solid #232427; cursor: pointer; }
  .task:last-child { border-bottom: 0; }
  .title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: #8a8b8f; font-size: 12px; flex-shrink: 0; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; flex-shrink: 0; }
  .badge.running { background: #2b3a2e; color: #7ad07a; }
  .badge.idle { background: #26272b; color: #9a9ba0; }
  .msg { padding: 8px 10px; border-radius: 10px; margin: 6px 0; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: #24304a; }
  .msg.assistant { background: #1d1e21; }
  .tool-line { color: #8a8b8f; font-size: 12px; padding: 2px 0; }
  .thinking { color: #6f7075; font-size: 12px; padding: 2px 0; }
  input, textarea, button { font: inherit; }
  textarea { width: 100%; min-height: 72px; background: #17181b; color: inherit; border: 1px solid #2a2b2e; border-radius: 10px; padding: 10px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  button { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid #2a2b2e; background: #24304a; color: inherit; cursor: pointer; }
  button.secondary { background: #17181b; }
  button:disabled { opacity: 0.5; cursor: default; }
  .hidden { display: none; }
  .tip { color: #8a8b8f; font-size: 13px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #2b3a2e; color: #7ad07a; font-size: 12px; }
  .perm { border-color: #4a3a24; background: #241f17; }
  .perm .title { font-weight: 600; margin-bottom: 4px; }
</style>
</head>
<body>
<header><h1>Drora</h1><span id="conn" class="tip">连接中…</span></header>
<main>
  <section id="unpaired" class="hidden"><p class="tip" id="unpairedText">配对链接无效或已过期，请在桌面端重新生成二维码。</p></section>
  <section id="tasks" class="hidden"><div class="card" id="taskList"></div></section>
  <section id="chat" class="hidden">
    <div id="perms"></div>
    <div class="card">
      <div class="task" id="back"><span class="title">← 返回任务列表</span><span id="turnPill" class="pill hidden">生成中</span></div>
      <div id="timeline"></div>
    </div>
    <textarea id="input" placeholder="输入要发送给 Agent 的内容…"></textarea>
    <div class="row"><button id="send">发送</button><button id="stop" class="secondary">停止</button></div>
  </section>
</main>
<script>
var ws = null;
var wsWanted = false;
var retryTimer = null;
var terminal = false;
var currentTaskId = null;
var listTimer = null;
var chatTimer = null;
var pairToken = location.pathname.indexOf("/p/") === 0 ? location.pathname.slice(3) : null;

function el(id) { return document.getElementById(id); }
function show(id) {
  for (var s of ["unpaired", "tasks", "chat"]) el(s).classList.toggle("hidden", s !== id);
}
function esc(text) {
  var d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}
function setConn(text) { el("conn").textContent = text; }

function connect() {
  var proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host + "/ws");
  ws.onopen = function () {
    var saved = sessionStorage.getItem("drora-mobile-session");
    if (saved) { ws.send(JSON.stringify({ type: "resume", sessionToken: saved })); }
    else if (pairToken) { ws.send(JSON.stringify({ type: "hello", pairToken: pairToken })); }
    else { show("unpaired"); }
  };
  ws.onmessage = function (e) { handle(JSON.parse(e.data)); };
  ws.onclose = function () {
    setConn("已断开，重连中…");
    ws = null;
    if (!wsWanted) { wsWanted = true; }
    // 终态失败面（kicked/过期/桌面停止）后不再重连：令牌已失效，重试只会反复失败。
    if (terminal || retryTimer) { return; }
    retryTimer = setInterval(function () {
      var saved = sessionStorage.getItem("drora-mobile-session");
      if (saved || pairToken) { connect(); }
    }, 2000);
  };
}

function onPaired(frame) {
  if (frame.sessionToken) { sessionStorage.setItem("drora-mobile-session", frame.sessionToken); }
  setConn("已连接");
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  if (currentTaskId) {
    show("chat");
    requestTimeline();
    startEventLoop();
  } else {
    show("tasks");
    requestList();
  }
}

function requestList() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "list" })); }
function requestTimeline() { if (ws && ws.readyState === 1 && currentTaskId) ws.send(JSON.stringify({ type: "open", taskId: currentTaskId })); }

// —— 会话事件增量投影（权限请求等交互面）——
var lastSeq = 0;
var eventBusy = false;
var pendingPerms = {};

function requestEvents() {
  if (!ws || ws.readyState !== 1 || !currentTaskId || eventBusy) return;
  eventBusy = true;
  ws.send(JSON.stringify({ type: "events", taskId: currentTaskId, afterSeq: lastSeq }));
}

function applyEvents(frame) {
  eventBusy = false;
  if (frame.taskId !== currentTaskId) return;
  var events = frame.events || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (typeof ev.seq === "number" && ev.seq > lastSeq) { lastSeq = ev.seq; }
    var p = ev.payload || {};
    if (ev.type === "permission.requested") {
      var key = p.requestId || p.toolCallId;
      pendingPerms[key] = {
        requestId: key,
        toolName: p.toolName || "tool",
        reason: p.reason || "",
        options: p.options || []
      };
    } else if (ev.type === "permission.resolved") {
      delete pendingPerms[p.requestId || p.toolCallId];
    }
  }
  renderPerms();
}

function renderPerms() {
  var box = el("perms");
  box.innerHTML = "";
  var keys = Object.keys(pendingPerms);
  for (var i = 0; i < keys.length; i++) {
    var perm = pendingPerms[keys[i]];
    var card = document.createElement("div");
    card.className = "card perm";
    var html = '<div class="title">🔐 ' + esc(perm.toolName) + '</div>';
    if (perm.reason) { html += '<p class="tip">' + esc(perm.reason) + "</p>"; }
    var options = perm.options.length ? perm.options : [
      { optionId: "allow", name: "允许", response: { decision: "allow" } },
      { optionId: "deny", name: "拒绝", response: { decision: "deny" } }
    ];
    html += '<div class="row">';
    for (var k = 0; k < options.length; k++) {
      var opt = options[k];
      var decision = opt.response && opt.response.decision ? opt.response.decision : "allow";
      html += '<button data-perm="' + esc(perm.requestId) + '" data-opt="' + esc(opt.optionId) +
        '" data-decision="' + esc(decision) + '">' + esc(opt.name) + "</button>";
    }
    html += "</div>";
    card.innerHTML = html;
    box.appendChild(card);
  }
  var buttons = box.querySelectorAll("button");
  for (var b = 0; b < buttons.length; b++) {
    buttons[b].onclick = function () {
      var payload = {
        type: "permission",
        taskId: currentTaskId,
        requestId: this.getAttribute("data-perm"),
        optionId: this.getAttribute("data-opt"),
        decision: this.getAttribute("data-decision")
      };
      ws.send(JSON.stringify(payload));
      delete pendingPerms[payload.requestId];
      renderPerms();
    };
  }
}

function startEventLoop() {
  lastSeq = 0;
  pendingPerms = {};
  renderPerms();
  setInterval(function () {
    if (!el("chat").classList.contains("hidden")) requestEvents();
  }, 1500);
  requestEvents();
}

function handle(frame) {
  if (frame.type === "paired") { onPaired(frame); return; }
  if (frame.type === "taskList") { renderTasks(frame.tasks || []); return; }
  if (frame.type === "timeline") { renderTimeline(frame.messages || []); return; }
  if (frame.type === "events") { applyEvents(frame); return; }
  if (frame.type === "accepted") { el("input").value = ""; requestTimeline(); return; }
  if (frame.type === "error") {
    eventBusy = false;
    // 对齐原版失败面：kicked=新配对接管（relay KICKED 语义）；desktop-stopped=桌面端停止。
    // 两者与令牌过期一样都是终态：清会话、停止重连、显示对应文案。
    if (frame.code === "kicked") {
      terminal = true;
      sessionStorage.removeItem("drora-mobile-session");
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      el("unpairedText").textContent = "此配对会话已被其他页面接管，请在桌面端重新扫码。";
      setConn("会话已被接管");
      show("unpaired");
      return;
    }
    if (frame.code === "desktop-stopped") {
      terminal = true;
      sessionStorage.removeItem("drora-mobile-session");
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      el("unpairedText").textContent = "桌面端已停止远程控制，请在桌面端重新开启后扫码。";
      setConn("远程控制已停止");
      show("unpaired");
      return;
    }
    if (frame.code === "workspace-closed") {
      terminal = true;
      sessionStorage.removeItem("drora-mobile-session");
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      el("unpairedText").textContent = "桌面端承载这个工作区的窗口已经关闭，请回到桌面端重新发起访问。";
      setConn("工作区已关闭");
      show("unpaired");
      return;
    }
    var retryable = frame.code === "invalid-session";
    if (retryable) { sessionStorage.removeItem("drora-mobile-session"); }
    if (!retryable && (frame.code === "unknown-token" || frame.code === "expired-token")) {
      terminal = true;
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
      setConn("配对已失效");
      show("unpaired");
      return;
    }
    setConn("错误: " + (frame.code || ""));
    return;
  }
}

function renderTasks(tasks) {
  var list = el("taskList");
  list.innerHTML = "";
  if (!tasks.length) { list.innerHTML = '<p class="tip">当前工作区还没有任务</p>'; }
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var row = document.createElement("div");
    row.className = "task";
    var running = t.status === "running" || t.status === "pending";
    var badge = '<span class="badge ' + (running ? "running" : "idle") + '">' + esc(t.status || "") + "</span>";
    row.innerHTML = '<span class="title">' + esc(t.title) + "</span>" + badge;
    row.onclick = (function (taskId) {
      return function () {
        currentTaskId = taskId;
        el("timeline").innerHTML = "";
        show("chat");
        requestTimeline();
        startChatTimer();
      };
    })(t.taskId);
    list.appendChild(row);
  }
  show("tasks");
}

function partText(m) {
  var out = [];
  var tools = [];
  var parts = m.parts || [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.type === "text" && p.text) { out.push(p.text); }
    else if (p.type === "tool") {
      var state = p.state && p.state.status ? p.state.status : "";
      tools.push("⚙ " + p.tool + (state ? " · " + state : ""));
    }
  }
  return { text: out.join(String.fromCharCode(10)), tools: tools };
}

function renderTimeline(messages) {
  var tl = el("timeline");
  var stick = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  tl.innerHTML = "";
  var running = false;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var role = m.info && m.info.role ? m.info.role : "other";
    var composed = partText(m);
    if (composed.tools.length) {
      for (var k = 0; k < composed.tools.length; k++) {
        var line = document.createElement("div");
        line.className = "tool-line";
        line.innerHTML = esc(composed.tools[k]);
        tl.appendChild(line);
        if (composed.tools[k].indexOf("pending") >= 0) running = true;
      }
    }
    if (!composed.text) continue;
    var div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "user" : "assistant");
    var text = composed.text;
    div.innerHTML = esc(text.length > 6000 ? text.slice(0, 6000) + "…" : text);
    tl.appendChild(div);
  }
  var last = messages[messages.length - 1];
  if (last && last.parts) {
    for (var j = 0; j < last.parts.length; j++) {
      if (last.parts[j].type === "tool" && last.parts[j].state && last.parts[j].state.status === "running") running = true;
    }
  }
  el("turnPill").classList.toggle("hidden", !running);
  if (stick) window.scrollTo(0, document.body.scrollHeight);
}

function startChatTimer() {
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(function () {
    if (!el("chat").classList.contains("hidden")) requestTimeline();
  }, 2000);
}
function startListTimer() {
  if (listTimer) clearInterval(listTimer);
  listTimer = setInterval(function () {
    if (!el("tasks").classList.contains("hidden")) requestList();
  }, 8000);
}

el("back").onclick = function () { currentTaskId = null; show("tasks"); requestList(); startListTimer(); };
el("send").onclick = function () {
  var content = el("input").value.trim();
  if (!content || !currentTaskId) return;
  ws.send(JSON.stringify({ type: "send", taskId: currentTaskId, content: content }));
};
document.getElementById("stop").onclick = function () {
  if (currentTaskId) ws.send(JSON.stringify({ type: "stop", taskId: currentTaskId }));
};

connect();
startListTimer();
</script>
</body>
</html>
`;
