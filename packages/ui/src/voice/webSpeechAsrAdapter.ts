/**
 * Web Speech API ASR 适配器（specs/voice-agent-integration.md §2.3 / §5.3 / §9.2）。
 *
 * 逻辑来源：packages/ui/src/components/ai-elements/speech-input.tsx 先例（只复用其
 * SpeechRecognition 编排逻辑、重写为端口实现；不修改该文件）。同时修复其三个现状缺陷：
 * :90 lang 硬编码 en-US（本适配器 lang 必传）、:151-153 handleError 静默关闭（本适配器
 * 错误经 onError 上抛 + voice.asr warn）、裸 getUserMedia（本适配器显式 AEC/NS/AGC 约束）。
 *
 * 为什么端口实现仍要显式 getUserMedia：Web Speech 引擎自带拾音、不吃这路流；显式约束
 * 打开是 spec §2.3 冻结要求——① 作为显式权限预检（NotAllowedError 在开录前即映射
 * "not-allowed"，而不是等引擎抛泛化错误）；② 保证回声消除/噪声抑制/自动增益对拾音链生效
 * （{ echoCancellation, noiseSuppression, autoGainControl } 全仓首批）。流仅作权限与 DSP
 * 载体，会话结束即停轨，音频 buffer 不落任何 store（§3.1 禁入）。
 *
 * Web Speech 无偏置词接口：VoiceAsrStartParams.hints 当前被忽略（引擎支持时再接）。
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

/** 最小结构化 Web Speech 类型：模块内封闭，不做全局声明合并（speech-input.tsx 已声明全局）。 */
export interface WebSpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface WebSpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: WebSpeechRecognitionAlternativeLike | undefined;
}

export interface WebSpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: WebSpeechRecognitionResultLike | undefined;
  };
}

export interface WebSpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

export interface WebSpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

export type MediaStreamLike = { getTracks(): { stop(): void }[] };

export interface WebSpeechAsrAdapterDeps {
  /** 缺省从 window.SpeechRecognition / window.webkitSpeechRecognition 构造；测试注入 fake。 */
  createRecognition?(): WebSpeechRecognitionLike | null;
  /** 缺省 navigator.mediaDevices.getUserMedia；测试注入 fake。 */
  getUserMedia?(constraints: {
    audio: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  }): Promise<MediaStreamLike>;
  /** stop() 的 onend 兜底结算窗口，缺省 voiceTuning 值；测试可缩短。 */
  stopSettleTimeoutMs?: number;
}

