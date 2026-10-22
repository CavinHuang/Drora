/**
 * voice 模块 i18n 消费键清单（specs/voice-agent-integration.md §6.3，EG-4）。
 *
 * 静态清单驱动 voiceI18n.test.ts 三断言守护（双语键集一致 / 消费键存在非空 / 占位符
 * 同构）。Phase 1a 只列本批消费的键；Phase 1b/2 键（voice.ann.stop.aria、voice.brief.*、
 * voice.interrupt.hint）随各自批次补录。
 */

export const VOICE_ENTRY_I18N_KEYS = [
  "voice.entry.mic.start.aria",
  "voice.entry.mic.stop.aria",
  "voice.entry.mic.tooltip",
] as const;

export const VOICE_DICTATION_I18N_KEYS = [
  "voice.dictation.preview.hint",
  "voice.dictation.preview.clear",
  "voice.dictation.requestingMic",
  "voice.dictation.requestingMicTimeout",
  "voice.dictation.error.permission",
  "voice.dictation.error.network",
  "voice.dictation.error.device",
  "voice.dictation.error.aborted",
  "voice.dictation.sessionGone",
  "voice.dictation.restoreLast",
  "voice.dictation.recordingIndicatorAria",
  "voice.dictation.draftSessionName",
] as const;

/** Phase 1b 播报面（§6.3 voice.ann.* + additive 截断尾缀）。 */
export const VOICE_ANNOUNCEMENT_I18N_KEYS = [
  "voice.ann.indicator",
  "voice.ann.indicatorAria",
  "voice.ann.stop.aria",
  "voice.ann.permission.truncated",
] as const;

export const VOICE_SETTINGS_I18N_KEYS = [
  "settings.voice.title",
  "voice.settings.title",
  "voice.settings.description",
  "voice.settings.dictation.entry.label",
  "voice.settings.dictation.entry.description",
  "voice.settings.dictation.lang.label",
  "voice.settings.dictation.lang.auto",
  "voice.settings.dictation.lang.zh",
  "voice.settings.dictation.lang.en",
  "voice.settings.asr.engine.label",
  "voice.settings.asr.engine.webSpeech",
  "voice.settings.asr.engine.remote",
  "voice.settings.announcement.enable.label",
  "voice.settings.announcement.enable.description",
  "voice.settings.announcement.voice.label",
  "voice.settings.announcement.voice.default",
  "voice.settings.announcement.rate.label",
  "voice.settings.announcement.outputDisclosure",
  "voice.settings.toolBrief.enable.label",
  "voice.settings.toolBrief.enable.description",
  "voice.settings.privacy.title",
  "voice.settings.privacy.asr",
  "voice.settings.privacy.persistence",
  "voice.settings.privacy.mic",
  "voice.settings.privacy.acknowledge",
] as const;

export const VOICE_SOURCE_I18N_KEYS = ["voice.source.fromVoice"] as const;

export const VOICE_CONSUMED_I18N_KEYS: readonly string[] = [
  ...VOICE_ENTRY_I18N_KEYS,
  ...VOICE_DICTATION_I18N_KEYS,
  ...VOICE_ANNOUNCEMENT_I18N_KEYS,
  ...VOICE_SETTINGS_I18N_KEYS,
  ...VOICE_SOURCE_I18N_KEYS,
];
