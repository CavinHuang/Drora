// 官方站点全量抓取脚本：从 /remote/v4 入口页出发，递归发现并下载全部静态资源
// （含 vite 懒加载 chunk——动态 import 与 __vitePreload 依赖表中的相对路径引用），
// 产物落盘 remote-dist/（取证镜像，不进 bundled 候选链，见 README「remote-dist」段）。
//
// 用法：
//   node scripts/capture-remote-dist.mjs --url "<完整入口 URL>" [--out remote-dist]
//
// 已知例外（非抓取缺陷，README 有记录）：官方源站即 404 的 docx_wasm_bg.js、
// duke_sheets_wasm_bg.js，脚本以 manifest.missing 记录而非视为失败。

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- 参数解析 ----
// URL 经 --url-file 传入：入口地址含 & 与百分号编码，走命令行参数会被
// Windows shell 拆断，导致丢了 app_version 钉版参数、抓到 latest 版本树。
const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const urlArg = argOf("--url", "");
const urlFileArg = argOf("--url-file", "");
if (!urlArg && !urlFileArg) {
  throw new Error("pass the entry URL via --url-file <file> (shell-safe) or --url");
}
const entryUrl = new URL(
  urlFileArg ? (await readFile(resolve(packageRoot, urlFileArg), "utf8")).trim() : urlArg,
);
const outDir = resolve(packageRoot, argOf("--out", "remote-dist"));
const origin = entryUrl.origin;
const relativeOut = relative(packageRoot, outDir);
if (relativeOut.startsWith(`..`) || resolve(packageRoot) === outDir) {
  throw new Error("output dir must stay inside the package");
}

// ---- 引用发现 ----
const ASSET_EXT = String.raw`js|mjs|css|json|wasm|png|svg|jpe?g|gif|webp|ico|woff2?|ttf|otf|eot|mp3|mp4|html`;
// 引号内字符串 + CSS url(...) 两种载体；带 hash 的裸文件名也算（vite 产物形状）。
const REF_PATTERNS = [
  new RegExp(String.raw`["']([^"']*\.(?:${ASSET_EXT}))(?:\?[^"']*)?["']`, "g"),
  new RegExp(String.raw`url\(\s*([^)'"\s]+\.(?:${ASSET_EXT}))\s*\)`, "g"),
];

function extractRefs(text) {
  const refs = [];
  for (const pattern of REF_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) refs.push(match[1]);
  }
  // 只保留合法 URL 路径字符：排除 JS 里的正则字面量、自然语言串等误报
  //（如 `*，。！？；：、]+\.html`、裸 `.mp3` 这类碎片）。
  return refs.filter((ref) => /^[\w@./-]+$/.test(ref));
}

function isScannable(path) {
  return /\.(js|mjs|css|html)$/i.test(path);
}

