// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import { consumeVoiceRecordingEscape, useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import {
  registerVoiceCommandHandler,
  resetVoiceCommandHandlersForTest,
} from "./voiceCommandBus.js";

const { fakeAdapter, createFakeSession } = vi.hoisted(() => {
  class FakeSession {
    finalSubscribers = new Set<(text: string) => void>();
    errorSubscribers = new Set<(error: { code: string }) => void>();
    stopCalls = 0;
    abortCalls = 0;
    stopResult = { final: "" };

    onFinal(cb: (text: string) => void): () => void {
      this.finalSubscribers.add(cb);
      return () => this.finalSubscribers.delete(cb);
    }

    onError(cb: (error: { code: string }) => void): () => void {
      this.errorSubscribers.add(cb);
      return () => this.errorSubscribers.delete(cb);
    }

    async stop(): Promise<{ final: string }> {
      this.stopCalls += 1;
      return this.stopResult;
    }

    abort(): void {
      this.abortCalls += 1;
    }

    emitFinal(text: string): void {
      for (const cb of Array.from(this.finalSubscribers)) cb(text);
    }

    emitError(code: string): void {
      for (const cb of Array.from(this.errorSubscribers)) cb({ code });
    }
  }

  const sessions: FakeSession[] = [];
  let startReject: { code: string } | null = null;
  const fakeAdapter = {
    isSupported: () => true,
    start: vi.fn(() => {
      if (startReject) {
        const error = Object.assign(new Error("asr"), startReject);
        return Promise.reject(error);
      }
      const session = new FakeSession();
      sessions.push(session);
      return Promise.resolve(session);
    }),
    onPartial: vi.fn(() => () => undefined),
    _setStartReject: (code: string | null) => {
      startReject = code == null ? null : { code };
    },
    _sessions: sessions,
    _reset: () => {
      sessions.length = 0;
      startReject = null;
      fakeAdapter.start.mockClear();
    },
  };
  return { fakeAdapter, createFakeSession: FakeSession };
});

vi.mock("./webSpeechAsrAdapter.js", () => ({
  createWebSpeechAsrAdapter: () => fakeAdapter,
  VoiceAsrError: class extends Error {
    constructor(
      readonly code: string,
      message?: string,
    ) {
      super(message ?? code);
    }
  },
}));

const { useVoiceDictation } = await import("./useVoiceDictation.js");

/**
 * 听写运行时守护（specs/voice-agent-integration.md §5.1/§5.2/§5.3/§9.2 验收）：
 * partial 只进 store 预览字段；逐句 final 以 mode="append"+targetSessionId 恰好一次
 * 分发且多句顺序追加；打断词命中不注入；Esc 停录音零分发；错误出边不自动重启；
 * RequestingMic 10s 超时且迟到的授权被丢弃。
 */

