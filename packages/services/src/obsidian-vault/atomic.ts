// 移植自 obsidian-plugin src/lib/atomic.ts（与 Proma vault-service 同源）。
// 与 obsidian MCP server 共享同一份 vault-config.json 与同一安全不变量集；
// 逐条保留：相对路径校验/软链拒绝/根内前缀判定/2MB 读写上限/目录配额/
// wx 独占临时文件 0o600 + rename 原子写/sha256 乐观锁/图片 MIME+魔数+10MB 白名单。
import { randomBytes } from "node:crypto";
import { link, open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { basename, dirname, join } from "node:path";

/**
 * 原子重写文本文件：`wx` 独占创建随机临时兄弟文件（0o600）后 rename 替换目标。
 * 永不使用可预测的 `<target>.tmp` —— 能进入该目录的攻击者可以把它预创建成软链；
 * `wx` 保证临时文件私有，rename 替换目标本身而不跟随软链。
 */
export async function writeTextFileAtomic(
  filePath: string,
  content: string,
  options: { createOnly?: boolean } = {},
): Promise<void> {
  const parent = dirname(filePath);
  const stem = basename(filePath);
  let tmpPath: string | null = null;
  let handle: FileHandle | null = null;
  try {
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = join(parent, `.${stem}.drora-${randomBytes(12).toString("hex")}.tmp`);
      try {
        handle = await open(candidate, "wx", 0o600);
        tmpPath = candidate;
        break;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
          continue;
        throw error;
      }
    }
    if (handle === null || tmpPath === null)
      throw new Error(`无法为原子写入创建临时文件: ${filePath}`);
    await handle.writeFile(content, "utf-8");
    await handle.close();
    handle = null;
    if (options.createOnly) {
      // rename 会覆盖检查后才出现的目标；hard-link 原子发布完整文件且 EEXIST 时零覆盖。
      try {
        await link(tmpPath, filePath);
      } catch (error) {
        if (!isHardLinkUnavailableError(error)) throw error;
        // SV-3 兜底（2026-10-18 终审）：硬链接不可用的文件系统（Windows exFAT/FAT
        // 卷不支持硬链接，Linux NFS/exFAT 挂载同理）上，先以 wx 独占创建占位文件再
        // rename 覆盖占位——占位创建成功即锁定目标名的独占性（他人目标已存在时 wx
        // 得 EEXIST），rename 只覆盖自己的占位，「零覆盖发布」语义不变；任何失败
        // （含 wx EEXIST）仍上抛，由调用方落 conflict（fail-closed 不变）。
        // rename 失败时占位可能残留（空文件），后续 createOnly 重试将得 EEXIST 而
        // fail-closed；不自动清理占位——清理存在误删他人并发写入内容的竞态窗口。
        const placeholder = await open(filePath, "wx", 0o600);
        await placeholder.close();
        await renameWithWindowsRetry(tmpPath, filePath);
        tmpPath = null;
      }
    } else {
      await renameWithWindowsRetry(tmpPath, filePath);
      tmpPath = null;
    }
  } finally {
    if (handle !== null) await handle.close().catch(() => {});
    if (tmpPath !== null) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}

/**
 * Windows may transiently deny replacement while an editor, indexer, or
 * antivirus scanner briefly holds the destination without delete sharing.
 * Keep the replacement operation rename-based (never copy/truncate): retry
 * only the platform-specific sharing/permission errors so the write remains
 * atomic once the OS releases the handle.
 */
async function renameWithWindowsRetry(sourcePath: string, targetPath: string): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !isRetryableWindowsRenameError(error) ||
        attempt >= maxAttempts - 1
      ) {
        throw error;
      }
      await delay(Math.min(25 * 2 ** attempt, 750));
    }
  }
}

/**
 * 硬链接不可用的文件系统错误判定（SV-3，2026-10-18 终审）：Windows FAT/exFAT 卷
 * 不支持硬链接（CreateHardLinkW 失败映射 EPERM/ENOSYS/ENOTSUP），Linux 的 NFS、
 * exFAT 等挂载返回 EOPNOTSUPP/ENOSYS。EEXIST（目标已存在）不属于此类——它是
 * 零覆盖语义的正确拒绝，必须原样上抛由调用方落 conflict。
 */
function isHardLinkUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = error.code;
  return code === "EPERM" || code === "ENOSYS" || code === "EOPNOTSUPP" || code === "ENOTSUP";
}

function isRetryableWindowsRenameError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  // SV-4（2026-10-18 终审）：EACCES 是持久拒绝（目录 ACL 禁止替换），重试只会拖长
  // 失败路径——立即失败；EPERM/EBUSY 才是 Windows AV/编辑器瞬时持有目标句柄的
  // 场景，保留重试等待句柄释放。
  const code = error.code;
  return code === "EPERM" || code === "EBUSY";
}

export interface JsonFileIO {
  read: <T>(filePath: string) => Promise<T | null>;
  write: (filePath: string, data: object) => Promise<void>;
}

/**
 * JSON 配置文件的崩溃安全读写：写入走原子替换，读取遇到空/损坏文件返回 null
 * 由上层决定默认值。配置是唯一的 Vault 事实源，损坏时宁可回到未配置态，
 * 也不用猜测值继续写用户笔记。
 */
export const jsonFileIO: JsonFileIO = {
  async read<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, "utf-8");
      if (raw.trim().length === 0) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async write(filePath: string, data: object): Promise<void> {
    await writeTextFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
  },
};
