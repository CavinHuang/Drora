// 内建官方页资产代理测试（specs/mobile-relay-server.md §12.9）：
// - 命中顺序：staticRoot → cacheDir 缓存 → fetch 官方源站（fetchImpl 依赖注入，
//   不污染 global；缓存存原始字节、改写只在出站做）；
// - 离线回退：入口文档 302 → /m/index.html（保留查询串）；其余资产 404；
// - 安全：越界 pathname 不读盘也不请求源站；缓存写失败降级直出不缓存。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createDeviceRegistry, createFileDeviceRegistryStorage } from "../src/index.js";
import { OFFICIAL_PAGE_ORIGIN, serveHostedAsset } from "../src/staticAssets.js";
import { createRelayServer } from "../src/relayServer.js";

const tempDirs: string[] = [];
const openServers: Array<{ close(): Promise<void> }> = [];
after(async () => {
  // 兜底关服：断言失败跳过测试内 close 时，不得拖死测试进程（close 幂等）。
  for (const server of openServers) await server.close().catch(() => {});
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

function makeRegistry(dir: string) {
  return createDeviceRegistry({
    storage: createFileDeviceRegistryStorage(join(dir, "db.json")),
  });
}

/** fetch mock：记录调用 URL，按 responder 产响应（含 throw=网络失败）。 */
function mockFetch(responder: (url: string) => Response): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return responder(url);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function startServer(options: Parameters<typeof createRelayServer>[0]) {
  const server = createRelayServer(options);
  openServers.push(server);
  const port = await server.listen();
  return { server, port, base: `http://127.0.0.1:${port}` };
}

test("内建资产代理：未命中→fetch→出站改写→缓存落盘原始字节→二次请求不再 fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-ra1-"));
  tempDirs.push(dir);
  const cacheDir = join(dir, "remote-assets");
  // 官方 bundle 字面量形状（spec §12.5）：硬编码 wss 端点 + endpointOrigin。
  const jsSource = "var ws=`wss://zcode.z.ai/ws`;var eo={endpointOrigin:`https://zcode.z.ai`};";
  const entryHtml = "<!doctype html><html><body>v4-entry</body></html>";
  // mock 按 URL 分流：JS chunk 与无扩展名入口文档各自返回对应内容。
  const { fetchImpl, calls } = mockFetch((url) =>
    url.endsWith("/remote/v4")
      ? new Response(entryHtml, { status: 200 })
      : new Response(jsSource, { status: 200 }),
  );
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    remoteAssets: { cacheDir },
    fetchImpl,
  });
  const assetUrl = "/remote/v4/3.14.3/assets/app-test.js";

  // 首次请求：fetch 官方源站 → 200 + 出站改写动态同源端点。
  const first = await fetch(`${base}${assetUrl}`);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("content-type") ?? "", /text\/javascript/u);
  const body1 = await first.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${OFFICIAL_PAGE_ORIGIN}${assetUrl}`, "fetch 目标=官方源站同 pathname");
  assert.ok(
    body1.includes(
      "(window.location.protocol===`https:`?`wss:`:`ws:`)+`//`+window.location.host+`/ws`",
    ),
    "硬编码 wss 端点必须改写为动态同源",
  );
  assert.ok(body1.includes("endpointOrigin:window.location.origin"));
  assert.ok(!body1.includes("__selfhostPatch"), "JS 不得注入诊断副作用");
  assert.ok(!body1.includes("zcode.z.ai"), "改写后不得残留官方源站字面量");

  // 缓存落盘为原始字节（无改写、无标记）——改写规则演进时缓存仍有效（spec §12.9）。
  const cached = await readFile(
    join(cacheDir, "remote", "v4", "3.14.3", "assets", "app-test.js"),
    "utf8",
  );
  assert.equal(cached, jsSource, "缓存必须存原始字节");

  // 二次请求：缓存命中，不再 fetch；出站改写与首次一致。
  const second = await fetch(`${base}${assetUrl}`);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), body1, "缓存命中路径与首次出站改写结果一致");
  assert.equal(calls.length, 1, "二次请求必须命中缓存，不再 fetch");

  // 无扩展名入口 /remote/v4：官方直接出 HTML 文档 → 按无扩展名回 text/html 并缓存。
  calls.length = 0;
  const entry = await fetch(`${base}/remote/v4`);
  assert.equal(entry.status, 200);
  assert.match(entry.headers.get("content-type") ?? "", /text\/html/u);
  assert.ok((await entry.text()).includes("v4-entry"));
  assert.equal(calls.length, 1, "入口未命中缓存时 fetch 一次");
  // 入口（无扩展名）按 staticRoot 约定落 index.html——与 /remote/v4/<ver>/assets/*
  // 的目录树共存（spec §12.9 缓存布局）。
  assert.equal(await readFile(join(cacheDir, "remote", "v4", "index.html"), "utf8"), entryHtml);
  const entryAgain = await fetch(`${base}/remote/v4`);
  assert.equal(calls.length, 1, "入口二次请求命中缓存不再 fetch");
  assert.ok((await entryAgain.text()).includes("v4-entry"));
  await server.close();
});

