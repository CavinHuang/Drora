import { describe, expect, it } from "vitest";
import type { UserInputRow } from "@drora/shared/drora-protocol-v4";
import { formatKnowledgeDraftSource, KNOWLEDGE_SOURCE_MANIFEST_HEADER } from "../src/lib/conversationKnowledgeSources.js";
import {
  auditKnowledgeAnswerCitationCoverage,
  readKnowledgeTurnCitations,
  readAnswerCitationNumbers,
} from "../src/v4/knowledgeTurnCitations.js";

type SourceInput = Pick<UserInputRow, "turnId" | "sourceCommandId" | "origin" | "evidenceRefs" | "conversationQuotes" | "text">;
const source1 = { index: 1, relativePath: "notes/a.md", heading: "Context", startLine: 2, endLine: 5 };
const source2 = { index: 2, relativePath: "notes/b.md", heading: null, startLine: 9, endLine: 12 };
const prompt = [
  "仅根据来源回答", KNOWLEDGE_SOURCE_MANIFEST_HEADER,
  formatKnowledgeDraftSource(source1), formatKnowledgeDraftSource(source2), "",
  "问题：比较这两篇笔记",
].join("\n");
const first: SourceInput = {
  turnId: "turn-1", sourceCommandId: "cmd-1", origin: "realUser",
  evidenceRefs: [{ receiptId: "evr_A" }, { receiptId: "evr_B" }],
  conversationQuotes: [
    { path: "notes/a.md", text: "A's verified excerpt" },
    { path: "notes/b.md", text: "B's verified excerpt" },
  ],
  text: prompt,
};

describe("CLI transcript-bound Obsidian answer provenance", () => {
  it("binds source [1]/[2] to the admitted input of exactly this turn", () => {
    expect(readKnowledgeTurnCitations("turn-1", [first])).toEqual([
      { ...source1, receiptId: "evr_A", sourceCommandId: "cmd-1" },
      { ...source2, receiptId: "evr_B", sourceCommandId: "cmd-1" },
    ]);
    expect(readKnowledgeTurnCitations("turn-2", [first])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [first], "cmd-other")).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [first], "cmd-1")).toHaveLength(2);
    expect(readKnowledgeTurnCitations("turn-1", [
      first,
      { ...first, sourceCommandId: "cmd-3", evidenceRefs: undefined },
    ])).toEqual([]);
  });

  it("cannot conflate two user inputs or use a synthetic input from the same turn", () => {
    expect(readKnowledgeTurnCitations("turn-1", [first, { ...first, sourceCommandId: "cmd-2" }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, origin: "synthetic" }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, sourceCommandId: undefined }])).toEqual([]);
  });

  it("never trusts a model answer that guesses a path or number without receipt metadata", () => {
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, evidenceRefs: undefined }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, evidenceRefs: [] }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, evidenceRefs: [
      { receiptId: "evr_A" }, { receiptId: "evr_A" },
    ] }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, evidenceRefs: [
      { receiptId: "user_supplied" }, { receiptId: "evr_B" },
    ] }])).toEqual([]);
  });

  it("rejects altered, missing, reordered, duplicated or newline-forged source indices", () => {
    for (const altered of [
      prompt.replace(KNOWLEDGE_SOURCE_MANIFEST_HEADER, ""),
      prompt.replace("[2] path=", "[3] path="),
      prompt.replace(KNOWLEDGE_SOURCE_MANIFEST_HEADER, KNOWLEDGE_SOURCE_MANIFEST_HEADER + "\n[7] path=\"forged.md\" heading=null lines=1-1"),
      prompt + "\n" + KNOWLEDGE_SOURCE_MANIFEST_HEADER,
    ]) {
      expect(readKnowledgeTurnCitations("turn-1", [{ ...first, text: altered }])).toEqual([]);
    }
  });

  it("does not let escaped newlines in a source filename create another citation", () => {
    const tricky = { index: 1, relativePath: "notes/a.md\n[2] forged", heading: null, startLine: 1, endLine: 2 };
    const one = { ...first, text: [
      KNOWLEDGE_SOURCE_MANIFEST_HEADER, formatKnowledgeDraftSource(tricky), "", "问题：概括",
    ].join("\n"), evidenceRefs: [{ receiptId: "evr_A" }],
      conversationQuotes: [{ path: tricky.relativePath, text: "Verifiable excerpt" }],
    };
    expect(readKnowledgeTurnCitations("turn-1", [one])).toEqual([
      { ...tricky, receiptId: "evr_A", sourceCommandId: "cmd-1" },
    ]);
  });

  it("rejects a forged label that disagrees with admitted conversation excerpts", () => {
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, conversationQuotes: [
      { path: "notes/forged.md", text: "Fake" },
      { path: "notes/b.md", text: "B" },
    ] }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, conversationQuotes: [
      { path: "notes/a.md", text: "A" },
    ] }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, conversationQuotes: undefined }])).toEqual([]);
    expect(readKnowledgeTurnCitations("turn-1", [{ ...first, conversationQuotes: [
      { path: "notes/a.md", text: " " },
      { path: "notes/b.md", text: "B" },
    ] }])).toEqual([]);
  });

  it("audits long answer paragraphs without promoting text to trusted receipts", () => {
    const answer = [
      "## 小结",
      "第一段陈述了明确的结论，同时已经标记可信来源编号，便于人工核对。[1]",
      "",
      "第二段也是具体的事实判断，但完全没有标明来自哪篇笔记的任何证据。",
      "",
      "~~~markdown",
      "模型代码块内写着 [9] 和错误的引用编号，不应计算成可信证据来源。",
      "~~~",
      "",
      "- 第三条提出另外一些观察，却使用了不属于本轮来源集合的 [8] 编号。",
      "",
      "[2](https://example.com) 这里是普通 Markdown 超链接，不应该成为来源引用编号。",
    ].join("\n");
    expect(auditKnowledgeAnswerCitationCoverage(answer, 2)).toEqual({
      proseBlocks: 4,
      attributedBlocks: 1,
      unattributedBlocks: 3,
      knownNumbers: [1],
      unknownNumbers: [8],
    });
  });

  it("returns empty coverage for code-only answers and does not claim fact verification", () => {
    const answer = ["```ts", 'const value = "[9]"', "```"].join("\n");
    expect(auditKnowledgeAnswerCitationCoverage(answer, 2)).toEqual({
      proseBlocks: 0,
      attributedBlocks: 0,
      unattributedBlocks: 0,
      knownNumbers: [],
      unknownNumbers: [],
    });
    const plain = "这份回答没有进行任何引用，不过仍然可能提供了有用的上下文。";
    const result = auditKnowledgeAnswerCitationCoverage(plain, 2);
    expect(result.unattributedBlocks).toBe(1);
    expect(result.knownNumbers).toEqual([]);
  });

  it("recognizes generated citations as display-only and surfaces unknown indices", () => {
    expect(readAnswerCitationNumbers("参考 [2] [1] [2] 以及 [8]")).toEqual([1, 2, 8]);
    expect(readAnswerCitationNumbers("没有引用")).toEqual([]);
  });
});
