import { create } from "zustand";
import { VOICE_LAST_DICTATION_TTL_MS } from "@/voice/voiceTuning.js";
import { requestVoiceRecordingAbort } from "@/voice/voiceRecordingControl.js";

/**
 * 语音会话两条腿状态机（specs/voice-agent-integration.md §3.1 / §3.2 / §3.3）。
 *
 * 状态所有者（§3.1，单一所有者无第二写路径）：
 * - 输入腿（partial/final、录音态、绑定会话、lastDictation、ASR 错误态）与播报腿
 *   （annState、句序号、claim 持有、uninterruptible 标记）全部收敛在本 store；
 * - partial 只进预览条（partialText 字段），永不写 composer 正文、永不进协议（§5.1）；
 *   composer 正文的唯一写入 = composerTextInsertRequest 通道，由入口 wiring 消费
 *   pendingFinalText 发出（mode=append + targetSessionId=绑定会话，§3.4）；
 * - 音频 buffer 禁入任何 store（§3.1）——录音结束即弃，本 store 无音频字段；
 * - 播报腿纯 UI 态不进 CLI 账本；冷恢复不重放（§7.2）。
 *
 * 状态机（§3.2 两条腿 + §3.3 互斥规则）：所有迁移经下方 guarded actions，非法迁移
 * no-op 返回 null/false，调用方（入口 wiring / TurnSpeechPlanner）以返回值判定。
 * 定时器（RequestingMic 10s、claim 续约 2s、Cancelling 5s 兜底）归 wiring/planner，
 * store 只持纯迁移。
 */

/** 输入腿（听写）状态。 */
export type VoiceInputLegState = "idle" | "requestingMic" | "recording" | "injecting";

/**
 * 听写轻提示码。store 只存类型化 code，i18n 文案映射归入口 wiring（§6.3 键清单，
 * Phase 1a 落 locales）。
 */
export type VoiceDictationNoticeCode =
  | "permission" // voice.dictation.error.permission
  | "network" // voice.dictation.error.network
  | "device" // voice.dictation.error.device
  | "aborted" // voice.dictation.error.aborted（含 no-speech / 静音超时空转写）
  | "requestingMicTimeout" // voice.dictation.requestingMicTimeout
  | "sessionGone"; // voice.dictation.sessionGone

export interface VoiceDictationNotice {
  code: VoiceDictationNoticeCode;
  at: number;
}

/** lastDictation 暂存（§5.4：TTL 300s，恢复菜单数据源；纯 UI 态不持久化，§7.2）。 */
export interface VoiceLastDictation {
  text: string;
  capturedAt: number;
}

/** 播报腿（TTS）状态（§3.2 播报腿状态机）。 */
export type VoiceAnnouncementPhase = "annIdle" | "speaking" | "annPaused" | "cancelling";

export interface VoiceAnnouncementLegState {
  phase: VoiceAnnouncementPhase;
  /** 当前句序号（0 基；句粒度暂停/续播 §4.7，不记句内位置）。语义 = 正在播/下一句待播的下标。 */
  sentenceIndex: number;
  sentenceCount: number;
  /** 播报 claim 持有（§3.5）；AnnPaused 是持约态不释放（FD-2）。 */
  claimHeld: boolean;
  /** 输入腿进入 Recording 的暂停请求；当前句播完时生效（§4.7 句粒度）。 */
  pauseRequested: boolean;
  /** uninterruptible 段标记（§3.3）：Phase 1b 权限内容播报段置位；仅约束打断词通道。 */
  uninterruptible: boolean;
}

export interface VoiceSessionStoreState {
  /** —— 输入腿 —— */
  inputLeg: VoiceInputLegState;
  /** 听写绑定会话（§3.4）：按下即捕获，录音期间不变（含切换 focused）。 */
  boundSessionId: string | null;
  /** partial 只进预览条（§5.1）；录音腿回 Idle 时一并清空（§5.2）。 */
  partialText: string;
  notice: VoiceDictationNotice | null;
  lastDictation: VoiceLastDictation | null;
  /** Injecting 乐观窗口内的待注入 final；composerTextInsertRequest 由 wiring 发出（§3.1）。 */
  pendingFinalText: string | null;
  /**
   * FD-6：同会话第二 mic 入口点按被拒（no-op）时递增；持有录音指示的入口订阅它做
   * 短暂高亮。计数器语义（无业务含义），纯 UI 信号。
   */
  recordingPulseSeq: number;
  /**
   * FD-6：录音腿持有入口的实例标识（useVoiceDictation 每实例唯一）。同会话主/辅 pane
   * 双入口必须以入口实例区分「持有者的点按=停止」与「第二入口的点按=no-op+脉冲」，
   * 仅按 sessionId 无法区分。离开录音腿（含 Injecting 乐观离场到 Idle）即清空。
   */
  recordingOwnerEntryId: string | null;

