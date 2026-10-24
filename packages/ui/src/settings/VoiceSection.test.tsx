// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";

/**
 * VoiceSection 交互守护（修复轮 F2 / S1 / S2 + §9.7 批次 A）：
 * - F2 读写往返：开关写路径写「真实新值」（hidden=!checked），读侧语义修复后
 *   开关状态与存储值一致（修复前写盘值恒等于当前显示值=定点死控件）；
 * - FD-5：acknowledged=false 时开关变更先弹披露，确认后本次开启生效、取消回落；
 * - S1：baseUrl onBlur 校验——合法 https 写入、明文非本机阻止写入+行内警告；
 * - §9.7.4 试听边界：禁用门（recording/播报非 idle）、不进播报腿状态机、重播 cancel+speak；
 * - §9.7.6 语速草稿态：中间态零写入、onBlur 越界回退+行内警告、外部变更草稿重同步；
 * - §9.7.2 system 音色 Select：「自动」→ ""、具体项 → name 原串、voiceschanged 订阅退订。
 */

// radix Select 内容挂载需要（jsdom 缺失）。
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const { settingsState, updateSettingsMock, stableServices } = vi.hoisted(() => {
  const updateSettingsMock = vi.fn(async (patch: Record<string, unknown>) => {
    settingsState.current = { ...settingsState.current, ...patch } as never;
  });
  const settingsState = {
    current: {
      voiceComposerEntryHidden: true,
      voiceAnnouncementEnabled: false,
      voiceAnnouncementVoice: "",
      voiceAnnouncementRate: 1,
      voiceAnnouncementLang: "",
      voicePersonaId: "",
      voiceDictationLang: "",
      voiceAsrEngine: "webSpeech",
      voiceVendorBaseUrl: "",
      voiceAsrVendorModel: "",
      voiceTtsEngine: "system",
      voiceTtsVendorModel: "",
      voiceTtsVendorVoice: "",
      voiceToolBriefEnabled: false,
      voicePrivacyDisclosureAcknowledged: true,
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
  return { settingsState, updateSettingsMock, stableServices };
});

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => stableServices,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: settingsState.current,
    update: (patch: Record<string, unknown>) => updateSettingsMock(patch),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

const { VoiceSection } = await import("./VoiceSection.js");
const { validateVoiceVendorBaseUrl } = await import("@/voice/voiceVendorBaseUrl.js");

function resetSettings(patch: Record<string, unknown> = {}): void {
  settingsState.current = {
    voiceComposerEntryHidden: true,
    voiceAnnouncementEnabled: false,
    voiceAnnouncementVoice: "",
    voiceAnnouncementRate: 1,
    voiceAnnouncementLang: "",
    voicePersonaId: "",
    voiceDictationLang: "",
    voiceAsrEngine: "webSpeech",
    voiceVendorBaseUrl: "",
    voiceAsrVendorModel: "",
    voiceTtsEngine: "system",
    voiceTtsVendorModel: "",
    voiceTtsVendorVoice: "",
    voiceToolBriefEnabled: false,
    voicePrivacyDisclosureAcknowledged: true,
    ...patch,
  };
}

/**
 * §9.7.2/§9.7.4 假 speechSynthesis：枚举 + voiceschanged 订阅 + speak/cancel 记录。
 * jsdom 缺 SpeechSynthesisUtterance —— 注入 fake 构造器使适配器缺省创建路径可用。
 */
interface FakeUtterance {
  text: string;
  lang: string;
  voice: { name: string; lang: string } | null;
  rate: number;
  volume: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function installFakeSpeechSynthesis(voices: Array<{ name: string; lang: string }>): {
  spoken: FakeUtterance[];
  cancelCount: () => number;
  voiceschangedListeners: () => number;
  fireVoicesChanged: () => void;
  setVoices: (next: Array<{ name: string; lang: string }>) => void;
} {
  const spoken: FakeUtterance[] = [];
  let cancelCalls = 0;
  let currentVoices = voices;
  const listeners = new Set<() => void>();
  class Utterance implements FakeUtterance {
    text = "";
    lang = "";
    voice: { name: string; lang: string } | null = null;
    rate = 1;
    volume = 1;
    addEventListener() {}
    removeEventListener() {}
  }
  const synth = {
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel: () => {
      cancelCalls += 1;
    },
    getVoices: () => currentVoices,
    addEventListener: (_type: "voiceschanged", listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "voiceschanged", listener: () => void) => {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
    writable: true,
  });
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = Utterance;
  return {
    spoken,
    cancelCount: () => cancelCalls,
    voiceschangedListeners: () => listeners.size,
    fireVoicesChanged: () => {
      for (const listener of Array.from(listeners)) {
        listener();
      }
    },
    setVoices: (next) => {
      currentVoices = next;
    },
  };
}

function renderSection() {
  return render(<VoiceSection />);
}

function entryToggle() {
  return screen.getByTestId("voice-entry-toggle");
}

const initialAnnouncementState = {
  phase: "annIdle" as const,
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

beforeEach(() => {
  updateSettingsMock.mockClear();
  resetSettings();
  useVoiceSessionStore.setState({ inputLeg: "idle", announcement: { ...initialAnnouncementState } });
});

afterEach(() => {
  cleanup();
});

describe("VoiceSection 开关读写往返（F2 回归）", () => {
  it("默认隐藏：开关 unchecked；点击开 → 写 hidden=false 且读回显示（往返一致）", async () => {
    const harness = renderSection();
    // 默认（hidden=true）→ 开关 unchecked。
    expect(entryToggle().getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(entryToggle());
    // 修复轮 F2：写=真实新值（hidden=false）。mock updateSettings 无 React 重渲染
    //（真实链路经 platform.onSettingsChanged→useSettings.refresh）——用例补 rerender
    // 模拟刷新后读侧生效。
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ voiceComposerEntryHidden: false });
    });
    harness.rerender(<VoiceSection />);
    expect(entryToggle().getAttribute("data-state")).toBe("checked");
    // 再点关 → 写 hidden=true，读回隐藏（往返闭合，非定点）。
    fireEvent.click(entryToggle());
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenLastCalledWith({ voiceComposerEntryHidden: true });
    });
    harness.rerender(<VoiceSection />);
    expect(entryToggle().getAttribute("data-state")).toBe("unchecked");
  });

  it("显式 hidden=false 的存量用户：开关渲染 checked（读侧=存储值）", () => {
    resetSettings({ voiceComposerEntryHidden: false });
    renderSection();
    expect(entryToggle().getAttribute("data-state")).toBe("checked");
  });

  it("FD-5：未确认时点开关 → 披露弹层；确认后本次开启生效（写 hidden+acknowledged）", async () => {
    resetSettings({ voicePrivacyDisclosureAcknowledged: false });
    renderSection();
    fireEvent.click(entryToggle());
    // 披露弹层出现，设置未写。
    await waitFor(() => {
      expect(screen.getByTestId("voice-privacy-disclosure-dialog")).toBeTruthy();
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    // 确认 → 本次开启生效（开关补丁随 acknowledged 一起写入，VoiceSection.handleAcknowledge）。
    fireEvent.click(screen.getByTestId("voice-privacy-acknowledge"));
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        voiceComposerEntryHidden: false,
        voicePrivacyDisclosureAcknowledged: true,
      });
    });
  });

  it("FD-5：未确认时取消 → 开关回落（设置未写）", async () => {
    resetSettings({ voicePrivacyDisclosureAcknowledged: false });
    renderSection();
    fireEvent.click(entryToggle());
    await waitFor(() => {
      expect(screen.getByTestId("voice-privacy-disclosure-dialog")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("voice-privacy-cancel"));
    await waitFor(() => {
      expect(screen.queryByTestId("voice-privacy-disclosure-dialog")).toBeNull();
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(entryToggle().getAttribute("data-state")).toBe("unchecked");
  });
});

describe("VoiceSection baseUrl 校验交互（S1）", () => {
  it("合法 https：onBlur 写入持久层", async () => {
    renderSection();
    const input = screen.getByTestId("voice-vendor-base-url");
    fireEvent.change(input, { target: { value: "https://api.siliconflow.cn/v1" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ voiceVendorBaseUrl: "https://api.siliconflow.cn/v1" });
    });
  });

  it("明文非本机地址：onBlur 阻止写入 + 行内警告（S1 UI 层）", async () => {
    renderSection();
    const input = screen.getByTestId("voice-vendor-base-url");
    fireEvent.change(input, { target: { value: "http://api.example.com/v1" } });
    fireEvent.blur(input);
    // 阻止写入：持久层保持空（合法值）。
    expect(updateSettingsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ voiceVendorBaseUrl: "http://api.example.com/v1" }),
    );
    // 行内警告可见。
    expect(screen.getByTestId("voice-vendor-base-url-warning")).toBeTruthy();
  });

  it("明文本机地址（localhost）：例外放行写入", async () => {
    renderSection();
    const input = screen.getByTestId("voice-vendor-base-url");
    fireEvent.change(input, { target: { value: "http://localhost:8080/v1" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({ voiceVendorBaseUrl: "http://localhost:8080/v1" });
    });
  });

  it("无法解析的地址：阻止写入 + 按 reason 显示解析警告（终审 S3）", () => {
    renderSection();
    const input = screen.getByTestId("voice-vendor-base-url");
    fireEvent.change(input, { target: { value: "not-a-url" } });
    fireEvent.blur(input);
    expect(updateSettingsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ voiceVendorBaseUrl: "not-a-url" }),
    );
    // 按 reason 分型：unparseable 不应显示「明文 HTTP」文案。
    expect(screen.getByTestId("voice-vendor-base-url-warning")).toBeTruthy();
    expect(screen.getByTestId("voice-vendor-base-url-warning").textContent).toContain(
      "unparseableWarning",
    );
  });

  it("数据流披露渲染条件收口（§9.6.2-6）：云引擎开启且 baseUrl 非空才渲染", () => {
    resetSettings({ voiceVendorBaseUrl: "https://api.siliconflow.cn/v1" });
    const harness = renderSection();
    // 默认 webSpeech/system：baseUrl 非空也不渲染（修复前按最大集过度声明）。
    expect(harness.container.textContent).not.toContain("voice.settings.vendor.dataHandler");
    resetSettings({ voiceVendorBaseUrl: "https://api.siliconflow.cn/v1", voiceTtsEngine: "cloud" });
    harness.rerender(<VoiceSection />);
    expect(harness.container.textContent).toContain("voice.settings.vendor.dataHandler");
  });
});

