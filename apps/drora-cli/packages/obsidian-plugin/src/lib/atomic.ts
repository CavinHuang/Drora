import { randomBytes } from "node:crypto";
import { open, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * 原子重写文本文件：`wx` 独占创建随机临时兄弟文件（0o600）后 rename 替换目标。
 * 永不使用可预测的 `<target>.tmp` —— 能进入该目录的攻击者可以把它预创建成软链；
 * `wx` 保证临时文件私有，rename 替换目标本身而不跟随软链。
 */
export async function writeTextFileAtomic(filePath: string, content: string): Promise<void> {
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
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
        throw error;
      }
    }
    if (handle === null || tmpPath === null) throw new Error(`无法为原子写入创建临时文件: ${filePath}`);
    await handle.writeFile(content, "utf-8");
    await handle.close();
    handle = null;
    await rename(tmpPath, filePath);
    tmpPath = null;
  } finally {
    if (handle !== null) await handle.close().catch(() => {});
    if (tmpPath !== null) {
      await unlink(tmpPath).catch(() => {});
    }
  }
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