  /** —— 播报腿 —— */
  announcement: VoiceAnnouncementLegState;
  /** 窗口内唯一播报 planner 的不透明凭证；获取跨窗 claim 前即占有。 */
  announcementOwnerId: string | null;
}

export interface VoiceSessionStoreActions {
  acquireAnnouncementOwner(ownerId: string): boolean;
  releaseAnnouncementOwner(ownerId: string): void;
  // —— 输入腿 ——
  /**
   * Idle→RequestingMic：捕获绑定会话（草稿 composer 传 null）与持有入口实例。
   * 非 Idle（含已有录音腿）no-op 返回 false（FD-6 第二入口）——recording 态拒绝时
   * 递增 recordingPulseSeq 触发持有者指示高亮。
   */
  startMicRequest(sessionId: string | null, ownerEntryId: string): boolean;
  /** RequestingMic→Idle：用户取消（不开提示）。 */
  cancelMicRequest(): boolean;
  /** RequestingMic→Idle：拒绝/10s 超时/开录失败，带轻提示（§5.3 错误处置映射）。 */
  failMicRequest(code: Exclude<VoiceDictationNoticeCode, "sessionGone">): boolean;
  /** RequestingMic→Recording：授权。 */
  beginRecording(): boolean;
  /** Recording 期 partial 更新（只进预览条）。非 Recording no-op。 */
  setPartial(text: string): boolean;
  /**
   * Recording→Injecting：一句 final 待注入（§5.1 每句 final mode=append）。
   * 预览条同步移除该句（§5.2）。空 final 视为静音超时空转写 → 直接回 Idle + aborted 提示。
   */
  commitFinal(text: string): boolean;
  /**
   * Injecting→Idle：注入请求已发出（乐观，§5.4）；final 暂存 lastDictation（TTL 300s）。
   * 多句连说时传 resumeRecording=true：乐观微态回归 Recording——§5.1 连续多句顺序拼接、
   * §5.2 预览条在录音结束时才清空，录音腿在句间不回 Idle（§3.2 Injecting 边的
   * 多句扩展，additive）。
   */
  finishInjection(options?: { resumeRecording?: boolean }): boolean;
  /** Recording→Idle：Esc / 点按 / 无 final 丢弃路径；partial 清空（§5.2）。 */
  stopRecording(): boolean;
  /** Recording→Idle：ASR 错误族（network 保留已注入文本——正文已在 composer，store 无需动作）。 */
  abortRecording(notice?: VoiceDictationNoticeCode): boolean;
  /** 绑定会话关闭/删除/归档（EG-6）：强制停录音、partial 丢弃、轻提示；final 悬空走 lastDictation。 */
  notifyBoundSessionClosed(): boolean;
  /** FD-4：恢复成功后清空暂存（恢复动作本身以新 requestId 走 composerTextInsertRequest）。 */
  clearLastDictation(): void;
  clearNotice(): void;

