import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/logger.js";
import {
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
} from "./turnSpeechPlanner.js";
import type { VoiceAnnouncementClaimPort, VoiceAnnouncementLease } from "./voiceAnnouncementClaim.js";
import type {
  VoiceTtsDoneReason,
  VoiceTtsHandle,
  VoiceTtsPort,
  VoiceTtsUtterance,
} from "./voiceTtsPort.js";
import { useVoiceSessionStore, type VoiceAnnouncementLegState } from "@/store/voiceSessionStore.js";

/**
 * §7.1 voice.tts 时序 debug 槽位守护（specs/voice-agent-integration.md §7.1 /
 * §9.9.4-L9）：turn.start/sentence.boundary/pause/resume/interrupt/cancel 关键路径
 * 事件 + 载荷零播报文本（§7.1 隐私边界）+ dispose 订阅退订。
 * 从 turnSpeechPlanner.test.ts 拆出（max-file-lines 门禁）；装配方式相同——
 * fake TTS/claim + 真 voiceSessionStore 受控面。
 */

class FakeTts implements VoiceTtsPort {
  readonly spoken: VoiceTtsUtterance[] = [];
  private counter = 0;
  private doneCb: ((handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void) | null = null;
  private lastHandle: VoiceTtsHandle | null = null;
  cancelCount = 0;
  onDoneSubscribed = false;

  speak(u: VoiceTtsUtterance): VoiceTtsHandle {
    const handle = { utteranceId: `utt-${(this.counter += 1)}` };
    this.spoken.push(u);
    this.lastHandle = handle;
    return handle;
  }

  cancel(): void {
    this.cancelCount += 1;
    this.lastHandle = null;
  }

  onDone(cb: (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void): () => void {
    this.doneCb = cb;
    this.onDoneSubscribed = true;
    return () => {
      this.doneCb = null;
      this.onDoneSubscribed = false;
    };
  }

  finishCurrent(reason: VoiceTtsDoneReason = "end"): void {
    const handle = this.lastHandle;
    if (!handle) {
      throw new Error("no live utterance to finish");
    }
    this.lastHandle = null;
    this.doneCb?.(handle, reason);
  }
}

class FakeClaim implements VoiceAnnouncementClaimPort {
  // 融合：§9.8 lease 凭证 API（§9.9 基线布尔形在此按 §9.8 通道改写——「融合：§9.8-F1 通道」）。
  async acquire(): Promise<VoiceAnnouncementLease | null> {
    return { key: "k", token: "fake-lease" };
  }

  async renew(lease: VoiceAnnouncementLease): Promise<VoiceAnnouncementLease | null> {
    return lease;
  }

  release(): void {}
}

const initialAnnouncement: VoiceAnnouncementLegState = {
  phase: "annIdle",
  sentenceIndex: 0,
  sentenceCount: 0,
  claimHeld: false,
  pauseRequested: false,
  uninterruptible: false,
};

function resetVoiceStore(): void {
  useVoiceSessionStore.setState({
    inputLeg: "idle",
    boundSessionId: null,
    partialText: "",
    notice: null,
    lastDictation: null,
    pendingFinalText: null,
    recordingPulseSeq: 0,
    recordingOwnerEntryId: null,
    announcedPermissionIds: new Set<string>(),
    announcement: { ...initialAnnouncement },
  });
}

interface Harness {
  tts: FakeTts;
  planner: ReturnType<typeof createTurnSpeechPlanner>;
  setFocusedTail(tail: { turnId: string; text: string } | null): void;
}

function createHarness(): Harness {
  let focusedTail: { turnId: string; text: string } | null = null;
  const tts = new FakeTts();
  const planner = createTurnSpeechPlanner({
    getFocusedTurnTail: () => focusedTail,
    tts,
    claim: new FakeClaim(),
    isAnnouncementEnabled: () => true,
    announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
    getAnnouncementVoiceConfig: () => ({ lang: "zh-CN", rate: 1 }),
    cancelTask: () => undefined,
  });
  return { tts, planner, setFocusedTail: (tail) => { focusedTail = tail; } };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  resetVoiceStore();
});

describe("§7.1 voice.tts 时序 debug 槽位（§9.9.4-L9）", () => {
  function voiceTtsDebugEvents(spy: { mock: { calls: unknown[][] } }): unknown[] {
    return spy.mock.calls.filter((call) => call[0] === "voice.tts").map((call) => call[1]);
  }

  it("起播/句界/暂停/续播事件序列（生产不落盘）且载荷零播报文本", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    try {
      const h = createHarness();
      h.setFocusedTail({ turnId: "t1", text: "甲。乙。丙。" });
      h.planner.consumeTurnTail({ turnId: "t1", text: "甲。乙。丙。" });
      await flushMicrotasks(); // turn.start → speak 甲
      h.tts.finishCurrent("end"); // boundary(1) → speak 乙
      h.planner.notifyUserRecordingStarted(); // pause(requested, 1)
      h.tts.finishCurrent("end"); // boundary(2) + pause(effective) → annPaused
      h.planner.notifyUserRecordingEnded(); // resume(2) → speak 丙
      h.tts.finishCurrent("end"); // boundary(3) → annIdle
      // 回退即红：移除埋点则序列断言红（零事件）。
      expect(voiceTtsDebugEvents(debugSpy)).toEqual([
        "turn.start",
        "sentence.boundary",
        "pause",
        "sentence.boundary",
        "pause",
        "resume",
        "sentence.boundary",
      ]);
      // 硬边界：全部事件载荷零播报文本（turnId 是标识符；正文体只含 id/序号/计数）。
      for (const [, , data] of debugSpy.mock.calls) {
        if (data == null || typeof data !== "object") {
          continue;
        }
        for (const value of Object.values(data)) {
          expect(String(value)).not.toMatch(/甲|乙|丙/);
        }
      }
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("打断/取消关键路径事件（interrupt / cancel）", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    try {
      const h = createHarness();
      h.planner.consumeTurnTail({ turnId: "t1", text: "甲。" });
      await flushMicrotasks();
      h.planner.notifyInterruptWordHit(); // 层①打断：interrupt 事件
      h.planner.consumeTurnTail({ turnId: "t2", text: "乙。" });
      await flushMicrotasks();
      h.planner.requestCancelTask(); // 层③取消：cancel {via: "voice"}
      const events = voiceTtsDebugEvents(debugSpy);
      expect(events).toContain("interrupt");
      expect(events).toContain("cancel");
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("dispose 退订 tts.onDone（订阅不随实例死亡残留）", async () => {
    const h = createHarness();
    h.planner.consumeTurnTail({ turnId: "t1", text: "甲。" });
    await flushMicrotasks();
    expect(h.tts.onDoneSubscribed).toBe(true);
    h.planner.dispose();
    // 回退即红：dispose 不调 unsubscribeDone() 则订阅残留（true）。
    expect(h.tts.onDoneSubscribed).toBe(false);
  });
});
