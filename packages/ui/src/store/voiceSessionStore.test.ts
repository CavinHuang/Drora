import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeVoiceRecordingEscape,
  isVoiceLastDictationFresh,
  useVoiceSessionStore,
  type VoiceAnnouncementLegState,
} from "./voiceSessionStore.js";
import { VOICE_LAST_DICTATION_TTL_MS } from "@/voice/voiceTuning.js";
import { registerVoiceRecordingAbort } from "@/voice/voiceRecordingControl.js";
/**
 * 语音会话两条腿状态机迁移表守护（specs/voice-agent-integration.md §3.2 / §3.3 / §5.1 /
 * §5.2 / §5.4）。迁移全部经 guarded actions：非法迁移 no-op 返回 false/null。
 */

const initialAnnouncement: VoiceAnnouncementLegState = {
  phase: "annIdle",
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

function resetVoiceStore(): void {
  useVoiceSessionStore.setState({
    inputLeg: "idle",
    boundSessionId: null,
    partialText: "",
    notice: null,
    lastDictation: null,
    pendingFinalText: null,
    recordingPulseSeq: 0,
    recordingOwnerEntryId: null,
    announcementOwnerId: null,
    announcement: { ...initialAnnouncement },
  });
}

function startRecording(ownerEntryId = "entry-a"): void {
  expect(useVoiceSessionStore.getState().startMicRequest("session-a", ownerEntryId)).toBe(true);
  expect(useVoiceSessionStore.getState().beginRecording()).toBe(true);
}

function startSpeaking(sentenceCount: number): void {
  useVoiceSessionStore.getState().setClaimHeld(true);
  expect(useVoiceSessionStore.getState().startAnnouncement(sentenceCount)).not.toBeNull();
}

beforeEach(resetVoiceStore);

describe("输入腿：RequestingMic 段（§3.2）", () => {
  it("captures the binding session and owner entry, refusing a second entry (FD-6)", () => {
    const store = useVoiceSessionStore.getState();
    expect(store.startMicRequest("session-a", "entry-a")).toBe(true);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("requestingMic");
    expect(useVoiceSessionStore.getState().boundSessionId).toBe("session-a");
    expect(useVoiceSessionStore.getState().recordingOwnerEntryId).toBe("entry-a");
    // 主/辅 pane 同会话双 mic 入口：第二点按 no-op（§3.3 会话绑定生命周期）。
    expect(useVoiceSessionStore.getState().startMicRequest("session-a", "entry-b")).toBe(false);
    expect(useVoiceSessionStore.getState().startMicRequest("session-b", "entry-b")).toBe(false);
    expect(useVoiceSessionStore.getState().boundSessionId).toBe("session-a");
  });

  it("moves to idle on permission failure / timeout with a notice (§5.3)", () => {
    useVoiceSessionStore.getState().startMicRequest("session-a", "entry-a");
    expect(useVoiceSessionStore.getState().failMicRequest("requestingMicTimeout")).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.boundSessionId).toBeNull();
    expect(state.notice?.code).toBe("requestingMicTimeout");
  });

  it("moves to idle on user cancel without leaving a notice", () => {
    useVoiceSessionStore.getState().startMicRequest("session-a", "entry-a");
    expect(useVoiceSessionStore.getState().cancelMicRequest()).toBe(true);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().notice).toBeNull();
  });
});

