// Sync the built dev plugin into the CLI's plugin cache so the running zcode CLI
// (which loads plugins from ~/.zcode/cli/plugins/cache/..., NOT from this repo)
// picks up skill / MCP / manifest changes without a manual copy.
//
// This closes the last hop of the sync chain:
//   zcode-cua repo  --sync:skill/sync:mcp-->  dev plugin (here)  --sync:cache-->  CLI cache
//
// The cache dir name (e.g. 0.1.31) is just an install-time cache key; copying newer
// content (plugin.json says 0.2.0) on top of it is tolerated by the CLI and is exactly
// what makes a dev skill/MCP edit go live. Run after `pnpm sync:skill` (+ `pnpm build`
// when the MCP wrapper or skill changed).
//
// Usage:
//   node scripts/sync-cache.mjs            # auto-resolve cache path from marketplace.json
//   node scripts/sync-cache.mjs <cacheDir> # explicit cache dir
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const devPlugin = packageRoot;
// Build artifacts that constitute an installed plugin in the cache.
// 与原版 0.5.14 对齐（官方桌面 3.11.2 内置版本；第四轮基线为 0.5.13，第十二轮升版）：installed plugin = skills + dist + manifest + package.json；
// node_modules（sharp/koffi/semver 等 seed 依赖）随缓存一起同步，缺它则 dist 的
// server.js 在缓存里加载不到原生模块。
const ENTRIES = [
  "skills",
  "dist",
  ".zcode-plugin",
  "package.json",
  "node_modules",
];

/**
 * Resolve the CLI cache dir for zcode-cua. Prefer the cachePath declared in the
 * zcode-plugins-official marketplace.json; fall back to the single version dir under
 * the cache root. Throws if neither yields an existing dir (plugin not installed).
 */
async function resolveCacheDir() {
  if (process.argv[2]) return resolve(process.argv[2]);
  const marketplace = join(
    homedir(),
    ".zcode/cli/plugins/marketplaces/zcode-plugins-official/marketplace.json",
  );
  try {
    const text = await readFile(marketplace, "utf8");
    const parsed = JSON.parse(text);
    const entry = (parsed.plugins ?? parsed.items ?? []).find(
      (p) => p?.name === "computer-use" && p?.cachePath,
    );
    if (entry?.cachePath && existsSync(entry.cachePath)) return entry.cachePath;
  } catch {
    // marketplace.json missing/unreadable — fall through to glob.
  }
  const cacheRoot = join(homedir(), ".zcode/cli/plugins/cache/zcode-plugins-official/computer-use");
  if (existsSync(cacheRoot)) {
    const dirs = await readdir(cacheRoot);
    if (dirs.length === 1) return join(cacheRoot, dirs[0]);
    if (dirs.length > 1) {
      // Pick the newest by mtime — the most recently installed version.
      let newest = null;
      for (const d of dirs) {
        const s = await stat(join(cacheRoot, d));
        if (!newest || s.mtimeMs > newest.mtimeMs) newest = { d, mtimeMs: s.mtimeMs };
      }
      if (newest) return join(cacheRoot, newest.d);
    }
  }
  throw new Error(
    `Could not resolve the zcode-cua CLI cache dir. The plugin does not appear to be ` +
      `installed — run it once from the zcode UI/TUI to install, then re-run sync:cache. ` +
      `(looked in marketplace.json and ${cacheRoot})`,
  );
}

const cacheDir = await resolveCacheDir();
await mkdir(cacheDir, { recursive: true });

const copied = [];
for (const entry of ENTRIES) {
  const src = join(devPlugin, entry);
  if (!existsSync(src)) continue; // e.g. dist/ before first build
  const dest = join(cacheDir, entry);
  // cp with recursive + force replacement; file/dir both handled.
  await cp(pathToFileURL(src), pathToFileURL(dest), { recursive: true, force: true });
  copied.push(entry);
}

// sharp/koffi 的原生运行时已随原版 seed 资产整体存在于本包 node_modules（0.5.13 引入，0.5.14 沿用同文件集）
// 并随上面的 ENTRIES 一起拷贝；此前从 desktop/adapters 包二次 stage 的两条链
// （sharp-package-assets.mjs 在本仓库也不存在）随之移除，避免双源漂移。

console.log(`sync:cache → ${cacheDir}`);
console.log(`  copied: ${copied.join(", ") || "(nothing)"}`);
console.log(
  `  note: the cache dir name is an install-time key and may lag the plugin.json ` +
    `version inside — that is expected and does not affect loading.`,
);