test("离线回退：入口文档 302 → /m/index.html 保留查询串；chunk 404", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-ra2-"));
  tempDirs.push(dir);
  const offline = mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    remoteAssets: { cacheDir: join(dir, "cache") },
    fetchImpl: offline.fetchImpl,
  });
  // 入口文档（/remote/v4）离线 → 302 保留 QR 查询串（sid/hash 透传给 R2 页）。
  const entry = await fetch(`${base}/remote/v4?sid=d_abc&hash=xyz`, { redirect: "manual" });
  assert.equal(entry.status, 302);
  assert.equal(entry.headers.get("location"), "/m/index.html?sid=d_abc&hash=xyz");
  // 入口的 index.html 形态同样回退（无查询串 → 无查询后缀）。
  const entryIndex = await fetch(`${base}/remote/v4/index.html`, { redirect: "manual" });
  assert.equal(entryIndex.status, 302);
  assert.equal(entryIndex.headers.get("location"), "/m/index.html");
  // chunk 离线 → 404（页面自身有失败面，重定向无意义）。
  const chunk = await fetch(`${base}/remote/v4/3.14.3/assets/chunk-a.js`);
  assert.equal(chunk.status, 404);
  await server.close();

  // 源站非 200（如 5xx）按同样回退语义处理。
  const down = mockFetch(() => new Response("down", { status: 503 }));
  const { server: server2, base: base2 } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    remoteAssets: { cacheDir: join(dir, "cache2") },
    fetchImpl: down.fetchImpl,
  });
  const entry2 = await fetch(`${base2}/remote/v4?sid=d_x`, { redirect: "manual" });
  assert.equal(entry2.status, 302, "非 200 与网络失败同回退语义");
  const chunk2 = await fetch(`${base2}/remote/v4/1.0.0/assets/a.js`);
  assert.equal(chunk2.status, 404);
  await server2.close();
});

test("staticRoot 优先级不变：命中不经代理，未命中落入 cache→fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-ra3-"));
  tempDirs.push(dir);
  // 目录树镜像官方资产布局：<staticRoot>/remote/v4/index.html（静态根只有入口）。
  const webRoot = join(dir, "site");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(webRoot, "remote", "v4"), { recursive: true });
  await writeFile(join(webRoot, "remote", "v4", "index.html"), "static-root-entry");
  const counting = mockFetch(() => new Response("proxied-entry", { status: 200 }));
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    staticRoot: webRoot,
    remoteAssets: { cacheDir: join(dir, "cache") },
    fetchImpl: counting.fetchImpl,
  });
  // staticRoot 命中：直接服务，fetch 不发生。
  const fromRoot = await fetch(`${base}/remote/v4/index.html`);
  assert.equal(fromRoot.status, 200);
  assert.ok((await fromRoot.text()).includes("static-root-entry"));
  assert.equal(counting.calls.length, 0, "staticRoot 命中不得触发代理 fetch");
  // staticRoot 未命中：落入内建代理（cache→fetch）。
  const proxied = await fetch(`${base}/remote/v4/other.js`);
  assert.equal(proxied.status, 200);
  assert.equal(await proxied.text(), "proxied-entry");
  assert.equal(counting.calls.length, 1, "staticRoot 未命中必须落入代理");
  await server.close();

  // 对照：仅 remoteAssets（无 staticRoot）时入口走代理。
  const proxyOnly = mockFetch(() => new Response("proxy-only-entry", { status: 200 }));
  const { server: server2, base: base2 } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    remoteAssets: { cacheDir: join(dir, "cache-only") },
    fetchImpl: proxyOnly.fetchImpl,
  });
  const entry = await fetch(`${base2}/remote/v4/index.html`);
  assert.equal(entry.status, 200);
  assert.ok((await entry.text()).includes("proxy-only-entry"));
  assert.equal(proxyOnly.calls.length, 1);
  await server2.close();
});

