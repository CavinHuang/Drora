import assert from "node:assert/strict";
import test from "node:test";
import type {
  IKnowledgeQueryService,
  KnowledgeArticleCandidate,
  KnowledgeEvidenceReceipt,
  KnowledgeRunView,
} from "@drora/services";
import {
  verifyKnowledgeCandidateEvidence,
  verifyPreviousKnowledgeCandidateEvidence,
} from "../src/v4/vault/knowledge/knowledgeEvidenceVerification.js";
import {
  appendConversationSelectionReference,
  collectConversationEvidenceRefs,
  createConversationSelectionReference,
} from "../src/lib/conversationSelectionReference.js";

const quote = { startLine: 3, endLine: 4, startOffset: 12, endOffset: 38 };
const candidate: KnowledgeArticleCandidate = {
  articleId: "article-1",
  title: "A",
  relativePath: "notes/a.md",
  matchedHeading: "上下文",
  excerpt: "可验证的正文",
  quote,
  fileSha256: "f".repeat(64),
  chunkSha256: "c".repeat(64),
  rank: 1,
  score: 1,
  matchedChunkCount: 1,
  evidenceStatus: "unverified",
};
const run: Pick<KnowledgeRunView, "runId" | "sessionId" | "source"> = {
  runId: "run-1",
  sessionId: "session-1",
  source: { vaultId: "vault-1", sourceEpoch: 1 },
};
const receipt: KnowledgeEvidenceReceipt = {
  receiptId: "evr_verified",
  runId: run.runId,
  sessionId: "session-1",
  articleId: candidate.articleId,
  vaultId: "vault-1",
  sourceEpoch: 1,
  sourceFingerprint: "source-fingerprint",
  relativePath: candidate.relativePath,
  title: "A",
  heading: "上下文",
  fileSha256: candidate.fileSha256,
  chunkSha256: candidate.chunkSha256,
  quote,
  excerpt: "可验证的正文",
  createdAtMs: 1,
};
const citation = {
  receiptId: receipt.receiptId,
  sessionId: receipt.sessionId,
  runId: receipt.runId,
  articleId: receipt.articleId,
  relativePath: receipt.relativePath,
  title: receipt.title,
  heading: receipt.heading,
  quote,
  excerpt: receipt.excerpt,
  createdAtMs: 1,
};
function mockService(
  prepare: (input: unknown) => Promise<unknown>,
  resolve: (input: unknown) => Promise<unknown>,
): IKnowledgeQueryService {
  return {
    prepareEvidence: prepare,
    resolveCitation: resolve,
  } as unknown as IKnowledgeQueryService;
}
function verify(queryService: IKnowledgeQueryService) {
  return verifyKnowledgeCandidateEvidence({
    queryService,
    run,
    candidate,
    sessionId: "session-1",
  });
}

test("citation verification: current receipt requires a second source-backed resolution", async () => {
  const calls: unknown[] = [];
  const service = mockService(
    async (params) => {
      calls.push(["prepare", params]);
      return { status: "current", receipt };
    },
    async (params) => {
      calls.push(["resolve", params]);
      return { status: "current", citation };
    },
  );
  const result = await verify(service);
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
    async () => {
      resolves++;
      throw new Error("should not be called");
    },
  );
  const result = await verify(service);
  assert.deepEqual(result, { phase: "unavailable", status: "source_stale", reason: null });
  assert.equal(resolves, 0);
});

test("citation verification: a receipt can become stale between prepare and resolve", async () => {
  const service = mockService(
    async () => ({ status: "current", receipt }),
    async () => ({ status: "stale", reason: "file_modified", citation: null }),
  );
  assert.deepEqual(await verify(service), {
    phase: "unavailable",
    status: "stale",
    reason: "file_modified",
  });
});

test("citation verification: RPC exception is never displayed as verified", async () => {
  const service = mockService(
    async () => ({ status: "current", receipt }),
    async () => {
      throw new Error("host disconnected");
    },
  );
  assert.deepEqual(await verify(service), { phase: "failed", message: "host disconnected" });
});

test("citation verification: identity or quote mismatch fails closed despite current status", async () => {
  const violations = [
    { mutatedReceipt: { receiptId: "evr_other" }, mutatedCitation: {} },
    { mutatedReceipt: {}, mutatedCitation: { runId: "run-other" } },
    { mutatedReceipt: {}, mutatedCitation: { sessionId: "session-other" } },
    { mutatedReceipt: {}, mutatedCitation: { articleId: "article-other" } },
    { mutatedReceipt: {}, mutatedCitation: { relativePath: "notes/other.md" } },
    { mutatedReceipt: { fileSha256: "0".repeat(64) }, mutatedCitation: {} },
    { mutatedReceipt: { chunkSha256: "0".repeat(64) }, mutatedCitation: {} },
    { mutatedReceipt: { sourceEpoch: 99 }, mutatedCitation: {} },
    { mutatedReceipt: {}, mutatedCitation: { quote: { ...quote, startOffset: 99 } } },
    { mutatedReceipt: {}, mutatedCitation: { excerpt: "   " } },
  ];
  for (const { mutatedReceipt, mutatedCitation } of violations) {
    const service = mockService(
      async () => ({ status: "current", receipt: { ...receipt, ...mutatedReceipt } }),
      async () => ({ status: "current", citation: { ...citation, ...mutatedCitation } }),
    );
    assert.deepEqual(await verify(service), {
      phase: "unavailable",
      status: "forbidden",
      reason: "citation_mismatch",
    });
  }
});

