import { describe, expect, it, vi } from "vitest";
import {
  createSpeechSynthesisTtsAdapter,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
} from "./speechSynthesisTtsAdapter.js";
import type { VoiceTtsDoneReason, VoiceTtsHandle } from "./voiceTtsPort.js";

/**
 * speechSynthesis TTS 适配器守护（specs/voice-agent-integration.md §2.3 / §9.3）：
 * cancel() 本地立即结算 cancelled 并屏蔽引擎迟到事件（FD-1「立即回 AnnIdle」可测）、
 * 播放失败吞异常落 warn 结算 error（§7.1）、音色按名匹配失配回落系统默认。
 */

class FakeUtterance extends EventTarget implements SpeechSynthesisUtteranceLike {
  text = "";
  lang = "";
  voice: { name: string; lang: string } | null = null;
  rate = 1;
  volume = 1;
}

function createSynthesis(): SpeechSynthesisLike & {
  utterances: FakeUtterance[];
  speakCalls: number;
  cancelCalls: number;
} {
  const synthesis = {
    utterances: [] as FakeUtterance[],
    speakCalls: 0,
    cancelCalls: 0,
    speak(utterance: SpeechSynthesisUtteranceLike) {
      synthesis.speakCalls += 1;
      synthesis.utterances.push(utterance as FakeUtterance);
    },
    cancel() {
      synthesis.cancelCalls += 1;
    },
    getVoices() {
      return [
        { name: "Alice", lang: "en-US" },
        { name: "晓琳", lang: "zh-CN" },
      ];
    },
  };
  return synthesis;
}

function createAdapter(synthesis: SpeechSynthesisLike | null) {
  const done: Array<{ handle: VoiceTtsHandle; reason: VoiceTtsDoneReason }> = [];
  const adapter = createSpeechSynthesisTtsAdapter({
    getSpeechSynthesis: () => synthesis,
    createUtterance: () => new FakeUtterance(),
  });
  adapter.onDone((handle, reason) => done.push({ handle, reason }));
  return { adapter, done };
}

describe("createSpeechSynthesisTtsAdapter", () => {
  it("passes text/lang/rate and resolves the voice by configured name", () => {
    const synthesis = createSynthesis();
    const { adapter } = createAdapter(synthesis);
    adapter.speak({ text: "你好", lang: "zh-CN", voice: "晓琳", rate: 1.5 });
    expect(synthesis.speakCalls).toBe(1);
    const utterance = synthesis.utterances[0];
    expect(utterance?.text).toBe("你好");
    expect(utterance?.lang).toBe("zh-CN");
    expect(utterance?.rate).toBe(1.5);
    expect(utterance?.voice?.name).toBe("晓琳");
  });

  it("falls back to the system default when the configured voice is missing", () => {
    const synthesis = createSynthesis();
    const { adapter } = createAdapter(synthesis);
    adapter.speak({ text: "你好", lang: "zh-CN", voice: "不存在的音色" });
    expect(synthesis.utterances[0]?.voice).toBeNull();
  });

  it("settles end via the engine event", () => {
    const synthesis = createSynthesis();
    const { adapter, done } = createAdapter(synthesis);
    const handle = adapter.speak({ text: "一句", lang: "zh-CN" });
    expect(done).toEqual([]);
    synthesis.utterances[0]?.dispatchEvent(new Event("end"));
    expect(done).toEqual([{ handle, reason: "end" }]);
  });

  it("cancel() settles all live utterances as cancelled immediately and swallows late engine events", () => {
    const synthesis = createSynthesis();
    const { adapter, done } = createAdapter(synthesis);
    const first = adapter.speak({ text: "甲", lang: "zh-CN" });
    const second = adapter.speak({ text: "乙", lang: "zh-CN" });
    adapter.cancel();
    expect(synthesis.cancelCalls).toBe(1);
    expect(done).toEqual([
      { handle: first, reason: "cancelled" },
      { handle: second, reason: "cancelled" },
    ]);
    // 引擎迟到的 end 被幂等屏蔽，不产生第二次结算。
    synthesis.utterances[0]?.dispatchEvent(new Event("end"));
    expect(done).toHaveLength(2);
  });

  it("maps engine error events: canceled → cancelled, synthesis failure → error", () => {
    const synthesis = createSynthesis();
    const { adapter, done } = createAdapter(synthesis);
    const first = adapter.speak({ text: "甲", lang: "zh-CN" });
    synthesis.utterances[0]?.dispatchEvent(
      Object.assign(new Event("error"), { error: "canceled" }),
    );
    expect(done).toEqual([{ handle: first, reason: "cancelled" }]);

    const second = adapter.speak({ text: "乙", lang: "zh-CN" });
    synthesis.utterances[1]?.dispatchEvent(
      Object.assign(new Event("error"), { error: "synthesis-failed" }),
    );
    expect(done).toEqual([
      { handle: first, reason: "cancelled" },
      { handle: second, reason: "error" },
    ]);
  });

  it("swallows synthesis failure without throwing and settles error (§7.1)", () => {
    const synthesis = createSynthesis();
    synthesis.speak = () => {
      throw new Error("engine exploded");
    };
    const { adapter, done } = createAdapter(synthesis);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => adapter.speak({ text: "甲", lang: "zh-CN" })).not.toThrow();
      expect(done).toHaveLength(1);
      expect(done[0]?.reason).toBe("error");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("settles error immediately when speechSynthesis is unavailable", () => {
    const { adapter, done } = createAdapter(null);
    expect(() => adapter.speak({ text: "甲", lang: "zh-CN" })).not.toThrow();
    expect(done).toHaveLength(1);
    expect(done[0]?.reason).toBe("error");
  });
});
