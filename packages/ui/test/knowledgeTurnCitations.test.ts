import { describe, expect, it } from "vitest";
import type { UserInputRow } from "@drora/shared/drora-protocol-v4";
import { formatKnowledgeDraftSource, KNOWLEDGE_SOURCE_MANIFEST_HEADER } from "../src/lib/conversationKnowledgeSources.js";
import { readKnowledgeTurnCitations, readAnswerCitationNumbers } from "../src/v4/knowledgeTurnCitations.js";

type SourceInput = Pick<UserInputRow, "turnId" | "sourceCommandId" | "origin" | "evidenceRefs" | "text">;
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
    ].join("\n"), evidenceRefs: [{ receiptId: "evr_A" }] };
    expect(readKnowledgeTurnCitations("turn-1", [one])).toEqual([
      { ...tricky, receiptId: "evr_A", sourceCommandId: "cmd-1" },
    ]);
  });

  it("recognizes generated citations as display-only and surfaces unknown indices", () => {
    expect(readAnswerCitationNumbers("参考 [2] [1] [2] 以及 [8]")).toEqual([1, 2, 8]);
    expect(readAnswerCitationNumbers("没有引用")).toEqual([]);
  });
});
