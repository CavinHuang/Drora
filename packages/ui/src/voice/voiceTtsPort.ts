/**
 * TTS 端口（specs/voice-agent-integration.md §2.3，签名契约）。
 *
 * 单句合成播报；排队/分句策略归规划器（turnSpeechPlanner.ts），端口不排队。
 * Phase 1b 用 Chromium 内建 speechSynthesis（speechSynthesisTtsAdapter.ts）；
 * 云 TTS 走同端口后置换（TV-3 keptOpen）。
 */

export interface VoiceTtsUtterance {
  text: string;
  lang: string;
  /** 系统音色名；缺省 = 系统默认（speechSynthesisTtsAdapter 精确 name 匹配）。 */
  voice?: string;
  /**
   * 厂商音色 id（spec §9.7.3 additive）；缺省 = 厂商默认音色（cloud 请求体省略 voice
   * 字段）。cloudTtsAdapter 只读本字段、speechSynthesisTtsAdapter 只读 voice——双引擎
   * 双轨各取各键，跨命名空间冲突构造性消除。
   */
  vendorVoice?: string;
  /** 语速倍率，缺省 1。 */
  rate?: number;
}

export interface VoiceTtsHandle {
  readonly utteranceId: string;
}

export type VoiceTtsDoneReason = "end" | "cancelled" | "error";

export interface VoiceTtsPort {
  /** 单句合成播报；排队/分句策略归规划器，端口不排队。 */
  speak(u: VoiceTtsUtterance): VoiceTtsHandle;
  /** 无参 = 全停（点按播报指示停止按钮立即，任何状态含 uninterruptible 段——§3.3 FD-1）。 */
  cancel(): void;
  /**
   * 句边界推进回调（引擎支持 onboundary 时）；返回退订函数。
   * reason="error" 时实现必须吞异常并落 voice.tts warn（照 taskNotificationSound.ts:19-42 吞 autoplay 异常先例）。
   */
  onDone(cb: (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void): () => void;
}
