/**
 * 豆包流式 ASR 适配器（specs/voice-agent-integration.md §9.6.10）：VoiceAsrPort 第二云实现。
 *
 * 数据面：pcmStreamCapture（200ms PCM）→ platform.voiceAsrStreamSendAudio 上行；
 * 下行 transcript（isFinal=false → onPartial 预览条；definite → onFinal 逐句注入 §5.1
 * 句级语义原生恢复）；stop()=停抓取+发 last 帧+等尾句/会话结束（settle 超时兜底）；
 * abort()=中止上行+断订阅。错误映射 §5.3：WS 失败/超时 → network。
 *
 * 凭据：卡 apiKey = 新版控制台单 API Key（sauc 101 握手实证，与 TTS 统一）；modelId 承载
 * resourceId（默认 DOUBAO_ASR_RESOURCE_ID；"#duplex" 后缀切 duplex 端点）。
 * 混合预览不适用（引擎自身流式，§9.6.10）。
 */

import {
  DOUBAO_ASR_RESOURCE_ID,
  type DoubaoAsrEndpointMode,
  type VoiceAsrStreamStateFrame,
  type VoiceAsrStreamTranscriptFrame,
} from "@drora/shared";
import { logger } from "@/logger.js";
import { startPcmStreamCapture, type PcmStreamDeps, type PcmStreamHandle } from "./pcmStreamCapture.js";
import { VoiceAsrError, type VoiceAsrErrorCode } from "./voiceAsrPort.js";
import type { VoiceAsrPort, VoiceAsrSession } from "./voiceAsrPort.js";

/** 平台 ASR 流通道聚合（platform 五方法；缺席=引擎不可用）。 */
export interface DoubaoAsrStreamPort {
  start(request: {
    apiKey: string;
    resourceId: string;
    endpointMode: DoubaoAsrEndpointMode;
    language: string;
  }): Promise<{ streamId: string }>;
  sendAudio(chunk: { streamId: string; pcm: ArrayBuffer; isLast: boolean }): void;
  onTranscript(handler: (frame: VoiceAsrStreamTranscriptFrame) => void): () => void;
  onState(handler: (frame: VoiceAsrStreamStateFrame) => void): () => void;
  abort(payload: { streamId: string }): Promise<void>;
}

export interface DoubaoStreamingAsrDeps {
  stream: DoubaoAsrStreamPort;
  /** 厂商档（getVendorConfig 快照；apiKey 复合、modelId=resourceId[#mode]）。 */
  getVendorConfig(): Promise<{ baseUrl: string; model: string; apiKey: string } | null>;
  pcmDeps?: PcmStreamDeps;
  /** stop 尾句等待窗口；缺省 VOICE_ASR_STOP_SETTLE_TIMEOUT_MS。 */
  stopSettleTimeoutMs?: number;
}


