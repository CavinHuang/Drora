/* eslint-disable max-lines -- 协议纯逻辑单文件聚合（常量+算法+存储），沿用已删除的 desktopMobilePairingCore 的单文件先例。 */
// 移动端远程控制·官方 relay 协议纯逻辑（无 IO，可独立单测）。
// 常量与算法逐项取证自官方 3.14.3 发行 bundle 并经最小探测复核（spec: mobile-web-remote.md M4）。
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
  buildRelayProofMessage,
} from "@drora/shared";
import type { MobilePairingRuntimeState, RpcFrameIdentity } from "@drora/shared";

export const OFFICIAL_RELAY_WS_URL = "wss://zcode.z.ai/ws";
/** v3 托管页已 404；官方版本门控现走 v4（探测核实）。 */
export const OFFICIAL_REMOTE_PAGE_URL = "https://zcode.z.ai/remote/v4";

/**
 * 自建 relay 服务端端点推导（spec: mobile-relay-server.md §8）：
 * base = http(s)://host:port → relayWsUrl = ws(s)://host:port/ws、
 * remotePageUrl = base + /remote/v4（独立 mobile-web 页；R2 页为服务端兜底）。
 * 未配置（官方地址）时返回 undefined，走官方常量。
 */
export function deriveSelfHostedRelayEndpoints(baseUrl: string):
  | {
      relayWsUrl: string;
      remotePageUrl: string;
    }
  | undefined {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return undefined;
  }
  const wsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
  return {
    relayWsUrl: `${wsProto}//${parsed.host}/ws`,
    remotePageUrl: `${base}/remote/v4`,
  };
}
/**
 * 二维码固定上报的 app_version——必须是官方托管页认识的版本。
 * 修复依据（2026-09-27 实测）：托管页按版本清单分发页面资源，未知版本直接 404
 * （0.0.x/99.0.0/3.13.0/3.14.4/3.15.0 → 404，3.14.0–3.14.3 → 200，省略参数 → 走默认）。
 * Drora 自身版本（0.0.1）不在清单内，手机扫码必 404；本仓 relay 协议逐项还原自
 * 3.14.3 bundle，故二维码固定上报 3.14.3（页面会下发与该协议配套的手机页资源）。
 * WS 注册/鉴权的 meta.version 不受此影响——relay 不校验该值（0.0.1 注册实测通过）。
 */
export const OFFICIAL_REMOTE_PAGE_APP_VERSION = "3.14.3";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_JITTER_MAX_MS = 2_000;
export const HEARTBEAT_ACK_TIMEOUT_MS = 30_000;
export const RECONNECT_DELAY_MS = 1_000;
/** QR 就绪等待（注册+鉴权到达 waiting/matched 的上限，对齐原版 BW）。 */
export const QR_READY_TIMEOUT_MS = 30_000;

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

type RelayTransportState =
  | "idle"
  | "connecting"
  | "registering"
  | "authenticating"
  | "waiting_terminal"
  | "paired"
  | "kicked"
  | "error";

// —— 纯逻辑：口令派生与 proof（对齐官方 createNodeWebRemoteControlRelayAuthProvider）——

export function createRelayPassword(): string {
  return randomBytes(24).toString("base64url");
}

export function derivePassHash(password: string): string {
  return createHash("sha256").update(password).digest("base64");
}

export function calculateRelayProof(params: {
  passHash: string;
  nonce: string;
  role: string;
  sessionId: string;
}): string {
  // spec D2 同源化：消息格式单一出处 = shared 的 buildRelayProofMessage（"<nonce>|<role>|<device_sid>"，
  // 三方现格式逐字核对一致，见 shared/relay-wire/proof.ts 头注）。createHmac 保留为
  // node 环境快路径（Main 进程专用），纯 JS 实现见 @drora/shared relay-wire（手机页用）。
  return createHmac("sha256", params.passHash)
    .update(
      buildRelayProofMessage({
        nonce: params.nonce,
        role: params.role,
        deviceSid: params.sessionId,
      }),
    )
    .digest("base64url");
}

