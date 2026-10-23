/**
 * 远程 ASR 适配器（specs/voice-agent-integration.md §9.6.4 push-to-talk 批量 / §9.6.3
 * renderer 直连 / §9.6.1 OpenAI 兼容音频端点族第一适配面）。
 *
 * 形态（§9.6.4 冻结）：录音期间 MediaRecorder 本机收集；stop() 时整段 multipart 上传
 * `POST {baseUrl}/audio/transcriptions`（file + model，Bearer 来自凭据服务），
 * 响应 `{text}` 经既有 onFinal 通道交付一次；onPartial 永不发射（v1 无 partial，
 * §9.6.4-2 如实记录）；abort() 丢弃式停止——不上传、不产生 final。
 *
 * 交付契约：批量 final **只走 onFinal 一次**；`stop()` 恒 resolve `{final: ""}`（契约
 * 形状保留、防消费方双交付——消费方 useVoiceDictation 的注入与停止路径以 onFinal 与
 * stop 完成事件分别驱动）。上传失败：onError("network") → 既有 §5.3 处置（保留已注入
 * 文本 + 提示 + 不自动重启），stop() 仍 resolve 空串不 reject。
 *
 * 网络通道（§9.6.3）：renderer 浏览器 fetch 直连厂商，不经 host/relay/协议通道；
 * 代理与 CA 由桌面 defaultSession 既有策略继承。请求形态照仓内 renderer 直连先例
 * （cloudLottieRuntime.ts:36 credentials:"omit"、mcpStatusProbe.ts:51 用户配置 baseUrl
 * fetch 探测）；本适配器带 Authorization 头，credentials 用 "omit" 不携带站点凭据。
 *
 * 隐私边界（§7.1 延伸）：任何日志级别不落音频、转写原文、apiKey 与 Authorization 头。
 * 错误映射（§5.3）：网络失败/非 2xx → "network"；权限/设备类错误沿用 getUserMedia
 * 映射（与 webSpeech 适配器同款 DOMException 归类）。
 */

import { logger } from "@/logger.js";
import { VOICE_ASR_STOP_SETTLE_TIMEOUT_MS } from "./voiceTuning.js";
import {
  VoiceAsrError,
  type VoiceAsrErrorCode,
  type VoiceAsrPort,
  type VoiceAsrSession,
  type VoiceAsrStartParams,
} from "./voiceAsrPort.js";
import { mapGetUserMediaError } from "./webSpeechAsrAdapter.js";

export interface RemoteAsrVendorConfig {
  /** 厂商档根地址（如 https://api.siliconflow.cn/v1）；调用时拼 /audio/transcriptions。 */
  baseUrl: string;
  /** ASR model id（如 FunAudioLLM/SenseVoiceSmall）。 */
  model: string;
  /** Bearer 凭据（由调用方经凭据服务读取后注入；适配器不感知存储位置）。 */
  apiKey: string;
}

/**
 * DI deps 注入形状（vendor 配置/媒体/fetch 全部注入，测试以 mock HTTP 消费）；
 * 无具名 import 消费方（knip @lintignore 先例：useTaskSessionFilePath.ts:7）。
 * @lintignore
 */
export interface RemoteAsrAdapterDeps {
  /** 厂商档（调用时求值，设置热更即时生效）。 */
  getVendorConfig: () => RemoteAsrVendorConfig | null;
  /** 缺省 navigator.mediaDevices.getUserMedia（AEC/NS/AGC 约束与 webSpeech 同款）；测试注入 fake。 */
  getUserMedia?(constraints: { audio: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean } }): Promise<MediaStreamLike>;
  /** 缺省 window.MediaRecorder；测试注入 fake（仓内 MediaRecorder 先例：electronBrowserWebmRecorder）。 */
  createMediaRecorder?(stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  /** 缺省 globalThis.fetch；测试注入 mock HTTP（契约单测不发真实厂商请求，§9.6.8-S2）。 */
  fetch?(input: string, init: RequestInit): Promise<ResponseLike>;
  /** stop() 的 ondataavailable 兜底结算窗口，缺省 voiceTuning 值；测试可缩短。 */
  stopSettleTimeoutMs?: number;
}

export interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}

