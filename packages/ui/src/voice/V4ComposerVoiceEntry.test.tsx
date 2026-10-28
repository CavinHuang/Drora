// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";

/**
 * 组件级渲染断言（修复轮评审 #3：能捕获原 F1/F2 缺陷）：
 * - F1 回归：notice 在 idle 态可见（修复前渲染入口只认 recording 态 → 零可见帧）、
 *   TTL 到期消失并清 store、录音态正常渲染；
 * - F2 回归：voiceComposerEntryHidden=false → 入口渲染；=true/缺省 → 不渲染
 *   （修复前读侧反转导致开关关闭时入口显示、开启时隐藏的死控件）。
 */

const { settingsState, stableServices, fakePlatform } = vi.hoisted(() => {
  const settingsState = {
    current: {
      voiceComposerEntryHidden: false,
      voiceAnnouncementEnabled: false,
      voiceAnnouncementVoice: "",
      voiceAnnouncementRate: 1,
      voiceDictationLang: "",
      voiceAsrEngine: "webSpeech" as "webSpeech" | "remote",
      voiceToolBriefEnabled: false,
      voicePrivacyDisclosureAcknowledged: true,
      voiceVendorBaseUrl: "",
      voiceAsrVendorModel: "",
      voiceTtsEngine: "system" as "system" | "cloud",
      voiceTtsVendorModel: "",
    },
  };
  const stableServices = {
    broadcastService: undefined,
    credentialService: {
      load: async () => "sk-test-key",
      save: async () => undefined,
      delete: async () => undefined,
    },
  };
  const fakePlatform = {};
  return { settingsState, stableServices, fakePlatform };
});

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => stableServices,
  useOptionalServices: () => stableServices,
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => fakePlatform,
  useOptionalPlatform: () => fakePlatform,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: settingsState.current, update: vi.fn(async () => undefined) }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

// webSpeech 适配器：能力面恒 true（入口渲染前置条件）+ onPartial 收集（F1 partial 可见性）。
// §9.9.4-L6：start 返回最小 fake 会话——owner 判定换轨后，测试经真实点按路径建立
// recordingOwnerEntryId（setState 直造态不再命中持有者渲染）。
const { fakeWebSpeech } = vi.hoisted(() => {
  const partialSubscribers = new Set<(text: string) => void>();
  const fakeSession = {
    onFinal: () => () => undefined,
    onError: () => () => undefined,
    abort: () => undefined,
    stop: () => Promise.resolve({ final: "" }),
  };
  return {
    partialSubscribers,
    fakeSession,
    fakeWebSpeech: {
      isSupported: () => true,
      emitPartial: (text: string) => {
        for (const cb of Array.from(partialSubscribers)) cb(text);
      },
      start: vi.fn(() => Promise.resolve(fakeSession)),
      onPartial: (cb: (text: string) => void) => {
        partialSubscribers.add(cb);
        return () => partialSubscribers.delete(cb);
      },
    },
  };
});

vi.mock("@/voice/webSpeechAsrAdapter.js", () => ({
  createWebSpeechAsrAdapter: () => fakeWebSpeech,
  mapGetUserMediaError: () => new Error("unused"),
}));

vi.mock("@/store/droraSessionStore.js", () => ({
  useDroraSessionStore: {
    getState: () => ({
      requestComposerTextInsert: () => 1,
    }),
  },
}));

// ControlHintTooltip 依赖 Radix TooltipProvider：mock 为直通容器。
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({
    children,
  }: {
    children: import("react").ReactNode;
    title: string;
  }) => children,
}));

const { V4ComposerVoiceEntry } = await import("./V4ComposerVoiceEntry.js");
const voiceStore = useVoiceSessionStore;

function resetStores(notice: { code: "permission" | "network"; at: number } | null = null): void {
  voiceStore.setState({
    inputLeg: "idle",
    boundSessionId: "sess-1",
    partialText: "",
    notice,
    lastDictation: null,
    pendingFinalText: null,
    recordingPulseSeq: 0,
    recordingOwnerEntryId: null,
    announcement: {
      phase: "annIdle",
      sentenceIndex: 0,
      sentenceCount: 0,
      claimHeld: false,
      pauseRequested: false,
      uninterruptible: false,
    },
  });
}

function setSettings(patch: Partial<typeof settingsState.current>): void {
  settingsState.current = { ...settingsState.current, ...patch };
}