/** 二维码 URL（对齐官方 buildWebRemoteControlExternalQrUrl 的参数族）。 */
export function buildRelayQrUrl(params: {
  baseUrl?: string;
  deviceSid: string;
  passHash: string;
  timestamp?: number;
  deviceMid?: string;
  deviceName?: string;
}): string {
  const url = new URL(params.baseUrl ?? OFFICIAL_REMOTE_PAGE_URL);
  url.searchParams.set("sid", params.deviceSid);
  url.searchParams.set("hash", params.passHash);
  url.searchParams.set("t", String(params.timestamp ?? Date.now()));
  if (params.deviceMid?.trim()) url.searchParams.set("mid", params.deviceMid.trim());
  if (params.deviceName?.trim()) url.searchParams.set("name", params.deviceName.trim());
  // app_version 固定为 OFFICIAL_REMOTE_PAGE_APP_VERSION：上报真实版本（0.0.1）会被
  // 托管页 404（见常量注释实测记录），此处参数值代表"手机页协议版本"而非产品版本。
  url.searchParams.set("app_version", OFFICIAL_REMOTE_PAGE_APP_VERSION);
  return url.toString();
}

/** 传输态 → 弹层六态（对齐原版 mapTransportState 语义）。 */
export function mapTransportState(state: RelayTransportState): MobilePairingRuntimeState["status"] {
  switch (state) {
    case "connecting":
    case "registering":
    case "authenticating":
      return "starting";
    case "waiting_terminal":
      return "running";
    case "paired":
      return "active";
    case "kicked":
      // 对齐原版：KICKED 后传输自行重连回 waiting；期间展示 running。
      return "running";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

// —— 纯逻辑：凭据持久化（Main 自有单键文件；原版用 settings+OS 凭据链，
// 本仓 Main 不写 setting.json——Host settings 服务独占写盘）——

export interface RelayDeviceCredential {
  deviceSid: string;
  passHash: string;
}

const CREDENTIAL_FILE_NAME = "mobile-relay-device.json";

export class MobileRelayCredentialStore {
  private readonly filePath: string;
  /** safeStorage 可用时加密 passHash；不可用回落明文（passHash 仅授权 relay 转发，非账号凭据）。 */
  private readonly encrypt: ((plain: string) => string) | null;
  private readonly decrypt: ((stored: string) => string) | null;

  constructor(
    optionsDir: string,
    encryption?: {
      encrypt: (plain: string) => string;
      decrypt: (stored: string) => string;
    },
    /**
     * 凭据文件名覆盖（specs/mobile-relay-server.md §12.2 凭据按 origin 隔离）：
     * 装配处按 effective origin 传 mobile-relay-device-<sha8(origin)>.json；
     * 缺省保持旧单文件名（该文件不再被新链路读写，不迁移不删除）。
     */
    fileName: string = CREDENTIAL_FILE_NAME,
  ) {
    this.filePath = join(optionsDir, fileName);
    this.encrypt = encryption?.encrypt ?? null;
    this.decrypt = encryption?.decrypt ?? null;
  }

  async load(): Promise<RelayDeviceCredential | null> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as {
        deviceSid?: unknown;
        passHash?: unknown;
      };
      if (typeof raw.deviceSid !== "string" || typeof raw.passHash !== "string") return null;
      const passHash = this.decrypt ? this.decrypt(raw.passHash) : raw.passHash;
      if (!raw.deviceSid.trim() || !passHash.trim()) return null;
      return { deviceSid: raw.deviceSid, passHash };
    } catch {
      return null;
    }
  }

  async save(credential: RelayDeviceCredential): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const stored = this.encrypt ? this.encrypt(credential.passHash) : credential.passHash;
    await writeFile(
      this.filePath,
      JSON.stringify({ deviceSid: credential.deviceSid, passHash: stored }, null, 2),
      "utf-8",
    );
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

// —— 纯逻辑：bootstrap / workspace-list 结果构造（对齐原版 buildBootstrapResult /
// buildWorkspaceListResult 的形状；M4a 面向单窗口单工作区）——

export interface RelayWorkspaceSummary {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程会话 id；有值即 remote 工作区（手机页 schema 可选字段）。 */
  remoteSessionId?: string;
  /** 手机页 schema 必填：工作区显示名（目录 basename，对齐官方 ul(path)）。 */
  label: string;
  kind: "local" | "remote";
  /** 页面词表：connected/disconnected/reconnecting。 */
  connectionState: "connected" | "disconnected" | "reconnecting";
}

export interface RelayTaskSummary {
  taskId: string;
  title: string;
  status: string;
  updatedAt: number;
  /** 手机页 schema 必填字段族（对齐官方 task 投影）：工作区定位 + 创建时间。 */
  workspacePath: string;
  workspaceLabel: string;
  workspaceKind: "local" | "remote";
  createdAt: number;
  /** §32.16 三态 membership（对齐官方 chat.empty membership schema）。 */
  pinned?: boolean;
  archived?: boolean;
  unreadAt?: number;
}

export interface RelayMobileViewState {
  activeWorkspaceKey?: string;
  activeTaskId?: string;
  updatedAt?: number;
}

export function relayWorkspaceKey(target: {
  workspacePath: string;
  workspaceIdentity?: string;
}): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

export function buildBootstrapResult(params: {
  deviceSid: string;
  appVersion: string;
  workspaces: RelayWorkspaceSummary[];
  fallbackWorkspace: RelayWorkspaceSummary;
  tasks: RelayTaskSummary[];
  mobileViewState?: RelayMobileViewState;
}): Record<string, unknown> {
  return {
    windowControlSessionId: params.deviceSid,
    desktopAppVersion: params.appVersion,
    workspaces: mergeRuntimeWorkspace(params.workspaces, params.fallbackWorkspace),
    tasks: params.tasks,
    ...(params.mobileViewState ? { initialViewState: params.mobileViewState } : {}),
    ...(params.mobileViewState ? { mobileViewState: params.mobileViewState } : {}),
  };
}

/**
 * 对齐官方 getAvailableWorkspaces：registry 投影为基集，运行时目标（startParams
 * 工作区）不缺席——controller 投影缺失/未就绪时至少回退到它。
 * 导出版：R2 page-request list 响应与 bootstrap/workspace-list 共用同一聚合语义。
 */
export function mergeRuntimeWorkspace(
  workspaces: RelayWorkspaceSummary[],
  fallbackWorkspace: RelayWorkspaceSummary,
): RelayWorkspaceSummary[] {
  const merged = [...workspaces];
  if (!merged.some((w) => relayWorkspaceKey(w) === relayWorkspaceKey(fallbackWorkspace))) {
    merged.push(fallbackWorkspace);
  }
  return merged;
}

export function buildWorkspaceListResult(params: {
  workspaces: RelayWorkspaceSummary[];
  fallbackWorkspace: RelayWorkspaceSummary;
  tasks: RelayTaskSummary[];
  mobileViewState?: RelayMobileViewState;
}): Record<string, unknown> {
  return {
    workspaces: mergeRuntimeWorkspace(params.workspaces, params.fallbackWorkspace),
    tasks: params.tasks,
    activeWorkspaceKey:
      params.mobileViewState?.activeWorkspaceKey ?? relayWorkspaceKey(params.fallbackWorkspace),
    ...(params.mobileViewState?.activeTaskId
      ? { activeTaskId: params.mobileViewState.activeTaskId }
      : {}),
  };
}

// spec D2/P2a 同源化：rpc-frame 传输封装（M4b）与发送侧重放缓冲（M4c）的单一出处
// 已收敛到 @drora/shared relay-wire（线格式/常量/crc32/组装器/重放缓冲及取证注释随迁，
// 见 specs/mobile-relay-r3-frontend.md §12/§13）。此处 re-export 维持既有消费者
// （desktopMobileRelayControl、conformance 测试）的导入路径不变。
export {
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
  RELAY_REPLAY_DEGRADED_ACK_GRACE,
  RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED,
  RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE,
  RELAY_REPLAY_DEGRADED_FUTURE_ACK,
  RPC_FRAME_FRAGMENT_DATA_BYTES,
  RPC_FRAME_MAX_FRAGMENTS,
  RPC_FRAME_MAX_MESSAGE_BYTES,
  RelayReplayBuffer,
  RpcFrameAssembler,
  buildRpcFrameAck,
  checksumValueFromWire,
  createRelayReplayBuffer,
  crc32,
  crc32ToWire,
  encodeRpcTransportMessage,
  identityFields,
  parseRpcTransportFrame,
  type RelayReplayAckResult,
  type RelayReplayBufferOptions,
  type RelayReplayReserveResult,
  type RpcFrameIdentity,
  type RpcTransportFrame,
} from "@drora/shared";

/**
 * bridge-ready 携带的 bridge 信息（对齐官方 toExternalBridge，index.js@386100）：
 * kind=remote 时官方强制要求 workspaceIdentity+remoteSessionId（缺则 throw），
 * 并附加这两个字段——远程桥的桥端以身份隔离键而非路径寻址（AGENTS.md Workspace
 * Identity 规则）。
 */
export function toExternalBridge(params: {
  identity: RpcFrameIdentity;
  workspaceKey: string;
  workspacePath: string;
  initialTaskId?: string;
  kind: "local" | "remote";
  workspaceIdentity?: string;
  remoteSessionId?: string;
}): Record<string, unknown> {
  const base = {
    bridgeSessionId: params.identity.bridgeSessionId,
    ...(params.identity.bridgeGeneration !== undefined
      ? { bridgeGeneration: params.identity.bridgeGeneration }
      : {}),
    ...(params.identity.recoveryId ? { recoveryId: params.identity.recoveryId } : {}),
    workspaceKey: params.workspaceKey,
    workspacePath: params.workspacePath,
    ...(params.initialTaskId ? { initialTaskId: params.initialTaskId } : {}),
  };
  if (params.kind === "remote") {
    if (!params.workspaceIdentity || !params.remoteSessionId) {
      throw new Error("远程 workspace bridge 缺少 workspaceIdentity 或 remoteSessionId。");
    }
    return {
      ...base,
      kind: "remote",
      workspaceIdentity: params.workspaceIdentity,
      remoteSessionId: params.remoteSessionId,
    };
  }
  return { ...base, kind: "local" };
}

/**
 * 可桥判定（对齐官方 isBridgeableRemoteTarget，pl，index.js@385786）：
 * `kind!=="remote" || !!(workspaceIdentity && remoteSessionId)`。远程工作区断连后
 * renderer 推送条目不再携带 remoteSessionId，故"identity+remoteSessionId 齐备"
 * 即官方对"远程已连接"的判定代理——连接状态字段不参与判定。
 */
export function isBridgeableRemoteTarget(target: {
  kind: "local" | "remote";
  workspaceIdentity?: string;
  remoteSessionId?: string;
}): boolean {
  return target.kind !== "remote" || Boolean(target.workspaceIdentity && target.remoteSessionId);
}

/**
 * bridge-error reason 映射（对齐官方 mapWorkspaceBridgeFailureReason，FW，
 * index.js@385109，经 getErrorCode UW @385003 取 Error.code）。托管手机页 i18n
 * （remote/v4/3.14.3 资产 @6046621-6052021）恰好只含这 4 个 reason 键——未知键
 * 落通用失败面，故无 code 的校验错误（未知工作区/远程未连接/superseded）按官方
 * 一律映射 unexpected-error，错误文案随 error 字段透出。
 */
export function mapWorkspaceBridgeFailureReason(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  switch (code) {
    case "DESKTOP_HOST_MISSING":
      return "desktop-disconnected";
    case "REMOTE_SESSION_MISSING":
    case "REMOTE_SESSION_WINDOW_MISMATCH":
      return "workspace-closed";
    case "REMOTE_WORKSPACE_IDENTITY_MISSING":
    case "REMOTE_WORKSPACE_IDENTITY_MISMATCH":
      return "unsupported-action";
    default:
      return "unexpected-error";
  }
}

/**
 * relay 桥面的附着错误码归一：本仓共享 attacher（desktopMobileServiceAttach）的
 * Host 缺失错误码是 LAN 失败面词汇（code=workspace-closed，被 LAN 配对服务器
 * 消费，不可改动）；relay 桥面按官方词汇归一为 DESKTOP_HOST_MISSING（官方
 * attachLocalHost n @583400 的 du("DESKTOP_HOST_MISSING") 同码），再经
 * mapWorkspaceBridgeFailureReason 得到 desktop-disconnected。
 */
export function normalizeRelayAttachError(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "workspace-closed"
  ) {
    return Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      code: "DESKTOP_HOST_MISSING",
    });
  }
  return error;
}
