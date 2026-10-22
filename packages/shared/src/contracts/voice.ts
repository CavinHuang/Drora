/**
 * 语音 Agent 跨进程契约常量（specs/voice-agent-integration.md §2.1，Phase 0 契约先行）。
 *
 * 契约键单一出处（AGENTS.md）：以下字面量只在此定义一次，生产方与消费方引用同一常量；
 * 改名任何一侧前先全链 grep 生产与消费。结构照 contracts/desktopPet.ts 先例
 * （对象常量 + 嵌套 channel 命名）。
 *
 * 明确不进本文件（§2.1 冻结）：行为阈值（录音超时、简报限流窗口、claim 续约间隔、
 * lastDictation TTL）是 renderer 行为参数而非跨进程契约键，放
 * packages/ui/src/voice/voiceTuning.ts；打断词表放 packages/ui/src/voice/interruptionWords.ts
 * （UI 交互判定，不进 wire）。
 */

/** wire 契约：input-intent source kind 字面量。drora-protocol-v4/input-intent.ts 的
 *  voiceInputSourceSchema 以 z.literal(VOICE_INPUT_SOURCE_KIND) 引用，禁止两处独立写字面量。 */
export const VOICE_INPUT_SOURCE_KIND = "voice";

/** appSettings 持久化键（validationAppSettings.ts schema 字段名与此一一对应，
 *  由 parity 单测钉住；specs/voice-agent-integration.md §6.1 八键表）。 */
export const VOICE_SETTINGS_KEYS = {
  composerEntryHidden: "voiceComposerEntryHidden",
  announcementEnabled: "voiceAnnouncementEnabled",
  announcementVoice: "voiceAnnouncementVoice",
  announcementRate: "voiceAnnouncementRate",
  dictationLang: "voiceDictationLang",
  asrEngine: "voiceAsrEngine",
  toolBriefEnabled: "voiceToolBriefEnabled",
  privacyDisclosureAcknowledged: "voicePrivacyDisclosureAcknowledged",
} as const;

/** 跨窗口 claim 键（经既有 BroadcastHub 通用 claim 通道，Main 不解析语义）。 */
export const VOICE_BROADCAST_CLAIM_KEY = {
  announcement: "drora:voice-announcement-claim",
  /**
   * 预留键（FD-7 / EG-7 keptOpen）：Phase 1 零生产/消费方，唯一潜在消费方 EG-7
   * （spec §10）；随 EG-7 裁决启用或移除。Phase 0 的 dep:refs 同源断言不覆盖本键（§9.1）。
   */
  mic: "drora:voice-mic-claim",
} as const;
