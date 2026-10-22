import { describe, expect, it } from "vitest";
import {
  VOICE_CANCEL_TASK_PHRASES,
  VOICE_INTERRUPT_FALLBACK,
  VOICE_INTERRUPT_WORDS,
  classifyVoiceDictationFinal,
} from "./interruptionWords.js";

/**
 * 打断词表命中判定守护（specs/voice-agent-integration.md §4.5 / §4.8 / §3.3）：
 * zh 精确相等打断、en 大小写不敏感 + 词数阈值噪声丢弃、第三语言回退 en（EG-5）、
 * 「停掉任务」独立短语表直接层③（EG-8）、「取消」仅层①（§4.8-2）。
 */
describe("classifyVoiceDictationFinal", () => {
  it("hits zh-CN interrupt words by exact match only", () => {
    expect(classifyVoiceDictationFinal("停", "zh-CN")).toEqual({ action: "interruptAnnouncement" });
    expect(classifyVoiceDictationFinal(" 停下 ", "zh-CN")).toEqual({
      action: "interruptAnnouncement",
    });
    expect(classifyVoiceDictationFinal("取消", "zh-CN")).toEqual({
      action: "interruptAnnouncement",
    });
    // 非精确相等（含打断词的句子）→ 正常听写注入（§4.5 zh 语义）。
    expect(classifyVoiceDictationFinal("停不下来", "zh-CN")).toEqual({ action: "inject" });
    expect(classifyVoiceDictationFinal("帮我停下这个任务", "zh-CN")).toEqual({
      action: "inject",
    });
  });

  it("hits en-US interrupt words case-insensitively", () => {
    expect(classifyVoiceDictationFinal("Stop", "en-US")).toEqual({
      action: "interruptAnnouncement",
    });
    expect(classifyVoiceDictationFinal("  QUIET  ", "en-US")).toEqual({
      action: "interruptAnnouncement",
    });
    expect(classifyVoiceDictationFinal("stop it", "en-US")).toEqual({
      action: "interruptAnnouncement",
    });
  });

  it("drops short en-US noise without interrupting or injecting", () => {
    // 词数 < 3 且未命中词表 → 噪声丢弃（不注入、不打断，AnnPaused 正常续播）。
    expect(classifyVoiceDictationFinal("ok", "en-US")).toEqual({ action: "dropNoise" });
    expect(classifyVoiceDictationFinal("well then", "en-US")).toEqual({ action: "dropNoise" });
  });

  it("injects en-US finals at or above the word threshold", () => {
    expect(classifyVoiceDictationFinal("please fix the build", "en-US")).toEqual({
      action: "inject",
    });
    expect(classifyVoiceDictationFinal("run the tests", "en-US")).toEqual({ action: "inject" });
  });

  it("routes cancel-task phrases to layer 3 before the interrupt table", () => {
    expect(classifyVoiceDictationFinal("停掉任务", "zh-CN")).toEqual({ action: "cancelTask" });
    expect(classifyVoiceDictationFinal("Stop the Task", "en-US")).toEqual({
      action: "cancelTask",
    });
    expect(classifyVoiceDictationFinal("cancel the task", "en-US")).toEqual({
      action: "cancelTask",
    });
  });

  it("falls back to en-US rules and word lists for third locales (EG-5)", () => {
    expect(classifyVoiceDictationFinal("stop", "fr-FR")).toEqual({
      action: "interruptAnnouncement",
    });
    expect(classifyVoiceDictationFinal("salut", "fr-FR")).toEqual({ action: "dropNoise" });
    expect(classifyVoiceDictationFinal("please continue the work", "ja-JP")).toEqual({
      action: "inject",
    });
    expect(classifyVoiceDictationFinal("停", "fr-FR")).toEqual({ action: "dropNoise" });
    // 缺席 locale 同样回退。
    expect(classifyVoiceDictationFinal("stop", null)).toEqual({
      action: "interruptAnnouncement",
    });
  });

  it("keeps the zh and en tables disjoint from the cancel-task phrases", () => {
    // 「停掉任务」不在通用打断词表内（§4.8-1：完整短语独立表，误命中面足够小）。
    for (const phrase of VOICE_CANCEL_TASK_PHRASES["zh-CN"] ?? []) {
      expect(VOICE_INTERRUPT_WORDS["zh-CN"]?.exact).not.toContain(phrase);
    }
    for (const phrase of VOICE_CANCEL_TASK_PHRASES["en-US"] ?? []) {
      expect(VOICE_INTERRUPT_WORDS["en-US"]?.exact).not.toContain(phrase);
    }
  });

  it("documents the fallback locale constant", () => {
    expect(VOICE_INTERRUPT_FALLBACK).toBe("en-US");
  });
});