  // —— 播报腿（§3.2 迁移表 + §3.3 互斥规则，迁移失败返回 null）——
  /**
   * AnnIdle→Speaking（§3.2 进入条件：播报开由 planner 判定；持 claim 与输入腿≠Recording
   * 在此守卫）。Speaking 期再次调用 = 「作废旧轮尾只播最新」替换（§3.3 顺延规则）。
   */
  startAnnouncement(sentenceCount: number): VoiceAnnouncementLegState | null;
  /**
   * 权限段句界拼接后同步句总数（§4.1 插队使队列长度变化；仅 Speaking 段有效）。
   */
  setSentenceCount(total: number): VoiceAnnouncementLegState | null;
  /** Speaking 期请求暂停：当前句播完时生效（§4.7 句粒度，最坏一句时长延迟）。 */
  markPauseRequested(): VoiceAnnouncementLegState | null;
  /** 录音在句界前已结束：撤销未生效的暂停请求。 */
  clearPauseRequested(): VoiceAnnouncementLegState | null;
  /**
   * 当前句播完推进（§4.7）：先推进句序号；pauseRequested → AnnPaused（持约态，FD-2）；
   * 句序号越界 → AnnIdle（release 时机 §3.5-4）；否则保持 Speaking 由 planner 播下一句。
   */
  sentenceCompleted(): VoiceAnnouncementLegState | null;
  /** AnnPaused→Speaking：录音结束 & claim 仍持有（renew=false 已先回 AnnIdle，§3.2）。 */
  resumeAnnouncement(): VoiceAnnouncementLegState | null;
  /**
   * 任意播报态→AnnIdle（§3.3 FD-1：点按立即；§3.5-3 claim 被抢；打断词命中；
   * §3.2 录音结束发现轮尾已更新的顺延作废）。
   * uninterruptible=true 时仅 source="interruptWord" 被拒绝（§3.3 uninterruptible 界定：
   * 只约束语音打断词通道，点按通道不受限）。
   */
  cancelAnnouncement(
    source: "stopPressed" | "interruptWord" | "claimLost" | "tailSuperseded",
  ): VoiceAnnouncementLegState | null;
  /** Speaking/AnnPaused→Cancelling：「停掉任务」或任务被任何停止面取消（播报同步静音，§3.2）。 */
  beginTaskCancel(): VoiceAnnouncementLegState | null;
  /** Cancelling→AnnIdle：TurnComplete(cancelled) 或 5s 兜底（兜底 warn 归 planner/wiring，§3.3）。 */
  settleTaskCancel(): VoiceAnnouncementLegState | null;
  /** claim acquire/release 结果登记（§3.5）。 */
  setClaimHeld(held: boolean): void;
  /** Phase 1b 权限段置位（§4.1）；本批仅状态位与打断词通道守卫。 */
  setUninterruptible(uninterruptible: boolean): void;
}

export type VoiceSessionStore = VoiceSessionStoreState & VoiceSessionStoreActions;

