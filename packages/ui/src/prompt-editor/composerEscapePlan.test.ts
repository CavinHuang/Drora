import { describe, expect, it } from "vitest";
import { resolveComposerEscapePlan } from "./composerEscapePlan.js";

/**
 * composer Esc 仲裁计划守护（specs/voice-agent-integration.md §4.4 键位仲裁表）：
 * mention 菜单/弹层已消费的事件一律 ignore（仅关菜单/弹层，不停录音、不取消编辑）；
 * 录音态优先于既有取消语义；非录音态语义不变。
 */

const base = {
  key: "Escape",
  defaultPrevented: false,
  insideDialog: false,
  submitting: false,
  hasCancel: true,
};

describe("resolveComposerEscapePlan", () => {
  it("ignores events already consumed by the mention menu (仅关菜单，录音继续)", () => {
    const plan = resolveComposerEscapePlan({ ...base, defaultPrevented: true });
    expect(plan).toEqual({ ignore: true, tryVoice: false, canCancel: false });
  });

  it("ignores Escape inside a role=dialog (弹层归弹层，听写不受影响)", () => {
    const plan = resolveComposerEscapePlan({ ...base, insideDialog: true });
    expect(plan.ignore).toBe(true);
  });

  it("ignores non-Escape keys", () => {
    expect(resolveComposerEscapePlan({ ...base, key: "Enter" }).ignore).toBe(true);
  });

  it("tries the voice recording stop before the cancel semantics (优先级 3 > 4)", () => {
    const plan = resolveComposerEscapePlan(base);
    expect(plan).toEqual({ ignore: false, tryVoice: true, canCancel: true });
  });

  it("keeps the cancel semantics unchanged when not recording (既有语义零破坏)", () => {
    // 录音 gate 未注入/未消费时 handler 直接走 cancel 分支：submitting 中不取消。
    expect(resolveComposerEscapePlan({ ...base, submitting: true }).canCancel).toBe(false);
    expect(resolveComposerEscapePlan({ ...base, hasCancel: false }).canCancel).toBe(false);
    expect(resolveComposerEscapePlan({ ...base }).canCancel).toBe(true);
  });
});