// validateVoiceVendorBaseUrl 冒烟（真实实现经 VoiceSection 间接消费，此处直测一次）。
describe("validateVoiceVendorBaseUrl smoke", () => {
  it("https ok / 明文远程 insecure", () => {
    expect(validateVoiceVendorBaseUrl("https://x/v1").ok).toBe(true);
    expect(validateVoiceVendorBaseUrl("http://x/v1").ok).toBe(false);
  });
});

describe("VoiceSection system 音色 Select（§9.7.2 V3-b/V3-c）", () => {
  const zhEnVoices = [
    { name: "Microsoft Huihui", lang: "zh-CN" },
    { name: "Microsoft Zira", lang: "en-US" },
    { name: "Kyoko", lang: "ja-JP" },
  ];

  function openSelect(): HTMLElement {
    const trigger = screen.getByTestId("voice-announcement-voice");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: "mouse" });
    return trigger;
  }

  it("选项 = 「自动」+ zh/en 命中项（ja 不出现）；选中具体项 → 写 name 原串", () => {
    installFakeSpeechSynthesis(zhEnVoices);
    renderSection();
    openSelect();
    expect(screen.getByText("Microsoft Huihui（zh-CN）")).toBeTruthy();
    expect(screen.getByText("Microsoft Zira（en-US）")).toBeTruthy();
    expect(screen.queryByText("Kyoko（ja-JP）")).toBeNull();
    fireEvent.click(screen.getByText("Microsoft Huihui（zh-CN）"));
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      voiceAnnouncementVoice: "Microsoft Huihui",
    });
  });

  it("选中「自动」→ 写空串（系统默认）", () => {
    resetSettings({ voiceAnnouncementVoice: "Microsoft Huihui" });
    installFakeSpeechSynthesis(zhEnVoices);
    renderSection();
    openSelect();
    fireEvent.click(screen.getByText("voice.settings.announcement.voice.default"));
    expect(updateSettingsMock).toHaveBeenLastCalledWith({ voiceAnnouncementVoice: "" });
  });

  it("首帧空表 = 仅「自动」+ 禁用加载占位；voiceschanged 后刷新为过滤列表；卸载后退订", () => {
    const synth = installFakeSpeechSynthesis([]);
    const harness = renderSection();
    openSelect();
    expect(screen.getByText("voice.settings.announcement.voice.loading")).toBeTruthy();
    // 挂载期订阅存活（listeners 计数断言）。
    expect(synth.voiceschangedListeners()).toBe(1);
    // voiceschanged 到达 → 打开中的列表原地刷新（zh/en 命中、ja 过滤、加载占位消失）。
    act(() => {
      synth.setVoices(zhEnVoices);
      synth.fireVoicesChanged();
    });
    expect(screen.getByText("Microsoft Huihui（zh-CN）")).toBeTruthy();
    expect(screen.getByText("Microsoft Zira（en-US）")).toBeTruthy();
    expect(screen.queryByText("Kyoko（ja-JP）")).toBeNull();
    expect(screen.queryByText("voice.settings.announcement.voice.loading")).toBeNull();
    harness.unmount();
    expect(synth.voiceschangedListeners()).toBe(0);
  });

  it("全部音色均非 zh/en → 回落全量列表（空死控件防护）", () => {
    installFakeSpeechSynthesis([
      { name: "Kyoko", lang: "ja-JP" },
      { name: "Yelda", lang: "tr-TR" },
    ]);
    renderSection();
    openSelect();
    expect(screen.getByText("Kyoko（ja-JP）")).toBeTruthy();
    expect(screen.getByText("Yelda（tr-TR）")).toBeTruthy();
  });
});

