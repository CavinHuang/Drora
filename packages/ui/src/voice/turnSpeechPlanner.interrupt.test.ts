import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
  type TurnSpeechPlannerDeps,
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
  private acquireGate: Promise<boolean> | null = null;

  /** 测试驱动：下一次 acquire 经该 promise 网关（构造 claim 往返窗口，§9.8/F5）。 */
  holdNextAcquire(gate: Promise<boolean>): void {
    this.acquireGate = gate;
  }

  async acquire(): Promise<VoiceAnnouncementLease | null> {
    this.acquireCalls += 1;
    // 融合：§9.8 lease 形态返回具体 lease；§9.9 的 acquireGate 网关保留（构造
    // claim 往返窗口），网关布尔映射为 lease/null。
    if (this.acquireGate) {
      const gate = this.acquireGate;
      this.acquireGate = null;
      return (await gate) ? { key: "k", token: "fake-lease" } : null;
    }
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
    // §9.9.3-L8：跨 pane 共享账本随 store 重置（跨用例不泄漏已播标记）。
    announcedPermissionIds: new Set<string>(),
  });
}

interface Harness {
  tts: FakeTts;
  claim: FakeClaim;
  cancelTask: ReturnType<typeof vi.fn<() => void>>;
  planner: ReturnType<typeof createTurnSpeechPlanner>;
  setFocusedTail(tail: { turnId: string; text: string } | null): void;
}

