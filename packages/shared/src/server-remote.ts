import { z } from "zod";

export const SERVER_REMOTE_PROTOCOL_VERSION = 1;

export interface ServerRemoteEndpoints {
  /** GET /api/server-info —— 服务端自描述（serverRemoteInfoSchema）。 */
  infoUrl: string;
  /** GET /ws —— terminal-client 桌面恢复链路（web-remote-replayable）。 */
  wsUrl: string;
  /** POST /api/rpc-host-capability —— 一次性 host capability 票据。 */
  hostCapabilityUrl: string;
  /** GET /ws/host —— trusted host 实时链路（desktop-continuous），需 capability header。 */
  hostWsUrl: string;
}

function appendEndpointPath(base: string, suffix: string): string {
  // 对齐官方 appendEndpointPath：先去尾部斜杠再拼端点，根路径（空串）直接返回端点。
  const normalized = base.replace(/\/+$/g, "");
  return normalized ? `${normalized}${suffix}` : suffix;
}

function stripWebSocketEndpointPath(path: string): string {
  // 对齐官方 stripWebSocketEndpointPath：用户可能粘贴带 /ws 或 /ws/host 的完整端点，
  // 拼接前必须剥掉，否则会出现 /ws/ws 这类双重端点。
  const normalized = path.replace(/\/+$/g, "");
  if (normalized.endsWith("/ws/host")) {
    return normalized.slice(0, -"/ws/host".length);
  }
  if (normalized.endsWith("/ws")) {
    return normalized.slice(0, -"/ws".length);
  }
  return normalized;
}

/**
 * Server 型远程目标的唯一端点解析入口（对齐官方 resolveServerRemoteEndpoints / IRe）。
 *
 * - http(s) 输入：info/capability 保持 http(s)，ws/hostWs 转 ws(s)；
 *   ws(s) 输入：info/capability 转 http(s)，ws/hostWs 保持 ws(s)。
 * - 其余协议抛 `Unsupported server URL protocol: <protocol>`，空输入抛
 *   `Server URL is required`（文案与官方逐字一致，便于错误面对齐）。
 * - search/hash 一律清空：token 由客户端经 authenticatedUrl 显式附加，
 *   不能让用户粘贴 URL 时夹带的查询串漏进请求。
 */
export function resolveServerRemoteEndpoints(url: string): ServerRemoteEndpoints {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Server URL is required");
  }
  const infoUrl = new URL(trimmed);
  const wsUrl = new URL(trimmed);
  const hostCapabilityUrl = new URL(trimmed);
  const hostWsUrl = new URL(trimmed);
  const infoPath = stripWebSocketEndpointPath(infoUrl.pathname);
  const wsPath = stripWebSocketEndpointPath(wsUrl.pathname);
  const hostCapabilityPath = stripWebSocketEndpointPath(hostCapabilityUrl.pathname);
  const hostWsPath = stripWebSocketEndpointPath(hostWsUrl.pathname);
  switch (infoUrl.protocol) {
    case "http:":
    case "https:": {
      wsUrl.protocol = infoUrl.protocol === "https:" ? "wss:" : "ws:";
      hostWsUrl.protocol = wsUrl.protocol;
      break;
    }
    case "ws:":
    case "wss:": {
      infoUrl.protocol = infoUrl.protocol === "wss:" ? "https:" : "http:";
      hostCapabilityUrl.protocol = infoUrl.protocol;
      break;
    }
    default:
      throw new Error(`Unsupported server URL protocol: ${infoUrl.protocol}`);
  }
  infoUrl.pathname = appendEndpointPath(infoPath, "/api/server-info");
  wsUrl.pathname = appendEndpointPath(wsPath, "/ws");
  hostCapabilityUrl.pathname = appendEndpointPath(hostCapabilityPath, "/api/rpc-host-capability");
  hostWsUrl.pathname = appendEndpointPath(hostWsPath, "/ws/host");
  infoUrl.search = "";
  wsUrl.search = "";
  hostCapabilityUrl.search = "";
  hostWsUrl.search = "";
  infoUrl.hash = "";
  wsUrl.hash = "";
  hostCapabilityUrl.hash = "";
  hostWsUrl.hash = "";
  return {
    infoUrl: infoUrl.toString(),
    wsUrl: wsUrl.toString(),
    hostCapabilityUrl: hostCapabilityUrl.toString(),
    hostWsUrl: hostWsUrl.toString(),
  };
}

export const serverRemoteWorkspaceInfoSchema = z.object({
  path: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  workspaceIdentity: z.string().trim().min(1).optional(),
});

export const serverRemoteInfoSchema = z.object({
  serverId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  version: z.string(),
  protocolVersion: z.literal(SERVER_REMOTE_PROTOCOL_VERSION),
  authRequired: z.boolean(),
  workspaces: z.array(serverRemoteWorkspaceInfoSchema),
  capabilities: z.object({
    desktopContinuous: z.literal(true),
    websocketRpc: z.literal(true),
    // 旧 Server 缺少新增 dynamic event，必须先声明能力再订阅，避免异常打进对端读循环。
    processResourceTelemetry: z.boolean().optional(),
  }),
});

export type ServerRemoteWorkspaceInfo = z.infer<typeof serverRemoteWorkspaceInfoSchema>;

export type ServerRemoteInfo = z.infer<typeof serverRemoteInfoSchema>;

export const serverRemoteHostCapabilitySchema = z
  .object({
    capability: z.string().trim().min(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type ServerRemoteHostCapability = z.infer<typeof serverRemoteHostCapabilitySchema>;