describe("VoiceSection 云音色输入（§9.7.3）", () => {
  it("自由文本直写 voiceTtsVendorVoice（照 ttsVendorModel 同形态）", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    const input = screen.getByTestId("voice-vendor-tts-voice");
    fireEvent.change(input, { target: { value: "alex" } });
    expect(updateSettingsMock).toHaveBeenLastCalledWith({ voiceTtsVendorVoice: "alex" });
  });
});

describe("VoiceSection 试听边界（§9.7.4 V5-a/b/c）", () => {
  it("点按 = 恰一次 speak（解析值透传）且播报腿状态零变化", () => {
    const synth = installFakeSpeechSynthesis([
      { name: "Microsoft Huihui", lang: "zh-CN" },
    ]);
    resetSettings({
      voiceAnnouncementVoice: "Microsoft Huihui",
      voiceAnnouncementRate: 1.5,
    });
    renderSection();
    const before = { ...useVoiceSessionStore.getState().announcement };
    fireEvent.click(screen.getByTestId("voice-announcement-voice-preview"));
    const after = useVoiceSessionStore.getState().announcement;
    // 不进播报腿状态机：相位/claim 态逐字段相等。
    expect(after).toEqual(before);
    expect(after.claimHeld).toBe(false);
    // 恰一次 speak（不进 planner 队列重试）。
    expect(synth.spoken).toHaveLength(1);
  });

  it("speak 参数 = previewText 键值 + 解析后播报语言 + 选中音色 + 当前语速", () => {
    const synth = installFakeSpeechSynthesis([
      { name: "Microsoft Huihui", lang: "zh-CN" },
      { name: "Microsoft Zira", lang: "en-US" },
    ]);
    resetSettings({
      voiceAnnouncementVoice: "Microsoft Zira",
      voiceAnnouncementRate: 1.5,
      voiceAnnouncementLang: "en-US",
    });
    renderSection();
    fireEvent.click(screen.getByTestId("voice-announcement-voice-preview"));
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.text).toBe("voice.settings.announcement.voice.previewText");
    expect(synth.spoken[0]?.lang).toBe("en-US"); // 显式键优先于 UI locale（zh-CN）
    expect(synth.spoken[0]?.voice?.name).toBe("Microsoft Zira");
    expect(synth.spoken[0]?.rate).toBe(1.5);
  });

  it("voiceAnnouncementLang 缺省 = UI locale（现状语义）且音色空 = 系统默认（voice null）", () => {
    const synth = installFakeSpeechSynthesis([{ name: "Microsoft Huihui", lang: "zh-CN" }]);
    renderSection();
    fireEvent.click(screen.getByTestId("voice-announcement-voice-preview"));
    expect(synth.spoken[0]?.lang).toBe("zh-CN");
    expect(synth.spoken[0]?.voice).toBeNull();
  });

  it("禁用门：inputLeg=recording 或播报腿非 AnnIdle → disabled 且点按零 speak", () => {
    const synth = installFakeSpeechSynthesis([{ name: "Microsoft Huihui", lang: "zh-CN" }]);
    renderSection();
    const button = screen.getByTestId("voice-announcement-voice-preview") as HTMLButtonElement;
    act(() => {
      useVoiceSessionStore.setState({ inputLeg: "recording" });
    });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(synth.spoken).toHaveLength(0);
    act(() => {
      useVoiceSessionStore.setState({
        inputLeg: "idle",
        announcement: { ...initialAnnouncementState, phase: "speaking" },
      });
    });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(synth.spoken).toHaveLength(0);
    // 回到空闲 → 恢复可用。
    act(() => {
      useVoiceSessionStore.setState({ announcement: { ...initialAnnouncementState } });
    });
    expect(button.disabled).toBe(false);
  });

  it("播放中再次点按 = 先 cancel 后 speak（preview 实例内重播）", () => {
    const synth = installFakeSpeechSynthesis([{ name: "Microsoft Huihui", lang: "zh-CN" }]);
    renderSection();
    fireEvent.click(screen.getByTestId("voice-announcement-voice-preview"));
    const cancelsAfterFirst = synth.cancelCount();
    fireEvent.click(screen.getByTestId("voice-announcement-voice-preview"));
    expect(synth.spoken).toHaveLength(2);
    expect(synth.cancelCount()).toBeGreaterThan(cancelsAfterFirst);
  });
});

