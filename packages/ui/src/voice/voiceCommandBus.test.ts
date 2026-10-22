import { describe, expect, it, vi } from "vitest";
import {
  dispatchVoiceCommand,
  registerVoiceCommandHandler,
  resetVoiceCommandHandlersForTest,
} from "./voiceCommandBus.js";

/**
 * 语音命令总线守护（§4.3 三层打断的 wiring 层）：dispatch 广播全部注册者（多 planner
 * 注册安全——非播报者在 planner 侧 gate），注销后不再接收。
 */
describe("voiceCommandBus", () => {
  it("broadcasts a command to every registered handler", () => {
    resetVoiceCommandHandlersForTest();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerVoiceCommandHandler(first);
    registerVoiceCommandHandler(second);

    dispatchVoiceCommand("stopAnnouncement");
    expect(first).toHaveBeenCalledWith("stopAnnouncement");
    expect(second).toHaveBeenCalledWith("stopAnnouncement");

    unregisterFirst();
    dispatchVoiceCommand("cancelTask");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("cancelTask");
  });

  it("silently no-ops without handlers (播报未挂载)", () => {
    resetVoiceCommandHandlersForTest();
    expect(() => dispatchVoiceCommand("stopAnnouncement")).not.toThrow();
  });

  it("unregister is idempotent and scoped to its own handler", () => {
    resetVoiceCommandHandlersForTest();
    const handler = vi.fn();
    const unregister = registerVoiceCommandHandler(handler);
    unregister();
    unregister();
    dispatchVoiceCommand("stopAnnouncement");
    expect(handler).not.toHaveBeenCalled();
  });
});
