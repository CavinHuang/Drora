// relay 线协议·纯 JS HMAC-SHA256（浏览器兼容，无 node:crypto 依赖）。
//
// 来源：提取自 packages/relay-server/src/phonePage.ts 的 PHONE_PAGE_CRYPTO_JS
// （R2 自建手机页内联脚本，spec: mobile-relay-server.md §7）。该页面串暂不删除
// （它是 HTML 字符串不是 TS import，删除涉及页面重构，属 R3 页面迁移），但其算法
// 以本文件为单一出处：双方实现经 packages/relay-server/test/phonePageCrypto.test.ts
// 与 packages/shared/test/relayWire*.test.ts 双向对照 node:crypto 及 RFC 4231 向量。
//
// 纯 HTTP 部署下 window.crypto.subtle 不可用（非 secure context），手机页 proof 只能
// 用纯 JS 实现；本文件不做任何环境探测，调用方自行决定走本实现还是 node:crypto 快路径
// （desktop 的 node:crypto 路径保留为环境适配层，见 desktopMobileRelayProtocol.ts）。

/** UTF-8 字节序列化（对齐 __strBytes：encodeURIComponent 逐字符展开，行为同 TextEncoder）。 */
export function utf8Bytes(input: string): number[] {
  const out: number[] = [];
  const enc = encodeURIComponent(input);
  for (let i = 0; i < enc.length; i += 1) {
    if (enc[i] === "%") {
      out.push(parseInt(enc.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(enc.charCodeAt(i));
    }
  }
  return out;
}

// SHA-256 常量表：前 64 个素数的三次方根小数部分前 32 位（FIPS 180-4 标准构造，
// 与位常量表逐值等价；页内实现用 Math.cbrt 是为省体积，此处在 JS 双精度下可复现）。
const shaK = (() => {
  const primes: number[] = [];
  let n = 2;
  while (primes.length < 64) {
    let isP = true;
    for (let d = 2; d * d <= n; d += 1) {
      if (n % d === 0) {
        isP = false;
        break;
      }
    }
    if (isP) primes.push(n);
    n += 1;
  }
  return primes.map((p) => ((Math.cbrt(p) % 1) * 4294967296) | 0);
})();

/** SHA-256 摘要（对齐 __sha256Bytes：输入/输出均为字节数组）。 */
export function sha256Bytes(bytes: number[]): number[] {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const l = bytes.length;
  const bits = l * 8;
  const msg = bytes.concat([0x80]);
  while (msg.length % 64 !== 56) msg.push(0);
  const hi = Math.floor(bits / 4294967296);
  const lo = bits % 4294967296;
  msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  msg.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const w = new Array<number>(64);
  for (let off = 0; off < msg.length; off += 64) {
    for (let t = 0; t < 16; t += 1) {
      w[t] =
        (msg[off + t * 4]! << 24) |
        (msg[off + t * 4 + 1]! << 16) |
        (msg[off + t * 4 + 2]! << 8) |
        msg[off + t * 4 + 3]! |
        0;
    }
    for (let t2 = 16; t2 < 64; t2 += 1) {
      const w15 = w[t2 - 15]!;
      const w2 = w[t2 - 2]!;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      w[t2] = (w[t2 - 16]! + s0 + w[t2 - 7]! + s1) | 0;
    }
    let a = H[0]!;
    let b = H[1]!;
    let c = H[2]!;
    let d = H[3]!;
    let e = H[4]!;
    let f = H[5]!;
    let g = H[6]!;
    let h = H[7]!;
    for (let t3 = 0; t3 < 64; t3 += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const tt1 = (h + S1 + ch + shaK[t3]! + w[t3]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const tt2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + tt1) | 0;
      d = c;
      c = b;
      b = a;
      a = (tt1 + tt2) | 0;
    }
    H[0] = (H[0]! + a) | 0;
    H[1] = (H[1]! + b) | 0;
    H[2] = (H[2]! + c) | 0;
    H[3] = (H[3]! + d) | 0;
    H[4] = (H[4]! + e) | 0;
    H[5] = (H[5]! + f) | 0;
    H[6] = (H[6]! + g) | 0;
    H[7] = (H[7]! + h) | 0;
  }
  const out: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push((H[i]! >>> 24) & 255, (H[i]! >>> 16) & 255, (H[i]! >>> 8) & 255, H[i]! & 255);
  }
  return out;
}

/** HMAC-SHA256（对齐 __hmacSha256Bytes：key > 64 字节先摘要，再按 64 字节块 0x5c/0x36 异或）。 */
export function hmacSha256Bytes(keyStr: string, messageStr: string): number[] {
  let key = utf8Bytes(keyStr);
  if (key.length > 64) key = sha256Bytes(key);
  const outer: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    const b = key[i] ?? 0;
    outer.push(b ^ 0x5c);
    inner.push(b ^ 0x36);
  }
  return sha256Bytes(outer.concat(sha256Bytes(inner.concat(utf8Bytes(messageStr)))));
}

/** 字节 → base64url（对齐 __bytesB64url：标准字母表、无 padding，同 node base64url 编码）。 */
export function bytesToBase64Url(bytes: number[]): string {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alpha[b0 >> 2];
    out += alpha[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    if (b1 === undefined) break;
    out += alpha[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    if (b2 === undefined) break;
    out += alpha[b2 & 63];
  }
  return out;
}
