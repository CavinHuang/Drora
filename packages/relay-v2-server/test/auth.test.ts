// JWT→userId 映射单测（specs/relay-v2-server.md §6.2/§6.3/§9/§10 L0）。
// 覆盖：stub 映射（含原型链键拒绝）、装配期必填校验、decode 回退链/空串拒绝/exp 过期/
// realm 前缀（iss 推导与 explicit）与分隔符 fail-closed、三态分类（评审 auth-three-state：
// introspect 网络/非 2xx → upstream-unavailable；凭据问题 → credentials-invalid；decode/
// jwks/stub 恒不产生 unavailable）、introspect（Bearer 透传/{data} 解包/端点是 exp 权威）、
// jwks（RS256/ES256 验签、kid 选择、iss/aud 白名单）、真实 loopback 的
// realm 隔离（同 sub 不同 iss → 不同 owner 域，spec §10 L0「跨用户隔离（含 realm 隔离）」）。
// 测试 JWT 与 JWKS 全部本用例自造，不落日志（spec §9 红线）。

import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createJwtAuth, createStubJwtAuth } from "../src/auth.js";
import type { RelayConfig } from "../src/config.js";
import type { JwtAuthResult } from "../src/types.js";
import { api, closeStartedRelays, PATHS, registerDevice, startRelay } from "./helpers.js";

afterEach(closeStartedRelays);

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** 三态结果字面量构造（评审 auth-three-state）：避免逐处内联对象 */
const ok = (userId: string): JwtAuthResult => ({ status: "ok", userId });
const invalid: JwtAuthResult = { status: "credentials-invalid" };
const unavailable: JwtAuthResult = { status: "upstream-unavailable" };

const b64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** 测试 JWT：decode/introspect 模式不验签，第三段占位即可；jwks 用例自拼真签名 */
function makeJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "none", typ: "JWT" },
): string {
  return `${b64url(header)}.${b64url(payload)}.sig`;
}

function baseConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    bindHost: "127.0.0.1",
    listenPort: 0,
    dbPath: ":memory:",
    jwtMode: "decode",
    jwtIdClaims: ["sub", "id"],
    jwtRealmMode: "iss",
    authTimeoutMs: 15_000,
    idleTimeoutMs: 120_000,
    deviceTtlDays: 180,
    corsEnabled: false,
    logLevel: "error",
    msgTrace: false,
    ...overrides,
  };
}

/** 注入 fetch 桩：记录调用并回固定响应（introspect/jwks 用例） */
function fetchStub(respond: (url: string, authorization: string | undefined) => Response): {
  fetch: typeof fetch;
  calls: Array<{ url: string; authorization: string | undefined }>;
} {
  const calls: Array<{ url: string; authorization: string | undefined }> = [];
  // @types/node 无 DOM 的 RequestInfo 全局类型；与 typeof fetch 的首参形状一致
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization =
      init?.headers === undefined
        ? undefined
        : (new Headers(init.headers).get("authorization") ?? undefined);
    calls.push({ url, authorization });
    return respond(url, authorization);
  }) as unknown as typeof fetch;
  return { fetch: stub, calls };
}

describe("createStubJwtAuth（spec §12 M1，fake relay 同款 users 选项）", () => {
  it("映射命中返回 ok(userId)；缺失 Bearer/未知 JWT/非 Bearer 前缀一律 credentials-invalid", async () => {
    const auth = createStubJwtAuth({ "jwt-alice": "alice" });
    await expect(auth.authenticate("Bearer jwt-alice")).resolves.toEqual(ok("alice"));
    await expect(auth.authenticate("Bearer jwt-unknown")).resolves.toEqual(invalid);
    await expect(auth.authenticate(undefined)).resolves.toEqual(invalid);
    await expect(auth.authenticate("jwt-alice")).resolves.toEqual(invalid);
    await expect(auth.authenticate("Basic jwt-alice")).resolves.toEqual(invalid);
  });

  it("原型链键（如 constructor）不参与映射（Object.hasOwn 防线）", async () => {
    const auth = createStubJwtAuth({ "jwt-alice": "alice" });
    await expect(auth.authenticate("Bearer constructor")).resolves.toEqual(invalid);
    await expect(auth.authenticate("Bearer toString")).resolves.toEqual(invalid);
  });
});

