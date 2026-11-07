import { describe, expect, it, vi } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  buildDoubaoAudioFrame,
  buildDoubaoClientRequest,
  createDoubaoAsrService,
  doubaoAsrEndpoint,
  parseDoubaoServerMessage,
  type DoubaoAsrWsLike,
} from "../src/main/doubaoAsrService.js";
import type {
  VoiceAsrStreamStateFrame,
  VoiceAsrStreamTranscriptFrame,
} from "@drora/shared";

/**
 * §9.6.10 豆包流式 ASR 契约（specs/voice-agent-integration.md §9.6.10）：帧编解码字节级
 * 校验（gzip 回解内容而非字节 golden——zlib 确定性不承诺）；WS 会话状态机（Start/Audio/
 * Transcript/Abort/GC 四路）；Proma 实证语义（result 候选取优/definite 句终/last 序列结束）。
 */

const START_REQUEST = {
  apiKey: "single-key-1",
  resourceId: "volc.seedasr.sauc.duration",
  endpointMode: "async" as const,
  language: "zh",
};

describe("帧编解码（sauc 二进制协议）", () => {
  it("客户端首帧：头字节/大小/gzip JSON 内容（听写调优参数齐备）", () => {
    const frame = buildDoubaoClientRequest(START_REQUEST);
    expect(frame[0]).toBe((0b0001 << 4) | 0b0001); // 版本|头长
    expect(frame[1]).toBe((0b0001 << 4) | 0b0000); // FULL_CLIENT_REQUEST|NO_SEQUENCE
    expect(frame[2]).toBe((0b0001 << 4) | 0b0001); // JSON|GZIP
    expect(frame.readUInt32BE(4)).toBe(frame.byteLength - 8);
    const payload = JSON.parse(gunzipSync(frame.subarray(8)).toString("utf8"));
    expect(payload.audio).toMatchObject({ format: "pcm", rate: 16000, bits: 16, channel: 1, language: "zh" });
    expect(payload.request).toMatchObject({
      model_name: "bigmodel",
      show_utterances: true,
      enable_itn: true,
      enable_punc: true,
      end_window_size: 5000,
    });
  });

  it("音频帧：非 last/last 的 FLAG 位；payload gzip 回解等于原 PCM", () => {
    const pcm = Buffer.from(new Uint8Array([1, 2, 3, 4]));
    const normal = buildDoubaoAudioFrame(pcm, false);
    const last = buildDoubaoAudioFrame(pcm, true);
    expect(normal[1]).toBe((0b0010 << 4) | 0b0000);
    expect(last[1]).toBe((0b0010 << 4) | 0b0010); // FLAG_LAST_NO_SEQUENCE
    expect(Buffer.from(gunzipSync(normal.subarray(8)))).toEqual(pcm);
  });

  it("服务端帧解析：result 候选取 confidence 最优（不拼接）；definite 判句终；last 序列=会话终", () => {
    const encode = (payload: unknown, flags: number) => {
      const body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
      const header = Buffer.from([
        (0b0001 << 4) | 0b0001,
        (0b1001 << 4) | flags,
        (0b0001 << 4) | 0b0001,
        0x00,
      ]);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(body.length, 0);
      return Buffer.concat([header, size, body]);
    };
    // 两个候选：confidence 高者胜。
    const candidates = encode(
      {
        result: [
          { text: "低置信度候选", confidence: 0.4 },
          { text: "高置信度候选", confidence: 0.9 },
        ],
      },
      0b0001,
    );
    expect(parseDoubaoServerMessage(candidates)).toMatchObject({ text: "高置信度候选", isFinal: false });
    // definite 句终。
    const definite = encode(
      { result: { text: "一句完整的话。", utterances: [{ text: "一句完整的话。", definite: true }] } },
      0b0001,
    );
    expect(parseDoubaoServerMessage(definite)).toMatchObject({ text: "一句完整的话。", isFinal: true });
    // 服务端 last 序列 = 会话级结束。
    const sessionEnd = encode({ result: { text: "尾句" } }, 0b0011);
    expect(parseDoubaoServerMessage(sessionEnd)).toMatchObject({ text: "尾句", isFinal: true });
    // SERVER_ERROR 帧。
    const err = encode({ error: "quota" }, 0b0000) ;
    const errFrame = Buffer.concat([
      Buffer.from([(0b0001 << 4) | 0b0001, (0b1111 << 4) | 0b0000, (0b0001 << 4) | 0b0001, 0]),
      (() => { const s = Buffer.alloc(4); s.writeUInt32BE(err.subarray(8).length, 0); return s; })(),
      err.subarray(8),
    ]);
    expect(parseDoubaoServerMessage(errFrame)?.errorMessage).toBeTruthy();
  });

  it("端点映射：async/duplex", () => {
    expect(doubaoAsrEndpoint("async")).toBe("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async");
    expect(doubaoAsrEndpoint("duplex")).toBe("wss://openspeech.bytedance.com/api/v3/sauc/bigmodel");
  });
});

