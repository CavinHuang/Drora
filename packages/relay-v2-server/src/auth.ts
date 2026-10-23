// JWT → userId 映射（specs/relay-v2-server.md §6.1–§6.3）。
// 四种装配：stub（测试 users 映射表，fake relay 同款选项）、decode（本地解 payload，不验签）、
// introspect（携 Bearer 调用户信息端点，镜像客户端同一条提取路径）、jwks（JWKS 验签 + iss/aud
// 白名单）。userId 一律加 realm 前缀（§6.3），防 ZAI/BigModel 两域 id 数值撞车。
//
// 待 M0 验证（§6.1，改动时同步更新 spec §6.2/§6.3）：
// - introspect / jwks 依赖的官方端点存在性、响应形状、签名方案均未经真实 drora JWT 实测；
// - decode 模式的身份 claim 名以 JWT_ID_CLAIMS 回退链兼容（默认 sub,id，镜像客户端
//   userinfo 的 `sub ?? id` 先例，packages/services/src/oauth/providers/zaiProviderAdapter.ts:419）；
// - realm 前缀格式 `realm:identity`（半角冒号）已登记 spec §6.3（M0 定案前的临时格式）。
//
// 安全边界（§6.2 如实记录）：decode 不验签——能构造合法形状 JWT 者可映射任意 userId，
// 多用户部署必须 introspect/jwks。红线：本模块不落日志，JWT、身份值不输出。

import { createPublicKey, createVerify, webcrypto, type KeyObject } from "node:crypto";
import type { RelayConfig } from "./config.js";
import type { JwtAuth } from "./types.js";

/** @types/node 25 无 node:crypto 顶层 JsonWebKey 导出，类型挂在 webcrypto 命名空间下 */
type JwkObject = webcrypto.JsonWebKey;

/** realm 前缀分隔符：格式 `realm:identity` 已登记 spec §6.3（M0 定案前的临时格式）；单一出处 */
const REALM_SEPARATOR = ":";

/** Bearer 解析与 fake relay 同款：/^Bearer (.+)$/i；缺失或不匹配返回 undefined。
 * 模块私有（评审 unused-exports：仅本模块四种模式消费，不属公开鉴权面） */
function parseBearerToken(authorizationHeader: string | undefined): string | undefined {
  return authorizationHeader?.match(/^Bearer (.+)$/i)?.[1];
}

