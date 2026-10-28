// standalone 官方回源（specs/relay-v2-server.md §8.6）：OFFICIAL_UPSTREAM_ORIGIN 设置后，
// 凡非远控 API（/api/v1/remote/*）、非健康面（/healthz）、非静态托管范围的请求（手机页
// OAuth 同源 token 交换 /api/v1/oauth/token、userinfo、Coding Plan API 等）整体流式回源
// 该 origin——本文件是 deploy/Caddyfile catch-all reverse_proxy 段的进程内等价形态。
// 纪律声明（spec §11 第 12 条）：该面属部署便利，请求与响应都只做字节流转发，**不解析任何
// 业务内容、不落任何状态**——body 上限与鉴权前置是 relay 自有 API 面（§5.1）的规则，这里
// 有意不套用（该面凭据校验归官方源站，安全语义等同 §8.1 的 Caddy 反代）。

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * hop-by-hop 头（RFC 9110 §7.6.1 与代理扩展）：逐跳语义不应跨代理传递，Caddy
 * reverse_proxy 同款两侧剥离。te/trailer/transfer-encoding/upgrade 由 fetch 与流式
 * 管道自行管理，透传反而会造成分帧冲突。
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 上游失败（不可达/连接中断）的统一 502 JSON 信封（spec §8.6 规则 3） */
function replyBadGateway(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.writeHead(502, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ code: 502, msg: "official upstream unavailable" }));
}

export interface OfficialProxyDeps {
  /** 上游 origin（config.officialUpstreamOrigin，config 层已校验为 http/https 绝对 URL） */
  origin: string;
}

export function createOfficialProxyHandler(
  deps: OfficialProxyDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  // path+query 保留、origin 整体替换的 URL 基座；Host 由 fetch 按上游 URL 重写
  // （等价 Caddy header_up Host {upstream_hostport}，spec §8.6 规则 1）。
  const upstreamOrigin = new URL(deps.origin).origin;
  return async function proxyToOfficial(request, response) {
    // 客户端断开/写侧错误不允许变成未处理异常（代理面的流错误一律按连接收尾处理）
    response.on("error", () => {});
    request.on("error", () => {});
    const method = request.method ?? "GET";
    const upstreamUrl = new URL(request.url ?? "/", upstreamOrigin);
    // 请求头透传（Host 与 hop-by-hop 除外）；content-length 一并剥离：body 以流转发时
    // 分帧由 fetch（chunked）自行管理，保留旧长度反而可能与重分帧冲突。
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLowerCase();
      if (lower === "host" || lower === "content-length" || HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (typeof value === "string") headers[lower] = value;
      else if (Array.isArray(value)) headers[lower] = value.join(", ");
    }
    const controller = new AbortController();
    // 客户端中途断开 → 终止上游流，不在后台留孤儿连接（与 Caddy 的上游取消语义一致）
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        method,
        headers,
        // 请求体流式直通（不缓冲大 body，spec §8.6 规则 2）；GET/HEAD 无 body
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: request, duplex: "half" as const }),
        redirect: "manual", // 上游重定向原样透传给浏览器，不在代理侧跟随
        signal: controller.signal,
      });
      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, name) => {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()))
          responseHeaders[name.toLowerCase()] = value;
      });
      response.writeHead(upstreamResponse.status, responseHeaders);
      if (upstreamResponse.body === null) {
        response.end();
        return;
      }
      const bodyStream = Readable.fromWeb(upstreamResponse.body);
      bodyStream.on("error", () => {
        // 上游中途断流：响应头已发出，无法补 502 信封，只能截断连接（客户端按网络错误重试）
        response.destroy();
      });
      bodyStream.pipe(response);
    } catch (error) {
      // fetch 抛错=不可达/连接失败/DNS 失败/客户端 abort。客户端 abort 时 socket 已死，
      // 写 502 会被 error 监听器吞掉，无副作用；不可达时浏览器拿到明确信封。
      void error;
      replyBadGateway(response);
    }
  };
}