describe("VoiceSection 播报语言 Select（§9.7.5）", () => {
  function openLangSelect(): HTMLElement {
    const trigger = screen.getByTestId("voice-announcement-lang");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: "mouse" });
    return trigger;
  }

  it("选具体语言 → 写显式值", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    openLangSelect();
    fireEvent.click(screen.getByText("voice.settings.announcement.lang.en"));
    expect(updateSettingsMock).toHaveBeenLastCalledWith({ voiceAnnouncementLang: "en-US" });
  });

  it("从显式值选回「自动」→ 写空串", () => {
    resetSettings({ voiceAnnouncementLang: "en-US" });
    installFakeSpeechSynthesis([]);
    renderSection();
    openLangSelect();
    fireEvent.click(screen.getByText("voice.settings.announcement.lang.auto"));
    expect(updateSettingsMock).toHaveBeenLastCalledWith({ voiceAnnouncementLang: "" });
  });
});

describe("VoiceSection 语速草稿态（§9.7.6 V5-d/V5-e）", () => {
  it("中间态零写入：onChange 输入 0.3/空/abc → updateSettings 零调用", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    const input = screen.getByTestId("voice-announcement-rate");
    for (const value of ["0.3", "", "abc"]) {
      fireEvent.change(input, { target: { value } });
    }
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("onBlur 越界 → 草稿回退持久值 + 行内警告渲染", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    const input = screen.getByTestId("voice-announcement-rate") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.3" } });
    fireEvent.blur(input);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("voice-announcement-rate-warning")).toBeTruthy();
    expect(input.value).toBe("1"); // 回退持久值
  });

  it("onBlur 合法 1.5 → 恰一次 updateSettings({voiceAnnouncementRate: 1.5})", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    const input = screen.getByTestId("voice-announcement-rate");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({ voiceAnnouncementRate: 1.5 });
    expect(screen.queryByTestId("voice-announcement-rate-warning")).toBeNull();
  });

  it("草稿随外部变更重同步（控件外写入路径，V5-e）", () => {
    installFakeSpeechSynthesis([]);
    const harness = renderSection();
    const input = screen.getByTestId("voice-announcement-rate") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.3" } }); // 本地草稿（未落盘）
    expect(input.value).toBe("0.3");
    // 模拟外部 patch（如后续 persona 物化写入）：settings 变更 → 草稿重同步。
    resetSettings({ voiceAnnouncementRate: 1.3 });
    harness.rerender(<VoiceSection />);
    expect((screen.getByTestId("voice-announcement-rate") as HTMLInputElement).value).toBe("1.3");
  });
});

