/**
 * relay-v2-server 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 *
 * 本模块是被部署的单进程服务端（specs/relay-v2-server.md §13），不是被导入的库：
 * - 运维接缝 = 环境变量（src/config.ts，spec §9 全量键与默认值）+ 结构化日志（src/logger.ts，红线内嵌）。
 * - 装配接缝 = src/types.ts 的组件接口（TokenStore/DeviceStore/JwtAuth/PairingRegistry）；
 *   CreateRelayServerOptions 与 RelayV2ServerHandle 唯一定义在 src/index.ts（曾与 types.ts
 *   旧版双处定义漂移，旧版已删除——包根契约面类型必须与真实入口 createRelayServer 同形）。
 * - 契约键单一出处：wire 类型一律 re-export 自 @drora/shared/web-remote-relay，本包不复制定义。
 */
import type { RelayConfig, RelayJwtMode, RelayJwtRealmMode } from "./src/config.js";
// RelayHealthView 是 /healthz 运维接缝的响应视图（spec §9），与收发计数视图同属调用方
// 需要知道的公开面（评审 export-surface：连同 ConnectionTrafficCounters/RelayTrafficView
// 一并升入契约面，src/index.ts 的导出口径与 contract.ts 保持一致）。
import type { RelayHealthView } from "./src/http.js";
import type { RelayLogLevel, RelayLogger, RelayMessageTraceFields } from "./src/logger.js";
import type {
  Connection,
  ConnectionTrafficCounters,
  DeviceRecord,
  DeviceStore,
  JwtAuth,
  PairingRegistry,
  PairingRegistryEvents,
  PairingStatusView,
  RelayTokenIdentity,
  RelayTrafficView,
  TokenStore,
} from "./src/types.js";

export type {
  Connection,
  ConnectionTrafficCounters,
  DeviceRecord,
  DeviceStore,
  JwtAuth,
  PairingRegistry,
  PairingRegistryEvents,
  PairingStatusView,
  RelayConfig,
  RelayJwtMode,
  RelayJwtRealmMode,
  RelayHealthView,
  RelayLogLevel,
  RelayLogger,
  RelayMessageTraceFields,
  RelayTokenIdentity,
  RelayTrafficView,
  TokenStore,
};
export type {
  WebRemoteControlRelayV2Device,
  WebRemoteControlRelayV2ErrorCode,
  WebRemoteControlRelayV2IncomingMessage,
  WebRemoteControlRelayV2Meta,
  WebRemoteControlRelayV2OutgoingMessage,
  WebRemoteControlRelayV2PairStatus,
  WebRemoteControlRelayV2Role,
} from "./src/types.js";

// CreateRelayServerOptions 与服务句柄的唯一出处是公开入口 src/index.ts（句柄含 port 与
// backupDevices 字段），此处 import 后 re-export 保持契约文档覆盖完整公开面；禁止在本文件
// 复制定义（双处定义曾发生漂移——contract.ts 缺 port，评审已纠正）。
import type { CreateRelayServerOptions, RelayV2ServerHandle } from "./src/index.js";
export type { CreateRelayServerOptions, RelayV2ServerHandle };

/** 一个意图：装配并启动 relay。实现由 src/index.ts 在 M1 提供（spec §12/§13）。 */
export interface RelayV2ServerContract {
  start(options: CreateRelayServerOptions): Promise<RelayV2ServerHandle>;
}
