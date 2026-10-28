// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import { usePaneEscapeStopGeneration } from "./paneEscapeStopGeneration.js";

/**
 * §9.9.4-L3 窗口级 Esc 监听守护：注册条件去 canStop 前置（无任务态可达——录音中
 * 但无任务运行 + 焦点在对话区时 Esc 可停录音，§4.4 优先级 3 覆盖缺口）；停生成分支
 * canStop 现值守卫后置（无任务态无消费者 → Esc 无动作，§4.4 优先级 4 语义不变）。
 */

function resetVoiceStore(): void {
  useVoiceSessionStore.setState({ inputLeg: "idle", boundSessionId: null, partialText: "" });
}

function mountPaneEscape(params: {
  canStop?: boolean;
  handleStop?: (source: "escape") => void;
}) {
  const canStop = params.canStop ?? false;
  const handleStop: (source: "escape") => void = params.handleStop ?? (() => undefined);
  const canStopRef = () => canStop;
  const wrapper = renderHook(() => {
    const paneRef = useRef<HTMLDivElement>(document.createElement("div"));
    usePaneEscapeStopGeneration({
      focused: true,
      readOnly: false,
      sessionId: "sess-1",
      canStopRef,
      paneRef,
      // 测试无真实 pane DOM：授权对话外 Esc 直通（绕过 composedPath 归属检查）。
      allowEscapeStopOutsidePane: true,
      handleStop,
    });
    return handleStop;
  });
  return { harness: wrapper, handleStop };
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  resetVoiceStore();
});

afterEach(() => {
  cleanup();
});

describe("usePaneEscapeStopGeneration（§9.9.4-L3）", () => {
  it("录音中 canStop=false：Esc 停录音、零 v4 stop、preventDefault 恰一次", () => {
    const handleStop = vi.fn();
    expect(useVoiceSessionStore.getState().startMicRequest("sess-1", "entry-a")).toBe(true);
    expect(useVoiceSessionStore.getState().beginRecording()).toBe(true);
    mountPaneEscape({ canStop: false, handleStop });
    const event = pressEscape();
    // 回退即红：恢复 canStop 注册前置则监听未注册——Esc 零消费（inputLeg 恒 recording）。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(handleStop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("requestingMic 期 Esc：取消请求（§9.9.4-L1 联动）且零停生成", () => {
    const handleStop = vi.fn();
    expect(useVoiceSessionStore.getState().startMicRequest("sess-1", "entry-a")).toBe(true);
    mountPaneEscape({ canStop: false, handleStop });
    const event = pressEscape();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(handleStop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("无任务无录音：Esc 零动作零 preventDefault（§4.4 优先级 4 语义不变）", () => {
    const handleStop = vi.fn();
    mountPaneEscape({ canStop: false, handleStop });
    const event = pressEscape();
    expect(handleStop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("canStop=true：Esc 停生成（既有路径回归，preventDefault）", () => {
    const handleStop = vi.fn();
    mountPaneEscape({ canStop: true, handleStop });
    const event = pressEscape();
    expect(handleStop).toHaveBeenCalledWith("escape");
    expect(handleStop).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
