// 静态资产托管（spec §12.5）：GET /remote/** → staticRoot/remote/** 文件映射，
// 含官方托管页的 relay 端点出站改写（自建托管形态，R3 路线 A 托管改造点）。
// 从 relayServer.ts 拆出以守单文件行数门禁；语义与安全约束见 spec。
import { readFile } from "node:fs/promises";
import { extname, resolve as resolvePath, sep } from "node:path";

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

export interface StaticAssetResponse {
  contentType: string;
  body: string;
}

/**
 * 解析 /remote/** 静态请求。命中返回响应体；未命中（含目录穿越、目录缺
 * index.html）返回 null 由调用方统一 404。安全约束：resolve 后必须仍位于
 * staticRootAbs 内；无扩展名路径依次尝试 原样 → .html → index.html（官方 QR
 * 路径是 /remote/v4 而非 /remote/v4/index.html，页面按 pathname 精确等于
 * "/remote/v4" 判定托管形态——bundle dHn 段——须原样镜像）。
 */
export async function serveStaticAsset(
  pathname: string,
  staticRootAbs: string,
): Promise<StaticAssetResponse | null> {
  const base = resolvePath(staticRootAbs, `.${pathname}`);
  const candidates =
    extname(base) === "" ? [base, `${base}.html`, `${base}${sep}index.html`] : [base];
  for (const candidate of candidates) {
    if (candidate !== staticRootAbs && !candidate.startsWith(staticRootAbs + sep)) {
      continue;
    }
    try {
      const contentType =
        STATIC_CONTENT_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream";
      const body = (await readFile(candidate)).toString("utf8");
      return { contentType, body: rewriteHostedAsset(body, contentType) };
    } catch {
      // 尝试下一个候选（ENOENT 属常规路径）
    }
  }
  return null;
}
