/**
 * Vault 源扫描器（W02 / spec §5b.4）。
 *
 * 遍历不变量与 obsidian-vault 门面（vault-fs.ts listFiles）同源：
 * 隐藏段跳过、软链/junction 跳过、仅 `.md`、深度 ≤16、文件 ≤5000、目录 ≤1000；
 * 差异点：被跳过条目按原因计数（coverage 需要），而不是静默丢弃。
 * 文件**内容**不在这里读取——协调者经 createVaultFileSystem(root).readFile
 * 逐文件过同一安全门面（逐段 lstat + sha256 与面板同源）。
 */
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { MAX_VAULT_FILE_BYTES } from "../../obsidian-vault/vault-fs.js";
import { toRelativePath } from "../../obsidian-vault/paths.js";

/** 与 vault-fs.ts 同值：配额与深度上限不得弱化，也不另立第二套。 */
const MAX_VAULT_FILES = 5_000;
const MAX_VAULT_FOLDERS = 1_000;
const MAX_VAULT_DEPTH = 16;

export interface ScanFileCandidate {
  relativePath: string;
  name: string;
  size: number;
  mtimeMs: number;
}

export interface ScanExclusions {
  hidden: number;
  symlink: number;
  notMarkdown: number;
  overSize: number;
  overQuota: number;
  depth: number;
}

export interface ScanResult {
  files: ScanFileCandidate[];
  exclusions: ScanExclusions;
  /** 目录配额耗尽导致未枚举的目录数。 */
  foldersSkippedByQuota: number;
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

export async function scanVaultSource(rootPath: string): Promise<ScanResult> {
  const files: ScanFileCandidate[] = [];
  const exclusions: ScanExclusions = { hidden: 0, symlink: 0, notMarkdown: 0, overSize: 0, overQuota: 0, depth: 0 };
  let foldersSkippedByQuota = 0;
  let folderCount = 0;

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    if (depth > MAX_VAULT_DEPTH) {
      // 上层目录在边界深度处已把本目录计入 depth 排除；此处兜底。
      return;
    }
    let dirEntries;
    try {
      dirEntries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // 目录暂时不可读：跳过，coverage 由最终对账呈现（不中断整库扫描）。
    }

    for (const entry of dirEntries) {
      if (isHiddenName(entry.name)) {
        exclusions.hidden += 1;
        continue;
      }
      if (entry.isSymbolicLink()) {
        exclusions.symlink += 1;
        continue;
      }
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 > MAX_VAULT_DEPTH) {
          exclusions.depth += 1;
          continue;
        }
        if (folderCount >= MAX_VAULT_FOLDERS) {
          foldersSkippedByQuota += 1;
          continue;
        }
        folderCount += 1;
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) {
        exclusions.notMarkdown += 1;
        continue;
      }
      if (files.length >= MAX_VAULT_FILES) {
        exclusions.overQuota += 1;
        continue;
      }
      try {
        // lstat 拒软链已由 Dirent 判定；这里取 size/mtime，超限文件计数不读取。
        const stats = await lstat(absolutePath);
        if (!stats.isFile()) continue;
        if (stats.size > MAX_VAULT_FILE_BYTES) {
          exclusions.overSize += 1;
          continue;
        }
        const statted = await stat(absolutePath);
        files.push({
          relativePath: toRelativePath(rootPath, absolutePath),
          name: entry.name,
          size: statted.size,
          mtimeMs: statted.mtimeMs,
        });
      } catch {
        // 遍历期间消失/不可访问：跳过（与门面语义一致）。
      }
    }
  };

  await walk(rootPath, 0);
  return { files, exclusions, foldersSkippedByQuota };
}

/** 逐文件走门面读取前的形状守卫：与 normalizeRelativeMarkdownPath 同规则（隐藏段/.. /后缀）。 */
export function isSafeFacadeMarkdownPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false;
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  return relativePath.toLowerCase().endsWith(".md");
}

/** 深度兜底：确保目录确实越界才计入 depth 排除（lstat 探测，仅在计数时使用）。 */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}
