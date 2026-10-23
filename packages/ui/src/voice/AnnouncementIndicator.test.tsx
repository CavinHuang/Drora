// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementIndicator } from "./AnnouncementIndicator.js";

/**
 * 播报指示基础渲染守护（修复轮评审 #3）：speaking/annPaused 渲染（含 TID_VOICE_ANN_STOP
 * 层①停止按钮，FD-1），点击触发 onStopPressed；annIdle 不渲染。useDroraIntl fake 返回
 * 键名本身，断言以键为锚（locale 无关）。
 */

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

function renderIndicator(phase: "speaking" | "annPaused" | "annIdle") {
  const onStopPressed = vi.fn();
  render(<AnnouncementIndicator phase={phase} onStopPressed={onStopPressed} />);
  return { onStopPressed };
}

afterEach(() => {
  cleanup();
});

describe("AnnouncementIndicator 基础渲染（§9.3 / FD-1）", () => {
  it("speaking：渲染指示器 + 层①停止按钮，点击触发 onStopPressed", () => {
    const { onStopPressed } = renderIndicator("speaking");
    expect(screen.getByTestId("voice-ann-stop")).toBeTruthy();
    expect(screen.getByText("voice.ann.indicator")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-ann-stop"));
    expect(onStopPressed).toHaveBeenCalledTimes(1);
  });

  it("annPaused：仍渲染停止按钮（FD-1 任何播报态可立即静音）", () => {
    const { onStopPressed } = renderIndicator("annPaused");
    expect(screen.getByTestId("voice-ann-stop")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-ann-stop"));
    expect(onStopPressed).toHaveBeenCalledTimes(1);
  });

  it("annIdle：不渲染（零占位）", () => {
    renderIndicator("annIdle");
    expect(screen.queryByTestId("voice-ann-stop")).toBeNull();
    expect(screen.queryByText("voice.ann.indicator")).toBeNull();
  });
});
