import { describe, expect, it, vi } from "vitest";
import type { KnowledgeCitationOpenResult } from "../src/lib/conversationSelectionReference.js";
import { createKnowledgeCitationOpenFeedbackController } from "../src/v4/knowledgeCitationOpenFeedback.js";

const input = {
  targetSessionId: "session-1",
  workspaceKey: "/workspace",
  receiptId: "evr-source",
};

async function flushResults(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Obsidian inline citation failure-feedback lifecycle", () => {
  it("shows one stale warning for rapid duplicate clicks, without suppressing later retries", async () => {
    let finish: ((result: KnowledgeCitationOpenResult) => void) | undefined;
    const dispatch = vi.fn(() => new Promise<KnowledgeCitationOpenResult>((resolve) => {
      finish = resolve;
    }));
    const warn = vi.fn();
    const controller = createKnowledgeCitationOpenFeedbackController(dispatch);
    controller.setScope("turn-1");
    expect(controller.open(input, "turn-1", warn)).toBe(true);
    expect(controller.open(input, "turn-1", warn)).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
    finish?.({ ok: false, reason: "stale" });
    await flushResults();
    expect(warn).toHaveBeenCalledExactlyOnceWith("stale");
    expect(controller.open(input, "turn-1", warn)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not show a warning for a successfully opened citation", async () => {
    const warn = vi.fn();
    const controller = createKnowledgeCitationOpenFeedbackController(async () => ({ ok: true }));
    controller.setScope("turn-1");
    expect(controller.open(input, "turn-1", warn)).toBe(true);
    await flushResults();
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops stale warnings when switching scope, including leave-and-return to the same turn", async () => {
    let finish: ((result: KnowledgeCitationOpenResult) => void) | undefined;
    const warn = vi.fn();
    const dispatch = vi.fn(() => new Promise<KnowledgeCitationOpenResult>((resolve) => {
      finish = resolve;
    }));
    const controller = createKnowledgeCitationOpenFeedbackController(dispatch);
    controller.setScope("turn-1");
    controller.open(input, "turn-1", warn);
    controller.setScope(null);
    controller.setScope("turn-1");
    // New generation can independently dispatch a new click for this turn.
    expect(controller.open(input, "turn-1", warn)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const newer = finish;
    controller.setScope("turn-2");
    newer?.({ ok: false, reason: "missing" });
    await flushResults();
    expect(warn).not.toHaveBeenCalled();
  });

  it("blocks late clicks from stale closures after switching to another turn", () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as KnowledgeCitationOpenResult);
    const controller = createKnowledgeCitationOpenFeedbackController(dispatch);
    controller.setScope("turn-2");
    expect(controller.open(input, "turn-1", vi.fn())).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports synchronous and asynchronous transport failures only for the active turn", async () => {
    const warn = vi.fn();
    const bad = createKnowledgeCitationOpenFeedbackController(async () => {
      throw new Error("transport unavailable");
    });
    bad.setScope("turn-1");
    bad.open(input, "turn-1", warn);
    await flushResults();
    expect(warn).toHaveBeenCalledExactlyOnceWith("failed");

    const syncWarn = vi.fn();
    const synchronous = createKnowledgeCitationOpenFeedbackController(() => {
      throw new Error("dispatch failed");
    });
    synchronous.setScope("turn-1");
    expect(synchronous.open(input, "turn-1", syncWarn)).toBe(true);
    expect(syncWarn).toHaveBeenCalledExactlyOnceWith("failed");
  });
});
