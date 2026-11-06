/**
 * 语音厂商出站代理（specs/model-capabilities.md §15.8，2026-11-06 用户裁定「代理根治」）。
 *
 * 背景：火山单 API Key 仅 `X-Api-Key` 一个鉴权槽位且不在其 CORS 预检白名单（spec §15.8
 * 探针矩阵），browser renderer 直连不可修复；desktop main 经 net.fetch 代理出站不受
 * CORS 约束。本文件只做**纯校验与转发**：白名单/header 键过滤/上限/超时全部来自
 * contracts/voice.ts 单一出处；网络实现（electron net.fetch）由装配点注入，保证本文件
 * 可在无 electron 环境单测。
 *
 * 安全边界（§15.8）：method 恒 POST、URL 必须 https 且 host ∈ 白名单（fail-closed）、
 * header 键白名单（防御纵深：renderer 载荷可被伪造）、请求体 ≤ 64KiB、响应 base64
 * ≤ 24MiB、60s 硬超时。校验失败 throw（renderer 侧还原为网络异常语义）；HTTP 非 2xx
 * 照常返回（ok=false），与直连 fetch 语义一致。
 */

import {
  VOICE_VENDOR_PROXY_LIMITS,
  VOICE_VENDOR_PROXY_STREAM_LIMITS,
  isVoiceVendorProxyAllowedHeaderKey,
  parseVoiceVendorProxyRequest,
  parseVoiceVendorProxyStreamAbortRequest,
  type VoiceVendorProxyFetchRequest,
  type VoiceVendorProxyFetchResponse,
  type VoiceVendorProxyStreamChunkFrame,
} from "@drora/shared";

/** 注入式网络实现形状（装配点传 electron net.fetch；测试传 fake）。 */
export type VoiceVendorProxyFetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<VoiceVendorProxyResponseLike>;

/** 最小响应形状（不绑定 DOM/electron Response 类型，测试注入更窄）。 */
export interface VoiceVendorProxyResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function createVoiceVendorProxyHandler(deps: {
  fetchImpl: VoiceVendorProxyFetchImpl;
}): (payload: unknown) => Promise<VoiceVendorProxyFetchResponse> {
  return async (payload: unknown) => {
    // §15.8：main 不信任 renderer 载荷——schema 校验（含 host 白名单 refine + body 上限）。
    const request: VoiceVendorProxyFetchRequest = parseVoiceVendorProxyRequest(payload);
    // 白名单已锁 host；再强制 https（白名单域均为 https canonical，防 http 降级）。
    if (new URL(request.url).protocol !== "https:") {
      throw new Error("voice vendor proxy request rejected: only https urls are proxied");
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (isVoiceVendorProxyAllowedHeaderKey(key)) {
        headers[key] = value;
      }
    }
    const response = await deps.fetchImpl(request.url, {
      method: "POST",
      headers,
      body: request.body,
      // 与 renderer 直连同款语义：不带 cookie/凭据出站；拒绝重定向。
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(VOICE_VENDOR_PROXY_LIMITS.requestTimeoutMs),
    });
    const buffer = await response.arrayBuffer();
    const bodyBase64 = Buffer.from(buffer).toString("base64");
    if (bodyBase64.length > VOICE_VENDOR_PROXY_LIMITS.maxResponseBodyBase64Chars) {
      throw new Error("voice vendor proxy response rejected: body exceeds size limit");
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodyBase64,
    };
  };
}

// ---------------------------------------------------------------------------
// 真流式代理（specs/model-capabilities.md §16.2：Start/Chunk/Abort 三通道）
// ---------------------------------------------------------------------------

/** 流式响应形状（body 可异步迭代；undici/net.fetch 的 ReadableStream 天然满足，测试给 async generator）。 */
export interface VoiceVendorProxyStreamResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}

export type VoiceVendorProxyStreamFetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<VoiceVendorProxyStreamResponseLike>;

/** renderer 主动 abort 或超时后的静默判定：错误帧不发给已不存在的订阅者。 */
interface StreamRuntime {
  abortController: AbortController;
  terminalSent: boolean;
  seq: number;
}

/** 帧下行回调（装配点绑 event.sender 的 webContents.send；测试收集断言）。 */
export type VoiceVendorStreamChunkSink = (frame: VoiceVendorProxyStreamChunkFrame) => void;

export interface VoiceVendorStreamHandlerDeps {
  fetchImpl: VoiceVendorProxyStreamFetchImpl;
  timeoutMs?: number;
  maxStreamBytes?: number;
}