describe("createJwtAuth 装配期校验（spec §9「对应模式必填」，配错启动即失败）", () => {
  it("stub 缺 JWT_STUB_USERS 报错", () => {
    expect(() => createJwtAuth({ config: baseConfig({ jwtMode: "stub" }) })).toThrow(
      /JWT_STUB_USERS/,
    );
  });

  it("introspect 缺 INTROSPECT_URL、jwks 缺 JWT_JWKS_URL 报错", () => {
    expect(() => createJwtAuth({ config: baseConfig({ jwtMode: "introspect" }) })).toThrow(
      /INTROSPECT_URL/,
    );
    expect(() => createJwtAuth({ config: baseConfig({ jwtMode: "jwks" }) })).toThrow(
      /JWT_JWKS_URL/,
    );
  });

  it("jwks 缺 JWT_ISSUERS / JWT_AUDIENCE 装配即报错（漏配会静默放行任意 issuer/audience，spec §9）", () => {
    const withUrlOnly = baseConfig({
      jwtMode: "jwks",
      jwtJwksUrl: "https://auth.example/jwks.json",
    });
    expect(() => createJwtAuth({ config: withUrlOnly })).toThrow(/JWT_ISSUERS/);
    expect(() =>
      createJwtAuth({
        config: {
          ...withUrlOnly,
          jwtIssuers: ["https://issuer.example"],
        },
      }),
    ).toThrow(/JWT_AUDIENCE/);
  });

  it("explicit realm 缺 JWT_REALM 报错；带 JWT_REALM 装配成功且 iss 缺失也可映射", async () => {
    const config = baseConfig({ jwtRealmMode: "explicit" });
    expect(() => createJwtAuth({ config })).toThrow(/JWT_REALM/);
    const auth = createJwtAuth({
      config: baseConfig({ jwtRealmMode: "explicit", jwtRealm: "zai" }),
      now: () => NOW_MS,
    });
    await expect(auth.authenticate(`Bearer ${makeJwt({ sub: "alice" })}`)).resolves.toEqual(
      ok("zai:alice"),
    );
  });
});

