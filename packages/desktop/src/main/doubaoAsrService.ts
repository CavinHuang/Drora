/**
 * 豆包流式 ASR 服务（specs/voice-agent-integration.md §9.6.10，2026-11-07 按 Proma 架构）。
 *
 * main 进程持 sauc WebSocket（浏览器 WS 不能带鉴权四头——与 §15.8 代理同动机）：
 * renderer 上行 16k/16bit/单声道 PCM 分片（IPC）→ gzip 音频帧；下行转写帧解压解析后
 * 经 webContents.send 推回。帧编解码为纯函数（golden 可测）；WS 实现经 deps 注入
 * （测试给 fake）。
 *
 * 协议（Proma doubao-asr-service.ts 实证）：4B 头（版本|头长 / 消息类型|flags /
 * 序列化|压缩）+ 4B payload 大小 + payload。服务端 `result` 数组是**候选不是分句**
 * ——按 confidence 取最优（拼接会重复文本）；`utterances[].definite` 判句终。
 */

import { randomUUID } from "node:crypto";
import { createServiceLogger } from "@drora/services/node";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  VOICE_ASR_STREAM_LIMITS,
  parseVoiceAsrStreamStartRequest,
  voiceAsrStreamAudioChunkSchema,
  type DoubaoAsrEndpointMode,
  type VoiceAsrStreamStartRequest,
  type VoiceAsrStreamStateFrame,
  type VoiceAsrStreamTranscriptFrame,
} from "@drora/shared";

// ── 帧协议常量（sauc 二进制协议）────────────────────────────────────────────
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const MESSAGE_FULL_CLIENT_REQUEST = 0b0001;
const MESSAGE_AUDIO_ONLY_REQUEST = 0b0010;
const MESSAGE_FULL_SERVER_RESPONSE = 0b1001;
const MESSAGE_SERVER_ERROR = 0b1111;
const FLAG_NO_SEQUENCE = 0b0000;
const FLAG_LAST_NO_SEQUENCE = 0b0010;
const FLAG_SERVER_SEQUENCE = 0b0001;
const FLAG_SERVER_LAST_SEQUENCE = 0b0011;
const SERIALIZATION_NONE = 0b0000;
const SERIALIZATION_JSON = 0b0001;
const COMPRESSION_NONE = 0b0000;
const COMPRESSION_GZIP = 0b0001;

/** 听写调优（Proma 实证）：5s 断句窗防 800ms 静音过早切句；1s 强制成句。 */
const END_WINDOW_SIZE_MS = 5000;
const logger = createServiceLogger("voice.asr");
const FORCE_TO_SPEECH_TIME_MS = 1000;

export function doubaoAsrEndpoint(mode: DoubaoAsrEndpointMode): string {
  return mode === "duplex"
    ? "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
    : "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
}

