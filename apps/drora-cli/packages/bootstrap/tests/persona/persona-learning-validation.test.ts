/**
 * P1b 候选草稿独立校验器（合同 §6「模型可输出仅经严格校验进入候选」；spec §8「模型只判断
 * 语义并引用被提供的片段」）：受控键/受控值、全局范围声明、逐字引用、refs/草稿上界、
 * 未知字段与自报身份不可表达（草稿形状封闭）。语义负例（假设/引用他人/裸「好」）属真实
 * 模型适配器评测合同（PM38/40/48），本文件只钉机械闸。
 */
import { describe, expect, it } from "vitest";
import { PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import { validateExtractionDrafts } from "../../src/app/drora-persona/learning-extraction.js";
import { draft } from "./persona-learning-test-support.js";

const WINDOW = [
  "请以后都用中文回复我，这条是原话。",
  "解释得再简洁一点，直接给答案就行。",
];

describe("persona P1b 候选草稿校验器", () => {
  it("合格草稿（受控键值＋全局范围＋逐字引用）通过并产出受控候选", () => {
    const result = validateExtractionDrafts({
      drafts: [
        draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", ["用中文回复"]),
        draft(PERSONA_PREFERENCE_KEYS.collaborationStyle, "direct_answer", ["直接给答案"]),
      ],
      messages: WINDOW,
    });
    expect(result).toEqual({
      candidates: [
        {
          evidenceRefs: ["用中文回复"],
          key: PERSONA_PREFERENCE_KEYS.replyLanguage,
          value: "zh-CN",
        },
        {
          evidenceRefs: ["直接给答案"],
          key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
          value: "direct_answer",
        },
      ],
      status: "validated",
    });
  });

  it("未知键与自由文本值拒绝（不把任意 JSON 转成指令）", () => {
    const unknownKey = validateExtractionDrafts({
      drafts: [{ ...draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN"), key: "mood" }],
      messages: WINDOW,
    });
    expect(unknownKey).toEqual({ reason: "unknown_key", rejectedCount: 1, status: "rejected" });
    const freeText = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "繁體中文加註拼音")],
      messages: WINDOW,
    });
    expect(freeText).toEqual({ reason: "invalid_value", rejectedCount: 1, status: "rejected" });
  });

  it("项目限定/临时范围声明（scope≠global）机械拒绝", () => {
    const scoped = validateExtractionDrafts({
      drafts: [
        draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", ["用中文回复"], {
          scope: "project" as unknown as "global",
        }),
      ],
      messages: WINDOW,
    });
    expect(scoped).toEqual({ reason: "scope_not_global", rejectedCount: 1, status: "rejected" });
  });

  it("伪造引用（不在输入窗口内逐字出现）拒绝；空引用与超量引用拒绝", () => {
    const fabricated = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", ["以后默认说英文"])],
      messages: WINDOW,
    });
    expect(fabricated).toEqual({
      reason: "evidence_not_verbatim",
      rejectedCount: 1,
      status: "rejected",
    });
    const empty = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", [])],
      messages: WINDOW,
    });
    expect(empty).toEqual({ reason: "missing_evidence", rejectedCount: 1, status: "rejected" });
    const overCount = validateExtractionDrafts({
      drafts: [
        draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", [
          "用中文回复",
          "请以后",
          "这条是原话",
          "，",
          "我",
        ]),
      ],
      messages: WINDOW,
    });
    expect(overCount).toEqual({ reason: "missing_evidence", rejectedCount: 1, status: "rejected" });
  });

  it("超 512 code point 的引用拒绝", () => {
    const longQuote = "长".repeat(513);
    const oversized = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN", [longQuote])],
      messages: [longQuote],
    });
    expect(oversized).toEqual({ reason: "missing_evidence", rejectedCount: 1, status: "rejected" });
  });

  it("草稿数超 4 与同键重复拒绝", () => {
    const drafts = [
      draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN"),
      draft(PERSONA_PREFERENCE_KEYS.collaborationStyle, "direct_answer"),
      draft(PERSONA_PREFERENCE_KEYS.explanationDetail, "concise"),
      draft(PERSONA_PREFERENCE_KEYS.preferredAddress, "阿明"),
      draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "en-US"),
    ];
    const overLimit = validateExtractionDrafts({ drafts, messages: WINDOW });
    expect(overLimit).toEqual({
      reason: "draft_limit_exceeded",
      rejectedCount: 5,
      status: "rejected",
    });
    const duplicate = validateExtractionDrafts({
      drafts: [
        draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN"),
        draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "en-US"),
      ],
      messages: WINDOW,
    });
    expect(duplicate).toEqual({ reason: "unknown_key", rejectedCount: 2, status: "rejected" });
  });

  it("preferredAddress 规范化：NFC/trim 通过，换行/超长拒绝", () => {
    const ok = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.preferredAddress, "  阿明  ")],
      messages: WINDOW,
    });
    expect(ok.status).toBe("validated");
    if (ok.status !== "validated") return;
    expect(ok.candidates[0]?.value).toBe("阿明");
    const newline = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.preferredAddress, "阿\n明")],
      messages: WINDOW,
    });
    expect(newline).toEqual({ reason: "invalid_value", rejectedCount: 1, status: "rejected" });
    const tooLong = validateExtractionDrafts({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.preferredAddress, "阿".repeat(41))],
      messages: WINDOW,
    });
    expect(tooLong).toEqual({ reason: "invalid_value", rejectedCount: 1, status: "rejected" });
  });
});
