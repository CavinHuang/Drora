// L0 契约一致性套件共用装配（specs/relay-v2-server.md §10）。
// 把可执行参照 packages/shared/test/fixtures/fake-relay-v2.ts 的行为场景改写为打真实
// loopback 的集成测试：createRelayServer 绑定 127.0.0.1 随机端口（listenPort=0，经
// handle.port 取回）、stub users 映射（fake relay 同款 users 选项，spec §12 M1）、
// DB 缺省 :memory:、持久化/超时场景用临时目录 DB 与配小的 AUTH/IDLE_TIMEOUT_MS。
// 红线：stub JWT 与一次性 token 是测试凭据，不写日志、不进断言输出（spec §9）。

import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { expect } from "vitest";
import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
} from "@drora/shared/web-remote-relay";
import { createRelayServer, type RelayV2ServerHandle } from "../src/index.js";
import { createTokenStore } from "../src/tokens.js";
import type { RelayConfig } from "../src/config.js";
import type { RelayLogger } from "../src/logger.js";
import type { DeviceStore, JwtAuth, TokenStore } from "../src/types.js";

/** stub JWT → userId 映射（fake relay 同款双账号，供跨用户隔离用例） */
export const USERS = { "jwt-alice": "alice", "jwt-bob": "bob" } as const;
export const JWT_ALICE = "jwt-alice";
export const JWT_BOB = "jwt-bob";

export const PATHS = WEB_REMOTE_CONTROL_RELAY_V2_HTTP;

/** WS 客户端事件：按到达顺序留存，供「error 先于 close」等顺序断言（spec §6.4/§6.5） */
export type WsEvent =
  | { kind: "message"; message: Record<string, unknown> }
  | { kind: "close"; code: number };

export interface RelayClient {
  ws: WebSocket;
  events: WsEvent[];
  send(message: unknown): void;
  /** 原始文本帧：非法 JSON / 超限帧用 */
  sendRaw(text: string): void;
  sendBinary(data: Buffer): void;
  /** 连接关闭时 resolve 关闭码 */
  closed: Promise<number>;
  /** 有序屏障：发协议 ping 并等 pong，证明此前收到的消息已全部到齐（fake relay 测试同款） */
  pingBarrier(): Promise<void>;
}

export interface StartedRelay {
  port: number;
  httpUrl: string;
  wsUrl: string;
  handle: RelayV2ServerHandle;
  dbPath: string;
}

export interface StartRelayOptions {
  /** SQLite 文件路径；缺省 :memory:。持久化用例传 tempDbPath() 产物 */
  dbPath?: string;
  /** 注入可对时的 TokenStore（过期 token 用例用）；缺省内部构造 */
  tokens?: TokenStore;
  /** 注入装配好的 JwtAuth（realm 隔离等真实鉴权用例用）；缺省 stub users 映射 */
  auth?: JwtAuth;
  /** 注入 DeviceStore（backup 能力缺失路径用例用）；缺省按 dbPath 构造 SQLite 存储 */
  devices?: DeviceStore;
  authTimeoutMs?: number;
  idleTimeoutMs?: number;
  corsEnabled?: boolean;
  /** 注入时钟（GC 对时用例：控制 created_at 与 GC cutoff 同一时间线）；缺省 Date.now */
  now?: () => number;
  /** 设备 GC 调度间隔毫秒（spec §7 生产每日一次）；GC 用例配小观察多轮 tick */
  gcIntervalMs?: number;
  /** 注入结构化日志（GC 日志断言用）；缺省 error 级静默正常路径输出 */
  logger?: RelayLogger;
}

const started: StartedRelay[] = [];
const tempDirs = new Set<string>();

/** 临时目录内的持久 DB 文件路径；目录登记进 afterEach 清理集 */
export async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "relay-v2-l0-"));
  tempDirs.add(dir);
  return join(dir, "devices.sqlite");
}

/** 可对时的真实 TokenStore（过期 token 用例）：语义与生产一致，仅时钟可控 */
export function createTokenStoreForTest(now: () => number): TokenStore {
  return createTokenStore({ now });
}

