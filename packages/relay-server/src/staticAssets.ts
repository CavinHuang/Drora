// 静态资产托管（spec §12.5/§12.9）：GET /m*（R2 手机页）与 /remote/**（官方 v4
// 托管资产，两级来源：staticRoot 文件映射 → 内建资产代理 cache→fetch 官方源站）
// 的 HTTP 决策与官方托管页 relay 端点出站改写。集中在本文件以守 relayServer.ts
// 单文件行数门禁；语义与安全约束见 spec。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve as resolvePath, sep } from "node:path";
import { PHONE_PAGE_HTML } from "./phonePage.js";

/** Content-Type 表（未列出回落 application/octet-stream）。 */
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** 官方托管页源站（spec §12.9）：内建资产代理的 fetch 目标。 */
export const OFFICIAL_PAGE_ORIGIN = "https://zcode.z.ai";

/** 官方源站 fetch 超时（spec §12.9）：10s，超时按离线回退路径处理。 */
const OFFICIAL_FETCH_TIMEOUT_MS = 10_000;

/** 官方源站 fetch 的简单 UA（spec §12.9：不伪装浏览器，便于源站侧识别）。 */
const OFFICIAL_FETCH_USER_AGENT = "drora-relay-asset-proxy/1";

/**
 * 官方托管页 relay 端点是硬编码（spec §12.5 二次实测）：共享 chunk 的端点构造器
 * `Mh()` 恒取常量 `wss://zcode.z.ai/ws`（endpointOrigin 参数仅 chatglm.site 镜像
 * 生效）；入口 bundle 的 `endpointOrigin` 字面量同改（无害兜底）。自建托管形态下
 * 出站改写为动态同源。index.html 无 SRI，改写安全；浏览器内存缓存无视
 * no-cache——改写生效需破缓存（换 URL 或重开浏览器会话）。
 */
const OFFICIAL_HOSTED_REWRITES: Array<[string, string]> = [
  ["endpointOrigin:`https://zcode.z.ai`", "endpointOrigin:window.location.origin"],
  [
    "`wss://zcode.z.ai/ws`",
    "(window.location.protocol===`https:`?`wss:`:`ws:`)+`//`+window.location.host+`/ws`",
  ],
];

function rewriteHostedAsset(body: string, contentType: string): string {
  if (!contentType.startsWith("text/javascript")) return body;
  // 运行时标记：判定页面执行的 bundle 确出自本托管（临时诊断手段，保留无副作用）。
  let out = `${body}\n;window.__selfhostPatch="served";\n`;
  for (const [from, to] of OFFICIAL_HOSTED_REWRITES) {
    out = out.split(from).join(to);
  }
  return out;
}

/** 无扩展名候选链（spec §12.5）：原样 → .html → index.html；有扩展名仅原样。 */
function candidatesFor(base: string): string[] {
  return extname(base) === "" ? [base, `${base}.html`, `${base}${sep}index.html`] : [base];
}

/** 防目录穿越（spec §12.5）：resolve 后必须仍位于根内。 */
function isWithinRoot(candidate: string, rootAbs: string): boolean {
  return candidate === rootAbs || candidate.startsWith(rootAbs + sep);
}

/**
 * 按文件扩展名回 Content-Type。无扩展名（入口文档 /remote/v4）官方在该路径直接出
 * HTML 文档（spec §12.5：页面按 pathname 精确等于 "/remote/v4" 判定托管形态），
 * 有扩展名但表外回落 application/octet-stream。
 */
function contentTypeForFile(file: string): string {
  const byExt = STATIC_CONTENT_TYPES[extname(file).toLowerCase()];
  if (byExt) return byExt;
  return extname(file) === "" ? "text/html; charset=utf-8" : "application/octet-stream";
}

interface StaticAssetResponse {
  contentType: string;
  body: string;
}

/**
 * 解析 /remote/** 静态请求（staticRoot 文件映射，spec §12.5 dev 测试床语义）。
 * 命中返回改写后的响应体；未命中（含目录穿越、目录缺 index.html）返回 null。
 * 安全约束：resolve 后必须仍位于 staticRootAbs 内；无扩展名路径按候选链回退
 * （原样 → .html → index.html，官方 QR 路径是 /remote/v4 而非 /remote/v4/index.html）。
 */
