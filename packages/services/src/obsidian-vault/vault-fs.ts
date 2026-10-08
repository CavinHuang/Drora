// 移植自 obsidian-plugin src/lib/vault-fs.ts（与 Proma vault-service 同源）。
// 与 obsidian MCP server 共享同一份 vault-config.json 与同一安全不变量集；
// 逐条保留：相对路径校验/软链拒绝/根内前缀判定/2MB 读写上限/目录配额/
// wx 独占临时文件 0o600 + rename 原子写/sha256 乐观锁/图片 MIME+魔数+10MB 白名单。
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeTextFileAtomic } from "./atomic.js";
import { isValidImageBytes } from "./image.js";
import {
  getSafeVaultPath,
  isWithinRoot,
  normalizeRelativeMarkdownPath,
  normalizeRelativeVaultFolderPath,
  parentRelativePath,
  toRelativePath,
} from "./paths.js";

export const MAX_VAULT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_VAULT_FILES = 5_000;
const MAX_VAULT_FOLDERS = 1_000;
const MAX_VAULT_DEPTH = 16;
const MAX_VAULT_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;
// 在解码出第二个 Buffer 之前拒绝超长的 base64 输入。
const MAX_VAULT_PASTED_IMAGE_BASE64_CHARS = Math.ceil(MAX_VAULT_PASTED_IMAGE_BYTES / 3) * 4;
const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface VaultFileEntry {
  kind: "file";
  relativePath: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export interface VaultFolderEntry {
  kind: "folder";
  relativePath: string;
  name: string;
}

export type VaultTreeEntry = VaultFileEntry | VaultFolderEntry;

export interface VaultReadResult {
  relativePath: string;
  content: string;
  sha256: string;
  modifiedAt: number;
}

export interface VaultWriteInput {
  relativePath: string;
  content: string;
  expectedSha256?: string;
  createOnly?: boolean;
}

export type VaultWriteResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: "conflict"; currentSha256: string; currentModifiedAt: number };

export interface VaultRenameInput {
  relativePath: string;
  name: string;
  expectedSha256?: string;
}

export interface VaultDeleteInput {
  relativePath: string;
  expectedSha256?: string;
}

export interface VaultSavePastedImageInput {
  noteRelativePath: string;
  mimeType: string;
  base64: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function untitledNoteFilename(date: Date, sequence: number): string {
  const suffix = sequence === 1 ? "" : ` ${sequence}`;
  return `Untitled ${formatLocalDate(date)}${suffix}.md`;
}

/** 独占创建文件（wx）：已存在返回 false，绝不覆盖。 */
async function createFileExclusively(filePath: string, content: string): Promise<boolean> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, "wx");
    await handle.writeFile(content, "utf-8");
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false;
    throw error;
  } finally {
    if (handle !== undefined) await handle.close();
  }
}

function getSafeVaultTarget(rootPath: string, relativePath: string): Promise<{ absolutePath: string; relativePath: string }> {
  return getSafeVaultPath(rootPath, normalizeRelativeMarkdownPath(relativePath));
}

function getSafeVaultFolderTarget(rootPath: string, relativePath: string): Promise<{ absolutePath: string; relativePath: string }> {
  return getSafeVaultPath(rootPath, normalizeRelativeVaultFolderPath(relativePath));
}

