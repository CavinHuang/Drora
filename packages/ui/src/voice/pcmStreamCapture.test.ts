import { describe, expect, it } from "vitest";
import {
  PCM_CHUNK_BYTES,
  floatTo16BitPcm,
  splitPcmChunks,
} from "./pcmStreamCapture.js";

/** §9.6.10 PCM 抓取纯函数（Proma voice-audio-utils 算法同构）：重采样精度与切块边界。 */

describe("floatTo16BitPcm（16k/16bit 重采样）", () => {
  it("恒定幅值输入 → 恒定 16bit 值；输入输出时长一致", () => {
    const inputRate = 48000;
    const seconds = 0.1;
    const samples = new Float32Array(inputRate * seconds).fill(0.5);
    const pcm = floatTo16BitPcm(samples, inputRate);
    expect(pcm.byteLength).toBe(16000 * 2 * seconds);
    const view = new DataView(pcm);
    expect(view.getInt16(0, true)).toBe(Math.floor(0.5 * 0x7fff));
    expect(view.getInt16(pcm.byteLength - 2, true)).toBe(Math.floor(0.5 * 0x7fff));
  });

  it("负幅值 → 补码负数；钳制越界幅值", () => {
    const pcm = floatTo16BitPcm(new Float32Array([-0.5, -2, 2]), 16000);
    const view = new DataView(pcm);
    expect(view.getInt16(0, true)).toBe(-0.5 * 0x8000);
    expect(view.getInt16(2, true)).toBe(-0x8000);
    expect(view.getInt16(4, true)).toBe(0x7fff);
  });

  it("同采样率直通（48k→16k 三样本均值抽取验证一档）", () => {
    // 48000→16000：3 个输入样本均值为 1 个输出。[(0.1+0.2+0.3)/3] → 单输出。
    const pcm = floatTo16BitPcm(new Float32Array([0.1, 0.2, 0.3]), 48000);
    expect(pcm.byteLength).toBe(2);
    const view = new DataView(pcm);
    expect(view.getInt16(0, true)).toBe(Math.floor(0.2 * 0x7fff));
  });
});

describe("splitPcmChunks（200ms 切块）", () => {
  it("凑满 PCM_CHUNK_BYTES 吐块，余量留存", () => {
    const buffer = new ArrayBuffer(PCM_CHUNK_BYTES * 2 + 100);
    const { chunks, rest } = splitPcmChunks(buffer);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.byteLength).toBe(PCM_CHUNK_BYTES);
    expect(rest.byteLength).toBe(100);
  });

  it("不足一块：零块全留", () => {
    const { chunks, rest } = splitPcmChunks(new ArrayBuffer(10));
    expect(chunks).toHaveLength(0);
    expect(rest.byteLength).toBe(10);
  });
});
