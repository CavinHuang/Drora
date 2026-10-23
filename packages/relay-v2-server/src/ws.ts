// WsGateway（specs/relay-v2-server.md §5.2/§5.3/§6.4/§6.5；消息状态机逐条对照可执行参照
// packages/shared/test/fixtures/fake-relay-v2.ts:181-302，并补齐 §5.3 fake relay 不模拟的
// 生产行为：认证超时、idle 检测、服务端协议 ping 与优雅停机）。
// 红线：WS URL 携带一次性 token，URL 与 token 永不进日志；消息 trace 只落摘要字段
// （type / pair_status / role / code / bytes），永不落 data.payload 正文（spec §9）。

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
  parseWebRemoteControlRelayV2OutgoingMessage,
} from "@drora/shared/web-remote-relay";
import type {
  WebRemoteControlRelayV2IncomingMessage,
  WebRemoteControlRelayV2Meta,
  WebRemoteControlRelayV2OutgoingMessage,
} from "@drora/shared/web-remote-relay";
import type { RelayConfig } from "./config.js";
import type { RelayLogger } from "./logger.js";
import type {
  Connection,
  ConnectionTrafficCounters,
  DeviceStore,
  PairingRegistry,
  PairingRegistryEvents,
  RelayTrafficView,
  TokenStore,
} from "./types.js";

/** 服务端协议 ping 间隔（spec §5.3「每 30 秒」，无配置键） */
const PING_INTERVAL_MS = 30_000;
/**
 * 优雅停机关闭握手宽限：发起 close 后等待客户端自行断开的上限，超时强制 terminate
 * 保证进程可退出（spec §5.3 未定值，停机专属边缘常量）。
 */
const SHUTDOWN_FLUSH_GRACE_MS = 5_000;
/** 生命周期日志中的 device_sid 前缀长度（spec §9 红线：只记 SID 前缀） */
const SID_LOG_PREFIX_LENGTH = 8;

const sidLogPrefix = (deviceSid: string | undefined): string | undefined =>
  deviceSid === undefined ? undefined : deviceSid.slice(0, SID_LOG_PREFIX_LENGTH);

/**
 * 每连接收发计数（spec §4 状态表 / §9：WsGateway 连接期状态，诊断「单向断」）。
 * 按连接对象弱引用：连接关闭后条目随对象一起不可达出清，/healthz 聚合天然只剩存活连接。
 */
const traffic = new WeakMap<Connection, ConnectionTrafficCounters>();

const countersOf = (connection: Connection): ConnectionTrafficCounters => {
  let counters = traffic.get(connection);
  if (counters === undefined) {
    counters = { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 };
    traffic.set(connection, counters);
  }
  return counters;
};

export interface RelaySendContext {
  logger: RelayLogger;
  /** server_ts 与活跃时间共用时钟；测试可注入 */
  now: () => number;
}

/**
 * 服务端出站发送的唯一路径：每条消息统一追加 server_ts（Unix 秒，spec §5.2），
 * 仅 OPEN 连接可发；trace 只含摘要字段（spec §9 允许集）。
 */
export function sendRelayMessage(
  connection: Connection,
  message: WebRemoteControlRelayV2IncomingMessage,
  context: RelaySendContext,
): void {
  if (connection.socket.readyState !== WebSocket.OPEN) return;
  const line = JSON.stringify({ ...message, server_ts: Math.floor(context.now() / 1000) });
  connection.socket.send(line);
  // 出站计数（spec §9）：含错误与 ack——单向断表现为出站停滞
  const counters = countersOf(connection);
  counters.framesOut += 1;
  counters.bytesOut += Buffer.byteLength(line);
  context.logger.traceMessage({
    type: message.type,
    role: connection.role,
    ...("code" in message ? { code: message.code } : {}),
    ...("pair_status" in message ? { pair_status: message.pair_status } : {}),
    bytes: Buffer.byteLength(line),
  });
}

/**
 * PairingRegistry 通知回调的 wire 装配（types.ts 契约「由 WsGateway 装配为 wire 消息与
 * close」，spec §6.4/§6.5）：KICKED = error 后异步 close；推送语义 pair_status_ack 的
 * terminal_sid 恒 ""（spec §5.2 填充规则）；DEVICE_OFFLINE = error 后关闭 terminal。
 * 回调只发消息与关 socket，不反向调用 registry 改状态（types.ts 契约）。
 */
