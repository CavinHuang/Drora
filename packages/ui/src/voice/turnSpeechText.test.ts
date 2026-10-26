import { describe, expect, it } from "vitest";
import { buildTurnSpeechText, splitTurnIntoSentences } from "./turnSpeechText.js";

describe("句边界切分与同源聚合（§4.1）", () => {
  it("splits on terminal punctuation and keeps closers attached", () => {
    expect(splitTurnIntoSentences("第一句。第二句！第三句？结尾无标点")).toEqual([
      "第一句。",
      "第二句！",
      "第三句？",
      "结尾无标点",
    ]);
    expect(splitTurnIntoSentences("他说：「好。」走！")).toEqual(["他说：「好。」", "走！"]);
    expect(splitTurnIntoSentences("先做 a；再做 b;\n新行开始")).toEqual([
      "先做 a；",
      "再做 b;",
      "新行开始",
    ]);
  });

  it("protects decimals from splitting", () => {
    expect(splitTurnIntoSentences("版本 3.14 已发布。下一句")).toEqual([
      "版本 3.14 已发布。",
      "下一句",
    ]);
  });

  it("hard-splits overlong segments at the tuning bound", () => {
    const segments = splitTurnIntoSentences("a".repeat(250));
    expect(segments).toHaveLength(3);
    expect(segments[0]?.length).toBe(120);
    expect(segments[2]?.length).toBe(10);
  });

  it("aggregates turn text with the same join chain as assistantCopyText (§4.1 同源)", () => {
    // 与 packages/ui/src/v4/assistantPreviewCards.ts:34-37 同链：map(text) → 滤空 → join("\n\n")。
    const rows = [{ text: "第一段" }, { text: "   " }, { text: "第二段" }];
    expect(buildTurnSpeechText(rows)).toBe("第一段\n\n第二段");
  });
});
