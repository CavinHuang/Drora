/**
 * vault-config.json 只读镜像读取（W03 evidence gate）。
 *
 * 唯一事实源仍是宿主面板写入的那一份 vault-config.json（specs/obsidian-plugin.md
 * 「形态与状态所有者」）；本模块只镜像 services 侧 `loadVaultConfig` 的读取口径
 * （services 不反向依赖 CLI 包，公式与形状以注释锁定来源，禁止在此复制第二份写路径）：
 * - 形状：rootPath/displayName/inboxPath(string)/allowAgentWrites(boolean)/configuredAt(number)；
 * - 根失效（被移动/删除/非目录）→ null = 未配置/撤权（gate 按 forbidden 拒绝）。
 * bootstrap 不能 import @drora/services（依赖方向禁止），故独立实现、测试对齐。
 */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 与 services obsidianVaultService.OBSIDIAN_PLUGIN_ID 同值（官方插件 id）。 */
export const OBSIDIAN_PLUGIN_ID = "obsidian@drora-plugins-official";

/** sanitizePluginId 同式（adapters/plugins/marketplace.ts）：保留 @ . _ -。 */
function sanitizePluginId(pluginId: string): string {
  return pluginId.replace(/[^a-zA-Z0-9@._-]+/gu, "-");
}

/**
 * 与 services resolveObsidianPluginDataDir 同式的本地推导：
 * dataBaseDir = DRORA_DATA_BASE_DIR(env) || homedir()（两端同优先级，desktop 注入一致）；
 * pluginDataDir = <dataBaseDir>/.drora/cli/data/<sanitizePluginId(pluginId)>。
 */
export function resolveObsidianPluginDataDirForGate(env: NodeJS.ProcessEnv = process.env): string {
  const dataBaseDir = env.DRORA_DATA_BASE_DIR?.trim() || env.HOME?.trim() || homedir();
  const dataRoot = join(dataBaseDir, ".drora");
  const cliStorageRoot = basenameOf(dataRoot) === "cli" ? dataRoot : join(dataRoot, "cli");
  return join(cliStorageRoot, "data", sanitizePluginId(OBSIDIAN_PLUGIN_ID));
}

function basenameOf(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export interface GateVaultConfig {
  /** realpath 后的根目录（与 services loadVaultConfig 返回口径一致）。 */
  rootPath: string;
  displayName: string;
  configuredAt: number;
}

/** 加载并校验 vault-config.json；任何异常/形状不符/根失效 → null（撤权/未配置语义）。 */
export async function loadGateVaultConfig(pluginDataDir: string): Promise<GateVaultConfig | null> {
  let raw: string;
  try {
    raw = await readFile(join(pluginDataDir, "vault-config.json"), "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const config = parsed as Record<string, unknown>;
  if (
    typeof config.rootPath !== "string" ||
    !config.rootPath.trim() ||
    config.rootPath.includes("\0") ||
    typeof config.displayName !== "string" ||
    typeof config.inboxPath !== "string" ||
    typeof config.allowAgentWrites !== "boolean" ||
    typeof config.configuredAt !== "number" ||
    !Number.isFinite(config.configuredAt)
  ) {
    return null;
  }
  try {
    // 与 services assertVaultRoot 同式：realpath + 必须是目录。
    const root = await realpath(resolve(config.rootPath));
    const stats = await stat(root);
    if (!stats.isDirectory()) return null;
    return { rootPath: root, displayName: config.displayName, configuredAt: config.configuredAt };
  } catch {
    return null;
  }
}

/** 逐段 lstat 拒软链（与面板门面同防线）；用于 gate 读取 receipts 指向的笔记文件。 */
export async function isSafeRegularFileWithinRoot(
  rootPath: string,
  relativePath: string,
): Promise<boolean> {
  if (!relativePath || relativePath.includes("\0")) return false;
  const segments = relativePath.split(/[\\/]+/);
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return false;
  }
  let current = rootPath;
  try {
    for (const segment of segments) {
      current = join(current, segment);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return false;
    }
    const realFile = await realpath(current);
    const realRoot = await realpath(rootPath);
    const realRootPrefix = realRoot.endsWith(sepOf()) ? realRoot : realRoot + sepOf();
    if (!realFile.startsWith(realRootPrefix)) return false;
    const finalStats = await lstat(realFile);
    return finalStats.isFile();
  } catch {
    return false;
  }
}

function sepOf(): string {
  return process.platform === "win32" ? "\\" : "/";
}