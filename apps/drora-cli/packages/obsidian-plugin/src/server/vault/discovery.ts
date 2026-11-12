// 迁自 packages/services/src/obsidian-vault/discovery.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
// 移植自 obsidian-plugin src/lib/discovery.ts（与 Proma vault-service 同源）。
// 与 obsidian MCP server 共享同一份 vault-config.json 与同一安全不变量集；
// 逐条保留：相对路径校验/软链拒绝/根内前缀判定/2MB 读写上限/目录配额/
// wx 独占临时文件 0o600 + rename 原子写/sha256 乐观锁/图片 MIME+魔数+10MB 白名单。
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { VAULT_CONFIG_FILE_NAME } from "../platform/knowledgeEvidence.js";

export interface VaultCandidate {
  path: string;
  displayName: string;
  isObsidianVault: boolean;
  isDroraManaged?: boolean;
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
export async function discoverObsidianVaultCandidates(
  managedRootPath?: string,
): Promise<VaultCandidate[]> {
  const configPaths =
    platform() === "darwin"
      ? [join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json")]
      : platform() === "win32"
        ? [
            join(
              process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
              "obsidian",
              "obsidian.json",
            ),
          ]
        : [
            join(
              process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
              "obsidian",
              "obsidian.json",
            ),
          ];

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
          isDroraManaged: false,
        });
      } catch {
        // 失效的注册表条目只是建议，忽略。
      }
    }
  }
  return [...candidates.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
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
    const managedRootPathReal = existsSync(managedRootPath)
      ? await assertVaultRoot(managedRootPath)
      : null;
    if (managedRootPathReal) {
      candidates.push({
        path: managedRootPathReal,
        displayName: "Drora Vault",
        isObsidianVault: existsSync(join(managedRootPathReal, ".obsidian")),
        isDroraManaged: true,
      });
    }
  } catch {
    // 托管目录异常不阻塞候选发现。
  }
  return [...candidates, ...(await discoverObsidianVaultCandidates(managedRootPath))];
}

export function configFilePath(pluginDataDir: string): string {
  // 收口（PR #23 终审 conv-1；P7/C6 后插件自带副本 platform/knowledgeEvidence.ts 单一出处）
  // vault-config-reader 指向同一物理文件；此前两侧各手写一份 "vault-config.json"
  // 字面量，漂移即门面写一份、gate 读另一份。
  return join(resolve(pluginDataDir), VAULT_CONFIG_FILE_NAME);
}

export function configDirOf(filePath: string): string {
  return dirname(filePath);
}
