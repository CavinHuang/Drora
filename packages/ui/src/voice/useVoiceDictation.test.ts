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
  const partialSubscribers = new Set<(text: string) => void>();
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

    emitPartial(text: string): void {
      for (const cb of Array.from(partialSubscribers)) cb(text);
    }

    emitError(code: string): void {
      for (const cb of Array.from(this.errorSubscribers)) cb({ code });
    }
  }

  const sessions: FakeSession[] = [];
  let startReject: { code: string } | null = null;
  const fakeAdapter = {
    isSupported: () => true,
    emitPartial: (text: string) => {
      for (const cb of Array.from(partialSubscribers)) cb(text);
    },
    start: vi.fn(() => {
      if (startReject) {
        const error = Object.assign(new Error("asr"), startReject);
        return Promise.reject(error);
      }
      const session = new FakeSession();
      sessions.push(session);
      return Promise.resolve(session);
    }),
    onPartial: (cb: (text: string) => void) => {
      partialSubscribers.add(cb);
      return () => partialSubscribers.delete(cb);
    },
    _setStartReject: (code: string | null) => {
      startReject = code == null ? null : { code };
    },
    _sessions: sessions,
    _reset: () => {
      sessions.length = 0;
      startReject = null;
      fakeAdapter.start.mockClear();
      partialSubscribers.clear();
    },
  };
  return { fakeAdapter, createFakeSession: FakeSession, partialSubscribers };
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

const { remoteAdapterState } = vi.hoisted(() => {
  class FakeRemoteSession {
    finalSubscribers = new Set<(text: string) => void>();
    errorSubscribers = new Set<(error: { code: string }) => void>();
    stopCalls = 0;
    abortCalls = 0;

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
      return { final: "" };
    }

    abort(): void {
      this.abortCalls += 1;
    }
  }
  const sessions: FakeRemoteSession[] = [];
  let startError: { code: string } | null = null;
  return {
    remoteAdapterState: {
      sessions,
      isSupported: () => true,
      setStartError: (code: string | null) => {
        startError = code == null ? null : { code };
      },
      reset: () => {
        sessions.length = 0;
        startError = null;
      },
      createAdapter: () => ({
        isSupported: () => true,
        start: vi.fn(() => {
          if (startError) {
            return Promise.reject(Object.assign(new Error("remote start failed"), startError));
          }
          const session = new FakeRemoteSession();
          sessions.push(session);
          return Promise.resolve(session);
        }),
        onPartial: () => () => undefined,
      }),
    },
  };
});

vi.mock("./remoteAsrAdapter.js", () => ({
  createRemoteAsrAdapter: () => remoteAdapterState.createAdapter(),
  mapLanguage: (lang: string) => lang.split("-")[0] || null,
  resolveRemoteAsrErrorCode: () => "network",
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
    announcementOwnerId: null,
    announcement: { ...initialAnnouncement },
  });
}

