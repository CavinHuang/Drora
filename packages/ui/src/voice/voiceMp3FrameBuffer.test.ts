import { describe, expect, it } from "vitest";
import { extractCompleteMp3Frames } from "./voiceMp3FrameBuffer.js";
import { makeFrame, makeStream, concatBytes } from "./voiceMp3FrameBuffer.test-utils.js";

/**
 * mp3 帧边界缓冲契约（specs/model-capabilities.md §16.3）：手工构造合法 MPEG1 Layer3
 * 帧序列（128kbps/44.1kHz → 帧长 417/418 按 padding），验证完整帧切分、跨片重组、
 * 伪帧头跳过与不完整尾巴保留。
 */

describe("extractCompleteMp3Frames（§16.3 帧边界缓冲）", () => {
  it("完整帧序列 → 全部切出，rest 为空", () => {
    const stream = makeStream(5);
    const { frames, rest } = extractCompleteMp3Frames(stream);
    expect(frames).toHaveLength(5);
    expect(frames.reduce((n, f) => n + f.length, 0)).toBe(stream.length);
    expect(rest.length).toBe(0);
    // 帧头完整保留（首字节同步字）。
    expect(frames[0]![0]).toBe(0xff);
    expect(frames[0]![1]! & 0xe0).toBe(0xe0);
  });

  it("尾部不完整帧 → 完整帧切出，尾巴留在 rest（跨片重组）", () => {
    const stream = makeStream(3); // 3 × 417 = 1251
    const cut = stream.length - 100; // 第 3 帧只收到 317 字节
    const { frames, rest } = extractCompleteMp3Frames(stream.slice(0, cut));
    expect(frames).toHaveLength(2);
    expect(rest.length).toBe(317);
    // 补上尾巴后第 3 帧切出。
    const second = extractCompleteMp3Frames(concatBytes(rest, stream.slice(cut)));
    expect(second.frames).toHaveLength(1);
    expect(second.rest.length).toBe(0);
  });

  it("padding 帧（418 字节）帧长计算正确", () => {
    const stream = makeStream(2, true);
    const { frames, rest } = extractCompleteMp3Frames(stream);
    expect(frames).toHaveLength(2);
    expect(frames[1]!.length).toBe(418);
    expect(rest.length).toBe(0);
  });

  it("音频数据中的伪帧头（非同步组合）被跳过不误切", () => {
    // 第一帧正常；数据区塞 0xFF 0x50（version=reserved 组合）伪帧头；第二帧正常。
    const frameA = makeFrame();
    const frameB = makeFrame();
    const stream = new Uint8Array(frameA.length + 2 + frameB.length);
    stream.set(frameA, 0);
    stream.set([0xff, 0x50], frameA.length); // 0x50: 同步 bit 不全（&0xE0 ≠ 0xE0）→ 非帧头
    stream.set(frameB, frameA.length + 2);
    const { frames, rest } = extractCompleteMp3Frames(stream);
    // 伪帧头会被同步扫描跳过：两帧完整切出。
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(rest.length).toBe(0);
  });

  it("空缓冲 → 空 frames + 空 rest", () => {
    const { frames, rest } = extractCompleteMp3Frames(new Uint8Array());
    expect(frames).toHaveLength(0);
    expect(rest.length).toBe(0);
  });
});

