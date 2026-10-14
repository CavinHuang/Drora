import { describe, expect, it, vi } from "vitest";
import type { IKnowledgeQueryService, KnowledgeRunView } from "@drora/services";
import {
  buildKnowledgeAnswerPrompt,
  prepareKnowledgeAgentHandoff,
  sameKnowledgeHandoffScope,
} from "../src/v4/vault/knowledge/knowledgeAgentHandoff.js";

const quote = { startLine: 1, endLine: 1, startOffset: 0, endOffset: 10 };
const candidates = [
  { articleId: "note-a", relativePath: "notes/a.md", title: "A" },
  { articleId: "note-b", relativePath: "notes/b.md", title: "B" },
].map((item, i) => ({
  ...item,
  matchedHeading: null,
  excerpt: "Original text",
  quote,
  fileSha256: "f".repeat(64),
  chunkSha256: "c".repeat(64),
  rank: i + 1,
  score: 1,
  matchedChunkCount: 1,
  evidenceStatus: "unverified" as const,
})) satisfies KnowledgeRunView["candidates"];

function run(overrides: Partial<KnowledgeRunView> = {}): KnowledgeRunView {
  return {
    runId: "run-1",
    runGeneration: 1,
    status: "ready",
    query: "比较 A 和 B 的结论",
    sessionId: "session-1",
    source: { vaultId: "vault", sourceEpoch: 1 },
    createdAtMs: 1,
    finishedAtMs: 2,
    candidates,
    coverage: null,
    diagnostics: null,
    decision: null,
    reason: null,
    ...overrides,
  };
}

function verifier(failAt?: string) {
  const prepareEvidence = vi.fn(async ({ articleId }: { runId: string; articleId: string }) => (
    articleId === failAt
      ? { status: "stale" as const }
      : { status: "current" as const, receipt: {
        receiptId: `evr_${articleId}`,
        sessionId: "session-1",
        runId: "run-1",
        articleId,
        vaultId: "vault",
        sourceEpoch: 1,
        sourceFingerprint: "fixture",
        relativePath: `notes/${articleId.slice(-1)}.md`,
        title: articleId,
        heading: null,
        fileSha256: "f".repeat(64),
        chunkSha256: "c".repeat(64),
        quote,
        excerpt: `Original text from evr_${articleId}`,
        createdAtMs: 1,
      } }
  ));
  const resolveCitation = vi.fn(async ({ receiptId }: { receiptId: string; sessionId: string }) => ({
    status: "current" as const,
    citation: {
      receiptId,
      sessionId: "session-1",
      runId: "run-1",
      articleId: receiptId.replace(/^evr_/, ""),
      relativePath: `notes/${receiptId.slice(-1)}.md`,
      title: receiptId,
      excerpt: `Original text from ${receiptId}`,
      heading: null,
      quote,
      createdAtMs: 1,
    },
  }));
  // Keep the test stub narrow; the real implementation is exercised in knowledgeE2EFullChain.
  return {
    ports: { prepareEvidence, resolveCitation } as unknown as Pick<
      IKnowledgeQueryService, "prepareEvidence" | "resolveCitation"
    >,
    prepareEvidence,
    resolveCitation,
  };
}

