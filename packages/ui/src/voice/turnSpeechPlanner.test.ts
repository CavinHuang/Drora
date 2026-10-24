import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTurnSpeechText,
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
  splitTurnIntoSentences,
  type AnnouncementLegControl,
  type TurnSpeechPlanner,
  type TurnSpeechPlannerDeps,
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
 * 播报规划器守护（specs/voice-agent-integration.md §2.3 / §3.2 播报腿 / §3.3 顺延规则 /
 * §4.1 同源聚合 / §4.7 句粒度 / §3.5 claim）。
 *
 * 装配：fake TTS / fake claim + 真 voiceSessionStore（经 createVoiceSessionAnnouncementControl
 * 适配）——迁移守卫跑的是生产迁移表，不是测试复制品。句推进经 FakeTts.finishCurrent 驱动
 * 真实 tts.onDone 链路。
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

  /** 测试驱动：最近一次 speak 的句按给定原因结算（end/error 走 planner 的句推进链）。 */
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
    announcement: { ...initialAnnouncement },
  });
}

interface Harness {
  tts: FakeTts;
  claim: FakeClaim;
  cancelTask: ReturnType<typeof vi.fn<() => void>>;
  planner: TurnSpeechPlanner;
  setFocusedTail(tail: { turnId: string; text: string } | null): void;
}

function createHarness(
  overrides?: Partial<Pick<TurnSpeechPlannerDeps, "claimRenewIntervalMs" | "cancellingFallbackTimeoutMs">>,
): Harness {
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
    ...overrides,
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

/** flush 微任务（claim acquire/renew 的异步链）。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** 依次结算在播句直到队列播完；返回每次 speak 到的文本序列快照。 */
function speakAll(h: Harness): string[] {
  while (useVoiceSessionStore.getState().announcement.phase === "speaking") {
    const before = h.tts.spoken.length;
    h.tts.finishCurrent("end");
    if (h.tts.spoken.length === before) {
      break; // 防御：推进未产生新句（最后一句播完入 annIdle）。
    }
  }
  return h.tts.spoken.map((u) => u.text);
}

beforeEach(() => {
  resetVoiceStore();
});

describe("句边界切分与同源聚合（§4.1）", () => {
  it("splits on terminal punctuation and keeps closers attached", () => {
    expect(splitTurnIntoSentences("第一句。第二句！第三句？结尾无标点")).toEqual([
      "第一句。",
      "第二句！",
      "第三句？",
      "结尾无标点",
    ]);
    expect(splitTurnIntoSentences("他说：「好。」走！")).toEqual(["他说：「好。」", "走！"]);
    expect(splitTurnIntoSentences("先做 a；再做 b;\n新行开始")).toEqual([
      "先做 a；",
      "再做 b;",
      "新行开始",
    ]);
  });

  it("protects decimals from splitting", () => {
    expect(splitTurnIntoSentences("版本 3.14 已发布。下一句")).toEqual([
      "版本 3.14 已发布。",
      "下一句",
    ]);
  });

  it("hard-splits overlong segments at the tuning bound", () => {
    const segments = splitTurnIntoSentences("a".repeat(250));
    expect(segments).toHaveLength(3);
    expect(segments[0]?.length).toBe(120);
    expect(segments[2]?.length).toBe(10);
  });

  it("aggregates turn text with the same join chain as assistantCopyText (§4.1 同源)", () => {
    // 与 packages/ui/src/v4/assistantPreviewCards.ts:34-37 同链：map(text) → 滤空 → join("\n\n")。
    const rows = [{ text: "第一段" }, { text: "   " }, { text: "第二段" }];
    expect(buildTurnSpeechText(rows)).toBe("第一段\n\n第二段");
  });
});

describe("轮尾播报主流程（§3.2 AnnIdle→Speaking）", () => {
  it("speaks the aggregated tail sentence by sentence, whole equal to the copy text", async () => {
    const h = createHarness();
    const rows = [{ text: "第一段。" }, { text: "第二段！" }];
    const tailText = buildTurnSpeechText(rows);
    h.setFocusedTail({ turnId: "turn-1", text: tailText });

    h.planner.consumeTurnTail({ turnId: "turn-1", text: tailText });
    await flushMicrotasks();

    // 起播第一句；§3.2 进入条件全部落在 store 守卫（claim + 输入腿）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["第一段。"]);
    expect(h.tts.spoken[0]?.lang).toBe("zh-CN");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      sentenceIndex: 0,
      sentenceCount: 2,
      claimHeld: true,
    });
    expect(h.claim.acquireCalls).toBe(1);

    // §9.3 验收：逐句播报的全文 === 聚合文本（与复制文本一致）。
    const spokenTexts = speakAll(h);
    expect(spokenTexts).toEqual(["第一段。", "第二段！"]);
    expect(spokenTexts.join("")).toBe(tailText.replace("\n\n", ""));
    // 播完 → AnnIdle + claim release（§3.5-4）。
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(h.claim.releaseCalls).toBeGreaterThanOrEqual(1);
  });

  it("skips a failed sentence and keeps advancing (§7.1 吞异常落 warn)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.tts.finishCurrent("error");
    await flushMicrotasks();
    // error 不中断播报：坏句跳过、下一句继续。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["甲。", "乙。"]);
  });

  it("stays silent when another window holds the claim (§3.3 单播报者)", async () => {
    const h = createHarness();
    h.claim.acquireResult = false;
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "内容。" });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("does nothing when announcement is disabled (reader 收口)", async () => {
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
    planner.consumeTurnTail({ turnId: "turn-1", text: "内容。" });
    await flushMicrotasks();
    expect(tts.spoken).toHaveLength(0);
    expect(claim.acquireCalls).toBe(0);

    // 播报开启后才消费轮尾（§6.1 播报总开关默认关）。
    enabled = true;
    planner.consumeTurnTail({ turnId: "turn-2", text: "内容。" });
    await flushMicrotasks();
    expect(tts.spoken).toHaveLength(1);
  });

  it("ignores empty tails", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "   " });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
    expect(h.claim.acquireCalls).toBe(0);
  });

  it("replaces an in-flight announcement with the newest tail (§3.3 只播最新)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "旧的一。" });
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["旧的一。"]);

    h.planner.consumeTurnTail({ turnId: "turn-2", text: "新的甲。新的乙。" });
    await flushMicrotasks();
    // 旧句被 cancel，新轮尾从句 0 起播（§3.3：不排队多轮）。
    expect(h.tts.cancelCount).toBeGreaterThanOrEqual(1);
    expect(h.tts.spoken[h.tts.spoken.length - 1]?.text).toBe("新的甲。");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      sentenceIndex: 0,
      sentenceCount: 2,
    });
  });
});

