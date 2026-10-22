/**
 * 语音听写 composer 入口门控与设置读取（零 React、零 store 依赖的纯函数层）。
 *
 * 照 cuaComposerEntryState.ts 三段式先例：可见性门 / 状态判定 / 视图组装全部由输入注入，
 * hook（useVoiceComposerEntry）只做数据汇聚。FD-5 的隐私确认 reader 守卫也在这里收口——
 * 设置页开关开启动作与点按 mic 兜底门共用同一函数，保证两入口语义永不漂移。
 */
import type { AppSettings } from "@drora/shared";

/** §6.1 开关 1：入口默认隐藏；只有显式存过 false 才可见（照 useCuaComposerEntry.ts:70 先例）。 */
export function isVoiceComposerEntryVisibleInSettings(
  settings: Pick<AppSettings, "voiceComposerEntryHidden"> | null | undefined,
): boolean {
  return settings?.voiceComposerEntryHidden === false;
}

/** §6.1 开关 2：播报总开关默认关。 */
export function isVoiceAnnouncementEnabledInSettings(
  settings: Pick<AppSettings, "voiceAnnouncementEnabled"> | null | undefined,
): boolean {
  return settings?.voiceAnnouncementEnabled === true;
}

/** §6.1 开关 8：隐私披露默认未确认；FD-5 两入口共用本 reader 守卫。 */
export function isVoicePrivacyAcknowledged(
  settings: Pick<AppSettings, "voicePrivacyDisclosureAcknowledged"> | null | undefined,
): boolean {
  return settings?.voicePrivacyDisclosureAcknowledged === true;
}

/** §6.1 键 5：听写语言；空串/缺省 = 跟随当前 locale（不硬编码）。 */
export function resolveVoiceDictationLang(
  settings: Pick<AppSettings, "voiceDictationLang"> | null | undefined,
  currentLocale: string,
): string {
  const configured = settings?.voiceDictationLang?.trim() ?? "";
  return configured.length > 0 ? configured : currentLocale;
}

/** §6.1 键 3/4：播报音色（空 = 系统默认）与语速（缺省 1，范围 0.5–2.0）。 */
export function resolveVoiceAnnouncementVoiceConfig(
  settings: Pick<AppSettings, "voiceAnnouncementVoice" | "voiceAnnouncementRate"> | null | undefined,
): {
  voice?: string;
  rate: number;
} {
  const voice = settings?.voiceAnnouncementVoice?.trim() ?? "";
  const rate = settings?.voiceAnnouncementRate;
  return {
    ...(voice.length > 0 ? { voice } : {}),
    rate: typeof rate === "number" && rate >= 0.5 && rate <= 2 ? rate : 1,
  };
}

export interface VoiceComposerEntryInputs {
  /** Web/手机远控壳：远控约束下不渲染本机 mic 入口（§8.3 落位修订）。 */
  isWebRemoteControl: boolean;
  /** Web Speech 能力探测（含 Electron renderer 内的 Chromium 实测），不写 UA 分支。 */
  asrSupported: boolean;
  /** §6.1 开关 1：设置页显式隐藏（!== false 判定）。 */
  hiddenBySettings: boolean;
}

export type VoiceComposerEntryView =
  | { visible: false }
  | {
      visible: true;
      tooltipMessageId: string;
    };

const TOOLTIP_MESSAGE_ID = "voice.entry.mic.tooltip";

/**
 * 可见性门（§9.2 验收：isWebRemoteControl / isSupported()=false / 入口隐藏 → 不渲染）。
 * 门不过不渲染 DOM，而不是渲染 disabled 按钮（照 CUA 入口哲学：不可用场景留灰按钮
 * 会误导用户以为「能用」）。FD-5 的确认门不属于可见性：入口可见但 acknowledged=false
 * 时仍渲染，点按走披露弹层兜底门（两入口共用 isVoicePrivacyAcknowledged reader）。
 */
export function resolveVoiceComposerEntryView(
  inputs: VoiceComposerEntryInputs,
): VoiceComposerEntryView {
  if (inputs.isWebRemoteControl) return { visible: false };
  if (!inputs.asrSupported) return { visible: false };
  if (inputs.hiddenBySettings) return { visible: false };
  return { visible: true, tooltipMessageId: TOOLTIP_MESSAGE_ID };
}
