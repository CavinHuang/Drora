// Relay V2 服务端内部接缝（specs/relay-v2-server.md §4 状态所有者 / §13 工程结构）。
// 契约边界：wire 类型一律 re-export 自 @drora/shared/web-remote-relay（契约键单一出处，
// 禁止在本包复制定义）；本文件只声明内部组件接口。CreateRelayServerOptions 与
// RelayV2ServerHandle 唯一定义在 src/index.ts（曾与旧版双处定义漂移，旧版已删除）。
// 各状态唯一所有者（spec §4）：TokenStore=一次性 token，DeviceStore=SQLite 设备表，
// PairingRegistry=连接与 (SID, role) owner（内存），JwtAuth=JWT→userId 映射，
// 收发计数=WsGateway（内存，连接期）。

import type { WebSocket } from "ws";
import type {
  WebRemoteControlRelayV2Meta,
  WebRemoteControlRelayV2PairStatus,
  WebRemoteControlRelayV2Role,
} from "@drora/shared/web-remote-relay";

export type {
  WebRemoteControlRelayV2Device,
  WebRemoteControlRelayV2ErrorCode,
  WebRemoteControlRelayV2IncomingMessage,
  WebRemoteControlRelayV2Meta,
  WebRemoteControlRelayV2OutgoingMessage,
  WebRemoteControlRelayV2PairStatus,
  WebRemoteControlRelayV2Role,
} from "@drora/shared/web-remote-relay";

/** 单条 WS 连接（形状对照可执行参照 packages/shared/test/fixtures/fake-relay-v2.ts:17） */
export interface Connection {
  id: string;
  socket: WebSocket;
  userId: string;
  role: WebRemoteControlRelayV2Role;
  /** auth_init 通过后绑定；认证前未定义 */
  deviceSid?: string;
  /** terminal 为分配的 t_<uuid>；device 恒为 ""（spec §5.2 terminal_sid 填充规则） */
  terminalSid: string;
  meta: WebRemoteControlRelayV2Meta;
}

/** 一次性 token 的绑定身份：user + role，不绑 SID（契约 docs/web-remote-control/relay-v2-pairing.md） */
export interface RelayTokenIdentity {
  userId: string;
  role: WebRemoteControlRelayV2Role;
  /** 过期时刻（epoch 毫秒；有效期 60 秒） */
  expiresAt: number;
}

export interface TokenStore {
  /** 签发一次性 token：16 字节 base64url（22 字符）、60 秒有效、响应 no-store（spec §5.1） */
  issue(userId: string, role: WebRemoteControlRelayV2Role): { token: string; expiresIn: number };
  /**
   * 升级前原子消费：命中即删（消费即删，spec §5.2 规则 2，同步 Map delete）；
   * 未过期返回绑定身份，未知/过期/已消费一律 undefined，失败不恢复。
   */
  consume(token: string): RelayTokenIdentity | undefined;
}

/** 设备注册表行（spec §7：online/meta 不入库，由 PairingRegistry 实时 join） */
export interface DeviceRecord {
  deviceSid: string;
  deviceMid: string;
  userId: string;
  /** Unix 秒（spec §7） */
  createdAt: number;
}

export interface DeviceStore {
  /** 注册：同 MID 每次产生新 SID（d_<uuid>），不接收 meta（spec §5.1） */
  register(userId: string, deviceMid: string): DeviceRecord;
  get(deviceSid: string): DeviceRecord | undefined;
  listByUser(userId: string): DeviceRecord[];
  /** 物理删除（幂等）；删除后的 SID 无法再通过 auth_init 认证（spec §5.1） */
  delete(deviceSid: string): void;
  /** §7 GC：删除 createdAt 早于 cutoffSeconds 且当前离线的行并返回删除数；在线行跳过下轮再试 */
  collectExpired(cutoffSeconds: number, isOnline: (deviceSid: string) => boolean): number;
  /**
   * §7 备份（能力可选）：VACUUM INTO 一致性快照到 toPath（目标必须不存在）。
   * 仅 SqliteDeviceStore 提供；注入的存储未实现时装配层不得伪造（backupDevices 抛错）。
   */
  backup?(toPath: string): void;
}

/** 单连接收发计数（spec §4/§9：WsGateway 连接期状态；诊断「单向断」用） */
export interface ConnectionTrafficCounters {
  framesIn: number;
  bytesIn: number;
  framesOut: number;
  bytesOut: number;
}

/** /healthz counters 视图：存活连接按角色聚合，连接关闭即出清（spec §9） */
export interface RelayTrafficView {
  device: ConnectionTrafficCounters;
  terminal: ConnectionTrafficCounters;
}

export interface JwtAuth {
  /**
   * Bearer JWT → 带 realm 前缀的 userId（spec §6.2/§6.3）；缺失或无法映射返回 undefined，
   * 由调用方回 HTTP 401（客户端按 auth-required 停机）。async 以容纳 introspect/jwks 模式。
   */
  authenticate(authorizationHeader: string | undefined): Promise<string | undefined>;
}

/** auth_ack / pair_status_ack 的配对状态视图 */
export interface PairingStatusView {
  pairStatus: WebRemoteControlRelayV2PairStatus;
  /**
   * 双语义（spec §5.2 填充规则）：bind（auth_ack）= 本连接自己的 terminalSid（device 恒 ""、
   * terminal 为分配的 t_<uuid>）；query（pair_status_ack）= 对端 terminal 的 SID，对端非
   * terminal 或离线恒 ""。
   */
  terminalSid: string;
}

/**
 * PairingRegistry 的对外通知回调（由 WsGateway 装配为 wire 消息与 close，spec §6.4/§6.5）。
 * 回调内不得反向调用 registry 改状态，避免重入。
 */
export interface PairingRegistryEvents {
  /** 同角色替换：向旧 owner 发 KICKED 后异步关闭；旧连接迟到的 close 不得移除新 owner */
  onKicked(oldConnection: Connection): void;
  /** 推送语义 pair_status_ack（配对成功、对端断开）：terminal_sid 恒 ""（spec §5.2） */
  onPairStatusPush(peer: Connection, pairStatus: WebRemoteControlRelayV2PairStatus): void;
  /** device 断开：向 terminal 对端发 DEVICE_OFFLINE 并关闭；terminal 断开只走 onPairStatusPush(waiting) */
  onDeviceOffline(terminal: Connection): void;
}

export interface PairingRegistry {
  /**
   * auth_init 绑定：同角色替换（触发 onKicked）→ 通知对端（onPairStatusPush）→ 返回本连接 ack 视图。
   * 设备存在与归属校验由网关先经 DeviceStore 完成（spec §4 依赖方向 G→DS）。
   */
  bind(connection: Connection): PairingStatusView;
  /** pair_status_query 应答视图：terminal_sid = peer?.terminalSid ?? ""（spec §5.2 填充规则） */
  query(connection: Connection): PairingStatusView;
  /** data 路由：返回同 SID 另一角色连接；无对端由网关按 INTERNAL 处理且不关闭（spec §5.2） */
  peerOf(connection: Connection): Connection | undefined;
  /** 断连释放：仅当前 owner 生效（stale close 防护，spec §6.5）；双角色均空时清理 owners */
  release(connection: Connection): void;
  /** 在线 join：HTTP 列表 online 字段与删除 3005 判定共用（spec §5.1/§7） */
  isDeviceOnline(deviceSid: string): boolean;
}
