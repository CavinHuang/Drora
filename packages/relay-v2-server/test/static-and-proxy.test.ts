// standalone 单容器两分支的行为测试（specs/relay-v2-server.md §8.6/§9）：
// STATIC_ROOT 静态托管（SPA fallback、缓存头、防路径穿越、仅 GET/HEAD、未启用行为不变）
// 与 OFFICIAL_UPSTREAM_ORIGIN 官方回源（Host 重写、流式透传、relay 自有面不走代理、
// 上游不可达 502 信封、未启用行为不变）。静态目录与上游 stub 均为测试自建 fixture，
// 不依赖网络；stub 不记录任何真实凭据。

import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { api, closeStartedRelays, JWT_ALICE, startRelay } from "./helpers.js";

/**
 * 原始路径 GET（绕过客户端 URL 规范化）：WHATWG URL 会把 %2e%2e 系编码点段在客户端就
 * 规范化掉（浏览器同款行为），测不到服务端 decode 后的穿越闸；经 node:http 的 path 选项
 * 原样发送，才能覆盖「非浏览器客户端发来编码点段」的攻击面。
 */
function rawGet(
  httpUrl: string,
  rawPath: string,
): Promise<{ status: number; body: string; contentType: string | null }> {
  const url = new URL(httpUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: url.hostname, port: url.port, path: rawPath, method: "GET" },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: response.headers["content-type"] ?? null,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** 静态 fixture：root/ 下 index.html + Vite 形态 hash 资产 + 无哈希文件；root 外放置逃逸目标 */
async function makeStaticRoot(): Promise<{ root: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "relay-v2-static-"));
  const root = join(tempDir, "root");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>v4-entry</title>");
  await writeFile(join(root, "assets", "app-B1GH2xXj.js"), "console.log('v4-app');\n");
  await writeFile(join(root, "robots.txt"), "User-agent: *\nDisallow:\n");
  // 逃逸目标：root 之外的敏感文件（穿越用例断言它不可达）
  await writeFile(join(tempDir, "secret-outside.txt"), "outside");
  return { root, tempDir };
}

const registeredTempDirs: string[] = [];
const upstreamStubs: Server[] = [];

afterEach(closeStartedRelays);

afterEach(async () => {
  // 用例自建的静态 fixture 目录与上游 stub 统一收尾
  const dirs = registeredTempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  const stubs = upstreamStubs.splice(0);
  await Promise.all(
    stubs.map(
      (stub) =>
        new Promise<void>((resolve) => {
          stub.closeAllConnections();
          stub.close(() => resolve());
        }),
    ),
  );
});

interface UpstreamHit {
  method: string | undefined;
  url: string | undefined;
  host: string | undefined;
  authorization: string | undefined;
  customHeader: string | undefined;
  body: string;
}

/** 官方上游 stub：记录命中并回 JSON（透传断言用）；stamp 头验证响应头透传 */
async function startUpstreamStub(): Promise<{ port: number; hits: UpstreamHit[] }> {
  const hits: UpstreamHit[] = [];
  const stub = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      // 单值化：Node 头重复时为数组，本用例只发单值
      const first = (value: string | string[] | undefined): string | undefined =>
        Array.isArray(value) ? value[0] : value;
      hits.push({
        method: request.method,
        url: request.url,
        host: first(request.headers.host),
        authorization: first(request.headers.authorization),
        customHeader: first(request.headers["x-relay-proof"]),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "Content-Type": "application/json", "x-upstream-stamp": "yes" });
      response.end(JSON.stringify({ ok: true, echoUrl: request.url }));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  upstreamStubs.push(stub);
  const address = stub.address();
  if (address === null || typeof address === "string") throw new Error("stub 未取得端口");
  return { port: address.port, hits };
}

