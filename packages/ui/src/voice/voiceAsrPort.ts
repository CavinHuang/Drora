/**
 * ASR 端口（specs/voice-agent-integration.md §2.3，签名契约）。
 *
 * 端口只抽象「开始一次录音会话 / 订阅 partial / 拿 final」；引擎选型与 UI 无关——
 * Phase 1a 用 Web Speech（webSpeechAsrAdapter.ts），云引擎走同端口后置换（Phase 2 remoteAsrAdapter）。
 *
 * 对 §2.3 画出签名的两处最小 additive 扩展（记录于批次 deviations）：
 * - `VoiceAsrSession.onFinal`：§5.1 冻结「每句 final 以 mode=append 注入正文」+ §5.2
 *   「每句 final 注入发起即从预览条移除该句」要求会话中途可感知逐句终态；§2.3 只画了
 *   stop() 的整段 final，无法承载逐句注入。
 * - `VoiceAsrSession.onError`：§5.3 冻结「ASR 运行中失败 → 立即回 Idle + 提示、不自动重启」；
 *   错误必须在会话中途即时上抛，不能等 stop() 才暴露。
 */

/** §5.3 错误处置映射的错误码。 */
export type VoiceAsrErrorCode =
  | "not-allowed"
  | "service-not-allowed" // 权限 → 提示 + 设置引导
  | "network" // 网络 → 保留已注入文本 + 提示
  | "audio-capture" // 设备 → 设备检查提示
  | "aborted"
  | "no-speech"; // 同静音超时处理

export class VoiceAsrError extends Error {
  readonly code: VoiceAsrErrorCode;

  constructor(code: VoiceAsrErrorCode, message?: string) {
    super(message ?? `voice asr error: ${code}`);
    this.name = "VoiceAsrError";
    this.code = code;
  }
}

export interface VoiceAsrStartParams {
  /** BCP-47，跟随当前 locale，不硬编码（现状 speech-input.tsx:90 硬编码 en-US 是要修复的先例）。 */
  lang: string;
  /** 打断词等偏置词，引擎支持时使用。 */
  hints?: string[];
}

/** 一次录音会话；端口实现负责 getUserMedia 约束
 *  { echoCancellation: true, noiseSuppression: true, autoGainControl: true }（全仓首批）。 */
export interface VoiceAsrSession {
  /** 手动停止（点按/Esc）：等待最终结果，resolve final 文本（可能为空串）。 */
  stop(): Promise<{ final: string }>;
  /** 丢弃式停止（错误/超时/绑定会话关闭）：不产生 final。 */
  abort(): void;
  /**
   * 逐句终态转写订阅（additive，见文件头说明）。文本为该句 trim 后结果；
   * 返回退订函数。命中打断词表的 final 由消费方经 interruptionWords 分类后改走命令通道。
   */
  onFinal(cb: (text: string) => void): () => void;
  /** 运行中错误（additive，见文件头说明）；触发后端口实现不再产生 final/partial。 */
  onError(cb: (error: VoiceAsrError) => void): () => void;
}

export interface VoiceAsrPort {
  isSupported(): boolean;
  /** 授权失败/引擎不可用 throw VoiceAsrError(code)。 */
  start(params: VoiceAsrStartParams): Promise<VoiceAsrSession>;
  /** partial 订阅；返回退订函数。partial 只进预览条（§5.1），永不上协议。 */
  onPartial(cb: (text: string) => void): () => void;
}