export function createWebSpeechAsrAdapter(deps: WebSpeechAsrAdapterDeps = {}): VoiceAsrPort {
  const createRecognition =
    deps.createRecognition ??
    (() => {
      if (typeof window === "undefined") {
        return null;
      }
      const holder = window as unknown as {
        SpeechRecognition?: new () => WebSpeechRecognitionLike;
        webkitSpeechRecognition?: new () => WebSpeechRecognitionLike;
      };
      const Ctor = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
      return Ctor ? new Ctor() : null;
    });
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
  const stopSettleTimeoutMs = deps.stopSettleTimeoutMs ?? VOICE_ASR_STOP_SETTLE_TIMEOUT_MS;

  const partialSubscribers = new Set<(text: string) => void>();
  let activeSession: ActiveSession | null = null;

  const emitPartial = (text: string) => {
    for (const cb of partialSubscribers) {
      cb(text);
    }
  };

  function closeSession(session: ActiveSession): void {
    if (activeSession === session) {
      activeSession = null;
    }
    for (const track of session.stream.getTracks()) {
      track.stop();
    }
  }

  class ActiveSession implements VoiceAsrSession {
    readonly recognition: WebSpeechRecognitionLike;
    /** stop() 触发后到 onend 之间 flush 出来的 final 段；onend 时作为整段 final resolve。 */
    private stopFlushBuffer = "";
    private stopping = false;
    private dead = false;
    private finalSubscribers = new Set<(text: string) => void>();
    private errorSubscribers = new Set<(error: VoiceAsrError) => void>();
    private settleTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
      readonly stream: MediaStreamLike,
      lang: string,
    ) {
      const recognition = createRecognition();
      if (!recognition) {
        // isSupported()=true 但构造失败的窗口竞态（引擎随窗口卸载消失）按设备不可用处置。
        throw new VoiceAsrError("audio-capture", "speech recognition constructor unavailable");
      }
      this.recognition = recognition;
      // 修复 speech-input.tsx:90 硬编码 en-US 的先例缺陷：lang 由调用方按 locale 传入。
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;

      recognition.addEventListener("result", (event) => {
        this.handleResult(event as WebSpeechRecognitionEventLike);
      });
      recognition.addEventListener("error", (event) => {
        this.handleError((event as WebSpeechRecognitionErrorEventLike).error);
      });
      recognition.addEventListener("end", () => {
        this.handleEnd();
      });
    }

    start(): void {
      try {
        this.recognition.start();
      } catch (error) {
        // InvalidStateError：引擎已在运行（重复 start）。记 warn 并继续——会话仍持有引擎实例。
        logger.warn("voice.asr", "recognition start rejected", error);
      }
    }

    private handleResult(event: WebSpeechRecognitionEventLike): void {
      if (this.dead) {
        return;
      }
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) {
          // Web Speech 结果列表在 noUncheckedIndexedAccess 下可能缺项；先判空再取值
          // （speech-input.tsx:136-140 同源防御）。
          continue;
        }
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const sentence = transcript.trim();
          if (sentence.length > 0) {
            if (this.stopping) {
              this.stopFlushBuffer = `${this.stopFlushBuffer}${this.stopFlushBuffer ? " " : ""}${sentence}`;
            } else {
              // §5.1 每句 final 逐句上抛（mode=append 注入正文 + 预览条移除该句）。
              // 快照后迭代：回调内可能退订，直接迭代原集合会漏发/跳元素。
              for (const cb of Array.from(this.finalSubscribers)) {
                cb(sentence);
              }
            }
          }
        } else {
          interim += transcript;
        }
      }
      if (!this.stopping && interim.trim().length > 0) {
        // §7.1：partial 只记事件不记原文——debug 日志只落文本长度。
        logger.debug("voice.asr", `partial received (len=${interim.trim().length})`);
        emitPartial(interim.trim());
      }
    }

    private handleError(code: string): void {
      if (this.dead) {
        return;
      }
      // Web Speech 错误码与 VoiceAsrErrorCode 同名同义，直接收窄映射；
      // 未知码保守归为 audio-capture（设备/引擎不可用族）。
      const known: readonly VoiceAsrErrorCode[] = [
        "not-allowed",
        "service-not-allowed",
        "network",
        "audio-capture",
        "aborted",
        "no-speech",
      ];
      const mapped: VoiceAsrErrorCode = known.includes(code as VoiceAsrErrorCode)
        ? (code as VoiceAsrErrorCode)
        : "audio-capture";
      // §7.1：warn 只落错误码，不落转写原文。
      logger.warn("voice.asr", `recognition error: ${mapped}`);
      this.dead = true;
      if (this.stopping) {
        // stop() 等待中的错误：按空 final 结算（§5.3 aborted/no-speech 同静音超时处理），
        // 错误再经 onError 通道上抛给输入腿做提示。
        this.resolveStop({ final: this.stopFlushBuffer.trim() });
      }
      closeSession(this);
      // 快照后迭代：回调内可能退订。
      for (const cb of Array.from(this.errorSubscribers)) {
        cb(new VoiceAsrError(mapped));
      }
    }

    private handleEnd(): void {
      if (this.stopping) {
        this.dead = true;
        closeSession(this);
        this.resolveStop({ final: this.stopFlushBuffer.trim() });
      }
      // 非 stopping 的 onend（引擎自发断流）：不自动重启（§5.3 防后台白跑），
      // 也不判死——等待调用方 stop()/abort() 或 error 事件定论。
    }

    private resolveStop(value: { final: string }): void {
      this.clearSettleTimer();
      const resolve = this.stopResolve;
      this.stopResolve = null;
      resolve?.(value);
    }

    private stopResolve: ((value: { final: string }) => void) | null = null;

    private clearSettleTimer(): void {
      if (this.settleTimer != null) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
    }

    onFinal(cb: (text: string) => void): () => void {
      this.finalSubscribers.add(cb);
      return () => {
        this.finalSubscribers.delete(cb);
      };
    }

    onError(cb: (error: VoiceAsrError) => void): () => void {
      this.errorSubscribers.add(cb);
      return () => {
        this.errorSubscribers.delete(cb);
      };
    }

    async stop(): Promise<{ final: string }> {
      if (this.dead) {
        return { final: "" };
      }
      this.stopping = true;
      const promise = new Promise<{ final: string }>((resolve) => {
        this.stopResolve = resolve;
      });
      // onend 是主同步点；settle 窗口只为 wedged engine 兜底（voiceTuning 注释）。
      this.settleTimer = setTimeout(() => {
        logger.warn("voice.asr", "recognition onend not observed within settle window");
        this.dead = true;
        closeSession(this);
        this.resolveStop({ final: this.stopFlushBuffer.trim() });
      }, stopSettleTimeoutMs);
      try {
        this.recognition.stop();
      } catch (error) {
        logger.warn("voice.asr", "recognition stop rejected", error);
        this.dead = true;
        closeSession(this);
        this.resolveStop({ final: this.stopFlushBuffer.trim() });
      }
      return promise;
    }

    abort(): void {
      if (this.dead) {
        return;
      }
      this.dead = true;
      this.clearSettleTimer();
      // Esc 可以发生在 stop() 等待 onend 期间，丢弃式结束也须结算该 Promise。
      this.resolveStop({ final: "" });
      closeSession(this);
      // 丢弃式停止：不产生 final（§2.3）。
      try {
        this.recognition.abort();
      } catch (error) {
        logger.warn("voice.asr", "recognition abort rejected", error);
      }
    }
  }

  return {
    isSupported(): boolean {
      return createRecognition() != null;
    },
    async start(params: VoiceAsrStartParams): Promise<VoiceAsrSession> {
      if (!this.isSupported()) {
        // 入口能力探测（§6.1 Web/手机缺席即不出入口）失败后的兜底：按引擎不可用处置。
        throw new VoiceAsrError("service-not-allowed", "speech recognition unsupported");
      }
      if (activeSession) {
        // 端口内单会话：旧会话丢弃式停止（输入腿状态机本就保证单录音腿，此为防御）。
        logger.warn("voice.asr", "previous session aborted by new start");
        activeSession.abort();
        activeSession = null;
      }
      let stream: MediaStreamLike;
      try {
        stream = await getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        throw mapGetUserMediaError(error);
      }
      let session: ActiveSession;
      try {
        session = new ActiveSession(stream, params.lang);
      } catch (error) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        throw error;
      }
      activeSession = session;
      logger.info("voice.asr", "web speech recognition session started");
      session.start();
      return session;
    },
    onPartial(cb: (text: string) => void): () => void {
      partialSubscribers.add(cb);
      return () => {
        partialSubscribers.delete(cb);
      };
    },
  };
}

export function mapGetUserMediaError(error: unknown): VoiceAsrError {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new VoiceAsrError("not-allowed", "microphone permission denied");
    case "NotFoundError":
    case "OverconstrainedError":
      return new VoiceAsrError("audio-capture", "microphone not found");
    case "NotReadableError":
      return new VoiceAsrError("audio-capture", "microphone busy or unreadable");
    case "AbortError":
      return new VoiceAsrError("aborted", "microphone request aborted");
    default:
      return new VoiceAsrError("audio-capture", `getUserMedia failed: ${name || "unknown"}`);
  }
}
