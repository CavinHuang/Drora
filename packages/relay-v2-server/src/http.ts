// HttpApi（specs/relay-v2-server.md §5.1/§9；行为逐条对照可执行参照
// packages/shared/test/fixtures/fake-relay-v2.ts:92-180 的 HTTP 分支）。
// 边界（spec §4）：本层只做 Bearer→userId 映射、请求体严格校验与状态所有者调用，
// 不持有业务状态；在线事实（online/meta）与 owner/连接计数经注入的访问器实时 join。
// 红线（spec §9）：日志与诊断不输出 JWT、一次性 token、data.payload 正文与完整设备名；
// 本层路径不含凭据（token 只出现在 WS upgrade 查询参数，永不落日志）。

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  parseWebRemoteControlRelayV2HttpRequest,
} from "@drora/shared/web-remote-relay";
import type { WebRemoteControlRelayV2Meta } from "@drora/shared/web-remote-relay";
import type { RelayConfig } from "./config.js";
import type { RelayLogger } from "./logger.js";
import type {
  DeviceStore,
  JwtAuth,
  PairingRegistry,
  RelayTrafficView,
  TokenStore,
} from "./types.js";

/** 业务信封错误码（spec §5.1 表） */
const CODE_OK = 0;
const CODE_PARAMETER_ERROR = 3001;
const CODE_NO_PERMISSION = 1006;
const CODE_WRONG_STATUS = 3005;
const CODE_HTTP_FALLBACK = 500;

/**
 * 请求体硬上限（评审 http-body-limit）：契约最大请求（register 的 device_mid ≤128 字符）
 * 仅数百字节，64KiB 已留足余量。无上限时未消费的请求体会被整块缓冲进堆内存
 * （评审实测：无效凭据 + 200MB body → 进程 RSS 704MB）。
 */
const MAX_BODY_BYTES = 64 * 1024;

/** 请求体超限（413）的内部标记错误；与「读请求体失败」区分处理 */
class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds limit");
    this.name = "BodyTooLargeError";
  }
}

/** 注册/列表共用路径（契约 docs/web-remote-control/relay-v2-pairing.md；路径常量单一出处） */
const PATH_DEVICE = WEB_REMOTE_CONTROL_RELAY_V2_HTTP.register.path;
const PATH_DELETE = WEB_REMOTE_CONTROL_RELAY_V2_HTTP.delete.path;
const PATH_TOKEN = WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path;
const PATH_HEALTHZ = "/healthz";

/** /healthz 视图（spec §9：进程 uptime、连接数、owner 数、DB 行数、收发计数） */
export interface RelayHealthView {
  /** 进程 uptime（秒） */
  uptime: number;
  /** 存活 WS 连接数（含未认证连接） */
  connections: number;
  /** 当前 owner 域（有认证绑定的不同 SID）数 */
  owners: number;
  /** 设备表行数；注入的 DeviceStore 不提供计数时为 null */
  devices: number | null;
  /** 存活连接按角色聚合的收发计数（spec §9；诊断「单向断」，连接关闭即出清） */
  counters: RelayTrafficView;
}

export interface HttpApiDeps {
  config: RelayConfig;
  logger: RelayLogger;
  auth: JwtAuth;
  tokens: TokenStore;
  devices: DeviceStore;
  registry: PairingRegistry;
  /** /healthz owner 数（等价 PairingRegistry owners 表规模，由装配层提供） */
  ownerCount(): number;
  /** /healthz 连接数（网关存活连接集合规模） */
  connectionCount(): number;
  /** 列表 join：在线设备的实时 meta（spec §5.1 规则 4/6）；离线或未知返回 undefined */
  onlineDeviceMeta(deviceSid: string): WebRemoteControlRelayV2Meta | undefined;
  /** /healthz 设备表行数；存储不提供计数时返回 null */
  deviceCount(): number | null;
  /** /healthz 收发计数（spec §9）：存活连接按角色聚合，由装配层从网关派生 */
  trafficCounters(): RelayTrafficView;
}

/**
 * 请求体读取与 fake relay 同款：空体视为 {}；JSON 解析失败按原文透传给严格校验器拒绝。
 * 硬上限（评审 http-body-limit）：先按 Content-Length 预检，再流式累积计数——两条路径
 * 超限都即刻抛 BodyTooLargeError，不再把后续 chunk 缓进堆内存。
 */
