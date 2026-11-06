/**
 * mp3 帧边界缓冲（specs/model-capabilities.md §16.3）：流式分片不保证落在 mp3 帧边界
 * （不做火山分片对齐假设），跨片累积后按帧头同步扫描切出完整帧，不完整尾巴留在缓冲。
 *
 * mp3 帧头（4 字节）：11 bit 同步全 1 + version/layer/bitrate/samplerate/padding；
 * 帧长 = samplesPerFrame/8 * bitrate / sampleRate + padding（Layer3：MPEG1 144、
 * MPEG2/2.5 72；Layer1 乘 4）。保留 reserved 组合 fail-safe：当作非同步字节跳过。
 * 纯函数不持状态——调用方持缓冲，逐片喂 concat 后取 frames 与 rest。
 */

const MPEG1_L3_BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const MPEG2_L3_BITRATES_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;
const MPEG1_L2_BITRATES_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384] as const;
const MPEG2_L2_BITRATES_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;
const MPEG1_L1_BITRATES_KBPS = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448] as const;
const MPEG2_L1_BITRATES_KBPS = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256] as const;
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

/** 解析帧头为帧长（字节数）；非法组合返回 null（非同步位置）。 */
function mp3FrameLengthAt(buf: Uint8Array, i: number): number | null {
  if (i + 4 > buf.length) {
    return null;
  }
  if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) {
    return null;
  }
  const version = (buf[i + 1]! >> 3) & 3; // 0=MPEG2.5, 1=reserved, 2=MPEG2, 3=MPEG1
  const layerBits = (buf[i + 1]! >> 1) & 3; // 0=reserved, 1=Layer3, 2=Layer2, 3=Layer1
  const bitrateIndex = (buf[i + 2]! >> 4) & 0xf;
  const sampleIndex = (buf[i + 2]! >> 2) & 3;
  const padding = (buf[i + 2]! >> 1) & 1;
  const sampleRates = SAMPLE_RATES[version];
  if (version === 1 || layerBits === 0 || sampleIndex === 3 || sampleRates == null) {
    return null;
  }
  const sampleRate = sampleRates[sampleIndex];
  if (sampleRate == null || bitrateIndex === 0 || bitrateIndex === 15) {
    return null;
  }
  const isMpeg1 = version === 3;
  const kbpsTable =
    layerBits === 1
      ? isMpeg1
        ? MPEG1_L3_BITRATES_KBPS
        : MPEG2_L3_BITRATES_KBPS
      : layerBits === 2
        ? isMpeg1
          ? MPEG1_L2_BITRATES_KBPS
          : MPEG2_L2_BITRATES_KBPS
        : isMpeg1
          ? MPEG1_L1_BITRATES_KBPS
          : MPEG2_L1_BITRATES_KBPS;
  const kbps = kbpsTable[bitrateIndex];
  if (kbps == null || kbps === 0) {
    return null;
  }
  if (layerBits === 3) {
    // Layer1：384 samples/frame，4 字节 slot。
    return (Math.floor((12 * kbps * 1000) / sampleRate) + padding) * 4;
  }
  // Layer2/3：MPEG1 1152 samples（144 因子）；MPEG2/2.5 576 samples（72 因子）。
  const samplesFactor = isMpeg1 ? 144 : 72;
  return Math.floor((samplesFactor * kbps * 1000) / sampleRate) + padding;
}

export interface Mp3FrameExtractResult {
  /** 从缓冲切出的完整帧（按序拼接即是合法 mp3 流片段）。 */
  frames: Uint8Array[];
  /** 不完整尾巴（下一片到达后拼回继续切）。 */
  rest: Uint8Array;
}

/**
 * 从缓冲切出全部完整 mp3 帧：同步扫描 + 帧头严格解析（version/layer/bitrate/sample
 * 合法组合校验）。不做「下一帧头确认」启发式——流内插入字节会让确认逻辑误丢真帧；
 * 伪帧头（需 0xFF 0xFx 且全字段合法组合）概率极低，后果是错切一帧 → 解码失败 →
 * 句 error 回落（fail-visible），权衡可接受。尾部不足一帧留在 rest（下一片到达后重扫）。
 */
export function extractCompleteMp3Frames(buf: Uint8Array): Mp3FrameExtractResult {
  const frames: Uint8Array[] = [];
  let i = 0;
  while (i < buf.length) {
    const frameLen = buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0 ? mp3FrameLengthAt(buf, i) : null;
    if (frameLen == null || frameLen < 4) {
      i += 1;
      continue;
    }
    if (i + frameLen > buf.length) {
      break; // 尾帧未收全：留在 rest。
    }
    frames.push(buf.slice(i, i + frameLen));
    i += frameLen;
  }
  return { frames, rest: buf.slice(i) };
}
