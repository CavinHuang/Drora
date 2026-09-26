/**
 * Obsidian Vault 面板服务实现（host 常驻）。
 *
 * - 门面移植自 obsidian-plugin src/lib（与 MCP server 同一安全不变量集）；
 * - 配置与 obsidian MCP server 共享同一份 vault-config.json：本服务每次调用都
 *   重新 loadVaultConfig（与 MCP server requireVaultConfig 同式），任何一侧的
 *   重新授权对另一侧立即生效，不存在第二事实源；
 * - pluginDataDir 由 storageRoot 推导（见 resolveObsidianPluginDataDir），与
 *   runtime 给 MCP server 注入的 OBSIDIAN_PLUGIN_DATA 是同一路径。
 */
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getDroraDataRootDir } from "../paths.js";
import {
  getSafeVaultPath,
  normalizeRelativeMarkdownPath,
  normalizeRelativeVaultFolderPath,
} from "./paths.js";
import {
  configureManagedVault,
  configureVaultAt,
  listCandidates,
  loadVaultConfig,
  vaultSummary,
  type ConfigureVaultOptions,
  type VaultConfig,
} from "./config.js";
import { discoverVaultCandidates } from "./discovery.js";
import { createVaultFileSystem, type VaultFileSystem } from "./vault-fs.js";
import type {
  IObsidianVaultService,
  ObsidianVaultCandidate,
  ObsidianVaultConfigureOptions,
  ObsidianVaultFocus,
  ObsidianVaultUserContextSnapshot,
} from "./obsidianVault.js";

/** 官方插件 id；dataPath 目录用 sanitizePluginId(=保留 @ . _ -) 后与 id 相同。 */
const OBSIDIAN_PLUGIN_ID = "obsidian@drora-plugins-official";

/**
 * 与 apps/drora-cli getCliStorageRoot / getPluginDataDir 同式的本地推导
 * （services 不反向依赖 CLI 包，公式以注释锁定来源）：
 * cliStorageRoot = <~/.drora>/cli（basename 已是 cli 时原样返回）；
 * pluginDataDir  = <cliStorageRoot>/data/<sanitizePluginId(pluginId)>。
 * MCP server 侧的 OBSIDIAN_PLUGIN_DATA env 注入的就是这同一个目录。
 */
export function resolveObsidianPluginDataDir(): string {
  const storageRoot = getDroraDataRootDir();
  const cliStorageRoot = basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
  return join(cliStorageRoot, "data", OBSIDIAN_PLUGIN_ID);
}

function toConfigureOptions(options?: ObsidianVaultConfigureOptions): ConfigureVaultOptions {
  return options ?? {};
}

/** 面板焦点注册表：host 进程内的会话级易失状态，不持久化。 */
const userContextBySession = new Map<string, ObsidianVaultUserContextSnapshot>();

/**
 * 焦点路径按所属 kind 走同一套相对路径规范化 + 根内/软链校验（与 Proma
 * normalizeVaultFocus 同一防线），再确认目标真实存在，防止把越界路径存进上下文。
 */
async function normalizeVaultFocus(
  rootPath: string,
  focus: ObsidianVaultFocus,
): Promise<ObsidianVaultFocus> {
  if (
    !focus ||
    (focus.kind !== "file" && focus.kind !== "folder") ||
    !Number.isSafeInteger(focus.sequence) ||
    focus.sequence < 0
  ) {
    throw new Error("Vault focus 非法");
  }
  const normalizedRelativePath =
    focus.kind === "file"
      ? normalizeRelativeMarkdownPath(focus.relativePath)
      : normalizeRelativeVaultFolderPath(focus.relativePath);
  if (!normalizedRelativePath) {
    throw new Error("Vault focus 非法");
  }
  const target = await getSafeVaultPath(rootPath, normalizedRelativePath);
  const stats = await lstat(target.absolutePath);
  const typeOk =
    focus.kind === "file" ? stats.isFile() : stats.isDirectory() && !stats.isSymbolicLink();
  if (!typeOk) {
    throw new Error(`Vault focus 目标不是${focus.kind === "file" ? " Markdown 文件" : "文件夹"}`);
  }
  return { kind: focus.kind, relativePath: target.relativePath, sequence: focus.sequence };
}