async function readBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isSafeInteger(declared) && declared > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createHttpApi(
  deps: HttpApiDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { config, logger, auth, tokens, devices, registry } = deps;

  // 与 fake relay 同款信封：成功 {code:0,msg:"",data}；失败 data 省略；msg 缺省空串
  const reply = (
    response: ServerResponse,
    status: number,
    data?: unknown,
    code: number = status === 200 ? CODE_OK : status,
    msg: string = "",
  ): void => {
    response.writeHead(status);
    response.end(
      JSON.stringify({
        code,
        msg,
        ...(data === undefined ? {} : { data }),
      }),
    );
  };

  /**
   * 提前拒绝（401/503/413）：这些路径不再缓冲请求体，连接由 Node 在「响应完成 + 上传流
   * 排空」后自然收尾。resume() 丢弃剩余上传流是关键（评审实测迭代）：
   * - 不消费：请求体滞留在可读缓冲（内存无界，即评审实验 RSS 704MB 的成因）或内核窗
   *   （连接悬挂到 requestTimeout）；
   * - flush 后立即 destroy / 回 `Connection: close`：仍在写上传流的客户端被 RST，
   *   fetch 以 EPIPE/ECONNRESET 失败、拿不到状态行（同进程 undici 实测复现）——
   *   客户端会把「凭据错误」误判为网络故障而重试，而不是按 401 停机。
   * resume 排空则客户端完整上传后正常收到拒绝响应，堆内存全程有界。
   */
  const earlyReject = (
    request: IncomingMessage,
    response: ServerResponse,
    status: number,
  ): void => {
    request.resume();
    reply(response, status);
  };

  return async function handleRequest(request, response) {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      response.setHeader("Content-Type", "application/json");
      // CORS 开关（spec §5.1 规则 7）：同源生产默认关；开启时 fake relay 同款头与预检 204
      if (config.corsEnabled) {
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        if (request.method === "OPTIONS") {
          response.writeHead(204);
          response.end();
          return;
        }
      }
      if (pathname === PATH_HEALTHZ && request.method === "GET") {
        const health: RelayHealthView = {
          uptime: Math.floor(process.uptime()),
          connections: deps.connectionCount(),
          owners: deps.ownerCount(),
          devices: deps.deviceCount(),
          counters: deps.trafficCounters(),
        };
        response.writeHead(200);
        response.end(JSON.stringify(health));
        return;
      }
      // token 路径响应一律 no-store（含 401/400，fake relay 在鉴权前置同位置设置）
      if (pathname === PATH_TOKEN) response.setHeader("Cache-Control", "no-store");

      // 鉴权前置（评审 http-body-limit ①）：先解析 Authorization，未认证请求不消费请求体——
      // 无效凭据+超大 body 在读取前拒绝，请求体永不进本进程堆内存。
      // 三态（评审 auth-three-state）：credentials-invalid → 401（客户端按 auth-required
      // 停机，仅真正的鉴权失败）；upstream-unavailable → 503（5xx 客户端按可重试退避，
      // 不会误清手机会话）。
      const authResult = await auth.authenticate(request.headers.authorization);
      if (authResult.status !== "ok") {
        logger.debug("http-auth-rejected", {
          method: request.method ?? "",
          path: pathname,
          reason: authResult.status,
        });
        earlyReject(request, response, authResult.status === "upstream-unavailable" ? 503 : 401);
        return;
      }
      const userId = authResult.userId;

      let body: unknown;
      try {
        body = await readBody(request);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          // 413 并断开（评审 http-body-limit ②）：不再消费上传流
          earlyReject(request, response, 413);
        } else {
          response.destroy();
        }
        return;
      }

      if (pathname === PATH_TOKEN && request.method === "POST") {
        const parsed = parseWebRemoteControlRelayV2HttpRequest("token", body);
        if (parsed === null) {
          reply(response, 400, undefined, CODE_PARAMETER_ERROR, "parameter error");
          return;
        }
        // 一次性 token：16 字节 base64url、60 秒、绑定 user+role 不绑 SID（spec §5.1 规则 2）
        const issued = tokens.issue(userId, parsed.role);
        reply(response, 200, { token: issued.token, expires_in: issued.expiresIn });
        return;
      }

      if (pathname === PATH_DEVICE && request.method === "POST") {
        const parsed = parseWebRemoteControlRelayV2HttpRequest("register", body);
        if (parsed === null) {
          reply(response, 400, undefined, CODE_PARAMETER_ERROR, "parameter error");
          return;
        }
        const record = devices.register(userId, parsed.device_mid);
        logger.info("device-registered", {
          user_id: userId,
          sid_prefix: record.deviceSid.slice(0, 8),
        });
        // 响应记录 online:false meta:{}（刚注册的 SID 不可能有连接，spec §5.1 规则 3）
        reply(response, 200, {
          device_sid: record.deviceSid,
          device_mid: record.deviceMid,
          created_at: record.createdAt,
          online: false,
          meta: {},
        });
        return;
      }

      if (pathname === PATH_DEVICE && request.method === "GET") {
        const list = devices.listByUser(userId).map((record) => {
          const online = registry.isDeviceOnline(record.deviceSid);
          return {
            device_sid: record.deviceSid,
            device_mid: record.deviceMid,
            created_at: record.createdAt,
            online,
            // meta 仅在线时取自 device owner 连接的 auth_init 上报；离线恒空对象（spec §5.1 规则 6）
            meta: online ? (deps.onlineDeviceMeta(record.deviceSid) ?? {}) : {},
          };
        });
        reply(response, 200, list);
        return;
      }

      if (pathname === PATH_DELETE && request.method === "POST") {
        const parsed = parseWebRemoteControlRelayV2HttpRequest("delete", body);
        if (parsed === null) {
          reply(response, 400, undefined, CODE_PARAMETER_ERROR, "parameter error");
          return;
        }
        const device = devices.get(parsed.device_sid);
        // 三态与 fake relay 逐条对齐：不存在=幂等 200；异账号=200 code 1006；在线=400 code 3005
        if (device === undefined) {
          reply(response, 200);
          return;
        }
        if (device.userId !== userId) {
          reply(response, 200, undefined, CODE_NO_PERMISSION, "no permission");
          return;
        }
        if (registry.isDeviceOnline(parsed.device_sid)) {
          reply(response, 400, undefined, CODE_WRONG_STATUS, "wrong status");
          return;
        }
        devices.delete(parsed.device_sid);
        logger.info("device-deleted", {
          user_id: userId,
          sid_prefix: parsed.device_sid.slice(0, 8),
        });
        reply(response, 200);
        return;
      }

      reply(response, 404);
    } catch (error) {
      logger.error("http-handler-error", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        reply(response, CODE_HTTP_FALLBACK, undefined, CODE_HTTP_FALLBACK, "internal error");
      } else {
        response.destroy();
      }
    }
  };
}