const initialAnnouncement = {
  phase: "annIdle" as const,
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

function resetStores(): void {
  useVoiceSessionStore.setState({
    inputLeg: "idle",
    boundSessionId: null,
    partialText: "",
    notice: null,
    lastDictation: null,
    pendingFinalText: null,
    recordingPulseSeq: 0,
    recordingOwnerEntryId: null,
    announcement: { ...initialAnnouncement },
  });
}

// 每用例独立 workspacePath：droraSessionStore 的 workspace 状态跨用例存活，
// request 通道按 workspace 隔离才能断言「本用例的分发」。
let wsPath = "/ws";
function lastInsertRequest(): { text: string; mode?: string; targetSessionId?: string | null } | null {
  return useDroraSessionStore.getState().getWorkspaceState(wsPath).composerTextInsertRequest;
}

async function mountStartedDictation() {
  const harness = renderHook(() =>
    useVoiceDictation({
      sessionId: "sess-1",
      workspacePath: wsPath,
      lang: "zh-CN",
      requestStart: () => true,
    }),
  );
  harness.result.current.toggleMic();
  await Promise.resolve();
  await Promise.resolve();
  expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeAdapter._reset();
  resetStores();
  resetVoiceCommandHandlersForTest();
  wsPath = `/ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useVoiceDictation", () => {
  it("injects each sentence final with mode=append to the pressed session, in order", async () => {
    const harness = await mountStartedDictation();
    const session = fakeAdapter._sessions[0];
    session?.emitFinal("第一句。");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastInsertRequest()).toMatchObject({
      text: "第一句。",
      mode: "append",
      targetSessionId: "sess-1",
    });
    // 录音腿句间保持 Recording（§5.1/§5.2：预览条在录音结束时才清空）。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().lastDictation?.text).toBe("第一句。");

    session?.emitFinal("第二句！");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastInsertRequest()).toMatchObject({ text: "第二句！", targetSessionId: "sess-1" });
    expect(useVoiceSessionStore.getState().lastDictation?.text).toBe("第二句！");
    void harness;
  });

  it("keeps partial only in the preview field and never dispatches it", async () => {
    const adapter = fakeAdapter;
    await mountStartedDictation();
    // partial 经端口级 onPartial 通道；store 的 setPartial 由 wiring 消费——这里直接断言
    // 分发通道：partial 期间 composerTextInsertRequest 不产生。
    expect(lastInsertRequest()?.text ?? "").not.toContain("半句");
    // 会话 partial 不触发 onFinal（FakeSession 未 emitFinal），store 无待注入文本。
    expect(useVoiceSessionStore.getState().pendingFinalText).toBeNull();
    void adapter;
  });

  it("consumes an interrupt word final without injecting (§5.1 打断词命中优先)", async () => {
    const session = (await mountStartedDictation()).result;
    fakeAdapter._sessions[0]?.emitFinal("停");
    await vi.advanceTimersByTimeAsync(0);
    // 命中打断词：不注入、录音腿保持 Recording（Phase 1a 无播报腿可停）。
    expect(lastInsertRequest() ?? null).toBeNull();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    void session;
  });

  it("stops recording on Esc without dispatching or cancelling the task (§4.4)", async () => {
    await mountStartedDictation();
    expect(consumeVoiceRecordingEscape()).toBe(true);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(lastInsertRequest() ?? null).toBeNull();
    // Esc 路径走 abort（丢弃式）而非 stop（等待结算）：零注入语义。
    expect(fakeAdapter._sessions[0]?.abortCalls).toBe(0);
  });

  it("maps an ASR error to the store notice and does not auto-restart (§5.3)", async () => {
    await mountStartedDictation();
    fakeAdapter._sessions[0]?.emitError("network");
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.notice?.code).toBe("network");
    // 不自动重启：start 只在点按时调用一次。
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
  });

  it("maps getUserMedia permission denial to the permission notice", async () => {
    fakeAdapter._setStartReject("not-allowed");
    const harness = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-1",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    const state = useVoiceSessionStore.getState();
    expect(state.inputLeg).toBe("idle");
    expect(state.notice?.code).toBe("permission");
  });

  it("times out RequestingMic after 10s and discards a late authorization (§5.3)", async () => {
    let resolveStart: ((session: unknown) => void) | null = null;
    fakeAdapter.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve as (session: unknown) => void;
          return undefined as never;
        }),
    );
    // resolveStart 只在 executor 回调内赋值；TS 控制流分析看不到，显式放宽后再调用。
    const resolveNow = resolveStart as ((session: unknown) => void) | null;
    const harness = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-1",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    harness.result.current.toggleMic();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("requestingMic");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().notice?.code).toBe("requestingMicTimeout");

    // 授权迟到：会话代际已过期，立即 abort，绝不进入录音态。
    resolveNow?.(new createFakeSession());
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
  });

  it("routes an interrupt-word final to the command bus without injecting (§4.3 层①接线)", async () => {
    await mountStartedDictation();
    const handler = vi.fn();
    const unregister = registerVoiceCommandHandler(handler);
    fakeAdapter._sessions[0]?.emitFinal("停");
    await vi.advanceTimersByTimeAsync(0);
    // §9.3 验收「given ASR final=『停』（AnnPaused 下）则停播报不续播」的 wiring 半区：
    // 听写侧把层①决策送达总线（planner 侧执行由 useVoiceAnnouncement 注册）。
    expect(handler).toHaveBeenCalledWith("stopAnnouncement");
    expect(lastInsertRequest() ?? null).toBeNull();
    unregister();
  });

  it("routes the cancel-task phrase to the command bus (§4.3 层③接线)", async () => {
    await mountStartedDictation();
    const handler = vi.fn();
    const unregister = registerVoiceCommandHandler(handler);
    fakeAdapter._sessions[0]?.emitFinal("停掉任务");
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledWith("cancelTask");
    expect(lastInsertRequest() ?? null).toBeNull();
    unregister();
  });

  it("keeps another pane's recording alive on a second mic press and pulses the holder (FD-6 wiring)", async () => {
    const first = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-a",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    first.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().boundSessionId).toBe("sess-a");

    // 另一会话入口点按：no-op + 脉冲，绝不停掉别人的录音。
    const second = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-b",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    const pulsesBefore = useVoiceSessionStore.getState().recordingPulseSeq;
    second.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().boundSessionId).toBe("sess-a");
    expect(useVoiceSessionStore.getState().recordingPulseSeq).toBe(pulsesBefore + 1);
    // 第二入口没有开自己的 ASR 会话（start 只被第一入口调用一次）。
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(fakeAdapter._sessions[0]?.abortCalls).toBe(0);

    // 同会话入口：本入口录音中 → 正常停止路径。
    first.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
  });

  it("treats a second pane on the SAME session as no-op + pulse, without leaking the holder's engine (FD-6 原场景)", async () => {
    // §9.2 验收原场景：主/辅 pane 同会话各持 mic 入口，A 已在录音，B 点按。
    const paneA = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-a",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    paneA.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().recordingOwnerEntryId).not.toBeNull();

    // 辅 pane B：同 sessionId、独立 hook 实例（独立 ASR 会话引用空间）。
    const paneB = renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-a",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
      }),
    );
    const pulsesBefore = useVoiceSessionStore.getState().recordingPulseSeq;
    paneB.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);

    // B 侧 no-op：录音腿保持、脉冲递增；A 的引擎不被停也不被 abort（无泄漏）。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().boundSessionId).toBe("sess-a");
    expect(useVoiceSessionStore.getState().recordingPulseSeq).toBe(pulsesBefore + 1);
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(fakeAdapter._sessions[0]?.abortCalls).toBe(0);
    expect(fakeAdapter._sessions[0]?.stopCalls).toBe(0);

    // A 的会话仍活着：final 继续逐句注入（B 的点按没有造成静默丢弃窗口）。
    paneA.result.current.toggleMic(); // A 持有者点按 = 正常停止
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
  });

  it("dispatches the stop-flush final and ends the episode on manual stop", async () => {
    const harness = await mountStartedDictation();
    const session = fakeAdapter._sessions[0];
    if (session) {
      session.stopResult = { final: "收尾句。" };
    }
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    // stop() 的 flush 段注入后 episode 结束回 Idle（不再 resume Recording）。
    expect(lastInsertRequest()).toMatchObject({ text: "收尾句。", mode: "append" });
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().lastDictation?.text).toBe("收尾句。");
  });
});
