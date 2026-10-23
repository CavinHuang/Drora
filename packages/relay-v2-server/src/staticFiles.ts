// standalone 静态托管（specs/relay-v2-server.md §8.6）：STATIC_ROOT 设置后由 relay 进程
// 直接托管 /remote/v4 与 /remote/v4/* 手机页静态，行为对齐 deploy/Caddyfile 的
// handle_path /remote/v4* + try_files + file_server 组合——本文件是 Caddy 静态段的进程内
// 等价形态，不承载任何业务状态（部署便利面，定性见 spec §11 第 12 条）。
// 红线（spec §8.6 规则）：仅 GET/HEAD；未命中文件 SPA fallback 回 index.html（no-cache，
// 桌面升级后手机页必须立即拿到新入口，§8.3）；hash 资产 immutable；percent-decode 后
// resolve 必须仍在 root 内，逃逸一律 403（防路径穿越）。

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 托管挂载点：与 vite build --base=/remote/v4/ 的产物前缀一致（spec §8.2/§8.6） */
export const WEB_REMOTE_CONTROL_MOUNT = "/remote/v4";

/** 扩展名 → Content-Type；text/* 带 charset。未登记扩展名按二进制流处理 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
};

/** index.html 与其余未登记缓存策略的文件统一 no-cache（spec §8.6 规则 2） */
const CACHE_NO_CACHE = "no-cache";
/** Vite 内容哈希资产（默认 8 位）不可变缓存（spec §8.6 规则 2） */
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Vite 内容哈希资产判定：basename 形如 `name-HASH.ext`（HASH 为 8 位 base64 字符集，
 * vite build 默认输出）。哈希资产内容不变 → immutable；无哈希文件（index.html、favicon）
 * 一律 no-cache——误把无哈希文件判成 immutable 会让升级后的手机页拿不到新入口（§8.3）。
 */
function isHashedAsset(basename: string): boolean {
  return /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(basename);
}

/** dispatch 侧使用：是否属于静态托管范围（仅 `/remote/v4` 精确与 `/remote/v4/` 前缀） */
export function isWebRemoteControlStaticPath(pathname: string): boolean {
  return (
    pathname === WEB_REMOTE_CONTROL_MOUNT || pathname.startsWith(`${WEB_REMOTE_CONTROL_MOUNT}/`)
  );
}

export interface StaticFilesDeps {
  /** 静态根目录（config.staticRoot；须为绝对路径，装配层不做二次校验） */
  root: string;
}

/** 穿越逃逸/解码失败的统一拒绝（403）；文件缺失/读取失败统一 404 */
function reject(
  response: ServerResponse,
  status: number,
  extraHeaders?: Record<string, string>,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  response.end(JSON.stringify({ code: status, msg: status === 403 ? "forbidden" : "not found" }));
}

/** 穿越逃逸/解码失败的内部标记；handler 统一按 403 拒绝（spec §8.6 规则 4） */
class PathEscapeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PathEscapeError";
  }
}

/**
 * @param pathname 原始请求路径（含 percent-encoding，未 decode）
 * @returns 实际要服务的文件绝对路径与是否 SPA fallback；逃逸/非法编码抛 PathEscapeError
 */
async function resolveTarget(
  root: string,
  pathname: string,
): Promise<{ target: string; fellBack: boolean }> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new PathEscapeError("percent-decode failed"); // 非法编码序列按逃逸面处理（403）
  }
  if (decoded.includes("\0")) throw new PathEscapeError("null byte in path"); // 攻击标记，直接 403
  // 剥挂载前缀后归一到绝对路径；resolve 结果必须仍在 root 内（含 root 本身=目录 → fallback）
  const relative =
    decoded === WEB_REMOTE_CONTROL_MOUNT ? "/" : decoded.slice(WEB_REMOTE_CONTROL_MOUNT.length);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, `.${relative}`);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new PathEscapeError("path escapes static root");
  }
  const indexHtml = path.join(resolvedRoot, "index.html");
  try {
    const info = await stat(resolved);
    // 目录请求（如 /remote/v4/）走 SPA fallback
    return info.isFile()
      ? { target: resolved, fellBack: false }
      : { target: indexHtml, fellBack: true };
  } catch {
    return { target: indexHtml, fellBack: true }; // 未命中 → SPA fallback（spec §8.6 规则 3）
  }
}

/**
 * @param target 实际要读的文件（可能是 fallback 的 index.html）；fallback 命中时 no-cache
 */
function cacheControlFor(target: string, fellBack: boolean): string {
  if (fellBack) return CACHE_NO_CACHE;
  return isHashedAsset(path.basename(target)) ? CACHE_IMMUTABLE : CACHE_NO_CACHE;
}

export function createStaticFileHandler(
  deps: StaticFilesDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const root = path.resolve(deps.root);
  return async function handleStatic(request, response) {
    // spec §8.6 规则 1：仅 GET/HEAD；写方法 405（Allow 头给足客户端重试依据）
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      reject(response, 405, { Allow: "GET, HEAD" });
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    let target: string;
    let fellBack: boolean;
    try {
      ({ target, fellBack } = await resolveTarget(root, pathname));
    } catch {
      // spec §8.6 规则 4：decode 后 resolve 逃出 root（含非法编码/null 字节）一律 403
      reject(response, 403);
      return;
    }
    try {
      const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
      const cacheControl = cacheControlFor(target, fellBack);
      if (method === "HEAD") {
        // HEAD 不读内容：stat 取长度即可（与 GET 的 Content-Length 同源语义）
        const info = await stat(target);
        response.writeHead(200, {
          "Content-Type": type,
          "Content-Length": String(info.size),
          "Cache-Control": cacheControl,
        });
        response.end();
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, {
        "Content-Type": type,
        "Content-Length": String(body.length),
        "Cache-Control": cacheControl,
      });
      response.end(body);
    } catch {
      // stat/readFile 失败（文件在 stat 与 read 之间消失、fallback 的 index.html 缺失等）
      // → 404。静态目录内容属部署产物，读失败按不存在处理即可，不做重试与兜底分支。
      reject(response, 404);
    }
  };
}
