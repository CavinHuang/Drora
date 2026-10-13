/**
 * VaultSearch 协议映射单测（obsidian-knowledge.md §5f.2/VS-1、VS-2）。
 *
 * 断言字段白名单边界：不含 score（bm25 值不是正确率）、不含 sha 字段（可验证性归
 * W03 Receipt）、不含绝对路径；结构化 status 直通不编造；非终态防御性落 failed。
 * 运行：node --import tsx --test packages/services/test/knowledgeVaultSearchProtocol.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { toVaultSearchProtocolResult } from "../src/knowledge/vaultSearchProtocol.js";
import type { KnowledgeRunView } from "../src/knowledge/knowledgeTypes.js";

function baseRun(overrides: Partial<KnowledgeRunView>): KnowledgeRunView {
  return {
    runId: "run-1",
    runGeneration: 1,
    status: "ready",
    query: "上下文窗口",
    sessionId: null,
    source: null,
    createdAtMs: 0,
    finishedAtMs: 1,
    candidates: [],
    coverage: null,
    diagnostics: null,
    decision: null,
    reason: null,
    ...overrides,
  };
}

const fullCandidate = {
  articleId: "a1",
  title: "上下文窗口",
  relativePath: "notes/context.md",
  matchedHeading: "上下文 > 窗口",
  excerpt: "……命中感知摘要窗口……",
  quote: { startLine: 3, endLine: 9, startOffset: 40, endOffset: 220 },
  fileSha256: "f".repeat(64),
  chunkSha256: "c".repeat(64),
  rank: 1,
  score: -3.14,
  matchedChunkCount: 2,
  evidenceStatus: "unverified" as const,
};

test("VS-1：ready run → 字段白名单直通，score/sha/绝对路径面不外泄", () => {
  const result = toVaultSearchProtocolResult(
    baseRun({
      candidates: [fullCandidate],
      coverage: {
        indexedFiles: 3,
        indexedChunks: 30,
        excludedHidden: 0,
        excludedSymlink: 0,
        excludedNotMarkdown: 0,
        excludedOverSize: 0,
        excludedOverQuota: 0,
        excludedDepth: 0,
        truncatedFiles: 0,
        partial: false,
      },
      diagnostics: {
        semantic: "unavailable",
        semanticReason: "port_not_configured",
        lexicalChunkHits: 4,
        lexicalCandidates: 3,
        matchRelaxedToOr: true,
      },
    }),
  );
  assert.equal(result.status, "ready");
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.ok(candidate);
  assert.deepEqual(Object.keys(candidate).sort(), [
    "articleId",
    "excerpt",
    "matchedChunkCount",
    "matchedHeading",
    "quote",
    "rank",
    "relativePath",
    "title",
  ]);
  assert.equal(candidate.matchedChunkCount, 2);
  assert.deepEqual(Object.keys(result.diagnostics ?? {}).sort(), [
    "coveragePartial",
    "matchRelaxedToOr",
    "semantic",
  ]);
  assert.equal(result.diagnostics?.coveragePartial, false);
  assert.equal(result.diagnostics?.matchRelaxedToOr, true);
  assert.equal(result.diagnostics?.semantic, "unavailable");
});

test("VS-2：no_source → 结构化空结果，diagnostics 为 null；empty 同形", () => {
  const noSource = toVaultSearchProtocolResult(
    baseRun({ status: "no_source", reason: "vault_not_configured" }),
  );
  assert.deepEqual(noSource, {
    status: "no_source",
    reason: "vault_not_configured",
    candidates: [],
    diagnostics: null,
  });

  const empty = toVaultSearchProtocolResult(baseRun({ status: "empty" }));
  assert.equal(empty.status, "empty");
  assert.equal(empty.candidates.length, 0);
  assert.equal(empty.diagnostics, null);
});

test("防御：非终态 run（理论不可达）→ failed + 结构化原因，不把半成品当结果", () => {
  const result = toVaultSearchProtocolResult(baseRun({ status: "retrieving" }));
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "search_not_finished");
  assert.equal(result.candidates.length, 0);
});
