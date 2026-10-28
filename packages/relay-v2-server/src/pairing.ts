// PairingRegistry（specs/relay-v2-server.md §5.2/§6.4/§6.5，行为逐条对照 fake-relay-v2.ts
// 的 owners/peer/view 与 auth_init/close 处理）。
// 状态所有者（spec §4）：内存 owners 表（SID → { device?, terminal? }）是 (SID, role) 当前
// owner 的唯一写路径；pair_status 永远由 owner 存在性派生，不单独存储。
// 本模块是纯领域逻辑：不触碰 socket、不构造 wire 消息，所有通知经 PairingRegistryEvents
// 交上层装配为 KICKED / pair_status_ack / DEVICE_OFFLINE 与 close；事件顺序在 bind/release
// 内固定（§6.4/§6.5），回调内不得反向调用 registry 改状态（types.ts 契约）。

import type { WebRemoteControlRelayV2Role } from "@drora/shared/web-remote-relay";
import type { Connection, PairingRegistry, PairingRegistryEvents } from "./types.js";

/** owner 表条目：同一 SID 下两角色各至多一个当前 owner */
type RoleOwners = Partial<Record<WebRemoteControlRelayV2Role, Connection>>;

const otherRole = (role: WebRemoteControlRelayV2Role): WebRemoteControlRelayV2Role =>
  role === "device" ? "terminal" : "device";

export function createPairingRegistry(events: PairingRegistryEvents): PairingRegistry {
  const owners = new Map<string, RoleOwners>();

  /** peer 查找：同 SID 另一角色（fake relay 的 peer()） */
  const peerOf = (connection: Connection): Connection | undefined =>
    owners.get(connection.deviceSid ?? "")?.[otherRole(connection.role)];

  return {
    bind(connection) {
      const deviceSid = connection.deviceSid;
      // 前置契约：设备存在与归属校验由网关经 DeviceStore 完成后才绑定（types.ts）；
      // 此分支防御性兜底，不触碰 owner 表、不发通知。
      if (deviceSid === undefined) {
        return { pairStatus: "waiting", terminalSid: connection.terminalSid };
      }
      const roles: RoleOwners = owners.get(deviceSid) ?? {};
      const previous = roles[connection.role];
      // ① 先替换 owner：新连接先落位，旧连接迟到的 close 由 release 的身份判断挡住（§6.4）
      roles[connection.role] = connection;
      owners.set(deviceSid, roles);
      // ② 旧 owner 收 KICKED，close 由上层异步执行（§6.4 顺序：替换 → KICKED → 异步 close）
      if (previous !== undefined) events.onKicked(previous);
      // ③ 对端在线则推送 pair_status_ack(matched)；推送语义 terminal_sid 恒 ""（§5.2）
      const peer = roles[otherRole(connection.role)];
      if (peer !== undefined) events.onPairStatusPush(peer, "matched");
      // ④ 返回新连接的 auth_ack 视图（terminalSid 回显本连接自己的：device 恒 ""，terminal 为 t_<uuid>）
      return {
        pairStatus: peer !== undefined ? "matched" : "waiting",
        terminalSid: connection.terminalSid,
      };
    },

    query(connection) {
      // 查询语义（§5.2）：terminal_sid = 对端 terminal 的 SID；
      // terminal 查询时对端是 device，得 ""（不回显自己的 SID）
      const peer = peerOf(connection);
      return {
        pairStatus: peer !== undefined ? "matched" : "waiting",
        terminalSid: peer?.terminalSid ?? "",
      };
    },

    peerOf,

    release(connection) {
      const deviceSid = connection.deviceSid;
      if (deviceSid === undefined) return; // 未认证连接不在 owner 表，无可释放
      const roles = owners.get(deviceSid);
      // stale close 防护（§6.4/§6.5）：被替换连接的 close 晚于新认证完成，必须按连接身份判断；
      // 非当前 owner 的断连只由网关清理连接集合，不动 owner 表、不发通知。
      if (roles === undefined || roles[connection.role] !== connection) return;
      delete roles[connection.role];
      const peer = roles[otherRole(connection.role)];
      if (peer !== undefined) {
        // 断连通知顺序（§6.5）：一律先对端 waiting 推送；
        // device 断再加 DEVICE_OFFLINE 并由上层关闭 terminal，terminal 断则 device 保留心跳等待
        events.onPairStatusPush(peer, "waiting");
        if (connection.role === "device") events.onDeviceOffline(peer);
      }
      // 双角色均空 → 清理 owner 表，避免失效 SID 无界累积（§6.5）
      if (roles.device === undefined && roles.terminal === undefined) {
        owners.delete(deviceSid);
      }
    },

    isDeviceOnline(deviceSid) {
      // fake relay view() 语义：online 只看 device 角色连接；meta 由网关从该连接实时读取
      return owners.get(deviceSid)?.device !== undefined;
    },
  };
}