export async function startRelay(options: StartRelayOptions = {}): Promise<StartedRelay> {
  const dbPath = options.dbPath ?? ":memory:";
  const config: RelayConfig = {
    bindHost: "127.0.0.1",
    listenPort: 0, // 随机端口由内核分配，句柄 port 字段取回（spec §10 L0 集成面）
    dbPath,
    jwtMode: "decode", // stub users 装配下不消费 decode 逻辑，仅满足配置形状
    jwtIdClaims: ["sub", "id"],
    jwtRealmMode: "iss",
    authTimeoutMs: options.authTimeoutMs ?? 15_000,
    idleTimeoutMs: options.idleTimeoutMs ?? 120_000,
    deviceTtlDays: 180,
    corsEnabled: options.corsEnabled ?? false,
    // L0 断言行为不依赖日志；error 级静默正常路径输出（红线：凭据本就不允许落日志）
    logLevel: "error",
    msgTrace: false,
  };
  const handle = await createRelayServer({
    config,
    users: USERS,
    ...(options.tokens === undefined ? {} : { tokens: options.tokens }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.devices === undefined ? {} : { devices: options.devices }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.gcIntervalMs === undefined ? {} : { gcIntervalMs: options.gcIntervalMs }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  const relay: StartedRelay = {
    port: handle.port,
    httpUrl: `http://127.0.0.1:${handle.port}`,
    wsUrl: `ws://127.0.0.1:${handle.port}${WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH}`,
    handle,
    dbPath,
  };
  started.push(relay);
  return relay;
}

/** afterEach 统一收尾：停掉本用例起的全部 relay（stop 幂等），清理临时 DB 目录 */
export async function closeStartedRelays(): Promise<void> {
  const pending = started.splice(0);
  await Promise.allSettled(pending.map((relay) => relay.handle.stop()));
  const dirs = [...tempDirs];
  tempDirs.clear();
  await Promise.allSettled(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

export interface HttpResult {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface ApiInit {
  method?: "GET" | "POST" | "OPTIONS";
  body?: unknown;
  /** 原始请求体（非法 JSON 用例用）；优先于 body */
  rawBody?: string;
  jwt?: string;
  headers?: Record<string, string>;
}

export async function api(
  relay: StartedRelay,
  path: string,
  init: ApiInit = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.jwt !== undefined) headers.Authorization = `Bearer ${init.jwt}`;
  const hasBody = init.rawBody !== undefined || init.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const response = await fetch(`${relay.httpUrl}${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers,
    body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text.length === 0 ? undefined : (JSON.parse(text) as unknown),
  };
}

export async function registerDevice(
  relay: StartedRelay,
  deviceMid: string,
  jwt: string = JWT_ALICE,
): Promise<{ sid: string; createdAt: number }> {
  const result = await api(relay, PATHS.register.path, { body: { device_mid: deviceMid }, jwt });
  expect(result.status).toBe(200);
  const data = (result.body as { data?: { device_sid?: string; created_at?: number } }).data;
  expect(typeof data?.device_sid).toBe("string");
  return { sid: data?.device_sid as string, createdAt: data?.created_at as number };
}

/** 签发一次性 token；顺带钉住 no-store 响应头（spec §5.1 规则 2） */
export async function issueToken(
  relay: StartedRelay,
  role: "device" | "terminal",
  jwt: string = JWT_ALICE,
): Promise<string> {
  const result = await api(relay, PATHS.token.path, { body: { role }, jwt });
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(result.status).toBe(200);
  return (result.body as { data: { token: string } }).data.token;
}

function createClient(ws: WebSocket): RelayClient {
  const events: WsEvent[] = [];
  let resolveClosed!: (code: number) => void;
  const closed = new Promise<number>((resolve) => {
    resolveClosed = resolve;
  });
  // 服务端 terminate 等异常断开在 ws 客户端会走 error 事件；挂空 handler 防未处理异常
  ws.on("error", () => {});
  ws.on("message", (data) => {
    events.push({
      kind: "message",
      message: JSON.parse(data.toString()) as Record<string, unknown>,
    });
  });
  ws.on("close", (code) => {
    events.push({ kind: "close", code });
    resolveClosed(code);
  });
  return {
    ws,
    events,
    send: (message) => ws.send(JSON.stringify(message)),
    sendRaw: (text) => ws.send(text),
    sendBinary: (data) => ws.send(data),
    closed,
    pingBarrier: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState !== WebSocket.OPEN) {
          resolve();
          return;
        }
        ws.once("pong", () => resolve());
        try {
          ws.ping();
        } catch {
          resolve();
        }
      }),
  };
}

export async function openClient(relay: StartedRelay, token: string): Promise<RelayClient> {
  const ws = new WebSocket(`${relay.wsUrl}?token=${encodeURIComponent(token)}`);
  const client = createClient(ws);
  await once(ws, "open");
  return client;
}

/** 升级被 401 原始应答拒绝（token 缺失/未知/过期/复用/路径错误，spec §5.2 规则 1） */
export async function expectUpgradeUnauthorized(url: string): Promise<void> {
  const ws = new WebSocket(url);
  try {
    const error = await new Promise<Error>((resolve, reject) => {
      ws.once("error", resolve);
      ws.once("open", () => reject(new Error("升级不应成功")));
    });
    expect(error.message).toContain("401");
  } finally {
    ws.terminate();
  }
}

/** 连接 + auth_init 并等到 auth_ack（fake relay 测试的 authenticate 同款） */
export async function authAndAck(
  relay: StartedRelay,
  sid: string,
  role: "device" | "terminal",
  jwt: string = JWT_ALICE,
): Promise<RelayClient> {
  const client = await openClient(relay, await issueToken(relay, role, jwt));
  client.send({
    type: "auth_init",
    device_sid: sid,
    meta: { name: role },
    client_ts: 1_700_000_000,
  });
  await expect
    .poll(
      () =>
        client.events.some(
          (event) => event.kind === "message" && event.message.type === "auth_ack",
        ),
      {
        timeout: 2_000,
        interval: 20,
      },
    )
    .toBe(true);
  return client;
}

export function messages(client: RelayClient): Array<Record<string, unknown>> {
  return client.events.flatMap((event) => (event.kind === "message" ? [event.message] : []));
}

/** Unix 秒断言：整数且贴近当前时间（毫秒值必然远超容差，即契约的「拒绝毫秒」反面） */
export function expectUnixSeconds(value: unknown): void {
  expect(typeof value).toBe("number");
  const seconds = value as number;
  expect(Number.isInteger(seconds)).toBe(true);
  expect(Math.abs(seconds - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5);
}
