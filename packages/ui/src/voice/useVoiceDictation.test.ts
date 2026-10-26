// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { logger } from "@/logger.js";
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
const { VOICE_REQUESTING_MIC_TIMEOUT_MS } = await import("./voiceTuning.js");

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
// §9.9.2-H4 多槽形态：听写绑定会话 sess-1，读该会话槽（槽键 = targetSessionId ?? ""）。
// 融合：workspaceSlice 的多槽 store 已按 §9.9 rebase 干净落地，读法取 §9.9 形态。
function lastInsertRequest(): { text: string; mode?: string; targetSessionId?: string | null } | null {
  return (
    useDroraSessionStore.getState().getWorkspaceState(wsPath).composerTextInsertRequests["sess-1"] ??
    null
  );
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
    // §9.9.2-H4 同槽 append 合并：第一句未被消费清除期间，第二句按 §2.4 空格规则
    // 拼进同一请求（旧单槽 latest-wins 会直接覆盖丢第一句；合并在写入点先行应用）。
    expect(lastInsertRequest()).toMatchObject({
      text: "第一句。 第二句！",
      mode: "append",
      targetSessionId: "sess-1",
    });
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

// 融合：两侧用例取并集——§9.8 的 Esc/目标切换/迟到凭据回归 + §9.9 的 M9/L10/L1
// describe 块并列；M9/L1 的停止/取消经 §9.8 abortEpisode 通道落地（融合：§9.8-F1 通道）。
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

describe("入口隐藏定向停止（§9.9.3-M9 entryVisible）", () => {
  // 闭包直读外层变量（不可经形参传值——rerender 需读到最新值）。
  let entryVisible = true;
  function mountWithVisibility() {
    return renderHook(() =>
      useVoiceDictation({
        sessionId: "sess-1",
        workspacePath: wsPath,
        lang: "zh-CN",
        requestStart: () => true,
        entryVisible,
      }),
    );
  }

  it("录音中入口隐藏：持有者定向停止（abort 引擎 + 出腿、partial 丢弃、零 notice）", async () => {
    entryVisible = true;
    const harness = mountWithVisibility();
    harness.result.current.toggleMic();
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    fakeAdapter.emitPartial("半句");
    expect(useVoiceSessionStore.getState().partialText).toBe("半句");
    // 录音中把 voiceComposerEntryHidden 设回隐藏 → view.visible false → 定向停止。
    // 回退即红：移除 entryVisible effect 则 inputLeg 恒 recording（无入口的继续拾音）。
    entryVisible = false;
    harness.rerender();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().partialText).toBe("");
    expect(useVoiceSessionStore.getState().notice).toBeNull();
    // 丢弃式 abort（停引擎会话），非 stop 等待结算。
    expect(fakeAdapter._sessions[0]?.abortCalls).toBe(1);
    expect(fakeAdapter._sessions[0]?.stopCalls).toBe(0);
  });

  it("他入口持有录音时本入口隐藏：零动作不停别人的录音（FD-6 边界同源）", async () => {
    // 他者实例持有录音腿。
    expect(useVoiceSessionStore.getState().startMicRequest("sess-1", "entry-other")).toBe(true);
    expect(useVoiceSessionStore.getState().beginRecording()).toBe(true);
    useVoiceSessionStore.getState().setPartial("别人的半句");
    entryVisible = true;
    const harness = mountWithVisibility();
    entryVisible = false;
    harness.rerender();
    // 非持有者入口隐藏：录音腿与 partial 不受影响。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("recording");
    expect(useVoiceSessionStore.getState().partialText).toBe("别人的半句");
    useVoiceSessionStore.getState().stopRecording();
  });

  it("requestingMic 中入口隐藏：即时取消，不等 10s 超时", async () => {
    // start 挂起：授权不落地，腿停在 requestingMic（权限对话框被忽略场景，§5.3）。
    fakeAdapter.start.mockImplementationOnce(() => new Promise(() => undefined));
    entryVisible = true;
    const harness = mountWithVisibility();
    harness.result.current.toggleMic();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("requestingMic");
    entryVisible = false;
    harness.rerender();
    // cancelMicRequest 即时生效（超时计时器随订阅 effect 同步清除）。
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().notice).toBeNull();
    await vi.advanceTimersByTimeAsync(VOICE_REQUESTING_MIC_TIMEOUT_MS);
    // 未走超时路径（无 requestingMicTimeout notice）。
    expect(useVoiceSessionStore.getState().notice).toBeNull();
  });
});

