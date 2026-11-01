// ============================================================
// 测试临时目录清理的 Windows 瞬态重试
// ============================================================
// 依据：src/app/official-plugin-cache-fs.ts 已把 EACCES/EBUSY/EEXIST/ENOTEMPTY/EPERM
// 认定为 Windows 上的瞬态文件系统争用（杀软/索引器扫描新写入的二进制与目录句柄），
// 并为插件缓存内置了重试预算。测试 afterEach 的 rm(tempRoot) 撞上同一类争用
// （临时目录里有刚物化过的插件缓存与 sqlite），沿同一先例做有界重试，
// 只重试瞬态码，其余错误原样抛出。

const TRANSIENT_FS_ERROR_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "ENOTEMPTY", "EPERM"]);

const isTransientFsError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_FS_ERROR_CODES.has(code);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 递归删除测试临时目录；Windows 瞬态文件锁按先例有界重试，超限后原样抛出。 */
export async function rmTestTreeWithRetry(
  path: string,
  options: { attempts?: number; firstDelayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 6;
  const firstDelayMs = options.firstDelayMs ?? 100;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFsError(error)) throw error;
      if (attempt < attempts - 1) {
        await sleep(firstDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
