/**
 * PCM 流抓取（specs/voice-agent-integration.md §9.6.10，按 Proma voice-audio-utils 架构）：
 * getUserMedia → AudioContext + ScriptProcessorNode → floatTo16BitPcm 重采样 16k/16bit/单声道
 * → 200ms 切块回调。纯函数（重采样/切块）与运行时（getUserMedia/节点装配）分离，jsdom 可测。
 */

export const TARGET_SAMPLE_RATE = 16000;
/** 200ms @16k/16bit/单声道 = 6400 字节。 */
export const PCM_CHUNK_BYTES = TARGET_SAMPLE_RATE * 2 * 0.2;

/** Float32 样本（inputSampleRate）→ 16k/16bit/单声道 PCM（均值抽取降采样）。 */
export function floatTo16BitPcm(samples: Float32Array, inputSampleRate: number): ArrayBuffer {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(outputLength * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length);
    let sum = 0;
    for (let j = start; j < end; j += 1) {
      sum += samples[j] ?? 0;
    }
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** 缓冲切块：凑满 CHUNK_BYTES 即吐块，余量留存。 */
export function splitPcmChunks(buffer: ArrayBuffer): { chunks: ArrayBuffer[]; rest: ArrayBuffer } {
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  while (buffer.byteLength - offset >= PCM_CHUNK_BYTES) {
    chunks.push(buffer.slice(offset, offset + PCM_CHUNK_BYTES));
    offset += PCM_CHUNK_BYTES;
  }
  return { chunks, rest: buffer.slice(offset) };
}

/** 运行时抓取句柄（deps 注入 getUserMedia/AudioContext 可测；生产缺省 window 系）。 */
export interface PcmStreamHandle {
  /** 每 200ms PCM 块（6400B）。 */
  onChunk(chunk: ArrayBuffer): void;
  /** 停止：停轨 + 断节点 + 关 ctx；返回残余缓冲（不足一块的部分，isLast 帧前发）。 */
  stop(): { remainder: ArrayBuffer | null };
}

export interface PcmStreamDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  scriptBufferSize?: number;
}

export function startPcmStreamCapture(
  onChunk: (chunk: ArrayBuffer) => void,
  deps: PcmStreamDeps = {},
): Promise<PcmStreamHandle> {
  const getUserMedia =
    deps.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  const createCtx = deps.createAudioContext ?? (() => new AudioContext());
  const bufferSize = deps.scriptBufferSize ?? 4096;
  return (async () => {
    const stream = await getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = createCtx();
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessorNode 已废弃但在 Electron/Chromium 稳定可用（Proma 同款）；AudioWorklet
    // 需独立 worklet 模块加载，v1 按实证路径。
    const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
    let carry = new ArrayBuffer(0);
    let stopped = false;
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (stopped) return;
      const pcm = floatTo16BitPcm(event.inputBuffer.getChannelData(0), ctx.sampleRate);
      const merged = concatBuffers([carry, pcm]);
      const { chunks, rest } = splitPcmChunks(merged);
      carry = rest;
      for (const chunk of chunks) {
        onChunk(chunk);
      }
    };
    source.connect(processor);
    // ScriptProcessor 需接 destination 才跑（Chromium 实现细节）；经零增益防回声。
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(ctx.destination);
    return {
      onChunk: () => undefined, // 句柄保留形状（外部经构造回调收块）
      stop() {
        stopped = true;
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        mute.disconnect();
        for (const track of stream.getTracks()) track.stop();
        void ctx.close().catch(() => undefined);
        const remainder = carry.byteLength > 0 ? carry : null;
        carry = new ArrayBuffer(0);
        return { remainder };
      },
    };
  })();
}

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    out.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return out.buffer;
}
