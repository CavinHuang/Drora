// ZCode Relay Server · 每设备会话状态机（内存，唯一所有者）。
// pair_status = device 与 terminal 双端都在线 ? matched : waiting。
// 踢除顺序不变量（spec §4.1）：新 terminal 鉴权成功时，旧 terminal 先收 KICKED
// 并断开，之后新 terminal 才拿到 matched 应答。
import type { RelayRole } from "./protocol.js";

export interface SessionEndpoint {
  /** role 对应的连接标识（server 层用它路由发送与按连接精确拆挂）。 */
  connectionId: number;
  /** terminal 的会话 id（auth_ack.terminal_sid）；device 恒为 deviceSid。 */
  sid: string;
}

export interface SessionView {
  device: SessionEndpoint | null;
  terminal: SessionEndpoint | null;
  status: "waiting" | "matched";
}

export interface AttachResult {
  status: "waiting" | "matched";
  /** attach terminal 且发生接管时为被踢旧 terminal 的 connectionId（由 server 层执行 KICKED+断开）。 */
  kickedConnectionId: number | null;
  /** 配对状态是否发生变化（server 层据此决定是否主动推 pair_status_ack）。 */
  statusChanged: boolean;
}

export interface DetachResult {
  status: "waiting" | "matched" | null;
  statusChanged: boolean;
  /** 实际被拆挂的 role；connectionId 不匹配（如被踢旧连接的迟到 close）时为 null。 */
  detachedRole: RelayRole | null;
}

export function createSessionStore() {
  /** deviceSid → { device/terminal endpoint }；键在 device 鉴权或 terminal 鉴权时建立。 */
  const sessions = new Map<
    string,
    { device: SessionEndpoint | null; terminal: SessionEndpoint | null }
  >();

  function view(deviceSid: string): SessionView {
    const session = sessions.get(deviceSid);
    if (!session) return { device: null, terminal: null, status: "waiting" };
    return {
      device: session.device,
      terminal: session.terminal,
      status: session.device && session.terminal ? "matched" : "waiting",
    };
  }

  function attachDevice(deviceSid: string, endpoint: SessionEndpoint): AttachResult {
    const before = view(deviceSid);
    const session = sessions.get(deviceSid) ?? { device: null, terminal: null };
    session.device = endpoint;
    sessions.set(deviceSid, session);
    const after = view(deviceSid);
    return {
      status: after.status,
      kickedConnectionId: null,
      statusChanged: before.status !== after.status,
    };
  }

  function attachTerminal(
    deviceSid: string,
    endpoint: SessionEndpoint,
  ): AttachResult & { kickedEndpoint: SessionEndpoint | null } {
    const before = view(deviceSid);
    const session = sessions.get(deviceSid) ?? { device: null, terminal: null };
    const kickedEndpoint = session.terminal;
    session.terminal = endpoint;
    sessions.set(deviceSid, session);
    const after = view(deviceSid);
    return {
      status: after.status,
      kickedConnectionId: kickedEndpoint?.connectionId ?? null,
      kickedEndpoint,
      statusChanged: before.status !== after.status,
    };
  }

  /**
   * 按 connectionId 精确拆挂。被 KICKED 的旧连接其 socket close 事件可能晚到
   * （新 terminal 已接管）——此时 connectionId 不匹配，直接忽略，绝不能拆除
   * 新 terminal 的挂载（多 terminal 竞态，集成测试实锤）。
   */
  function detach(deviceSid: string, connectionId: number): DetachResult {
    const before = view(deviceSid);
    const session = sessions.get(deviceSid);
    if (!session) return { status: null, statusChanged: false, detachedRole: null };
    let detachedRole: RelayRole | null = null;
    if (session.device?.connectionId === connectionId) {
      session.device = null;
      detachedRole = "device";
    } else if (session.terminal?.connectionId === connectionId) {
      session.terminal = null;
      detachedRole = "terminal";
    } else {
      return { status: null, statusChanged: false, detachedRole: null };
    }
    const after = view(deviceSid);
    // 双端皆空则销毁会话；否则回到 waiting。
    if (!session.device && !session.terminal) sessions.delete(deviceSid);
    return { status: after.status, statusChanged: before.status !== after.status, detachedRole };
  }

  function peer(deviceSid: string, role: RelayRole): SessionEndpoint | null {
    const session = sessions.get(deviceSid);
    if (!session) return null;
    return role === "device" ? session.terminal : session.device;
  }

  function self(deviceSid: string, role: RelayRole): SessionEndpoint | null {
    const session = sessions.get(deviceSid);
    if (!session) return null;
    return role === "device" ? session.device : session.terminal;
  }

  return { view, attachDevice, attachTerminal, detach, peer, self };
}
