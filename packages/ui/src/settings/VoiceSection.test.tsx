// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VoiceSection 交互守护（修复轮 F2 / S1 / S2）：
 * - F2 读写往返：开关写路径写「真实新值」（hidden=!checked），读侧语义修复后
 *   开关状态与存储值一致（修复前写盘值恒等于当前显示值=定点死控件）；
 * - FD-5：acknowledged=false 时开关变更先弹披露，确认后本次开启生效、取消回落；
 * - S1：baseUrl onBlur 校验——合法 https 写入、明文非本机阻止写入+行内警告。
 */

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
      voiceDictationLang: "",
      voiceAsrEngine: "webSpeech",
      voiceVendorBaseUrl: "",
      voiceAsrVendorModel: "",
      voiceTtsEngine: "system",
      voiceTtsVendorModel: "",
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
    voiceDictationLang: "",
    voiceAsrEngine: "webSpeech",
    voiceVendorBaseUrl: "",
    voiceAsrVendorModel: "",
    voiceTtsEngine: "system",
    voiceTtsVendorModel: "",
    voiceToolBriefEnabled: false,
    voicePrivacyDisclosureAcknowledged: true,
    ...patch,
  };
}

function renderSection() {
  return render(<VoiceSection />);
}

function entryToggle() {
  return screen.getByTestId("voice-entry-toggle");
}

beforeEach(() => {
  updateSettingsMock.mockClear();
  resetSettings();
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