describe("输入腿：Recording 段与写入规则（§5.1/§5.2）", () => {
  it("keeps partial only in the preview field and never in composer-bound fields", () => {
    startRecording();
    expect(useVoiceSessionStore.getState().setPartial("口述中的内容")).toBe(true);
    const state = useVoiceSessionStore.getState();
    // partial 唯一归宿 = partialText（预览条）；正文唯一写入通道的待注入文本与
    // lastDictation 都不携带 partial。
    expect(state.partialText).toBe("口述中的内容");
    expect(state.pendingFinalText).toBeNull();
    expect(state.lastDictation).toBeNull();
  });

  it("rejects partial updates outside Recording", () => {
    expect(useVoiceSessionStore.getState().setPartial("idle 期的 partial")).toBe(false);
    expect(useVoiceSessionStore.getState().partialText).toBe("");
  });

  it("moves a sentence final to Injecting and clears it from the preview (§5.2)", () => {
    startRecording();
    useVoiceSessionStore.getState().setPartial("第一句");
    expect(useVoiceSessionStore.getState().commitFinal("第一句")).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("injecting");
    expect(state.pendingFinalText).toBe("第一句");
    // 每句 final 注入发起即从预览条移除该句。
    expect(state.partialText).toBe("");
  });

  it("routes an empty final to idle with the aborted notice (静音超时空转写)", () => {
    startRecording();
    expect(useVoiceSessionStore.getState().commitFinal("   ")).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.pendingFinalText).toBeNull();
    expect(state.notice?.code).toBe("aborted");
  });

  it("finishes injection optimistically and stages lastDictation (§5.4)", () => {
    startRecording();
    useVoiceSessionStore.getState().commitFinal("待注入句");
    const before = Date.now();
    expect(useVoiceSessionStore.getState().finishInjection()).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.boundSessionId).toBeNull();
    expect(state.pendingFinalText).toBeNull();
    expect(state.lastDictation).toEqual({ text: "待注入句", capturedAt: before });
    // finishInjection 无 pending 时拒绝。
    expect(useVoiceSessionStore.getState().finishInjection()).toBe(false);
  });

  it("expires lastDictation after the TTL (FD-4 菜单直接消失)", () => {
    startRecording();
    useVoiceSessionStore.getState().commitFinal("转写");
    useVoiceSessionStore.getState().finishInjection();
    const capturedAt = useVoiceSessionStore.getState().lastDictation?.capturedAt ?? 0;
    expect(isVoiceLastDictationFresh(useVoiceSessionStore.getState(), capturedAt + 1)).toBe(true);
    expect(
      isVoiceLastDictationFresh(
        useVoiceSessionStore.getState(),
        capturedAt + VOICE_LAST_DICTATION_TTL_MS,
      ),
    ).toBe(true);
    expect(
      isVoiceLastDictationFresh(
        useVoiceSessionStore.getState(),
        capturedAt + VOICE_LAST_DICTATION_TTL_MS + 1,
      ),
    ).toBe(false);
  });

  it("stops recording via Esc-like paths and clears the preview", () => {
    startRecording();
    useVoiceSessionStore.getState().setPartial("半句");
    expect(useVoiceSessionStore.getState().stopRecording()).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.partialText).toBe("");
    // 非 Recording 段调用 no-op。
    expect(useVoiceSessionStore.getState().stopRecording()).toBe(false);
  });

  it("aborts on ASR errors with the mapped notice (§5.3)", () => {
    startRecording();
    useVoiceSessionStore.getState().setPartial("半句");
    expect(useVoiceSessionStore.getState().abortRecording("network")).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.notice?.code).toBe("network");
    // §5.3 network：保留已注入文本——正文已落 composer，store 无删除动作可言。
    expect(state.lastDictation).toBeNull();
  });

  it("forces stop with sessionGone notice when the bound session closes (EG-6)", () => {
    startRecording();
    useVoiceSessionStore.getState().setPartial("悬空 partial");
    expect(useVoiceSessionStore.getState().notifyBoundSessionClosed()).toBe(true);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.boundSessionId).toBeNull();
    // partial 丢弃 + 轻提示。
    expect(state.partialText).toBe("");
    expect(state.notice?.code).toBe("sessionGone");
  });

  it("clears the staged dictation on restore success (FD-4)", () => {
    startRecording();
    useVoiceSessionStore.getState().commitFinal("转写");
    useVoiceSessionStore.getState().finishInjection();
    useVoiceSessionStore.getState().clearLastDictation();
    expect(useVoiceSessionStore.getState().lastDictation).toBeNull();
  });

  it("pulses the recording indicator when a second mic entry is refused (FD-6)", () => {
    startRecording("entry-a");
    expect(useVoiceSessionStore.getState().recordingPulseSeq).toBe(0);
    // 同会话第二入口（entry-b）与异会话入口点按：no-op + 脉冲递增，持有者不变。
    expect(useVoiceSessionStore.getState().startMicRequest("session-a", "entry-b")).toBe(false);
    expect(useVoiceSessionStore.getState().startMicRequest("session-b", "entry-b")).toBe(false);
    expect(useVoiceSessionStore.getState().recordingPulseSeq).toBe(2);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().recordingOwnerEntryId).toBe("entry-a");
    // 非 recording 态（idle）的点按是正常新请求：成功且不脉冲。
    useVoiceSessionStore.getState().stopRecording();
    expect(useVoiceSessionStore.getState().startMicRequest("session-b", "entry-b")).toBe(true);
    expect(useVoiceSessionStore.getState().recordingPulseSeq).toBe(2);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("requestingMic");
  });

  it("consumes Esc only while recording (§4.4 键位仲裁优先级 3)", () => {
    // 非录音态：不消费，既有语义（停生成/onCancel）不变。
    expect(consumeVoiceRecordingEscape()).toBe(false);
    startRecording();
    const unregister = registerVoiceRecordingAbort("entry-a", () => {
      useVoiceSessionStore.getState().abortRecording();
    });
    expect(consumeVoiceRecordingEscape()).toBe(true);
    unregister();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().partialText).toBe("");
    // 消费后回到非录音态，再次 Esc 不再归录音。
    expect(consumeVoiceRecordingEscape()).toBe(false);
  });
});

