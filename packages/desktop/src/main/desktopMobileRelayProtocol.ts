/* eslint-disable max-lines -- 协议纯逻辑单文件聚合（常量+算法+存储），与 desktopMobilePairingCore 同例。 */
// 移动端远程控制·官方 relay 协议纯逻辑（无 IO，可独立单测）。
// 常量与算法逐项取证自官方 3.14.3 发行 bundle 并经最小探测复核（spec: mobile-web-remote.md M4）。
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MobilePairingRuntimeState } from "@drora/shared";

export const OFFICIAL_RELAY_WS_URL = "wss://zcode.z.ai/ws";
/** v3 托管页已 404；官方版本门控现走 v4（探测核实）。 */
export const OFFICIAL_REMOTE_PAGE_URL = "https://zcode.z.ai/remote/v4";

/**
 * 自建 relay 服务端端点推导（spec: mobile-relay-server.md §8）：
 * base = http(s)://host:port → relayWsUrl = ws(s)://host:port/ws、
 * remotePageUrl = base + /m/index.html（自建手机页）。
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
    remotePageUrl: `${base}/m/index.html`,
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
  ) {
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

// —— M4b：rpc-frame 传输封装（对齐官方 encodeWebRemoteControlRpcTransportMessage /
// WebRemoteControlRpcTransportAssembler / frameShell，取证自官方 3.14.3 bundle）——
//
// 线格式（每个物理帧一个 JSON 对象，经 relay data 帧透传）：
//   {zcode_type:"rpc-frame", bridgeSessionId, [bridgeGeneration], [recoveryId],
//    seq(物理序号), messageSeq, fragmentIndex, fragmentCount, messageBytes,
//    checksum:{algorithm:"crc32", value}, dataBase64(分片字节)}
// 确认帧：{zcode_type:"rpc-frame-ack", bridgeSessionId, [bridgeGeneration],
//   [recoveryId], ackMessageSeq}
// 限制（官方常量）：消息 ≤16MiB、分片 ≤64、dataBase64 ≤1MiB。

export const RPC_FRAME_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const RPC_FRAME_MAX_FRAGMENTS = 64;
/** 单分片数据预算：base64 后 ~874KB + 封套 JSON 开销，稳居 1MiB 物理帧上限内。 */
export const RPC_FRAME_FRAGMENT_DATA_BYTES = 640 * 1024;

export interface RpcFrameIdentity {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
}

export interface RpcTransportFrame {
  zcode_type: "rpc-frame";
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  seq: number;
  messageSeq: number;
  fragmentIndex: number;
  fragmentCount: number;
  messageBytes: number;
  /** checksum.value 线格式：8 位小写 hex 字符串（出站）；入站兼容数值。 */
  checksum: { algorithm: "crc32"; value: string };
  dataBase64: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function identityFields(identity: RpcFrameIdentity): Record<string, unknown> {
  return {
    bridgeSessionId: identity.bridgeSessionId,
    ...(identity.bridgeGeneration !== undefined
      ? { bridgeGeneration: identity.bridgeGeneration }
      : {}),
    ...(identity.recoveryId ? { recoveryId: identity.recoveryId } : {}),
  };
}

/**
 * 编码一条 rpc 消息为一个或多个物理帧（对齐官方 L3 编码器语义）。
 * 返回帧数组与推进后的物理序号。
 * checksum.value 线格式为 8 位小写十六进制字符串（官方/手机端组装器以
 * /^[0-9a-f]{8}$/ 校验，数字会被判 proto.frameAssemblyMetadataMismatch 丢弃，
 * 2026-09-27 真机取证）；内部比较统一用数值。
 */
export function crc32ToWire(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/** 入站 checksum.value 兼容数值与 8 位 hex 字符串两种线格式。 */
export function checksumValueFromWire(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9a-f]{8}$/.test(value)) return parseInt(value, 16);
  return null;
}

export function encodeRpcTransportMessage(params: {
  message: Uint8Array;
  identity: RpcFrameIdentity;
  firstPhysicalSeq: number;
  messageSeq: number;
}): { frames: RpcTransportFrame[]; nextPhysicalSeq: number; checksum: number } {
  const { message, identity, firstPhysicalSeq, messageSeq } = params;
  if (message.byteLength === 0) {
    throw new Error("remote.rpcFrame.emptyMessage");
  }
  if (message.byteLength > RPC_FRAME_MAX_MESSAGE_BYTES) {
    throw new Error("remote.rpcFrame.messageTooLarge");
  }
  const checksum = { algorithm: "crc32" as const, value: crc32ToWire(crc32(message)) };
  const fragmentCount = Math.max(1, Math.ceil(message.byteLength / RPC_FRAME_FRAGMENT_DATA_BYTES));
  if (fragmentCount > RPC_FRAME_MAX_FRAGMENTS) {
    throw new Error("remote.rpcFrame.fragmentLimitExceeded");
  }
  const frames: RpcTransportFrame[] = [];
  for (let index = 0; index < fragmentCount; index += 1) {
    const start = index * RPC_FRAME_FRAGMENT_DATA_BYTES;
    const end = Math.min(message.byteLength, start + RPC_FRAME_FRAGMENT_DATA_BYTES);
    frames.push({
      zcode_type: "rpc-frame",
      ...identityFields(identity),
      seq: firstPhysicalSeq + index,
      messageSeq,
      fragmentIndex: index,
      fragmentCount,
      messageBytes: message.byteLength,
      checksum,
      dataBase64: Buffer.from(message.subarray(start, end)).toString("base64"),
    });
  }
  const checksumValue = crc32(message);
  return { frames, nextPhysicalSeq: firstPhysicalSeq + fragmentCount, checksum: checksumValue };
}

