// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import { useVoiceSessionStore, type VoiceAnnouncementLegState } from "@/store/voiceSessionStore.js";

/**
 * 语音打断全链集成守护（specs/voice-agent-integration.md §4.3 / §5.1 / §9.3）：
 * 听写运行时（useVoiceDictation）的打断词决策 → voiceCommandBus → 播报规划器
 * （useVoiceAnnouncement）→ voiceSessionStore 状态迁移 / TTS 静音 / v4 stop 分发。
 *
 * 场景：
 * - 层① Speaking：final「停」→ 播报停、claim 释放、录音继续、「停」不入正文（§5.1）；
 * - 层① AnnPaused（§9.3 验收原文）：「停」→ 回 AnnIdle、作废续播意图（正文不续播）；
 * - uninterruptible（§3.3）：权限段内语音「停」不生效（播报保持），点按通道不受限；
 * - 层③ Speaking/播报关（§4.3/§4.8）：「停掉任务」→ requestTaskStop 分发 + Cancelling，
 *   TurnComplete(cancelled) 回 AnnIdle 不再播。
 */

const { fakeTts } = vi.hoisted(() => {
  let counter = 0;
  const spoken: string[] = [];
  let doneCb: ((handle: { utteranceId: string }, reason: string) => void) | null = null;
  let lastHandle: { utteranceId: string } | null = null;
  const fakeTts = {
    spoken,
    cancelCount: { value: 0 },
    speak: (u: { text: string }) => {
      spoken.push(u.text);
      lastHandle = { utteranceId: `utt-${(counter += 1)}` };
      return lastHandle;
    },
    cancel: () => {
      fakeTts.cancelCount.value += 1;
      lastHandle = null;
    },
    onDone: (cb: (handle: { utteranceId: string }, reason: string) => void) => {
      doneCb = cb;
      return () => {
        doneCb = null;
      };
    },
    finishCurrent: (reason = "end") => {
      const handle = lastHandle;
      if (!handle) {
        throw new Error("no live utterance");
      }
      lastHandle = null;
      doneCb?.(handle, reason);
    },
    _reset: () => {
      spoken.length = 0;
      fakeTts.cancelCount.value = 0;
      lastHandle = null;
      doneCb = null;
    },
  };
  return { fakeTts };
});

vi.mock("./speechSynthesisTtsAdapter.js", () => ({
  createSpeechSynthesisTtsAdapter: () => fakeTts,
}));

const { fakeAdapter } = vi.hoisted(() => {
  class FakeSession {
    finalSubscribers = new Set<(text: string) => void>();
    errorSubscribers = new Set<(error: { code: string }) => void>();
    stopCalls = 0;
    abortCalls = 0;

    onFinal(cb: (text: string) => void): () => void {
      this.finalSubscribers.add(cb);
      return () => this.finalSubscribers.delete(cb);
    }

    onError(cb: (error: { code: string }) => void): () => void {
      this.errorSubscribers.add(cb);
      return () => this.errorSubscribers.delete(cb);
    }

    async stop(): Promise<{ final: string }> {
      this.stopCalls += 1;
      return { final: "" };
    }

    abort(): void {
      this.abortCalls += 1;
    }

    emitFinal(text: string): void {
      for (const cb of Array.from(this.finalSubscribers)) cb(text);
    }

    emitError(code: string): void {
      for (const cb of Array.from(this.errorSubscribers)) cb({ code });
    }
  }
  const sessions: FakeSession[] = [];
  const fakeAdapter = {
    isSupported: () => true,
    start: vi.fn(() => {
      const session = new FakeSession();
      sessions.push(session);
      return Promise.resolve(session);
    }),
    onPartial: vi.fn(() => () => undefined),
    _sessions: sessions,
    _reset: () => {
      sessions.length = 0;
      fakeAdapter.start.mockClear();
    },
  };
  return { fakeAdapter };
});

vi.mock("./webSpeechAsrAdapter.js", () => ({
  createWebSpeechAsrAdapter: () => fakeAdapter,
  VoiceAsrError: class extends Error {
    constructor(
      readonly code: string,
      message?: string,
    ) {
      super(message ?? code);
    }
  },
}));

const { settingsState } = vi.hoisted(() => ({
  settingsState: {
    current: {
      voiceAnnouncementEnabled: true,
      voiceAnnouncementVoice: "",
      voiceAnnouncementRate: 1,
    } as {
      voiceAnnouncementEnabled: boolean;
      voiceAnnouncementVoice: string;
      voiceAnnouncementRate: number;
    },
  },
}));

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ broadcastService: undefined }),
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: settingsState.current }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

const { useVoiceAnnouncement } = await import("./useVoiceAnnouncement.js");
const { useVoiceDictation } = await import("./useVoiceDictation.js");