/** 为一个已授权的 Vault 根创建有界异步文件系统门面。所有 Vault IO 的唯一入口。 */
export function createVaultFileSystem(rootPath: string) {
  const root = rootPath;

  const listFiles = async (): Promise<VaultTreeEntry[]> => {
    const entries: VaultTreeEntry[] = [];
    // 目录与 Markdown 文件配额独立：满是子目录的 Vault 不能把笔记挤出列表，反之亦然。
    let fileCount = 0;
    let folderCount = 0;

    const walk = async (currentDir: string, depth: number): Promise<void> => {
      if (depth > MAX_VAULT_DEPTH) return;
      let dirEntries;
      try {
        dirEntries = await readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of dirEntries) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const absolutePath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          // 边界深度上不输出目录：其子项不会被枚举，会留下看似可展开实则空的节点。
          if (depth >= MAX_VAULT_DEPTH || folderCount >= MAX_VAULT_FOLDERS) continue;
          entries.push({
            kind: "folder",
            relativePath: toRelativePath(root, absolutePath),
            name: entry.name,
          });
          folderCount += 1;
          await walk(absolutePath, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md") || fileCount >= MAX_VAULT_FILES) continue;
        try {
          const stats = await stat(absolutePath);
          entries.push({
            kind: "file",
            relativePath: toRelativePath(root, absolutePath),
            name: entry.name,
            size: stats.size,
            modifiedAt: stats.mtimeMs,
          });
          fileCount += 1;
        } catch {
          // 遍历期间文件可能消失或暂时不可访问，跳过后继续处理其他条目。
        }
      }
    };

    await walk(root, 0);
    return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  };

  const readFileEntry = async (relativePath: string): Promise<VaultReadResult> => {
    const target = await getSafeVaultTarget(root, relativePath);
    if (!(await pathExists(target.absolutePath))) throw new Error(`Vault 文件不存在: ${target.relativePath}`);
    const stats = await lstat(target.absolutePath);
    if (!stats.isFile()) throw new Error("Vault 目标不是普通文件");
    if (stats.size > MAX_VAULT_FILE_BYTES) throw new Error("Vault 文件超过 2 MB 读取上限");
    const content = await readFile(target.absolutePath, "utf-8");
    return {
      relativePath: target.relativePath,
      content,
      sha256: sha256(content),
      modifiedAt: stats.mtimeMs,
    };
  };

  const resolveMedia = async (noteRelativePath: string, src: string): Promise<string | null> => {
    if (typeof src !== "string" || !src.trim() || src.includes("\0")) return null;
    const note = await getSafeVaultTarget(root, noteRelativePath);
    const source = src.trim().replace(/[?#].*$/, "");
    if (!source) return null;

    let candidate: string;
    try {
      candidate = source.toLowerCase().startsWith("file:")
        ? decodeURIComponent(new URL(source).pathname)
        : resolve(dirname(note.absolutePath), decodeURIComponent(source));
    } catch {
      return null;
    }
    if (!isWithinRoot(root, candidate)) return null;

    const relativeCandidate = toRelativePath(root, candidate);
    try {
      const target = await getSafeVaultPath(root, relativeCandidate);
      return (await pathExists(target.absolutePath)) && (await lstat(target.absolutePath)).isFile()
        ? target.absolutePath
        : null;
    } catch {
      return null;
    }
  };

  const savePastedImage = async (input: VaultSavePastedImageInput): Promise<{ src: string } | null> => {
    const extension = PASTED_IMAGE_EXTENSIONS[input.mimeType];
    if (
      !extension ||
      typeof input.base64 !== "string" ||
      input.base64.length === 0 ||
      input.base64.length > MAX_VAULT_PASTED_IMAGE_BASE64_CHARS
    ) {
      return null;
    }
    const normalizedBase64 = input.base64.replace(/\s/g, "");
    if (
      !normalizedBase64 ||
      normalizedBase64.length > MAX_VAULT_PASTED_IMAGE_BASE64_CHARS ||
      normalizedBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64)
    ) {
      return null;
    }

    let data: Buffer;
    try {
      data = Buffer.from(normalizedBase64, "base64");
    } catch {
      return null;
    }
    if (data.length === 0 || data.length > MAX_VAULT_PASTED_IMAGE_BYTES || !isValidImageBytes(input.mimeType, data)) {
      return null;
    }

    const note = await getSafeVaultTarget(root, input.noteRelativePath);
    const directory = dirname(note.relativePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `pasted-image-${timestamp}-${randomUUID()}.${extension}`;
    const mediaRelativePath = directory === "." ? `assets/${filename}` : `${directory}/assets/${filename}`;
    const target = await getSafeVaultPath(root, mediaRelativePath);
    await mkdir(dirname(target.absolutePath), { recursive: true });
    // 目录创建引入了新祖先，落盘前按同一规则重新校验。
    const revalidated = await getSafeVaultPath(root, mediaRelativePath);
    const handle = await open(revalidated.absolutePath, "wx");
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    return { src: toRelativePath(dirname(note.absolutePath), revalidated.absolutePath) };
  };

  const writeFile = async (input: VaultWriteInput): Promise<VaultWriteResult> => {
    if (Buffer.byteLength(input.content, "utf-8") > MAX_VAULT_FILE_BYTES) {
      throw new Error("Vault 写入内容超过 2 MB 限制");
    }
    const target = await getSafeVaultTarget(root, input.relativePath);
    const exists = await pathExists(target.absolutePath);
    if (exists) {
      const current = await readFileEntry(target.relativePath);
      if (input.createOnly) throw new Error(`Vault 文件已存在: ${target.relativePath}`);
      if (input.expectedSha256 && input.expectedSha256 !== current.sha256) {
        return { ok: false, reason: "conflict", currentSha256: current.sha256, currentModifiedAt: current.modifiedAt };
      }
    } else if (input.expectedSha256) {
      throw new Error("Vault 文件已不存在，无法按预期版本写入");
    }

    await mkdir(dirname(target.absolutePath), { recursive: true });
    // 目录创建引入了新祖先，原子写入前按同一规则重新校验。
    const revalidated = await getSafeVaultTarget(root, target.relativePath);
    await writeTextFileAtomic(revalidated.absolutePath, input.content);
    const result = await readFileEntry(revalidated.relativePath);
    return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt };
  };

  const createUntitledNote = async (inboxPath: string, content = "", now = new Date()): Promise<VaultWriteResult> => {
    if (Buffer.byteLength(content, "utf-8") > MAX_VAULT_FILE_BYTES) {
      throw new Error("Vault 写入内容超过 2 MB 限制");
    }
    const normalizedInboxPath = normalizeRelativeMarkdownPath(join(inboxPath, "placeholder.md")).replace(
      /\/placeholder\.md$/,
      "",
    );

    for (let sequence = 1; sequence < Number.MAX_SAFE_INTEGER; sequence++) {
      const target = await getSafeVaultTarget(root, `${normalizedInboxPath}/${untitledNoteFilename(now, sequence)}`);
      await mkdir(dirname(target.absolutePath), { recursive: true });
      // 目录创建引入了新祖先，独占创建前按同一规则重新校验。
      const revalidated = await getSafeVaultTarget(root, target.relativePath);
      if (!(await createFileExclusively(revalidated.absolutePath, content))) continue;
      const result = await readFileEntry(revalidated.relativePath);
      return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt };
    }

    throw new Error("Vault 无法分配未命名笔记文件名");
  };

  const createUntitledNoteInFolder = async (
    folderPath: string,
    content = "",
    now = new Date(),
  ): Promise<VaultWriteResult> => {
    if (Buffer.byteLength(content, "utf-8") > MAX_VAULT_FILE_BYTES) {
      throw new Error("Vault 写入内容超过 2 MB 限制");
    }
    const folder = await getSafeVaultFolderTarget(root, folderPath);
    if (!(await pathExists(folder.absolutePath)) || !(await lstat(folder.absolutePath)).isDirectory()) {
      throw new Error("目标 Vault 文件夹不存在");
    }

    for (let sequence = 1; sequence < Number.MAX_SAFE_INTEGER; sequence++) {
      const relativePath = folder.relativePath
        ? `${folder.relativePath}/${untitledNoteFilename(now, sequence)}`
        : untitledNoteFilename(now, sequence);
      const target = await getSafeVaultTarget(root, relativePath);
      if (!(await createFileExclusively(target.absolutePath, content))) continue;
      const result = await readFileEntry(target.relativePath);
      return { ok: true, relativePath: result.relativePath, sha256: result.sha256, modifiedAt: result.modifiedAt };
    }

    throw new Error("Vault 无法分配未命名笔记文件名");
  };

  const createFolder = async (relativePath: string): Promise<void> => {
    const target = await getSafeVaultFolderTarget(root, relativePath);
    if (!target.relativePath) throw new Error("不能创建 Vault 根文件夹");
    if (await pathExists(target.absolutePath)) throw new Error("同名文件或文件夹已存在");

    const parent = dirname(target.absolutePath);
    if (!(await pathExists(parent)) || !(await lstat(parent)).isDirectory()) {
      throw new Error("目标 Vault 父文件夹不存在");
    }
    const revalidated = await getSafeVaultFolderTarget(root, target.relativePath);
    try {
      await mkdir(revalidated.absolutePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        throw new Error("同名文件或文件夹已存在");
      }
      throw error;
    }
  };

  const renameFile = async (input: VaultRenameInput): Promise<VaultReadResult> => {
    const source = await getSafeVaultTarget(root, input.relativePath);
    const current = await readFileEntry(source.relativePath);
    if (input.expectedSha256 && input.expectedSha256 !== current.sha256) {
      throw new Error("文件已在外部修改，请刷新后再重命名");
    }

    const requestedName = input.name.trim();
    if (!requestedName || requestedName.includes("/") || requestedName.includes("\\") || requestedName.includes("\0")) {
      throw new Error("文件名不能为空且不能包含路径分隔符");
    }
    const filename = requestedName.toLowerCase().endsWith(".md") ? requestedName : `${requestedName}.md`;
    const parentPath = parentRelativePath(source.relativePath);
    const target = await getSafeVaultTarget(root, parentPath ? `${parentPath}/${filename}` : filename);
    if (target.relativePath === source.relativePath) return current;
    if (await pathExists(target.absolutePath)) throw new Error("同名 Markdown 文件已存在");

    await mkdir(dirname(target.absolutePath), { recursive: true });
    const revalidatedTarget = await getSafeVaultTarget(root, target.relativePath);
    await rename(source.absolutePath, revalidatedTarget.absolutePath);
    return readFileEntry(revalidatedTarget.relativePath);
  };

  const deleteFile = async (input: VaultDeleteInput): Promise<void> => {
    const target = await getSafeVaultTarget(root, input.relativePath);
    if (!(await pathExists(target.absolutePath))) throw new Error(`Vault 文件不存在: ${target.relativePath}`);
    const stats = await lstat(target.absolutePath);
    if (!stats.isFile()) throw new Error("Vault 目标不是普通文件");
    if (input.expectedSha256) {
      if (stats.size > MAX_VAULT_FILE_BYTES) throw new Error("Vault 文件超过 2 MB 校验上限");
      const current = await readFileEntry(target.relativePath);
      if (input.expectedSha256 !== current.sha256) {
        throw new Error("文件已在外部修改，请刷新后再删除");
      }
    }

    // unlink 前立即重新校验，杜绝经由软链祖先的路径。
    const revalidated = await getSafeVaultTarget(root, input.relativePath);
    const revalidatedStats = await lstat(revalidated.absolutePath);
    if (!revalidatedStats.isFile()) throw new Error("Vault 目标不是普通文件");
    await unlink(revalidated.absolutePath);
  };

  return {
    listFiles,
    readFile: readFileEntry,
    resolveMedia,
    savePastedImage,
    writeFile,
    createUntitledNote,
    createUntitledNoteInFolder,
    createFolder,
    renameFile,
    deleteFile,
  };
}

export type VaultFileSystem = ReturnType<typeof createVaultFileSystem>;