// 相对引用按当前资源目录解析；绝对路径按站点根解析；跨域/data#/ 一律跳过。
function resolveRef(ref, fromPath) {
  if (ref.startsWith("data:") || ref.startsWith("#") || ref.startsWith("mailto:")) return null;
  if (ref.startsWith("//")) return null;
  if (/^https?:\/\//i.test(ref)) {
    const url = new URL(ref);
    return url.origin === origin ? normalizePath(url) : null;
  }
  const cleaned = ref.split(/[?#]/)[0];
  if (!cleaned) return null;
  if (cleaned.startsWith("/")) return cleaned;
  const baseDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "/";
  const segments = (baseDir + cleaned).split("/");
  const stack = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return `/${stack.join("/")}`;
}

function normalizePath(url) {
  return url.pathname;
}

// ---- 抓取状态 ----
const queued = new Set();
const fetched = new Map(); // path -> { bytes, changed: "new"|"identical"|"updated" }
const missing = new Map(); // path -> last status

// vite 产物签名：basename 以 -8位hash 结尾（cytoscape.esm-DrA8Ev2-.js 这类
// 多点合法名也符合）。不匹配 hash 形且原始引用不含斜杠的裸名（如语法高亮
// scope 串 `source.css`、`meta.embedded.json`）不是资源引用，不入队。
const HASHED_ASSET = new RegExp(String.raw`-[A-Za-z0-9_-]{8,}\.(${ASSET_EXT})$`, "i");

function enqueue(ref, path, fromPath) {
  if (!path || path === "/") return;
  // api-samples 是本地运行时 API 快照（取证副档），不属于静态资源闭包：
  // 不抓取、不从发现侧覆盖。
  if (path.startsWith("/api-samples/")) return;
  if (!HASHED_ASSET.test(path) && !ref.includes("/")) return;
  if (queued.has(path) || fetched.has(path) || missing.has(path)) return;
  queued.add(path);
  if (process.env.CAPTURE_VERBOSE) {
    console.log(`[capture] discover ${path}${fromPath ? ` (from ${fromPath})` : ""}`);
  }
}

// 修复依据：Windows Defender 会短暂锁住刚落盘的文件，紧随的回写偶发
// errno -4094(UNKNOWN)；带退避重试后可稳定通过（同 recover.mjs 的做法）。
async function writeFileWithRetry(path, data) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      if (attempt >= 4 || error.code !== "UNKNOWN") throw error;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

// 源站前置 WAF（阿里云 ESA）会按 TLS/HTTP 指纹拦截裸 Node fetch（同
// start-plan-3007 的「拦裸 Node 请求」机制），并对高频动态路由以 405 节流；
// 静态资产树不受影响。传输层统一走 curl 子进程（真实 curl 指纹），浏览器 UA，
// 405/429/5xx 一律退避重试。
const REQUEST_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const curlTmpRoot = await mkdtemp(join(tmpdir(), "drora-capture-"));
let curlSeq = 0;

async function curlFetch(url) {
  const bodyPath = join(curlTmpRoot, `body-${(curlSeq += 1)}.bin`);
  const status = await new Promise((resolveStatus, rejectStatus) => {
    execFile(
      "curl",
      [
        "--silent",
        "--show-error",
        "--location",
        "--max-redirs",
        "5",
        "--max-time",
        "60",
        "--user-agent",
        REQUEST_UA,
        "--referer",
        `${origin}/remote/v4`,
        "--header",
        "accept: */*",
        "--output",
        bodyPath,
        "--write-out",
        "%{http_code}",
        url,
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error) rejectStatus(error);
        else resolveStatus(Number(stdout.trim()));
      },
    );
  });
  const bytes = Buffer.from(await readFile(bodyPath));
  return { status, bytes };
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { status, bytes } = await curlFetch(url);
      if (status >= 200 && status < 300) return { ok: true, status, bytes };
      if (status === 404) return { ok: false, status, bytes: null };
      lastError = new Error(`HTTP ${status}`);
      if (status < 500 && status !== 429 && status !== 405) {
        return { ok: false, status, bytes: null };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  throw lastError;
}

// 站内引用本身就是合法 URL 路径（bundle 内出现形态即线上形态），按原样请求；
// 文件名落盘时做一次解码兜底（当前语料全为纯 ASCII，解码为恒等）。
function safeDecode(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function download(path) {
  const url = `${origin}${path}`;
  const response = await fetchWithRetry(url);
  if (response.status === 404) {
    missing.set(path, 404);
    return;
  }
  if (!response.ok) {
    missing.set(path, response.status);
    console.warn(`[capture] skip ${path}: HTTP ${response.status}`);
    return;
  }
  const bytes = response.bytes;
  const target = join(outDir, safeDecode(path).slice(1));
  let delta = "new";
  try {
    const existing = await readFile(target);
    delta = existing.equals(bytes) ? "identical" : "updated";
  } catch {
    // 本地不存在，按新文件处理。
  }
  if (delta !== "identical") {
    await mkdir(dirname(target), { recursive: true });
    await writeFileWithRetry(target, bytes);
  }
  fetched.set(path, { bytes: bytes.length, delta });
  if (isScannable(path)) {
    const text = bytes.toString("utf8");
    for (const ref of extractRefs(text)) {
      enqueue(ref, resolveRef(ref, path), path);
    }
  }
  // 跟随重定向由 curl --location 完成；资产树无重定向，不再追踪落点。
}

async function runPool(paths, worker, concurrency) {
  let cursor = 0;
  async function runner() {
    while (cursor < paths.length) {
      const item = paths[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner));
}

// ---- 入口与主流程 ----
async function fetchEntry(url, savePath, manifestUrl) {
  let response;
  try {
    response = await fetchWithRetry(url);
  } catch (error) {
    // WAF 对动态路由节流时（连 405 重试都耗尽），回退本地既有副本。
    response = { ok: false, status: 0, bytes: null, error };
  }
  if (!response.ok) {
    // 源站没有 /remote/v4.html 这样的静态别名时，回退到本地既有副本
    //（上一轮抓取即以 index.html 同字节副本充当静态宿主别名）。
    const fallback = join(outDir, savePath);
    try {
      const bytes = await readFile(fallback);
      console.warn(`[capture] entry ${url} -> HTTP ${response.status}, kept local alias copy`);
      fetched.set(`/${savePath}`, { bytes: bytes.length, delta: "kept" });
      return { path: `/${savePath}`, url: manifestUrl, versionRoots: [], alias: true };
    } catch {
      console.warn(`[capture] entry ${url} -> HTTP ${response.status}, skipped`);
      return null;
    }
  }
  const bytes = response.bytes;
  const target = join(outDir, savePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFileWithRetry(target, bytes);
  fetched.set(`/${savePath}`, { bytes: bytes.length, delta: "entry" });
  const html = bytes.toString("utf8");
  const versionRoots = new Set();
  for (const match of html.matchAll(/remote\/v4\/([^/"'\\)]+)\//g)) versionRoots.add(match[1]);
  if (versionRoots.size > 0) {
    console.log(`[capture] entry version roots: ${[...versionRoots].sort().join(", ")}`);
  }
  for (const ref of extractRefs(html)) {
    enqueue(ref, resolveRef(ref, savePath), savePath);
  }
  return { path: `/${savePath}`, url: manifestUrl, versionRoots: [...versionRoots] };
}

const previousManifestPath = join(outDir, "manifest.json");
let previousFiles = [];
try {
  const previous = JSON.parse(await readFile(previousManifestPath, "utf8"));
  previousFiles = Array.isArray(previous.files) ? previous.files : [];
} catch {
  console.warn("[capture] no previous manifest found, treating as fresh capture");
}

await mkdir(outDir, { recursive: true });
const entries = [];
const concurrency = Number(argOf("--concurrency", "6"));
const entry = await fetchEntry(entryUrl, "index.html", entryUrl.pathname);
if (entry) entries.push(entry);
const staticEntry = await fetchEntry(`${origin}/remote/v4.html`, "remote/v4.html", "/remote/v4.html");
if (staticEntry) entries.push(staticEntry);

let round = 0;
// ---- upstream 冻结清单种子：material-icons 等引用由运行时字符串拼接构造
//（`${base}/material-icons/${key}.svg`），静态扫描不可发现；以 upstream/remote
// 冻结副本的文件清单作为发现种子，再逐个回源验证。----
const upstreamRoot = join(packageRoot, "upstream", "remote");
async function walkFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(child)));
    else out.push(child);
  }
  return out;
}
try {
  const upstreamFiles = await walkFiles(upstreamRoot);
  let seeded = 0;
  for (const abs of upstreamFiles) {
    // upstream/remote/<v4/3.14.3/...> 对应站点路径 /remote/<v4/3.14.3/...>。
    const serverPath = `/remote/${relative(upstreamRoot, abs).split(/[\\/]/).join("/")}`;
    enqueue(serverPath, serverPath, "upstream-seed");
    seeded += 1;
  }
  console.log(`[capture] upstream seed: ${seeded} file(s) queued for revalidation`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.warn("[capture] upstream/remote snapshot absent, running pure-discovery capture");
}

while (queued.size > 0) {
  round += 1;
  const batch = [...queued];
  queued.clear();
  console.log(`[capture] round ${round}: ${batch.length} asset(s)`);
  await runPool(batch, download, concurrency);
}

// ---- api-samples 保留：运行时 API 快照属取证副档，不参与静态抓取 ----
const apiSampleFiles = previousFiles.filter((f) => f.path.startsWith("api-samples/"));
for (const file of apiSampleFiles) {
  try {
    const s = await stat(join(outDir, file.path));
    fetched.set(`/${file.path}`, { bytes: s.size, delta: "kept" });
  } catch {
    console.warn(`[capture] api-samples entry ${file.path} missing on disk, dropped from manifest`);
  }
}

// ---- manifest 汇总：发现闭包内每个引用都有终态（成功落盘或记录缺失） ----

// api-samples 只来自保留段（见下），静态文件列表剔除之，避免双计。
const staticPaths = [...fetched.keys()].filter((p) => !p.startsWith("/api-samples/")).sort();
const files = staticPaths.map((path) => {
  const alias = entries.some((e) => e.alias && e.path === path);
  return {
    path: path.slice(1),
    url: path,
    ...(alias ? { note: "本地别名副本（源站无此静态路径，与入口页同字节）" } : {}),
  };
});
const discoveredVersion = entries.flatMap((e) => e.versionRoots).find((v) => /^\d+\.\d+\.\d+/.test(v));
const previousPaths = new Set(previousFiles.map((f) => `/${f.path}`));
const added = staticPaths.filter((p) => !previousPaths.has(p));
const removed = previousFiles.map((f) => `/${f.path}`).filter((p) => !fetched.has(p));
const updated = [...fetched.entries()].filter(([, v]) => v.delta === "updated").map(([p]) => p);

const manifest = {
  fetchedAt: new Date().toISOString(),
  source: `${origin}${entryUrl.pathname} (app_version ${discoveredVersion ?? "unknown"})`,
  entryPath: entryUrl.pathname,
  entryLocal: entries.map((e) => e.path.slice(1)),
  assetRoot: "/remote/v4/3.14.3/assets/ -> remote/v4/3.14.3/assets/",
  fileCount: files.length + apiSampleFiles.length,
  files: [
    ...apiSampleFiles.map((f) => ({ ...f })),
    ...files.map((f) => ({
      path: f.path,
      url: f.url,
    })),
  ],
  missing: [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, status]) => ({
    path: path.slice(1),
    status,
    note: "官方源站 404（已知缺失引用，README 有记录）",
  })),
};
await writeFileWithRetry(previousManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await rm(curlTmpRoot, { recursive: true, force: true });

console.log(`[capture] done: ${files.length} static + ${apiSampleFiles.length} api-samples = ${manifest.fileCount}`);
console.log(`[capture] missing (origin 404): ${missing.size}`);
for (const [path] of [...missing.entries()].sort()) console.log(`[capture]   missing ${path}`);
console.log(`[capture] vs previous manifest: +${added.length} new, -${removed.length} gone, ~${updated.length} updated`);
for (const p of added) console.log(`[capture]   added   ${p}`);
for (const p of removed) console.log(`[capture]   removed ${p}`);
for (const p of updated) console.log(`[capture]   updated ${p}`);
