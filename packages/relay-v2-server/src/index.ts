// Relay V2 服务端公共入口与装配（specs/relay-v2-server.md §4/§5/§9/§13）。
// createRelayServer 是唯一把 config / logger / JwtAuth / PairingRegistry / TokenStore /
// DeviceStore / http / ws 组装成监听进程的地方；各状态的唯一所有者见 spec §4。
//
// 选项形状说明：CreateRelayServerOptions 唯一定义在本文件（曾与 src/types.ts 旧版双处定义，
// 旧版 tokens/devices/registry 全必填、无 now/gcIntervalMs 注入口，包根契约面类型须与真实
// 入口一致，旧版已删除）；注入面保留 tokens/devices/registry 供测试对时与桩替换（缺省内部
// 构造，DB 路径取 config.dbPath，stub users 映射见 users 选项）。

import { createServer } from "node:http";
import { createStubJwtAuth } from "./auth.js";
import { createSqliteDeviceStore, type SqliteDeviceStore } from "./devices.js";
import { createRelayLogger } from "./logger.js";
import { createPairingRegistry } from "./pairing.js";
import { createTokenStore } from "./tokens.js";
import { createHttpApi } from "./http.js";
import { createPairingRegistryEvents, createWsGateway } from "./ws.js";
import type { RelayConfig } from "./config.js";
import type { RelayLogger } from "./logger.js";
import type { DeviceStore, JwtAuth, PairingRegistry, TokenStore } from "./types.js";

export interface CreateRelayServerOptions {
  /** 运行配置（spec §9 全量键：bindHost/listenPort/dbPath/超时/CORS/日志等） */
  config: RelayConfig;
  /** 装配好的 JWT 鉴权（decode/introspect/jwks，spec §6.2）；省略时必须提供 users（stub） */
  auth?: JwtAuth;
  /** stub auth 的 JWT→userId 映射表（fake relay 同款 users 选项，spec §12 M1；仅 auth 缺省时启用） */
  users?: Readonly<Record<string, string>>;
  /** 注入 TokenStore（测试对时）；缺省内部构造 60 秒一次性 token 存储 */
  tokens?: TokenStore;
  /** 注入 DeviceStore；缺省按 config.dbPath 构造 SQLite 设备注册表，并在 stop 时关闭 */
  devices?: DeviceStore;
  /**
   * 注入 PairingRegistry（事件用 createPairingRegistryEvents 装配）；缺省内部构造。
   * 通知回调必须对上 WS 网关的发送与关闭路径，生产部署交给缺省装配。
   */
  registry?: PairingRegistry;
  /** 注入结构化日志；缺省按 config.logLevel / config.msgTrace 构造 */
  logger?: RelayLogger;
  /** 注入时钟（测试对时）；缺省 Date.now。token 过期、created_at 与 GC cutoff 共用同一条时间线 */
  now?: () => number;
  /** 设备 GC 调度间隔毫秒（spec §7 生产为每日一次）；仅测试注入，缺省 24h */
  gcIntervalMs?: number;
}

/** 服务句柄：生命周期动作是优雅停机与设备表备份（spec §5.3/§7）。本定义是唯一出处，包根 contract.ts re-export 之。 */
export interface RelayV2ServerHandle {
  /**
   * 实际绑定端口（config.listenPort=0 时为内核分配的临时端口）；L0 集成测试按随机端口
   * 打真实 loopback（spec §10）与部署探活用，只读派生自 server.address()。
   */
  readonly port: number;
  /** 停止接受新连接 → 对每条连接发 error INTERNAL 后关闭 → 等待 flush → 关闭 HTTP 与存储 */
  stop(): Promise<void>;
  /**
   * §7 备份运维接缝：VACUUM INTO 一致性快照到 toPath（目标文件必须不存在）。
   * 仅缺省装配的 SqliteDeviceStore 支持；注入的 DeviceStore 未提供 backup 能力时抛错不伪造。
   */
  backupDevices(toPath: string): void;
}

