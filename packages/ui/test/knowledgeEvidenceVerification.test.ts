import assert from "node:assert/strict";
import test from "node:test";
import type { IKnowledgeQueryService } from "@drora/services";
import { verifyKnowledgeCandidateEvidence } from "../src/v4/vault/knowledge/knowledgeEvidenceVerification.js";

const quote = { startLine: 3, endLine: 4, startOffset: 12, endOffset: 38 };

function mockService(
  prepare: (input: unknown) => Promise<unknown>,
  resolve: (input: unknown) => Promise<unknown>,
): IKnowledgeQueryService {
  return { prepareEvidence: prepare, resolveCitation: resolve } as unknown as IKnowledgeQueryService;
}

test("citation verification: current receipt requires a second source-backed resolution", async () => {
  const calls: unknown[] = [];
  const service = mockService(
    async (params) => {
      calls.push(["prepare", params]);
      return { status: "current", receipt: { receiptId: "evr_verified" } };
    },
    async (params) => {
      calls.push(["resolve", params]);
      return {
        status: "current",
        citation: {
          receiptId: "evr_verified",
          excerpt: "可验证的正文",
          relativePath: "notes/a.md",
          title: "A",
          heading: "上下文",
          quote,
        },
      };
    },
  );
  const result = await verifyKnowledgeCandidateEvidence({
    queryService: service, runId: "run-1", articleId: "article-1", sessionId: "session-1",
  });
  assert.deepEqual(result, {
    phase: "verified",
    receiptId: "evr_verified",
    excerpt: "可验证的正文",
    relativePath: "notes/a.md",
    title: "A",
    heading: "上下文",
    quote,
  });
  assert.deepEqual(calls, [
    ["prepare", { runId: "run-1", articleId: "article-1" }],
    ["resolve", { receiptId: "evr_verified", sessionId: "session-1" }],
  ]);
});

test("citation verification: failed preparation must not try resolve", async () => {
  let resolves = 0;
  const service = mockService(
    async () => ({ status: "source_stale", receipt: null }),
    async () => { resolves++; throw new Error("should not be called"); },
  );
  const result = await verifyKnowledgeCandidateEvidence({
    queryService: service, runId: "run-1", articleId: "article-1",
  });
  assert.deepEqual(result, { phase: "unavailable", status: "source_stale", reason: null });
  assert.equal(resolves, 0);
});

test("citation verification: a receipt can become stale between prepare and resolve", async () => {
  const service = mockService(
    async () => ({ status: "current", receipt: { receiptId: "evr_stale" } }),
    async () => ({ status: "stale", reason: "file_modified", citation: null }),
  );
  const result = await verifyKnowledgeCandidateEvidence({
    queryService: service, runId: "run-1", articleId: "article-1", sessionId: "session-1",
  });
  assert.deepEqual(result, { phase: "unavailable", status: "stale", reason: "file_modified" });
});

test("citation verification: RPC exception is never displayed as verified", async () => {
  const service = mockService(
    async () => ({ status: "current", receipt: { receiptId: "evr_unavailable" } }),
    async () => { throw new Error("host disconnected"); },
  );
  const result = await verifyKnowledgeCandidateEvidence({
    queryService: service, runId: "run-1", articleId: "article-1",
  });
  assert.deepEqual(result, { phase: "failed", message: "host disconnected" });
});