/** rpc-frame-ack 确认帧（手机→桌面方向的每条完整消息都必须回执，否则对端流控降级）。 */
export function buildRpcFrameAck(params: {
  identity: RpcFrameIdentity;
  ackMessageSeq: number;
}): Record<string, unknown> {
  return {
    zcode_type: "rpc-frame-ack",
    ...identityFields(params.identity),
    ackMessageSeq: params.ackMessageSeq,
  };
}

/**
 * 入站帧重组器（宽松版官方 Assembler：按 messageSeq 聚组分片）。
 * 完整消息返回 {message, messageSeq}；未齐或校验失败返回 null 并由调用方丢弃。
 */
export class RpcFrameAssembler {
  private readonly pending = new Map<number, Map<number, RpcTransportFrame>>();

  constructor(private readonly identity: RpcFrameIdentity) {}

  accept(frame: RpcTransportFrame): { message: Uint8Array; messageSeq: number } | null {
    if (frame.bridgeSessionId !== this.identity.bridgeSessionId) return null;
    if (frame.bridgeGeneration !== this.identity.bridgeGeneration) return null;
    if ((frame.recoveryId ?? undefined) !== (this.identity.recoveryId || undefined)) return null;
    if (frame.fragmentIndex >= frame.fragmentCount) return null;
    if (frame.messageBytes > RPC_FRAME_MAX_MESSAGE_BYTES) return null;
    if (frame.fragmentCount > RPC_FRAME_MAX_FRAGMENTS) return null;
    let group = this.pending.get(frame.messageSeq);
    if (!group) {
      group = new Map();
      this.pending.set(frame.messageSeq, group);
    }
    group.set(frame.fragmentIndex, frame);
    if (group.size < frame.fragmentCount) return null;
    this.pending.delete(frame.messageSeq);
    const assembled = Buffer.alloc(frame.messageBytes);
    let offset = 0;
    const frameChecksum = checksumValueFromWire(frame.checksum.value);
    for (let index = 0; index < frame.fragmentCount; index += 1) {
      const piece = group.get(index);
      if (!piece) return null;
      if (
        piece.messageBytes !== frame.messageBytes ||
        checksumValueFromWire(piece.checksum.value) !== frameChecksum
      ) {
        return null;
      }
      const chunk = Buffer.from(piece.dataBase64, "base64");
      if (offset + chunk.byteLength > assembled.byteLength) return null;
      chunk.copy(assembled, offset);
      offset += chunk.byteLength;
    }
    const message = new Uint8Array(assembled);
    if (message.byteLength !== frame.messageBytes) return null;
    if (frameChecksum === null || crc32(message) !== frameChecksum) return null;
    return { message, messageSeq: frame.messageSeq };
  }

  /** 丢弃某 messageSeq 的未齐分组（桥重建时清理）。 */
  drop(messageSeq: number): void {
    this.pending.delete(messageSeq);
  }

  clear(): void {
    this.pending.clear();
  }
}

/** bridge-ready 携带的 bridge 信息（对齐官方 toExternalBridge）。 */
export function toExternalBridge(params: {
  identity: RpcFrameIdentity;
  workspaceKey: string;
  workspacePath: string;
  initialTaskId?: string;
  kind: "local";
}): Record<string, unknown> {
  return {
    bridgeSessionId: params.identity.bridgeSessionId,
    ...(params.identity.bridgeGeneration !== undefined
      ? { bridgeGeneration: params.identity.bridgeGeneration }
      : {}),
    ...(params.identity.recoveryId ? { recoveryId: params.identity.recoveryId } : {}),
    workspaceKey: params.workspaceKey,
    workspacePath: params.workspacePath,
    ...(params.initialTaskId ? { initialTaskId: params.initialTaskId } : {}),
    kind: params.kind,
  };
}

/** 入站 rpc-frame 帧的运行时校验（形状级；语义校验在 Assembler）。 */
export function parseRpcTransportFrame(value: unknown): RpcTransportFrame | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.zcode_type !== "rpc-frame") return null;
  if (typeof record.bridgeSessionId !== "string") return null;
  if (record.bridgeGeneration !== undefined && typeof record.bridgeGeneration !== "number")
    return null;
  if (record.recoveryId !== undefined && typeof record.recoveryId !== "string") return null;
  if (typeof record.seq !== "number" || typeof record.messageSeq !== "number") return null;
  if (
    typeof record.fragmentIndex !== "number" ||
    typeof record.fragmentCount !== "number" ||
    typeof record.messageBytes !== "number"
  ) {
    return null;
  }
  const checksum = record.checksum as { algorithm?: unknown; value?: unknown } | undefined;
  if (
    !checksum ||
    checksum.algorithm !== "crc32" ||
    // 入站兼容数值与 8 位 hex 字符串两种线格式（手机端发送侧为 hex 字符串）。
    checksumValueFromWire(checksum.value) === null ||
    typeof record.dataBase64 !== "string"
  ) {
    return null;
  }
  return record as unknown as RpcTransportFrame;
}