/** base64url 解一段 JWT 为 JSON 对象；形状非法返回 undefined */
function decodeJwtObject(segment: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** RFC 7519 三段式拆解；decode 模式只读 payload 不验签（§6.2），jwks 模式另取 header 验签 */
function splitJwt(jwt: string): [string, string, string] | undefined {
  const [header, payload, signature] = jwt.split(".");
  if (
    header === undefined ||
    payload === undefined ||
    signature === undefined ||
    header.length === 0 ||
    payload.length === 0 ||
    signature.length === 0
  ) {
    return undefined;
  }
  return [header, payload, signature];
}

/**
 * 身份 claim 回退链：取第一个「非空字符串」取值（JWT_ID_CLAIMS，默认 sub,id）。
 * 与客户端 `sub ?? id` 的差异：空字符串不取、落到下一候选——空串 userId 会退化 realm
 * 命名空间，宁可判为无法映射（401）也不接受。
 */
function identityFromClaims(
  claims: Record<string, unknown>,
  idClaims: readonly string[],
): string | undefined {
  for (const claim of idClaims) {
    const value = claims[claim];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** exp 存在且已过期才拒绝（§6.2）；exp 语义 now >= exp 即过期，与 fake relay 的 expiresAt <= now 一致 */
function isExpired(payload: Record<string, unknown>, nowSeconds: number): boolean {
  const exp = payload.exp;
  return typeof exp === "number" && exp <= nowSeconds;
}

/** 客户端镜像：userinfo 响应可能是 {data:{...}} 包裹或平铺（zaiProviderAdapter.ts:417 的 `data ?? 本体`） */
function unwrapDataObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return record;
}

/**
 * introspect 业务失败信封（HTTP 200 但业务层表失败，spec §6.1.1 探测 #12）：BigModel
 * userinfo 端点以 HTTP 200 + {code:1001, msg, success:false} 表达鉴权失败（与 §5.1 信封
 * 规则同构），因此除 HTTP 状态外必须显式校验业务成功标志——否则「无身份 claim」会成为
 * 唯一失败路径，失败体若恰好携带字符串 id/sub 会被 identityFromClaims 放行。
 * 判据：success 严格 false、或 code 存在且非 0 即失败。code 具体成功值语义待 M0 定案：
 * 当前取 0 为成功（客户端先例 bigmodelProviderAdapter token 交换的
 * `code !== undefined && code !== 0` 即失败），定案后同步本注释与 spec §6.2。
 */
function isBusinessFailure(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (record.success === false) return true;
  const code = record.code;
  return code !== undefined && code !== 0;
}

/** stub 模式（spec §12 M1）：JWT→userId 测试映射表，fake relay 同款 users 选项；映射值原样返回 */
export function createStubJwtAuth(users: Readonly<Record<string, string>>): JwtAuth {
  return {
    async authenticate(authorizationHeader) {
      const jwt = parseBearerToken(authorizationHeader);
      if (jwt === undefined) return undefined;
      // Object.hasOwn 防原型链键（"constructor" 等），与 fake relay 一致
      return Object.hasOwn(users, jwt) ? users[jwt] : undefined;
    },
  };
}

export interface CreateJwtAuthOptions {
  config: RelayConfig;
  /** 可注入 fetch（测试与未来代理）；默认全局 fetch */
  fetch?: typeof fetch;
  /** 可注入时钟（exp 过期判定）；默认 Date.now */
  now?: () => number;
}

/**
 * 按配置装配 stub / decode / introspect / jwks 模式。进程级 stub（JWT_MODE=stub +
 * JWT_STUB_USERS，spec §9，仅测试/冒烟）经这里分派到 createStubJwtAuth；程序化 stub
 * 走 createStubJwtAuth 直配（createRelayServer users 选项）。
 * 模式必填项（spec §9「对应模式必填」）在装配期校验：配错启动即失败，而非每个请求 401。
 */
export function createJwtAuth(options: CreateJwtAuthOptions): JwtAuth {
  const { config } = options;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const idClaims = config.jwtIdClaims;
  if (config.jwtMode === "stub") {
    // stub 是纯映射表：凭据形状都不看，因此仅测试/进程级冒烟可用（spec §9/§12 M1）
    if (config.jwtStubUsers === undefined || Object.keys(config.jwtStubUsers).length === 0) {
      throw new Error("JWT_MODE=stub 需要 JWT_STUB_USERS（spec §9；仅测试/冒烟，生产禁用）");
    }
    return createStubJwtAuth(config.jwtStubUsers);
  }
  if (config.jwtMode === "introspect" && config.introspectUrl === undefined) {
    throw new Error("JWT_MODE=introspect 需要 INTROSPECT_URL（spec §9）");
  }
  // jwks iss/aud 白名单运行期载体：仅 jwks 分支经下方 fail-fast 后赋值。authenticateJwks
  // 只在 jwks 模式被分派（见 authenticate），非 jwks 模式下初值不可达；iss 初值取空集 =
  // 全拒——装配序若被未来改动破坏，失败方向是拒绝而非放行（§6.2 安全边界；终审
  // 2026-10-23：删除 authenticateJwks 内「未配置即跳过」死分支，函数体与 fail-fast 一致）。
  let jwksIssuers: readonly string[] = [];
  let jwksAudience = "";
  if (config.jwtMode === "jwks") {
    if (config.jwtJwksUrl === undefined) {
      throw new Error("JWT_MODE=jwks 需要 JWT_JWKS_URL（spec §9）");
    }
    // §9「对应模式必填」：iss/aud 白名单漏配时凡该 JWKS 下签名合法的 token 不论
    // issuer/audience 都被接受——静默弱化安全边界，因此同属装配期 fail-fast（终审 2026-10-22）。
    if (config.jwtIssuers === undefined || config.jwtIssuers.length === 0) {
      throw new Error(
        "JWT_MODE=jwks 需要 JWT_ISSUERS（spec §9）：缺 iss 白名单时任意 issuer 的合法签名 token 都会被接受",
      );
    }
    if (config.jwtAudience === undefined) {
      throw new Error(
        "JWT_MODE=jwks 需要 JWT_AUDIENCE（spec §9）：缺 aud 校验时任意 audience 的合法签名 token 都会被接受",
      );
    }
    jwksIssuers = config.jwtIssuers;
    jwksAudience = config.jwtAudience;
  }
  if (config.jwtRealmMode === "explicit" && (config.jwtRealm ?? "").length === 0) {
    throw new Error("JWT_REALM_MODE=explicit 需要 JWT_REALM（spec §6.3）");
  }

  /** realm 推导（§6.3）：iss 模式从 payload iss 取（缺失即无法命名空间→拒绝），explicit 用配置值 */
  const realmOf = (payload: Record<string, unknown>): string | undefined => {
    if (config.jwtRealmMode === "explicit") return config.jwtRealm;
    const iss = payload.iss;
    return typeof iss === "string" && iss.length > 0 ? iss : undefined;
  };

  /** userId 一律 realm 前缀（§6.3 硬约束）；realm 推导失败视为无法映射 */
  const withRealm = (payload: Record<string, unknown>, identity: string): string | undefined => {
    const realm = realmOf(payload);
    return realm === undefined ? undefined : `${realm}${REALM_SEPARATOR}${identity}`;
  };

  /** decode：本地 base64url 解 payload，不验签；exp 存在且已过期拒绝（§6.2） */
  const authenticateDecode = async (
    authorizationHeader: string | undefined,
  ): Promise<string | undefined> => {
    const jwt = parseBearerToken(authorizationHeader);
    if (jwt === undefined) return undefined;
    const parts = splitJwt(jwt);
    if (parts === undefined) return undefined;
    const payload = decodeJwtObject(parts[1]);
    if (payload === undefined || isExpired(payload, Math.floor(now() / 1000))) return undefined;
    const identity = identityFromClaims(payload, idClaims);
    if (identity === undefined) return undefined;
    return withRealm(payload, identity);
  };

  /**
   * introspect：携 Bearer 调 INTROSPECT_URL 取身份。待 M0 验证：端点可用性与响应形状未实测；
   * 端点是 token 有效性的权威（本地不重复检查 exp），网络失败/非 2xx/业务 code 或 success
   * 表失败（HTTP 200 也可能失败，§6.1.1 探测 #12）/无身份 claim 一律视为无法映射（401）。
   * 注意与客户端不同：客户端兜底 "unknown"，服务端必须拒绝而非归并到同一用户。
   */
  const authenticateIntrospect = async (
    authorizationHeader: string | undefined,
  ): Promise<string | undefined> => {
    const jwt = parseBearerToken(authorizationHeader);
    if (jwt === undefined) return undefined;
    const parts = splitJwt(jwt);
    if (parts === undefined) return undefined;
    const payload = decodeJwtObject(parts[1]);
    if (payload === undefined) return undefined;
    let body: unknown;
    try {
      const response = await fetchImpl(config.introspectUrl as string, {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!response.ok) return undefined;
      body = await response.json();
    } catch {
      return undefined;
    }
    // 业务 code/成功标志校验（§6.1.1 探测 #12）：HTTP 200 不代表鉴权成功，先于身份提取
    if (isBusinessFailure(body)) return undefined;
    const profile = unwrapDataObject(body);
    const identity = identityFromClaims(profile, idClaims);
    if (identity === undefined) return undefined;
    // realm 仍取自 JWT payload iss（未验签读取，仅用于命名空间，身份本体已由端点确认）；待 M0 验证
    return withRealm(payload, identity);
  };

  /** JWS RS/ES 算法白名单（§6.2「JWKS 验签（RS/ES）」）；none 与未知算法直接拒绝 */
  const RSA_HASH: Record<string, string> = {
    RS256: "RSA-SHA256",
    RS384: "RSA-SHA384",
    RS512: "RSA-SHA512",
  };
  const EC_PARAMS: Record<string, { hash: string; crv: string }> = {
    ES256: { hash: "SHA256", crv: "P-256" },
    ES384: { hash: "SHA384", crv: "P-384" },
    ES512: { hash: "SHA512", crv: "P-521" },
  };

  interface SelectedKey {
    key: KeyObject;
    jwk: Record<string, unknown>;
  }

  const toVerifyKey = (jwk: Record<string, unknown> | undefined): SelectedKey | undefined => {
    if (jwk === undefined) return undefined;
    try {
      return { key: createPublicKey({ key: jwk as unknown as JwkObject, format: "jwk" }), jwk };
    } catch {
      return undefined;
    }
  };

  /** 拉取 JWKS 并按 kid 选钥；无 kid 时仅密钥集唯一可无歧义选定，多候选即拒绝。待 M0 验证 */
  const selectJwk = async (header: Record<string, unknown>): Promise<SelectedKey | undefined> => {
    let body: unknown;
    try {
      const response = await fetchImpl(config.jwtJwksUrl as string);
      if (!response.ok) return undefined;
      body = await response.json();
    } catch {
      return undefined;
    }
    if (typeof body !== "object" || body === null) return undefined;
    const keys = (body as Record<string, unknown>).keys;
    if (!Array.isArray(keys)) return undefined;
    const candidates = keys.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
    const kid = header.kid;
    if (typeof kid === "string" && kid.length > 0) {
      const matched = candidates.filter((item) => item.kid === kid);
      if (matched.length === 1) return toVerifyKey(matched[0]);
      if (matched.length > 1) {
        // 同 kid 多钥时按 alg 再收敛一次，仍不唯一则拒绝
        const byAlg = matched.filter((item) => item.alg === header.alg);
        return byAlg.length === 1 ? toVerifyKey(byAlg[0]) : undefined;
      }
      return undefined;
    }
    return candidates.length === 1 ? toVerifyKey(candidates[0]) : undefined;
  };

  /** node:crypto 验签：RSA 走 createVerify，ES 走 ieee-p1363（JWS 的 r||s 拼接不是 DER） */
  const verifySignature = (
    alg: string,
    signingInput: string,
    signatureB64url: string,
    selected: SelectedKey,
  ): boolean => {
    try {
      const signature = Buffer.from(signatureB64url, "base64url");
      const rsaHash = RSA_HASH[alg];
      if (rsaHash !== undefined) {
        const verifier = createVerify(rsaHash);
        verifier.update(signingInput);
        verifier.end();
        return verifier.verify(selected.key, signature);
      }
      const ec = EC_PARAMS[alg];
      if (ec === undefined) return false;
      if (selected.jwk.crv !== ec.crv) return false;
      const verifier = createVerify(ec.hash);
      verifier.update(signingInput);
      verifier.end();
      return verifier.verify({ key: selected.key, dsaEncoding: "ieee-p1363" }, signature);
    } catch {
      return false;
    }
  };

  /**
   * jwks：JWKS 验签 + iss/aud 白名单，再按 decode 同规则取身份与 realm（§6.2 表）。
   * 待 M0 验证：JWKS 端点存在性、kid/alg 覆盖、ES 曲线均未实测。JWT_ISSUERS / JWT_AUDIENCE
   * 已由装配期强制必填（spec §9），白名单在此恒生效——本函数不再做「未配置即跳过」的降级。
   */
  const authenticateJwks = async (
    authorizationHeader: string | undefined,
  ): Promise<string | undefined> => {
    const jwt = parseBearerToken(authorizationHeader);
    if (jwt === undefined) return undefined;
    const parts = splitJwt(jwt);
    if (parts === undefined) return undefined;
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = decodeJwtObject(headerB64);
    const payload = decodeJwtObject(payloadB64);
    if (header === undefined || payload === undefined) return undefined;
    const alg = header.alg;
    if (typeof alg !== "string" || (!(alg in RSA_HASH) && !(alg in EC_PARAMS))) return undefined;
    if (isExpired(payload, Math.floor(now() / 1000))) return undefined;
    // iss/aud 白名单恒生效：装配期 fail-fast 已保证必填（上方 jwks 分支赋值），
    // 不存在「未配置即跳过」的放行路径（§6.2 安全边界）
    if (!jwksIssuers.includes(payload.iss as string)) {
      return undefined;
    }
    const aud = payload.aud;
    const audienceOk =
      aud === jwksAudience || (Array.isArray(aud) && (aud as unknown[]).includes(jwksAudience));
    if (!audienceOk) return undefined;
    const selected = await selectJwk(header);
    if (
      selected === undefined ||
      !verifySignature(alg, `${headerB64}.${payloadB64}`, signatureB64, selected)
    ) {
      return undefined;
    }
    const identity = identityFromClaims(payload, idClaims);
    if (identity === undefined) return undefined;
    return withRealm(payload, identity);
  };

  return {
    async authenticate(authorizationHeader) {
      if (config.jwtMode === "introspect") return authenticateIntrospect(authorizationHeader);
      if (config.jwtMode === "jwks") return authenticateJwks(authorizationHeader);
      return authenticateDecode(authorizationHeader);
    },
  };
}
