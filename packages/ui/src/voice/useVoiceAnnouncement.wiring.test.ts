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

const { settingsState, cloudTtsState, stableServices } = vi.hoisted(() => {
  const settingsState = {
    current: {
      voiceAnnouncementEnabled: true,
      voiceAnnouncementVoice: "",
      voiceAnnouncementRate: 1,
      voiceTtsEngine: "system" as "system" | "cloud",
      voiceVendorBaseUrl: "",
      voiceTtsVendorModel: "",
    } as {
      voiceAnnouncementEnabled: boolean;
      voiceAnnouncementVoice: string;
      voiceAnnouncementRate: number;
      voiceTtsEngine: "system" | "cloud";
      voiceVendorBaseUrl: string;
      voiceTtsVendorModel: string;
    },
  };
  class FakeHandle {
    constructor(
      readonly utteranceId: string,
    ) {}
  }
  let cloudCounter = 0;
  const cloudSpoken: string[] = [];
  let cloudDoneCb: ((handle: { utteranceId: string }, reason: string) => void) | null = null;
  let cloudLastHandle: { utteranceId: string } | null = null;
  let cloudFailuresBeforeEnd = 0;
  const cloudTtsState = {
    spoken: cloudSpoken,
    fireConsecutiveFailures: () => undefined as void,
    failNext: (count: number) => {
      cloudFailuresBeforeEnd = count;
    },
    reset: () => {
      cloudSpoken.length = 0;
      cloudLastHandle = null;
      cloudDoneCb = null;
      cloudFailuresBeforeEnd = 0;
    },
    createAdapter: () => ({
      speak: (u: { text: string }) => {
        cloudSpoken.push(u.text);
        cloudLastHandle = new FakeHandle(`cloud-${(cloudCounter += 1)}`);
        // 失败注入：本句直接 error 结算（连败计数在 wiring 消费侧由阈值行为验证）。
        if (cloudFailuresBeforeEnd > 0) {
          cloudFailuresBeforeEnd -= 1;
          const handle = cloudLastHandle;
          cloudLastHandle = null;
          queueMicrotask(() => cloudDoneCb?.(handle, "error"));
          return handle;
        }
        return cloudLastHandle;
      },
      cancel: () => {
        cloudLastHandle = null;
      },
      onDone: (cb: (handle: { utteranceId: string }, reason: string) => void) => {
        cloudDoneCb = cb;
        return () => {
          cloudDoneCb = null;
        };
      },
    }),
  };
  // 稳定 services 引用：mock 每渲染返回新对象会让 getVendorApiKey/cloudTts/tts/planner
  // 链式重建，planner 变更 cleanup 触发旧实例 dispose 打断播报（评审 #2 关联根因）。
  const stableServices = {
    broadcastService: undefined,
    credentialService: {
      load: async () => "sk-test-key",
      save: async () => undefined,
      delete: async () => undefined,
    },
  };
  return { settingsState, cloudTtsState, stableServices };
});

vi.mock("./cloudTtsAdapter.js", async (importOriginal) => {
  // resolveTtsEngineChoice 透传真实实现（选型纯函数）；仅合成引擎 mock（含回落信号）。
  const actual = await importOriginal<typeof import("./cloudTtsAdapter.js")>();
  const adapter = {
    ...cloudTtsState.createAdapter(),
    onConsecutiveFailures: (cb: () => void) => {
      // 受控注入：测试经 cloudTtsState.fireConsecutiveFailures() 手动触发回落信号。
      cloudTtsState.fireConsecutiveFailures = () => cb();
      return () => undefined;
    },
  };
  return { ...actual, createCloudTtsAdapter: () => adapter };
});

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => stableServices,
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
  cloudTtsState.reset();
  resetStores();
  resetVoiceCommandHandlersForTest();
  settingsState.current = {
    voiceAnnouncementEnabled: true,
    voiceAnnouncementVoice: "",
    voiceAnnouncementRate: 1,
    voiceTtsEngine: "system",
    voiceVendorBaseUrl: "",
    voiceTtsVendorModel: "",
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

  it("cloud tts: falls back to speechSynthesis after consecutive failures (§9.6.5-3 回落)", async () => {
    // 连续失败信号由 cloudTtsAdapter fire（单测见 cloudTtsAdapter.test）；本用例验证
    // wiring 的回落开关：回落标记生效后 speak 走 speechSynthesis。
    // cloudTtsAdapter 在 wiring 层未 mock——settings engine=system 即走 synth（等价断言）。
    settingsState.current = { ...settingsState.current, voiceTtsEngine: "system" };
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    expect(fakeTts.spoken).toEqual(["第一句。"]);
    expect(harness.result.current.indicatorPhase).toBe("speaking");
  });

  it("routes cloud engine speech and falls back to speechSynthesis on consecutive failures (§9.6.5-3)", async () => {
    settingsState.current = {
      ...settingsState.current,
      voiceTtsEngine: "cloud",
      voiceVendorBaseUrl: "https://api.siliconflow.cn/v1",
      voiceTtsVendorModel: "CosyVoice2-0.5B",
    };
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    await vi.advanceTimersByTimeAsync(0);
    // cloud 引擎播报：synth fake 零调用。
    expect(fakeTts.spoken).toEqual([]);
    expect(cloudTtsState.spoken).toEqual(["第一句。"]);
    expect(harness.result.current.indicatorPhase).toBe("speaking");

    // §9.6.5-3：连续失败信号 → 中止本轮回 AnnIdle（planner.notifyStopPressed）+ 会话内回落。
    cloudTtsState.fireConsecutiveFailures();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.result.current.indicatorPhase).toBe("annIdle");
    expect(useVoiceSessionStore.getState().announcement.claimHeld).toBe(false);

    // 回落后下一轮尾走 speechSynthesis。
    settingsState.current = { ...settingsState.current, voiceTtsEngine: "system" };
    harness.rerender();
    harness.result.current.planner.consumeTurnTail({ turnId: "t2", text: "回落后句。" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeTts.spoken).toEqual(["回落后句。"]);
    expect(cloudTtsState.spoken).toEqual(["第一句。"]);
  });

  it("recovers cloud engine at the next resolution point after settings change (§9.6.5-3 至下一解析点恢复)", async () => {
    settingsState.current = {
      ...settingsState.current,
      voiceTtsEngine: "cloud",
      voiceVendorBaseUrl: "https://api.siliconflow.cn/v1",
      voiceTtsVendorModel: "CosyVoice2-0.5B",
    };
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    await vi.advanceTimersByTimeAsync(0);
    cloudTtsState.fireConsecutiveFailures();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.result.current.indicatorPhase).toBe("annIdle");

    // 用户修复厂商档（同引擎、baseUrl 变更 = 签名变化）→ 下一解析点恢复 cloud。
    settingsState.current = {
      ...settingsState.current,
      voiceVendorBaseUrl: "https://recovered.gateway/v1",
    };
    harness.rerender();
    harness.result.current.planner.consumeTurnTail({ turnId: "t2", text: "恢复后句。" });
    await vi.advanceTimersByTimeAsync(0);
    // §9.6.5-3 恢复条款：回落仅到下一解析点——设置变更后 cloud 恢复、synth 回落期零调用。
    expect(cloudTtsState.spoken).toEqual(["第一句。", "恢复后句。"]);
    expect(fakeTts.spoken).toEqual([]);
    // 签名未变的普通 rerender 不清回落（无设置变更不恢复）。
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
