// 同源链路 L1-lite 验证与常驻门禁（specs/relay-v2-server.md §8.1/§8.2/§10；登记见 §10「自动化门禁」）。
// 单脚本起三件并打真实 HTTP，全部流量打前置同源入口（生产里的自建域，Caddy 的角色）：
//   1) relay：dist 产物子进程（临时 DB + JWT_MODE=stub + JWT_STUB_USERS 进程级配置，
//      同 tools/smoke-process.mjs 形状），监听端口 A；
//   2) 静态服务：in-process http 服务挂 packages/web/dist（缺失时先经钉版工具链跑
//      build:web-remote-control:v4，并按 spec §8.2 同时注入 VITE_ 与无 VITE_ 前缀双 env），
//      监听端口 B——对应生产 Caddy handle_path 剥前缀后的 file_server；
//   3) 前置同源入口：in-process http 服务监听端口 C，/api* 与 /healthz → relay（端口 A），
//      /remote/v4* 剥前缀 → 静态（端口 B），其余路径 404（生产 Caddy 的 catch-all 回源官方
//      不在 L1-lite 断言面内，spec §8.1）。
// 断言：
//   ① 页面 200（/remote/v4/ 与无尾斜杠 /remote/v4 均可达，spec §8.1）；
//   ② index.html 引用的资产逐个 200；
//   ③ 同源 GET /api/v1/remote/device 无凭据 → 401（src/http.ts 鉴权前置；证明 API 路径打到
//      本服务而非静态服务——静态侧缺失带扩展名文件回 404，不会伪造成 401）；
//   ④ 同源 /healthz 为本服务五字段视图（uptime/connections/owners/devices/counters，spec §9）；
//   ⑤ 页面产物烘焙非官方域：dist 文本资产（.js/.html/.css，不含 .map）含自建域正向、
//      无官方 redirect 字面量与官方内联 env 反例（与 tools/verify-v4-build.mjs 同款判别）。
// 运行：
//   node tools/verify-same-origin.mjs        （relay dist 需先 pnpm --filter @drora/relay-v2-server run build）
//
// 实现约束：
// - 静态服务对「带扩展名但文件缺失」的请求回 404 而非 SPA 回退（有意偏离 Caddy
//   try_files {path} /index.html 的全量回退）：否则断言②里缺失的 .js 会被 index.html
//   顶替成 200，门禁失去暴露产物缺失的能力；无扩展名路径才回退 index.html（SPA 导航语义）。
// - WS 转发不在本工具范围（断言面只有 HTTP）：WS 配对链路由 tools/smoke-process.mjs 对
//   relay 直连覆盖；生产 WS 反代由 Caddy 承担（deploy/Caddyfile）。
// - 输出统一走 process.stdout/stderr.write（禁 console.log，仓库日志纪律）；子进程/构建
//   输出仅失败时回显尾部。退出码：0 通过；1 任一步失败。

import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

/** 自建域默认值与 tools/verify-v4-build.mjs:32 一致（即 deploy 默认 SITE_ADDRESS 的完整 origin） */
const SELF_HOSTED_ORIGIN = "https://relay.example.com";
const OFFICIAL_ORIGIN = "https://zcode.z.ai";
/** 官方域 redirect 推导的完整字面量（好构建中不应出现；判别式与 verify-v4-build.mjs:35 一致） */
const OFFICIAL_REDIRECT = `${OFFICIAL_ORIGIN}/remote/v4`;
/**
 * 坏构建（漏设 DRORA_ENDPOINT_ORIGIN）时 define 解析出的内联 env 对象条目形状
 * （与 verify-v4-build.mjs:42-43 同款：只认「名字后紧跟引号值」，源码回退链不受影响）
 */
const OFFICIAL_BAKE_SHAPE =
  /VITE_DRORA_(?:BASE_URL|ENDPOINT_ORIGIN)[`"']https:\/\/zcode\.z\.ai[`"']/;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`超时（${ms}ms）：${label}`)), ms).unref(),
    ),
  ]);

function probeFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** 轮询异步谓词直到成立（带超时） */
async function waitFor(predicate, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`超时（${ms}ms）：${label}`);
    await new Promise((resolveTick) => setTimeout(resolveTick, 25));
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`同源验证断言失败：${label}`);
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** listen 的 Promise 包装 */
function listenOn(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
}

/** 关闭 in-process 服务：先断 keep-alive 空闲连接（undici fetch 会持有），再 close */
function closeServer(server) {
  return new Promise((resolveClose) => {
    server.closeAllConnections();
    server.close(() => resolveClose());
  });
}

/** 递归收集目录下指定后缀的文本资产（不含 .map，理由同 verify-v4-build.mjs 头注） */
async function collectTextAssets(dir, suffixes, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTextAssets(full, suffixes, acc);
    } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      acc.push(full);
    }
  }
  return acc;
}

/** 静态文件 MIME（覆盖 /remote/v4 产物实际出现的类型；未知类型按二进制流） */
const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

/**
 * 静态服务（端口 B）：挂 distRoot，语义对齐生产 Caddy handle_path 剥前缀后的 file_server。
 * 带扩展名且文件缺失 → 404（见头注「实现约束」，让断言②能暴露产物缺失）；
 * 无扩展名路径缺失 → 回退 distRoot/index.html（SPA 导航，Caddy try_files 同款）。
 */
function startStaticServer(distRoot) {
  const resolvedRoot = resolve(distRoot);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("method not allowed");
        return;
      }
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      // 防目录穿越：resolve 后必须仍在 distRoot 内
      const requested = resolve(join(resolvedRoot, `.${pathname}`));
      if (requested !== resolvedRoot && !requested.startsWith(resolvedRoot + sep)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      let target = requested;
      let targetStat = await stat(target).catch(() => undefined);
      if (targetStat?.isDirectory()) {
        target = join(target, "index.html");
        targetStat = await stat(target).catch(() => undefined);
      }
      if (!targetStat) {
        if (extname(pathname) !== "") {
          // 带扩展名的缺失文件必须显性失败（见头注实现约束）
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("asset not found");
          return;
        }
        target = join(resolvedRoot, "index.html");
      }
      const body = await readFile(target);
      response.setHeader(
        "Content-Type",
        MIME_BY_EXT[extname(target).toLowerCase()] ?? "application/octet-stream",
      );
      response.writeHead(200);
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      err(
        `静态服务处理 ${request.url} 异常：${error instanceof Error ? error.message : String(error)}`,
      );
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end("internal error");
    }
  });
  return server;
}

/**
 * 前置同源入口（端口 C）的一跳转发：透传方法/头（Host 改指上游）/请求体与响应。
 * overridePath 未提供时原样转发 req.url。
 */