function renderEntry() {
  return render(<V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  setSettings({
    voiceComposerEntryHidden: false,
    voiceAnnouncementEnabled: false,
    voiceAnnouncementVoice: "",
    voiceAnnouncementRate: 1,
    voiceDictationLang: "",
    voiceAsrEngine: "webSpeech",
    voiceToolBriefEnabled: false,
    voicePrivacyDisclosureAcknowledged: true,
    voiceVendorBaseUrl: "",
    voiceAsrVendorModel: "",
    voiceTtsEngine: "system",
    voiceTtsVendorModel: "",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("V4ComposerVoiceEntry 组件级渲染（修复轮 F1/F2 回归）", () => {
  it("F2 回归：开关开启（hidden=false）→ 入口渲染（修复前读侧反转致隐藏）", () => {
    setSettings({ voiceComposerEntryHidden: false });
    const harness = renderEntry();
    expect(harness.queryByTestId("v4-composer-voice-entry")).not.toBeNull();
  });

  it("F2 回归：开关关闭/缺省（hidden=true）→ 入口不渲染", () => {
    setSettings({ voiceComposerEntryHidden: true });
    const harness = renderEntry();
    expect(harness.queryByTestId("v4-composer-voice-entry")).toBeNull();
    // 缺省（无键）→ 隐藏。
    setSettings({ ...settingsState.current, voiceComposerEntryHidden: undefined } as never);
    harness.rerender(<V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />);
    expect(harness.queryByTestId("v4-composer-voice-entry")).toBeNull();
  });

  it("F1 回归：idle 态的 notice 可见（修复前零可见帧）", () => {
    const harness = renderEntry();
    // 权限拒绝 → failMicRequest：idle + notice 同批。
    voiceStore.setState({
      inputLeg: "idle",
      notice: { code: "permission", at: Date.now() },
    });
    harness.rerender(
      <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />,
    );
    // 提示条在 idle 态渲染（修复前渲染门只认 recording → 零可见帧）。
    expect(harness.queryByTestId("voice-privacy-disclosure-dialog")).toBeNull();
    expect(document.body.textContent).toContain("voice.dictation.error.permission");
  });

  it("F1 独立回归钉：notice 与 boundSessionId 清空同批（生产写点形态）→ 不经绑定分支仍可见", () => {
    // 生产写点（failMicRequest 等）notice 写入与 boundSessionId 清空同批——既有 F1 用例
    // 的 boundSessionId 恒为 sess-1（经 isBoundEntry 分支渲染），单独丢失 noticeVisible
    // 子句不会红。本用例镜像生产形态：bound 为空时 noticeVisible 子句独立成立。
    const harness = renderEntry();
    voiceStore.setState({
      inputLeg: "idle",
      boundSessionId: null,
      notice: { code: "permission", at: Date.now() },
    });
    harness.rerender(
      <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />,
    );
    expect(document.body.textContent).toContain("voice.dictation.error.permission");
  });

  it("notice TTL 到期后消失并清 store（§9.2 用户可见后自然消退）", () => {
    const harness = renderEntry();
    voiceStore.setState({
      inputLeg: "idle",
      notice: { code: "network", at: Date.now() },
    });
    harness.rerender(
      <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />,
    );
    expect(document.body.textContent).toContain("voice.dictation.error.network");
    // TTL 6s 到期：重渲染翻转 + 清 store（下次渲染彻底消失）。
    vi.advanceTimersByTime(6_000);
    expect(voiceStore.getState().notice).toBeNull();
    // act 外的定时器回调需要显式重渲染同步 UI。
    harness.rerender(
      <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />,
    );
    expect(harness.container.textContent).not.toContain("voice.dictation.error.network");
  });

  it("录音态正常渲染：停止图标 + 持有者预览条容器（§9.9.4-L6 owner 换轨）", async () => {
    const harness = renderEntry();
    // §9.9.4-L6：经真实点按路径建立 recordingOwnerEntryId（setState 直造态不再
    // 命中持有者渲染——owner 判定 = recordingOwnerEntryId === 本实例 entryId）。
    await act(async () => {
      fireEvent.click(harness.getByTestId("v4-composer-voice-entry"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(voiceStore.getState().inputLeg).toBe("recording");
    expect(voiceStore.getState().recordingOwnerEntryId).toBeTruthy();
    const entry = harness.queryByTestId("v4-composer-voice-entry");
    expect(entry).not.toBeNull();
    expect(entry?.getAttribute("data-voice-leg")).toBe("recording");
    expect(entry?.getAttribute("aria-pressed")).toBe("true");
  });

  it("partial 到达只进预览条字段（S7 投影回归：partialText→UI、正文通道零变化）", async () => {
    const harness = renderEntry();
    // store 驱动：真实 onPartial→setPartial 链已由 useVoiceDictation.test 覆盖；
    // 此处断言录音态下 partialText 的 UI 投影（§9.9.4-L6 持有者门控）。
    await act(async () => {
      fireEvent.click(harness.getByTestId("v4-composer-voice-entry"));
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      voiceStore.setState({ partialText: "半句" });
    });
    expect(harness.container.textContent).toContain("半句");
    expect(voiceStore.getState().pendingFinalText).toBeNull();
  });
});

describe("§9.9.4-L2/L6 owner 换轨与 requestingMic 可见反馈", () => {
  function renderTwoEntries() {
    // 同会话双 pane 双入口：A 先点按开录（持有者）。
    const paneA = render(
      <div>
        <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />
      </div>,
    );
    const entryA = within(paneA.container).getByTestId("v4-composer-voice-entry");
    return { paneA, entryA };
  }

  it("requestingMic 期预览条文案可达（§9.9.4-L2 既有键激活）", async () => {
    // start 挂起：腿停在 requestingMic（权限对话框被忽略场景，§5.3）。
    fakeWebSpeech.start.mockImplementationOnce(() => new Promise(() => undefined));
    const pane = render(<V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />);
    await act(async () => {
      fireEvent.click(pane.getByTestId("v4-composer-voice-entry"));
      await Promise.resolve();
    });
    expect(voiceStore.getState().inputLeg).toBe("requestingMic");
    // 预览条渲染 requestingMic 文案（intl mock 返回键名）。
    // 回退即红：恢复 recording-only bound 判定则预览条零可见帧（文案不可达）。
    expect(pane.container.textContent).toContain("voice.dictation.requestingMic");
  });

  it("同会话双 pane：仅持有者显示停止图标+预览条，第二入口普通 mic 零预览（§9.9.4-L6）", async () => {
    const { paneA, entryA } = renderTwoEntries();
    await act(async () => {
      fireEvent.click(entryA);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(voiceStore.getState().inputLeg).toBe("recording");
    expect(entryA.getAttribute("aria-pressed")).toBe("true");
    // pane B：同会话第二入口（不同 entryId 实例）——旧 sessionId 判定下也会双显。
    const paneB = render(
      <div>
        <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />
      </div>,
    );
    act(() => {
      voiceStore.setState({ partialText: "A 的半句" });
    });
    const entryB = within(paneB.container).getByTestId("v4-composer-voice-entry");
    // 回退即红：退回 boundSessionId === sessionId 判定则 B 也命中停止态与预览条。
    expect(entryB.getAttribute("aria-pressed")).toBe("false");
    expect(paneB.container.textContent).not.toContain("A 的半句");
    expect(paneA.container.textContent).toContain("A 的半句");
    // 他会话入口同样零活动段（跨会话 mic 不响应他会话录音）。
    const paneC = render(
      <div>
        <V4ComposerVoiceEntry sessionId="sess-2" workspacePath="/ws" />
      </div>,
    );
    expect(
      within(paneC.container).getByTestId("v4-composer-voice-entry").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(paneC.container.textContent).not.toContain("A 的半句");
  });

  it("第二入口点按：持有者脉冲高亮恰一次、非持有者零脉冲（§9.9.4-L6）", async () => {
    const { entryA } = renderTwoEntries();
    await act(async () => {
      fireEvent.click(entryA);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(voiceStore.getState().inputLeg).toBe("recording");
    const paneB = render(
      <div>
        <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />
      </div>,
    );
    const entryB = within(paneB.container).getByTestId("v4-composer-voice-entry");
    await act(async () => {
      fireEvent.click(entryB); // 第二点按 → store 拒绝 + recordingPulseSeq 递增。
      await Promise.resolve();
    });
    // 持有者 A 短暂高亮；B 零脉冲（回退即红：旧「inputLeg==="recording"」判定下
    // B 也高亮——任何挂载入口都命中）。按空白切分的完整 token 匹配（基础样式含
    // aria-invalid:ring-2 变体，子串匹配会误命中）。
    const hasPulseToken = (element: HTMLElement) =>
      element.className.split(/\s+/).includes("ring-2");
    expect(hasPulseToken(entryA)).toBe(true);
    expect(hasPulseToken(entryB)).toBe(false);
  });
});
