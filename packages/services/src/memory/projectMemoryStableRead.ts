import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import {
  PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
} from "#src/memory/memory.js";

const PROJECT_MEMORY_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export async function readProjectMemoryFileFromStableHandle(params: {
  fileName: string;
  filePath: string;
  validatePath: () => Promise<void>;
}): Promise<{ content: string; updatedAt: number }> {
  const preOpenStat = await lstat(params.filePath, { bigint: true });
  if (!preOpenStat.isFile() || preOpenStat.isSymbolicLink()) {
    throw new Error(`Project Memory file is not a regular file: ${params.filePath}`);
  }

  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  // 路径检查后再 readFile(path) 会重新解析路径，可能跟随并发替换的链接读取外部文件。
  // 只读句柄不加锁、不获取所有权；Memory 原子更新可继续 rename，正文始终从已验证句柄读取。
  const handle = await open(params.filePath, constants.O_RDONLY | noFollowFlag);
  try {
    const openedStat = await handle.stat({ bigint: true });
    await params.validatePath();
    const postOpenStat = await lstat(params.filePath, { bigint: true });
    if (
      !openedStat.isFile() ||
      !postOpenStat.isFile() ||
      postOpenStat.isSymbolicLink() ||
      !isSameFileSnapshot(openedStat, preOpenStat) ||
      !isSameFileSnapshot(openedStat, postOpenStat)
    ) {
      throwFileChangedError(params.fileName);
    }

    if (openedStat.size > BigInt(PROJECT_MEMORY_PREVIEW_MAX_BYTES)) {
      throwPreviewLimitError(params.fileName);
    }

    const content = await readBoundedFile(handle, PROJECT_MEMORY_PREVIEW_MAX_BYTES + 1);
    const finalStat = await handle.stat({ bigint: true });
    // 原子 rename 失败时写入会退化为同 inode 的原地覆盖，仅读取文件身份无法识别内容变化。
    if (!isSameFileSnapshot(openedStat, finalStat)) {
      throwFileChangedError(params.fileName);
    }
    if (
      content.length > PROJECT_MEMORY_PREVIEW_MAX_BYTES ||
      finalStat.size > BigInt(PROJECT_MEMORY_PREVIEW_MAX_BYTES)
    ) {
      throwPreviewLimitError(params.fileName);
    }
    return {
      content: content.toString("utf-8"),
      updatedAt: Number(finalStat.mtimeNs) / 1_000_000,
    };
  } finally {
    await handle.close();
  }
}

function isSameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return (
    // 修复依据（verify:pre-push 2026-10-24 Windows 失败）：Windows 上 path 侧 stat/lstat
    // 与 fd 侧 fstat 的 st_dev 口径不一致（实测 node v24 win32：path 侧 dev 恒为 0、
    // fstat.dev 为卷序列号；ino/size/mtimeNs/ctimeNs 两源一致）。本函数的跨源比对
    // （fd 快照 vs path 快照，:32/:33）因此在 Windows 上必然误报 FILE_CHANGED，预览
    // 全挂（含 5 MiB 超限检查前的误抛）。dev 为 0 = 来源未提供设备标识，跳过比较；
    // POSIX 两源 dev 均为真实非 0 值，等价性不变（fd↔fd 比对 :45 亦不受影响）。
    // 同 quirk 内联副本见 feedbackLogArchive.ts / gen-ui/adapters/files.ts（架构门禁：
    // services src 根新文件需 managed 模块，故不抽共享文件）。
    isComparableDevice(left.dev, right.dev) &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/** dev 任一侧为 0（来源未提供设备标识，Windows path 侧）即视为不可比；双非 0 才要求相等。 */
function isComparableDevice(left: bigint, right: bigint): boolean {
  return left === right || left === 0n || right === 0n;
}

async function readBoundedFile(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const buffer = Buffer.alloc(maxBytes);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

function throwPreviewLimitError(fileName: string): never {
  throw Object.assign(
    new Error(`Project Memory file exceeds the 5 MiB preview limit: ${fileName}`),
    { code: PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE },
  );
}

function throwFileChangedError(fileName: string): never {
  throw Object.assign(new Error(`Project Memory file changed during preview: ${fileName}`), {
    code: PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
  });
}
