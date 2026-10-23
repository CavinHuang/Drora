// Relay V2 服务端配置（specs/relay-v2-server.md §9 全部配置项与默认值）。
// 解析一律容错：非法值回退默认值而非抛错——单个环境变量误配不应让反代后的整个
// 服务起不来（spec §9）。本模块只解析、不落日志：发生回退的键记录在返回值的
// fallbacks 字段（仅键名与回退默认值，绝不携带原始值——原始值可能是凭据类配置），
// 由装配层 src/index.ts 的 createRelayServer 统一转为 warn 结构化日志，spec §9
// 「错误取值经结构化日志观察」由该链路兑现，回退不是静默的。
// 唯一例外：JWT_MODE 非法值（含大小写不符）启动即报错——静默回退 decode 等于把
// 多用户生产模式悄悄降级为不验签模式（例外已登记进 spec §9）。

import type { RelayLogLevel } from "./logger.js";

/** stub（spec §12 M1）仅测试/进程级冒烟可用：不校验任何凭据，生产禁用（spec §9） */
export type RelayJwtMode = "decode" | "introspect" | "jwks" | "stub";
// realm 命名空间来源（spec §6.3）：iss 从 JWT payload 推导；explicit 使用显式 JWT_REALM。
export type RelayJwtRealmMode = "iss" | "explicit";

/** 配置回退通知：仅键名与回退默认值（字符串化），不携带原始值（防凭据类值进日志） */
export interface ConfigFallbackNotice {
  key: string;
  fallback: string;
}

export interface RelayConfig {
  /** BIND_HOST：明文监听地址；唯一预期客户端是本机反代（默认 127.0.0.1，spec §2） */
  bindHost: string;
  /** LISTEN_PORT：明文 HTTP/WS，TLS 由反代终止（默认 8080） */
  listenPort: number;
  /** DB_PATH：SQLite 设备注册表文件（默认 ./relay-v2.db） */
  dbPath: string;
  /** JWT_MODE：JWT→userId 映射模式（默认 decode；M0 实测后定案，spec §6.1/§6.2；stub 仅测试/冒烟） */
  jwtMode: RelayJwtMode;
  /** JWT_ID_CLAIMS：身份 claim 回退链（默认 ["sub","id"]，镜像客户端 userinfo 的 sub ?? id 先例） */
  jwtIdClaims: string[];
  /**
   * JWT_STUB_USERS：stub 模式的 JWT→userId 映射（JSON 对象）。仅测试/进程级冒烟（spec §9）：
   * 让 dist 产物可以不经代码注入、纯经环境变量完成 stub 鉴权装配（tools/smoke-process.mjs）。
   */
  jwtStubUsers?: Record<string, string>;
  /** JWT_REALM_MODE：realm 命名空间来源（默认 iss，spec §6.3） */
  jwtRealmMode: RelayJwtRealmMode;
  /** JWT_REALM：显式 realm 值（仅 jwtRealmMode=explicit 时消费，如 "zai"；spec §6.3） */
  jwtRealm?: string;
  /** INTROSPECT_URL：introspect 模式的用户信息端点（该模式必填，装配层校验） */
  introspectUrl?: string;
  /** JWT_JWKS_URL：jwks 模式的 JWKS 端点（该模式必填，装配层校验） */
  jwtJwksUrl?: string;
  /** JWT_ISSUERS：jwks 模式 iss 白名单（逗号分隔） */
  jwtIssuers?: string[];
  /** JWT_AUDIENCE：jwks 模式 aud 校验值 */
  jwtAudience?: string;
  /** AUTH_TIMEOUT_MS：未认证连接关闭时限（默认 15000，spec §5.3） */
  authTimeoutMs: number;
  /** IDLE_TIMEOUT_MS：已认证连接 idle 关闭时限（默认 120000，spec §5.3） */
  idleTimeoutMs: number;
  /** DEVICE_TTL_DAYS：离线设备 GC 阈值（默认 180，spec §7） */
  deviceTtlDays: number;
  /** CORS_ENABLED：同源生产默认关；L1 联调与浏览器测试开启（默认 false，spec §5.1） */
  corsEnabled: boolean;
  /** LOG_LEVEL：结构化日志分级（默认 info，spec §9） */
  logLevel: RelayLogLevel;
  /** MSG_TRACE：消息级 trace 总开关，生产默认关（spec §9 红线） */
  msgTrace: boolean;
  /**
   * 非法值回退记录（spec §9「错误取值经结构化日志观察」）：loadConfigFromEnv 在某个
   * 非空 env 值未通过校验而回退默认值时记录该键，装配层（src/index.ts）据此发 warn。
   * 仅 loadConfigFromEnv 产出；无回退时字段整体缺省，程序化构造的 config（测试注入）
   * 不受影响，纯默认 config 仍可整体相等比较。
   */
  fallbacks?: readonly ConfigFallbackNotice[];
}

const JWT_MODES: readonly RelayJwtMode[] = ["decode", "introspect", "jwks", "stub"];
const REALM_MODES: readonly RelayJwtRealmMode[] = ["iss", "explicit"];
const LOG_LEVELS: readonly RelayLogLevel[] = ["debug", "info", "warn", "error"];

