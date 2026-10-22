import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
} from "./turnSpeechPlanner.js";
import type { VoiceAnnouncementClaimPort } from "./voiceAnnouncementClaim.js";
import type {
  VoiceTtsDoneReason,
  VoiceTtsHandle,
  VoiceTtsPort,
  VoiceTtsUtterance,
} from "./voiceTtsPort.js";
import { useVoiceSessionStore, type VoiceAnnouncementLegState } from "@/store/voiceSessionStore.js";

/**
 * 播报规划器·权限段与打断/取消面（specs/voice-agent-integration.md §4.1 / FD-3 / §3.3
 * uninterruptible / §3.2 Cancelling）：从 turnSpeechPlanner.test.ts 拆出（max-file-lines），
 * 装配方式相同——fake TTS/claim + 真 voiceSessionStore 受控面。
 */

class FakeTts implements VoiceTtsPort {
  readonly spoken: VoiceTtsUtterance[] = [];
  private counter = 0;
  private doneCb: ((handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void) | null = null;
  private lastHandle: VoiceTtsHandle | null = null;
  cancelCount = 0;

  speak(u: VoiceTtsUtterance): VoiceTtsHandle {
    const handle = { utteranceId: `utt-${(this.counter += 1)}` };
    this.spoken.push(u);
    this.lastHandle = handle;
    return handle;
  }

  cancel(): void {
    this.cancelCount += 1;
    this.lastHandle = null;
  }

  onDone(cb: (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void): () => void {
    this.doneCb = cb;
    return () => {
      this.doneCb = null;
    };
  }

  finishCurrent(reason: VoiceTtsDoneReason = "end"): void {
    const handle = this.lastHandle;
    if (!handle) {
      throw new Error("no live utterance to finish");
    }
    this.lastHandle = null;
    this.doneCb?.(handle, reason);
  }
}

class FakeClaim implements VoiceAnnouncementClaimPort {
  acquireResult = true;
  renewResult = true;
  acquireCalls = 0;
  renewCalls = 0;
  releaseCalls = 0;

  async acquire(): Promise<boolean> {
    this.acquireCalls += 1;
    return this.acquireResult;
  }

  async renew(): Promise<boolean> {
    this.renewCalls += 1;
    return this.renewResult;
  }

  release(): void {
    this.releaseCalls += 1;
  }
}

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
    announcement: { ...initialAnnouncement },
  });
}

interface Harness {
  tts: FakeTts;
  claim: FakeClaim;
  cancelTask: ReturnType<typeof vi.fn<() => void>>;
  planner: ReturnType<typeof createTurnSpeechPlanner>;
  setFocusedTail(tail: { turnId: string; text: string } | null): void;
}

function createHarness(): Harness {
  let focusedTail: { turnId: string; text: string } | null = null;
  const tts = new FakeTts();
  const claim = new FakeClaim();
  const cancelTask = vi.fn<() => void>();
  const planner = createTurnSpeechPlanner({
    getFocusedTurnTail: () => focusedTail,
    tts,
    claim,
    isAnnouncementEnabled: () => true,
    announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
    getAnnouncementVoiceConfig: () => ({ lang: "zh-CN", rate: 1 }),
    cancelTask,
  });
  return {
    tts,
    claim,
    cancelTask,
    planner,
    setFocusedTail: (tail) => {
      focusedTail = tail;
    },
  };
}