async function serveStaticAsset(
  pathname: string,
  staticRootAbs: string,
): Promise<StaticAssetResponse | null> {
  const base = resolvePath(staticRootAbs, `.${pathname}`);
  for (const candidate of candidatesFor(base)) {
    if (!isWithinRoot(candidate, staticRootAbs)) continue;
    try {
      const contentType = contentTypeForFile(candidate);
      const body = (await readFile(candidate)).toString("utf8");
      return { contentType, body: rewriteHostedAsset(body, contentType) };
    } catch {
      // 尝试下一个候选（ENOENT 属常规路径）
    }
  }
  return null;
}

export interface HostedAssetResponse {
  contentType: string;
  /** JS 为出站改写后的文本；其余内容类型为原始字节（缓存即原始字节，spec §12.9）。 */
  body: string | Buffer;
}

/**
 * 入口文档（spec §12.9）：官方 QR 页入口的两种等价形态。离线（源站不可达）时
 * 302 回退 R2 极简页 /m/index.html；其余资产（chunk/css）离线直接 404——页面
 * 自身有失败面，重定向无意义。
 */
function isHostedEntryDoc(pathname: string): boolean {
  return pathname === "/remote/v4" || pathname === "/remote/v4/index.html";
}

/**
 * 内建官方页资产代理（specs/mobile-relay-server.md §12.9）：/remote/** 未命中
 * staticRoot 时的二级来源。命中顺序：①cacheDir 同 pathname 缓存（JS 出站改写、
 * 其余原始字节直出）→ ②fetch 官方源站（10s 超时）→ 200 则把原始字节写入
 * cacheDir（目录随 pathname 创建）并出站改写后服务。缓存只存原始字节、改写只在
 * 出站做——改写规则演进时缓存仍有效；写缓存失败降级为直出不缓存。全部未命中
 * 返回 null，由路由层按入口文档分流 302/404。安全：越界 pathname（防穿越约束同
 * staticRoot）直接拒绝，连源站都不请求。
 */