describe("输入腿互斥与句粒度暂停续播（§3.3 / §4.7）", () => {
  it("defers the tail during recording and starts it on recording end (顺延)", async () => {
    const h = createHarness();
    h.setFocusedTail({ turnId: "turn-1", text: "顺延的一。顺延的二。" });

    h.planner.notifyUserRecordingStarted();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "顺延的一。顺延的二。" });
    await flushMicrotasks();
    // Recording 优先：不播、不抢 claim（§3.3）。
    expect(h.tts.spoken).toHaveLength(0);
    expect(h.claim.acquireCalls).toBe(0);

    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // 起播第一句，其余句经句边界推进（§3.3 顺延起播）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["顺延的一。"]);
    expect(speakAll(h)).toEqual(["顺延的一。", "顺延的二。"]);
  });

  it("pauses at the sentence boundary and resumes from the next one (§4.7)", async () => {
    const h = createHarness();
    h.setFocusedTail({ turnId: "turn-1", text: "甲。乙。丙。" });
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。丙。" });
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["甲。"]);

    // 第一句播完 → index=1（下一句边界）。
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.sentenceIndex).toBe(1);

    // 录音开始：当前句（乙）播完即停——不是立即 cancel（§4.7 最坏一句时长延迟）。
    h.planner.notifyUserRecordingStarted();
    expect(h.tts.cancelCount).toBe(0);
    h.tts.finishCurrent("end");
    const leg = useVoiceSessionStore.getState().announcement;
    expect(leg).toMatchObject({ phase: "annPaused", sentenceIndex: 2, claimHeld: true });

    // 录音结束，轮尾仍最新 → 自下一句边界续播丙。
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    expect(h.tts.spoken[h.tts.spoken.length - 1]?.text).toBe("丙。");
  });

  it("revokes a pause requested within the same sentence (录音短于一句)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.tts.finishCurrent("end");
    h.planner.notifyUserRecordingStarted();
    h.planner.notifyUserRecordingEnded();
    // 暂停请求被撤销：当前句播完正常推进，不入 AnnPaused。
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("discards a superseded deferred tail and speaks only the newest (§3.3)", async () => {
    const h = createHarness();
    h.planner.notifyUserRecordingStarted();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "旧内容。" });
    await flushMicrotasks();

    // 录音期间 focused 轮尾已更新为 turn-2。
    h.setFocusedTail({ turnId: "turn-2", text: "最新内容。" });
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // 旧轮尾作废，只播最新。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["最新内容。"]);
  });

  it("supersedes the in-progress queue when focus moved to another tail during recording (§3.4)", async () => {
    const h = createHarness();
    h.setFocusedTail({ turnId: "turn-1", text: "甲。乙。" });
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.tts.finishCurrent("end");
    h.planner.notifyUserRecordingStarted();
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");

    // 录音期间无新轮尾，但 focused 已切到另一会话/轮尾 → 在播队列作废，只播最新 focused 轮尾。
    h.setFocusedTail({ turnId: "turn-2", text: "最新内容。" });
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["甲。", "乙。", "最新内容。"]);
  });

  it("drops the deferred tail when focus is gone after recording", async () => {
    const h = createHarness();
    h.planner.notifyUserRecordingStarted();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "内容。" });
    h.setFocusedTail(null);
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
  });

  it("never starts speaking while the input leg is Recording (§3.3 Recording 优先)", async () => {
    const h = createHarness();
    // 输入腿经 store 动作进入 Recording（§3.1 状态所有者）。
    expect(useVoiceSessionStore.getState().startMicRequest("session-a", "entry-a")).toBe(true);
    expect(useVoiceSessionStore.getState().beginRecording()).toBe(true);
    h.planner.notifyUserRecordingStarted();
    useVoiceSessionStore.getState().setClaimHeld(true);
    // 即便 claim 已持有，Recording 期 startSpeaking 被 store 守卫拒绝。
    expect(useVoiceSessionStore.getState().startAnnouncement(1)).toBeNull();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "内容。" });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
    h.planner.dispose();
  });
});

