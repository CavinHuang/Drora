import { describe, expect, it, vi } from "vitest";
import {
  createVoiceVendorProxyHandler,
  createVoiceVendorStreamHandler,
  type VoiceVendorProxyFetchImpl,
} from "../src/main/voiceVendorProxy.js";

/**
 * §15.8 语音厂商出站代理 handler 契约（specs/model-capabilities.md §15.8）：main 不信任
 * renderer 载荷——host 白名单 fail-closed、https 强制、header 键过滤、body 上限；成功路径
 * 载荷透传 + 响应 base64 还原；HTTP 非 2xx 照常返回（与直连 fetch 语义一致）。
 */

function fakeFetchImpl(overrides?: Partial<{
  status: number;
  ok: boolean;
  contentType: string | null;
  body: string;
}>): { impl: VoiceVendorProxyFetchImpl; calls: { input: string; init?: RequestInit }[] } {
  const calls: { input: string; init?: RequestInit }[] = [];
  return {
    calls,
    impl: async (input, init) => {
      calls.push({ input, init });
      const body = overrides?.body ?? "ok-bytes";
      return {
        ok: overrides?.ok ?? true,
        status: overrides?.status ?? 200,
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (overrides?.contentType ?? "application/json") : null) },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
      };
    },
  };
}

const VALID_REQUEST = {
  url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
  headers: { "X-Api-Key": "k1", "Content-Type": "application/json" },
  body: '{"req_params":{"text":"你好"}}',
};