/** fake WS：手动驱动 open/message/close/error。 */
function fakeWs() {
  const listeners = { open: [] as Array<() => void>, error: [] as Array<(e: Error) => void>, close: [] as Array<() => void>, message: [] as Array<(d: Buffer) => void> };
  const sent: Buffer[] = [];
  const ws: DoubaoAsrWsLike = {
    send: (data) => sent.push(data),
    close: () => listeners.close.forEach((cb) => cb()),
    terminate: () => listeners.close.forEach((cb) => cb()),
    once: (event: "open" | "error" | "close", cb: never) => {
      (listeners[event] as unknown[]).push(cb);
    },
    on: (event: "message", cb: (d: Buffer) => void) => {
      listeners.message.push(cb);
    },
  } as DoubaoAsrWsLike;
  return {
    ws,
    sent,
    emitOpen: () => listeners.open.forEach((cb) => cb()),
    emitMessage: (data: Buffer) => listeners.message.forEach((cb) => cb(data)),
    emitError: (error: Error) => listeners.error.forEach((cb) => cb(error)),
  };
}

describe("会话状态机（deps 注入 fake WS）", () => {
  it("Start：鉴权四头 → open 后发首帧 → resolve streamId", async () => {
    const fake = fakeWs();
    const connect = vi.fn(() => fake.ws);
    const transcripts: VoiceAsrStreamTranscriptFrame[] = [];
    const service = createDoubaoAsrService({
      connect,
      sendTranscript: (frame) => transcripts.push(frame),
      sendState: () => undefined,
    });
    const pending = service.start(START_REQUEST);
    expect(connect).toHaveBeenCalledWith(
      doubaoAsrEndpoint("async"),
      expect.objectContaining({
        "X-Api-Key": "single-key-1",
        "X-Api-Resource-Id": "volc.seedasr.sauc.duration",
      }),
    );
    fake.emitOpen();
    const { streamId } = await pending;
    expect(streamId).toBeTruthy();
    expect(fake.sent[0]![1]! >> 4).toBe(0b0001); // 首帧=client request
    service.abort({ streamId });
  });

  it("Audio 上行：帧类型=audio；isLast 后帧仍可发（尾帧标志）", async () => {
    const fake = fakeWs();
    const service = createDoubaoAsrService({ connect: () => fake.ws, sendTranscript: () => undefined, sendState: () => undefined });
    const pending = service.start(START_REQUEST);
    fake.emitOpen();
    const { streamId } = await pending;
    service.sendAudio({ streamId, pcm: new ArrayBuffer(4), isLast: false });
    service.sendAudio({ streamId, pcm: new ArrayBuffer(4), isLast: true });
    expect(fake.sent[1]![1]! >> 4).toBe(0b0010);
    expect(fake.sent[2]![1]! & 0x0f).toBe(0b0010); // last 标志
    service.abort({ streamId });
  });

  it("下行转写：partial 与 final 推 sendTranscript；服务端 last 序列 → state ended + 摘会话", async () => {
    const fake = fakeWs();
    const transcripts: VoiceAsrStreamTranscriptFrame[] = [];
    const states: VoiceAsrStreamStateFrame[] = [];
    const service = createDoubaoAsrService({
      connect: () => fake.ws,
      sendTranscript: (frame) => transcripts.push(frame),
      sendState: (frame) => states.push(frame),
    });
    const pending = service.start(START_REQUEST);
    fake.emitOpen();
    const { streamId } = await pending;
    const serverFrame = (payload: unknown, flags: number) => {
      const body = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
      const header = Buffer.from([0x11, (0b1001 << 4) | flags, 0x11, 0]);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(body.length, 0);
      return Buffer.concat([header, size, body]);
    };
    fake.emitMessage(serverFrame({ result: { text: "实时" } }, 0b0001));
    fake.emitMessage(serverFrame({ result: { text: "完整句。", utterances: [{ definite: true }] } }, 0b0011));
    expect(transcripts.map((t) => [t.text, t.isFinal])).toEqual([
      ["实时", false],
      ["完整句。", true],
    ]);
    expect(states).toEqual([{ streamId, status: "ended" }]);
    await service.idle();
  });

  it("connect 失败 → reject + state error；未知 streamId 的 Audio 零发送", async () => {
    const fake = fakeWs();
    const states: VoiceAsrStreamStateFrame[] = [];
    const service = createDoubaoAsrService({
      connect: () => fake.ws,
      sendTranscript: () => undefined,
      sendState: (frame) => states.push(frame),
    });
    const pending = service.start(START_REQUEST);
    fake.emitError(new Error("dns"));
    await expect(pending).rejects.toThrow(/dns/);
    expect(states[0]?.status).toBe("error");
    const before = fake.sent.length;
    service.sendAudio({ streamId: "unknown", pcm: new ArrayBuffer(4), isLast: false });
    expect(fake.sent.length).toBe(before);
  });
});
