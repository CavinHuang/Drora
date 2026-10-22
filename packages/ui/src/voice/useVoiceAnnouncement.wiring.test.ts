// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVoiceCommandHandlersForTest } from "./voiceCommandBus.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";

/**
 * 播报接线 wiring 守护（specs/voice-agent-integration.md §9.3 / §3.5-4 / §4.3）：
 * mock provider hooks（services/settings/intl）与 TTS 适配器后整链驱动 useVoiceAnnouncement——
 * 轮尾消费、开关关闭 release（§3.5-4 第三时机）、focus 离开停播、打断词总线端到端
 * （dispatch stopAnnouncement → 停播不续播）、cancelTask → requestTaskStop 分发。
 */

const { fakeTts } = vi.hoisted(() => {
  class FakeHandle {
    constructor(
      readonly utteranceId: string,
    ) {}
  }
  let counter = 0;
  const spoken: string[] = [];
  let doneCb: ((handle: { utteranceId: string }, reason: string) => void) | null = null;
  let lastHandle: { utteranceId: string } | null = null;
  const cancelCount = { value: 0 };
  const fakeTts = {
    spoken,
    cancelCount,
    speak: (u: { text: string }) => {
      spoken.push(u.text);
      lastHandle = new FakeHandle(`utt-${(counter += 1)}`);
      return lastHandle;
    },
    cancel: () => {
      cancelCount.value += 1;
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
      cancelCount.value = 0;
      lastHandle = null;
      doneCb = null;
    },
  };
  return { fakeTts };
});

vi.mock("./speechSynthesisTtsAdapter.js", () => ({
  createSpeechSynthesisTtsAdapter: () => fakeTts,
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

const initialAnnouncement = {
  phase: "annIdle" as const,
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

async function mountAnnouncement(params?: {
  units?: Record<string, unknown>[];
  pendingInteractions?: { interactionId: string; payload: { kind: string; toolName?: string; summary?: string } }[];
  focused?: boolean;
  requestTaskStop?: () => void;
}) {
  const harness = renderHook(() =>
    useVoiceAnnouncement({
      focused: params?.focused ?? true,
      sessionId: "sess-1",
      workspacePath: "/ws",
      units: (params?.units ?? []) as never,
      pendingInteractions: params?.pendingInteractions as never,
      requestTaskStop: params?.requestTaskStop ?? (() => undefined),
    }),
  );
  // claim acquire→startSpeaking 是异步链：flush 微任务保证断言前状态迁移完成。
  await vi.advanceTimersByTimeAsync(0);
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeTts._reset();
  resetStores();
  resetVoiceCommandHandlersForTest();
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

describe("useVoiceAnnouncement wiring", () => {
  it("consumes the focused tail into speaking and gates on the reader (§9.3 验收)", async () => {
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。", "第二句！"])] });
    // effect 已消费轮尾：speaking + 首句在播。
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "speaking",
      sentenceIndex: 0,
      sentenceCount: 2,
    });
    expect(fakeTts.spoken).toEqual(["第一句。"]);
    fakeTts.finishCurrent();
    expect(fakeTts.spoken).toEqual(["第一句。", "第二句！"]);
    fakeTts.finishCurrent();
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    void harness;
  });

  it("does not consume when announcement is disabled (默认关)", async () => {
    settingsState.current = { ...settingsState.current, voiceAnnouncementEnabled: false };
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    expect(fakeTts.spoken).toHaveLength(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    void harness;
  });

  it("releases the announcement when the switch turns off mid-playback (§3.5-4 第三时机)", async () => {
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。", "第二句！"])] });
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    // §3.5-4：播报开关关闭 → 停播回 AnnIdle（release）。
    settingsState.current = { ...settingsState.current, voiceAnnouncementEnabled: false };
    harness.rerender();
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(fakeTts.cancelCount.value).toBeGreaterThanOrEqual(1);
    // 队列清空：不再播第二句（cancel 后无在播 utterance，无需也不可再驱动句完成）。
    expect(fakeTts.spoken).toEqual(["第一句。"]);
  });

  it("stops the announcement when the pane loses focus (§3.4)", async () => {
    let focused = true;
    const harness = renderHook(() =>
      useVoiceAnnouncement({
        focused,
        sessionId: "sess-1",
        workspacePath: "/ws",
        units: [makeUnit("t1", ["第一句。"])] as never,
        requestTaskStop: () => undefined,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    focused = false;
    harness.rerender();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
  });

  it("stopAnnouncement command from the bus silences playback end-to-end (§4.3 层①端到端)", async () => {
    const { dispatchVoiceCommand } = await import("./voiceCommandBus.js");
    const harness = await mountAnnouncement({
      units: [makeUnit("t1", ["甲。乙。"])],
      pendingInteractions: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    dispatchVoiceCommand("stopAnnouncement");
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      claimHeld: false,
    });
    expect(fakeTts.cancelCount.value).toBeGreaterThanOrEqual(1);
    void harness;
  });

  it("routes cancelTask from the bus to requestTaskStop (§4.3 层③端到端)", async () => {
    const { dispatchVoiceCommand } = await import("./voiceCommandBus.js");
    const requestTaskStop = vi.fn();
    const harness = await mountAnnouncement({
      units: [makeUnit("t1", ["甲。"])],
      requestTaskStop,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("speaking");
    dispatchVoiceCommand("cancelTask");
    // 播报腿活动态：Cancelling 静音 + 分发既有 v4 stop（带 expectedForegroundExecutionId 由 SessionPane 组装）。
    expect(requestTaskStop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("cancelling");
    // TurnComplete(cancelled) 终态 → AnnIdle 不再播。
    harness.rerender();
    void harness;
  });

  it("routes cancelTask from the bus even when idle/disabled (§4.3 层③与播报态无关)", async () => {
    const { dispatchVoiceCommand } = await import("./voiceCommandBus.js");
    const requestTaskStop = vi.fn();
    // 播报关闭：轮尾/权限均不消费，但「停掉任务」仍须分发既有 v4 stop。
    settingsState.current = { ...settingsState.current, voiceAnnouncementEnabled: false };
    const harness = await mountAnnouncement({ units: [], requestTaskStop });
    dispatchVoiceCommand("cancelTask");
    expect(requestTaskStop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    void harness;
  });

  it("announces a pending permission segment with priority over the body (§4.1/FD-3)", async () => {
    const harness = await mountAnnouncement({
      units: [makeUnit("t1", ["正文一。正文二。"])],
      pendingInteractions: [
        {
          interactionId: "perm-1",
          payload: { kind: "permission", toolName: "Bash", summary: "要运行命令吗？" },
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);
    // 权限 pending 在消费 effect 先于/同轮于轮尾：权限段优先播（FD-3）。
    expect(fakeTts.spoken[0]).toBe("Bash: 要运行命令吗？");
    expect(useVoiceSessionStore.getState().announcement.uninterruptible).toBe(true);
    void harness;
  });
});