function proxyTo(upstreamPort, request, response, overridePath) {
  const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}` };
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      path: overridePath ?? request.url,
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    err(`转发 ${request.url} → 127.0.0.1:${upstreamPort} 失败：${error.message}`);
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("bad gateway");
  });
  request.pipe(upstream);
}

/** 前置同源入口（端口 C）：/api*、/healthz → relay；/remote/v4* 剥前缀 → 静态；其余 404 */
function startFrontServer(relayPort, staticPort) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/healthz") {
      proxyTo(relayPort, request, response);
      return;
    }
    // Caddy handle_path /remote/v4* 同款：剥掉前缀后转静态（保留查询串）
    if (pathname === "/remote/v4" || pathname.startsWith("/remote/v4/")) {
      const searchIndex = (request.url ?? "/").indexOf("?");
      const search = searchIndex >= 0 ? request.url.slice(searchIndex) : "";
      const stripped = pathname.slice("/remote/v4".length) || "/";
      proxyTo(staticPort, request, response, stripped + search);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not proxied by L1-lite front (生产 Caddy catch-all 回源官方，不在断言面)");
  });
  return server;
}

/** relay dist 产物子进程（smoke-process.mjs 同款装配：loadConfigFromEnv + createJwtAuth） */
async function startRelayChild(packageRoot, workDir) {
  const distEntry = join(packageRoot, "dist", "relay-v2-server.js");
  if (!(await isFile(distEntry))) {
    throw new Error(
      `构建产物不存在：${distEntry}（先运行 pnpm --filter @drora/relay-v2-server run build，` +
        "本机无 mise 时先 source 钉版工具链环境 .zcode/toolchain-env.sh）",
    );
  }
  const bootstrapPath = join(workDir, "same-origin-bootstrap.mjs");
  await writeFile(
    bootstrapPath,
    [
      `import * as relay from ${JSON.stringify(pathToFileURL(distEntry).href)};`,
      `const config = relay.loadConfigFromEnv(process.env);`,
      `const handle = await relay.createRelayServer({ config, auth: relay.createJwtAuth({ config }) });`,
      `process.stdout.write("SAME_ORIGIN_RELAY_PORT=" + handle.port + "\\n");`,
      `for (const signal of ["SIGTERM", "SIGINT"]) {`,
      `  process.on(signal, () => {`,
      `    void handle.stop().then(() => process.exit(0), () => process.exit(1));`,
      `  });`,
      `}`,
      "",
    ].join("\n"),
    "utf8",
  );
  const listenPort = await probeFreePort();
  // 进程级配置注入（spec §9）：临时 DB + stub 鉴权（仅测试/冒烟可用，spec §9/§12 M1）
  const child = spawn(process.execPath, [bootstrapPath], {
    env: {
      ...process.env,
      BIND_HOST: "127.0.0.1",
      LISTEN_PORT: String(listenPort),
      DB_PATH: join(workDir, "devices.sqlite"),
      JWT_MODE: "stub",
      JWT_STUB_USERS: JSON.stringify({ "same-origin-jwt": "same-origin-user" }),
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  const exitedEarly = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const port = await Promise.race([
    waitFor(
      () => {
        const text = Buffer.concat(stdoutChunks).toString("utf8");
        const match = text.match(/^SAME_ORIGIN_RELAY_PORT=(\d+)$/m);
        return match ? Number(match[1]) : undefined;
      },
      15_000,
      "relay 子进程未在时限内报告监听端口",
    ),
    exitedEarly.then(({ code, signal }) => {
      throw new Error(
        `relay 子进程提前退出（code=${code} signal=${signal}）\n` +
          `stderr 尾部：\n${Buffer.concat(stderrChunks).toString("utf8").split("\n").slice(-10).join("\n")}`,
      );
    }),
  ]);
  return { child, port, stdoutChunks, stderrChunks };
}

/**
 * packages/web/dist 缺失时经钉版工具链构建（spec §8.2：VITE_ 与无 VITE_ 前缀双 env 必须同时
 * 注入，否则产物烘焙官方域、断言⑤会失败）。工具链 env 脚本定位：worktree 内 .zcode/ 或
 * 主仓 .zcode/（worktree 位于主仓 .zcode/worktrees/ 下时为其上两级）。
 */
async function ensureWebDist(repoRoot, webRoot) {
  if (await isFile(join(webRoot, "dist", "index.html"))) return;
  out("packages/web/dist 缺失，经钉版工具链构建 build:web-remote-control:v4（§8.2 双 env）…");
  const envScriptCandidates = [
    join(repoRoot, ".zcode", "toolchain-env.sh"),
    join(repoRoot, "..", "..", "toolchain-env.sh"),
  ];
  const envScriptResolved = await (async () => {
    for (const candidate of envScriptCandidates) {
      if (await isFile(candidate)) return candidate;
    }
    return undefined;
  })();
  if (envScriptResolved === undefined) {
    throw new Error(
      `找不到钉版工具链 env 脚本（尝试过 ${envScriptCandidates.join("、")}）；` +
        "请先 source 工具链环境并手动运行 pnpm build:web-remote-control:v4（双 env 注入，spec §8.2）",
    );
  }
  const quoted = `'${envScriptResolved.replaceAll("'", `'\\''`)}'`;
  const child = spawn(
    "bash",
    ["-c", `source ${quoted} && pnpm build:web-remote-control:v4`],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_DRORA_ENDPOINT_ORIGIN: SELF_HOSTED_ORIGIN,
        DRORA_ENDPOINT_ORIGIN: SELF_HOSTED_ORIGIN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  const exit = await withTimeout(
    new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal }))),
    300_000,
    "vite build 未在时限内结束",
  );
  if (exit.code !== 0) {
    const tail = Buffer.concat(chunks).toString("utf8").split("\n").slice(-15).join("\n");
    throw new Error(
      `build:web-remote-control:v4 失败（code=${exit.code} signal=${exit.signal}），输出尾部：\n${tail}`,
    );
  }
  if (!(await isFile(join(webRoot, "dist", "index.html")))) {
    throw new Error("构建已退出但 packages/web/dist/index.html 仍不存在");
  }
}

