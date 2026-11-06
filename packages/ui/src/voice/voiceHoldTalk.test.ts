import { describe, expect, it, vi } from "vitest";
import {
  attachHoldTalkKeyListeners,
  createHoldTalkKeyHandler,
  type HoldTalkKeyEventLike,
} from "./voiceHoldTalk.js";

/**
 * 长按听写键捕获层契约（specs/voice-agent-integration.md §5.5.1）：Fn 按下/松开沿 →
 * pressStart/pressStop 两段回调；repeat/isComposing 忽略；holdKey="off" 静默；
 * blur 兜底视同松开；装配层 capture 监听 + 清理。
 */

function keyEvent(key: string, overrides?: Partial<HoldTalkKeyEventLike>): HoldTalkKeyEventLike {
  return { key, repeat: false, isComposing: false, ...overrides };
}

describe("createHoldTalkKeyHandler（§5.5.1）", () => {
  it("Fn 按下→pressStart，松开→pressStop", () => {
    const onPressStart = vi.fn();
    const onPressStop = vi.fn();
    const handler = createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop });
    handler.handleKeyDown(keyEvent("Fn"));
    expect(onPressStart).toHaveBeenCalledTimes(1);
    expect(handler.holding).toBe(true);
    handler.handleKeyUp(keyEvent("Fn"));
    expect(onPressStop).toHaveBeenCalledTimes(1);
    expect(handler.holding).toBe(false);
  });

  it("repeat 与 isComposing 按下被忽略（不重复起录）", () => {
    const onPressStart = vi.fn();
    const handler = createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop: () => {} });
    handler.handleKeyDown(keyEvent("Fn", { repeat: true }));
    handler.handleKeyDown(keyEvent("Fn", { isComposing: true }));
    expect(onPressStart).not.toHaveBeenCalled();
    expect(handler.holding).toBe(false);
  });

  it("非 Fn 键零动作；holdKey=off 全静默", () => {
    const onPressStart = vi.fn();
    const onPressStop = vi.fn();
    const handler = createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop });
    handler.handleKeyDown(keyEvent("a"));
    handler.handleKeyUp(keyEvent("Meta"));
    expect(onPressStart).not.toHaveBeenCalled();
    const off = createHoldTalkKeyHandler({ holdKey: "off", onPressStart, onPressStop });
    off.handleKeyDown(keyEvent("Fn"));
    off.handleKeyUp(keyEvent("Fn"));
    off.handleBlur();
    expect(onPressStart).not.toHaveBeenCalled();
    expect(onPressStop).not.toHaveBeenCalled();
  });

  it("blur 兜底：按住未松 → 视同松开（pressStop）；未按住 → no-op", () => {
    const onPressStart = vi.fn();
    const onPressStop = vi.fn();
    const handler = createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop });
    handler.handleBlur();
    expect(onPressStop).not.toHaveBeenCalled();
    handler.handleKeyDown(keyEvent("Fn"));
    handler.handleBlur();
    expect(onPressStop).toHaveBeenCalledTimes(1);
    expect(handler.holding).toBe(false);
    // 兜底后的真松开不二次触发。
    handler.handleKeyUp(keyEvent("Fn"));
    expect(onPressStop).toHaveBeenCalledTimes(1);
  });

  it("松开后再次按下可重新起录（循环长按）", () => {
    const onPressStart = vi.fn();
    const handler = createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop: () => {} });
    handler.handleKeyDown(keyEvent("Fn"));
    handler.handleKeyUp(keyEvent("Fn"));
    handler.handleKeyDown(keyEvent("Fn"));
    expect(onPressStart).toHaveBeenCalledTimes(2);
  });
});

describe("attachHoldTalkKeyListeners（装配层）", () => {
  it("capture 阶段挂 keydown/keyup + blur，清理函数摘除全部", () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const fakeTarget = {
      addEventListener: vi.fn((type: string, fn: (event: unknown) => void, capture?: boolean) => {
        // 键事件 capture 阶段；blur 无 capture 语义。
        if (type !== "blur") expect(capture).toBe(true);
        listeners.set(type, (listeners.get(type) ?? new Set()).add(fn) as Set<(event: unknown) => void>);
      }),
      removeEventListener: vi.fn((type: string, fn: (event: unknown) => void, _capture?: boolean) => {
        listeners.get(type)?.delete(fn);
      }),
    } as unknown as Window;
    const onPressStart = vi.fn();
    const detach = attachHoldTalkKeyListeners(
      createHoldTalkKeyHandler({ holdKey: "fn", onPressStart, onPressStop: () => {} }),
      fakeTarget,
    );
    expect([...listeners.keys()].sort()).toEqual(["blur", "keydown", "keyup"]);
    // 派发一个 fake keydown 经监听链触达 handler。
    (listeners.get("keydown") as Set<(event: unknown) => void>).forEach((fn) =>
      fn({ key: "Fn", repeat: false, isComposing: false }),
    );
    expect(onPressStart).toHaveBeenCalledTimes(1);
    detach();
    expect(listeners.get("keydown")?.size).toBe(0);
    expect(listeners.get("keyup")?.size).toBe(0);
  });
});