export function createObsidianVaultService(options?: {
  pluginDataDir?: string;
}): IObsidianVaultService {
  const pluginDataDir = options?.pluginDataDir ?? resolveObsidianPluginDataDir();
  const logger = createServiceLogger("obsidian-vault");

  async function requireVaultConfig(): Promise<VaultConfig> {
    const config = await loadVaultConfig(pluginDataDir);
    if (!config) {
      throw new Error("尚未配置 Vault：先在 Vault 面板选择或授权一个根目录");
    }
    return config;
  }

  async function requireConfiguredVault(): Promise<{ config: VaultConfig; vault: VaultFileSystem }> {
    const config = await requireVaultConfig();
    return { config, vault: createVaultFileSystem(config.rootPath) };
  }

  return {
    async getSummary() {
      const config = await loadVaultConfig(pluginDataDir);
      return config ? vaultSummary(config) : null;
    },

    async listCandidates(): Promise<ObsidianVaultCandidate[]> {
      // 门面的 isDroraManaged 是可选布尔；RPC 面统一收窄为显式布尔，跨 wire 形状稳定。
      const candidates = await listCandidates(pluginDataDir);
      return candidates.map((candidate) => ({
        path: candidate.path,
        displayName: candidate.displayName,
        isObsidianVault: candidate.isObsidianVault,
        isDroraManaged: candidate.isDroraManaged === true,
      }));
    },

    async selectManagedVault(options?: ObsidianVaultConfigureOptions) {
      const summary = await configureManagedVault(pluginDataDir, toConfigureOptions(options));
      logger.info("selected managed vault");
      return summary;
    },

    async configureVault(params: { rootPath: string; options?: ObsidianVaultConfigureOptions }) {
      const summary = await configureVaultAt(
        pluginDataDir,
        params.rootPath,
        toConfigureOptions(params.options),
      );
      logger.info("configured vault");
      return summary;
    },

    async authorizeCandidate(params: { path: string; options?: ObsidianVaultConfigureOptions }) {
      // 与 Proma authorizeDiscoveredVault 一致：只允许授权当前候选列表内的路径，
      // 防止陈旧 IPC 把任意目录写成 Agent 可读的 Vault 根。
      const candidates = await discoverVaultCandidates(pluginDataDir);
      const candidate = candidates.find((item) => item.path === params.path);
      if (!candidate) {
        throw new Error("Vault 候选已失效，请刷新候选列表后重新授权");
      }
      const summary = await configureVaultAt(
        pluginDataDir,
        candidate.path,
        toConfigureOptions(params.options),
      );
      logger.info("authorized vault candidate");
      return summary;
    },

    async listFiles() {
      const { vault } = await requireConfiguredVault();
      return vault.listFiles();
    },

    async readFile(params: { relativePath: string }) {
      const { vault } = await requireConfiguredVault();
      return vault.readFile(params.relativePath);
    },

    async writeFile(input) {
      const { vault } = await requireConfiguredVault();
      return vault.writeFile(input);
    },

    async createUntitledFile() {
      const { config, vault } = await requireConfiguredVault();
      return vault.createUntitledNote(config.inboxPath);
    },

    async createUntitledFileInFolder(params: { folderPath: string }) {
      const { vault } = await requireConfiguredVault();
      return vault.createUntitledNoteInFolder(params.folderPath);
    },

    async createFolder(params: { relativePath: string }) {
      const { vault } = await requireConfiguredVault();
      await vault.createFolder(params.relativePath);
    },

    async renameFile(input) {
      const { vault } = await requireConfiguredVault();
      return vault.renameFile(input);
    },

    async deleteFile(input) {
      const { vault } = await requireConfiguredVault();
      await vault.deleteFile(input);
    },

    async resolveMedia(params: { noteRelativePath: string; src: string }) {
      const { vault } = await requireConfiguredVault();
      return vault.resolveMedia(params.noteRelativePath, params.src);
    },

    async savePastedImage(input) {
      const { vault } = await requireConfiguredVault();
      return vault.savePastedImage(input);
    },

    async setUserContext(params: { sessionId: string; focus: ObsidianVaultFocus | null }) {
      const { sessionId, focus } = params;
      if (!sessionId) return;
      if (!focus) {
        userContextBySession.delete(sessionId);
        return;
      }
      const config = await loadVaultConfig(pluginDataDir);
      if (!config) {
        userContextBySession.delete(sessionId);
        return;
      }
      const previous = userContextBySession.get(sessionId);
      // 焦点带单调序号：迟到的旧 IPC 不得覆盖较新的焦点（与 Proma 同一防回退边界）。
      if (previous && focus.sequence < previous.focus.sequence) return;
      const normalizedFocus = await normalizeVaultFocus(config.rootPath, focus);
      userContextBySession.set(sessionId, {
        rootPath: config.rootPath,
        displayName: config.displayName,
        focus: normalizedFocus,
        openedAt: Date.now(),
      });
    },

    async getUserContext(params: { sessionId: string }) {
      const context = userContextBySession.get(params.sessionId);
      if (!context) return null;
      // 切换到另一个 Vault 后旧焦点立即失效。
      const config = await loadVaultConfig(pluginDataDir);
      if (!config || config.rootPath !== context.rootPath) {
        userContextBySession.delete(params.sessionId);
        return null;
      }
      try {
        // 读取时按当前根重新校验：焦点目标可能已被外部删除/替换。
        const focus = await normalizeVaultFocus(context.rootPath, context.focus);
        return { ...context, focus, displayName: config.displayName };
      } catch {
        userContextBySession.delete(params.sessionId);
        return null;
      }
    },
  };
}
