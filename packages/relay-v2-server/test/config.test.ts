// loadConfigFromEnv 的容错解析与 spec §9 默认值回归（AGENTS：行为改动先补测试）。

import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("空环境返回 spec §9 全部默认值", () => {
    expect(loadConfigFromEnv({})).toEqual({
      bindHost: "127.0.0.1",
      listenPort: 8080,
      dbPath: "./relay-v2.db",
      jwtMode: "decode",
      jwtIdClaims: ["sub", "id"],
      jwtRealmMode: "iss",
      introspectUrl: undefined,
      jwtJwksUrl: undefined,
      jwtIssuers: undefined,
      jwtAudience: undefined,
      authTimeoutMs: 15_000,
      idleTimeoutMs: 120_000,
      deviceTtlDays: 180,
      corsEnabled: false,
      logLevel: "info",
      msgTrace: false,
    });
  });

  it("合法值逐一透传", () => {
    const config = loadConfigFromEnv({
      BIND_HOST: "0.0.0.0",
      LISTEN_PORT: "9443",
      DB_PATH: "/var/lib/relay/v2.db",
      JWT_MODE: "jwks",
      JWT_ID_CLAIMS: "uid, email",
      JWT_REALM_MODE: "explicit",
      JWT_REALM: "zai",
      INTROSPECT_URL: "https://api.example.com/userinfo",
      JWT_JWKS_URL: "https://api.example.com/.well-known/jwks.json",
      JWT_ISSUERS: "https://a.example.com, https://b.example.com",
      JWT_AUDIENCE: "drora",
      AUTH_TIMEOUT_MS: "8000",
      IDLE_TIMEOUT_MS: "60000",
      DEVICE_TTL_DAYS: "30",
      CORS_ENABLED: "true",
      LOG_LEVEL: "debug",
      MSG_TRACE: "1",
    });
    expect(config).toEqual({
      bindHost: "0.0.0.0",
      listenPort: 9443,
      dbPath: "/var/lib/relay/v2.db",
      jwtMode: "jwks",
      jwtIdClaims: ["uid", "email"],
      jwtRealmMode: "explicit",
      jwtRealm: "zai",
      introspectUrl: "https://api.example.com/userinfo",
      jwtJwksUrl: "https://api.example.com/.well-known/jwks.json",
      jwtIssuers: ["https://a.example.com", "https://b.example.com"],
      jwtAudience: "drora",
      authTimeoutMs: 8000,
      idleTimeoutMs: 60000,
      deviceTtlDays: 30,
      corsEnabled: true,
      logLevel: "debug",
      msgTrace: true,
    });
  });

  it("JWT_MODE 非法值（含大小写不符）启动即报错，不静默回退 decode（spec §9 例外）；缺省仍为 decode", () => {
    expect(() => loadConfigFromEnv({ JWT_MODE: "bearer" })).toThrow(/JWT_MODE/);
    // 典型陷阱：.env 写大写 JWKS，旧容错策略会静默跑在不验签 decode 上
    expect(() => loadConfigFromEnv({ JWT_MODE: "JWKS" })).toThrow(/JWKS/);
    expect(loadConfigFromEnv({}).jwtMode).toBe("decode");
    expect(loadConfigFromEnv({ JWT_MODE: "  " }).jwtMode).toBe("decode");
  });

  it("非法枚举回退默认：JWT_REALM_MODE / LOG_LEVEL（容错策略仍适用于非鉴权模式键）", () => {
    const config = loadConfigFromEnv({
      JWT_REALM_MODE: "static",
      LOG_LEVEL: "verbose",
    });
    expect(config.jwtRealmMode).toBe("iss");
    expect(config.logLevel).toBe("info");
  });

  it("JWT_MODE=stub：JWT_STUB_USERS 解析为映射对象；非法 JSON/非字符串值按未提供（spec §9）", () => {
    const config = loadConfigFromEnv({ JWT_MODE: "stub", JWT_STUB_USERS: '{"jwt-a":"user-a"}' });
    expect(config.jwtMode).toBe("stub");
    expect(config.jwtStubUsers).toEqual({ "jwt-a": "user-a" });
    expect(loadConfigFromEnv({ JWT_STUB_USERS: "not-json" }).jwtStubUsers).toBeUndefined();
    expect(loadConfigFromEnv({ JWT_STUB_USERS: '["a"]' }).jwtStubUsers).toBeUndefined();
    expect(loadConfigFromEnv({ JWT_STUB_USERS: '{"a":1}' }).jwtStubUsers).toBeUndefined();
    expect(loadConfigFromEnv({ JWT_STUB_USERS: "  " }).jwtStubUsers).toBeUndefined();
  });

  it("非法数值回退默认：非数字、越界与非正数", () => {
    const config = loadConfigFromEnv({
      LISTEN_PORT: "not-a-port",
      AUTH_TIMEOUT_MS: "soon",
      IDLE_TIMEOUT_MS: "0",
      DEVICE_TTL_DAYS: "-1",
    });
    expect(config.listenPort).toBe(8080);
    expect(config.authTimeoutMs).toBe(15_000);
    expect(config.idleTimeoutMs).toBe(120_000);
    expect(config.deviceTtlDays).toBe(180);
  });

  it("端口超出 1..65535 回退默认", () => {
    expect(loadConfigFromEnv({ LISTEN_PORT: "70000" }).listenPort).toBe(8080);
    expect(loadConfigFromEnv({ LISTEN_PORT: "0" }).listenPort).toBe(8080);
    expect(loadConfigFromEnv({ LISTEN_PORT: "65535" }).listenPort).toBe(65_535);
  });

  it("布尔解析只认 1/true/0/false，其余回退默认", () => {
    expect(loadConfigFromEnv({ CORS_ENABLED: "yes" }).corsEnabled).toBe(false);
    expect(loadConfigFromEnv({ CORS_ENABLED: "1" }).corsEnabled).toBe(true);
    expect(loadConfigFromEnv({ MSG_TRACE: "0" }).msgTrace).toBe(false);
    expect(loadConfigFromEnv({ MSG_TRACE: "TRUE" }).msgTrace).toBe(true);
  });

  it("claim/issuer 列表剔除空白项，全空回退默认或缺省", () => {
    expect(loadConfigFromEnv({ JWT_ID_CLAIMS: " , uid , " }).jwtIdClaims).toEqual(["uid"]);
    expect(loadConfigFromEnv({ JWT_ID_CLAIMS: "  " }).jwtIdClaims).toEqual(["sub", "id"]);
    expect(loadConfigFromEnv({ JWT_ISSUERS: " https://a , ," }).jwtIssuers).toEqual(["https://a"]);
    expect(loadConfigFromEnv({ JWT_ISSUERS: "" }).jwtIssuers).toBeUndefined();
  });

  it("空白值按未提供处理", () => {
    const config = loadConfigFromEnv({ BIND_HOST: "   ", DB_PATH: "", JWT_REALM: " " });
    expect(config.bindHost).toBe("127.0.0.1");
    expect(config.dbPath).toBe("./relay-v2.db");
    expect(config.jwtRealm).toBeUndefined();
  });
});