export async function createRelayServer(
  options: CreateRelayServerOptions,
): Promise<RelayV2ServerHandle> {
  const config = options.config;
  const auth: JwtAuth | undefined =
    options.auth ?? (options.users === undefined ? undefined : createStubJwtAuth(options.users));
  if (auth === undefined) {
    throw new Error("createRelayServer 需要 auth 或 users 之一（spec §6.2/§12 M1）");
  }
  const logger =
    options.logger ??
    createRelayLogger({ level: config.logLevel, trace: config.msgTrace, scope: "relay-v2" });
  const now = options.now ?? ((): number => Date.now());
  const tokens = options.tokens ?? createTokenStore({ now });
  const ownsDevices = options.devices === undefined;
  const devices = options.devices ?? createSqliteDeviceStore({ dbPath: config.dbPath, now });
  const registry =
    options.registry ?? createPairingRegistry(createPairingRegistryEvents({ logger, now }));
  const gateway = createWsGateway({ config, logger, tokens, devices, registry, now });
  const handleRequest = createHttpApi({
    config,
    logger,
    auth,
    tokens,
    devices,
    registry,
    connectionCount: () => gateway.connectionCount(),
    ownerCount: () => gateway.ownerCount(),
    onlineDeviceMeta: (deviceSid) => gateway.onlineDeviceMeta(deviceSid),
    // 注入的 DeviceStore 接口不携带计数（具体存储类型才有，见 devices.ts count）
    deviceCount: () => (ownsDevices ? (devices as SqliteDeviceStore).count() : null),
    trafficCounters: () => gateway.trafficCounters(),
  });

  const server = createServer(handleRequest);
  server.on("upgrade", (request, socket, head) => {
    gateway.handleUpgrade(request, socket, head);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(config.listenPort, config.bindHost, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  server.on("error", (error: Error) => {
    logger.error("server-error", { message: error.message });
  });
  logger.info("relay-listening", { bind_host: config.bindHost, port: config.listenPort });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("relay-v2-server 未能取得 loopback 监听端口");
  }

  // §7 设备 GC：每日一次删除 created_at 早于 DEVICE_TTL_DAYS 且当前离线的行（在线行跳过下轮再试）。
  // 在线事实在内存 PairingRegistry，SQL 里不可得，isOnline 直接委托 registry join（spec §4/§7）；
  // collectExpired 由 DeviceStore 接口提供（注入的存储同样必须支持）。失败不中断服务，下轮再试。
  const gcIntervalMs = options.gcIntervalMs ?? 24 * 60 * 60 * 1000;
  const runDeviceGc = (): void => {
    try {
      const cutoffSeconds = Math.floor(now() / 1000) - config.deviceTtlDays * 86_400;
      const removed = devices.collectExpired(cutoffSeconds, (deviceSid) =>
        registry.isDeviceOnline(deviceSid),
      );
      logger.info("device-gc", { removed, cutoff_seconds: cutoffSeconds });
    } catch (error) {
      logger.error("device-gc-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const gcTimer = setInterval(runDeviceGc, gcIntervalMs);

  // stop 幂等：重复调用复用同一次停机（server.close 在已停实例上会抛 ERR_SERVER_NOT_RUNNING）
  let stopPromise: Promise<void> | undefined;
  return {
    port: address.port,
    backupDevices(toPath: string): void {
      // §7 备份：能力可选（DeviceStore.backup?），未提供时抛错而非伪造成功——备份失败
      // 必须显性暴露给运维接缝调用方，静默「成功」等于没有备份。
      const store = devices as SqliteDeviceStore;
      if (typeof store.backup !== "function") {
        throw new Error(
          "注入的 DeviceStore 不支持 backup（spec §7：仅 SqliteDeviceStore 提供备份）",
        );
      }
      store.backup(toPath);
      logger.info("device-backup", { target: toPath });
    },
    stop(): Promise<void> {
      stopPromise ??= (async () => {
        clearInterval(gcTimer);
        // §5.3：停收新连接由 gateway 的 stopped 标志 + server.close 完成；先等 WS 侧 INTERNAL→关闭→flush
        await gateway.stop();
        // 释放 HTTP keep-alive 空闲连接，让 close 回调及时完成（fake relay 同款收尾）
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        if (ownsDevices) (devices as SqliteDeviceStore).close();
        logger.info("relay-stopped", {});
      })();
      return stopPromise;
    },
  };
}

export { loadConfigFromEnv } from "./config.js";
export type { RelayConfig, RelayJwtMode, RelayJwtRealmMode } from "./config.js";
export { createRelayLogger } from "./logger.js";
export type { RelayLogLevel, RelayLogger, RelayMessageTraceFields } from "./logger.js";
export type {
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
} from "./types.js";
export type {
  WebRemoteControlRelayV2Device,
  WebRemoteControlRelayV2ErrorCode,
  WebRemoteControlRelayV2IncomingMessage,
  WebRemoteControlRelayV2Meta,
  WebRemoteControlRelayV2OutgoingMessage,
  WebRemoteControlRelayV2PairStatus,
  WebRemoteControlRelayV2Role,
} from "./types.js";
export { createJwtAuth, createStubJwtAuth } from "./auth.js";