export function createPairingRegistryEvents(context: RelaySendContext): PairingRegistryEvents {
  return {
    onKicked(oldConnection) {
      sendRelayMessage(oldConnection, { type: "error", code: "KICKED" }, context);
      oldConnection.socket.close();
    },
    onPairStatusPush(peer, pairStatus) {
      sendRelayMessage(
        peer,
        { type: "pair_status_ack", pair_status: pairStatus, terminal_sid: "" },
        context,
      );
    },
    onDeviceOffline(terminal) {
      sendRelayMessage(terminal, { type: "error", code: "DEVICE_OFFLINE" }, context);
      terminal.socket.close();
    },
  };
}

interface SessionState {
  /** 认证时限定时器；auth_init 通过后清除（spec §5.3：超时直接关闭，不发错误消息） */
  authTimer: NodeJS.Timeout | undefined;
  /** idle 检测定时器；仅认证后启动（spec §5.3） */
  idleTimer: NodeJS.Timeout | undefined;
  /** 最近入站帧时刻；任一入站帧（含 ping/pong）刷新（spec §5.3） */
  lastActivity: number;
  /** bind 顺序号：KICKED 短暂窗口内同 SID 两条 device 连接取最新绑定者的 meta */
  boundSeq: number;
}

export interface WsGatewayOptions {
  config: RelayConfig;
  logger: RelayLogger;
  tokens: TokenStore;
  devices: DeviceStore;
  registry: PairingRegistry;
  /** 可注入时钟；默认 Date.now（server_ts、认证超时与 idle 活跃时间共用） */
  now?: () => number;
}

export interface WsGateway {
  /** 挂到 node:http server 的 "upgrade" 事件 */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** /healthz 连接数：已升级且未关闭的连接（含未认证） */
  connectionCount(): number;
  /**
   * /healthz owner 数：有认证绑定的不同 SID 数，与 PairingRegistry owners 表规模恒等——
   * deviceSid 在 bind 时进 owner 表、close 随 release 清理，KICKED 替换窗口内新旧连接
   * 同 SID 合并计数。owner 的唯一所有者仍是 registry，这里只派生不存储。
   */
  ownerCount(): number;
  /** 列表 join：SID 当前 device owner 连接的 meta；离线或未知返回 undefined（spec §5.1 规则 4/6） */
  onlineDeviceMeta(deviceSid: string): WebRemoteControlRelayV2Meta | undefined;
  /** /healthz 收发计数：存活连接按角色聚合（连接关闭即出清；spec §9） */
  trafficCounters(): RelayTrafficView;
  /** 优雅停机（spec §5.3）：停收新连接 → 每连 error INTERNAL → 关闭 → 等待 flush */
  stop(): Promise<void>;
}