export function createDoubaoStreamingAsrAdapter(deps: DoubaoStreamingAsrDeps): VoiceAsrPort {
  const partialSubscribers = new Set<(text: string) => void>();
  return {
    isSupported: () => true, // stream 端口在场即支持（装配点保证）；凭据完整性在 start 时 fail-closed。
    onPartial(cb: (text: string) => void): () => void {
      partialSubscribers.add(cb);
      return () => {
        partialSubscribers.delete(cb);
      };
    },
    async start({ lang }: { lang: string }): Promise<VoiceAsrSession> {
      const config = await deps.getVendorConfig();
      const apiKey = config?.apiKey.trim() ?? "";
      if (!apiKey) {
        throw new VoiceAsrError("not-allowed", "doubao asr api key is required");
      }
      const [resourceId, modeSuffix] = (config?.model?.trim() || DOUBAO_ASR_RESOURCE_ID).split("#");
      const endpointMode: DoubaoAsrEndpointMode = modeSuffix === "duplex" ? "duplex" : "async";

      const finalSubscribers = new Set<(text: string) => void>();
      const errorSubscribers = new Set<(error: VoiceAsrError) => void>();
      let capture: PcmStreamHandle | null = null;
      let streamId: string | null = null;
      let settled = false;
      let stopSettleTimer: ReturnType<typeof setTimeout> | null = null;
      let stopResolve: ((value: { final: string }) => void) | null = null;
      let trailingFinal = "";
      let stopping = false;

      const unsubscribers: Array<() => void> = [];
      const cleanup = () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        unsubscribers.length = 0;
        if (stopSettleTimer != null) clearTimeout(stopSettleTimer);
        stopSettleTimer = null;
      };
      const fail = (code: VoiceAsrErrorCode, message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        void Promise.resolve(capture?.stop()).catch(() => undefined);
        capture = null;
        if (streamId != null) void deps.stream.abort({ streamId }).catch(() => undefined);
        const error = new VoiceAsrError(code, message);
        for (const cb of Array.from(errorSubscribers)) cb(error);
      };

      unsubscribers.push(
        deps.stream.onTranscript((frame) => {
          if (streamId == null || frame.streamId !== streamId || settled) return;
          if (frame.isFinal) {
            if (frame.text.trim().length > 0) {
              trailingFinal = `${trailingFinal}${trailingFinal ? " " : ""}${frame.text.trim()}`;
              if (!stopping) {
                // definite 句：逐句上抛（§5.1 append 注入）。
                for (const cb of Array.from(finalSubscribers)) cb(frame.text.trim());
              }
            }
            if (stopping && stopResolve != null) {
              // stop 等待中的尾句：flush 已收 final 后结算。
              const resolve = stopResolve;
              stopResolve = null;
              cleanup();
              resolve({ final: trailingFinal.trim() });
            }
          } else if (frame.text.trim().length > 0) {
            for (const cb of Array.from(partialSubscribers)) cb(frame.text.trim());
          }
        }),
        deps.stream.onState((frame) => {
          if (streamId == null || frame.streamId !== streamId || settled) return;
          if (frame.status === "ended") {
            if (stopResolve != null) {
              const resolve = stopResolve;
              stopResolve = null;
              cleanup();
              resolve({ final: trailingFinal.trim() });
            } else if (!stopping) {
              // 服务端主动结束（非 stop 路径）：按静音超时族处理。
              fail("aborted", "asr session ended by server");
            }
            return;
          }
          fail("network", frame.errorMessage ?? "asr stream error");
        }),
      );

      const { streamId: id } = await deps.stream.start({
        apiKey,
        resourceId: resourceId || DOUBAO_ASR_RESOURCE_ID,
        endpointMode,
        language: lang.split("-")[0] ?? "",
      });
      streamId = id;
      capture = await startPcmStreamCapture((chunk) => {
        if (streamId == null || settled) return;
        deps.stream.sendAudio({ streamId, pcm: chunk, isLast: false });
      }, deps.pcmDeps);

      return {
        onFinal(cb: (text: string) => void): () => void {
          finalSubscribers.add(cb);
          return () => {
            finalSubscribers.delete(cb);
          };
        },
        onError(cb: (error: VoiceAsrError) => void): () => void {
          errorSubscribers.add(cb);
          return () => {
            errorSubscribers.delete(cb);
          };
        },
        async stop(): Promise<{ final: string }> {
          if (settled) return { final: "" };
          stopping = true;
          const stopped = capture ? await Promise.resolve(capture.stop()).catch(() => ({ remainder: null })) : { remainder: null };
          const remainder = stopped.remainder;
          capture = null;
          if (streamId != null) {
            if (remainder && remainder.byteLength > 0) {
              deps.stream.sendAudio({ streamId, pcm: remainder, isLast: false });
            }
            deps.stream.sendAudio({
              streamId,
              pcm: new ArrayBuffer(0),
              isLast: true,
            });
          }
          return new Promise<{ final: string }>((resolve) => {
            stopResolve = resolve;
            stopSettleTimer = setTimeout(() => {
              if (stopResolve == null) return;
              stopResolve = null;
              cleanup();
              if (streamId != null) void deps.stream.abort({ streamId }).catch(() => undefined);
              resolve({ final: trailingFinal.trim() });
            }, deps.stopSettleTimeoutMs ?? 8000);
          });
        },
        abort(): void {
          settled = true;
          cleanup();
          void Promise.resolve(capture?.stop()).catch(() => undefined);
          capture = null;
          if (streamId != null) void deps.stream.abort({ streamId }).catch(() => undefined);
        },
      };
    },
  };
}

// §7.1：仅记事件类型，不落转写原文。
void logger;