test("citation verification: an unbound lookup may inspect current text without gaining a session claim", async () => {
  const service = mockService(
    async () => ({ status: "current", receipt: { ...receipt, sessionId: "" } }),
    async () => ({ status: "current", citation: { ...citation, sessionId: "" } }),
  );
  const result = await verifyKnowledgeCandidateEvidence({
    queryService: service,
    run: { ...run, sessionId: null },
    candidate,
  });
  assert.equal(result.phase, "verified");
  assert.deepEqual(await verify(service), {
    phase: "unavailable",
    status: "forbidden",
    reason: "citation_mismatch",
  });
});

test("previous-round navigation issues a fresh receipt and uses verified source position", async () => {
  const calls: unknown[] = [];
  const service = mockService(
    async (params) => {
      calls.push(["prepare", params]);
      return { status: "current", receipt };
    },
    async (params) => {
      calls.push(["resolve", params]);
      return { status: "current", citation };
    },
  );
  const previousRun = { ...run, status: "ready", candidates: [candidate] } as KnowledgeRunView;
  const result = await verifyPreviousKnowledgeCandidateEvidence({
    queryService: service,
    run: previousRun,
    candidate,
    sessionId: "session-1",
  });
  assert.equal(result.phase, "verified");
  if (result.phase === "verified") {
    assert.equal(result.relativePath, "notes/a.md");
    assert.deepEqual(result.quote, quote);
  }
  assert.deepEqual(calls, [
    ["prepare", { runId: "run-1", articleId: "article-1" }],
    ["resolve", { receiptId: "evr_verified", sessionId: "session-1" }],
  ]);
});

test("previous-round navigation rejects cancelled runs and candidates not in the historical run", async () => {
  let callCount = 0;
  const service = mockService(
    async () => {
      callCount++;
      return { status: "current", receipt };
    },
    async () => {
      callCount++;
      return { status: "current", citation };
    },
  );
  const historical = { ...run, status: "ready", candidates: [candidate] } as KnowledgeRunView;
  for (const invalid of [
    { run: { ...historical, status: "cancelled" as const }, candidate },
    { run: historical, candidate: { ...candidate, articleId: "different" } },
    { run: historical, candidate: { ...candidate, quote: { ...quote, startLine: 7 } } },
  ]) {
    assert.deepEqual(
      await verifyPreviousKnowledgeCandidateEvidence({
        queryService: service,
        ...invalid,
        sessionId: "session-1",
      }),
      { phase: "unavailable", status: "forbidden", reason: "previous_candidate_unavailable" },
    );
  }
  assert.equal(callCount, 0);
});

test("previous-round navigation fails closed for changed or deleted sources", async () => {
  const historical = { ...run, status: "partial", candidates: [candidate] } as KnowledgeRunView;
  for (const status of ["stale", "missing"] as const) {
    const service = mockService(
      async () => ({ status: "current", receipt }),
      async () => ({
        status,
        reason: status === "stale" ? "file_modified" : "file_deleted",
        citation: null,
      }),
    );
    const result = await verifyPreviousKnowledgeCandidateEvidence({
      queryService: service,
      run: historical,
      candidate,
      sessionId: "session-1",
    });
    assert.equal(result.phase, "unavailable");
    if (result.phase === "unavailable") assert.equal(result.status, status);
  }
});

test("a follow-up explicitly reattaches a previous note with a freshly verified receipt", async () => {
  const historical = { ...run, status: "ready", candidates: [candidate] } as KnowledgeRunView;
  const service = mockService(
    async () => ({ status: "current", receipt: { ...receipt, receiptId: "evr_new_followup" } }),
    async () => ({ status: "current", citation: { ...citation, receiptId: "evr_new_followup" } }),
  );
  const proof = await verifyPreviousKnowledgeCandidateEvidence({
    queryService: service,
    run: historical,
    candidate,
    sessionId: "session-1",
  });
  assert.equal(proof.phase, "verified");
  if (proof.phase !== "verified") return;
  const reference = createConversationSelectionReference({
    contentType: "markdown",
    sourceKey: "vault:" + proof.relativePath,
    sourceTitle: proof.title,
    path: proof.relativePath,
    text: proof.excerpt,
    evidenceReceiptId: proof.receiptId,
  });
  const added = appendConversationSelectionReference([], reference);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.deepEqual(collectConversationEvidenceRefs(added.references), [
    { receiptId: "evr_new_followup" },
  ]);
});

test("a prior session's note cannot be silently promoted into a new Agent session", async () => {
  const historical = { ...run, status: "ready", candidates: [candidate] } as KnowledgeRunView;
  const service = mockService(
    async () => ({ status: "current", receipt }),
    async () => ({ status: "current", citation }),
  );
  assert.deepEqual(
    await verifyPreviousKnowledgeCandidateEvidence({
      queryService: service,
      run: historical,
      candidate,
      sessionId: "session-other",
    }),
    { phase: "unavailable", status: "forbidden", reason: "citation_mismatch" },
  );
});
