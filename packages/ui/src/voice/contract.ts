/**
 * voice 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 *
 * 本模块是语音接入的 renderer 侧底座（specs/voice-agent-integration.md §2.3）：
 * ASR/TTS 端口 + Web Speech 适配器 + 播报规划器 + 行为阈值/打断词表。
 * 对外消费入口（Phase 1a/1b wiring 经此接入，禁止深导入未列出文件）：
 * - voiceTuning.ts：行为阈值常量（唯一跨文件消费点，voiceSessionStore 已引用）；
 * - voiceAsrPort.ts / webSpeechAsrAdapter.ts：听写端口与实现；
 * - voiceTtsPort.ts / speechSynthesisTtsAdapter.ts：播报端口与实现；
 * - turnSpeechPlanner.ts：播报规划器 + 播报腿控制面适配（写路径唯一归宿 voiceSessionStore）；
 * - interruptionWords.ts：打断词表与 final 分类（纯函数）；
 * - voiceAnnouncementClaim.ts：单播报者 claim 端口（BroadcastHub 适配 Phase 1b 落地）。
 *
 * 状态所有者边界：播报腿/输入腿状态的唯一所有者是 ui 包 store/voiceSessionStore（spec §3.1），
 * 本模块只经 AnnouncementLegControl 受控面写入，不在模块内保留第二状态源。
 */
export interface VoiceContract {
  // 契约以端口 interface + 纯函数形式分散在上面列出的入口文件中，此处不重复签名。
}