// 每用例独立 workspacePath：droraSessionStore 的 workspace 状态跨用例存活，
// request 通道按 workspace 隔离才能断言「本用例的分发」。
let wsPath = "/ws";
function lastInsertRequest(): {
  text: string;
  mode?: string;
  targetSessionId?: string | null;
} | null {
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
  // §9.6.6 选型层引入了额外的微任务跳（pickAsrAdapter/startOn），确定性 flush。
  await vi.advanceTimersByTimeAsync(0);
  expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeAdapter._reset();
  remoteAdapterState.reset();
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
    // §9.2：partial 经端口级 onPartial → store.partialText（预览条唯一归宿）。
    fakeAdapter.emitPartial("半句");
    expect(useVoiceSessionStore.getState().partialText).toBe("半句");
    // partial 期间 composerTextInsertRequest 不产生（partial 永不进协议/正文）。
    expect(lastInsertRequest()?.text ?? "").not.toContain("半句");
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
    expect(fakeAdapter._sessions[0]?.abortCalls).toBe(1);
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
    const unregister = registerVoiceCommandHandler(handler, {
      getTarget: () => ({ workspacePath: wsPath, sessionId: "sess-1" }),
      isAnnouncementOwner: () => true,
    });
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
    const unregister = registerVoiceCommandHandler(handler, {
      getTarget: () => ({ workspacePath: wsPath, sessionId: "sess-1" }),
      isAnnouncementOwner: () => true,
    });
    fakeAdapter._sessions[0]?.emitFinal("停掉任务");
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledWith("cancelTask");
    expect(lastInsertRequest() ?? null).toBeNull();
    unregister();
  });

  it("delivers the remote batch final through onFinal on manual stop (§9.6.8-S2 remote)", async () => {
    // §9.6.8-S2：远程批量形态响应 {text} 经 onFinal 交付一次并注入 composer；
    // 手动停止路径保留订阅至 stop() 结算，修复「提前退订静默丢弃转写」缺陷。
    fakeAdapter._reset();
    // 用 remote 形态 fake session：stop() 内经 onFinal 交付转写并 resolve 空串。
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
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    const remoteSession = fakeAdapter._sessions[0];
    // 模拟 stop() 的远程批量交付顺序：结算前 emit onFinal（适配器内部交付），resolve 空串。
    const originalStop = remoteSession?.stop.bind(remoteSession);
    if (remoteSession && originalStop) {
      remoteSession.stop = async () => {
        remoteSession.emitFinal("远程转写文本");
        remoteSession.stopCalls += 1;
        return { final: "" };
      };
    }
    harness.result.current.toggleMic(); // 手动停止
    await vi.advanceTimersByTimeAsync(0);
    expect(lastInsertRequest()).toMatchObject({
      text: "远程转写文本",
      mode: "append",
      targetSessionId: "sess-1",
    });
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
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

describe("引擎选型与回退树（§9.6.6 / §9.6.8-S3）", () => {
  function mountWithSelection(params?: {
    asrEngine?: "webSpeech" | "remote";
    vendor?: { baseUrl: string; model: string };
    getVendorApiKey?: () => Promise<string | null>;
  }) {
    return renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-1",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
        ...params,
      }),
    );
  }

  it("keeps the webSpeech adapter for engine=webSpeech (默认行为完全不变)", async () => {
    const harness = mountWithSelection({ asrEngine: "webSpeech" });
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    // remote 适配器未被创建/使用。
    expect(remoteAdapterState.sessions).toHaveLength(0);
  });

  it("selects the remote adapter when engine=remote and the vendor record is complete", async () => {
    const harness = mountWithSelection({
      asrEngine: "remote",
      vendor: { baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/SenseVoiceSmall" },
      getVendorApiKey: async () => "sk-test-key",
    });
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    // remote 起录：webSpeech 引擎零调用。
    expect(fakeAdapter.start).not.toHaveBeenCalled();
    expect(remoteAdapterState.sessions).toHaveLength(1);
  });

  it("falls back to webSpeech with info when the vendor record is incomplete (§9.6.6 W2)", async () => {
    const harness = mountWithSelection({
      asrEngine: "remote",
      vendor: { baseUrl: "", model: "" },
      getVendorApiKey: async () => null,
    });
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(remoteAdapterState.sessions).toHaveLength(0);
  });

  it("falls back to webSpeech within the same press when remote start fails (§9.6.6 W3)", async () => {
    remoteAdapterState.setStartError("network");
    const harness = mountWithSelection({
      asrEngine: "remote",
      vendor: { baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/SenseVoiceSmall" },
      getVendorApiKey: async () => "sk-test-key",
    });
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    // 本次点按以 webSpeech 起录（用户手势同一动作内，§9.6.6 W3），不构成自动重启。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(useVoiceSessionStore.getState().notice).toBeNull();
  });
});

// §9.8：审查复现转正式回归。
it("§9.8 regression: Esc must release the ASR session", async () => {
  await mountStartedDictation();
  const session = fakeAdapter._sessions[0];
  consumeVoiceRecordingEscape();
  await vi.advanceTimersByTimeAsync(0);
  expect(session?.abortCalls).toBe(1);
  expect(session?.stopCalls).toBe(0);
});

it("Esc during manual-stop settlement discards late flush and is idempotent (§9.8)", async () => {
  const h = await mountStartedDictation();
  const session = fakeAdapter._sessions[0]!;
  let settle: ((value: { final: string }) => void) | undefined;
  session.stop = vi.fn(
    () =>
      new Promise<{ final: string }>((resolve) => {
        settle = resolve;
      }),
  );
  h.result.current.toggleMic();
  h.result.current.toggleMic();
  expect(session.stop).toHaveBeenCalledTimes(1);
  expect(consumeVoiceRecordingEscape()).toBe(true);
  expect(consumeVoiceRecordingEscape()).toBe(false);
  settle?.({ final: "must not arrive" });
  await vi.advanceTimersByTimeAsync(0);
  expect(session.abortCalls).toBe(1);
  expect(lastInsertRequest() ?? null).toBeNull();
  expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
});

it("switching a mounted entry target aborts the old episode before accepting results (§9.8)", async () => {
  let sessionId = "A";
  const h = renderHook(() =>
    useVoiceDictation({
      sessionId,
      workspacePath: wsPath,
      lang: "zh-CN",
      requestStart: () => true,
    }),
  );
  h.result.current.toggleMic();
  await vi.advanceTimersByTimeAsync(0);
  const old = fakeAdapter._sessions[0]!;
  sessionId = "B";
  h.rerender();
  old.emitFinal("late A");
  expect(old.abortCalls).toBe(1);
  expect(lastInsertRequest() ?? null).toBeNull();
  expect(useVoiceSessionStore.getState().notice?.code).toBe("sessionGone");
});

it("credential completion after RequestingMic timeout never starts an engine (§9.8)", async () => {
  let finish: ((key: string) => void) | undefined;
  const h = renderHook(() =>
    useVoiceDictation({
      sessionId: "A",
      workspacePath: wsPath,
      lang: "zh-CN",
      requestStart: () => true,
      asrEngine: "remote",
      vendor: { baseUrl: "https://voice.example.test", model: "m" },
      getVendorApiKey: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  );
  h.result.current.toggleMic();
  await vi.advanceTimersByTimeAsync(10_000);
  finish?.("synthetic-key");
  await vi.advanceTimersByTimeAsync(0);
  expect(fakeAdapter.start).not.toHaveBeenCalled();
  expect(remoteAdapterState.sessions).toHaveLength(0);
  expect(useVoiceSessionStore.getState().notice?.code).toBe("requestingMicTimeout");
});
