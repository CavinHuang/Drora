/**
 * mp3 帧测试夹具（§16.3 帧缓冲与流式播放器测试共用）：手工构造合法 MPEG1 Layer3 帧
 * （128kbps/44.1kHz → 帧长 417/418 按 padding），与生产解析表严格一致。
 */

/** 构造一帧合法帧头 + 填充数据（128kbps/44.1kHz MPEG1 L3，无 padding → 417 字节）。 */
export function makeFrame(padding = false, filler = 0xab): Uint8Array {
  const frameLen = 417 + (padding ? 1 : 0);
  const frame = new Uint8Array(frameLen);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG1 / Layer3 / no CRC
  frame[2] = (0b1001 << 4) | (0b00 << 2) | ((padding ? 1 : 0) << 1) | 0;
  frame.fill(filler, 4);
  return frame;
}

export function makeStream(count: number, paddingForLast = false): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(makeFrame(paddingForLast && i === count - 1));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
