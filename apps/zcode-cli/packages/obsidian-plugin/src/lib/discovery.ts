import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface VaultCandidate {
  path: string;
  displayName: string;
  isObsidianVault: boolean;
  isZcodeManaged?: boolean;
}

/** 校验并规范化一个 Vault 根：必须是真实存在（含软链解析）的目录。 */
export async function assertVaultRoot(rootPath: string): Promise<string> {
  const resolved = await realpath(resolve(rootPath));
  const stats = await stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error("Vault 根路径不是目录");
  }
  return resolved;
}

export function vaultId(rootPath: string): string {
  // 稳定的不透明身份：展示/去重用，不向调用方泄露根路径之外的语义。
  return createHash("sha256").update(rootPath, "utf-8").digest("hex");
}

/**
 * Obsidian 注册表发现。obsidian.json 只是建议：坏 JSON、失效路径逐条跳过，
 * 永不让一个坏条目阻塞候选发现。
 */
export async function discoverObsidianVaultCandidates(managedRootPath?: string): Promise<VaultCandidate[]> {
  const configPaths =
    platform() === "darwin"
      ? [join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json")]
      : platform() === "win32"
        ? [join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json")]
        : [join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "obsidian", "obsidian.json")];

  let managedRoot: string | null = null;
  if (managedRootPath) {
    try {
      managedRoot = existsSync(managedRootPath) ? await assertVaultRoot(managedRootPath) : null;
    } catch {
      managedRoot = null;
    }
  }

  const candidates = new Map<string, VaultCandidate>();
  for (const configPath of configPaths) {
    let raw: string;
    try {
      raw = await readFile(configPath, "utf-8");
    } catch {
      continue;
    }
    let parsed: { vaults?: Record<string, { path?: unknown }> };
    try {
      parsed = JSON.parse(raw) as { vaults?: Record<string, { path?: unknown }> };
    } catch {
      continue;
    }
    for (const vault of Object.values(parsed.vaults ?? {})) {
      if (typeof vault.path !== "string" || !vault.path) continue;
      try {
        const root = await assertVaultRoot(vault.path);
        if (managedRoot !== null && root === managedRoot) continue;
        candidates.set(root, {
          path: root,
          displayName: basename(root) || "Vault",
          isObsidianVault: existsSync(join(root, ".obsidian")),
          isZcodeManaged: false,
        });
      } catch {
        // 失效的注册表条目只是建议，忽略。
      }
    }
  }
  return [...candidates.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/** 托管 Vault 目录（插件数据目录内），供未安装 Obsidian 的用户使用。 */
export function managedVaultDirPath(pluginDataDir: string): string {
  return resolve(pluginDataDir, "managed-vault");
}

/**
 * 全部候选 = 托管 Vault + Obsidian 注册表条目，按显示名排序。
 * 语义对齐 Proma discoverVaultCandidates。
 */
export async function discoverVaultCandidates(pluginDataDir: string): Promise<VaultCandidate[]> {
  const managedRootPath = managedVaultDirPath(pluginDataDir);
  const candidates: VaultCandidate[] = [];
  try {
    const managedRootPathReal = existsSync(managedRootPath) ? await assertVaultRoot(managedRootPath) : null;
    if (managedRootPathReal) {
      candidates.push({
        path: managedRootPathReal,
        displayName: "ZCode Vault",
        isObsidianVault: existsSync(join(managedRootPathReal, ".obsidian")),
        isZcodeManaged: true,
      });
    }
  } catch {
    // 托管目录异常不阻塞候选发现。
  }
  return [...candidates, ...(await discoverObsidianVaultCandidates(managedRootPath))];
}

export function configFilePath(pluginDataDir: string): string {
  return join(resolve(pluginDataDir), "vault-config.json");
}

export function configDirOf(filePath: string): string {
  return dirname(filePath);
}