const initialAnnouncement: VoiceAnnouncementLegState = {
  phase: "annIdle",
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

function resetStores(): void {
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

function makeUnit(turnId: string, texts: string[]): Record<string, unknown> {
  return {
    turnId,
    latestAssistantTextRow: { state: "complete", text: texts.join("") },
    assistantTextRows: texts.map((text) => ({ text })),
  };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

interface Harness {
  announcement: ReturnType<typeof useVoiceAnnouncement>;
  dictation: ReturnType<typeof useVoiceDictation>;
  requestTaskStop: ReturnType<typeof vi.fn>;
}

/** 挂载播报 + 听写两条腿：轮尾已消费（speaking/annIdle 由 settings 决定）。 */
async function mountLegs(): Promise<Harness> {
  const requestTaskStop = vi.fn();
  const announcement = renderHook(() =>
    useVoiceAnnouncement({
      focused: true,
      sessionId: "sess-1",
      workspacePath: "/ws",
      units: [makeUnit("t1", ["甲。乙。"])] as never,
      pendingInteractions: [],
      requestTaskStop,
    }),
  );
  const dictation = renderHook(() =>
    useVoiceDictation({
      sessionId: "sess-1",
      workspacePath: "/ws",
      lang: "zh-CN",
      requestStart: () => true,
    }),
  );
  await flush();
  return {
    announcement: announcement.result.current,
    dictation: dictation.result.current,
    requestTaskStop,
  };
}

/** 开麦进入录音（真实订阅链：store 迁移 → planner.notifyUserRecordingStarted）。 */
async function startDictation(harness: Harness): Promise<void> {
  harness.dictation.toggleMic();
  await flush();
  expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
}

function dictationSession() {
  return fakeAdapter._sessions[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeTts._reset();
  fakeAdapter._reset();
  resetStores();
  settingsState.current = {
    voiceAnnouncementEnabled: true,
    voiceAnnouncementVoice: "",
    voiceAnnouncementRate: 1,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("语音打断全链（听写决策 → 命令总线 → 播报规划器 → 状态机）", () => {
  it("层① Speaking：final「停」→ 播报停 + claim 释放 + 录音继续 + 不入正文（§5.1）", async () => {
    const harness = await mountLegs();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    await startDictation(harness);
    // §3.3 Recording 优先：当前句播完入 AnnPaused——先让「甲。」完成。
    fakeTts.finishCurrent();
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annPaused",
      claimHeld: true,
    });

    dictationSession()?.emitFinal("停");
    await flush();
    // 层①：停播报不续播，claim 释放；录音腿继续（用户可能接着说话）。
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(fakeTts.cancelCount.value).toBeGreaterThanOrEqual(1);
    // §5.1：命中的 final 不注入 composer（「停」不出现在正文）。
    expect(
      useDroraSessionStore.getState().getWorkspaceState("/ws").composerTextInsertRequest,
    ).toBeNull();
    // 不续播：乙句不再被调度（cancel 后无在播 utterance，正文队列已随 AnnIdle 清空）。
    expect(() => fakeTts.finishCurrent()).toThrow();
  });

  it("uninterruptible 权限段：语音「停」不生效（§3.3），点按停止不受限", async () => {
    const harness = await mountLegs();
    // 权限段在「甲」播报中插队（§4.1）：当前句播完的句界整段拼接。
    harness.announcement.planner.consumePermissionSegment({
      permissionId: "perm-1",
      text: "Bash: 要运行命令吗？",
    });
    fakeTts.finishCurrent();
    // 权限句在播（uninterruptible 整段置位，§3.3）。
    expect(fakeTts.spoken).toEqual(["甲。", "Bash: 要运行命令吗？"]);
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    await startDictation(harness);

    dictationSession()?.emitFinal("停");
    await flush();
    // §3.3：uninterruptible 段内打断词通道被拒——播报保持、无静音。
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    expect(fakeTts.cancelCount.value).toBe(0);

    // 点按通道不受限：立即静音回 AnnIdle。
    harness.announcement.planner.notifyStopPressed();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(fakeTts.cancelCount.value).toBeGreaterThanOrEqual(1);
  });

  it("层③ Speaking：final「停掉任务」→ 分发 v4 stop + Cancelling，终态回 AnnIdle 不再播（§4.3）", async () => {
    const harness = await mountLegs();
    await startDictation(harness);
    fakeTts.finishCurrent();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annPaused");

    dictationSession()?.emitFinal("停掉任务");
    await flush();
    // 层③：分发既有 v4 stop（wiring requestTaskStop = SessionPane handleStop，携带
    // expectedForegroundExecutionId）+ 播报同步静音经 Cancelling。
    expect(harness.requestTaskStop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");
    expect(fakeTts.cancelCount.value).toBeGreaterThanOrEqual(1);

    // TurnComplete(cancelled) 完成信号 → AnnIdle 不再播（§3.2 Cancelling 出边）；
    // 录音腿仍在，完成信号不被顺延吞掉。
    harness.announcement.planner.consumeTurnTail({ turnId: "t1", text: "已取消" });
    await flush();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(fakeTts.spoken).toEqual(["甲。"]);
  });

  it("层③ 播报关闭/AnnIdle：final「停掉任务」仍分发 v4 stop（§4.3 层③与播报态无关）", async () => {
    settingsState.current = { ...settingsState.current, voiceAnnouncementEnabled: false };
    const harness = await mountLegs();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    await startDictation(harness);

    dictationSession()?.emitFinal("停掉任务");
    await flush();
    expect(harness.requestTaskStop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
  });

  it("状态机迁移：AnnIdle 段打断词 no-op（无播报可停），录音腿不受影响", async () => {
    settingsState.current = { ...settingsState.current, voiceAnnouncementEnabled: false };
    const harness = await mountLegs();
    await startDictation(harness);
    dictationSession()?.emitFinal("停");
    await flush();
    // 播报未挂载内容：dispatch 广播无效果（AnnIdle planner no-op），录音继续。
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(fakeTts.cancelCount.value).toBe(0);
    void harness;
  });
});