/**
 * 回退通知回调（spec §9 可观测）：仅「非空值存在但未通过校验」时调用——空白值按未提供
 * 处理不算回退，合法值恰好等于默认值也不算。
 */
type NotifyFallback = (fallback: string) => void;

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  notify?: NotifyFallback,
): T {
  const trimmed = value?.trim();
  if (trimmed !== undefined && trimmed.length > 0 && allowed.includes(trimmed as T)) {
    return trimmed as T;
  }
  if (trimmed !== undefined && trimmed.length > 0) notify?.(fallback);
  return fallback;
}

/**
 * JWT_MODE 专用严格枚举：非法值（含大小写不符，如 JWKS）抛错而非回退。
 * 其余键走 readEnum 容错；此处不容错的原因：静默回退 decode = 鉴权模式被悄悄降级为
 * 不验签（spec §9 登记的容错策略唯一例外），与 auth.ts 装配期「配错启动即失败」同策略。
 */
function readJwtMode(value: string | undefined): RelayJwtMode {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return "decode";
  if ((JWT_MODES as readonly string[]).includes(trimmed)) return trimmed as RelayJwtMode;
  throw new Error(
    `JWT_MODE 非法值 "${trimmed}"（合法：${JWT_MODES.join(" | ")}）。` +
      "不静默回退：误配会静默降级到不验签的 decode（spec §9）",
  );
}

function readInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  notify?: NotifyFallback,
): number {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    notify?.(String(fallback));
    return fallback;
  }
  return parsed;
}

function readBool(value: string | undefined, fallback: boolean, notify?: NotifyFallback): boolean {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === "1" || trimmed === "true") return true;
  if (trimmed === "0" || trimmed === "false") return false;
  if (trimmed !== undefined && trimmed.length > 0) notify?.(String(fallback));
  return fallback;
}

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : fallback;
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** 逗号分隔列表；剔除空白项，全空视为未提供 */
function readList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** JWT_STUB_USERS：JSON 对象且值全为字符串才接受；其余（含非法 JSON/数组/数字值）按未提供 */
function readJsonObject(
  value: string | undefined,
  notify?: NotifyFallback,
): Record<string, string> | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      notify?.("(omitted)");
      return undefined;
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, item]) => typeof item !== "string")) {
      notify?.("(omitted)");
      return undefined;
    }
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    notify?.("(omitted)");
    return undefined;
  }
}

export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): RelayConfig {
  const fallbacks: ConfigFallbackNotice[] = [];
  // 仅记录键名与回退默认值；原始值一律不进记录（JWT_STUB_USERS 等键的原始值形同凭据）
  const notice = (key: string) => (fallback: string) => {
    fallbacks.push({ key, fallback });
  };
  const jwtIdClaims = readList(env.JWT_ID_CLAIMS);
  const jwtIssuers = readList(env.JWT_ISSUERS);
  const jwtRealm = readOptionalString(env.JWT_REALM);
  const config: RelayConfig = {
    bindHost: readString(env.BIND_HOST, "127.0.0.1"),
    listenPort: readInt(env.LISTEN_PORT, 8080, 1, 65_535, notice("LISTEN_PORT")),
    dbPath: readString(env.DB_PATH, "./relay-v2.db"),
    jwtMode: readJwtMode(env.JWT_MODE),
    jwtIdClaims: jwtIdClaims.length > 0 ? jwtIdClaims : ["sub", "id"],
    jwtStubUsers: readJsonObject(env.JWT_STUB_USERS, notice("JWT_STUB_USERS")),
    jwtRealmMode: readEnum(env.JWT_REALM_MODE, REALM_MODES, "iss", notice("JWT_REALM_MODE")),
    ...(jwtRealm === undefined ? {} : { jwtRealm }),
    introspectUrl: readOptionalString(env.INTROSPECT_URL),
    jwtJwksUrl: readOptionalString(env.JWT_JWKS_URL),
    jwtIssuers: jwtIssuers.length > 0 ? jwtIssuers : undefined,
    jwtAudience: readOptionalString(env.JWT_AUDIENCE),
    authTimeoutMs: readInt(
      env.AUTH_TIMEOUT_MS,
      15_000,
      1,
      Number.MAX_SAFE_INTEGER,
      notice("AUTH_TIMEOUT_MS"),
    ),
    idleTimeoutMs: readInt(
      env.IDLE_TIMEOUT_MS,
      120_000,
      1,
      Number.MAX_SAFE_INTEGER,
      notice("IDLE_TIMEOUT_MS"),
    ),
    deviceTtlDays: readInt(env.DEVICE_TTL_DAYS, 180, 1, 365_000, notice("DEVICE_TTL_DAYS")),
    corsEnabled: readBool(env.CORS_ENABLED, false, notice("CORS_ENABLED")),
    logLevel: readEnum(env.LOG_LEVEL, LOG_LEVELS, "info", notice("LOG_LEVEL")),
    msgTrace: readBool(env.MSG_TRACE, false, notice("MSG_TRACE")),
  };
  // 无回退时字段整体缺省：纯默认 config 保持可整体相等比较（config.test.ts toEqual 契约）
  return fallbacks.length > 0 ? { ...config, fallbacks } : config;
}
