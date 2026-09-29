// Drora Relay Server · WS 服务接线：连接生命周期、鉴权、配对状态机驱动、
// data 转发（matched + server_ts 盖章）、错误面、限速与死亡检测。
// 职责边界：本模块不做任何业务解析；协议语义见 specs/mobile-relay-server.md §3/§4/§5。
import { createServer } from "node:http";
import { resolve as resolvePath } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createRateLimiter } from "./rateLimiter.js";
import { routeStaticRequest } from "./staticAssets.js";
import { send, sendError, sendThenTerminate } from "./wire.js";
import {
  MAX_WS_PAYLOAD_BYTES,
  REGISTER_RATE_PER_MINUTE,
  isDataEnvelope,
  makeNonce,
  makeTerminalSid,
  stampServerTs,
  verifyProof,
  type RelayRole,
} from "./protocol.js";
import type { DeviceRegistry } from "./deviceRegistry.js";
import { createSessionStore } from "./sessionStore.js";

export interface RelayServerLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface RelayServerOptions {
  registry: DeviceRegistry;
  port?: number;
  host?: string;
  /** 单条 WS 消息硬上限；超限由 ws 库断开（默认对齐官方 1MiB）。 */
  maxPayloadBytes?: number;
  /** 注册限速（次/分钟/IP）。 */
  registerRatePerMinute?: number;
  /** WS ping 间隔（死亡检测），3 次未 pong 判死。 */
  pingIntervalMs?: number;
  /** close 握手宽限（超时对残留连接 terminate，保证 close() 有界返回；内嵌宿主停机用）。 */
  closeGraceMs?: number;
  /**
   * 静态资产托管根目录（CLI --static-dir）：GET /remote/** 按路径树映射该目录下文件。
   * 用途=官方 v4 前端资产本地托管（双栈对比测试床 + R3 路线 A 基石），
   * 目录结构镜像 <staticRoot>/remote/v4/index.html 与
   * <staticRoot>/remote/v4/<version>/assets/*（spec §12.5）。
   */
  staticRoot?: string;
  /** 独立 mobile-web 包的静态根，未命中时才进入官方资产代理。 */
  mobileRoot?: string;
  /**
   * 内建官方页资产代理（spec §12.9）：GET /remote/** 未命中 staticRoot 时，
   * cacheDir 缓存 → fetch 官方源站（10s 超时）→ 原始字节落盘缓存、出站改写后
   * 服务；离线回退：入口文档（/remote/v4[/index.html]）302 → /m/index.html
   * （保留查询串，R2 极简页兜底），其余资产 404。与 staticRoot 互不排斥
   * （staticRoot 优先）；决策与安全约束在 staticAssets.ts。
   */
  remoteAssets?: { cacheDir: string };
  /** 资产代理 fetch 实现（依赖注入，测试 mock；缺省 globalThis.fetch，不污染 global）。 */
  fetchImpl?: typeof fetch;
  log?: RelayServerLogger;
}

interface ConnectionMeta {
  id: number;
  ip: string;
  role: RelayRole | null;
  deviceSid: string | null;
  terminalSid: string | null;
  pendingNonce: string | null;
  isAlive: boolean;
}

const ERROR_CODES = {
  authFailed: "AUTH_FAILED",
  wrongParam: "WRONG_PARAM",
  kicked: "KICKED",
  deviceOffline: "DEVICE_OFFLINE",
  internal: "INTERNAL",
} as const;

