import { describe, expect, it, vi } from "vitest";
import {
  filterVoicesForAnnouncement,
  listSystemVoices,
  subscribeSystemVoices,
  type SpeechSynthesisVoiceCatalogSource,
} from "./systemVoiceCatalog.js";
import type { SpeechSynthesisVoiceLike } from "./speechSynthesisTtsAdapter.js";

/**
 * 系统音色枚举目录守护（specs/voice-agent-integration.md §9.7.2，V3-a/V3-b 验收）：
 * zh/en 前缀过滤 + 空结果回落全量；voiceschanged 订阅/退订生命周期；空合成器边界。
 */

function voice(name: string, lang: string): SpeechSynthesisVoiceLike {
  return { name, lang };
}

function fakeSynth(voices: SpeechSynthesisVoiceLike[]): SpeechSynthesisVoiceCatalogSource & {
  listeners: Map<string, (() => void)[]>;
} {
  const listeners = new Map<string, (() => void)[]>();
  return {
    speak: () => undefined,
    cancel: () => undefined,
    getVoices: () => voices,
    listeners,
    addEventListener: (type, listener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener: (type, listener) => {
      const current = (listeners.get(type) ?? []).filter((entry) => entry !== listener);
      listeners.set(type, current);
    },
  };
}

function fireVoicesChanged(synth: { listeners: Map<string, (() => void)[]> }): void {
  for (const listener of synth.listeners.get("voiceschanged") ?? []) {
    listener();
  }
}

describe("listSystemVoices", () => {
  it("returns the current snapshot and an empty list for a missing synth", () => {
    const voices = [voice("Microsoft Huihui", "zh-CN"), voice("Zira", "en-US")];
    expect(listSystemVoices(fakeSynth(voices))).toEqual(voices);
    expect(listSystemVoices(null)).toEqual([]);
  });
});

describe("subscribeSystemVoices", () => {
  it("subscribes voiceschanged and unsubscribes on dispose (listeners 计数断言)", () => {
    const synth = fakeSynth([]);
    const onChange = vi.fn();
    const unsubscribe = subscribeSystemVoices(synth, onChange);
    expect(synth.listeners.get("voiceschanged")).toHaveLength(1);
    fireVoicesChanged(synth);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(synth.listeners.get("voiceschanged")).toHaveLength(0);
    // 退订后不再回调。
    fireVoicesChanged(synth);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("returns a no-op unsubscribe when synth is absent", () => {
    expect(() => subscribeSystemVoices(null, () => undefined)()).not.toThrow();
  });
});

describe("filterVoicesForAnnouncement (§9.7.2 zh/en 前缀过滤)", () => {
  it("keeps zh/en hits and drops other languages (ja 项不出现)", () => {
    const result = filterVoicesForAnnouncement([
      voice("Microsoft Huihui", "zh-CN"),
      voice("Google UK English Female", "en-GB"),
      voice("Kyoko", "ja-JP"),
      voice("Microsoft Zira", "en-US"),
      voice("小晓-zh-TW", "zh-TW"),
    ]);
    expect(result.map((entry) => entry.name)).toEqual([
      "Microsoft Huihui",
      "Google UK English Female",
      "Microsoft Zira",
      "小晓-zh-TW",
    ]);
  });

  it("matches language prefixes case-insensitively", () => {
    expect(
      filterVoicesForAnnouncement([voice("A", "ZH-CN"), voice("B", "EN-us")]).map(
        (entry) => entry.lang,
      ),
    ).toEqual(["ZH-CN", "EN-us"]);
  });

  it("falls back to the full list when no voice matches zh/en (空死控件回落)", () => {
    const voices = [voice("Kyoko", "ja-JP"), voice("Yelda", "tr-TR")];
    expect(filterVoicesForAnnouncement(voices)).toEqual(voices);
  });
});
