/**
 * 洞察视图纯模型测试（spec §5g.6 / 验收 K-INS-3）。
 *
 * 覆盖非零排除项的固定顺序过滤、轮询窗口派生、时长格式化。
 * 运行：node --import tsx --test packages/ui/test/knowledgeInsightsModel.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeCoverage, KnowledgeInsightsSnapshot } from "@drora/services";
import {
  deriveInsightsPolling,
  formatInsightsDuration,
  nonZeroCoverageExclusions,
} from "../src/v4/vault/knowledge/knowledgeInsightsModel.js";

function makeCoverage(overrides: Partial<KnowledgeCoverage> = {}): KnowledgeCoverage {
  return {
    indexedFiles: 10,
    indexedChunks: 40,
    excludedHidden: 0,
    excludedSymlink: 0,
    excludedNotMarkdown: 0,
    excludedOverSize: 0,
    excludedOverQuota: 0,
    excludedDepth: 0,
    truncatedFiles: 0,
    partial: false,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<KnowledgeInsightsSnapshot> = {},
): KnowledgeInsightsSnapshot {
  return {
    configured: true,
    source: { vaultId: "vault-1", sourceEpoch: 1, displayName: "笔记库" },
    inventory: { documents: 10, chunks: 40, taggedDocuments: 3, wikilinkCount: 12 },
    coverage: makeCoverage(),
    recentJobs: [],
    decision: {
      outboundCountTotal: 0,
      cacheHitCountTotal: 0,
      fallbackCountTotal: 0,
      scoredCountTotal: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
    },
    ...overrides,
  };
}

test("nonZeroCoverageExclusions：只列非零项且顺序固定（hidden→symlink→非md→超限→配额→深度→截断）", () => {
  const exclusions = nonZeroCoverageExclusions(
    makeCoverage({
      excludedHidden: 2,
      excludedNotMarkdown: 5,
      excludedDepth: 1,
      truncatedFiles: 3,
      partial: true,
    }),
  );
  assert.deepEqual(
    exclusions.map((entry) => entry.key),
    ["hidden", "notMarkdown", "depth", "truncated"],
  );
  assert.deepEqual(exclusions, [
    { key: "hidden", count: 2 },
    { key: "notMarkdown", count: 5 },
    { key: "depth", count: 1 },
    { key: "truncated", count: 3 },
  ]);
});

test("nonZeroCoverageExclusions：全零 → 空数组（呈现「完整」，零计数不渲染）", () => {
  assert.deepEqual(nonZeroCoverageExclusions(makeCoverage()), []);
});

test("deriveInsightsPolling：最近任务 running → 轮询开启；无快照/终态/无任务 → 关闭", () => {
  assert.equal(deriveInsightsPolling(null), false);
  assert.equal(deriveInsightsPolling(makeSnapshot()), false);
  assert.equal(
    deriveInsightsPolling(
      makeSnapshot({
        recentJobs: [
          {
            kind: "reconcile",
            status: "completed",
            startedAtMs: 1,
            finishedAtMs: 2,
            durationMs: 1,
            indexedFiles: 1,
            indexedChunks: 1,
            reason: null,
          },
        ],
      }),
    ),
    false,
  );
  assert.equal(
    deriveInsightsPolling(
      makeSnapshot({
        recentJobs: [
          {
            kind: "rebuild",
            status: "running",
            startedAtMs: 1,
            finishedAtMs: null,
            durationMs: null,
            indexedFiles: 0,
            indexedChunks: 0,
            reason: null,
          },
        ],
      }),
    ),
    true,
  );
});

test("formatInsightsDuration：null 空串（进行中另呈状态）；ms/s/分秒各档", () => {
  assert.equal(formatInsightsDuration(null), "");
  assert.equal(formatInsightsDuration(850), "850ms");
  assert.equal(formatInsightsDuration(1000), "1s");
  assert.equal(formatInsightsDuration(1500), "1.5s");
  assert.equal(formatInsightsDuration(59_000), "59s");
  assert.equal(formatInsightsDuration(60_000), "1m");
  assert.equal(formatInsightsDuration(65_000), "1m 5s");
});