describe("停止面消歧（§3.3 FD-1）与打断词（§4.5/§4.8）", () => {
  it("stop pressed silences any speaking state immediately without touching the task", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.planner.notifyStopPressed();
    // 层①：立即 cancel 回 AnnIdle；零协议（cancelTask 未被调用）。
    expect(h.tts.cancelCount).toBeGreaterThanOrEqual(1);
    expect(h.cancelTask).not.toHaveBeenCalled();
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(h.claim.releaseCalls).toBeGreaterThanOrEqual(1);
  });

  it("stop pressed works while AnnPaused and drops the resume intent (FD-1)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.tts.finishCurrent("end");
    h.planner.notifyUserRecordingStarted();
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");
    // 点按播报指示停止按钮不受句边界约束（§4.7 FD-1：紧急静音永远可即时达成）。
    h.planner.notifyStopPressed();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    // 录音结束后不再续播（作废）。
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(2);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("interrupt word hit stops the announcement and never resumes", async () => {
    const h = createHarness();
    h.setFocusedTail({ turnId: "turn-1", text: "甲。乙。" });
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
    await flushMicrotasks();
    h.tts.finishCurrent("end");
    h.planner.notifyUserRecordingStarted();
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");
    // §5.1：AnnPaused 场景下「停」必须生效（层①停播报不续播）。
    h.planner.notifyInterruptWordHit();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(h.tts.cancelCount).toBeGreaterThanOrEqual(1);
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(2);
  });

  it("interrupt word hit is refused inside an uninterruptible segment (§3.3)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。" });
    await flushMicrotasks();
    // Phase 1b 权限段置位；守卫本批已在 store 侧生效。
    useVoiceSessionStore.getState().setUninterruptible(true);
    h.planner.notifyInterruptWordHit();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    expect(h.tts.cancelCount).toBe(0);
    // 点按通道不受限。
    h.planner.notifyStopPressed();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });
});