describe("voiceVendorProxy handler（§15.8）", () => {
  it("成功路径：载荷透传（method POST + 过滤后 headers）+ 响应 base64 还原", async () => {
    const { impl, calls } = fakeFetchImpl({ contentType: "application/json" });
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    const response = await handler(VALID_REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toBe(VALID_REQUEST.url);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(VALID_REQUEST.body);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe("application/json");
    // base64 还原为原始字节。
    expect(Buffer.from(response.bodyBase64, "base64").toString("utf8")).toBe("ok-bytes");
  });

  it("header 键过滤：cookie/trace 类被剔除，x-api-*/authorization/content-type 保留", async () => {
    const { impl, calls } = fakeFetchImpl();
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await handler({
      ...VALID_REQUEST,
      headers: {
        ...VALID_REQUEST.headers,
        Cookie: "session=evil",
        "X-Trace-Id": "t1",
        Authorization: "Bearer x",
      },
    });
    const sentHeaders = calls[0]!.init?.headers as Record<string, string>;
    expect(sentHeaders.Cookie).toBeUndefined();
    expect(sentHeaders["X-Trace-Id"]).toBeUndefined();
    expect(sentHeaders["X-Api-Key"]).toBe("k1");
    expect(sentHeaders.Authorization).toBe("Bearer x");
  });

  it("host 不在白名单 → 拒绝（fail-closed，无出站）", async () => {
    const { impl, calls } = fakeFetchImpl();
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await expect(
      handler({ ...VALID_REQUEST, url: "https://evil.example.com/api/v3/tts/unidirectional" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("http 降级 → 拒绝（白名单域必须 https）", async () => {
    const { impl, calls } = fakeFetchImpl();
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await expect(
      handler({ ...VALID_REQUEST, url: "http://openspeech.bytedance.com/api/v3/tts/unidirectional" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("body 超上限 → schema 拒绝", async () => {
    const { impl, calls } = fakeFetchImpl();
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await expect(
      handler({ ...VALID_REQUEST, body: "x".repeat(64 * 1024 + 1) }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("载荷形状非法（headers 非记录）→ schema 拒绝", async () => {
    const { impl, calls } = fakeFetchImpl();
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await expect(handler({ ...VALID_REQUEST, headers: "not-a-record" })).rejects.toThrow();
    await expect(handler(null)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("HTTP 非 2xx → 照常返回 ok=false（错误细节由响应体携带，与直连语义一致）", async () => {
    const { impl } = fakeFetchImpl({ ok: false, status: 401, body: '{"header":{"code":45000010}}' });
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    const response = await handler(VALID_REQUEST);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
    expect(Buffer.from(response.bodyBase64, "base64").toString("utf8")).toContain("45000010");
  });

  it("响应超上限 → 拒绝（不把超大体外送 renderer）", async () => {
    const bigBody = "x".repeat(24 * 1024 * 1024 + 2);
    const impl: VoiceVendorProxyFetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode(bigBody).buffer as ArrayBuffer,
    });
    const handler = createVoiceVendorProxyHandler({ fetchImpl: impl });
    await expect(handler(VALID_REQUEST)).rejects.toThrow("body exceeds size limit");
  });

  it("网络实现 throw → 异常透传（renderer 还原为网络异常语义）", async () => {
    const handler = createVoiceVendorProxyHandler({
      fetchImpl: vi.fn().mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED")),
    });
    await expect(handler(VALID_REQUEST)).rejects.toThrow("net::ERR_INTERNET_DISCONNECTED");
  });
});

// ---------------------------------------------------------------------------
// §16 真流式 handler（specs/model-capabilities.md §16.2）
// ---------------------------------------------------------------------------

import type { VoiceVendorProxyStreamChunkFrame } from "@drora/shared";

/** fake 流式响应：body 为 async generator（逐块 bytes）。 */
function fakeStreamFetch(blocks: Uint8Array[], ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    headers: { get: () => "application/json" },
    body: (async function* () {
      for (const block of blocks) {
        yield block;
      }
    })(),
  });
}

function ndjsonBlock(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

describe("voiceVendorStream handler（§16.2）", () => {
  const REQUEST = {
    url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
    headers: { "X-Api-Key": "k1", "Content-Type": "application/json" },
    body: "{}",
  };

  it("成功流：NDJSON 逐行推 data 帧 + done 终帧（跨 chunk 行缓冲）", async () => {
    const frames: VoiceVendorProxyStreamChunkFrame[] = [];
    // 跨 chunk 行：第一块是半行（无换行），第二块补齐 + 新行。
    const handler = createVoiceVendorStreamHandler({
      fetchImpl: fakeStreamFetch([
        new TextEncoder().encode('{"code":0,"da'),
        new TextEncoder().encode('ta":"YQ"}\n{"code":0,"data":"Y"}\n'),
        ndjsonBlock(['{"code":20000000,"message":"ok"}']),
      ]),
    });
    const { streamId } = await handler.start(REQUEST, (frame) => frames.push(frame));
    await handler.idle();
    const dataFrames = frames.filter((f) => f.kind === "data");
    expect(dataFrames.map((f) => f.base64Chunk)).toEqual(["YQ", "Y"]);
    expect(frames[frames.length - 1]!.kind).toBe("done");
    // seq 从 0 起单调（§16.2 契约；renderer expectedSeq 同基）。
    expect(frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(streamId).toBeTruthy();
  });

  it("非 2xx → 单帧 error（status + 错误体片段），无 data 帧", async () => {
    const frames: VoiceVendorProxyStreamChunkFrame[] = [];
    const handler = createVoiceVendorStreamHandler({
      fetchImpl: (async () => ({
        ok: false,
        status: 401,
        headers: { get: () => "application/json" },
        body: (async function* () {
          yield new TextEncoder().encode('{"header":{"code":45000010,"message":"Invalid X-Api-Key"}}');
        })(),
      })) as never,
    });
    await handler.start(REQUEST, (frame) => frames.push(frame));
    await handler.idle();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe("error");
    expect(frames[0]!.status).toBe(401);
    expect(frames[0]!.errorMessage).toContain("45000010");
  });

  it("renderer abort → 静默退出（无终端帧）", async () => {
    const frames: VoiceVendorProxyStreamChunkFrame[] = [];
    const handler = createVoiceVendorStreamHandler({
      fetchImpl: (async (_input: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        body: (async function* () {
          yield ndjsonBlock(['{"code":0,"data":"YQ"}']);
          // 挂起到 abort：signal 触发即 throw（等价 net.fetch 流被取消）。
          await new Promise<never>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => rej(new Error("aborted")), { once: true });
          });
        })(),
      })) as never,
    });
    const { streamId } = await handler.start(REQUEST, (frame) => frames.push(frame));
    await new Promise((r) => setTimeout(r, 10));
    handler.abort({ streamId });
    await handler.idle();
    expect(frames.every((f) => f.kind !== "error")).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(1); // 首块 data 已推。
  });

  it("白名单外 host → start throw（fail-closed）", async () => {
    const handler = createVoiceVendorStreamHandler({
      fetchImpl: fakeStreamFetch([]) as never,
    });
    await expect(
      handler.start({ ...REQUEST, url: "https://evil.example.com/x" }, () => {}),
    ).rejects.toThrow();
  });

  it("累计字节超限 → error 帧 + abort 上游", async () => {
    const frames: VoiceVendorProxyStreamChunkFrame[] = [];
    const bigLine = JSON.stringify({ code: 0, data: "A".repeat(1024) });
    const handler = createVoiceVendorStreamHandler({
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        body: (async function* () {
          // 3 × 1KB，maxStreamBytes 钳 2KB。
          for (let i = 0; i < 3; i += 1) {
            yield ndjsonBlock([bigLine]);
          }
        })(),
      })) as never,
      maxStreamBytes: 2048,
    });
    await handler.start(REQUEST, (frame) => frames.push(frame));
    await handler.idle();
    expect(frames[frames.length - 1]!.kind).toBe("error");
    expect(frames[frames.length - 1]!.errorMessage).toContain("size limit");
  });
});
