import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
} from "./turnSpeechPlanner.js";
import type {
  VoiceAnnouncementClaimPort,
  VoiceAnnouncementLease,
} from "./voiceAnnouncementClaim.js";
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

  async acquire(): Promise<VoiceAnnouncementLease | null> {
    this.acquireCalls += 1;
    return this.acquireResult ? { key: "k", token: "fake-lease" } : null;
  }

  async renew(lease: VoiceAnnouncementLease): Promise<VoiceAnnouncementLease | null> {
    this.renewCalls += 1;
    return this.renewResult ? lease : null;
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
    announcementOwnerId: null,
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

describe("工具简报插播时机（§4.2-5 / FD-3 权限>正文>简报 / §9.6.7-1）", () => {
  it("AnnIdle 空闲插播：简报作为独立单句起播（claim 正常获取）", async () => {
    const harness = createHarness();
    harness.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正在 Edit a.ts"]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      uninterruptible: false,
      sentenceCount: 1,
    });
    harness.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("正文句间插播且无待播权限段：简报排在权限段之后、正文余句之前", async () => {
    const harness = createHarness();
    harness.planner.consumeTurnTail({ turnId: "t1", text: "正文一。正文二。" });
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正文一。"]);
    // 无权限段排队：简报进句界拼接（权限段之后、正文二之前）。
    harness.planner.consumeBriefSegment("brief-1", "正在 Bash build");
    harness.tts.finishCurrent("end");
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "正在 Bash build"]);
    // 简报不置 uninterruptible（可被打断词通道打断）。
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(false);
    harness.tts.finishCurrent("end");
    expect(harness.tts.spoken.map((u) => u.text)).toEqual([
      "正文一。",
      "正在 Bash build",
      "正文二。",
    ]);
    harness.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("权限段待插队列非空 → 简报推迟到权限段之后（FD-3：权限>简报，不丢弃）", async () => {
    const harness = createHarness();
    harness.planner.consumeTurnTail({ turnId: "t1", text: "正文一。" });
    await new Promise((r) => setTimeout(r, 0));
    // 权限段先排入待插队列（正文句播报中），随后简报到达。
    harness.planner.consumePermissionSegment({ permissionId: "p1", text: "权限问题？" });
    harness.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    harness.tts.finishCurrent("end");
    await new Promise((r) => setTimeout(r, 0));
    // 权限段须实际完成，最低优先级简报才能开始，不能仅因正文结束就越过权限段。
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "权限问题？"]);
    harness.tts.finishCurrent("end");
    await new Promise((r) => setTimeout(r, 0));
    // 权限段拼接优先；简报不丢弃，推迟到权限段播完后的空闲排空（§4.2-5 段间句隙不插）。
    expect(harness.tts.spoken.map((u) => u.text)).toEqual([
      "正文一。",
      "权限问题？",
      "正在 Edit a.ts",
    ]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(false);
  });

  it("录音中（recording/annPaused）简报丢弃（避免与用户语音叠音）", async () => {
    const harness = createHarness();
    harness.planner.consumeTurnTail({ turnId: "t1", text: "甲。乙。" });
    await new Promise((r) => setTimeout(r, 0));
    harness.planner.notifyUserRecordingStarted();
    harness.tts.finishCurrent("end"); // → annPaused
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");
    harness.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    // 简报在 annPaused 被丢弃：录音结束后不补播。
    harness.planner.notifyUserRecordingEnded();
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["甲。"]);
  });

  it("briefId 幂等（重复简报只播一次）", async () => {
    const harness = createHarness();
    harness.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    harness.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    await new Promise((r) => setTimeout(r, 0));
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正在 Edit a.ts"]);
    harness.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
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

it("same owner replacing text during renewal adopts the renewed lease (§9.8)", async () => {
  vi.useFakeTimers();
  const h = createHarness();
  let finish: ((lease: VoiceAnnouncementLease | null) => void) | undefined;
  h.claim.renew = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const release = vi.spyOn(h.claim, "release");
  try {
    h.planner.consumeTurnTail({ turnId: "a", text: "A。" });
    await vi.advanceTimersByTimeAsync(2000);
    h.planner.consumeTurnTail({ turnId: "b", text: "B。" });
    await vi.advanceTimersByTimeAsync(0);
    const renewed = { key: "k", token: "same-owner-renewed" };
    finish?.(renewed);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).not.toHaveBeenCalledWith(renewed);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
  } finally {
    h.planner.dispose();
    vi.useRealTimers();
  }
});