describe("Obsidian trusted Agent handoff", () => {
  it("prepares two current source receipts and the original comparison question", async () => {
    const { ports, prepareEvidence, resolveCitation } = verifier();
    const result = await prepareKnowledgeAgentHandoff({
      run: run(),
      articleIds: ["note-a", "note-b"],
      sessionId: "session-1",
      intent: "compare",
      queryService: ports,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.references.map((r) => r.path)).toEqual(["notes/a.md", "notes/b.md"]);
    expect(result.references.map((r) => r.evidenceReceiptId)).toEqual(["evr_note-a", "evr_note-b"]);
    expect(result.prompt).toContain("问题：比较 A 和 B 的结论");
    expect(result.prompt).not.toContain("evr_note-a");
    expect(prepareEvidence).toHaveBeenCalledTimes(2);
    expect(resolveCitation).toHaveBeenCalledTimes(2);
  });

  it("ANSWER prepares two selected notes for one grounded cross-note synthesis", async () => {
    const { ports, prepareEvidence } = verifier();
    const result = await prepareKnowledgeAgentHandoff({
      run: run({ query: "总结 A 和 B 的观点" }),
      articleIds: ["note-a", "note-b"],
      sessionId: "session-1",
      intent: "answer",
      queryService: ports,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.references.map((r) => r.path)).toEqual(["notes/a.md", "notes/b.md"]);
    expect(result.references.every((r) => r.evidenceReceiptId?.startsWith("evr_"))).toBe(true);
    expect(result.prompt).toContain("问题：总结 A 和 B 的观点");
    expect(result.prompt).toContain("不同来源有冲突时分别说明");
    expect(prepareEvidence).toHaveBeenCalledTimes(2);
  });


  it("rejects async handoff when the source selection, order, run or target changes", () => {
    const captured = {
      runId: "run-1",
      sessionId: "session-1",
      workspaceKey: "/workspace",
      articleIds: ["note-a", "note-b"],
    };
    expect(sameKnowledgeHandoffScope(captured, { ...captured, articleIds: [...captured.articleIds] })).toBe(true);
    for (const stale of [
      { ...captured, articleIds: ["note-b", "note-a"] },
      { ...captured, articleIds: ["note-a"] },
      { ...captured, articleIds: ["note-a", "note-c"] },
      { ...captured, runId: "run-2" },
      { ...captured, sessionId: "session-2" },
      { ...captured, workspaceKey: "/another" },
    ]) {
      expect(sameKnowledgeHandoffScope(captured, stale)).toBe(false);
    }
  });

  it("does not return even the first reference if a later source is stale", async () => {
    const { ports } = verifier("note-b");
    expect(await prepareKnowledgeAgentHandoff({
      run: run(),
      articleIds: ["note-a", "note-b"],
      sessionId: "session-1",
      intent: "compare",
      queryService: ports,
    })).toEqual({ ok: false, reason: "evidence_unavailable" });
  });

  it("rejects another session, missing documents, and fewer than two compare sources", async () => {
    const { ports, prepareEvidence } = verifier();
    for (const input of [
      { sessionId: "session-other", articleIds: ["note-a", "note-b"], reason: "session_mismatch" },
      { sessionId: "session-1", articleIds: ["note-a"], reason: "invalid_selection" },
      { sessionId: "session-1", articleIds: ["note-a", "unknown"], reason: "invalid_selection" },
      { sessionId: "session-1", articleIds: ["note-a", "note-a"], reason: "invalid_selection" },
    ]) {
      expect(await prepareKnowledgeAgentHandoff({
        run: run(),
        sessionId: input.sessionId,
        articleIds: input.articleIds,
        intent: "compare",
        queryService: ports,
      })).toEqual({ ok: false, reason: input.reason });
    }
    expect(prepareEvidence).not.toHaveBeenCalled();
  });

  it("does not attach a failed or superseded query and does not invent an answer", async () => {
    const { ports, prepareEvidence } = verifier();
    expect(await prepareKnowledgeAgentHandoff({
      run: run({ status: "source_stale" }),
      articleIds: ["note-a"],
      sessionId: "session-1",
      intent: "answer",
      queryService: ports,
    })).toEqual({ ok: false, reason: "run_unavailable" });
    expect(prepareEvidence).not.toHaveBeenCalled();
    expect(buildKnowledgeAnswerPrompt("  为什么?  ", "answer")).toContain("问题：为什么?");
    expect(buildKnowledgeAnswerPrompt("test", "answer")).toContain("不要编造");
  });
  it("rejects a valid receipt that points to a different run, session or article", async () => {
    for (const violation of [
      { sessionId: "session-other" },
      { runId: "run-other" },
      { articleId: "note-b" },
    ]) {
      const { ports, resolveCitation } = verifier();
      resolveCitation.mockImplementationOnce(async ({ receiptId }) => ({
        status: "current" as const,
        citation: {
          receiptId,
          sessionId: "session-1",
          runId: "run-1",
          articleId: "note-a",
          relativePath: "notes/a.md",
          title: "A",
          excerpt: "Original text",
          heading: null,
          quote: { startLine: 1, endLine: 1, startOffset: 0, endOffset: 10 },
          ...violation,
        },
      }));
      expect(await prepareKnowledgeAgentHandoff({
        run: run(),
        articleIds: ["note-a"],
        sessionId: "session-1",
        intent: "answer",
        queryService: ports,
      })).toEqual({ ok: false, reason: "evidence_unavailable" });
    }
  });

  it("rejects a valid-looking citation with a different receipt or quote", async () => {
    for (const violation of [
      { receiptId: "evr_mismatched" },
      { quote: { ...quote, endOffset: 11 } },
    ]) {
      const { ports, resolveCitation } = verifier();
      resolveCitation.mockImplementationOnce(async ({ receiptId }) => ({
        status: "current" as const,
        citation: {
          receiptId,
          sessionId: "session-1",
          runId: "run-1",
          articleId: "note-a",
          relativePath: "notes/a.md",
          title: "A",
          excerpt: "Original text",
          heading: null,
          quote,
          createdAtMs: 1,
          ...violation,
        },
      }));
      expect(await prepareKnowledgeAgentHandoff({
        run: run(),
        articleIds: ["note-a"],
        sessionId: "session-1",
        intent: "answer",
        queryService: ports,
      })).toEqual({ ok: false, reason: "evidence_unavailable" });
    }
  });

});
