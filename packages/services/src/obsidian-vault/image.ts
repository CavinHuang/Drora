// 移植自 obsidian-plugin src/lib/image.ts（与 Proma vault-service 同源）。
// 与 obsidian MCP server 共享同一份 vault-config.json 与同一安全不变量集；
// 逐条保留：相对路径校验/软链拒绝/根内前缀判定/2MB 读写上限/目录配额/
// wx 独占临时文件 0o600 + rename 原子写/sha256 乐观锁/图片 MIME+魔数+10MB 白名单。
/** 图片魔数校验：字节流必须与声明的 MIME 一致，防止把任意数据当图片落盘。 */

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;
  let offset = 8;
  let hasIhdr = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    if (!hasIhdr) {
      if (type !== "IHDR" || length !== 13) return false;
      hasIhdr = true;
    }
    if (type === "IEND") return length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

const IMAGE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": isPng,
  "image/jpeg": (bytes) =>
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9,
  "image/gif": (bytes) =>
    bytes.length >= 14 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") &&
    bytes[bytes.length - 1] === 0x3b,
  "image/webp": (bytes) =>
    bytes.length >= 16 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.readUInt32LE(4) + 8 === bytes.length &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP",
};

/** 字节流必须非空且匹配声明 MIME 的文件签名。 */
export function isValidImageBytes(mimeType: string, bytes: Buffer): boolean {
  const matchesSignature = IMAGE_SIGNATURES[mimeType.trim().toLowerCase()];
  return bytes.length > 0 && Boolean(matchesSignature?.(bytes));
}
