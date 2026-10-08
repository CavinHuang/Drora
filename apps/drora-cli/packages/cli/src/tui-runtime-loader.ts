import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { runTui } from "@drora/tui";

declare const __CLI_VERSION__: string;

type TuiRuntimeModule = {
  runTui: typeof runTui;
};

type SeaModule = typeof import("node:sea");

type SeaTuiRuntimeFile = {
  mode?: number;
  path: string;
  sha256: string;
};

type SeaTuiRuntimeManifest = {
  files: SeaTuiRuntimeFile[];
  hash: string;
  target: string;
  version: 1;
};

const assetPrefix = "drora-tui-runtime/";
const manifestAssetKey = `${assetPrefix}manifest.json`;
const packageEntryPath = "node_modules/@drora/tui/dist/index.js";
const manifestFileName = "manifest.json";

export const loadTuiRuntime = async (): Promise<TuiRuntimeModule> => {
  const sea = await import("node:sea");

  if (!sea.isSea()) {
    return await import("@drora/tui");
  }

  const runtimeDirectory = await ensureSeaTuiRuntime(sea);
  return await import(pathToFileURL(join(runtimeDirectory, packageEntryPath)).href);
};

/**
 * SEA 下运行 TUI 的 Windows 专用路径。
 *
 * opentui 的 unsafe-pointer 原生模块把 N-API 符号绑定到 `NODE.EXE` 导入；
 * Windows 加载器按进程映像名解析宿主。SEA 可执行文件不叫 node.exe 时，
 * 该绑定失败（"找不到指定的模块"），opentui 回退成
 * "OpenTUI native FFI is not available" 后 TUI 直接退出。
 *
 * 解法：把自身复制为解包目录里的 `node.exe`，用它以子进程跑 TUI——
 * 映像名匹配后原生绑定成功。环境变量哨兵防止子进程再次派生。
 * 仅 Windows SEA 生效；非 SEA 返回 null 走进程内路径。
 */
export const spawnTuiInNodeAliasProcess = async (): Promise<number | null> => {
  const sea = await import("node:sea");
  if (!sea.isSea() || platform() !== "win32") {
    return null;
  }
  if (process.env.DRORA_TUI_NODE_ALIAS_CHILD === "1") {
    return null;
  }

  const runtimeDirectory = await ensureSeaTuiRuntime(sea);
  const nodeAliasPath = join(runtimeDirectory, "node.exe");
  const selfPath = process.execPath;
  const fs = await import("node:fs/promises");
  try {
    const [selfStats, aliasStats] = await Promise.all([
      fs.stat(selfPath),
      fs.stat(nodeAliasPath).catch(() => null),
    ]);
    if (!aliasStats || aliasStats.size !== selfStats.size) {
      await fs.copyFile(selfPath, nodeAliasPath);
    }
  } catch {
    await fs.copyFile(selfPath, nodeAliasPath).catch(() => {});
  }

  const { spawn } = await import("node:child_process");
  return await new Promise<number>((resolve) => {
    // SEA 的 argv 形如 [execPath, execPath, ...userArgs]，真正用户参数从 2 开始
    const child = spawn(nodeAliasPath, process.argv.slice(2), {
      cwd: process.cwd(),
      env: { ...process.env, DRORA_TUI_NODE_ALIAS_CHILD: "1" },
      stdio: "inherit",
      windowsHide: false,
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
};

const ensureSeaTuiRuntime = async (sea: SeaModule): Promise<string> => {
  const manifest = readManifest(sea);
  const cacheDirectory = join(
    cacheBaseDirectory(),
    __CLI_VERSION__,
    manifest.target,
    manifest.hash,
  );
  const markerPath = join(cacheDirectory, manifestFileName);

  if (await isCacheCurrent(markerPath, manifest)) {
    return cacheDirectory;
  }

  const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporaryDirectory, {
    force: true,
    recursive: true,
  });
  await mkdir(temporaryDirectory, {
    recursive: true,
  });

  for (const file of manifest.files) {
    const asset = sea.getRawAsset(`${assetPrefix}${file.path}`);
    const bytes = Buffer.from(asset);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== file.sha256) {
      throw new Error(`SEA TUI asset hash mismatch for ${file.path}`);
    }

    const outputPath = join(temporaryDirectory, file.path);
    await mkdir(dirname(outputPath), {
      recursive: true,
    });
    await writeFile(outputPath, bytes);
    await chmod(outputPath, file.mode ?? modeForPath(file.path));
  }

  await writeFile(markerPathForDirectory(temporaryDirectory), JSON.stringify(manifest, null, 2));
  await rm(cacheDirectory, {
    force: true,
    recursive: true,
  });
  await mkdir(dirname(cacheDirectory), {
    recursive: true,
  });
  await rename(temporaryDirectory, cacheDirectory);
  return cacheDirectory;
};

const readManifest = (sea: SeaModule): SeaTuiRuntimeManifest => {
  const raw = sea.getAsset(manifestAssetKey, "utf8");
  const manifest = JSON.parse(raw) as SeaTuiRuntimeManifest;
  if (manifest.version !== 1 || !manifest.hash || !Array.isArray(manifest.files)) {
    throw new Error("Invalid SEA TUI runtime manifest.");
  }
  return manifest;
};

const isCacheCurrent = async (
  markerPath: string,
  expected: SeaTuiRuntimeManifest,
): Promise<boolean> => {
  if (!existsSync(markerPath)) return false;

  try {
    const current = JSON.parse(await readFile(markerPath, "utf8")) as SeaTuiRuntimeManifest;
    return current.hash === expected.hash && current.target === expected.target;
  } catch {
    return false;
  }
};

const cacheBaseDirectory = (): string => {
  const home = homedir();
  if (platform() === "darwin" && home) {
    return join(home, "Library", "Caches", "drora", "sea-assets");
  }
  if (platform() === "win32") {
    return join(
      process.env.LOCALAPPDATA ?? join(home || tmpdir(), "AppData", "Local"),
      "drora",
      "Cache",
      "sea-assets",
    );
  }
  return join(
    process.env.XDG_CACHE_HOME ?? join(home || tmpdir(), ".cache"),
    "drora",
    "sea-assets",
  );
};

const markerPathForDirectory = (directory: string): string => join(directory, manifestFileName);

const modeForPath = (filePath: string): number =>
  /\.(?:dll|dylib|node|so)$/i.test(filePath) ? 0o755 : 0o644;
