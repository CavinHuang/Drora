// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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
const { fakeWebSpeech } = vi.hoisted(() => {
  const partialSubscribers = new Set<(text: string) => void>();
  return {
    partialSubscribers,
    fakeWebSpeech: {
      isSupported: () => true,
      emitPartial: (text: string) => {
        for (const cb of Array.from(partialSubscribers)) cb(text);
      },
      start: vi.fn(),
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

  it("录音态正常渲染：停止图标 + 绑定会话预览条容器", () => {
    const harness = renderEntry();
    voiceStore.setState({ inputLeg: "recording" });
    harness.rerender(
      <V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />,
    );
    const entry = harness.queryByTestId("v4-composer-voice-entry");
    expect(entry).not.toBeNull();
    expect(entry?.getAttribute("data-voice-leg")).toBe("recording");
    expect(entry?.getAttribute("aria-pressed")).toBe("true");
  });

  it("partial 到达只进预览条字段（S7 投影回归：partialText→UI、正文通道零变化）", () => {
    const harness = renderEntry();
    // store 驱动：真实 onPartial→setPartial 链已由 useVoiceDictation.test 覆盖；
    // 此处断言录音态下 partialText 的 UI 投影（绑定 pane 门控）。
    voiceStore.setState({
      inputLeg: "recording",
      boundSessionId: "sess-1",
      partialText: "半句",
    });
    harness.rerender(<V4ComposerVoiceEntry sessionId="sess-1" workspacePath="/ws" />);
    expect(harness.container.textContent).toContain("半句");
    expect(voiceStore.getState().pendingFinalText).toBeNull();
  });
});
