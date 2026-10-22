import { describe, expect, it } from "vitest";
import { appendComposerText } from "./composerTextAppend.js";

/**
 * mode="append" 拼接规则守护（specs/voice-agent-integration.md §2.4 / §9.2 验收
 * 「拼接不覆盖用户编辑」「非空正文尾无空白时恰好插入一个空格」「连续 3 句按序拼接」）。
 */
describe("appendComposerText", () => {
  it("writes into an empty composer directly", () => {
    expect(appendComposerText("", "第一句。")).toBe("第一句。");
  });

  it("appends with exactly one space when the tail is not whitespace", () => {
    expect(appendComposerText("用户已输入", "第一句。")).toBe("用户已输入 第一句。");
    // 英文收尾（中英混排粘连防护）。
    expect(appendComposerText("const x = 1", "then run tests")).toBe(
      "const x = 1 then run tests",
    );
  });

  it("does not add another space when the tail is already whitespace", () => {
    expect(appendComposerText("已输入 ", "第一句。")).toBe("已输入 第一句。");
    expect(appendComposerText("已输入\n", "第二句。")).toBe("已输入\n第二句。");
  });

  it("keeps user edits and appends three sentences in dictation order", () => {
    let text = appendComposerText("", "第一句。");
    text = appendComposerText(text, "第二句！");
    text = appendComposerText(text, "第三句？");
    // §2.4 确定性规则：尾字符非空白（中文句号也是非空白）→ 补一个空格再追加。
    // 规则不按语言分叉，避免「看似更聪明」的分支制造第二套拼接语义。
    expect(text).toBe("第一句。 第二句！ 第三句？");
  });

  it("ignores whitespace-only incoming text", () => {
    expect(appendComposerText("已有内容", "   ")).toBe("已有内容");
  });

  it("trims leading whitespace of the incoming sentence", () => {
    expect(appendComposerText("已有", "  句子  ")).toBe("已有 句子");
  });
});