export interface MediaRecorderLike extends EventTarget {
  start(timeslice?: number): void;
  stop(): void;
  state: "inactive" | "recording" | "paused";
  /** DOM MediaRecorder 录制容器（fake 可缺省）。 */
  readonly mimeType?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** 仓内 MediaRecorder 首选容器（§9.6.1 端点事实：webm 在 OpenAI 支持列表；TV-8 spike 校准）。 */
const PREFERRED_MIME_TYPE = "audio/webm;codecs=opus";

export function resolveRemoteAsrErrorCode(error: unknown): VoiceAsrErrorCode {
  // 网络失败/非 2xx 统一映射 network（§9.6.4：录音中厂商请求失败 → 既有 §5.3 处置）；
  // 适配器无权限/设备类错误面（getUserMedia 错误在 start 前段独立映射）。
  if (error instanceof VoiceAsrError) {
    return error.code;
  }
  return "network";
}

export function createRemoteAsrAdapter(deps: RemoteAsrAdapterDeps): VoiceAsrPort {
  const doFetch = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const getUserMedia =
    deps.getUserMedia ??
    (() => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new DOMException("mediaDevices unavailable", "NotFoundError"));
      }
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    });
  const createMediaRecorder =
    deps.createMediaRecorder ??
    ((stream: MediaStreamLike, options?: { mimeType?: string }) => {
      if (typeof MediaRecorder === "undefined") {
        throw new VoiceAsrError("audio-capture", "MediaRecorder unavailable");
      }
      // 类型声明：DOM MediaRecorder 与 MediaRecorderLike 结构兼容（EventTarget + start/stop/state）。
      return new MediaRecorder(
        stream as unknown as MediaStream,
        options?.mimeType ? { mimeType: options.mimeType } : undefined,
      ) as unknown as MediaRecorderLike;
    });
  const stopSettleTimeoutMs = deps.stopSettleTimeoutMs ?? VOICE_ASR_STOP_SETTLE_TIMEOUT_MS;

  const pickMimeType = (): string | undefined => {
    if (typeof MediaRecorder === "undefined") {
      return undefined;
    }
    return MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE) ? PREFERRED_MIME_TYPE : undefined;
  };

  class RemoteSession implements VoiceAsrSession {
    private chunks: Blob[] = [];
    private finalSubscribers = new Set<(text: string) => void>();
    private errorSubscribers = new Set<(error: VoiceAsrError) => void>();
    private stopping = false;
    private dead = false;
    private stopResolve: ((value: { final: string }) => void) | null = null;
    private settleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
      private readonly stream: MediaStreamLike,
      private readonly recorder: MediaRecorderLike,
      private readonly lang: string,
      private readonly hints: readonly string[],
    ) {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };
    }

    private closeStream(): void {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }

    private settleStop(value: { final: string }): void {
      this.clearSettleTimer();
      const resolve = this.stopResolve;
      this.stopResolve = null;
      resolve?.(value);
    }

    private clearSettleTimer(): void {
      if (this.settleTimer != null) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
    }

    onFinal(cb: (text: string) => void): () => void {
      this.finalSubscribers.add(cb);
      return () => this.finalSubscribers.delete(cb);
    }

    onError(cb: (error: VoiceAsrError) => void): () => void {
      this.errorSubscribers.add(cb);
      return () => this.errorSubscribers.delete(cb);
    }

    startRecording(): void {
      this.recorder.start();
    }

    /** stop()：停收集 → 整段上传 → 经 onFinal 交付一次 + resolve；空音频/失败走 reject/空串。 */
    async stop(): Promise<{ final: string }> {
      if (this.dead || this.stopping) {
        return { final: "" };
      }
      this.stopping = true;
      const stopped = new Promise<void>((resolve) => {
        const previous = this.recorder.ondataavailable;
        this.recorder.ondataavailable = (event) => {
          previous?.call(this.recorder, event);
        };
        this.recorder.addEventListener("stop", () => resolve(), { once: true });
        this.recorder.stop();
        // 引擎不吐 stop 事件的兜底（voiceTuning 同款 wedged-engine 防御）。
        this.settleTimer = setTimeout(resolve, stopSettleTimeoutMs);
      });
      await stopped;
      this.clearSettleTimer();
      this.dead = true;
      this.closeStream();

      const blob = new Blob(this.chunks, { type: this.recorder.mimeType ?? "audio/webm" });
      if (blob.size === 0) {
        // 静音/零字节：同静音超时处理（§5.3），无上传。
        return { final: "" };
      }
      try {
        const text = await this.transcribe(blob);
        // §9.6.4-1：响应文本经既有 onFinal 通道交付一次；stop() 恒空串防双交付（见头注）。
        for (const cb of Array.from(this.finalSubscribers)) {
          cb(text);
        }
      } catch (error) {
        const asrError =
          error instanceof VoiceAsrError ? error : new VoiceAsrError("network", "transcription failed");
        // §9.6.6：录音中厂商请求失败 → onError("network") → 既有 §5.3 处置。
        for (const cb of Array.from(this.errorSubscribers)) {
          cb(asrError);
        }
      }
      return { final: "" };
    }

    private async transcribe(blob: Blob): Promise<string> {
      const config = deps.getVendorConfig();
      if (!config || !config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
        // 厂商档在录音期间被清空（设置热更）：按网络失败处置，回退树由调用方下次点按重选。
        throw new VoiceAsrError("network", "vendor config incomplete");
      }
      const form = new FormData();
      form.append("file", blob, "dictation.webm");
      form.append("model", config.model);
      const language = mapLanguage(this.lang);
      if (language) {
        form.append("language", language);
      }
      if (this.hints.length > 0) {
        // 端点支持的 prompt 偏置（OpenAI transcriptions）；不支持即被端点忽略。
        form.append("prompt", this.hints.join(" "));
      }

      let response: ResponseLike;
      try {
        response = await doFetch(`${config.baseUrl.replace(/\/+$/u, "")}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
          credentials: "omit",
          redirect: "error",
        });
      } catch (error) {
        // §7.1：warn 只落错误形状，不落 URL 查询串/凭据/音频。
        logger.warn("voice.asr", "remote transcription request failed", {
          type: error instanceof Error ? error.name : "unknown",
        });
        throw new VoiceAsrError("network", "transcription request failed");
      }
      if (!response.ok) {
        logger.warn("voice.asr", "remote transcription request rejected", { status: response.status });
        throw new VoiceAsrError("network", `transcription HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text : "";
      logger.debug("voice.asr", `remote final received (len=${text.length})`);
      return text.trim();
    }

    abort(): void {
      if (this.dead) {
        return;
      }
      this.dead = true;
      this.clearSettleTimer();
      this.stopResolve = null;
      this.chunks = [];
      this.closeStream();
      // 丢弃式停止：不上传、不产生 final（§2.3 契约）。
      if (this.recorder.state !== "inactive") {
        try {
          this.recorder.stop();
        } catch (error) {
          logger.warn("voice.asr", "recorder abort rejected", error);
        }
      }
    }
  }

  return {
    isSupported(): boolean {
      // renderer 直连不依赖引擎presence：能力面 = MediaRecorder + fetch + getUserMedia
      // （桌面 Chromium / 浏览器全具备；缺席环境由选型函数回退 webSpeech，§9.6.6）。
      return typeof MediaRecorder !== "undefined" && typeof FormData !== "undefined";
    },
    async start(params: VoiceAsrStartParams): Promise<VoiceAsrSession> {
      const config = deps.getVendorConfig();
      if (!config || !config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
        // §9.6.6：档不完整在选型函数已回退；此处兜底拒绝，由调用方以 webSpeech 起录。
        throw new VoiceAsrError("service-not-allowed", "vendor config incomplete");
      }
      let stream: MediaStreamLike;
      try {
        stream = await getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        throw mapGetUserMediaError(error);
      }
      let recorder: MediaRecorderLike;
      try {
        const mimeType = pickMimeType();
        recorder = deps.createMediaRecorder
          ? deps.createMediaRecorder(stream, mimeType ? { mimeType } : undefined)
          : createMediaRecorder(stream);
      } catch (error) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        throw error instanceof VoiceAsrError
          ? error
          : new VoiceAsrError("audio-capture", "MediaRecorder unavailable");
      }
      const session = new RemoteSession(stream, recorder, params.lang, params.hints ?? []);
      session.startRecording();
      logger.info("voice.asr", "remote batch recognition session started");
      return session;
    },
    onPartial(): () => void {
      // §9.6.4-2：批量形态无 partial——返回 no-op 退订，永不发射。
      return () => undefined;
    },
  };
}


/** BCP-47 → 端点 language 参数（whisper 族取主子标签；空/无法映射 → 省略由模型自判定）。 */
export function mapLanguage(lang: string): string | null {
  const trimmed = lang.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const primary = trimmed.split(/[-_]/u)[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,3}$/u.test(primary) ? primary : null;
}
