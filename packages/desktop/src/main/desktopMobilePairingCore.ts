// 移动端远程控制·配对核心（纯逻辑，无 electron/http 依赖，可独立单测）。
// 架构与安全模型见 specs/mobile-web-remote.md：
// - 配对令牌一次性 + 5 分钟 TTL，只出现在二维码 URL 路径；
// - 配对成功即作废并换发会话令牌（单设备语义，新配对踢旧会话）；
// - 服务空闲自动关闭是 Main 侧生命周期，不在这里（core 只管令牌与判定）。
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";

export const PAIR_TOKEN_TTL_MS = 5 * 60 * 1000;
/** 单台设备配对；令牌按字节编码为 32 字符 hex（128-bit），URL 安全。 */
export const PAIR_TOKEN_BYTES = 16;
export const SESSION_TOKEN_BYTES = 32;

export type PairingPhase = "idle" | "awaiting-pair" | "paired";

export interface PairingTicket {
  pairToken: string;
  sessionToken: string;
  expiresAt: number;
}

export interface PairingCoreState {
  phase: PairingPhase;
  /** awaiting-pair 时的有效配对票据；paired 后保留 sessionToken 供校验。 */
  ticket: PairingTicket | null;
  pairedSessionToken: string | null;
  pairedAt: number | null;
}

export function createPairingCoreState(): PairingCoreState {
  return { phase: "idle", ticket: null, pairedSessionToken: null, pairedAt: null };
}

export function createPairToken(): string {
  return randomBytes(PAIR_TOKEN_BYTES).toString("hex");
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

/** 常量时间比较，避免 WS 握手逐字节 early-return 泄露令牌前缀。 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // 长度不同必然不匹配；仍走一次比较以抹平长短两种路径的耗时差。
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export interface IssuePairTicketResult {
  state: PairingCoreState;
  ticket: PairingTicket;
}

/**
 * 生成新配对票据。任何时刻至多一张有效票据：重复生成会作废旧票据
 * （用户重启服务/重新扫码的语义）。phase 保持 awaiting-pair 直到 pair() 成功。
 */
export function issuePairTicket(state: PairingCoreState, now: number): IssuePairTicketResult {
  const ticket: PairingTicket = {
    pairToken: createPairToken(),
    sessionToken: createSessionToken(),
    expiresAt: now + PAIR_TOKEN_TTL_MS,
  };
  return {
    state: { phase: "awaiting-pair", ticket, pairedSessionToken: null, pairedAt: null },
    ticket,
  };
}

export interface PairAttemptOutcome {
  state: PairingCoreState;
  ok: boolean;
  /** ok=true 时返回会话令牌；手机端后续 WS 请求都带它。 */
  sessionToken?: string;
  failure?: "unknown-token" | "expired-token";
}

/**
 * 手机凭配对令牌换取会话令牌。已配对状态下收到新的有效配对票据 = 换机场景，
 * 直接踢掉旧会话（旧会话令牌随 pairedSessionToken 覆盖而失效）。
 */
export function attemptPair(
  state: PairingCoreState,
  pairToken: string,
  now: number,
): PairAttemptOutcome {
  const ticket = state.ticket;
  if (!ticket || !tokensMatch(ticket.pairToken, pairToken)) {
    return { state, ok: false, failure: "unknown-token" };
  }
  if (now > ticket.expiresAt) {
    return { state, ok: false, failure: "expired-token" };
  }
  return {
    state: {
      phase: "paired",
      ticket: null,
      pairedSessionToken: ticket.sessionToken,
      pairedAt: now,
    },
    ok: true,
    sessionToken: ticket.sessionToken,
  };
}

/** 校验会话令牌；服务运行期间会话令牌不过期（生命周期由空闲关停兜底）。 */
export function isSessionTokenValid(state: PairingCoreState, sessionToken: string): boolean {
  return (
    state.phase === "paired" &&
    !!state.pairedSessionToken &&
    tokensMatch(state.pairedSessionToken, sessionToken)
  );
}

/** 配对令牌是否已过期（UI 倒计时与重生成提示用）。 */
export function isTicketExpired(state: PairingCoreState, now: number): boolean {
  return state.phase === "awaiting-pair" && !!state.ticket && now > state.ticket.expiresAt;
}

export interface LanAddressResult {
  address: string;
  interfaceName: string;
}

/** 放宽 Node 的 NetworkInterfaceInfo：测试可传入纯结构对象，family 用宽松 string。 */
type LanInterfaces = Record<
  string,
  Array<{ address: string; family: string; internal: boolean }> | undefined
>;

/**
 * 从本机网卡挑一个可供手机访问的 IPv4 地址。
 * 优先 192.168/10. 段的物理网段，回退任意非内环 IPv4；找不到返回 null（UI 提示）。
 * 排除虚拟网卡常见命名（vEthernet/Docker/WSL 等），减少扫出一个连不上的地址。
 */
export function pickLanAddress(
  interfaces: LanInterfaces = networkInterfaces(),
): LanAddressResult | null {
  const candidates: Array<LanAddressResult & { priority: number }> = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;
    if (/vethernet|docker|wsl|vmware|virtualbox|loopback|tailscale/i.test(name)) continue;
    for (const address of addresses) {
      if (address.internal || address.family !== "IPv4") continue;
      const priority = address.address.startsWith("192.168.")
        ? 2
        : address.address.startsWith("10.")
          ? 1
          : 0;
      if (priority > 0) {
        candidates.push({ address: address.address, interfaceName: name, priority });
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  const best = candidates[0];
  if (best) {
    return { address: best.address, interfaceName: best.interfaceName };
  }
  // 回退：任意非内环 IPv4（含 172.16-31 段）。
  for (const addresses of Object.values(interfaces)) {
    const fallback = addresses?.find((a) => !a.internal && a.family === "IPv4");
    if (fallback) {
      return { address: fallback.address, interfaceName: "" };
    }
  }
  return null;
}

export function buildPairingUrl(params: {
  address: string;
  port: number;
  pairToken: string;
}): string {
  return `http://${params.address}:${params.port}/p/${params.pairToken}`;
}

/** 配对页路径是否合法（避免把任意路径当令牌透传给日志/回显）。 */
export function parsePairingPath(pathname: string): string | null {
  const match = pathname.match(/^\/p\/([0-9a-f]{32})$/u);
  return match ? (match[1] ?? null) : null;
}
