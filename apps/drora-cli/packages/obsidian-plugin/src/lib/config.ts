import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { jsonFileIO } from "./atomic.js";
import {
  assertVaultRoot,
  configDirOf,
  configFilePath,
  discoverVaultCandidates,
  managedVaultDirPath,
  vaultId,
  type VaultCandidate,
} from "./discovery.js";
import { normalizeRelativeMarkdownPath } from "./paths.js";

export interface VaultConfig {
  rootPath: string;
  displayName: string;
  inboxPath: string;
  allowAgentWrites: boolean;
  configuredAt: number;
}

/** 工具面可见的概要：稳定 vaultId + 展示字段，不重复携带根路径。 */
export interface VaultSummary {
  vaultId: string;
  displayName: string;
  inboxPath: string;
  allowAgentWrites: boolean;
  configuredAt: number;
}

const DEFAULT_INBOX_PATH = "Inbox";
const MANAGED_VAULT_DISPLAY_NAME = "Drora Vault";

/** inbox 路径复用笔记路径规则规范化（拼 placeholder 文件再剥掉）。 */
function normalizeInboxPath(inboxPath: string): string {
  return normalizeRelativeMarkdownPath(join(inboxPath, "placeholder.md")).replace(/\/placeholder\.md$/, "");
}

function parseVaultConfigShape(value: unknown): Omit<VaultConfig, "rootPath"> & { rootPath: string } | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Record<string, unknown>;
  if (
    typeof config.rootPath !== "string" ||
    typeof config.displayName !== "string" ||
    typeof config.inboxPath !== "string" ||
    typeof config.allowAgentWrites !== "boolean" ||
    typeof config.configuredAt !== "number"
  ) {
    return null;
  }
  return {
    rootPath: config.rootPath,
    displayName: config.displayName,
    inboxPath: normalizeInboxPath(config.inboxPath),
    allowAgentWrites: config.allowAgentWrites,
    configuredAt: config.configuredAt,
  };
}

export function vaultConfigPath(pluginDataDir: string): string {
  return configFilePath(pluginDataDir);
}

/**
 * 加载配置。根路径失效（被移动/删除）时视为未配置 —— 与 Proma 的
 * parseVaultConfig 一致：坏配置回落到配置态，绝不在坏根上执行 IO。
 */
export async function loadVaultConfig(pluginDataDir: string): Promise<VaultConfig | null> {
  const parsed = parseVaultConfigShape(await jsonFileIO.read<unknown>(vaultConfigPath(pluginDataDir)));
  if (!parsed) return null;
  try {
    const root = await assertVaultRoot(parsed.rootPath);
    return { ...parsed, rootPath: root };
  } catch {
    return null;
  }
}

function toSummary(config: VaultConfig): VaultSummary {
  return {
    vaultId: vaultId(config.rootPath),
    displayName: config.displayName,
    inboxPath: config.inboxPath,
    allowAgentWrites: config.allowAgentWrites,
    configuredAt: config.configuredAt,
  };
}

export function vaultSummary(config: VaultConfig): VaultSummary {
  return toSummary(config);
}

export interface ConfigureVaultOptions {
  inboxPath?: string;
  displayName?: string;
  allowAgentWrites?: boolean;
}

/** 授权并写入 Vault 配置；根必须真实存在（realpath 解析）。 */
export async function configureVaultAt(
  pluginDataDir: string,
  rootPath: string,
  options: ConfigureVaultOptions = {},
): Promise<VaultSummary> {
  const root = await assertVaultRoot(rootPath);
  const inboxPath = normalizeInboxPath(options.inboxPath?.trim() || DEFAULT_INBOX_PATH);
  const managedRootPath = managedVaultDirPath(configDirOf(vaultConfigPath(pluginDataDir)));
  const isManagedRoot = managedRootPath === root;
  const config: VaultConfig = {
    rootPath: root,
    displayName: options.displayName?.trim() || (isManagedRoot ? MANAGED_VAULT_DISPLAY_NAME : basename(root) || "Vault"),
    inboxPath,
    allowAgentWrites: options.allowAgentWrites === true,
    configuredAt: Date.now(),
  };
  await mkdir(pluginDataDir, { recursive: true });
  await jsonFileIO.write(vaultConfigPath(pluginDataDir), config);
  return toSummary(config);
}

/** 配置插件数据目录下的托管 Vault（未安装 Obsidian 的用户的默认路径）。 */
export async function configureManagedVault(
  pluginDataDir: string,
  options: ConfigureVaultOptions = {},
): Promise<VaultSummary> {
  const managedRoot = managedVaultDirPath(pluginDataDir);
  await mkdir(managedRoot, { recursive: true });
  return configureVaultAt(pluginDataDir, managedRoot, options);
}

export async function listCandidates(pluginDataDir: string): Promise<VaultCandidate[]> {
  return discoverVaultCandidates(pluginDataDir);
}