describe("播报腿迁移表（§3.2/§3.3/§4.7）", () => {
  it("gates Speaking on claim holding and input leg not Recording (§3.2)", () => {
    // 未持 claim：拒绝。
    expect(useVoiceSessionStore.getState().startAnnouncement(3)).toBeNull();
    // 持 claim 但输入腿 Recording：拒绝（Recording 优先，§3.3）。
    useVoiceSessionStore.getState().setClaimHeld(true);
    startRecording();
    expect(useVoiceSessionStore.getState().startAnnouncement(3)).toBeNull();
  });

  it("rejects an empty sentence queue", () => {
    useVoiceSessionStore.getState().setClaimHeld(true);
    expect(useVoiceSessionStore.getState().startAnnouncement(0)).toBeNull();
  });

  it("advances sentence by sentence and releases the claim after the last one (§3.5-4)", () => {
    startSpeaking(3);
    let leg = useVoiceSessionStore.getState().announcement;
    expect(leg.phase).toBe("speaking");
    expect(leg.sentenceIndex).toBe(0);
    leg = useVoiceSessionStore.getState().sentenceCompleted() ?? leg;
    expect(leg.phase).toBe("speaking");
    expect(leg.sentenceIndex).toBe(1);
    leg = useVoiceSessionStore.getState().sentenceCompleted() ?? leg;
    expect(leg.sentenceIndex).toBe(2);
    leg = useVoiceSessionStore.getState().sentenceCompleted() ?? leg;
    // 最后一句播完 → AnnIdle + claim 释放。
    expect(leg.phase).toBe("annIdle");
    expect(leg.claimHeld).toBe(false);
    expect(useVoiceSessionStore.getState().sentenceCompleted()).toBeNull();
  });

  it("applies the pause at the sentence boundary and keeps the claim (§4.7 / FD-2)", () => {
    startSpeaking(3);
    useVoiceSessionStore.getState().sentenceCompleted(); // index=1
    expect(useVoiceSessionStore.getState().markPauseRequested()).not.toBeNull();
    // 句界前撤销（录音极短）：恢复正常续播。
    expect(useVoiceSessionStore.getState().clearPauseRequested()).not.toBeNull();
    expect(useVoiceSessionStore.getState().announcement.pauseRequested).toBe(false);
    // 重新请求 → 当前句播完入 AnnPaused，句序号记为下一句边界。
    expect(useVoiceSessionStore.getState().markPauseRequested()).not.toBeNull();
    const leg = useVoiceSessionStore.getState().sentenceCompleted();
    expect(leg?.phase).toBe("annPaused");
    expect(leg?.sentenceIndex).toBe(2);
    // FD-2：AnnPaused 是持约态非释放点。
    expect(leg?.claimHeld).toBe(true);
    // 句推进在 AnnPaused 无效。
    expect(useVoiceSessionStore.getState().sentenceCompleted()).toBeNull();
  });

  it("resumes from the next sentence boundary only while the claim is held (§3.2)", () => {
    startSpeaking(3);
    useVoiceSessionStore.getState().markPauseRequested();
    useVoiceSessionStore.getState().sentenceCompleted();
    // claim 被清（如 renew 校正前的一致性场景）→ 拒绝续播。
    useVoiceSessionStore.getState().setClaimHeld(false);
    expect(useVoiceSessionStore.getState().resumeAnnouncement()).toBeNull();
    useVoiceSessionStore.getState().setClaimHeld(true);
    const leg = useVoiceSessionStore.getState().resumeAnnouncement();
    expect(leg?.phase).toBe("speaking");
    expect(leg?.sentenceIndex).toBe(1);
    // Speaking 段 resume 非法。
    expect(useVoiceSessionStore.getState().resumeAnnouncement()).toBeNull();
  });

  it("cancels from any announcing state; refuses only the interrupt word inside uninterruptible (§3.3)", () => {
    startSpeaking(2);
    useVoiceSessionStore.getState().setUninterruptible(true);
    // 点按通道不受 uninterruptible 约束（FD-1：紧急静音永远可即时达成）。
    const pressed = useVoiceSessionStore.getState().cancelAnnouncement("stopPressed");
    expect(pressed?.phase).toBe("annIdle");
    expect(pressed?.claimHeld).toBe(false);

    startSpeaking(2);
    useVoiceSessionStore.getState().setUninterruptible(true);
    // 打断词通道在 uninterruptible 段内被拒绝（防回声与播报正文字误触发）。
    expect(useVoiceSessionStore.getState().cancelAnnouncement("interruptWord")).toBeNull();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    useVoiceSessionStore.getState().setUninterruptible(false);
    expect(useVoiceSessionStore.getState().cancelAnnouncement("interruptWord")?.phase).toBe(
      "annIdle",
    );
    // AnnIdle 段 cancel no-op。
    expect(useVoiceSessionStore.getState().cancelAnnouncement("stopPressed")).toBeNull();
  });

  it("cancels from AnnPaused (作废续播意图) regardless of uninterruptible claim semantics", () => {
    startSpeaking(2);
    useVoiceSessionStore.getState().markPauseRequested();
    useVoiceSessionStore.getState().sentenceCompleted();
    expect(useVoiceSessionStore.getState().cancelAnnouncement("claimLost")?.phase).toBe("annIdle");
  });

  it("routes task cancellation through Cancelling and settles back to AnnIdle (§3.2)", () => {
    // AnnIdle 段无播报可静音：拒绝（层③仍由 planner 直发 v4 stop）。
    expect(useVoiceSessionStore.getState().beginTaskCancel()).toBeNull();
    startSpeaking(2);
    expect(useVoiceSessionStore.getState().beginTaskCancel()?.phase).toBe("cancelling");
    // Cancelling 段普通 cancel 仍可（点按语义）→ 不适用：点按走 settle 路径，此处验证幂等。
    expect(useVoiceSessionStore.getState().beginTaskCancel()).toBeNull();
    const leg = useVoiceSessionStore.getState().settleTaskCancel();
    expect(leg?.phase).toBe("annIdle");
    expect(leg?.sentenceCount).toBe(0);
    // 非 Cancelling 段 settle 非法。
    expect(useVoiceSessionStore.getState().settleTaskCancel()).toBeNull();
  });

  it("keeps the two legs independent except for the Recording gate (§3.3)", () => {
    startSpeaking(2);
    startRecording();
    // 录音开始不改变播报腿快照；暂停经 planner 显式请求（§4.7 当前句播完即停）。
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    expect(useVoiceSessionStore.getState().markPauseRequested()).not.toBeNull();
    // 录音中播报腿推进（当前句播完）→ AnnPaused，输入腿不受影响。
    const leg = useVoiceSessionStore.getState().sentenceCompleted();
    expect(leg?.phase).toBe("annPaused");
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
  });
});
