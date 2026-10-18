// 移植自 obsidian-plugin src/lib/config.ts（与 Proma vault-service 同源）。
// 与 obsidian MCP server 共享同一份 vault-config.json 与同一安全不变量集；
// 逐条保留：相对路径校验/软链拒绝/根内前缀判定/2MB 读写上限/目录配额/
// wx 独占临时文件 0o600 + rename 原子写/sha256 乐观锁/图片 MIME+魔数+10MB 白名单。
import { mkdir, realpath } from "node:fs/promises";
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

/**
 * realpath 归一（不存在时回落原值）。托管根判定必须双侧归一：assertVaultRoot 返回
 * realpath 后的根（macOS 上 mkdtemp 的 /var/... 会解析成 /private/var/...），若与未
 * 归一的 resolve 结果做字符串相等，isManagedRoot 恒 false，托管 Vault 显示名恒回落
 * 目录名 "managed-vault"（W07 E2E 在 macOS 暴露，见 knowledgeE2EFullChain）。
 */
async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

export interface VaultConfig {
  rootPath: string;
  displayName: string;
  inboxPath: string;
  allowAgentWrites: boolean;
  /**
   * W09 L2 审核写回总门（specs/obsidian-knowledge.md §5e.12）：缺省/非 boolean 视为关闭
   * （fail-closed）；S03 GO 后由审核视图经 setVaultReviewWritePathEnabled 显式开启。
   * configureVaultAt 重建配置时不携带本字段——重新授权 Vault 视为回到安全缺省。
   */
  reviewWritePathEnabled?: boolean;
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
  return normalizeRelativeMarkdownPath(join(inboxPath, "placeholder.md")).replace(
    /\/placeholder\.md$/,
    "",
  );
}

function parseVaultConfigShape(
  value: unknown,
): (Omit<VaultConfig, "rootPath"> & { rootPath: string }) | null {
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
    ...(typeof config.reviewWritePathEnabled === "boolean"
      ? { reviewWritePathEnabled: config.reviewWritePathEnabled }
      : {}),
    configuredAt: config.configuredAt,
  };
}

export function vaultConfigPath(pluginDataDir: string): string {
  return configFilePath(pluginDataDir);
}

/**
 * E-1 修复（2026-10-17 增量评审）：vault-config.json 的三条写路径
 * （configureVaultAt 重建 / setVaultAgentWritesEnabled / setVaultReviewWritePathEnabled）
 * 原为裸「load→spread→write」，并发交叉时后写者以旧快照整体回写，可把用户刚完成的
 * 授权/撤权/开关或 configuredAt（epoch）回滚到旧值（例：撤权写入被并发的旧快照覆盖，
 * allowAgentWrites 回滚为 true）。进程内以 per-pluginDataDir 的 promise 链把每条
 * 写路径的完整「读-改-写」串行化（与 reviewEngine.preferenceWrites 同先例）；
 * vault-config.json 的属主是本 Host 进程，不存在跨进程写者。
 */
const vaultConfigWriteChains = new Map<string, Promise<unknown>>();
function serializeVaultConfigWrite<T>(pluginDataDir: string, write: () => Promise<T>): Promise<T> {
  const previous = vaultConfigWriteChains.get(pluginDataDir) ?? Promise.resolve();
  const next = previous.then(write, write);
  vaultConfigWriteChains.set(
    pluginDataDir,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * 加载配置。根路径失效（被移动/删除）时视为未配置 —— 与 Proma 的
 * parseVaultConfig 一致：坏配置回落到配置态，绝不在坏根上执行 IO。
 */
export async function loadVaultConfig(pluginDataDir: string): Promise<VaultConfig | null> {
  const parsed = parseVaultConfigShape(
    await jsonFileIO.read<unknown>(vaultConfigPath(pluginDataDir)),
  );
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
  return serializeVaultConfigWrite(pluginDataDir, async () => {
    const root = await assertVaultRoot(rootPath);
    const inboxPath = normalizeInboxPath(options.inboxPath?.trim() || DEFAULT_INBOX_PATH);
    const managedRootPath = await realpathOrSelf(
      managedVaultDirPath(configDirOf(vaultConfigPath(pluginDataDir))),
    );
    const isManagedRoot = managedRootPath === root;
    const config: VaultConfig = {
      rootPath: root,
      displayName:
        options.displayName?.trim() ||
        (isManagedRoot ? MANAGED_VAULT_DISPLAY_NAME : basename(root) || "Vault"),
      inboxPath,
      allowAgentWrites: options.allowAgentWrites === true,
      configuredAt: Date.now(),
    };
    await mkdir(pluginDataDir, { recursive: true });
    await jsonFileIO.write(vaultConfigPath(pluginDataDir), config);
    return toSummary(config);
  });
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

/**
 * 显式切换当前 Vault 的 Agent 写授权（用户面设置，不是任意根路径授权）。
 * 每次翻转都强制 reviewWritePathEnabled=false 并推进 configuredAt（epoch）：
 * 撤权/改权后，既有批准（approval 绑定 sourceEpoch）与新授权的 L2 状态全部失效，
 * 旧的已批准提案绝不能在写策略变化后存活。
 *
 * epoch 语义勘误（2026-10-17 增量评审 vault-io-2）：sourceRegistry 头注释与
 * specs/obsidian-knowledge.md §5b 原写「allowAgentWrites 翻转不换 epoch（它门控
 * 写入，不改变读取范围）」——该表述早于「批准绑定 sourceEpoch」机制；现在翻转
 * 必须换 epoch 才能让撤权失效旧批准（obsidianVaultConfig.test 断言单调推进）。
 * 代价：每次拨 L1 写授权会经源指纹变化触发知识索引缓存按 epoch 失效重建——
 * 授权变更是低频显式操作，正确性优先，两处文档已随本注释同步修正。
 */
export async function setVaultAgentWritesEnabled(
  pluginDataDir: string,
  enabled: boolean,
): Promise<VaultSummary | null> {
  return serializeVaultConfigWrite(pluginDataDir, async () => {
    const config = await loadVaultConfig(pluginDataDir);
    if (!config) return null;
    const next: VaultConfig = {
      ...config,
      allowAgentWrites: enabled === true,
      reviewWritePathEnabled: false,
      configuredAt: Math.max(Date.now(), config.configuredAt + 1),
    };
    await jsonFileIO.write(vaultConfigPath(pluginDataDir), next);
    return toSummary(next);
  });
}

/**
 * W09 L2 写路径开关的唯一持久化入口（specs/obsidian-knowledge.md §5e.12）：读-改-原子写
 * vault-config.json。除本函数与 setVaultAgentWritesEnabled 的撤权安全复位（写 false）
 * 外不得写该字段——configureVaultAt 重建配置时不携带，重新授权 Vault 视为回到安全
 * 缺省关闭。返回 null = 配置不存在或根失效（无法持久化；调用方呈现错误，进程内状态不变）。
 */
export async function setVaultReviewWritePathEnabled(
  pluginDataDir: string,
  enabled: boolean,
): Promise<VaultSummary | null> {
  return serializeVaultConfigWrite(pluginDataDir, async () => {
    const config = await loadVaultConfig(pluginDataDir);
    if (!config) return null;
    const next: VaultConfig = { ...config, reviewWritePathEnabled: enabled === true };
    await jsonFileIO.write(vaultConfigPath(pluginDataDir), next);
    return toSummary(next);
  });
}

export async function listCandidates(pluginDataDir: string): Promise<VaultCandidate[]> {
  return discoverVaultCandidates(pluginDataDir);
}