export function createWsGateway(options: WsGatewayOptions): WsGateway {
  const { config, logger, tokens, devices, registry } = options;
  const now = options.now ?? Date.now;
  const sendContext: RelaySendContext = { logger, now };
  const connections = new Set<Connection>();
  const sessions = new Map<Connection, SessionState>();
  // 1 MiB 硬闸与 fake relay 一致（spec §3：不得为「大快照」调高，rpc-frame 层已分片）
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  let shuttingDown = false;
  let stopped = false;
  let bindCounter = 0;

  const delay = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** 升级前原始 socket 应答（spec §5.2 规则 1，fake relay 同款报文） */
  const replyUnauthorized = (socket: Duplex): void => {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  };

  const closeWithWrongParam = (connection: Connection): void => {
    sendRelayMessage(connection, { type: "error", code: "WRONG_PARAM" }, sendContext);
    connection.socket.close();
  };

  const closeWithAuthFailed = (connection: Connection): void => {
    sendRelayMessage(connection, { type: "error", code: "AUTH_FAILED" }, sendContext);
    connection.socket.close();
  };

  const refreshActivity = (state: SessionState): void => {
    state.lastActivity = now();
  };

  /**
   * idle 检测（spec §5.3 必备）：活跃连接必然持续来帧（心跳 5s±1s），余量重挂的检查
   * 在真实 idle 到期后一个检查周期内触发；超时 terminate，close 事件按 §6.5 通知对端并清
   * owner——防半开连接把 pair_status 钉死在 matched、设备删除永远 3005。
   */
  const armIdleCheck = (connection: Connection, state: SessionState): void => {
    const check = (): void => {
      const idleFor = now() - state.lastActivity;
      if (idleFor < config.idleTimeoutMs) {
        state.idleTimer = setTimeout(check, config.idleTimeoutMs - idleFor);
        state.idleTimer.unref();
        return;
      }
      logger.info("ws-idle-timeout", {
        role: connection.role,
        sid_prefix: sidLogPrefix(connection.deviceSid),
      });
      connection.socket.terminate();
    };
    state.idleTimer = setTimeout(check, config.idleTimeoutMs);
    state.idleTimer.unref();
  };

  const handleMessage = (connection: Connection, data: RawData, isBinary: boolean): void => {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    const state = sessions.get(connection);
    if (state !== undefined) refreshActivity(state);

    let parsed: WebRemoteControlRelayV2OutgoingMessage | null = null;
    let bytes = 0;
    if (isBinary) {
      // 二进制帧按 WRONG_PARAM 处理（spec §5.2 规则 3）
      if (Buffer.isBuffer(data)) bytes = data.length;
      else if (Array.isArray(data)) bytes = Buffer.concat(data).length;
      else bytes = data.byteLength;
    } else {
      const text = data.toString();
      bytes = Buffer.byteLength(text);
      try {
        parsed = parseWebRemoteControlRelayV2OutgoingMessage(JSON.parse(text));
      } catch {
        parsed = null; // 非法 JSON 与非法字段同路径：WRONG_PARAM + 关闭（spec §5.2）
      }
    }
    // 入站计数（spec §9）：含认证前帧与非法帧——一侧持续来帧另一侧收不到即「单向断」
    const counters = countersOf(connection);
    counters.framesIn += 1;
    counters.bytesIn += bytes;
    logger.traceMessage({
      type: parsed?.type ?? (isBinary ? "binary" : "invalid"),
      role: connection.role,
      bytes,
    });

    if (parsed === null) {
      closeWithWrongParam(connection);
      return;
    }

    if (parsed.type === "auth_init") {
      // 重复认证（spec §5.2：error WRONG_PARAM + 关闭）
      if (connection.deviceSid !== undefined) {
        closeWithWrongParam(connection);
        return;
      }
      // 设备不存在或跨用户归属（spec §5.2：error AUTH_FAILED + 关闭）
      const device = devices.get(parsed.device_sid);
      if (device === undefined || device.userId !== connection.userId) {
        closeWithAuthFailed(connection);
        return;
      }
      connection.deviceSid = parsed.device_sid;
      connection.meta = parsed.meta ?? {};
      if (state !== undefined) {
        if (state.authTimer !== undefined) {
          clearTimeout(state.authTimer);
          state.authTimer = undefined;
        }
        refreshActivity(state);
        state.boundSeq = ++bindCounter;
        armIdleCheck(connection, state);
      }
      // 合法认证：同角色替换（§6.4）→ 对端推送 → 回 auth_ack；bind 内部固定事件顺序
      const view = registry.bind(connection);
      sendRelayMessage(
        connection,
        {
          type: "auth_ack",
          device_sid: parsed.device_sid,
          terminal_sid: connection.terminalSid,
          pair_status: view.pairStatus,
        },
        sendContext,
      );
      logger.info("ws-authenticated", {
        role: connection.role,
        sid_prefix: sidLogPrefix(connection.deviceSid),
      });
      return;
    }

    // 未认证连接发 pair_status_query / data（spec §5.2：error AUTH_FAILED + 关闭）
    if (connection.deviceSid === undefined) {
      closeWithAuthFailed(connection);
      return;
    }

    if (parsed.type === "pair_status_query") {
      // 查询语义 terminal_sid = peer?.terminalSid ?? ""（spec §5.2 填充规则）
      const view = registry.query(connection);
      sendRelayMessage(
        connection,
        { type: "pair_status_ack", pair_status: view.pairStatus, terminal_sid: view.terminalSid },
        sendContext,
      );
      return;
    }

    // data：只透传外层 payload，不解析内容（spec §4 不可变量 3）
    const peer = registry.peerOf(connection);
    if (peer !== undefined) {
      sendRelayMessage(peer, { type: "data", payload: parsed.payload }, sendContext);
    } else {
      // 无对端：INTERNAL 且不关闭（terminal 快速重连场景按可恢复处理，spec §5.2）
      sendRelayMessage(connection, { type: "error", code: "INTERNAL" }, sendContext);
    }
  };

  const handleClose = (connection: Connection): void => {
    connections.delete(connection);
    const state = sessions.get(connection);
    if (state !== undefined) {
      if (state.authTimer !== undefined) clearTimeout(state.authTimer);
      if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
      sessions.delete(connection);
    }
    // stale close 防护在 registry 内：仅当前 owner 释放并按 §6.5 通知对端
    registry.release(connection);
    logger.info("ws-closed", {
      role: connection.role,
      sid_prefix: sidLogPrefix(connection.deviceSid),
    });
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (shuttingDown) {
      // §5.3 停收新连接：不回 401——401 会让客户端误停为 auth-required，直接断开走退避重连
      socket.destroy();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    // mid 网关路由提示：单实例接受但忽略（spec §5.2）
    if (url.pathname !== WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH) {
      replyUnauthorized(socket);
      return;
    }
    // 消费即删：缺失/未知/过期/已消费一律 undefined，失败不恢复（spec §5.2 规则 2）
    const identity = tokens.consume(url.searchParams.get("token") ?? "");
    if (identity === undefined) {
      replyUnauthorized(socket);
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      const connection: Connection = {
        id: randomUUID(),
        socket: ws,
        userId: identity.userId,
        role: identity.role,
        deviceSid: undefined,
        // terminal 分配 t_<uuid>；device 恒 ""（spec §5.2 terminal_sid 填充规则）
        terminalSid: identity.role === "terminal" ? `t_${randomUUID()}` : "",
        meta: {},
      };
      const state: SessionState = {
        authTimer: undefined,
        idleTimer: undefined,
        lastActivity: now(),
        boundSeq: 0,
      };
      connections.add(connection);
      sessions.set(connection, state);
      // 认证超时（spec §5.3）：直接关闭，不发错误消息
      state.authTimer = setTimeout(() => {
        if (connection.deviceSid !== undefined) return;
        logger.info("ws-auth-timeout", { role: connection.role });
        ws.terminate();
      }, config.authTimeoutMs);
      state.authTimer.unref();
      ws.on("error", () => ws.terminate());
      // 任一入站帧（含 pong）刷新活跃时间；pong 不参与业务状态（spec §5.3）
      ws.on("ping", () => refreshActivity(state));
      ws.on("pong", () => refreshActivity(state));
      ws.on("message", (data, isBinary) => handleMessage(connection, data, isBinary));
      ws.on("close", () => handleClose(connection));
      logger.info("ws-open", { role: connection.role, user_id: connection.userId });
    });
  };

  // 服务端协议 ping（spec §5.3：保 NAT 活性；pong 计入活跃时间，不参与业务状态）
  const pingTimer = setInterval(() => {
    for (const connection of connections) {
      if (connection.socket.readyState === WebSocket.OPEN) connection.socket.ping();
    }
  }, PING_INTERVAL_MS);
  pingTimer.unref();

  const connectionCount = (): number => connections.size;

  const ownerCount = (): number => {
    const sids = new Set<string>();
    for (const connection of connections) {
      if (connection.deviceSid !== undefined) sids.add(connection.deviceSid);
    }
    return sids.size;
  };

  const onlineDeviceMeta = (deviceSid: string): WebRemoteControlRelayV2Meta | undefined => {
    let latest: Connection | undefined;
    let latestSeq = 0;
    for (const connection of connections) {
      if (connection.role !== "device" || connection.deviceSid !== deviceSid) continue;
      const seq = sessions.get(connection)?.boundSeq ?? 0;
      if (seq > latestSeq) {
        latest = connection;
        latestSeq = seq;
      }
    }
    return latest?.meta;
  };

  // 存活连接按角色聚合（spec §9）：计数本体每连接一份（WeakMap），健康面只做派生聚合
  const trafficCounters = (): RelayTrafficView => {
    const view: RelayTrafficView = {
      device: { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 },
      terminal: { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 },
    };
    for (const connection of connections) {
      const counters = traffic.get(connection);
      if (counters === undefined) continue;
      const role = view[connection.role];
      role.framesIn += counters.framesIn;
      role.bytesIn += counters.bytesIn;
      role.framesOut += counters.framesOut;
      role.bytesOut += counters.bytesOut;
    }
    return view;
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    shuttingDown = true;
    clearInterval(pingTimer);
    // §5.3 顺序：先对每条连接发 error INTERNAL（客户端按可恢复错误退避重连），再关闭
    for (const connection of connections) {
      sendRelayMessage(connection, { type: "error", code: "INTERNAL" }, sendContext);
    }
    for (const connection of connections) connection.socket.close();
    // 等待 flush：宽限内等客户端自行断开，超时强制 terminate 保证进程可退出
    const deadline = now() + SHUTDOWN_FLUSH_GRACE_MS;
    while (connections.size > 0 && now() < deadline) {
      await delay(25);
    }
    for (const connection of connections) connection.socket.terminate();
    while (connections.size > 0) {
      await delay(25); // terminate 后 close 事件在数个 tick 内到齐，完成 registry 释放
    }
    await new Promise<void>((resolve, reject) =>
      wsServer.close((error) => (error ? reject(error) : resolve())),
    );
  };

  return { handleUpgrade, connectionCount, ownerCount, onlineDeviceMeta, trafficCounters, stop };
}
