// relay 线协议·标准 base64 编解码（rpc-frame dataBase64 载荷用，浏览器可用）。
// 与 bytesToBase64Url（proof 用 base64url）同族：纯 JS 查表实现，无 node:crypto
// 依赖。对齐语义：Buffer.from(bytes).toString("base64") / Buffer.from(text, "base64")。

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALPHA_INDEX = new Map<string, number>(
  Array.from(ALPHA, (char, index) => [char, index] as const),
);

/** bytes → 标准 base64（带 padding；等价 Buffer#toString("base64")）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHA[b0 >> 2];
    out += ALPHA[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) {
      out += "==";
      break;
    }
    out += ALPHA[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) {
      out += "=";
      break;
    }
    out += ALPHA[b2 & 63];
  }
  return out;
}

/**
 * 标准 base64 → bytes。宽松面：空白与非法字符一律截断停止（返回已解码前缀）；
 * 长度非法（%4==1）时丢弃末位孤儿位。本解码仅用于其后必过 crc32 校验的
 * dataBase64 载荷——截断即校验失败，fail-closed。
 */
export function base64ToBytes(text: string): Uint8Array {
  const clean: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === "=" || char === "\n" || char === "\r" || char === " " || char === "\t") break;
    const value = ALPHA_INDEX.get(char);
    if (value === undefined) break;
    clean.push(value);
  }
  const byteLength = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(byteLength);
  let offset = 0;
  for (let i = 0; i < clean.length && offset < byteLength; i += 4) {
    const b0 = clean[i]!;
    const b1 = clean[i + 1];
    const b2 = clean[i + 2];
    const b3 = clean[i + 3];
    if (b1 !== undefined && offset < byteLength) out[offset++] = (b0 << 2) | (b1 >> 4);
    if (b1 !== undefined && b2 !== undefined && offset < byteLength) {
      out[offset++] = ((b1 & 15) << 4) | (b2 >> 2);
    }
    if (b2 !== undefined && b3 !== undefined && offset < byteLength) {
      out[offset++] = ((b2 & 3) << 6) | b3;
    }
  }
  return out;
}
