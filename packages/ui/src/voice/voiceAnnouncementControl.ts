/** 窗口内播报 owner 与 store 迁移适配（spec §9.8.2）。 */
import type {
  VoiceAnnouncementLegState,
  VoiceSessionStoreActions,
  VoiceSessionStoreState,
} from "@/store/voiceSessionStore.js";

/** 播报腿受控迁移面（voiceSessionStore 单一所有者的写入端口，见文件头说明）。 */
export interface AnnouncementLegControl {
  tryAcquireOwner(): boolean;
  isOwner(): boolean;
  releaseOwner(): void;
  snapshot(): VoiceAnnouncementLegState;
  startSpeaking(sentenceCount: number): VoiceAnnouncementLegState | null;
  /** 权限段句界拼接后同步句总数（§4.1 插队使队列长度变化；additive 于 §2.3）。 */
  extendSentenceCount(total: number): void;
  markPauseRequested(): VoiceAnnouncementLegState | null;
  clearPauseRequested(): VoiceAnnouncementLegState | null;
  sentenceCompleted(): VoiceAnnouncementLegState | null;
  resumeSpeaking(): VoiceAnnouncementLegState | null;
  cancelAnnouncement(
    source: "stopPressed" | "interruptWord" | "claimLost" | "tailSuperseded",
  ): VoiceAnnouncementLegState | null;
  beginTaskCancel(): VoiceAnnouncementLegState | null;
  settleTaskCancel(): VoiceAnnouncementLegState | null;
  setClaimHeld(held: boolean): void;
  setUninterruptible(uninterruptible: boolean): void;
}

let announcementOwnerSequence = 0;
export function createVoiceSessionAnnouncementControl(store: {
  getState(): VoiceSessionStoreActions & VoiceSessionStoreState;
}): AnnouncementLegControl {
  const ownerId = "voice-announcement-" + ++announcementOwnerSequence;
  const call = () => store.getState();
  const isOwner = () => call().announcementOwnerId === ownerId;
  const inactive: VoiceAnnouncementLegState = {
    phase: "annIdle",
    sentenceIndex: 0,
    sentenceCount: 0,
    claimHeld: false,
    pauseRequested: false,
    uninterruptible: false,
  };
  // F3：共享 store 的写权限属于唯一凭证，非 owner 只能读取空闲视图。
  return {
    tryAcquireOwner: () => call().acquireAnnouncementOwner(ownerId),
    isOwner,
    releaseOwner: () => call().releaseAnnouncementOwner(ownerId),
    snapshot: () => (isOwner() ? call().announcement : inactive),
    extendSentenceCount: (total) => {
      if (isOwner()) call().setSentenceCount(total);
    },
    startSpeaking: (count) => (isOwner() ? call().startAnnouncement(count) : null),
    markPauseRequested: () => (isOwner() ? call().markPauseRequested() : null),
    clearPauseRequested: () => (isOwner() ? call().clearPauseRequested() : null),
    sentenceCompleted: () => (isOwner() ? call().sentenceCompleted() : null),
    resumeSpeaking: () => (isOwner() ? call().resumeAnnouncement() : null),
    cancelAnnouncement: (source) => (isOwner() ? call().cancelAnnouncement(source) : null),
    beginTaskCancel: () => (isOwner() ? call().beginTaskCancel() : null),
    settleTaskCancel: () => (isOwner() ? call().settleTaskCancel() : null),
    setClaimHeld: (held) => {
      if (isOwner()) call().setClaimHeld(held);
    },
    setUninterruptible: (value) => {
      if (isOwner()) call().setUninterruptible(value);
    },
  };
}