describe("decode 模式（spec §6.2：本地解 payload，不验签）", () => {
  it("身份取 sub 并按 iss 推导 realm 前缀（§6.3）", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    const jwt = makeJwt({ sub: "alice", iss: "https://auth.zai.example" });
    await expect(auth.authenticate(`Bearer ${jwt}`)).resolves.toEqual(
      ok("https://auth.zai.example:alice"),
    );
  });

  it("身份 claim 回退链：sub 空串落到 id（空串不取，防退化 realm 命名空间）；全缺拒绝", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "", id: "42", iss: "https://a" })}`),
    ).resolves.toEqual(ok("https://a:42"));
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "", id: "", iss: "https://a" })}`),
    ).resolves.toEqual(invalid);
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ iss: "https://a" })}`),
    ).resolves.toEqual(invalid);
  });

  it("JWT_ID_CLAIMS 可配（如 uid 优先）", async () => {
    const auth = createJwtAuth({
      config: baseConfig({ jwtIdClaims: ["uid", "sub"] }),
      now: () => NOW_MS,
    });
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ uid: "u-1", sub: "s-1", iss: "https://a" })}`),
    ).resolves.toEqual(ok("https://a:u-1"));
  });

  it("exp：过期拒绝（now >= exp）、未来时间通过、缺省不检查（§6.2「exp 存在且已过期才拒」）", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "a", iss: "https://a", exp: NOW_SEC })}`),
    ).resolves.toEqual(invalid);
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "a", iss: "https://a", exp: NOW_SEC + 60 })}`),
    ).resolves.toEqual(ok("https://a:a"));
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "a", iss: "https://a" })}`),
    ).resolves.toEqual(ok("https://a:a"));
  });

  it("形状拒绝：缺 Bearer、两段式、payload 非 base64url JSON、payload 非对象、iss 缺失（iss 模式无法命名空间）", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    await expect(auth.authenticate(undefined)).resolves.toEqual(invalid);
    await expect(auth.authenticate("not-a-bearer")).resolves.toEqual(invalid);
    await expect(auth.authenticate("Bearer a.b")).resolves.toEqual(invalid);
    await expect(auth.authenticate("Bearer a.!!!.c")).resolves.toEqual(invalid);
    const arrayPayload = `${b64url({ alg: "none" })}.${Buffer.from("[1]").toString("base64url")}.sig`;
    await expect(auth.authenticate(`Bearer ${arrayPayload}`)).resolves.toEqual(invalid);
    await expect(auth.authenticate(`Bearer ${makeJwt({ sub: "a" })}`)).resolves.toEqual(invalid);
  });

  it("realm 隔离：同 sub 不同 iss → 不同 userId（两身份域数值撞车不合并，§6.3）", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    const zai = await auth.authenticate(`Bearer ${makeJwt({ sub: "42", iss: "https://zai" })}`);
    const bigmodel = await auth.authenticate(
      `Bearer ${makeJwt({ sub: "42", iss: "https://bigmodel" })}`,
    );
    expect(zai).toEqual(ok("https://zai:42"));
    expect(bigmodel).toEqual(ok("https://bigmodel:42"));
    expect(zai).not.toEqual(bigmodel);
  });

  it("identity 含分隔符 fail-closed（评审 realm-colon-failclosed）：两组反例不再塌缩到同一 userId", async () => {
    const auth = createJwtAuth({ config: baseConfig(), now: () => NOW_MS });
    // 评审反例组：若无防线，(iss="x:y",sub="c") 与 (iss="x",sub="y:c") 都映射 "x:y:c"，
    // 两个身份域塌缩为同一 owner。防线后 identity 含 ":" 的一侧直接拒绝映射：
    const viaRealmColon = await auth.authenticate(`Bearer ${makeJwt({ sub: "c", iss: "x:y" })}`);
    const viaSubColon = await auth.authenticate(`Bearer ${makeJwt({ sub: "y:c", iss: "x" })}`);
    expect(viaSubColon).toEqual(invalid);
    expect(viaRealmColon).toEqual(ok("x:y:c"));
    expect(viaRealmColon).not.toEqual(viaSubColon);
    // 多重冒号同理拒绝（按最后一个分隔符唯一可逆的性质不被破坏）
    await expect(auth.authenticate(`Bearer ${makeJwt({ sub: "a:b:c", iss: "x" })}`)).resolves.toEqual(
      invalid,
    );
    // explicit realm 同防线：identity 含 ":" 拒绝，正常值不受影响
    const explicitOk = createJwtAuth({
      config: baseConfig({ jwtRealmMode: "explicit", jwtRealm: "zai" }),
      now: () => NOW_MS,
    });
    await expect(explicitOk.authenticate(`Bearer ${makeJwt({ sub: "a:b" })}`)).resolves.toEqual(
      invalid,
    );
    await expect(explicitOk.authenticate(`Bearer ${makeJwt({ sub: "alice" })}`)).resolves.toEqual(
      ok("zai:alice"),
    );
    // realm 为 URL 形态（必含 ":"，spec §6.3 iss 模式的现实形态）不受影响——
    // 若按评审原文连 realm 一并拒绝，本行会 401，与既有 realm 隔离契约矛盾
    await expect(
      auth.authenticate(`Bearer ${makeJwt({ sub: "alice", iss: "https://issuer.example" })}`),
    ).resolves.toEqual(ok("https://issuer.example:alice"));
  });
});

describe("introspect 模式（spec §6.2：端点是身份与有效性的权威，待 M0 实测）", () => {
  const jwt = makeJwt({ sub: "ignored", iss: "https://zai" });

  const introspectAuth = (fetchImpl: typeof fetch): ReturnType<typeof createJwtAuth> =>
    createJwtAuth({
      config: baseConfig({ jwtMode: "introspect", introspectUrl: "https://api.example/userinfo" }),
      fetch: fetchImpl,
    });

  it("携 Bearer 调端点、{data:{...}} 解包、realm 取 JWT iss", async () => {
    const { fetch, calls } = fetchStub(() =>
      Response.json({ code: 0, data: { sub: "u1" } }, { status: 200 }),
    );
    const auth = introspectAuth(fetch);
    await expect(auth.authenticate(`Bearer ${jwt}`)).resolves.toEqual(ok("https://zai:u1"));
    expect(calls).toEqual([
      { url: "https://api.example/userinfo", authorization: `Bearer ${jwt}` },
    ]);
  });

  it("平铺响应取 id；exp 不本地复查（端点是权威，待 M0 定案）", async () => {
    const { fetch } = fetchStub(() => Response.json({ id: "u2" }, { status: 200 }));
    const auth = createJwtAuth({
      config: baseConfig({ jwtMode: "introspect", introspectUrl: "https://api.example/userinfo" }),
      fetch,
      now: () => NOW_MS,
    });
    // 故意带已过期 exp：introspect 语义下有效性与身份都由端点裁决
    const expired = makeJwt({ sub: "x", iss: "https://zai", exp: NOW_SEC - 100 });
    await expect(auth.authenticate(`Bearer ${expired}`)).resolves.toEqual(ok("https://zai:u2"));
  });

  it("三态（评审 auth-three-state）：非 2xx / 网络失败 / 2xx 响应体不可解析 → upstream-unavailable（503 可重试）", async () => {
    // 非 2xx：上游可达但拒绝服务（限流/网关错误），不是凭据判定
    const failing = fetchStub(() => new Response("denied", { status: 401 }));
    await expect(introspectAuth(failing.fetch).authenticate(`Bearer ${jwt}`)).resolves.toEqual(
      unavailable,
    );

    // 网络失败：上游不可达
    const throwing = fetchStub(() => {
      throw new Error("network down");
    });
    await expect(introspectAuth(throwing.fetch).authenticate(`Bearer ${jwt}`)).resolves.toEqual(
      unavailable,
    );

    // 2xx 但响应体不可解析：上游故障而非凭据错误，同样不可重试出结论
    const garbage = fetchStub(() => new Response("not-json{", { status: 200 }));
    await expect(introspectAuth(garbage.fetch).authenticate(`Bearer ${jwt}`)).resolves.toEqual(
      unavailable,
    );
  });

  it("凭据/身份问题恒 credentials-invalid（401）：无身份 claim；Bearer/形状非法", async () => {
    // 端点成功响应但无身份 claim：重试无意义，不归 upstream-unavailable
    const empty = fetchStub(() => Response.json({ code: 0, data: {} }, { status: 200 }));
    await expect(introspectAuth(empty.fetch).authenticate(`Bearer ${jwt}`)).resolves.toEqual(
      invalid,
    );

    const auth = introspectAuth(fetchStub(() => Response.json({ id: "u2" }, { status: 200 })).fetch);
    await expect(auth.authenticate(undefined)).resolves.toEqual(invalid);
    await expect(auth.authenticate("Bearer a.b")).resolves.toEqual(invalid);
  });

  it("HTTP 200 但业务 code/success 表失败 → credentials-invalid（spec §6.1.1 探测 #12 的 BigModel 同款失败体）", async () => {
    const authenticateWith = async (body: unknown): Promise<JwtAuthResult> => {
      const { fetch } = fetchStub(() => Response.json(body, { status: 200 }));
      return introspectAuth(fetch).authenticate(`Bearer ${jwt}`);
    };
    // 探测 #12 实录失败体：HTTP 200 + {code:1001, msg, success:false}
    await expect(
      authenticateWith({
        code: 1001,
        msg: "Header中未收到Authorization参数，无法进行身份验证。",
        success: false,
      }),
    ).resolves.toEqual(invalid);
    // 反例：失败体若恰好携带字符串 id，无业务校验时会被 identityFromClaims 放行——
    // 显式业务 code/成功标志校验必须先于身份提取（评审缺口：不得以「无身份 claim」为唯一失败路径）
    await expect(
      authenticateWith({ code: 1001, success: false, id: "u9" }),
    ).resolves.toEqual(invalid);
    await expect(
      authenticateWith({ code: 1001, success: false, data: { id: "u9" } }),
    ).resolves.toEqual(invalid);
    // success 缺省而 code 非 0：按客户端先例（code !== 0 即失败）同样拒绝
    await expect(authenticateWith({ code: 500, id: "u9" })).resolves.toEqual(invalid);
    // 边界：code:0 + success:true 的成功信封照常放行（失败判据不误伤合法信封）
    await expect(authenticateWith({ code: 0, success: true, data: { id: "u10" } })).resolves.toEqual(
      ok("https://zai:u10"),
    );
  });
});

describe("jwks 模式（spec §6.2：JWKS 验签 RS/ES + iss/aud 白名单，待 M0 实测）", () => {
  /** RSA 密钥对 + 单钥 JWKS；header/payload 自拼签名，真实走 verify 路径 */
  function rsaFixture(): {
    jwk: Record<string, unknown>;
    sign: (payload: Record<string, unknown>, header?: Record<string, unknown>) => string;
  } {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "rsa-1",
      alg: "RS256",
    };
    const sign = (
      payload: Record<string, unknown>,
      header: Record<string, unknown> = { alg: "RS256", kid: "rsa-1", typ: "JWT" },
    ) => {
      const signingInput = `${b64url(header)}.${b64url(payload)}`;
      return `${signingInput}.${createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url")}`;
    };
    return { jwk, sign };
  }

  const basePayload = { sub: "alice", iss: "https://issuer.example", aud: "drora" };
  const jwksConfig = (overrides: Partial<RelayConfig> = {}): RelayConfig =>
    baseConfig({
      jwtMode: "jwks",
      jwtJwksUrl: "https://auth.example/jwks.json",
      // §9 装配期必填（终审）：iss/aud 缺省即抛错，测试配置统一带全，反例用例显式覆盖
      jwtIssuers: ["https://issuer.example"],
      jwtAudience: "drora",
      ...overrides,
    });

  it("RS256 验签通过 → iss 白名单内 realm 前缀身份，kid 命中选择", async () => {
    const { jwk, sign } = rsaFixture();
    const { fetch, calls } = fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 }));
    const auth = createJwtAuth({
      config: jwksConfig({ jwtIssuers: ["https://issuer.example"], jwtAudience: "drora" }),
      fetch,
    });
    await expect(auth.authenticate(`Bearer ${sign(basePayload)}`)).resolves.toEqual(
      ok("https://issuer.example:alice"),
    );
    expect(calls[0]?.url).toBe("https://auth.example/jwks.json");
  });

  it("白名单：iss 不在 JWT_ISSUERS、aud 不匹配拒绝；aud 为包含配置值的数组时通过", async () => {
    const { jwk, sign } = rsaFixture();
    const auth = createJwtAuth({
      config: jwksConfig({ jwtIssuers: ["https://other.example"], jwtAudience: "drora" }),
      fetch: fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 })).fetch,
    });
    await expect(auth.authenticate(`Bearer ${sign(basePayload)}`)).resolves.toEqual(invalid);

    const authAud = createJwtAuth({
      config: jwksConfig({ jwtIssuers: ["https://issuer.example"], jwtAudience: "drora" }),
      fetch: fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 })).fetch,
    });
    await expect(
      authAud.authenticate(`Bearer ${sign({ ...basePayload, aud: ["other", "drora"] })}`),
    ).resolves.toEqual(ok("https://issuer.example:alice"));
    await expect(
      authAud.authenticate(`Bearer ${sign({ ...basePayload, aud: "other" })}`),
    ).resolves.toEqual(invalid);
  });

  it("签名不匹配 / 算法 none / kid 未命中 / JWKS 拉取失败 → credentials-invalid（恒不产生 unavailable，登记范围仅 introspect）", async () => {
    const { jwk, sign } = rsaFixture();
    const auth = createJwtAuth({
      config: jwksConfig({ jwtIssuers: ["https://issuer.example"], jwtAudience: "drora" }),
      fetch: fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 })).fetch,
    });
    // 合法签名基线；随后保持签名原样篡改 payload 段 → 验签失败
    const signed = sign(basePayload);
    await expect(auth.authenticate(`Bearer ${signed}`)).resolves.toEqual(
      ok("https://issuer.example:alice"),
    );
    const [signedHeader, , signature] = signed.split(".");
    const tamperedPayload = b64url({ ...basePayload, sub: "mallory" });
    await expect(
      auth.authenticate(`Bearer ${signedHeader}.${tamperedPayload}.${signature}`),
    ).resolves.toEqual(invalid);

    await expect(
      auth.authenticate(`Bearer ${makeJwt(basePayload, { alg: "none", typ: "JWT" })}`),
    ).resolves.toEqual(invalid);

    const wrongKid = sign(basePayload, { alg: "RS256", kid: "other-kid", typ: "JWT" });
    await expect(auth.authenticate(`Bearer ${wrongKid}`)).resolves.toEqual(invalid);

    const broken = createJwtAuth({
      config: jwksConfig(),
      // 修复（评审 contract-typecheck 暴露）：此处漏写 `.fetch` 曾把 {fetch, calls} 包装对象
      // 整体当 fetchImpl 注入——调用即 TypeError 被 try/catch 吞掉，用例因错误原因通过
      fetch: fetchStub(() => {
        throw new Error("jwks unreachable");
      }).fetch,
    });
    await expect(broken.authenticate(`Bearer ${sign(basePayload)}`)).resolves.toEqual(invalid);
  });

  it("无 kid 时密钥集唯一可无歧义选定；同 kid 多钥按 alg 收敛", async () => {
    const { jwk, sign } = rsaFixture();
    const noKidJwk = { ...jwk };
    delete (noKidJwk as { kid?: string }).kid;
    const authNoKid = createJwtAuth({
      config: jwksConfig(),
      fetch: fetchStub(() => Response.json({ keys: [noKidJwk] }, { status: 200 })).fetch,
    });
    await expect(
      authNoKid.authenticate(`Bearer ${sign(basePayload, { alg: "RS256", typ: "JWT" })}`),
    ).resolves.toEqual(ok("https://issuer.example:alice"));

    // 同 kid 两个键（RSA+另一 RSA）：header alg 收敛到 RS256 键
    const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const secondJwk = {
      ...(second.publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "rsa-1",
      alg: "RS384",
    };
    const authTwoKeys = createJwtAuth({
      config: jwksConfig(),
      fetch: fetchStub(() => Response.json({ keys: [jwk, secondJwk] }, { status: 200 })).fetch,
    });
    await expect(authTwoKeys.authenticate(`Bearer ${sign(basePayload)}`)).resolves.toEqual(
      ok("https://issuer.example:alice"),
    );
  });

  it("ES256（JWS r||s 原始拼接签名，非 DER）验签通过", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "ec-1",
      alg: "ES256",
    };
    const header = { alg: "ES256", kid: "ec-1", typ: "JWT" };
    const signingInput = `${b64url(header)}.${b64url(basePayload)}`;
    // JWS 要求 ieee-p1363 的 r||s 拼接；与实现 verify 侧 dsaEncoding 同款
    const signature = createSign("SHA256")
      .update(signingInput)
      .sign({ key: privateKey, dsaEncoding: "ieee-p1363" })
      .toString("base64url");
    const auth = createJwtAuth({
      config: jwksConfig(),
      fetch: fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 })).fetch,
    });
    await expect(auth.authenticate(`Bearer ${signingInput}.${signature}`)).resolves.toEqual(
      ok("https://issuer.example:alice"),
    );
  });

  it("exp 过期拒绝（验签前先查时效）", async () => {
    const { jwk, sign } = rsaFixture();
    const auth = createJwtAuth({
      config: jwksConfig(),
      fetch: fetchStub(() => Response.json({ keys: [jwk] }, { status: 200 })).fetch,
      now: () => NOW_MS,
    });
    await expect(
      auth.authenticate(`Bearer ${sign({ ...basePayload, exp: NOW_SEC - 10 })}`),
    ).resolves.toEqual(invalid);
  });
});