// ── 帧编解码（纯函数，golden 可测）─────────────────────────────────────────
function buildFrame(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
  payload: Buffer,
): Buffer {
  const header = Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

export function buildDoubaoClientRequest(request: VoiceAsrStreamStartRequest): Buffer {
  const audio: Record<string, unknown> = {
    format: "pcm",
    codec: "raw",
    rate: 16000,
    bits: 16,
    channel: 1,
  };
  if (request.language) {
    audio.language = request.language;
  }
  const payload = gzipSync(
    Buffer.from(
      JSON.stringify({
        user: { uid: "drora-desktop" },
        audio,
        request: {
          model_name: "bigmodel",
          enable_nonstream: true,
          show_utterances: true,
          result_type: "full",
          enable_itn: true,
          enable_punc: true,
          enable_ddc: true,
          end_window_size: END_WINDOW_SIZE_MS,
          force_to_speech_time: FORCE_TO_SPEECH_TIME_MS,
        },
      }),
      "utf8",
    ),
  );
  return buildFrame(
    MESSAGE_FULL_CLIENT_REQUEST,
    FLAG_NO_SEQUENCE,
    SERIALIZATION_JSON,
    COMPRESSION_GZIP,
    payload,
  );
}

export function buildDoubaoAudioFrame(pcm: Buffer, isLast: boolean): Buffer {
  return buildFrame(
    MESSAGE_AUDIO_ONLY_REQUEST,
    isLast ? FLAG_LAST_NO_SEQUENCE : FLAG_NO_SEQUENCE,
    SERIALIZATION_NONE,
    COMPRESSION_GZIP,
    gzipSync(pcm),
  );
}

export interface ParsedDoubaoServerMessage {
  text: string;
  isFinal: boolean;
  /** 服务端错误码/消息（MESSAGE_SERVER_ERROR 或 payload.error）。 */
  errorMessage?: string;
}

interface ServerUtterance {
  text?: string;
  definite?: boolean;
}
interface ServerResult {
  text?: string;
  confidence?: number;
  utterances?: ServerUtterance[];
}
interface ServerPayload {
  result?: ServerResult | ServerResult[];
  text?: string;
  message?: string;
  error?: string;
}

/** result 数组=候选：按 confidence 取最优（非拼接）；definite 判句终。 */
function pickAuthoritativeResult(results: ServerResult[]): ServerResult | null {
  const candidates = results
    .map((result) => ({ result, text: result.text ?? result.utterances?.map((u) => u.text ?? "").join("") ?? "" }))
    .filter((item) => item.text.trim().length > 0);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.result;
  return [...candidates].sort((a, b) => (b.result.confidence ?? 0) - (a.result.confidence ?? 0))[0]!
    .result;
}

export function parseDoubaoServerMessage(frame: Buffer): ParsedDoubaoServerMessage | null {
  if (frame.byteLength < 8) return null;
  const messageType = (frame[1]! >> 4) & 0x0f;
  const flags = (frame[1]! >> 0) & 0x0f;
  const serialization = (frame[2]! >> 4) & 0x0f;
  const compression = (frame[2]! >> 0) & 0x0f;
  const payloadSize = frame.readUInt32BE(4);
  const payload = frame.subarray(8, 8 + payloadSize);
  const decompressed = compression === COMPRESSION_GZIP ? gunzipSync(payload) : payload;
  // 序列 flags：0b0001=普通序列（带序号）、0b0011=最后序列（会话级结束）——必须严格等于
  // LAST，按位与会把普通序列（0b0001&0b0011≠0）误判为会话终。
  const isSessionEnd = flags === FLAG_SERVER_LAST_SEQUENCE;

  if (messageType === MESSAGE_SERVER_ERROR) {
    return { text: "", isFinal: false, errorMessage: decompressed.toString("utf8").slice(0, 200) };
  }
  if (messageType !== MESSAGE_FULL_SERVER_RESPONSE || serialization !== SERIALIZATION_JSON) {
    return null;
  }
  let parsed: ServerPayload;
  try {
    parsed = JSON.parse(decompressed.toString("utf8")) as ServerPayload;
  } catch {
    return null;
  }
  const results = Array.isArray(parsed.result) ? parsed.result : parsed.result ? [parsed.result] : [];
  const authoritative = pickAuthoritativeResult(results);
  const text = authoritative?.text ?? authoritative?.utterances?.map((u) => u.text ?? "").join("") ?? "";
  // 句终 = 任一 utterance definite；会话结束（服务端 last 序列）也视为句终兜底。
  const isFinal =
    authoritative?.utterances?.some((u) => u.definite === true) === true || isSessionEnd;
  return { text, isFinal, errorMessage: parsed.error };
}

// ── WS 会话管理（deps 注入可测）────────────────────────────────────────────
/** 最小 WS 形状（electron main 的 ws 库实例 / 测试 fake）。 */
export interface DoubaoAsrWsLike {
  send(data: Buffer): void;
  close(): void;
  terminate(): void;
  once(event: "open", cb: () => void): void;
  once(event: "error", cb: (error: Error) => void): void;
  once(event: "close", cb: () => void): void;
  on(event: "message", cb: (data: Buffer) => void): void;
}

export interface DoubaoAsrServiceDeps {
  connect(url: string, headers: Record<string, string>): DoubaoAsrWsLike;
  /** 下行推送（装配点绑 sender webContents.send；测试收集断言）。 */
  sendTranscript(frame: VoiceAsrStreamTranscriptFrame): void;
  sendState(frame: VoiceAsrStreamStateFrame): void;
  sessionTimeoutMs?: number;
}

interface Session {
  ws: DoubaoAsrWsLike;
  closed: boolean;
  firstChunk?: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export function createDoubaoAsrService(deps: DoubaoAsrServiceDeps): {
  start(payload: unknown): Promise<{ streamId: string }>;
  sendAudio(chunk: unknown): void;
  abort(payload: unknown): void;
  /** 测试钩子：等待全部活跃会话结算。 */
  idle(): Promise<void>;
} {
  const timeoutMs = deps.sessionTimeoutMs ?? VOICE_ASR_STREAM_LIMITS.sessionTimeoutMs;
  const sessions = new Map<string, Session>();

  const teardown = (streamId: string, state?: Omit<VoiceAsrStreamStateFrame, "streamId">): void => {
    const session = sessions.get(streamId);
    if (!session) return;
    sessions.delete(streamId);
    clearTimeout(session.timer);
    if (state) deps.sendState({ streamId, ...state });
  };

  return {
    start(payload) {
      const request = parseVoiceAsrStreamStartRequest(payload);
      const streamId = randomUUID();
      const ws = deps.connect(doubaoAsrEndpoint(request.endpointMode), {
        // 2026-11-07 实测：sauc 已支持新版单 Key（101 握手实证）；与 TTS §15.9 统一。
        "X-Api-Key": request.apiKey,
        "X-Api-Resource-Id": request.resourceId,
        "X-Api-Connect-Id": randomUUID(),
      });
      const session: Session = {
        ws,
        closed: false,
        timer: setTimeout(() => {
          try {
            ws.terminate();
          } catch {
            // 已销毁：忽略。
          }
          teardown(streamId, {
            status: "error",
            errorMessage: "doubao asr session timed out",
          });
        }, timeoutMs),
      };
      sessions.set(streamId, session);
      return new Promise((resolve, reject) => {
        ws.once("open", () => {
          ws.send(buildDoubaoClientRequest(request));
          resolve({ streamId });
        });
        ws.once("error", (error) => {
          teardown(streamId, { status: "error", errorMessage: error.message.slice(0, 200) });
          reject(new Error(`doubao asr connect failed: ${error.message}`));
        });
        ws.once("close", () => {
          // 正常收尾（服务端结束/last 帧）由 message 路径先行 teardown；此处兜底未摘会话。
          if (sessions.has(streamId)) {
            teardown(streamId, { status: "ended" });
          }
        });
        ws.on("message", (data: Buffer) => {
          const parsed = parseDoubaoServerMessage(data);
          if (!parsed) return;
          if (parsed.errorMessage) {
            try {
              ws.close();
            } catch {
              // 忽略。
            }
            teardown(streamId, { status: "error", errorMessage: parsed.errorMessage });
            return;
          }
          if (parsed.text.length > 0 || parsed.isFinal) {
            deps.sendTranscript({ streamId, text: parsed.text, isFinal: parsed.isFinal });
          }
          if (parsed.isFinal && (data[1]! & 0x0f) === FLAG_SERVER_LAST_SEQUENCE) {
            // 会话级结束（服务端 last 序列）：尾句已推，正常收尾。
            try {
              ws.close();
            } catch {
              // 忽略。
            }
            teardown(streamId, { status: "ended" });
          }
        });
      });
    },

    sendAudio(chunk) {
      const parsed = voiceAsrStreamAudioChunkSchema.parse({
        streamId: (chunk as { streamId?: unknown })?.streamId,
        isLast: (chunk as { isLast?: unknown })?.isLast,
      });
      const session = sessions.get(parsed.streamId);
      if (!session || session.closed) return;
      const pcm = (chunk as { pcm?: ArrayBuffer }).pcm;
      if (!pcm || pcm.byteLength === 0 || pcm.byteLength > VOICE_ASR_STREAM_LIMITS.maxChunkBytes) {
        return; // 超限/空帧丢弃（防御；renderer 侧按 200ms 切块恒在限内）。
      }
      if (session.firstChunk !== true) {
        session.firstChunk = true;
        logger.info("doubao asr first audio chunk uplinked", { bytes: pcm.byteLength });
      }
      session.ws.send(buildDoubaoAudioFrame(Buffer.from(pcm), parsed.isLast));
      if (parsed.isLast) {
        // 音频已尽：等尾句（message 路径收尾）；会话级超时兜底仍在。
        session.closed = true;
      }
    },

    abort(payload) {
      const streamId = (payload as { streamId?: string })?.streamId ?? "";
      const session = sessions.get(streamId);
      if (!session) return;
      try {
        session.ws.terminate();
      } catch {
        // 忽略。
      }
      // 用户主动中止：不发 state（renderer abort 路径已有自己的出腿语义）。
      sessions.delete(streamId);
      clearTimeout(session.timer);
    },

    async idle() {
      while (sessions.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