test("安全与降级：越界 pathname 不读盘不 fetch；缓存写失败降级直出", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-ra4-"));
  tempDirs.push(dir);
  const cacheDir = join(dir, "cache");
  const { fetchImpl, calls } = mockFetch(() => new Response("should-not-serve", { status: 200 }));
  // 越界 pathname（防穿越，spec §12.5 约束延伸到代理）：拒绝且连源站都不请求。
  const escaped = await serveHostedAsset({
    pathname: "/../secret.js",
    cacheDirAbs: cacheDir,
    fetchImpl,
  });
  assert.equal(escaped, null);
  assert.equal(calls.length, 0, "越界 pathname 不得触发 fetch");
  // 缓存写失败（cacheDir 是普通文件，mkdir/writeFile 必败）→ 降级直出不缓存。
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "I am a file");
  const served = await serveHostedAsset({
    pathname: "/remote/v4/x.js",
    cacheDirAbs: blocker,
    fetchImpl,
  });
  assert.ok(served, "缓存写失败仍须直出服务");
  assert.equal(String(served.body), "should-not-serve");
  assert.equal(calls.length, 1);
  // 防穿越守卫对 HTTP 面同样生效（URL 解析归一 + 分支前缀）：. 段不落入 /remote/**。
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    remoteAssets: { cacheDir },
    fetchImpl,
  });
  const dotEscape = await fetch(`${base}/remote/../../secret.js`);
  assert.equal(dotEscape.status, 404);
  assert.equal(calls.length, 1, "URL 归一后的非 /remote 路径不进代理分支");
  await server.close();
});

test("独立 mobile-web 恢复稿离线托管：入口、版本 chunk 和同源 WS 改写", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-mobile-web-"));
  tempDirs.push(dir);
  const mobileRoot = fileURLToPath(new URL("../../mobile-web/src/recovered/", import.meta.url));
  const { fetchImpl, calls } = mockFetch(() => {
    throw new Error("本地资产命中时不应请求官方源站");
  });
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    mobileRoot,
    fetchImpl,
  });
  const entry = await fetch(`${base}/remote/v4?sid=test&hash=example`);
  assert.equal(entry.status, 200);
  assert.match(entry.headers.get("content-type") ?? "", /text\/html/u);
  assert.match(await entry.text(), /3\.14\.3\/assets\/index-/u);
  const app = await fetch(`${base}/remote/v4/3.14.3/assets/index-NjWRUABD.js`);
  assert.equal(app.status, 200);
  const js = await app.text();
  assert.ok(js.startsWith("// 还原自发行 bundle"));
  assert.ok(!js.includes("__selfhostPatch"));
  assert.ok(!js.includes("`wss://zcode.z.ai/ws`"));
  const workerPath = "remote/v4/3.14.3/assets/diffs.worker-CAavpt0L.js";
  const worker = await fetch(`${base}/${workerPath}`);
  assert.equal(worker.status, 200);
  assert.equal(await worker.text(), await readFile(join(mobileRoot, workerPath), "utf8"));
  const missing = await fetch(`${base}/remote/v4/3.14.3/assets/missing.js`);
  assert.equal(missing.status, 404);
  assert.equal(calls.length, 0);
  await server.close();
});

test("本地托管对二进制页面资产保持字节不变", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-relay-binary-"));
  tempDirs.push(dir);
  const mobileRoot = join(dir, "mobile");
  const assetDir = join(mobileRoot, "remote", "v4", "3.14.3", "assets");
  await mkdir(assetDir, { recursive: true });
  const binary = Buffer.from([0, 255, 80, 78, 71, 0, 128]);
  await writeFile(join(assetDir, "sample.png"), binary);
  const { server, base } = await startServer({
    registry: makeRegistry(dir),
    port: 0,
    mobileRoot,
  });
  const response = await fetch(`${base}/remote/v4/3.14.3/assets/sample.png`);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);
  const fallback = await fetch(`${base}/remote/v4?sid=local`, { redirect: "manual" });
  assert.equal(fallback.status, 302);
  assert.equal(fallback.headers.get("location"), "/m/index.html?sid=local");
  await server.close();
});