describe("L0 realm 隔离（spec §10「跨用户隔离（含 realm 隔离）」，真实 loopback + decode 鉴权）", () => {
  it("同 sub 不同 iss 是不同 owner 域：设备列表互不可见、跨域删除 1006", async () => {
    const auth = createJwtAuth({ config: baseConfig() });
    const relay = await startRelay({ auth });
    const tokenZai = makeJwt({ sub: "42", iss: "https://issuer.zai" });
    const tokenBigmodel = makeJwt({ sub: "42", iss: "https://issuer.bigmodel" });

    const registered = await registerDevice(relay, "machine", tokenZai);

    // 另一 realm 的同号身份：列表不可见、删除按异账号 1006 拒绝
    const listOther = await api(relay, PATHS.list.path, { jwt: tokenBigmodel });
    expect((listOther.body as { data: unknown[] }).data).toEqual([]);
    const crossDelete = await api(relay, PATHS.delete.path, {
      body: { device_sid: registered.sid },
      jwt: tokenBigmodel,
    });
    expect(crossDelete.status).toBe(200);
    expect(crossDelete.body).toEqual({ code: 1006, msg: "no permission" });

    // 同 realm（同 iss 前缀）→ 同一 userId：列表可见、可删
    const listSame = await api(relay, PATHS.list.path, { jwt: tokenZai });
    expect(
      (listSame.body as { data: Array<{ device_sid: string }> }).data.map((row) => row.device_sid),
    ).toEqual([registered.sid]);
    const sameDelete = await api(relay, PATHS.delete.path, {
      body: { device_sid: registered.sid },
      jwt: tokenZai,
    });
    expect(sameDelete.status).toBe(200);
    expect(sameDelete.body).toEqual({ code: 0, msg: "" });
  });
});