beforeEach(() => {
  resetVoiceStore();
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("权限内容段（§4.1 / FD-3 / §3.3 uninterruptible）", () => {
  it("speaks a permission segment immediately from AnnIdle as uninterruptible", async () => {
    const h = createHarness();
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "Bash: 要运行命令吗？" });
    await flushMicrotasks();
    // AnnIdle 立即起播（仅权限段）；§3.3 整段 uninterruptible。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["Bash: 要运行命令吗？"]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      uninterruptible: true,
      sentenceCount: 1,
    });
    // 播完回正文外 → uninterruptible 解除、回 AnnIdle 释放 claim。
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      uninterruptible: false,
    });
  });

  it("yields at the sentence boundary and splices before remaining body sentences (FD-3 句粒度让位)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "t1", text: "正文一。正文二。正文三。" });
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。"]);
    // 正文播报中权限到达：当前句播完后插队，余下正文句排在权限段之后。
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限问题？" });
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "权限问题？"]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      uninterruptible: true,
      sentenceCount: 4,
      // 权限句（下标 1）在播中：正文一完成时句序号推进到 1，未再推进。
      sentenceIndex: 1,
    });
    // 权限段播完回到正文句：uninterruptible 解除，正文按原顺序继续。
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "权限问题？", "正文二。"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(false);
    h.tts.finishCurrent("end");
    expect(h.tts.spoken[h.tts.spoken.length - 1]?.text).toBe("正文三。");
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("plays consecutive permission segments back-to-back (§4.1 段间不开放正文)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "t1", text: "正文一。正文二。" });
    await flushMicrotasks();
    // 两段权限都在正文一句播报中到达：正文一完成边界一次性背靠背拼接。
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    h.planner.consumePermissionSegment({ permissionId: "p2", text: "权限乙？" });
    h.tts.finishCurrent("end");
    // 正文一完成边界：两段权限背靠背拼接，先播甲（乙在队列中）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "权限甲？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    h.tts.finishCurrent("end");
    expect(h.tts.spoken[h.tts.spoken.length - 1]?.text).toBe("权限乙？");
    // 段间句隙不开放正文：甲播完后紧接乙（uninterruptible 贯穿整段拼接窗口）。
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    h.tts.finishCurrent("end");
    expect(h.tts.spoken[h.tts.spoken.length - 1]?.text).toBe("正文二。");
  });

  it("drains permission segments that arrived during the last body sentence (FD-3 权限不丢)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "t1", text: "正文一。正文二。" });
    await flushMicrotasks();
    h.tts.finishCurrent("end"); // 正文二 在播
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "正文二。"]);
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "末句权限？" });
    h.tts.finishCurrent("end"); // 正文队列已尽 → AnnIdle → 权限段起播排空
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "正文二。", "末句权限？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      uninterruptible: false,
    });
  });

  it("deduplicates by permission id", async () => {
    const h = createHarness();
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(1);
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("holds the segment while recording and plays it at the resume boundary (FD-3 优先于顺延正文)", async () => {
    const h = createHarness();
    h.setFocusedTail({ turnId: "t1", text: "顺延正文。" });
    h.planner.notifyUserRecordingStarted();
    h.planner.consumeTurnTail({ turnId: "t1", text: "顺延正文。" });
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "录音中权限？" });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // 顺延起播边界先插权限段（权限 > 正文）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["录音中权限？"]);
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["录音中权限？", "顺延正文。"]);
  });

  it("does not announce a permission segment when announcement is disabled", async () => {
    let enabled = false;
    const tts = new FakeTts();
    const claim = new FakeClaim();
    const planner = createTurnSpeechPlanner({
      getFocusedTurnTail: () => null,
      tts,
      claim,
      isAnnouncementEnabled: () => enabled,
      announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
    });
    planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    await flushMicrotasks();
    expect(tts.spoken).toHaveLength(0);
  });
});

describe("外部停止面静音（§3.3 FD-1：播报同步静音经 Cancelling）", () => {
  it("notifyExternalTaskStop mutes via Cancelling without dispatching cancelTask", async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      h.planner.consumeTurnTail({ turnId: "t1", text: "甲。" });
      await vi.advanceTimersByTimeAsync(0);
      const cancelCallsBefore = h.cancelTask.mock.calls.length;
      h.planner.notifyExternalTaskStop();
      // 停止面已发过 v4 stop：本路径不重复分发（FD-1 对照断言）。
      expect(h.cancelTask.mock.calls.length).toBe(cancelCallsBefore);
      expect(h.tts.cancelCount).toBeGreaterThanOrEqual(1);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");
      // TurnComplete(cancelled) 终态到达 → AnnIdle 不再播。
      h.planner.consumeTurnTail({ turnId: "t1", text: "已取消" });
      await vi.advanceTimersByTimeAsync(0);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
      expect(h.tts.spoken.map((u) => u.text)).toEqual(["甲。"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to AnnIdle after the cancelling timeout without TurnComplete", async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      h.planner.consumeTurnTail({ turnId: "t1", text: "甲。" });
      await vi.advanceTimersByTimeAsync(0);
      h.planner.notifyExternalTaskStop();
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(useVoiceSessionStore.getState().announcement).toMatchObject({
        phase: "annIdle",
        uninterruptible: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
