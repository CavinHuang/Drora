// 移动端远程控制·官方 relay 协议纯逻辑（无 IO，可独立单测）。
// 常量与算法逐项取证自官方 3.14.3 发行 bundle 并经最小探测复核（spec: mobile-web-remote.md M4）。
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MobilePairingRuntimeState } from "@drora/shared";

export const OFFICIAL_RELAY_WS_URL = "wss://zcode.z.ai/ws";
/** v3 托管页已 404；官方版本门控现走 v4（探测核实）。 */
export const OFFICIAL_REMOTE_PAGE_URL = "https://zcode.z.ai/remote/v4";

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
  return createHmac("sha256", params.passHash)
    .update(`${params.nonce}|${params.role}|${params.sessionId}`)
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
  appVersion?: string;
}): string {
  const url = new URL(params.baseUrl ?? OFFICIAL_REMOTE_PAGE_URL);
  url.searchParams.set("sid", params.deviceSid);
  url.searchParams.set("hash", params.passHash);
  url.searchParams.set("t", String(params.timestamp ?? Date.now()));
  if (params.deviceMid?.trim()) url.searchParams.set("mid", params.deviceMid.trim());
  if (params.deviceName?.trim()) url.searchParams.set("name", params.deviceName.trim());
  if (params.appVersion?.trim()) url.searchParams.set("app_version", params.appVersion.trim());
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

  constructor(optionsDir: string, encryption?: {
    encrypt: (plain: string) => string;
    decrypt: (stored: string) => string;
  }) {
    this.filePath = join(optionsDir, CREDENTIAL_FILE_NAME);
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
    await writeFile(this.filePath, JSON.stringify({ deviceSid: credential.deviceSid, passHash: stored }, null, 2), "utf-8");
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
  kind: "local";
  connectionState: "connected";
}

export interface RelayTaskSummary {
  taskId: string;
  title: string;
  status: string;
  updatedAt: number;
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
  workspace: RelayWorkspaceSummary;
  tasks: RelayTaskSummary[];
  mobileViewState?: RelayMobileViewState;
}): Record<string, unknown> {
  return {
    windowControlSessionId: params.deviceSid,
    desktopAppVersion: params.appVersion,
    workspaces: [params.workspace],
    tasks: params.tasks,
    ...(params.mobileViewState ? { initialViewState: params.mobileViewState } : {}),
    ...(params.mobileViewState ? { mobileViewState: params.mobileViewState } : {}),
  };
}

export function buildWorkspaceListResult(params: {
  workspace: RelayWorkspaceSummary;
  tasks: RelayTaskSummary[];
  mobileViewState?: RelayMobileViewState;
}): Record<string, unknown> {
  return {
    workspaces: [params.workspace],
    tasks: params.tasks,
    activeWorkspaceKey:
      params.mobileViewState?.activeWorkspaceKey ?? relayWorkspaceKey(params.workspace),
    ...(params.mobileViewState?.activeTaskId
      ? { activeTaskId: params.mobileViewState.activeTaskId }
      : {}),
  };
}
