import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const HIDDEN_DIRECTORY_PREFIX = ".";

export function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * 笔记相对路径规范化：拒绝空串、NUL、绝对路径、`..`、`.`、空段与隐藏段，
 * 且只接受 `.md`（大小写不敏感）。语义与 Proma vault-service 一致。
 */
export function normalizeRelativeMarkdownPath(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new Error("Vault 相对路径不能为空");
  }
  if (isAbsolute(value) || isWindowsAbsolutePath(value)) {
    throw new Error("Vault 不接受绝对路径");
  }

  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error("Vault 路径不能包含隐藏目录、空段或上级目录");
  }
  if (!normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Vault 仅支持 Markdown (.md) 文件");
  }
  return parts.join("/");
}

/** Vault 目录相对路径规范化：与笔记规则相同，但不要求 .md 后缀；根目录返回空串。 */
export function normalizeRelativeVaultFolderPath(value: string): string {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error("Vault 文件夹路径非法");
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized) return "";
  if (isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
    throw new Error("Vault 不接受绝对路径");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error("Vault 文件夹路径不能包含隐藏目录、空段或上级目录");
  }
  return parts.join("/");
}

export function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const fromRoot = relative(rootPath, targetPath);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

/**
 * PermissionRequest hook 自动 allow 的路径形状策略（W01 收窄，独立可测的纯函数）：
 * 仅授权"非隐藏目录下的普通 Markdown 笔记"——每个路径段非空、不为 `.`/`..`、
 * 不以 `.` 开头（拒绝 `.obsidian/**`、`.hidden/**` 与点文件），末段以 `.md` 结尾
 * （大小写不敏感）。与面板门面 normalizeRelativeMarkdownPath 的可见性语义对齐，
 * 消除"hook 放行、面板拒绝"的不对称。Unicode 文件名原样保留，不做 NFC/NFD 折叠。
 * 输入约定：相对授权根的 `/` 分隔路径（不含根本身）。
 */
export function isPlainVaultMarkdownPath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    return false;
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    return false;
  }
  return segments[segments.length - 1].toLowerCase().endsWith(".md");
}

export interface SafeVaultPath {
  absolutePath: string;
  relativePath: string;
}

/**
 * 解析根内相对路径并拒绝符号链接：对已存在的每一段做 lstat，
 * 防止通过根内软链把 IO 引到授权根之外。
 */
export async function getSafeVaultPath(rootPath: string, relativePath: string): Promise<SafeVaultPath> {
  const absolutePath = resolve(rootPath, relativePath);
  if (!isWithinRoot(rootPath, absolutePath)) {
    throw new Error("Vault 路径超出授权根目录");
  }

  let current = rootPath;
  for (const segment of relativePath.split("/").filter(Boolean)) {
    current = join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Vault 不允许通过软链接访问文件");
    }
  }

  return { absolutePath, relativePath };
}

export function toRelativePath(rootPath: string, absolutePath: string): string {
  return relative(rootPath, absolutePath).split(/[/\\]/).join("/");
}

export function parentRelativePath(relativePath: string): string {
  return relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
}
