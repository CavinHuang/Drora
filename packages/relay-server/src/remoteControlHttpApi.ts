// 官方 relay HTTP API（specs/mobile-relay-r3-frontend.md §32.35 客户端全量取证）：
// 手机页的跨工作区切换与视图态同步走 HTTP，而非 WS 应用帧——
//   POST /api/remote-control/windows/{token}/workspace-bridge
//     body {workspaceKey, taskId?}，头 X-ZCode-Mobile-Connection-Id
//     → {wsUrl, workspaceKey, initialTaskId}（页面为新桥开第二个 WebSocket）
//   POST /api/remote-control/windows/{token}/mobile-view-state
//     body {activeWorkspaceKey, activeTaskId?, updatedAt} → {ok:true}（转发桌面端）
// 本仓源码页不经此 API（任务打开走客户端路由）——这是官方页行为还原面，
// 亦是双页对照 harness 的解锁项（缺端点 → fetch 404 → 官方页任务激活链死）。
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RemoteControlHttpApiDeps {
  /** relay 对外 ws 地址（同源 ws 端点；页面带既有 sid/hash 重新鉴权）。 */
  wsUrlOrigin: string;
  /** 会话存在性校验：token（=设备 sid）当前是否有已注册会话。 */
  hasSession(token: string): boolean;
  /** 视图态转发桌面端（复用 WS 应用帧通道，桌面侧按 mobile-view-state-update 消费）。 */
  forwardViewStateToDevice(token: string, viewState: Record<string, unknown>): void;
}

/** 预绑定依赖的请求处理器（relayServer 侧一行接线，避免 HTTP 回调闭包膨胀）。 */
export function createRemoteControlHttpApiHandler(
  deps: RemoteControlHttpApiDeps,
): (request: IncomingMessage, response: ServerResponse, pathname: string) => Promise<boolean> {
  return (request, response, pathname) => handleRemoteControlHttpApi(request, response, pathname, deps);
}

/** relayServer 会话/发送面的最小结构类型（避免跨模块引入具体实现类型）。 */
export interface RelayRemoteControlApiSurface {
  sessions: { view(token: string): { device: unknown } };
  sendToDevice(token: string, payload: Record<string, unknown>): void;
}

/** relayServer 专用装配：会话鉴权 + 视图态转发封装为官方帧形状。 */
export function createRelayRemoteControlApiHandler(options: {
  wsUrlOrigin: string;
  sessions: RelayRemoteControlApiSurface["sessions"];
  sendToDevice: RelayRemoteControlApiSurface["sendToDevice"];
}): (request: IncomingMessage, response: ServerResponse, pathname: string) => Promise<boolean> {
  return createRemoteControlHttpApiHandler({
    wsUrlOrigin: options.wsUrlOrigin,
    hasSession: (token) => !!options.sessions.view(token).device,
    forwardViewStateToDevice: (token, viewState) =>
      options.sendToDevice(token, { zcode_type: "mobile-view-state-update", viewState }),
  });
}

const WS_BRIDGE_PATH_RE = /^\/api\/remote-control\/windows\/([^/]+)\/workspace-bridge$/;
const VIEW_STATE_PATH_RE = /^\/api\/remote-control\/windows\/([^/]+)\/mobile-view-state$/;

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function replyJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * 处理官方手机页的 remote-control HTTP API；非本族路径返回 false 交回常规路由。
 * 鉴权语义对齐官方：token = 配对设备 sid；会话不存在/未注册 → 401。
 */
export async function handleRemoteControlHttpApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  deps: RemoteControlHttpApiDeps,
): Promise<boolean> {
  if (request.method !== "POST") return false;

  const bridge = WS_BRIDGE_PATH_RE.exec(pathname);
  if (bridge) {
    const token = decodeURIComponent(bridge[1]!);
    if (!deps.hasSession(token)) {
      replyJson(response, 401, { error: "session not found" });
      return true;
    }
    const body = await readJsonBody(request);
    const workspaceKey = typeof body.workspaceKey === "string" ? body.workspaceKey : "";
    const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
    if (!workspaceKey) {
      replyJson(response, 400, { error: "workspaceKey is required" });
      return true;
    }
    replyJson(response, 200, {
      wsUrl: `${deps.wsUrlOrigin}/ws`,
      workspaceKey,
      ...(taskId ? { initialTaskId: taskId } : {}),
    });
    return true;
  }

  const viewState = VIEW_STATE_PATH_RE.exec(pathname);
  if (viewState) {
    const token = decodeURIComponent(viewState[1]!);
    if (!deps.hasSession(token)) {
      replyJson(response, 401, { error: "session not found" });
      return true;
    }
    const body = await readJsonBody(request);
    deps.forwardViewStateToDevice(token, body);
    replyJson(response, 200, { ok: true });
    return true;
  }

  return false;
}