export async function serveHostedAsset(params: {
  pathname: string;
  cacheDirAbs: string;
  fetchImpl?: typeof fetch;
}): Promise<HostedAssetResponse | null> {
  const { pathname, cacheDirAbs } = params;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  // 防穿越前置（spec §12.5 约束延伸到代理）：越界 pathname 不读盘也不请求源站。
  const target = resolvePath(cacheDirAbs, `.${pathname}`);
  if (!isWithinRoot(target, cacheDirAbs)) return null;
  // ① 缓存命中：原始字节 + JS 出站改写（候选链与 staticRoot 同语义）。
  for (const candidate of candidatesFor(target)) {
    if (!isWithinRoot(candidate, cacheDirAbs)) continue;
    try {
      const contentType = contentTypeForFile(candidate);
      if (contentType.startsWith("text/javascript")) {
        const body = await readFile(candidate, "utf8");
        return { contentType, body: rewriteHostedAsset(body, contentType) };
      }
      // 非 JS：原始字节直出，不做 utf8 往返（二进制资产字节保真）。
      return { contentType, body: await readFile(candidate) };
    } catch {
      // 尝试下一候选（ENOENT 属常规路径）
    }
  }
  // ② 缓存未命中：fetch 官方源站；失败/非 200 交路由层回退（302/404）。
  let fetched: Response;
  try {
    fetched = await fetchImpl(`${OFFICIAL_PAGE_ORIGIN}${pathname}`, {
      headers: { "user-agent": OFFICIAL_FETCH_USER_AGENT },
      signal: AbortSignal.timeout(OFFICIAL_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (fetched.status !== 200) return null;
  const raw = Buffer.from(await fetched.arrayBuffer());
  // ③ 落盘缓存（原始字节，改写只在出站做——spec §12.9）；写失败降级直出不缓存。
  // 缓存布局镜像 staticRoot 约定（§12.5）：无扩展名 pathname 是入口文档（官方在
  // /remote/v4 直接出 HTML），落 <target>/index.html——v4 既是入口路径又是资产
  // 目录（/remote/v4/<ver>/assets/*），不能落同名文件；读路径候选链（原样 →
  // .html → index.html）与 staticRoot 同序，两种布局都能命中。
  const cacheTarget = extname(target) === "" ? join(target, "index.html") : target;
  try {
    await mkdir(dirname(cacheTarget), { recursive: true });
    await writeFile(cacheTarget, raw);
  } catch {
    // 缓存写失败不阻断服务（下次请求重试）
  }
  // ④ 出站改写后服务（与缓存命中同一改写路径）。
  const contentType = contentTypeForFile(target);
  if (contentType.startsWith("text/javascript")) {
    return { contentType, body: rewriteHostedAsset(raw.toString("utf8"), contentType) };
  }
  return { contentType, body: raw };
}

export interface StaticRouteResult {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

const NOT_FOUND_ROUTE: StaticRouteResult = {
  status: 404,
  headers: { "content-type": "text/plain" },
  body: "not found",
};

function okRoute(contentType: string, body: string | Buffer): StaticRouteResult {
  return {
    status: 200,
    headers: { "content-type": contentType, "cache-control": "no-cache" },
    body,
  };
}

/**
 * GET /remote/** 托管资产路由（spec §12.5/§12.9）：①staticRoot 文件映射优先
 * （dev 测试床语义不变）→ ②内建资产代理（cache → fetch 官方源站）→ ③离线回退：
 * 入口文档 302 重定向到 /m/index.html（保留原查询串，R2 极简页兜底），其余资产
 * 404。仅受理 GET；未配置任何来源时维持 404。
 */
async function routeRemoteAssetRequest(params: {
  method: string;
  pathname: string;
  search: string;
  staticRootAbs: string | null;
  remoteAssetsAbs: string | null;
  fetchImpl: typeof fetch;
}): Promise<StaticRouteResult> {
  if (params.method !== "GET") return NOT_FOUND_ROUTE;
  // ① staticRoot 优先（spec §12.5）：命中即服务，未命中落入内建代理。
  if (params.staticRootAbs) {
    const asset = await serveStaticAsset(params.pathname, params.staticRootAbs);
    if (asset) return okRoute(asset.contentType, asset.body);
  }
  // ② 内建资产代理（spec §12.9）。
  if (params.remoteAssetsAbs) {
    const asset = await serveHostedAsset({
      pathname: params.pathname,
      cacheDirAbs: params.remoteAssetsAbs,
      fetchImpl: params.fetchImpl,
    });
    if (asset) return okRoute(asset.contentType, asset.body);
    // ③ 离线回退（spec §12.9）：入口文档 302 → R2 页（查询串透传给 QR 参数面）。
    if (isHostedEntryDoc(params.pathname)) {
      return { status: 302, headers: { location: `/m/index.html${params.search}` }, body: "" };
    }
  }
  return NOT_FOUND_ROUTE;
}

/**
 * HTTP 静态面路由（spec §12.5/§12.9）：R2 手机页（/m*，任意方法）与 /remote/**
 * 托管资产（仅 GET，两级来源 + 离线回退）。返回 null = 本层不接管，调用方统一
 * 404（自托管资产库不做官方式版本门控：页面与桌面端同仓发布，天然配套，spec §7）。
 */
export async function routeStaticRequest(params: {
  method: string;
  pathname: string;
  search: string;
  staticRootAbs: string | null;
  remoteAssetsAbs: string | null;
  fetchImpl: typeof fetch;
}): Promise<StaticRouteResult | null> {
  // 自建手机页（R2）：/m 与 /m/index.html 同页；桌面二维码 remotePageUrl 与代理
  // 离线回退都指向此处。必须按 pathname 匹配——request.url 含查询串（QR 的
  // sid/hash 等），精确匹配会让带参数的手机页 404（E2E 实锤）。
  if (
    params.pathname === "/m" ||
    params.pathname === "/m/" ||
    params.pathname === "/m/index.html"
  ) {
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: PHONE_PAGE_HTML,
    };
  }
  if (params.pathname.startsWith("/remote/")) {
    return routeRemoteAssetRequest(params);
  }
  return null;
}