export function createRelayServer(options: RelayServerOptions) {
  const log = options.log ?? { info: () => {}, warn: () => {} };
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_WS_PAYLOAD_BYTES;
  const ratePerMinute = options.registerRatePerMinute ?? REGISTER_RATE_PER_MINUTE;
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  // 防目录穿越基准：静态根的绝对形态（spec §12.5——resolve 后必须仍在其内）。
  const staticRootAbs = options.staticRoot ? resolvePath(options.staticRoot) : null;
  const mobileRootAbs = options.mobileRoot ? resolvePath(options.mobileRoot) : null;
  // 内建资产代理缓存根的绝对形态（spec §12.9）。
  const remoteAssetsAbs = options.remoteAssets ? resolvePath(options.remoteAssets.cacheDir) : null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  // 错误帧统一出口：线协议 message 空串（对齐官方），诊断细节进服务端日志。
  function emitError(socket: WebSocket, code: string, detail?: string): void {
    if (detail) log.warn("[relay-server] error frame", { code, detail });
    sendError(socket, code);
  }

  const httpServer = createServer(async (request, response) => {
    // 健康检查供部署探活。
    if ((request.url ?? "").split("?")[0] === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    // 必须按 pathname 匹配——request.url 含查询串（QR 的 sid/hash 等），
    // 精确匹配会让带参数的手机页 404（E2E 实锤）。
    let pagePathname = "";
    let pageSearch = "";
    try {
      const parsed = new URL(request.url ?? "/", "http://relay.local");
      pagePathname = parsed.pathname;
      pageSearch = parsed.search;
    } catch {
      pagePathname = request.url ?? "";
    }
    // 页面/静态托管路由（spec §12.5/§12.9）：R2 手机页（/m*）与 /remote/** 托管
    // 资产三级来源（staticRoot → mobileRoot → 内建 cache/fetch 代理）+ 离线回退；决策与安全
    // 约束集中在 staticAssets.ts（单文件行数门禁），此处仅接线 HTTP 响应。
    const routed = await routeStaticRequest({
      method: request.method ?? "GET",
      pathname: pagePathname,
      search: pageSearch,
      staticRootAbs,
      mobileRootAbs,
      remoteAssetsAbs,
      fetchImpl,
    });
    if (routed) {
      response.writeHead(routed.status, routed.headers);
      response.end(routed.body);
      return;
    }
    // 自托管资产库不做官方式版本门控：页面与桌面端同仓发布，天然配套（spec §7）。
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: maxPayloadBytes,
    perMessageDeflate: true,
  });

  const sessions = createSessionStore();
  const rateLimiter = createRateLimiter(ratePerMinute, 60_000);
  const metaBySocket = new WeakMap<WebSocket, ConnectionMeta>();
  let nextConnectionId = 1;

  function sendTo(sid: string | null, role: RelayRole, message: Record<string, unknown>): boolean {
    if (!sid) return false;
    const peer = sessions.peer(sid, role);
    if (!peer) return false;
    const meta = socketsByConnectionId.get(peer.connectionId);
    if (!meta) return false;
    send(meta.socket, message);
    return true;
  }

  const socketsByConnectionId = new Map<number, { socket: WebSocket; meta: ConnectionMeta }>();

  function closeConnection(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // 已关闭属正常路径
    }
  }

  function detachAndNotify(meta: ConnectionMeta): void {
    if (!meta.deviceSid || !meta.role) return;
    const result = sessions.detach(meta.deviceSid, meta.id);
    const deviceSid = meta.deviceSid;
    // device 死亡：只要 terminal 在线就必须走死亡序列并断开——
    // 不以 statusChanged 为门（旧 terminal 先离开时状态已是 waiting，
    // 按状态门控会漏发，集成测试实锤）。
    // 序列对齐官方（E2E #3/#4，specs/mobile-relay-server.md §11）：
    // pair_status_ack{waiting} → error{DEVICE_OFFLINE} → terminate（客户端见 1006，
    // 官方不发 close 帧）。
    if (result.detachedRole === "device") {
      const terminalPeer = sessions.peer(deviceSid, "device");
      if (terminalPeer) {
        const terminalMeta = socketsByConnectionId.get(terminalPeer.connectionId);
        if (terminalMeta) {
          // message 空串对齐官方（§11 #7）；诊断细节进服务端日志。
          log.warn("[relay-server] error frame", {
            code: ERROR_CODES.deviceOffline,
            detail: "desktop disconnected",
          });
          sendThenTerminate(terminalMeta.socket, [
            { type: "pair_status_ack", pair_status: "waiting" },
            { type: "error", code: ERROR_CODES.deviceOffline, message: "" },
          ]);
        }
      }
    }
    // 配对状态变化 → 主动推对端（幂等）：terminal 离开时通知 device 回到 waiting。
    // 被踢旧连接的迟到 close（detachedRole=null）不产生任何通知。
    if (result.statusChanged && result.detachedRole === "terminal") {
      sendTo(deviceSid, "terminal", { type: "pair_status_ack", pair_status: "waiting" });
    }
  }

  wss.on("connection", (socket, request) => {
    const meta: ConnectionMeta = {
      id: nextConnectionId++,
      ip: request.socket.remoteAddress ?? "unknown",
      role: null,
      deviceSid: null,
      terminalSid: null,
      pendingNonce: null,
      isAlive: true,
    };
    metaBySocket.set(socket, meta);
    socketsByConnectionId.set(meta.id, { socket, meta });
    socket.on("pong", () => {
      meta.isAlive = true;
    });

    socket.on("message", (raw: unknown) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        emitError(socket, ERROR_CODES.wrongParam, "invalid json");
        return;
      }
      const type = message.type;
      if (type === "device_register_init") {
        handleRegister(socket, meta, message);
        return;
      }
      if (type === "auth_init") {
        void handleAuthInit(socket, meta, message);
        return;
      }
      if (type === "auth_response") {
        void handleAuthResponse(socket, meta, message);
        return;
      }
      if (type === "pair_status_query") {
        handlePairStatusQuery(socket, meta, message);
        return;
      }
      if (type === "data") {
        handleData(meta, message);
        return;
      }
      // 未知帧=协议违例，对齐官方（§11 #6 二次实测）：WRONG_PARAM（message 空串）
      // 后立即 terminate（客户端见 1006）；若为 device，终端经死亡路径收
      // waiting 推送 + DEVICE_OFFLINE。诊断细节进服务端日志。
      log.warn("[relay-server] error frame", {
        code: ERROR_CODES.wrongParam,
        detail: `unknown type: ${String(type)}`,
      });
      sendThenTerminate(socket, [{ type: "error", code: ERROR_CODES.wrongParam, message: "" }]);
    });

    socket.on("close", () => {
      socketsByConnectionId.delete(meta.id);
      detachAndNotify(meta);
    });
    socket.on("error", () => {
      // close 事件随后到达，统一走 detachAndNotify。
    });
  });

  async function handleRegister(
    socket: WebSocket,
    meta: ConnectionMeta,
    message: Record<string, unknown>,
  ): Promise<void> {
    if (!rateLimiter.allow(meta.ip)) {
      // 限速命中：策略性断开（1013 try again later），避免暴力注册。
      closeConnection(socket, 1013, "registration rate limited");
      return;
    }
    const deviceMid = typeof message.device_mid === "string" ? message.device_mid.trim() : "";
    const passHash = typeof message.pass_hash === "string" ? message.pass_hash.trim() : "";
    if (!deviceMid || !passHash) {
      emitError(
        socket,
        ERROR_CODES.wrongParam,
        "device_register_init requires device_mid and pass_hash",
      );
      return;
    }
    const record = await options.registry.register({ deviceMid, passHash });
    send(socket, { type: "device_register_ack", device_sid: record.deviceSid });
  }

  async function handleAuthInit(
    socket: WebSocket,
    meta: ConnectionMeta,
    message: Record<string, unknown>,
  ): Promise<void> {
    const role = message.role;
    const deviceSid = typeof message.device_sid === "string" ? message.device_sid.trim() : "";
    if ((role !== "device" && role !== "terminal") || !deviceSid) {
      emitError(socket, ERROR_CODES.wrongParam, "auth_init requires role and device_sid");
      return;
    }
    // 未知 sid 不在此处拒绝（对齐官方两跳防枚举：challenge 照发，proof 阶段统一
    // AUTH_FAILED——spec §11 #5）；auth_response 侧 record 缺失即拒。
    // 宽松重试：challenge 丢失后客户端重发 auth_init 允许重新挑战（覆盖 pending nonce）。
    const nonce = makeNonce();
    meta.pendingNonce = nonce;
    meta.role = role;
    meta.deviceSid = deviceSid;
    send(socket, { type: "auth_challenge", nonce });
  }

  async function handleAuthResponse(
    socket: WebSocket,
    meta: ConnectionMeta,
    message: Record<string, unknown>,
  ): Promise<void> {
    const proof = typeof message.proof === "string" ? message.proof : "";
    const nonce = meta.pendingNonce;
    const role = meta.role;
    const deviceSid = meta.deviceSid;
    if (!nonce || !role || !deviceSid || !proof) {
      emitError(socket, ERROR_CODES.wrongParam, "auth_response without pending challenge");
      return;
    }
    meta.pendingNonce = null;
    const record = await options.registry.getBySid(deviceSid);
    if (!record || !verifyProof({ passHash: record.passHash, nonce, role, deviceSid, proof })) {
      emitError(socket, ERROR_CODES.authFailed, "proof mismatch");
      return;
    }
    options.registry.touch(deviceSid, Date.now());
    if (role === "device") {
      log.warn("[relay-server][diag-auth] device attached", { deviceSid });
      const result = sessions.attachDevice(deviceSid, { connectionId: meta.id, sid: deviceSid });
      // auth_ack 字段集对齐官方（E2E #2）：device ack 携带 device_sid + terminal_sid
      //（未配对为 ""，已配对为当前 terminal 的 sid——用 sessionStore 当前视图）。
      const view = sessions.view(deviceSid);
      send(socket, {
        type: "auth_ack",
        pair_status: result.status,
        device_sid: deviceSid,
        terminal_sid: view.terminal?.sid ?? "",
      });
      return;
    }
    const terminalSid = makeTerminalSid();
    meta.terminalSid = terminalSid;
    const attach = sessions.attachTerminal(deviceSid, { connectionId: meta.id, sid: terminalSid });
    // 踢除顺序不变量（spec §4.1）：先 KICKED 旧 terminal 并断开，再应答新 terminal。
    // 断开语义对齐官方（E2E #4）：发帧后 terminate()，客户端见 1006——
    // 官方不发 close 帧，保证旧 terminal 无法在 close 握手窗口内抢发 data。
    if (attach.kickedEndpoint) {
      const oldMeta = socketsByConnectionId.get(attach.kickedEndpoint.connectionId);
      if (oldMeta) {
        // message 空串对齐官方（§11 #7）；诊断细节进服务端日志。
        log.warn("[relay-server] error frame", {
          code: ERROR_CODES.kicked,
          detail: "taken over by another terminal",
        });
        sendThenTerminate(oldMeta.socket, [
          { type: "error", code: ERROR_CODES.kicked, message: "" },
        ]);
      }
    }
    // terminal ack 补 device_sid（E2E #2，官方观测形状）。
    send(socket, {
      type: "auth_ack",
      pair_status: attach.status,
      device_sid: deviceSid,
      terminal_sid: terminalSid,
    });
    // 配对变化主动推送（幂等）：device ≤一次心跳周期内必然知晓。
    if (attach.statusChanged) {
      sendTo(deviceSid, "terminal", { type: "pair_status_ack", pair_status: "matched" });
    }
  }

  function handlePairStatusQuery(
    socket: WebSocket,
    meta: ConnectionMeta,
    message: Record<string, unknown>,
  ): void {
    // E2E #1（P0，specs/mobile-relay-server.md §11）：官方手机页以 pair_status_query
    // 为唯一心跳，terminal 角色必须受理，否则官方手机页配对后 ~10s 终态死亡。
    if ((meta.role !== "device" && meta.role !== "terminal") || !meta.deviceSid) {
      emitError(socket, ERROR_CODES.wrongParam, "pair_status_query requires an authenticated role");
      return;
    }
    // payload device_sid 不参与校验——官方按连接会话身份应答（二次实测：错 sid
    // 的 query 照常回 ack，不报错），此处同样忽略 payload 值。
    const view = sessions.view(meta.deviceSid);
    if (meta.role === "terminal") {
      // 官方观测形状（E2E）：terminal 应答附 terminal_sid:""。
      send(socket, { type: "pair_status_ack", pair_status: view.status, terminal_sid: "" });
      return;
    }
    send(socket, { type: "pair_status_ack", pair_status: view.status });
  }

  function handleData(meta: ConnectionMeta, message: Record<string, unknown>): void {
    // 仅 matched 双向转发；非法/缺 client_ts 静默丢弃（官方行为：接受但不投递）。
    if (meta.role !== "device" && meta.role !== "terminal") return;
    if (!meta.deviceSid) return;
    if (!isDataEnvelope(message)) return;
    const view = sessions.view(meta.deviceSid);
    if (view.status !== "matched") {
      return;
    }
    const peer = sessions.peer(meta.deviceSid, meta.role);
    if (!peer) {
      return;
    }
    const peerMeta = socketsByConnectionId.get(peer.connectionId);
    if (!peerMeta) {
      return;
    }
    send(
      peerMeta.socket,
      stampServerTs(
        { type: "data", payload: message.payload, client_ts: message.client_ts },
        Date.now(),
      ),
    );
  }

  // 死亡检测：ping 间隔 + 双未命中判死（ws 库对超 maxPayload 的入站会触发 error/close）。
  // 判死直接 terminate（客户端见 1006）：close(1006) 是保留码，ws 库会抛
  // TypeError 且被吞掉，连接将永远不关——此前写法是隐患。
  const pingTimer = setInterval(() => {
    for (const { socket, meta } of socketsByConnectionId.values()) {
      if (!meta.isAlive) {
        socket.terminate();
        continue;
      }
      meta.isAlive = false;
      socket.ping();
    }
  }, pingIntervalMs);
  pingTimer.unref?.();

  const listenPort = options.port ?? 4430;
  const listenHost = options.host ?? "0.0.0.0";
  let closeStarted = false;

  return {
    /** 启动监听（返回实际端口，port=0 时由系统分配）。 */
    listen(): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(listenPort, listenHost, () => {
          const address = httpServer.address();
          const port = typeof address === "object" && address ? address.port : listenPort;
          log.info("[relay-server] listening", { host: listenHost, port });
          resolve(port);
        });
      });
    },
    /**
     * 优雅停机：先对全部 WS 发 close(1001) 握手帧，再关 HTTP；close 握手有界等待
     * （缺省 1s，closeGraceMs 可调），超时对残留连接 terminate 保证返回——内嵌宿主
     * （desktop）依赖停机必然结束；幂等，重复调用直接返回。
     */
    async close(): Promise<void> {
      if (closeStarted) return;
      closeStarted = true;
      clearInterval(pingTimer);
      for (const { socket } of socketsByConnectionId.values()) {
        closeConnection(socket, 1001, "server shutting down");
      }
      const finished = new Promise<void>((resolve) => httpServer.close(() => resolve()));
      const graceMs = options.closeGraceMs ?? 1_000;
      await Promise.race([
        finished,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, graceMs);
          timer.unref?.();
        }),
      ]);
      for (const { socket } of socketsByConnectionId.values()) {
        try {
          socket.terminate();
        } catch {
          // 已关闭属正常路径
        }
      }
      await finished;
    },
  };
}