export function createVoiceVendorStreamHandler(deps: VoiceVendorStreamHandlerDeps): {
  start: (payload: unknown, onChunk: VoiceVendorStreamChunkSink) => Promise<{ streamId: string }>;
  abort: (payload: unknown) => void;
  /** 测试钩子：等待全部活跃流结算（GC 表清空）。 */
  idle: () => Promise<void>;
} {
  const timeoutMs = deps.timeoutMs ?? VOICE_VENDOR_PROXY_STREAM_LIMITS.streamTimeoutMs;
  const maxStreamBytes = deps.maxStreamBytes ?? VOICE_VENDOR_PROXY_STREAM_LIMITS.maxStreamBytes;
  /** streamId → runtime（GC：terminal 帧/abort/超时后摘除； §16.2 生命周期）。 */
  const active = new Map<string, { runtime: StreamRuntime; onChunk: VoiceVendorStreamChunkSink }>();
  // invoke handler 只回 streamId——真正推流在后台任务；测试用 idle() 等结算。
  const settled = new Set<Promise<void>>();

  const sendTerminal = (streamId: string, frame: VoiceVendorProxyStreamChunkFrame): void => {
    const entry = active.get(streamId);
    if (!entry || entry.runtime.terminalSent) {
      return;
    }
    entry.runtime.terminalSent = true;
    entry.onChunk(frame);
    active.delete(streamId);
  };

  const runStream = async (
    streamId: string,
    request: VoiceVendorProxyFetchRequest,
    onChunk: VoiceVendorStreamChunkSink,
  ): Promise<void> => {
    const entry = active.get(streamId);
    if (!entry) {
      return;
    }
    const { runtime } = entry;
    const nextSeq = () => {
      const seq = runtime.seq;
      runtime.seq += 1;
      return seq;
    };
    // seq 从 0 起单调递增（§16.2 契约；renderer 侧 expectedSeq 从 0 计）。
    // renderer abort 与 60s 硬闸组合（AbortSignal.any，Node 22+）。
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const abortController = runtime.abortController;
    const signal = AbortSignal.any([timeoutSignal, abortController.signal]);
    const decoder = new TextDecoder();
    let lineBuf = "";
    let totalBytes = 0;
    let lastError = "";
    let sawDone = false;
    try {
      const response = await deps.fetchImpl(request.url, {
        method: "POST",
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(([key]) => isVoiceVendorProxyAllowedHeaderKey(key)),
        ),
        body: request.body,
        credentials: "omit",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        // 先收 header 判定：非 2xx 读完整错误体（截 500 字符）一次性 error 帧。
        const chunks: Uint8Array[] = [];
        let errorBytes = 0;
        for await (const chunk of response.body ?? []) {
          chunks.push(chunk);
          errorBytes += chunk.byteLength;
          if (errorBytes >= 2048) {
            break;
          }
        }
        const errorBody = new TextDecoder()
          .decode(concatBytes(chunks))
          .slice(0, 500);
        sendTerminal(streamId, {
          streamId,
          seq: nextSeq(),
          kind: "error",
          status: response.status,
          errorMessage: errorBody || `upstream status ${response.status}`,
        });
        return;
      }
      for await (const chunk of response.body ?? []) {
        if (abortController.signal.aborted) {
          return; // renderer 主动 abort：表已摘，静默退出（不推帧）。
        }
        totalBytes += chunk.byteLength;
        if (totalBytes > maxStreamBytes) {
          abortController.abort();
          sendTerminal(streamId, {
            streamId,
            seq: nextSeq(),
            kind: "error",
            errorMessage: "voice vendor proxy stream aborted: body exceeds size limit",
          });
          return;
        }
        lineBuf += decoder.decode(chunk, { stream: true });
        // NDJSON 逐行：每收完整一行立即推帧（§16.2 不攒整流）。
        for (;;) {
          const nl = lineBuf.indexOf("\n");
          if (nl < 0) {
            break;
          }
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line) {
            continue;
          }
          let parsed: { code?: number; message?: string; data?: string };
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            continue; // 与整段路径同语义：坏行跳过。
          }
          const code = parsed.code ?? 0;
          if (code === 20000000) {
            sawDone = true;
            sendTerminal(streamId, { streamId, seq: nextSeq(), kind: "done" });
            return;
          }
          if (code !== 0) {
            lastError = `${code}: ${parsed.message ?? "unknown"}`;
            continue;
          }
          if (parsed.data) {
            onChunk({ streamId, seq: nextSeq(), kind: "data", base64Chunk: parsed.data });
          }
        }
      }
      // EOF：合成结束标记缺失也按 done 结算（宽容语义与整段路径一致——收到过数据即播）。
      if (!sawDone) {
        sendTerminal(streamId, { streamId, seq: nextSeq(), kind: "done" });
      }
      void lastError; // EOF 有数据时非零 code 行仅记录（整段路径同款宽容）。
    } catch (error) {
      if (abortController.signal.aborted && !timeoutSignal.aborted) {
        return; // renderer abort：静默。
      }
      const message = error instanceof Error ? error.message : "upstream stream failed";
      sendTerminal(streamId, { streamId, seq: nextSeq(), kind: "error", errorMessage: message.slice(0, 500) });
    }
  };

  return {
    start: async (payload, onChunk) => {
      // §16.2：Start 校验与整段同 schema（白名单/https 外层再补/limits 沿用）。
      const request = parseVoiceVendorProxyRequest(payload);
      if (new URL(request.url).protocol !== "https:") {
        throw new Error("voice vendor proxy request rejected: only https urls are proxied");
      }
      const streamId = crypto.randomUUID();
      const runtime: StreamRuntime = { abortController: new AbortController(), terminalSent: false, seq: 0 };
      active.set(streamId, { runtime, onChunk });
      const task = runStream(streamId, request, onChunk).finally(() => {
        settled.delete(task);
      });
      settled.add(task);
      return { streamId };
    },
    abort: (payload) => {
      const { streamId } = parseVoiceVendorProxyStreamAbortRequest(payload);
      const entry = active.get(streamId);
      if (!entry) {
        return;
      }
      entry.runtime.abortController.abort();
      active.delete(streamId);
    },
    idle: async () => {
      while (settled.size > 0) {
        await Promise.allSettled(Array.from(settled));
      }
    },
  };
}

/** Uint8Array 拼接（错误体收集用；分片路径不需要）。 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