const initialAnnouncement: VoiceAnnouncementLegState = {
  phase: "annIdle",
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

/** lastDictation 是否仍可恢复（§5.4 FD-4：TTL 过期菜单项直接消失，不置灰）。 */
export function isVoiceLastDictationFresh(
  state: Pick<VoiceSessionStoreState, "lastDictation">,
  now: number,
): boolean {
  const last = state.lastDictation;
  if (!last) {
    return false;
  }
  return now - last.capturedAt <= VOICE_LAST_DICTATION_TTL_MS;
}

/**
 * §4.4 录音态 Esc 仲裁（键位仲裁表优先级 3）：录音中且无更高优先消费者时，Esc 归录音
 * （停录音、任务不中断）。返回是否消费；调用方据此决定 preventDefault/stopPropagation。
 * ChatPromptEditor（props 注入）与 SessionPane 窗口监听两处接缝共用本函数。
 */
export function consumeVoiceRecordingEscape(): boolean {
  const state = useVoiceSessionStore.getState();
  if (state.inputLeg !== "recording") {
    return false;
  }
  requestVoiceRecordingAbort(state.recordingOwnerEntryId);
  return true;
}

export const useVoiceSessionStore = create<VoiceSessionStore>()((set, get) => {
  const withInputLeg = (
    from: readonly VoiceInputLegState[],
    transition: (state: VoiceSessionStoreState) => Partial<VoiceSessionStoreState> | null,
  ): boolean => {
    const state = get();
    if (!from.includes(state.inputLeg)) {
      return false;
    }
    const patch = transition(state);
    if (!patch) {
      return false;
    }
    set(patch);
    return true;
  };

  const withAnnouncement = (
    from: readonly VoiceAnnouncementPhase[],
    transition: (leg: VoiceAnnouncementLegState) => Partial<VoiceAnnouncementLegState> | null,
  ): VoiceAnnouncementLegState | null => {
    const leg = get().announcement;
    if (!from.includes(leg.phase)) {
      return null;
    }
    const patch = transition(leg);
    if (!patch) {
      return null;
    }
    const next = { ...leg, ...patch };
    set({ announcement: next });
    return next;
  };

  return {
    inputLeg: "idle",
    boundSessionId: null,
    partialText: "",
    notice: null,
    lastDictation: null,
    pendingFinalText: null,
    recordingPulseSeq: 0,
    recordingOwnerEntryId: null,
    announcement: initialAnnouncement,
    announcementOwnerId: null,
    acquireAnnouncementOwner(ownerId) {
      const current = get().announcementOwnerId;
      if (current !== null && current !== ownerId) return false;
      set({ announcementOwnerId: ownerId });
      return true;
    },
    releaseAnnouncementOwner(ownerId) {
      if (get().announcementOwnerId === ownerId) set({ announcementOwnerId: null });
    },

    // —— 输入腿 ——
    startMicRequest(sessionId, ownerEntryId) {
      const state = get();
      if (state.inputLeg !== "idle") {
        // FD-6：非 Idle（含已有录音腿）一律 no-op；已有录音时递增脉冲让持有录音指示
        // 的入口短暂高亮，提示「正在录音的是这里」。
        if (state.inputLeg === "recording") {
          set((current) => ({ recordingPulseSeq: current.recordingPulseSeq + 1 }));
        }
        return false;
      }
      set({
        inputLeg: "requestingMic",
        boundSessionId: sessionId,
        recordingOwnerEntryId: ownerEntryId,
        // 新一次点按是用户对上一次提示的显式动作，旧提示随之失效。
        notice: null,
      });
      return true;
    },
    cancelMicRequest() {
      return withInputLeg(["requestingMic"], () => ({
        inputLeg: "idle",
        boundSessionId: null,
        recordingOwnerEntryId: null,
      }));
    },
    failMicRequest(code) {
      return withInputLeg(["requestingMic"], () => ({
        inputLeg: "idle",
        boundSessionId: null,
        recordingOwnerEntryId: null,
        notice: { code, at: Date.now() },
      }));
    },
    beginRecording() {
      return withInputLeg(["requestingMic"], () => ({
        inputLeg: "recording",
      }));
    },
    setPartial(text) {
      return withInputLeg(["recording"], () => ({
        // §5.1：partial 只进预览条——本字段是 partial 的唯一归宿。
        partialText: text,
      }));
    },
    commitFinal(text) {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        // §3.2 静音超时（空转写）出边：Recording→Idle + aborted 提示。
        return withInputLeg(["recording"], () => ({
          inputLeg: "idle",
          boundSessionId: null,
          partialText: "",
          notice: { code: "aborted", at: Date.now() },
        }));
      }
      return withInputLeg(["recording"], () => ({
        inputLeg: "injecting",
        // §5.2：该句 final 注入发起即从预览条移除。
        partialText: "",
        pendingFinalText: trimmed,
      }));
    },
    finishInjection(options) {
      const injected = get().pendingFinalText;
      if (injected == null) {
        return false;
      }
      // §5.4 乐观模型：注入后立即离场并暂存——消费门不匹配与绑定会话消失两条
      // 失败路径同覆盖，「恢复上次转写」以新 requestId 重试。
      set({
        inputLeg: options?.resumeRecording === true ? "recording" : "idle",
        // 多句连说（resumeRecording）保持持有入口不变；单句/手动停止离场清持有者。
        ...(options?.resumeRecording === true
          ? {}
          : { boundSessionId: null, recordingOwnerEntryId: null }),
        pendingFinalText: null,
        lastDictation: { text: injected, capturedAt: Date.now() },
      });
      return true;
    },
    stopRecording() {
      return withInputLeg(["recording"], () => ({
        inputLeg: "idle",
        boundSessionId: null,
        recordingOwnerEntryId: null,
        partialText: "",
      }));
    },
    abortRecording(notice) {
      return withInputLeg(["recording"], () => ({
        inputLeg: "idle",
        boundSessionId: null,
        recordingOwnerEntryId: null,
        partialText: "",
        notice: notice ? { code: notice, at: Date.now() } : null,
      }));
    },
    notifyBoundSessionClosed() {
      // EG-6：强制停录音 + partial 丢弃 + 轻提示；Injecting 期会话消失由 finishInjection
      // 的乐观暂存覆盖（final 未注入的进 lastDictation，§3.3）。
      return withInputLeg(["recording"], () => ({
        inputLeg: "idle",
        boundSessionId: null,
        recordingOwnerEntryId: null,
        partialText: "",
        notice: { code: "sessionGone", at: Date.now() },
      }));
    },
    clearLastDictation() {
      set({ lastDictation: null });
    },
    clearNotice() {
      set({ notice: null });
    },

    // —— 播报腿 ——
    startAnnouncement(sentenceCount) {
      const { announcement, inputLeg } = get();
      if (sentenceCount <= 0) {
        return null;
      }
      // §3.2 进入条件：持 claim 且输入腿≠Recording；AnnPaused/Cancelling 不进（改播最新
      // 经 AnnIdle 重新竞争，§3.2 注）。Speaking 期调用 = 替换为最新轮尾（§3.3 顺延）。
      if (!announcement.claimHeld || inputLeg === "recording") {
        return null;
      }
      if (announcement.phase !== "annIdle" && announcement.phase !== "speaking") {
        return null;
      }
      const next: VoiceAnnouncementLegState = {
        ...announcement,
        phase: "speaking",
        sentenceIndex: 0,
        sentenceCount,
        pauseRequested: false,
        uninterruptible: false,
      };
      set({ announcement: next });
      return next;
    },
    setSentenceCount(total) {
      return withAnnouncement(["speaking"], (leg) =>
        total > leg.sentenceIndex && total !== leg.sentenceCount ? { sentenceCount: total } : null,
      );
    },
    markPauseRequested() {
      return withAnnouncement(["speaking"], () => ({ pauseRequested: true }));
    },
    clearPauseRequested() {
      return withAnnouncement(["speaking"], (leg) =>
        leg.pauseRequested ? { pauseRequested: false } : null,
      );
    },
    sentenceCompleted() {
      return withAnnouncement(["speaking"], (leg) => {
        const nextIndex = leg.sentenceIndex + 1;
        if (leg.pauseRequested) {
          // §4.7：当前句播完即停入 AnnPaused；记已播句序号（nextIndex = 下一句边界）。
          return { phase: "annPaused", sentenceIndex: nextIndex, pauseRequested: false };
        }
        if (nextIndex >= leg.sentenceCount) {
          // §3.5-4 release 时机：播完回 AnnIdle。
          return { phase: "annIdle", sentenceIndex: nextIndex, claimHeld: false };
        }
        return { sentenceIndex: nextIndex };
      });
    },
    resumeAnnouncement() {
      return withAnnouncement(["annPaused"], (leg) =>
        leg.claimHeld ? { phase: "speaking" } : null,
      );
    },
    cancelAnnouncement(source) {
      const leg = get().announcement;
      if (leg.phase === "annIdle") {
        return null;
      }
      // §3.3 uninterruptible 界定：仅约束语音打断词通道；点按/claim 校正不受限。
      if (source === "interruptWord" && leg.uninterruptible) {
        return null;
      }
      const next: VoiceAnnouncementLegState = {
        ...leg,
        phase: "annIdle",
        sentenceIndex: 0,
        sentenceCount: 0,
        pauseRequested: false,
        // 离开播报态即解除 uninterruptible：否则残留 true 会把下一次播报的打断词通道
        // 误锁（§3.3 uninterruptible 只描述「权限段播报中」这一瞬态）。
        uninterruptible: false,
        claimHeld: false,
      };
      set({ announcement: next });
      return next;
    },
    beginTaskCancel() {
      return withAnnouncement(["speaking", "annPaused"], () => ({
        phase: "cancelling",
        pauseRequested: false,
      }));
    },
    settleTaskCancel() {
      return withAnnouncement(["cancelling"], () => ({
        phase: "annIdle",
        sentenceIndex: 0,
        sentenceCount: 0,
        uninterruptible: false,
        claimHeld: false,
      }));
    },
    setClaimHeld(held) {
      set((state) => ({ announcement: { ...state.announcement, claimHeld: held } }));
    },
    setUninterruptible(uninterruptible) {
      set((state) => ({ announcement: { ...state.announcement, uninterruptible } }));
    },
  };
});
