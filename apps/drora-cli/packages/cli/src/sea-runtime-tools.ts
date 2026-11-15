import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getRuntimeToolRuntime, type RuntimeToolId } from "@drora/shared/runtime-tool-runtime";

type CliEnv = Record<string, string | undefined>;

export interface SeaRuntimeModule {
  getAsset(key: string, encoding: "utf8"): string;
  getRawAsset(key: string): ArrayBuffer;
  isSea(): boolean;
}

interface SeaRuntimeTool {
  binaryName: string;
  id: RuntimeToolId;
  sha256: string;
  size: number;
  version: string;
}

interface SeaRuntimeToolManifest {
  target: string;
  tools: SeaRuntimeTool[];
  version: 1;
}

interface RuntimeToolMarker {
  binaryName: string;
  id: RuntimeToolId;
  sha256: string;
  size: number;
  target: string;
  toolVersion: string;
  version: 1;
}

export interface EnsureSeaRuntimeToolsOptions {
  arch?: string;
  env?: CliEnv;
  platform?: NodeJS.Platform;
  sea?: SeaRuntimeModule;
  storageRoot?: string;
}

const assetPrefix = "drora-runtime-tools/";
const manifestAssetKey = `${assetPrefix}manifest.json`;
const markerFileName = ".drora-runtime-tool.json";
const runtimeToolIds = new Set<RuntimeToolId>(["bfs", "ripgrep", "ugrep"]);

export async function ensureSeaRuntimeTools(
  options: EnsureSeaRuntimeToolsOptions = {},
): Promise<CliEnv> {
  const sea = options.sea ?? getSeaModule();
  if (!sea?.isSea()) return {};

  const platform = options.platform ?? process.platform;
  const target = runtimeTarget(platform, options.arch ?? process.arch);
  const manifest = readManifest(sea);
  if (manifest.target !== target) {
    throw new Error(
      `SEA runtime tool target mismatch: binary contains ${manifest.target}, runtime is ${target}.`,
    );
  }

  const env = options.env ?? process.env;
  const configuredStorageRoot = options.storageRoot ?? env.DRORA_STORAGE_DIR?.trim();
  const storageRoot = configuredStorageRoot || join(homedir(), ".drora");
  const runtimeEnv: CliEnv = {};

  for (const tool of manifest.tools) {
    const runtime = getRuntimeToolRuntime(tool.id);
    if (env[runtime.binaryEnvVar]?.trim()) continue;

    runtimeEnv[runtime.binaryEnvVar] = await ensureRuntimeTool({
      manifest,
      platform,
      sea,
      storageRoot,
      tool,
    });
  }

  return runtimeEnv;
}

async function ensureRuntimeTool(input: {
  manifest: SeaRuntimeToolManifest;
  platform: NodeJS.Platform;
  sea: SeaRuntimeModule;
  storageRoot: string;
  tool: SeaRuntimeTool;
}): Promise<string> {
  const { manifest, platform, sea, storageRoot, tool } = input;
  const cacheDirectory = join(
    storageRoot,
    "cache",
    "runtime_tools",
    manifest.target,
    tool.id,
    `${tool.version}-${tool.sha256}`,
  );
  const binaryPath = join(cacheDirectory, tool.binaryName);
  const marker = markerFor(manifest, tool);

  if (await isCacheCurrent(cacheDirectory, marker, platform)) return binaryPath;

  const temporaryDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  await rm(temporaryDirectory, {
    force: true,
    recursive: true,
  });
  await mkdir(temporaryDirectory, {
    recursive: true,
  });

  try {
    const bytes = Buffer.from(sea.getRawAsset(assetKeyFor(tool)));
    if (bytes.byteLength !== tool.size) {
      throw new Error(`SEA runtime tool size mismatch for ${tool.id}.`);
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== tool.sha256) {
      throw new Error(`SEA runtime tool hash mismatch for ${tool.id}.`);
    }

    const temporaryBinaryPath = join(temporaryDirectory, tool.binaryName);
    await writeFile(temporaryBinaryPath, bytes);
    await chmod(temporaryBinaryPath, 0o755);
    await writeFile(join(temporaryDirectory, markerFileName), JSON.stringify(marker, null, 2));

    await mkdir(dirname(cacheDirectory), {
      recursive: true,
    });
    if (await isCacheCurrent(cacheDirectory, marker, platform)) return binaryPath;
    await installCacheDirectory(temporaryDirectory, cacheDirectory, marker, platform);
    return binaryPath;
  } finally {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true,
    });
  }
}

async function installCacheDirectory(
  temporaryDirectory: string,
  cacheDirectory: string,
  marker: RuntimeToolMarker,
  platform: NodeJS.Platform,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await rename(temporaryDirectory, cacheDirectory);
      return;
    } catch (error) {
      if (await isCacheCurrent(cacheDirectory, marker, platform)) return;
      if (!isDirectoryReplaceRace(error) || attempt === 1) throw error;
      await rm(cacheDirectory, {
        force: true,
        recursive: true,
      });
    }
  }
}

function readManifest(sea: SeaRuntimeModule): SeaRuntimeToolManifest {
  let manifest: SeaRuntimeToolManifest;
  try {
    manifest = JSON.parse(sea.getAsset(manifestAssetKey, "utf8")) as SeaRuntimeToolManifest;
  } catch (error) {
    throw new Error("Invalid SEA runtime tool manifest.", {
      cause: error,
    });
  }

  validateManifest(manifest);
  return manifest;
}

