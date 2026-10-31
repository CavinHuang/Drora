// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WebRemoteControlRelaySourceSection 交互守护（specs/relay-v2-server.md §8.7）：
 * - 默认折叠，官方为缺省选中态；
 * - 自建模式空地址/非法地址：行内报错且不写设置、不重启；
 * - 合法地址保存：写设置键 → 停止旧远控 → 触发弹窗重启（onRestart）；
 * - 已有自建值时切回官方：空串哨兵清除设置键并重启。
 */

const { settingsState, updateSettingsMock, stopWebRemoteControlMock } = vi.hoisted(() => {
  const updateSettingsMock = vi.fn(async (patch: Record<string, unknown>) => {
    settingsState.current = { ...settingsState.current, ...patch } as never;
  });
  const settingsState = {
    current: {
      webRemoteControlRelayOrigin: undefined as string | undefined,
    },
  };
  const stopWebRemoteControlMock = vi.fn(async () => undefined);
  return { settingsState, updateSettingsMock, stopWebRemoteControlMock };
});

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: settingsState.current,
    update: (patch: Record<string, unknown>) => updateSettingsMock(patch),
  }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    stopWebRemoteControl: stopWebRemoteControlMock,
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: vi.fn(),
}));

const { WebRemoteControlRelaySourceSection } = await import(
  "./WebRemoteControlRelaySourceSection.js"
);

function renderSection(onRestart: () => void = vi.fn()) {
  return render(<WebRemoteControlRelaySourceSection onRestart={onRestart} />);
}

function openSection(): void {
  fireEvent.click(screen.getByTestId("web-remote-control-relay-source-trigger"));
}

function expectRadioChecked(labelText: string, checked: boolean): void {
  expect(screen.getByLabelText(labelText).getAttribute("aria-checked")).toBe(
    checked ? "true" : "false",
  );
}

beforeEach(() => {
  settingsState.current = { webRemoteControlRelayOrigin: undefined };
  updateSettingsMock.mockClear();
  stopWebRemoteControlMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("WebRemoteControlRelaySourceSection", () => {
  it("官方为缺省选中态，展开后可选自建", () => {
    renderSection();
    openSection();

    expectRadioChecked("webRemoteControl.relaySource.official", true);
    expectRadioChecked("webRemoteControl.relaySource.custom", false);

    // 官方模式下不出现地址输入框。
    expect(screen.queryByTestId("web-remote-control-relay-source-origin")).toBeNull();
  });

  it("已有自建设置时默认选中自建并回填地址", () => {
    settingsState.current = { webRemoteControlRelayOrigin: "https://relay.example.com" };
    renderSection();
    openSection();

    expectRadioChecked("webRemoteControl.relaySource.custom", true);
    const originInput = screen.getByTestId(
      "web-remote-control-relay-source-origin",
    ) as HTMLInputElement;
    expect(originInput.value).toBe("https://relay.example.com");
  });

  it("自建模式空地址：行内报错，不写设置不重启", async () => {
    const onRestart = vi.fn();
    renderSection(onRestart);
    openSection();

    fireEvent.click(screen.getByLabelText("webRemoteControl.relaySource.custom"));
    fireEvent.click(screen.getByTestId("web-remote-control-relay-source-apply"));

    await waitFor(() => {
      expect(screen.queryByTestId("web-remote-control-relay-source-error")).toBeTruthy();
    });
    expect(
      screen.getByTestId("web-remote-control-relay-source-error").textContent,
    ).toContain("webRemoteControl.relaySource.originRequired");
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(stopWebRemoteControlMock).not.toHaveBeenCalled();
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("非法地址：行内报错，不写设置", async () => {
    renderSection();
    openSection();

    fireEvent.click(screen.getByLabelText("webRemoteControl.relaySource.custom"));
    fireEvent.change(screen.getByTestId("web-remote-control-relay-source-origin"), {
      target: { value: "not a url" },
    });
    fireEvent.click(screen.getByTestId("web-remote-control-relay-source-apply"));

    await waitFor(() => {
      expect(screen.queryByTestId("web-remote-control-relay-source-error")).toBeTruthy();
    });
    expect(
      screen.getByTestId("web-remote-control-relay-source-error").textContent,
    ).toContain("webRemoteControl.relaySource.originInvalid");
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("合法地址保存：写设置键 → 停止旧远控 → 触发重启", async () => {
    const onRestart = vi.fn();
    renderSection(onRestart);
    openSection();

    fireEvent.click(screen.getByLabelText("webRemoteControl.relaySource.custom"));
    fireEvent.change(screen.getByTestId("web-remote-control-relay-source-origin"), {
      target: { value: " https://relay.example.com/base " },
    });
    fireEvent.click(screen.getByTestId("web-remote-control-relay-source-apply"));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        webRemoteControlRelayOrigin: "https://relay.example.com",
      });
    });
    await waitFor(() => {
      expect(stopWebRemoteControlMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onRestart).toHaveBeenCalled();
    });
    // 顺序约束：先落盘、再停止、最后重启。
    const updateOrder = updateSettingsMock.mock.invocationCallOrder[0] ?? 0;
    const stopOrder = stopWebRemoteControlMock.mock.invocationCallOrder[0] ?? 0;
    const restartOrder = onRestart.mock.invocationCallOrder[0] ?? 0;
    expect(stopOrder).toBeGreaterThan(updateOrder);
    expect(restartOrder).toBeGreaterThan(stopOrder);
  });

  it("切回官方：空串哨兵清除设置键并重启", async () => {
    settingsState.current = { webRemoteControlRelayOrigin: "https://relay.example.com" };
    const onRestart = vi.fn();
    renderSection(onRestart);
    openSection();

    fireEvent.click(screen.getByLabelText("webRemoteControl.relaySource.official"));
    fireEvent.click(screen.getByTestId("web-remote-control-relay-source-apply"));

    await act(async () => {});
    expect(updateSettingsMock).toHaveBeenCalledWith({ webRemoteControlRelayOrigin: "" });
    expect(stopWebRemoteControlMock).toHaveBeenCalled();
    expect(onRestart).toHaveBeenCalled();
  });
});