describe("§9.9.4-L10/L1 起录链失败处置与用户取消出边", () => {
  it("选型/适配器创建异常：voice.asr error + 即时出腿，不悬 10s（§9.9.4-L10）", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const originalCreate = remoteAdapterState.createAdapter;
    try {
      // 选型链无法给出适配器（「choice=null」：构造 throw）。
      remoteAdapterState.createAdapter = (() => {
        throw new Error("adapter construction boom");
      }) as typeof remoteAdapterState.createAdapter;
      const harness = renderHook(() =>
        useVoiceDictation({
          sessionId: "sess-1",
          workspacePath: wsPath,
          lang: "zh-CN",
          requestStart: () => true,
          asrEngine: "remote",
          vendor: { baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/SenseVoiceSmall" },
          getVendorApiKey: async () => "sk-test-key",
        }),
      );
      harness.result.current.toggleMic();
      await vi.advanceTimersByTimeAsync(0);
      // 即时出腿：inputLeg=idle + device 提示（未知异常归 device 族）。
      // 回退即红：移除 pickAsrAdapter catch 则 store 悬在 requestingMic 至 10s 超时
      // 且零 error 日志（unhandled rejection）。
      expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
      expect(useVoiceSessionStore.getState().notice?.code).toBe("device");
      const asrErrors = errorSpy.mock.calls.filter(([scope]) => scope === "voice.asr");
      expect(asrErrors).toHaveLength(1);
      // 零 10s 悬挂：推进超时窗无新 notice（未走超时路径）。
      await vi.advanceTimersByTimeAsync(10_000);
      expect(useVoiceSessionStore.getState().notice?.code).toBe("device");
    } finally {
      remoteAdapterState.createAdapter = originalCreate;
      errorSpy.mockRestore();
    }
  });

  it("webSpeech start 失败日志槽位归 voice.asr（§9.9.4-L10 槽位迁移）", async () => {
    fakeAdapter._setStartReject("not-allowed");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
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
      expect(useVoiceSessionStore.getState().notice?.code).toBe("permission");
      // 回退即红：恢复 voice.entry 槽位则本断言红（scope 不匹配）。
      const startFails = warnSpy.mock.calls.filter(
        ([scope, message]) => scope === "voice.asr" && String(message).includes("asr start failed"),
      );
      expect(startFails).toHaveLength(1);
      expect(
        warnSpy.mock.calls.some(([scope]) => scope === "voice.entry"),
      ).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("requestingMic 持有者再点按 = 取消，迟到授权丢弃式 abort（§9.9.4-L1）", async () => {
    let resolveStart!: (value: unknown) => void;
    fakeAdapter.start.mockImplementationOnce(
      () =>
        new Promise<InstanceType<typeof createFakeSession>>((resolve) => {
          resolveStart = resolve as unknown as (value: unknown) => void;
        }),
    );
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
    // flush：start 已被调用并挂起（pickAsrAdapter 的 await 链落地）。
    await vi.advanceTimersByTimeAsync(0);
    // 持有者再点按 → cancelMicRequest + generation 失效（§3.2 用户取消出边）。
    // 回退即红：移除该出边则再点按走 store 拒绝=静默 no-op（仍 requestingMic）。
    harness.result.current.toggleMic();
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(useVoiceSessionStore.getState().notice).toBeNull();
    // 迟到授权：start resolve 后立即丢弃式 abort，绝不进入录音态。
    const abortSpy = vi.fn();
    resolveStart({
      onFinal: () => () => undefined,
      onError: () => () => undefined,
      abort: abortSpy,
      stop: () => Promise.resolve({ final: "" }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("requestingMic 非持有者点按维持 no-op（不代取消他人的请求，FD-6 边界）", async () => {
    fakeAdapter.start.mockImplementationOnce(() => new Promise(() => undefined));
    expect(useVoiceSessionStore.getState().startMicRequest("sess-1", "entry-other")).toBe(true);
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
    expect(useVoiceSessionStore.getState().recordingOwnerEntryId).toBe("entry-other");
  });

  it("requestingMic 期 Esc = 取消请求（consumeVoiceRecordingEscape 两段扩展，§9.9.4-L1）", () => {
    expect(useVoiceSessionStore.getState().startMicRequest("sess-1", "entry-x")).toBe(true);
    expect(consumeVoiceRecordingEscape()).toBe(true);
    expect(useVoiceSessionStore.getState().inputLeg).toBe("idle");
    // idle 态不消费（既有语义回归）。
    expect(consumeVoiceRecordingEscape()).toBe(false);
  });
});