describe("STATIC_ROOT 静态托管（spec §8.6）", () => {
  it("/remote/v4 精确路径回 index.html：no-cache + text/html（桌面升级后必须拿到新入口）", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    const response = await fetch(`${relay.httpUrl}/remote/v4`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toContain("v4-entry");
  });

  it("未命中文件 SPA fallback 回 index.html（含 /remote/v4/ 与深层路由，均 no-cache）", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    for (const path of ["/remote/v4/", "/remote/v4/devices", "/remote/v4/some/deep/route"]) {
      const response = await fetch(`${relay.httpUrl}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("no-cache");
      expect(await response.text(), path).toContain("v4-entry");
    }
  });

  it("hash 资产命中真实文件：text/javascript + immutable；无哈希文件 robots.txt no-cache", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    const asset = await fetch(`${relay.httpUrl}/remote/v4/assets/app-B1GH2xXj.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await asset.text()).toBe("console.log('v4-app');\n");
    const robots = await fetch(`${relay.httpUrl}/remote/v4/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("cache-control")).toBe("no-cache");
  });

  it("HEAD 返回与 GET 同形的头（Content-Length 为文件长度）与空 body", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    const response = await fetch(`${relay.httpUrl}/remote/v4`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-length")).toBe(
      String("<!doctype html><title>v4-entry</title>".length),
    );
    expect(await response.text()).toBe("");
  });

  it("防路径穿越（fetch 端到端）：..%2f 编码 decode 后逃出 root → 403，root 外文件不可达", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    // WHATWG URL 客户端不规范化 ..%2f（非纯点段），能原样到达服务端 decode 闸
    const response = await fetch(`${relay.httpUrl}/remote/v4/..%2fsecret-outside.txt`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("outside");
  });

  it.each([
    "/remote/v4/%2e%2e/%2e%2e/secret-outside.txt",
    "/remote/v4/assets/%2e%2e/%2e%2e/secret-outside.txt",
  ])(
    "编码点段不泄露：%s 被 WHATWG URL 规范化收敛后落出静态范围，root 外文件内容不可达",
    async (rawPath) => {
      const { root, tempDir } = await makeStaticRoot();
      registeredTempDirs.push(tempDir);
      const relay = await startRelay({ staticRoot: root });
      // %2e%2e 系在服务端 new URL().pathname 即被规范化（点段收敛），请求落在 relay API 面
      // 被鉴权前置拒绝（401）——安全属性一致：root 外内容永不出现在响应体
      const result = await rawGet(relay.httpUrl, rawPath);
      expect(result.status, rawPath).not.toBe(200);
      expect(result.body, rawPath).not.toContain("outside");
    },
  );

  it.each([
    "/remote/v4/assets/..%2f..%2fsecret-outside.txt",
    "/remote/v4/..%2f..%2f..%2fsecret-outside.txt",
    "/remote/v4/foo%00bar",
  ])(
    "防路径穿越（原始路径客户端）：%s decode 后逃出 root（或含非法字节）→ 403",
    async (rawPath) => {
      const { root, tempDir } = await makeStaticRoot();
      registeredTempDirs.push(tempDir);
      const relay = await startRelay({ staticRoot: root });
      // ..%2f 与 %00 不被 URL 规范化，须以原始 path 选项发送（非浏览器客户端攻击面）
      const result = await rawGet(relay.httpUrl, rawPath);
      expect(result.status, rawPath).toBe(403);
      expect(result.body, rawPath).not.toContain("outside");
    },
  );

  it("写方法 405（Allow: GET, HEAD）", async () => {
    const { root, tempDir } = await makeStaticRoot();
    registeredTempDirs.push(tempDir);
    const relay = await startRelay({ staticRoot: root });
    const response = await fetch(`${relay.httpUrl}/remote/v4/index.html`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("未启用（缺省）：/remote/v4* 保持既有 404 行为，不受静态分支影响", async () => {
    const relay = await startRelay();
    // 既有行为链：鉴权前置（无凭据 401）→ 有效凭据后未匹配 404 信封
    const noAuth = await api(relay, "/remote/v4");
    expect(noAuth.status).toBe(401);
    const result = await api(relay, "/remote/v4", { jwt: JWT_ALICE });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ code: 404, msg: "" });
    const nested = await api(relay, "/remote/v4/assets/app.js", { jwt: JWT_ALICE });
    expect(nested.status).toBe(404);
  });
});

describe("OFFICIAL_UPSTREAM_ORIGIN 官方回源（spec §8.6）", () => {
  it("catch-all：POST /api/v1/oauth/token 转发上游 stub，Host 重写为上游、body 与头透传、响应头透传", async () => {
    const { port, hits } = await startUpstreamStub();
    const relay = await startRelay({ officialUpstreamOrigin: `http://127.0.0.1:${port}` });
    const response = await fetch(`${relay.httpUrl}/api/v1/oauth/token?extra=1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mobile-drora-jwt",
        "x-relay-proof": "proof-value",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code: "oauth-code" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-upstream-stamp")).toBe("yes");
    expect(await response.json()).toEqual({ ok: true, echoUrl: "/api/v1/oauth/token?extra=1" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.method).toBe("POST");
    expect(hits[0]?.url).toBe("/api/v1/oauth/token?extra=1");
    // Host 重写：上游必须看到自己的 host（Caddy header_up Host {upstream_hostport} 同义），
    // 透传自建域会被官方源站按 Host 路由拒绝（spec §8.1/§8.6）
    expect(hits[0]?.host).toBe(`127.0.0.1:${port}`);
    expect(hits[0]?.authorization).toBe("Bearer mobile-drora-jwt");
    expect(hits[0]?.customHeader).toBe("proof-value");
    expect(hits[0]?.body).toBe(
      JSON.stringify({ grant_type: "authorization_code", code: "oauth-code" }),
    );
  });

  it("relay 自有面不走代理：/api/v1/remote/* 与 /healthz 由本服务应答，上游零命中", async () => {
    const { port, hits } = await startUpstreamStub();
    const relay = await startRelay({ officialUpstreamOrigin: `http://127.0.0.1:${port}` });
    const list = await api(relay, "/api/v1/remote/device", { jwt: JWT_ALICE });
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ code: 0, msg: "", data: [] });
    const health = await fetch(`${relay.httpUrl}/healthz`);
    expect(health.status).toBe(200);
    const view = (await health.json()) as { uptime: number; connections: number };
    expect(typeof view.uptime).toBe("number");
    expect(view.connections).toBe(0);
    expect(hits).toHaveLength(0);
  });

  it("上游不可达 → 502 JSON 信封（spec §8.6 规则 3）", async () => {
    // 探一个空闲端口后不监听：连接必然被拒
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const relay = await startRelay({ officialUpstreamOrigin: `http://127.0.0.1:${deadPort}` });
    const response = await fetch(`${relay.httpUrl}/api/v1/oauth/token`, { method: "POST" });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ code: 502, msg: "official upstream unavailable" });
  });

  it("未启用（缺省）：非远控路径保持既有行为（鉴权前置 401/有效凭据 404），不触发回源", async () => {
    const relay = await startRelay();
    const noAuth = await api(relay, "/api/v1/oauth/token", {
      method: "POST",
      body: { grant_type: "authorization_code" },
    });
    expect(noAuth.status).toBe(401);
    const result = await api(relay, "/api/v1/oauth/token", {
      method: "POST",
      jwt: JWT_ALICE,
      body: { grant_type: "authorization_code" },
    });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ code: 404, msg: "" });
  });
});
