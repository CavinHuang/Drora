// R3 P2a 入口装配（specs/mobile-relay-r3-frontend.md §13）：
// QR 查询（sid/hash，R2/官方同款六参数形状的子集）→ RelayClient（ws 同源 /ws）→
// 四步卡状态机 → 首页（bootstrap/workspace-list 应用帧）→ 任务面（bridge + 服务面）。
import {
  createWebSocketTransportFactory,
  createRelayClient,
  systemClock,
  type RelayClient,
} from "@drora/relay-client";

export interface ParsedEntryQuery {
  deviceSid: string;
  passHash: string;
}

/** 从 location.search 解析 QR 凭据（sid/hash；官方/R2 同名）。 */
export function parseEntryQuery(search: string): ParsedEntryQuery | null {
  const params = new URLSearchParams(search);
  const deviceSid = params.get("sid") ?? "";
  const passHash = params.get("hash") ?? "";
  if (!deviceSid || !passHash) return null;
  return { deviceSid, passHash };
}

/** 同源 relay WS 端点（D8：源码应用直连同源 /ws，无官方 URL 改写）。 */
function deriveRelayWsUrl(location: { protocol: string; host: string }): string {
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${location.host}/ws`;
}

export interface EntryClientHooks {
  diagnostics?: (diagnostic: { type: string; [key: string]: unknown }) => void;
  onFailure?: (failure: { reason: string; message?: string }) => void;
}

export function createEntryClient(
  query: ParsedEntryQuery,
  location: { protocol: string; host: string },
  hooks?: EntryClientHooks,
): RelayClient {
  return createRelayClient({
    url: deriveRelayWsUrl(location),
    credential: { deviceSid: query.deviceSid, passHash: query.passHash },
    transportFactory: createWebSocketTransportFactory(WebSocket),
    clock: systemClock,
    diagnostics: hooks?.diagnostics as never,
    onFailure: hooks?.onFailure as never,
  });
}

// —— bootstrap / workspace-list 投影（桌面 buildBootstrapResult/buildWorkspaceListResult
// 形状；RelayWorkspaceSummary/RelayTaskSummary 见 desktopMobileRelayProtocol） ——

export interface ProjectedTask {
  sessionId: string;
  title: string;
  /** 创建时间（P3c 整理任务排序/分桶用；relay tasks 的 createdAt，epoch ms，缺失为 null）。 */
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed";
}

export interface ProjectedWorkspace {
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  path: string;
  updatedAtMs: number | null;
  connectionState: "connected" | "disconnected" | "reconnecting";
  tasks: ProjectedTask[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** workspace 身份 key 归一（AGENTS.md：workspaceIdentity?.trim() || workspacePath）。 */
function workspaceKeyOf(record: Record<string, unknown>): string {
  const identity = readString(record, "workspaceIdentity").trim();
  return identity || readString(record, "workspacePath");
}

function projectWorkspace(record: Record<string, unknown>): ProjectedWorkspace {
  const path = readString(record, "workspacePath");
  return {
    workspaceKey: workspaceKeyOf(record),
    name: readString(record, "label") || path.split(/[\\/]/).filter(Boolean).pop() || path,
    kind: readString(record, "kind") === "remote" ? "remote" : "local",
    path,
    updatedAtMs: null,
    connectionState: "connected",
    tasks: [],
  };
}

function projectTask(record: Record<string, unknown>): ProjectedTask {
  const status = readString(record, "status");
  return {
    sessionId: readString(record, "taskId"),
    title: readString(record, "title") || readString(record, "taskId"),
    // P3c（spec §16 第 1 条）：整理任务排序/分桶需要任务创建时间；relay tasks 有
    // createdAt（epoch ms）。readNumber 已做 number/有限性防御，缺失回 null。
    createdAtMs: readNumber(record, "createdAt"),
    updatedAtMs: readNumber(record, "updatedAt"),
    status: status === "running" ? "running" : "completed",
  };
}

/**
 * bootstrap-response / workspace-list-response result → 首页投影（工作区分组 + 任务归组）。
 * active* 两处都读：workspace-list 在 result 顶层（buildWorkspaceListResult）；
 * bootstrap 在 result.mobileViewState / result.initialViewState（buildBootstrapResult，
 * 桌面 desktopMobileRelayProtocol.ts：两键同指一个 viewState 对象），顶层缺省时回退读取。
 */
export function projectHomeData(resultRaw: unknown): {
  workspaces: ProjectedWorkspace[];
  activeWorkspaceKey: string | null;
  activeTaskId: string | null;
} {
  const result = asRecord(resultRaw);
  const workspaces = Array.isArray(result.workspaces)
    ? result.workspaces.map((entry) => projectWorkspace(asRecord(entry)))
    : [];
  // 归组键必须读**原始**任务记录（workspacePath/workspaceIdentity）——投影后对象已剥掉
  // 定位字段（P4b E2E 实证：读投影对象导致 key 为空、任务全部被丢弃，spec §17）。
  const rawTasks = Array.isArray(result.tasks) ? result.tasks.map(asRecord) : [];
  const tasks = rawTasks.map((entry) => projectTask(entry));
  const byKey = new Map(workspaces.map((workspace) => [workspace.workspaceKey, workspace]));
  for (let index = 0; index < rawTasks.length; index += 1) {
    const key = workspaceKeyOf(rawTasks[index]!);
    const workspace = byKey.get(key);
    const projected = tasks[index];
    if (workspace && projected) workspace.tasks.push(projected);
  }
  const viewState = {
    ...asRecord(result.initialViewState),
    ...asRecord(result.mobileViewState),
  };
  const readActive = (key: string): string | null => {
    if (typeof result[key] === "string") return result[key];
    if (typeof viewState[key] === "string") return viewState[key];
    return null;
  };
  return {
    workspaces,
    activeWorkspaceKey: readActive("activeWorkspaceKey"),
    activeTaskId: readActive("activeTaskId"),
  };
}
