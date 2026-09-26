// Server 型远程工作区客户端链（第 46 轮 C 项，对齐官方原版 host/index.js 内
// resolveServerRemoteEndpoints(IRe) / fetchServerInfo(RRe) / fetchHostCapability(ARe) /
// connectNodeWebSocket(ERe) / connectServerRemote(JJ) 五个函数的语义）。
//
// 本模块只做"取服务端自描述 → 申请一次性 host capability → 建立 trusted host
// WebSocket"三步；返回原始 socket，ws → RPC services 的组装由宿主（窗口 Host）
// 完成，避免 services 反向依赖 @drora/client 的 RemoteServiceAccess。
import WebSocket from "ws";
import {
  DRORA_RPC_HOST_CAPABILITY_HEADER,
  resolveServerRemoteEndpoints,
  serverRemoteHostCapabilitySchema,
  serverRemoteInfoSchema,
  type ServerRemoteInfo,
} from "@drora/shared";

/** fetch 的最小结构面；注入 mock 即可离线测试，宿主可换成走代理的 transport。 */
export type ServerRemoteFetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** node ws WebSocket 的最小结构面；测试注入 mock 类即可校验 URL/header 构造。 */
export interface ServerRemoteNodeWebSocket {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
  once(event: "open", listener: () => void): unknown;
  close(): void;
}

export type ServerRemoteWebSocketConstructor = new (
  url: string,
  options: { headers?: Record<string, string> },
) => ServerRemoteNodeWebSocket;

export interface ServerRemoteConnectTarget {
  url: string;
  token?: string;
}

export interface ServerRemoteConnectOptions {
  fetchImpl?: ServerRemoteFetchLike;
  webSocket?: ServerRemoteWebSocketConstructor;
}

export interface ServerRemoteConnection {
  serverInfo: ServerRemoteInfo;
  capability: string;
  socket: ServerRemoteNodeWebSocket;
  dispose(): void;
}

/**
 * 对齐官方 authenticatedUrl(ZE)：token 同时附加到 URL 查询参数。
 * 服务端 lite token 校验同时接受 header 与查询参数，浏览器类消费方（无自定义
 * header 能力的 /ws 客户端）依赖查询参数这一路。
 */
function authenticatedUrl(url: string, token: string | undefined): string {
  const trimmed = token?.trim();
  if (!trimmed) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("token", trimmed);
  return parsed.toString();
}

/** 对齐官方 fetchServerInfo(RRe)：GET server-info，token 走 Bearer + 查询参数双通道。 */
export async function fetchServerRemoteInfo(
  infoUrl: string,
  options: { token?: string } = {},
  fetchImpl: ServerRemoteFetchLike = fetch,
): Promise<ServerRemoteInfo> {
  const token = options.token?.trim();
  const response = await fetchImpl(authenticatedUrl(infoUrl, options.token), {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Server info request failed: ${response.status}`);
  }
  const parsed = serverRemoteInfoSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Server info response is invalid");
  }
  return parsed.data;
}

/**
 * 对齐官方 fetchHostCapability(ARe)：POST 同 URL 形态，只带查询参数 token、
 * 不带 Authorization 头（与官方逐字一致）；capability 是一次性票据，用后即焚。
 */
export async function fetchServerRemoteHostCapability(
  url: string,
  options: { token?: string } = {},
  fetchImpl: ServerRemoteFetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(authenticatedUrl(url, options.token), {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Host capability request failed: ${response.status}`);
  }
  const parsed = serverRemoteHostCapabilitySchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Host capability response is invalid");
  }
  return parsed.data.capability;
}

/**
 * 对齐官方 connectNodeWebSocket(ERe)：携带 capability header 建立 trusted host
 * WebSocket；open 前的 error/close 都会让 Promise reject，避免半开连接被当成成功。
 */
function connectServerRemoteNodeWebSocket(
  hostWsUrl: string,
  options: { token?: string },
  capability: string,
  webSocket: ServerRemoteWebSocketConstructor,
): Promise<ServerRemoteNodeWebSocket> {
  return new Promise((resolve, reject) => {
    const token = options.token?.trim();
    const socket = new webSocket(authenticatedUrl(hostWsUrl, options.token), {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        [DRORA_RPC_HOST_CAPABILITY_HEADER]: capability,
      },
    });
    let opened = false;
    socket.once("error", (error) => {
      if (!opened) {
        reject(error);
      }
    });
    socket.once("close", (code, reason) => {
      if (!opened) {
        reject(
          new Error(
            reason.length > 0
              ? `WebSocket closed before ready: ${reason.toString("utf8")}`
              : `WebSocket closed before ready (${code})`,
          ),
        );
      }
    });
    socket.once("open", () => {
      opened = true;
      resolve(socket);
    });
  });
}

/**
 * 对齐官方 connectServerRemote(JJ)：endpoints → server-info → host capability →
 * /ws/host。token 同时走 Authorization header 与 ?token= 查询参数。
 */
export async function connectServerRemoteTarget(
  target: ServerRemoteConnectTarget,
  options: ServerRemoteConnectOptions = {},
): Promise<ServerRemoteConnection> {
  const endpoints = resolveServerRemoteEndpoints(target.url);
  const serverInfo = await fetchServerRemoteInfo(
    endpoints.infoUrl,
    target,
    options.fetchImpl ?? fetch,
  );
  const capability = await fetchServerRemoteHostCapability(
    endpoints.hostCapabilityUrl,
    target,
    options.fetchImpl ?? fetch,
  );
  const socket = await connectServerRemoteNodeWebSocket(
    endpoints.hostWsUrl,
    target,
    capability,
    options.webSocket ?? WebSocket,
  );
  return {
    serverInfo,
    capability,
    socket,
    dispose() {
      socket.close();
    },
  };
}