function validateManifest(manifest: SeaRuntimeToolManifest): void {
  if (
    manifest?.version !== 1 ||
    typeof manifest.target !== "string" ||
    !/^[a-z0-9]+-(?:arm64|x64)$/u.test(manifest.target) ||
    !Array.isArray(manifest.tools) ||
    manifest.tools.length === 0
  ) {
    throw new Error("Invalid SEA runtime tool manifest.");
  }

  const seenToolIds = new Set<RuntimeToolId>();
  for (const tool of manifest.tools) {
    if (
      !runtimeToolIds.has(tool?.id) ||
      seenToolIds.has(tool.id) ||
      typeof tool.binaryName !== "string" ||
      basename(tool.binaryName) !== tool.binaryName ||
      !/^[A-Za-z0-9._-]+$/u.test(tool.binaryName) ||
      !/^[a-f0-9]{64}$/u.test(tool.sha256) ||
      !Number.isSafeInteger(tool.size) ||
      tool.size < 0 ||
      typeof tool.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(tool.version)
    ) {
      throw new Error("Invalid SEA runtime tool manifest.");
    }
    seenToolIds.add(tool.id);
  }
}

async function isCacheCurrent(
  cacheDirectory: string,
  expected: RuntimeToolMarker,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const marker = JSON.parse(
      await readFile(join(cacheDirectory, markerFileName), "utf8"),
    ) as RuntimeToolMarker;
    if (
      marker.version !== expected.version ||
      marker.id !== expected.id ||
      marker.toolVersion !== expected.toolVersion ||
      marker.sha256 !== expected.sha256 ||
      marker.target !== expected.target ||
      marker.binaryName !== expected.binaryName ||
      marker.size !== expected.size
    ) {
      return false;
    }

    const binaryPath = join(cacheDirectory, expected.binaryName);
    const binaryStat = await stat(binaryPath);
    if (!binaryStat.isFile() || binaryStat.size !== expected.size) return false;
    // win32 宿主的 stat().mode 没有可执行位语义：libuv 只把只读属性映射进 mode，x 位仅对
    // .exe/.bat/.cmd/.com 扩展名合成，无扩展名文件 chmod(0o755) 后仍观察不到 0o111。该校验
    // 的本意是发现缓存二进制丢失执行位（unix 文件系统属性），可观察性取决于宿主文件系统而
    // 非 options.platform 声明的目标平台——win32 宿主上以 darwin/linux 目标运行时按目标平台
    // 强校验会让缓存永远判 stale，每次都重装并 rename 覆盖既有目录，触发 win32 EPERM。生产
    // 中 host==platform（该 option 仅测试注入），行为不变；此处只修正假 stale 判定。
    if (process.platform !== "win32" && platform !== "win32" && (binaryStat.mode & 0o111) === 0) {
      return false;
    }

    const actualSha256 = createHash("sha256")
      .update(await readFile(binaryPath))
      .digest("hex");
    return actualSha256 === expected.sha256;
  } catch {
    return false;
  }
}

function markerFor(manifest: SeaRuntimeToolManifest, tool: SeaRuntimeTool): RuntimeToolMarker {
  return {
    binaryName: tool.binaryName,
    id: tool.id,
    sha256: tool.sha256,
    size: tool.size,
    target: manifest.target,
    toolVersion: tool.version,
    version: 1,
  };
}

function runtimeTarget(platform: NodeJS.Platform, arch: string): string {
  const releasePlatform = platform === "win32" ? "win" : platform;
  if (!["darwin", "linux", "win"].includes(releasePlatform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported SEA runtime target ${platform}-${arch}.`);
  }
  return `${releasePlatform}-${arch}`;
}

function assetKeyFor(tool: SeaRuntimeTool): string {
  return `${assetPrefix}${tool.id}/${tool.sha256}/${tool.binaryName}`;
}

function getSeaModule(): SeaRuntimeModule | undefined {
  const getBuiltinModule = process.getBuiltinModule as
    | ((id: string) => SeaRuntimeModule | undefined)
    | undefined;
  try {
    return getBuiltinModule?.("node:sea");
  } catch {
    return undefined;
  }
}

function isDirectoryReplaceRace(error: unknown): boolean {
  // win32 上 rename(目录, 已存在目录) 经 MoveFileExW(REPLACE_EXISTING) 对已存在目录稳定失败
  // 为 ERROR_ACCESS_DENIED，Node 映射为 EPERM（unix 上同形操作才是 EEXIST/ENOTEMPTY）。
  // 不把 EPERM 纳入竞态集时，并发首发或缓存修复会在第一次 rename 就抛出，连带测试
  // finally 清理与仍在途的并发安装互踩出 ENOTEMPTY rmdir。纳入后沿用既有收敛序：先复查
  // 目标缓存有效性（有效即直接复用），无效才清目录重试 rename。unix 上 EPERM 另有语义
  // （粘滞位/不可变属性），维持原集合不动。
  const replaceRaceCodes =
    process.platform === "win32" ? ["EEXIST", "ENOTEMPTY", "EPERM"] : ["EEXIST", "ENOTEMPTY"];
  return (
    typeof error === "object" &&
    error !== null &&
    replaceRaceCodes.includes(String((error as NodeJS.ErrnoException).code))
  );
}