function createHarness(
  overrides?: Partial<
    Pick<
      TurnSpeechPlannerDeps,
      "isPermissionPending" | "announcedPermissionLedger" | "claimRenewIntervalMs"
    >
  >,
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

  it("resumes the interrupted permission queue on recording end instead of superseding with the latest tail (§9.9.2-M3)", async () => {
    const h = createHarness();
    // focused 轮尾存在（旧正文）——原实现落入 tailSuperseded 改播分支会播它；断言零改播。
    h.setFocusedTail({ turnId: "t-old", text: "旧正文。" });
    h.planner.consumePermissionSegment({
      permissionId: "p1",
      text: "权限一？权限二？权限三？权限四？",
    });
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？"]);
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？"]);
    // 第 2/4 句播完开录：句界入 AnnPaused（剩余 权限三/权限四）。
    h.planner.notifyUserRecordingStarted();
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annPaused",
      sentenceIndex: 2,
    });
    // 录音结束且无新轮尾：自第 3 句续播权限队列剩余句（null-turnId 在播形态，
    // 跳过轮尾比对）；uninterruptible 覆盖 3-4 句。
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？", "权限三？"]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      sentenceIndex: 2,
      uninterruptible: true,
    });
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual([
      "权限一？",
      "权限二？",
      "权限三？",
      "权限四？",
    ]);
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    // 旧正文轮尾从未被播（零改播轮尾；回退即红：删掉 null-turnId 子分支则落
    // tailSuperseded 改播 latest，spoken 出现「旧正文。」且 权限三/四 永失）。
    expect(h.tts.spoken.some((u) => u.text.includes("旧正文"))).toBe(false);
  });

  it("plays the deferred tail after the resumed permission queue drains: permission first, body after (§9.9.2-M3 FD-3)", async () => {
    const h = createHarness();
    h.planner.consumePermissionSegment({
      permissionId: "p1",
      text: "权限一？权限二？权限三？权限四？",
    });
    await flushMicrotasks();
    h.tts.finishCurrent("end"); // 权限二 在播
    h.planner.notifyUserRecordingStarted();
    h.tts.finishCurrent("end"); // → AnnPaused（index 2）
    // 录音期间新轮尾 T2 就绪：顺延（pendingTail = T2，不清）。
    h.setFocusedTail({ turnId: "t2", text: "T2句一。T2句二。" });
    h.planner.consumeTurnTail({ turnId: "t2", text: "T2句一。T2句二。" });
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // 先续播权限句 3（顺延轮尾保留不清）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？", "权限三？"]);
    h.tts.finishCurrent("end"); // 权限四
    h.tts.finishCurrent("end"); // 权限队列排空 → AnnIdle → 排空点起播顺延轮尾
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual([
      "权限一？",
      "权限二？",
      "权限三？",
      "权限四？",
      "T2句一。",
    ]);
    // FD-3 顺序断言：权限先、正文后（回退即红：恢复改播 latest 则权限句 3/4 永失，
    // spoken 直接出现 T2 句）。
    const spokenTexts = h.tts.spoken.map((u) => u.text);
    expect(spokenTexts.indexOf("T2句一。")).toBeGreaterThan(spokenTexts.indexOf("权限四？"));
    h.tts.finishCurrent("end");
    expect(h.tts.spoken.map((u) => u.text)).toEqual([
      "权限一？",
      "权限二？",
      "权限三？",
      "权限四？",
      "T2句一。",
      "T2句二。",
    ]);
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("does not revive a processed permission segment at the resume boundary (§9.9.2-M3 F5 兼容 isPermissionPending)", async () => {
    // 并行 §9.8/F5 形态同签名的 deps.isPermissionPending：已处理（!== pending）的
    // 待插队段在续播前被 prunePermissions 修剪——其句不进队列（「已处理段不复活」，
    // §9.8.2「开播前复核请求仍 pending」同向）。
    const h = createHarness({ isPermissionPending: (id) => id !== "p2" });
    h.planner.consumePermissionSegment({
      permissionId: "p1",
      text: "权限一？权限二？权限三？",
    });
    await flushMicrotasks();
    h.tts.finishCurrent("end"); // 权限二 在播
    h.planner.notifyUserRecordingStarted();
    // 录音中 p2 到达（speaking 期 → 待插队 pendingPermissionSegments）且随后被处理。
    h.planner.consumePermissionSegment({ permissionId: "p2", text: "已处理权限？" });
    h.tts.finishCurrent("end"); // → AnnPaused（index 2，p1 剩余 权限三）
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // 续播 p1 剩余句；p2 已处理 → 其剩余句不复活（不拼接进队列）。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？", "权限三？"]);
    h.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(h.tts.spoken.some((u) => u.text.includes("已处理权限"))).toBe(false);
  });

  it("起播链互斥：权限排空链在飞时简报排空不再并发起链（§9.8/F4/F5）", async () => {
    const h = createHarness();
    // AnnIdle 同帧驱动权限段与简报（两个排空微任务）。
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限问题？" });
    h.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    await flushMicrotasks();
    // 互斥：权限链独占起播，简报链被 turnStartInFlight 挡下——基线双链并发时简报链
    // startSpeaking 替换权限队列（spoken 同时出现两者且 sentenceCount 被重置）。
    // 回退即红：恢复基线 ensureClaimAndSpeak（排空链不置互斥标记）则简报同帧出声。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限问题？"]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      sentenceCount: 1,
    });
    h.tts.finishCurrent("end");
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限问题？", "正在 Edit a.ts"]);
  });

  it("await 后复核：claim 往返期间已处理的权限段不出声、刚拿到的 claim 归还（§9.8/F5）", async () => {
    const pending: Record<string, boolean> = { p1: true };
    const h = createHarness({ isPermissionPending: (id) => pending[id] !== false });
    let releaseAcquire!: (value: boolean) => void;
    h.claim.holdNextAcquire(
      new Promise<boolean>((resolve) => {
        releaseAcquire = resolve;
      }),
    );
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限问题？" });
    await flushMicrotasks(); // 排空链进入 claim acquire await 窗口。
    pending.p1 = false; // claim 往返期间 P1 已被处理。
    releaseAcquire(true);
    await flushMicrotasks();
    // 零出声、回 AnnIdle、刚拿到的 claim 立即归还（不为死意图占锁）。
    // 回退即红：移除 await 后权限过滤则 speak 出「权限问题？」且 releaseCalls=0。
    expect(h.tts.spoken).toHaveLength(0);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(h.claim.releaseCalls).toBe(1);
  });

  it("起播链遇录音：权限段 unshift 回队头，录音结束排空起播不丢（§9.8/F5）", async () => {
    const h = createHarness();
    let releaseAcquire!: (value: boolean) => void;
    h.claim.holdNextAcquire(
      new Promise<boolean>((resolve) => {
        releaseAcquire = resolve;
      }),
    );
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限问题？" });
    await flushMicrotasks(); // 链在 claim 往返窗口。
    h.planner.notifyUserRecordingStarted(); // 录音在窗口内开始。
    releaseAcquire(true);
    await flushMicrotasks();
    // 起播意图过期：不出声，权限段 unshift 回待插队队头（回退即红：移除
    // deferExpiredStart 的 unshift 则段丢失、录音结束后零 speak）。
    expect(h.tts.spoken).toHaveLength(0);
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限问题？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
  });

  it("无轮尾时录音中积压的权限段在录音结束排空起播（§9.8/F5 权限排空）", async () => {
    const h = createHarness();
    h.planner.notifyUserRecordingStarted();
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "录音中权限？" });
    await flushMicrotasks();
    // 录音中：排空链遇 recording 过期（段 unshift 回队），零出声。
    expect(h.tts.spoken).toHaveLength(0);
    h.planner.notifyUserRecordingEnded();
    await flushMicrotasks();
    // §9.8/F5：没有正文轮尾时，录音中积压的权限段也必须在资源释放后排空起播。
    // 回退即红：移除 notifyUserRecordingEnded 尾部的 schedulePermissionDrain 则滞留零 speak。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["录音中权限？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
  });

  it("权限窗内不插简报：整段闭合不被腰斩（§9.8/F5）", async () => {
    const h = createHarness();
    h.planner.consumePermissionSegment({ permissionId: "p1", text: "权限一？权限二？" });
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？"]);
    // 权限窗 [0,2) 在播第 1 句时简报到达（speaking → 待插队）。
    h.planner.consumeBriefSegment("brief-1", "正在 Edit a.ts");
    h.tts.finishCurrent("end"); // 句界（index 1 仍在窗内）。
    // 简报未插入权限窗：第 2 权限句原序续播且 uninterruptible 保持覆盖。
    // 回退即红：移除窗口防护则 spoken 变 [权限一？, 正在 Edit a.ts, 权限二？]。
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    h.tts.finishCurrent("end"); // 队列尽 → AnnIdle → 简报空闲排空。
    await flushMicrotasks();
    expect(h.tts.spoken.map((u) => u.text)).toEqual(["权限一？", "权限二？", "正在 Edit a.ts"]);
  });

  it("已播权限账本跨 pane 共享：切 pane 后同一 pending 权限不重播（§9.9.3-L8）", async () => {
    // wiring 同款 store 账本适配（voiceSessionStore 单一所有者）。
    const ledger = {
      has: (id: string) => useVoiceSessionStore.getState().hasAnnouncedPermission(id),
      mark: (id: string) => useVoiceSessionStore.getState().markPermissionAnnounced(id),
    };
    // pane A 的 planner 播完权限 P（P 仍 pending，账本已记）。
    const hA = createHarness({ announcedPermissionLedger: ledger });
    hA.planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    await flushMicrotasks();
    expect(hA.tts.spoken.map((u) => u.text)).toEqual(["权限甲？"]);
    hA.tts.finishCurrent("end");
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    // focused 切至 pane B：新 planner 实例共享同一账本 → 零重播。
    // 回退即红：退回 planner 实例级 Set（不传 ledger）则 B 重播「权限甲？」。
    const hB = createHarness({ announcedPermissionLedger: ledger });
    hB.planner.consumePermissionSegment({ permissionId: "p1", text: "权限甲？" });
    await flushMicrotasks();
    expect(hB.tts.spoken).toHaveLength(0);
    // 新权限 Q 到达：正常播（既有去重语义回归）。
    hB.planner.consumePermissionSegment({ permissionId: "q1", text: "新权限？" });
    await flushMicrotasks();
    expect(hB.tts.spoken.map((u) => u.text)).toEqual(["新权限？"]);
  });

  it("双窗叠音：窗 A claim 不可得静默、窗 B 正常出声（§9.9.3-L7）", async () => {
    // A 的 claim 恒不可得（unavailable 适配映射为 false 后的 planner 形态）。
    const hA = createHarness();
    hA.claim.acquireResult = false;
    hA.setFocusedTail({ turnId: "t1", text: "A 句。" });
    hA.planner.consumeTurnTail({ turnId: "t1", text: "A 句。" });
    await flushMicrotasks();
    // A 静默且不迁移共享 store 相位（未持有者不占播报腿）。
    expect(hA.tts.spoken).toHaveLength(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    const hB = createHarness();
    hB.setFocusedTail({ turnId: "t1", text: "B 句。" });
    hB.planner.consumeTurnTail({ turnId: "t1", text: "B 句。" });
    await flushMicrotasks();
    // 仅 B 出声。
    expect(hB.tts.spoken.map((u) => u.text)).toEqual(["B 句。"]);
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
    // 融合（§9.8/F4 + §4.2-5）：权限段须实际完成，最低优先级简报才能开始，不能仅
    // 因正文结束就越过权限段——起播链互斥下简报链不再与权限链同帧并发竞争
    //（旧行为是双链并发、简报链半路替换权限队列；现简报等权限播完后的空闲排空）。
    expect(harness.tts.spoken.map((u) => u.text)).toEqual(["正文一。", "权限问题？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    harness.tts.finishCurrent("end");
    await new Promise((r) => setTimeout(r, 0));
    // 简报不丢弃，推迟到权限段播完后的空闲排空（§4.2-5 段间句隙不插）。
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
