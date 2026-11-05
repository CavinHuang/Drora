// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVoiceCommandHandlersForTest } from "./voiceCommandBus.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import { logger } from "@/logger.js";

/**
 * 播报接线 wiring 守护（specs/voice-agent-integration.md §9.3 / §3.5-4 / §4.3）：
 * mock provider hooks（services/settings/intl）与 TTS 适配器后整链驱动 useVoiceAnnouncement——
 * 轮尾消费、开关关闭 release（§3.5-4 第三时机）、focus 离开停播、打断词总线端到端
 * （dispatch stopAnnouncement → 停播不续播）、cancelTask → requestTaskStop 分发。
 */

const { fakeTts } = vi.hoisted(() => {
  class FakeHandle {
    constructor(readonly utteranceId: string) {}
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

const {
  settingsState,
  ttsCapabilityState,
  cloudTtsState,
  stableServices,
  providerConnectionControls,
} = vi.hoisted(() => {
  const settingsState = {
    current: {
      voiceAnnouncementEnabled: true,
      voiceAnnouncementVoice: "",
      voiceAnnouncementRate: 1,
      voiceToolBriefEnabled: false,
    } as {
      voiceAnnouncementEnabled: boolean;
      voiceAnnouncementVoice: string;
      voiceAnnouncementRate: number;
      voiceToolBriefEnabled: boolean;
    },
  };
  // 模型能力档案 tts 条目（specs/model-capabilities.md §5.2：引擎/厂商档数据源；
  // 旧 AppSettings voiceTtsEngine/voiceVendorBaseUrl/voiceTtsVendorModel 已删除）。
  // 用例内经 setTtsCapability 就地变更（service.get 返回引用，模拟档案写入后
  // onDidChange 到达的新快照；rerender 触发 hook 重渲染即重算引擎签名）。
  const ttsCapability = {
    engine: "system" as "system" | "cloud",
    providerRef: "",
    modelId: "",
    voice: "",
    baseUrlOverride: "",
  };
  const setTtsCapability = (patch: Partial<typeof ttsCapability>) => {
    Object.assign(ttsCapability, patch);
  };
  const asrCapability = {
    engine: "webSpeech" as "webSpeech" | "remote",
    providerRef: "",
    modelId: "",
    baseUrlOverride: "",
  };
  const setAsrCapability = (patch: Partial<typeof asrCapability>) => {
    Object.assign(asrCapability, patch);
  };
  const ttsCapabilityState = { current: ttsCapability, setTtsCapability, setAsrCapability };
  class FakeHandle {
    constructor(readonly utteranceId: string) {}
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
  const providerCard = {
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "sk-test-key",
  };
  let providerConnection: { baseUrl: string; apiKey: string } | null = providerCard;
  // 连接解析门闩：默认放行；pending 用例换成未决 Promise 后 getView 挂起。
  let connectionGate: Promise<void> = Promise.resolve();
  // 稳定 services 引用：mock 每渲染返回新对象会让解析器/cloudTts/tts/planner
  // 链式重建…（原注释并入上块）。原：getVendorApiKey/cloudTts/tts/planner
  // 链式重建，planner 变更 cleanup 触发旧实例 dispose 打断播报（评审 #2 关联根因）。
  const stableServices = {
    broadcastService: undefined,
    // §13：tts 连接（baseUrl+apiKey）经 providerSettingsService 按 providerRef 解析。
    providerSettingsService: {
      getView: async () => {
        await connectionGate;
        return {
          providers: [
            {
              providerId: "custom:tts-vendor",
              providerName: "SiliconFlow",
              enabled: true,
              effectiveConfig: {
                api: {
                  type: "openai-chat-completions",
                  baseUrl: providerConnection?.baseUrl ?? "",
                },
                access: providerConnection
                  ? { type: "api-key", apiKey: providerConnection.apiKey }
                  : { type: "api-key", apiKey: "" },
              },
            },
          ],
        };
      },
      // §15：asr 听写入口订阅卡变更重解析（useVoiceComposerEntry 连接对齐 TTS）。
      onDidChange: () => ({ dispose: () => undefined }),
    },
    credentialService: {
      // §9.9.3-M10：凭据读取可编程（默认即时返回；未加载用例替换为挂起/空串）。
      load: async (): Promise<string | null> => "sk-test-key",
      save: async () => undefined,
      delete: async () => undefined,
    },
    modelCapabilitiesService: {
      get: async () => ({
        schemaVersion: 2,
        capabilities: {
          "decision-jev": { enabled: false, providerKind: "typesafe", baseUrl: "", modelId: "" },
          embedding: {
            enabled: false,
            mode: "local",
            localModelId: "local-bge-small-zh-v1.5-int8",
          },
          asr: asrCapability,
          tts: ttsCapability,
          "image-generation": { enabled: false, providerRef: "", modelId: "", baseUrlOverride: "" },
        },
        migratedFromLegacySettings: true,
        migratedToProviderRef: true,
      }),
      update: async () => {
        throw new Error("not used in wiring test");
      },
      onDidChange: () => ({ dispose: () => undefined }),
    },
  };
  return {
    settingsState,
    ttsCapabilityState,
    cloudTtsState,
    stableServices,
    // §13：供应商卡连接可编程控制柄（ getView 闭包实时读 providerConnection）。
    providerConnectionControls: {
      get: () => providerConnection,
      set: (value: { baseUrl: string; apiKey: string } | null) => {
        providerConnection = value;
      },
      /** 用例间复位：恢复默认有效卡并放行门闩（防用例间状态泄漏）。 */
      reset: () => {
        providerConnection = providerCard;
        connectionGate = Promise.resolve();
      },
      /** 挂起连接解析（返回 release；release 后 getView 按当前 connection 放行）。 */
      hold: () => {
        let release!: () => void;
        connectionGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return release;
      },
    },
  };
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
  useOptionalServices: () => stableServices,
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
    announcementOwnerId: null,
    announcement: { ...initialAnnouncement },
    // §9.9.3-L8：跨用例重置已播权限账本（wiring 接 store 账本）。
    announcedPermissionIds: new Set<string>(),
  });
}

function makeUnit(turnId: string, texts: string[]): Record<string, unknown> {
  return {
    turnId,
    latestAssistantTextRow: { state: "complete", text: texts.join("") },
    assistantTextRows: texts.map((text) => ({ text })),
  };
}

/** §9.7.7 wiring 测试：只含 ToolCall 行的 unit（无正文 → 无轮尾消费，仅简报链路）。 */
function makeToolUnit(
  turnId: string,
  calls: Array<{ id: string; name?: string; status?: string }>,
): Record<string, unknown> {
  return {
    turnId,
    latestAssistantTextRow: null,
    assistantTextRows: [],
    assistantWorkRows: calls.map((call) => ({
      kind: "toolCall",
      toolCallId: call.id,
      toolName: call.name ?? "Edit",
      status: call.status ?? "running",
      inputText: "src/foo.ts",
    })),
  };
}

function briefSpoken(): string[] {
  return fakeTts.spoken.filter((text) => text === "voice.brief.prefix");
}

async function mountAnnouncement(params?: {
  units?: Record<string, unknown>[];
  pendingInteractions?: {
    interactionId: string;
    payload: { kind: string; toolName?: string; summary?: string };
  }[];
  focused?: boolean;
  sessionId?: string;
  requestTaskStop?: () => void;
  /** §9.9.3-M11：远控壳门控（缺省 false = 桌面行为）。 */
  isWebRemoteControl?: boolean;
}) {
  // units 延迟投递：模型能力档案经 useModelCapabilities 异步首载（服务契约 get 为
  // Promise）；先以空 units 挂载并 flush（档案快照就绪），再投递真实 units 触发轮尾
  // 消费 effect——对齐生产稳态（快照先于首个轮尾到达），避免首句引擎解析读到
  // 未加载态（specs/model-capabilities.md §4 fail-closed 语义）。
  const deliveredUnits = { current: [] as unknown[] };
  const deliveredPending = { current: [] as unknown[] };
  const harness = renderHook(() =>
    useVoiceAnnouncement({
      focused: params?.focused ?? true,
      sessionId: params?.sessionId ?? "sess-1",
      workspacePath: "/ws",
      units: deliveredUnits.current as never,
      pendingInteractions: deliveredPending.current as never,
      requestTaskStop: params?.requestTaskStop ?? (() => undefined),
      isWebRemoteControl: params?.isWebRemoteControl ?? false,
    }),
  );
  // claim acquire→startSpeaking 是异步链：flush 微任务保证断言前状态迁移完成。
  await vi.advanceTimersByTimeAsync(0);
  // units 与 pending 同轮投递：权限段与轮尾的相对次序（FD-3）保持在同一渲染 pass
  // 内判定（hook effect 声明序：轮尾先消费、权限段以优先级插队），与原挂载语义一致。
  deliveredUnits.current = params?.units ?? [];
  deliveredPending.current = params?.pendingInteractions ?? [];
  harness.rerender();
  await vi.advanceTimersByTimeAsync(0);
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeTts._reset();
  cloudTtsState.reset();
  resetStores();
  resetVoiceCommandHandlersForTest();
  // §9.9.3-M10：凭据默认即时加载（cloud 用例依赖）；未加载用例内替换为挂起 promise。
  stableServices.credentialService.load = async () => "sk-test-key";
  // §13：供应商卡连接复位（空 key/挂起用例不得泄漏到后续用例）。
  providerConnectionControls.reset();
  settingsState.current = {
    voiceAnnouncementEnabled: true,
    voiceAnnouncementVoice: "",
    voiceAnnouncementRate: 1,
    voiceToolBriefEnabled: false,
  };
  ttsCapabilityState.setTtsCapability({
    engine: "system",
    providerRef: "",
    modelId: "",
    voice: "",
    baseUrlOverride: "",
  });
  ttsCapabilityState.setAsrCapability({
    engine: "webSpeech",
    providerRef: "",
    modelId: "",
    baseUrlOverride: "",
  });
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
    dispatchVoiceCommand("cancelTask", { workspacePath: "/ws", sessionId: "sess-1" });
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
    dispatchVoiceCommand("cancelTask", { workspacePath: "/ws", sessionId: "sess-1" });
    expect(requestTaskStop).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().announcement.phase).toBe("annIdle");
    void harness;
  });

  it("cloud tts: falls back to speechSynthesis after consecutive failures (§9.6.5-3 回落)", async () => {
    // 连续失败信号由 cloudTtsAdapter fire（单测见 cloudTtsAdapter.test）；本用例验证
    // wiring 的回落开关：回落标记生效后 speak 走 speechSynthesis。
    // cloudTtsAdapter 在 wiring 层未 mock——settings engine=system 即走 synth（等价断言）。
    ttsCapabilityState.setTtsCapability({ engine: "system" });
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    expect(fakeTts.spoken).toEqual(["第一句。"]);
    expect(harness.result.current.indicatorPhase).toBe("speaking");
  });

  it("routes cloud engine speech and falls back to speechSynthesis on consecutive failures (§9.6.5-3)", async () => {
    ttsCapabilityState.setTtsCapability({
      engine: "cloud",
      providerRef: "custom:tts-vendor",
      modelId: "CosyVoice2-0.5B",
    });
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
    ttsCapabilityState.setTtsCapability({ engine: "system" });
    harness.rerender();
    harness.result.current.planner.consumeTurnTail({ turnId: "t2", text: "回落后句。" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeTts.spoken).toEqual(["回落后句。"]);
    expect(cloudTtsState.spoken).toEqual(["第一句。"]);
  });

  it("recovers cloud engine at the next resolution point after settings change (§9.6.5-3 至下一解析点恢复)", async () => {
    ttsCapabilityState.setTtsCapability({
      engine: "cloud",
      providerRef: "custom:tts-vendor",
      modelId: "CosyVoice2-0.5B",
    });
    const harness = await mountAnnouncement({ units: [makeUnit("t1", ["第一句。"])] });
    await vi.advanceTimersByTimeAsync(0);
    cloudTtsState.fireConsecutiveFailures();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.result.current.indicatorPhase).toBe("annIdle");

    // 用户修复供应商卡（同 providerRef、卡 baseUrl 变更）→ 连接解析恢复 → 下一解析点恢复 cloud。
    providerConnectionControls.set({
      baseUrl: "https://recovered.gateway/v1",
      apiKey: "sk-test-key",
    });
    ttsCapabilityState.setTtsCapability({ baseUrlOverride: "https://recovered.gateway/v1" });
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

  it("primes tool briefs on mount and re-primes at conversation switch (§9.7.7 V6-a/V6-b)", async () => {
    settingsState.current = { ...settingsState.current, voiceToolBriefEnabled: true };
    let sessionId = "sess-A";
    // 会话 A 挂载：投影含 10 条历史终态工具行 → 首帧 prime 消化 → 零简报（V6-b）。
    let units = [
      makeToolUnit(
        "turn-1",
        Array.from({ length: 10 }, (_, i) => ({
          id: `tc-h-${i}`,
          name: `Hist${i}`,
          status: "success",
        })),
      ),
    ];
    const harness = renderHook(() =>
      useVoiceAnnouncement({
        focused: true,
        sessionId,
        workspacePath: "/ws",
        units: units as never,
        requestTaskStop: () => undefined,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(briefSpoken()).toHaveLength(0);

    // 同会话后续快照（非 prime）：新 toolCallId 正常生成简报。
    units = [
      makeToolUnit("turn-1", [
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `tc-h-${i}`,
          name: `Hist${i}`,
          status: "success",
        })),
        { id: "tc-live", name: "Live", status: "running" },
      ]),
    ];
    harness.rerender();
    await vi.advanceTimersByTimeAsync(0);
    expect(briefSpoken()).toHaveLength(1);
    // 简报句播完（回 AnnIdle）+ 过全局最小间隔 5s（§9.7.7-2：lastAnnouncedAt 跨会话保留）。
    fakeTts.finishCurrent();
    await vi.advanceTimersByTimeAsync(5_100);

    // conversationKey 切至会话 B：resetSessionState（接线单点）+ B 首帧 prime——
    // B 的终态行（含 A 已 seen 复用同 id 的行）零上交，B 的 running 行正常候选（V6-a）。
    sessionId = "sess-B";
    units = [
      makeToolUnit("turn-b", [
        { id: "tc-live", name: "Replay", status: "success" },
        { id: "tc-b-live", name: "LiveB", status: "pendingApproval" },
      ]),
    ];
    harness.rerender();
    await vi.advanceTimersByTimeAsync(0);
    expect(briefSpoken()).toHaveLength(2);
    void harness;
  });

  it("credential pending: 凭据未加载时 cloud 引擎首句解析 system，加载完成后下一句起走 cloud（§9.9.3-M10）", async () => {
    ttsCapabilityState.setTtsCapability({
      engine: "cloud",
      providerRef: "custom:tts-vendor",
      modelId: "CosyVoice2-0.5B",
    });
    // §13：连接未解析 = 供应商卡数据挂起（getView 挂起 → cloudApiKeyRef null → 首句 system）。
    const savedConnection = providerConnectionControls.get();
    providerConnectionControls.set(null);
    const releaseConnection = providerConnectionControls.hold();
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      const harness = await mountAnnouncement({ units: [makeUnit("t1", ["首句。"])] });
      // 首句解析 system：占位消除后「未加载」不再伪装成「已加载非空」→ 不进 cloud 管线。
      // 回退即红：恢复 `apiKey: cloudApiKeyRef.current ?? "unknown"` 占位则首句走 cloud
      //（cloudTtsState.spoken 非空）且零 credential pending 日志。
      expect(fakeTts.spoken).toEqual(["首句。"]);
      expect(cloudTtsState.spoken).toEqual([]);
      // info 恰一次 credential pending（引擎变化一次性日志形态）。
      const pendingLogs = infoSpy.mock.calls.filter(
        ([scope, message]) =>
          scope === "voice.tts" && String(message).includes("credential pending"),
      );
      expect(pendingLogs).toHaveLength(1);
      // 连接解析完成（credentialBump = 新解析点）→ 下一句起走 cloud。
      providerConnectionControls.set(savedConnection);
      releaseConnection();
      await vi.advanceTimersByTimeAsync(0);
      harness.result.current.planner.consumeTurnTail({ turnId: "t2", text: "次句。" });
      await vi.advanceTimersByTimeAsync(0);
      expect(cloudTtsState.spoken).toEqual(["次句。"]);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("credential 空串：持续 system、零 cloud 管线调用（§9.9.3-M10 零回落计数）", async () => {
    ttsCapabilityState.setTtsCapability({
      engine: "cloud",
      providerRef: "custom:tts-vendor",
      modelId: "CosyVoice2-0.5B",
    });
    // §13 确认缺失：供应商卡在场但 apiKey 为空串 → 判档不完整，零 cloud speak
    //（连败计数构造性为零——缺失期根本不进 cloud 管线）。
    providerConnectionControls.set({ baseUrl: "https://api.siliconflow.cn/v1", apiKey: "" });
    await mountAnnouncement({ units: [makeUnit("t1", ["首句。"])] });
    expect(fakeTts.spoken).toEqual(["首句。"]);
    expect(cloudTtsState.spoken).toEqual([]);
  });

  it("远控壳（isWebRemoteControl）：就绪轮尾 + pending 权限 + 新工具行零消费零出声（§9.9.3-M11）", async () => {
    settingsState.current = { ...settingsState.current, voiceToolBriefEnabled: true };
    const harness = await mountAnnouncement({
      isWebRemoteControl: true,
      units: [
        makeUnit("t1", ["就绪轮尾。"]),
        makeToolUnit("t2", [{ id: "tc-1", name: "Edit", status: "running" }]),
      ],
      pendingInteractions: [
        {
          interactionId: "perm-1",
          payload: { kind: "permission", toolName: "Bash", summary: "要运行命令吗？" },
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);
    // §8.2/§8.3 冻结：自动播报腿属 desktop-continuous 语义——远控壳零 consumeTurnTail/
    // 零权限段/零简报/零 tts.speak（planner/claim 实例照常创建，hook 整挂载）。
    // 回退即红：去掉 isWebRemoteControl 门（hook 忽略参数）则 spoken 非空。
    expect(fakeTts.spoken).toEqual([]);
    expect(cloudTtsState.spoken).toEqual([]);
    expect(useVoiceSessionStore.getState().announcement).toMatchObject({
      phase: "annIdle",
      uninterruptible: false,
      claimHeld: false,
    });
    // 桌面（非远控）同条件正常消费（上方既有用例全量回归，此处零额外断言）。
    void harness;
  });
});

describe("§9.9.4-L13 cloudFallback 恢复签名纳入凭据指纹", () => {
  it("回落置位后用户补凭据（load null→非空）→ 清回落标记且下一句走 cloud，日志零凭据原文", async () => {
    ttsCapabilityState.setTtsCapability({
      engine: "cloud",
      providerRef: "custom:tts-vendor",
      modelId: "CosyVoice2-0.5B",
    });
    // §13：连接挂起（getView 门闩未放行 → cloudApiKeyRef null = 未加载）。
    providerConnectionControls.set(null);
    const releaseConnection = providerConnectionControls.hold();
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    try {
      const harness = await mountAnnouncement({ units: [makeUnit("t1", ["首句。"])] });
      // 首句 system（凭据未加载不进 cloud 管线，§9.9.3-M10）。
      expect(fakeTts.spoken).toEqual(["首句。"]);
      // 连续失败信号 → 会话内回落标记置位。
      cloudTtsState.fireConsecutiveFailures();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.result.current.indicatorPhase).toBe("annIdle");
      // 用户补 apiKey：凭据 load null→非空 → credentialBump 解析点 → 签名的凭据
      // 分量 absent→present → cloudFallbackRef 清除（rerender 强制渲染提交使签名
      // effect 在下一句 speak 前落定）。
      providerConnectionControls.set(
        providerConnectionControls.get() ?? {
          baseUrl: "https://api.siliconflow.cn/v1",
          apiKey: "sk-test-key",
        },
      );
      releaseConnection();
      await vi.advanceTimersByTimeAsync(0);
      harness.rerender();
      await vi.advanceTimersByTimeAsync(0);
      harness.result.current.planner.consumeTurnTail({ turnId: "t2", text: "恢复句。" });
      await vi.advanceTimersByTimeAsync(0);
      // 回退即红：签名去掉凭据分量则回落不解除——恢复句走 synth（cloudTtsState 空）。
      expect(cloudTtsState.spoken).toEqual(["恢复句。"]);
      expect(fakeTts.spoken).toEqual(["首句。"]);
      // §7.1 延伸边界：本轮全部日志零凭据原文/指纹值。
      for (const call of infoSpy.mock.calls) {
        expect(String(call[1])).not.toContain("sk-test-key");
      }
    } finally {
      infoSpy.mockRestore();
    }
  });
});

// §9.8：审查复现转正式回归。
it("§9.8 regression: a voice cancel bound to session A must not reach session B", async () => {
  const stopA = vi.fn(),
    stopB = vi.fn();
  await mountAnnouncement({ sessionId: "A", requestTaskStop: stopA });
  await mountAnnouncement({ sessionId: "B", focused: false, requestTaskStop: stopB });
  const { dispatchVoiceCommand } = await import("./voiceCommandBus.js");
  dispatchVoiceCommand("cancelTask", { workspacePath: "/ws", sessionId: "A" });
  expect(stopA).toHaveBeenCalledTimes(1);
  expect(stopB).not.toHaveBeenCalled();
});

it("§9.8 regression: remote ASR entry must work without SpeechRecognition", async () => {
  Object.assign(settingsState.current, {
    voiceComposerEntryHidden: false,
    voicePrivacyDisclosureAcknowledged: true,
  });
  // 引擎/厂商档读模型能力档案 asr 条目（specs/model-capabilities.md §5.2，MC-10）。
  ttsCapabilityState.setAsrCapability({
    engine: "remote",
    providerRef: "custom:tts-vendor",
    modelId: "asr",
  });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported() {
        return true;
      }
    },
  );
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  const { useVoiceComposerEntry } = await import("./useVoiceComposerEntry.js");
  const h = renderHook(() => useVoiceComposerEntry({ sessionId: "A", workspacePath: "/ws" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const visible = h.result.current.view.visible;
  h.unmount();
  vi.unstubAllGlobals();
  expect(visible).toBe(true);
});