/** 从 index.html 提取资产引用（src/href），剔除 data:/绝对 URL/纯锚点 */
function extractAssetRefs(html) {
  const refs = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (
      ref.startsWith("data:") ||
      ref.startsWith("http://") ||
      ref.startsWith("https://") ||
      ref.startsWith("//") ||
      ref.startsWith("#") ||
      ref === ""
    ) {
      continue;
    }
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

async function main() {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const repoRoot = join(packageRoot, "..", "..");
  const webRoot = join(repoRoot, "packages", "web");
  const distRoot = join(webRoot, "dist");

  const workDir = await mkdtemp(join(tmpdir(), "relay-v2-same-origin-"));
  let relayChild;
  let staticServer;
  let frontServer;
  try {
    await ensureWebDist(repoRoot, webRoot);

    out("[1/9] 启动 relay dist 产物子进程（临时 DB + JWT_MODE=stub）");
    const relay = await startRelayChild(packageRoot, workDir);
    relayChild = relay.child;
    out(`[2/9] relay 监听 127.0.0.1:${relay.port}`);

    out("[3/9] 启动静态服务（挂 packages/web/dist）与前置同源入口");
    staticServer = startStaticServer(distRoot);
    await listenOn(staticServer, await probeFreePort());
    const staticPort = staticServer.address().port;
    frontServer = startFrontServer(relay.port, staticPort);
    await listenOn(frontServer, await probeFreePort());
    const frontPort = frontServer.address().port;
    const front = `http://127.0.0.1:${frontPort}`;
    out(`[4/9] 静态 127.0.0.1:${staticPort}，前置同源入口 ${front}`);

    // ① 页面 200：/remote/v4/ 与无尾斜杠均需可达（spec §8.1）
    for (const pagePath of ["/remote/v4/", "/remote/v4"]) {
      const response = await withTimeout(
        fetch(`${front}${pagePath}`),
        10_000,
        `GET ${pagePath}`,
      );
      const body = await response.text();
      assert(response.status === 200, `页面 ${pagePath} 应 200，实得 ${response.status}`);
      assert(
        (response.headers.get("content-type") ?? "").includes("text/html"),
        `页面 ${pagePath} content-type 应为 text/html，实得 ${response.headers.get("content-type")}`,
      );
      assert(body.trim().length > 0, `页面 ${pagePath} 响应体为空`);
    }
    out("[5/9] ① 页面 200 通过（含无尾斜杠形态）");

    // ② 页面引用的资产逐个 200（404 规则见头注：带扩展名缺失必失败，200 不会是 SPA 回退顶替）
    const indexHtml = await readFile(join(distRoot, "index.html"), "utf8");
    const assetRefs = extractAssetRefs(indexHtml);
    assert(assetRefs.length > 0, "index.html 未解析出任何资产引用");
    for (const ref of assetRefs) {
      const url = ref.startsWith("/")
        ? `${front}${ref}`
        : `${front}/remote/v4/${ref.replaceAll(/^\.\//, "")}`;
      const response = await withTimeout(fetch(url), 10_000, `GET ${ref}`);
      assert(response.status === 200, `资产 ${ref} 应 200，实得 ${response.status}（${url}）`);
    }
    out("[6/9] ② 资产逐个 200 通过（共 " + String(assetRefs.length) + " 个引用）");

    // ③ 同源 API 无凭据 → 401（http.ts 鉴权前置；静态侧对带扩展名缺失回 404，不会伪装成 401）
    const unauthorized = await withTimeout(
      fetch(`${front}/api/v1/remote/device`),
      10_000,
      "GET /api/v1/remote/device（无凭据）",
    );
    await unauthorized.text().catch(() => {});
    assert(
      unauthorized.status === 401,
      `同源 /api/v1/remote/device 无凭据应 401，实得 ${unauthorized.status}（API 路径未打到本服务？）`,
    );
    out("[7/9] ③ 同源 /api/v1/remote/device 无凭据 401 通过（API 路径打到本服务）");

    // ④ 同源 /healthz 为本服务五字段视图（spec §9：uptime/connections/owners/devices/counters）
    const healthResponse = await withTimeout(
      fetch(`${front}/healthz`),
      10_000,
      "GET /healthz（经前置入口）",
    );
    const health = await healthResponse.json();
    assert(healthResponse.status === 200, `/healthz 应 200，实得 ${healthResponse.status}`);
    assert(
      typeof health.uptime === "number" &&
        health.connections === 0 &&
        health.owners === 0 &&
        health.devices === 0 &&
        health.counters?.device?.framesIn === 0,
      `/healthz 视图不符合 spec §9：${JSON.stringify(health)}`,
    );
    out("[8/9] ④ 同源 /healthz 五字段视图通过");

    // ⑤ 页面产物烘焙非官方域（verify-v4-build.mjs 同款判别：.js/.html/.css，不含 .map）
    const assets = await collectTextAssets(distRoot, [".js", ".html", ".css"]);
    assert(assets.length > 0, "dist 下没有任何 .js/.html/.css 资产");
    const bodies = await Promise.all(assets.map(async (path) => readFile(path, "utf8")));
    assert(
      bodies.some((body) => body.includes(SELF_HOSTED_ORIGIN)),
      `产物未烘焙自建域 ${SELF_HOSTED_ORIGIN}——检查构建是否漏设 DRORA_ENDPOINT_ORIGIN（spec §8.2 实测注记）`,
    );
    const officialRedirectHit = assets.findIndex((_, index) =>
      bodies[index].includes(OFFICIAL_REDIRECT),
    );
    assert(
      officialRedirectHit < 0,
      `${assets[officialRedirectHit]} 烘焙了官方域 redirect ${OFFICIAL_REDIRECT}`,
    );
    const bakeShapeHit = assets.findIndex((_, index) => OFFICIAL_BAKE_SHAPE.test(bodies[index]));
    assert(
      bakeShapeHit < 0,
      `${assets[bakeShapeHit]} 的内联 env 仍是官方域（VITE_DRORA_BASE_URL/ENDPOINT_ORIGIN → ${OFFICIAL_ORIGIN}）`,
    );
    out(`[9/9] ⑤ 产物烘焙非官方域通过（扫描 ${assets.length} 个文本资产）`);
    out("同源链路验证通过：页面/资产 200 + 无凭据 401 + healthz 五字段 + 非官方域烘焙");
  } finally {
    if (relayChild !== undefined && relayChild.exitCode === null && relayChild.signalCode === null) {
      relayChild.kill("SIGKILL");
    }
    if (frontServer !== undefined) await closeServer(frontServer).catch(() => {});
    if (staticServer !== undefined) await closeServer(staticServer).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

try {
  await main();
} catch (failure) {
  err(`verify-same-origin 失败：${failure instanceof Error ? failure.message : String(failure)}`);
  process.exitCode = 1;
}