describe("层③「停掉任务」（§4.8 / §3.3 Cancelling 兜底）", () => {
  function createBarePlanner(
    tts: FakeTts,
    claim: FakeClaim,
    cancelTask: ReturnType<typeof vi.fn<() => void>>,
    overrides?: Partial<TurnSpeechPlannerDeps>,
  ): TurnSpeechPlanner {
    return createTurnSpeechPlanner({
      getFocusedTurnTail: () => null,
      tts,
      claim,
      isAnnouncementEnabled: () => true,
      announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
      cancelTask,
      ...overrides,
    });
  }

  it("silences the announcement and routes through Cancelling; TurnComplete settles it", async () => {
    vi.useFakeTimers();
    try {
      const tts = new FakeTts();
      const claim = new FakeClaim();
      const cancelTask = vi.fn<() => void>();
      const planner = createBarePlanner(tts, claim, cancelTask, {
        cancellingFallbackTimeoutMs: 5_000,
      });
      planner.consumeTurnTail({ turnId: "turn-1", text: "甲。" });
      await vi.advanceTimersByTimeAsync(0);
      expect(tts.spoken.map((u) => u.text)).toEqual(["甲。"]);

      planner.requestCancelTask();
      // 层③：发既有 v4 stop（dep 调用）+ 播报同步静音入 Cancelling。
      expect(cancelTask).toHaveBeenCalledTimes(1);
      expect(tts.cancelCount).toBeGreaterThanOrEqual(1);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");

      // TurnComplete(cancelled) 完成信号 → AnnIdle 且不再播（§3.2 Cancelling 出边）。
      planner.consumeTurnTail({ turnId: "turn-1", text: "已取消" });
      await vi.advanceTimersByTimeAsync(0);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
      expect(tts.spoken.map((u) => u.text)).toEqual(["甲。"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles Cancelling on TurnComplete even while the input leg is recording (录音中取消终态不被顺延吞掉)", async () => {
    vi.useFakeTimers();
    try {
      const tts = new FakeTts();
      const claim = new FakeClaim();
      const cancelTask = vi.fn<() => void>();
      const planner = createBarePlanner(tts, claim, cancelTask, {
        cancellingFallbackTimeoutMs: 5_000,
      });
      planner.consumeTurnTail({ turnId: "t1", text: "甲。" });
      await vi.advanceTimersByTimeAsync(0);
      planner.requestCancelTask();
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");
      // 录音开始（顺延标记置位）后 TurnComplete(cancelled) 到达：终态判定必须先于顺延。
      planner.notifyUserRecordingStarted();
      planner.consumeTurnTail({ turnId: "t1", text: "已取消" });
      await vi.advanceTimersByTimeAsync(0);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to AnnIdle after 5s without TurnComplete (§3.3 兜底)", async () => {
    vi.useFakeTimers();
    try {
      const tts = new FakeTts();
      const claim = new FakeClaim();
      const cancelTask = vi.fn<() => void>();
      const planner = createBarePlanner(tts, claim, cancelTask, {
        cancellingFallbackTimeoutMs: 5_000,
      });
      planner.consumeTurnTail({ turnId: "turn-1", text: "甲。" });
      await vi.advanceTimersByTimeAsync(0);
      planner.requestCancelTask();
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");

      await vi.advanceTimersByTimeAsync(5_000);
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
      expect(claim.releaseCalls).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches cancelTask even when the announcement leg is idle (§4.3/§4.8 层③与播报态无关)", () => {
    // 播报关闭/AnnIdle 时口述「停掉任务」仍须生效；多 pane 双发由 handleStop 的
    // canStop 守卫逐 pane 挡住，同会话残余双发落在 guard.stopTargetChanged 防误杀。
    const tts = new FakeTts();
    const claim = new FakeClaim();
    const cancelTask = vi.fn<() => void>();
    const planner = createBarePlanner(tts, claim, cancelTask);
    planner.requestCancelTask();
    expect(cancelTask).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });
});

describe("claim 续约与被抢校正（§3.5 / FD-2）", () => {
  it("renews while speaking and while AnnPaused; reverts to AnnIdle when lost", async () => {
    vi.useFakeTimers();
    try {
      const tts = new FakeTts();
      const claim = new FakeClaim();
      const control: AnnouncementLegControl = createVoiceSessionAnnouncementControl(
        useVoiceSessionStore,
      );
      const planner = createTurnSpeechPlanner({
        getFocusedTurnTail: () => null,
        tts,
        claim,
        isAnnouncementEnabled: () => true,
        announcementControl: control,
        claimRenewIntervalMs: 2_000,
      });
      planner.consumeTurnTail({ turnId: "turn-1", text: "甲。乙。" });
      await vi.advanceTimersByTimeAsync(0);
      expect(claim.renewCalls).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(claim.renewCalls).toBe(1);

      // FD-2：AnnPaused 是持约态——续约照常。
      planner.notifyUserRecordingStarted();
      tts.finishCurrent("end");
      expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(claim.renewCalls).toBe(2);

      // §3.5-3 漂移校正以 claim 为准：renew=false → 立即 cancel 回 AnnIdle，作废续播意图。
      claim.renewResult = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(useVoiceSessionStore.getState().announcement).toMatchObject({
        phase: "annIdle",
        claimHeld: false,
      });
      expect(tts.cancelCount).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch the claim while the tail is deferred during recording", async () => {
    const h = createHarness();
    h.planner.notifyUserRecordingStarted();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "内容。" });
    await flushMicrotasks();
    expect(h.tts.spoken).toHaveLength(0);
    expect(h.claim.acquireCalls).toBe(0);
    h.planner.dispose();
  });

  it("dispose stops everything and releases the claim (§3.5-4)", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "turn-1", text: "甲。" });
    await flushMicrotasks();
    h.planner.dispose();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(h.claim.releaseCalls).toBeGreaterThanOrEqual(1);
    expect(h.tts.cancelCount).toBeGreaterThanOrEqual(1);
  });
});

describe("persona 句粒度生效（§9.7.8-6 V7-d）", () => {
  it("播报 Speaking 中配置变更：当前句以旧配置播完，下一句以新 voice/vendorVoice/rate 播（无中途重播）", async () => {
    let config: { lang: string; voice?: string; vendorVoice?: string; rate?: number } = {
      lang: "zh-CN",
      voice: "voice-a",
      rate: 1,
    };
    const tts = new FakeTts();
    const claim = new FakeClaim();
    const planner = createTurnSpeechPlanner({
      getFocusedTurnTail: () => ({ turnId: "t1", text: "第一句。第二句。" }),
      tts,
      claim,
      isAnnouncementEnabled: () => true,
      announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
      // 每句 speak 前读取（turnSpeechPlanner speakCurrent）——persona patch 落盘后
      // 下一句即以新配置播（句粒度生效，零新事件流）。
      getAnnouncementVoiceConfig: () => config,
      cancelTask: () => undefined,
    });
    planner.consumeTurnTail({ turnId: "t1", text: "第一句。第二句。" });
    await flushMicrotasks();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    expect(tts.spoken[0]).toMatchObject({ text: "第一句。", voice: "voice-a", rate: 1 });
    // persona patch 落盘（控件外写入路径）：配置在句边界之间变化。
    config = { lang: "zh-CN", voice: "voice-b", vendorVoice: "alex", rate: 1.3 };
    tts.finishCurrent("end"); // 当前句以旧配置播完 → 下一句以新配置播。
    expect(tts.spoken).toHaveLength(2);
    expect(tts.spoken[1]).toMatchObject({
      text: "第二句。",
      voice: "voice-b",
      vendorVoice: "alex",
      rate: 1.3,
    });
    tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    // 无中途重播/静音：句粒度切换不触发 cancel。
    expect(tts.cancelCount).toBe(0);
    planner.dispose();
  });
});