describe("VoiceSection persona 选择（§9.7.8 V7-a/V7-c）", () => {
  function openPersonaSelect(): HTMLElement {
    const trigger = screen.getByTestId("voice-persona");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: "mouse" });
    return trigger;
  }

  it("点选 builtin = 恰一次 updateSettings，patch 键集恰为五键且值 === 目录值（空串原样物化）", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    openPersonaSelect();
    fireEvent.click(screen.getByText("voice.settings.persona.preset.brisk"));
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      voicePersonaId: "brisk",
      voiceAnnouncementVoice: "",
      voiceTtsVendorVoice: "",
      voiceAnnouncementRate: 1.3,
      voiceAnnouncementLang: "",
    });
  });

  it("「自定义」不出现在 SelectItem 列表（派生档不可点选）", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    openPersonaSelect();
    // 「自定义」文案只出现在触发器（SelectValue children 显示派生档），列表内不出现。
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryByText("voice.settings.persona.custom")).toBeNull();
    // builtin 四档全部在列。
    for (const id of ["standard", "brisk", "composed", "narration"]) {
      expect(within(listbox).getByText(`voice.settings.persona.preset.${id}`)).toBeTruthy();
    }
    expect(screen.getAllByText("voice.settings.persona.custom")).toHaveLength(1);
  });

  it("四键与 preset 物化值逐项相等 → 触发器显示该 preset（非自定义）", () => {
    installFakeSpeechSynthesis([]);
    resetSettings({
      voicePersonaId: "brisk",
      voiceAnnouncementVoice: "",
      voiceTtsVendorVoice: "",
      voiceAnnouncementRate: 1.3,
      voiceAnnouncementLang: "",
    });
    renderSection();
    const trigger = screen.getByTestId("voice-persona");
    expect(trigger.textContent).toContain("voice.settings.persona.preset.brisk");
    expect(trigger.textContent).not.toContain("voice.settings.persona.custom");
  });

  it("手改任一底层键 → 触发器显示「自定义」且不回写（渲染/开列表零写入）", () => {
    installFakeSpeechSynthesis([]);
    // 选 brisk 后手改语速（发散）。
    resetSettings({
      voicePersonaId: "brisk",
      voiceAnnouncementVoice: "",
      voiceTtsVendorVoice: "",
      voiceAnnouncementRate: 1,
      voiceAnnouncementLang: "",
    });
    renderSection();
    const trigger = screen.getByTestId("voice-persona");
    expect(trigger.textContent).toContain("voice.settings.persona.custom");
    // 显示派生只读不写：渲染与开列表零 updateSettings（voicePersonaId 持久值仍 brisk）。
    expect(updateSettingsMock).not.toHaveBeenCalled();
    openPersonaSelect();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(settingsState.current.voicePersonaId).toBe("brisk");
  });

  it("未选（空串）/未知 id → 显示「自定义」", () => {
    installFakeSpeechSynthesis([]);
    renderSection();
    expect(screen.getByTestId("voice-persona").textContent).toContain("voice.settings.persona.custom");
    cleanup();
    resetSettings({ voicePersonaId: "removed-in-future" });
    renderSection();
    expect(screen.getByTestId("voice-persona").textContent).toContain("voice.settings.persona.custom");
  });

  it("发散态下切至另一 preset：写该 preset 五键 patch（voicePersonaId 换新 id）", () => {
    installFakeSpeechSynthesis([]);
    resetSettings({
      voicePersonaId: "brisk",
      voiceAnnouncementRate: 1, // 发散 → 显示自定义
    });
    renderSection();
    openPersonaSelect();
    fireEvent.click(screen.getByText("voice.settings.persona.preset.narration"));
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      voicePersonaId: "narration",
      voiceAnnouncementVoice: "",
      voiceTtsVendorVoice: "",
      voiceAnnouncementRate: 1,
      voiceAnnouncementLang: "zh-CN",
    });
  });

  it("物化写语速后草稿随外部变更重同步（persona 是控件外写入路径，V5-e persona 面）", () => {
    installFakeSpeechSynthesis([]);
    const harness = renderSection();
    openPersonaSelect();
    fireEvent.click(screen.getByText("voice.settings.persona.preset.brisk"));
    // 模拟 updateSettings 生效后的 settings 刷新（真实链路经 onSettingsChanged）。
    resetSettings({
      voicePersonaId: "brisk",
      voiceAnnouncementRate: 1.3,
    });
    harness.rerender(<VoiceSection />);
    expect((screen.getByTestId("voice-announcement-rate") as HTMLInputElement).value).toBe("1.3");
    // persona 档位未发散 → 触发器显示 brisk。
    expect(screen.getByTestId("voice-persona").textContent).toContain(
      "voice.settings.persona.preset.brisk",
    );
  });
});
