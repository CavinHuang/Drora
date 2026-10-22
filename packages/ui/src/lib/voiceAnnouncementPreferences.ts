/**
 * 播报偏好 reader 收口（specs/voice-agent-integration.md §9.3 / §6.1，照
 * taskNotificationPreferences.ts:33 先例）：播报消费点（规划器 isAnnouncementEnabled、
 * 指示器渲染）不直接读 store/设置快照，保证设置关闭后运行时行为一致。
 *
 * 判定真值来自 appSettings（useSettings 快照），本模块只做纯函数收口与组合；
 * 隐私确认门（FD-5）语义：能打开播报开关必然已过披露确认，故 reader 只看开关本身。
 */
import type { AppSettings } from "@drora/shared";
import {
  isVoiceAnnouncementEnabledInSettings,
  resolveVoiceAnnouncementVoiceConfig,
} from "@/voice/voiceComposerEntryState.js";

/** 播报总开关最终生效值（§6.1 默认关；`=== true` 判定）。 */
export function isVoiceAnnouncementEnabled(
  settings: Pick<AppSettings, "voiceAnnouncementEnabled"> | null | undefined,
): boolean {
  return isVoiceAnnouncementEnabledInSettings(settings);
}

/** 播报音色/语速（§6.1 键 3/4；空音色 = 系统默认，语速缺省 1）。 */
export function resolveVoiceAnnouncementOutputConfig(settings: AppSettings | null | undefined): {
  voice?: string;
  rate: number;
} {
  return resolveVoiceAnnouncementVoiceConfig(settings);
}
