/**
 * W05 决策策略/缓存/Telemetry 单测（spec §5d.5–§5d.7）。
 *
 * 纯函数层：五动作裁决（硬条件优先）、扩搜一次上限、单调融合、缓存键与失效、
 * telemetry 计数。运行：node --import tsx --test packages/services/test/knowledgeDecisionPolicy.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DECISION_POLICY,
  DECISION_POLICY_VERSION,
  decideByPolicy,
  normalizeLocalScores,
  normalizeQueryForHash,
  queryHashOf,
  resolvePolicyConfig,
} from "../src/knowledge/decision/decisionPolicy.js";
import { DecisionCache, decisionCacheKeyOf } from "../src/knowledge/decision/decisionCache.js";
import { DecisionTelemetry } from "../src/knowledge/decision/decisionTelemetry.js";
import { localFallbackOutcomes } from "../src/knowledge/decision/localFallback.js";
import type { KnowledgeDecisionCandidate, KnowledgeDecisionOutcome } from "../src/knowledge/decision/decisionTypes.js";

function candidatesOf(ids: string[]): KnowledgeDecisionCandidate[] {
  return ids.map((id, index) => ({
    candidateId: id,
    chunkSha256: `sha-${id}`,
    title: `t-${id}`,
    headingPath: null,
    excerpt: ` excerpt ${id} `,
    localRank: index + 1,
    localScore: 0,
  }));
}

function scored(outcomes: Array<[string, number]>): KnowledgeDecisionOutcome[] {
  return outcomes.map(([candidateId, noul]) => ({ candidateId, status: "scored" as const, noul }));
}

test("名次归一：单调且 ∈(0,1]，与 bm25 原始量纲无关", () => {
  const candidates = candidatesOf(["a", "b", "c", "d"]);
  normalizeLocalScores(candidates);
  assert.equal(candidates[0]?.localScore, 1);
  assert.equal(candidates[3]?.localScore, 0.25);
  for (let index = 1; index < candidates.length; index++) {
    const previous = candidates[index - 1]?.localScore ?? 0;
    const current = candidates[index]?.localScore ?? 0;
    assert.ok(previous > current, "名次靠前分数必须更高");
  }
});

test("空候选 → NO_RELIABLE_MATCH，且 Jev 高分不可越权（Jev 不能补召回）", () => {
  // 无扩搜前提（或已扩过）：终态即 NO_RELIABLE_MATCH，任何决策产出不可翻案。
  const decision = decideByPolicy({
    candidates: [],
    outcomes: [{ candidateId: "ghost", status: "scored", noul: 0.99 }],
    canExpand: false,
    expanded: true,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "NO_RELIABLE_MATCH");
  assert.equal(decision.shouldExpand, false);
});

test("A11 扩搜上限一次：AND 空且未扩过 → EXPAND_ONCE；扩过后不再建议扩搜", () => {
  const first = decideByPolicy({
    candidates: [],
    outcomes: [],
    canExpand: true,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(first.action, "EXPAND_ONCE");
  assert.equal(first.shouldExpand, true);

  const after = decideByPolicy({
    candidates: [],
    outcomes: [],
    canExpand: true,
    expanded: true,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(after.action, "NO_RELIABLE_MATCH");
  assert.equal(after.shouldExpand, false);

  // 单词元查询不具备扩搜前提。
  const single = decideByPolicy({
    candidates: [],
    outcomes: [],
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(single.action, "NO_RELIABLE_MATCH");
});

test("top noul ≥ directThreshold → PREPARE_EVIDENCE_FOR_AGENT（仅建议动作）", () => {
  const candidates = candidatesOf(["a", "b"]);
  normalizeLocalScores(candidates);
  const decision = decideByPolicy({
    candidates,
    outcomes: scored([
      ["a", 0.9],
      ["b", 0.3],
    ]),
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "PREPARE_EVIDENCE_FOR_AGENT");
  // 融合名次：高分者第一。
  assert.equal(decision.fusedRankByCandidateId.get("a"), 1);
  assert.equal(decision.fusedScoreByCandidateId.get("a"), 0.35 * 1 + 0.65 * 0.9);
});

test("低分且存在中段分数 → ASK_CLARIFICATION（不强选一篇，A27 语义）", () => {
  const candidates = candidatesOf(["a", "b", "c"]);
  normalizeLocalScores(candidates);
  const decision = decideByPolicy({
    candidates,
    outcomes: scored([
      ["a", 0.4],
      ["b", 0.3],
      ["c", 0.1],
    ]),
    canExpand: false,
    expanded: true,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "ASK_CLARIFICATION");
});

test("前两名分差 ≤ ambiguityBand → ASK_CLARIFICATION（并列近似候选）", () => {
  const candidates = candidatesOf(["a", "b"]);
  normalizeLocalScores(candidates);
  const decision = decideByPolicy({
    candidates,
    outcomes: scored([
      ["a", 0.7],
      ["b", 0.66],
    ]),
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "ASK_CLARIFICATION");
});

test("无决策产出（off/denied/fallback）→ 保持本地名次与 SHOW_CANDIDATES", () => {
  const candidates = candidatesOf(["a", "b", "c"]);
  normalizeLocalScores(candidates);
  const decision = decideByPolicy({
    candidates,
    outcomes: [],
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "SHOW_CANDIDATES");
  assert.equal(decision.fusedRankByCandidateId.get("a"), 1);
  assert.equal(decision.fusedRankByCandidateId.get("b"), 2);
  // 回退候选融合分只取本地项。
  assert.equal(decision.fusedScoreByCandidateId.get("a"), DEFAULT_DECISION_POLICY.weightLocal * 1);
});

test("非法评分（NaN/出界）不参与动作裁决与融合；未知 ID 的剔除属管线层（分层裁剪）", () => {
  const candidates = candidatesOf(["a", "b"]);
  normalizeLocalScores(candidates);
  // NaN / 出界 [0,1] / 缺失 noul：一律视为无效，不进入 top 比较。
  const decision = decideByPolicy({
    candidates,
    outcomes: [
      { candidateId: "a", status: "scored", noul: Number.NaN },
      { candidateId: "b", status: "scored", noul: 1.5 },
    ],
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(decision.action, "SHOW_CANDIDATES");
  assert.equal(decision.fusedScoreByCandidateId.get("a"), DEFAULT_DECISION_POLICY.weightLocal * 1);

  // 未知候选 ID（ghost）的剔除由决策管线完成（spec §5d.7 结果校验）；policy 层
  // 只信任传入产出——此处断言该分层，防止误把 ID 校验下沉/上浮。
  const withGhost = decideByPolicy({
    candidates,
    outcomes: [{ candidateId: "ghost", status: "scored", noul: 0.99 }],
    canExpand: false,
    expanded: false,
    config: DEFAULT_DECISION_POLICY,
  });
  assert.equal(withGhost.action, "PREPARE_EVIDENCE_FOR_AGENT");
});

test("阈值/权重可配置且 resolvePolicyConfig 保留默认基底", () => {
  const config = resolvePolicyConfig({ directThreshold: 0.5, weightJev: 0.5, weightLocal: 0.5 });
  assert.equal(config.directThreshold, 0.5);
  assert.equal(config.maxCandidates, DEFAULT_DECISION_POLICY.maxCandidates);
  const candidates = candidatesOf(["a"]);
  normalizeLocalScores(candidates);
  const decision = decideByPolicy({
    candidates,
    outcomes: scored([["a", 0.6]]),
    canExpand: false,
    expanded: false,
    config,
  });
  assert.equal(decision.action, "PREPARE_EVIDENCE_FOR_AGENT");
  assert.ok(Math.abs((decision.fusedScoreByCandidateId.get("a") ?? 0) - (0.5 * 1 + 0.5 * 0.6)) < 1e-12);
});

test("queryHash：规范化空白后哈希，不同空白同一哈希", () => {
  assert.equal(normalizeQueryForHash("  大上下文   窗口 \n"), "大上下文 窗口");
  assert.equal(queryHashOf(" 大上下文 窗口 "), queryHashOf("大上下文    窗口"));
  assert.notEqual(queryHashOf("大上下文 窗口"), queryHashOf("长期记忆"));
});

test("缓存：键含 provider/model/policy/vault/epoch/queryHash/chunkSha，任一变化即不同键", () => {
  const base = {
    providerId: "jev-typesafe",
    modelId: "jev-latest",
    policyVersion: DECISION_POLICY_VERSION,
    vaultId: "v1",
    sourceEpoch: 1,
    queryHash: "qh",
    chunkSha256: "cs",
  };
  const key = decisionCacheKeyOf(base);
  assert.equal(key, decisionCacheKeyOf({ ...base }));
  assert.notEqual(key, decisionCacheKeyOf({ ...base, sourceEpoch: 2 }));
  assert.notEqual(key, decisionCacheKeyOf({ ...base, modelId: "jev-1" }));
  assert.notEqual(key, decisionCacheKeyOf({ ...base, policyVersion: "other" }));
  assert.notEqual(key, decisionCacheKeyOf({ ...base, queryHash: "qh2" }));
  assert.notEqual(key, decisionCacheKeyOf({ ...base, chunkSha256: "cs2" }));
});

test("缓存：LRU 有界 + 按谓词失效（撤权/换源清理）", () => {
  const cache = new DecisionCache(2);
  const entry = (candidateId: string) => ({
    outcomes: [{ candidateId, status: "scored" as const, noul: 0.5 }],
    modelVersion: "jev-1",
    createdAtMs: 0,
    vaultId: "v1",
    sourceEpoch: 1,
    queryHash: "qh",
  });
  cache.set("k1", entry("a"));
  cache.set("k2", entry("b"));
  cache.set("k3", entry("c"));
  assert.equal(cache.size, 2);
  assert.equal(cache.get("k1"), null, "超出容量的最旧条目被淘汰");

  cache.set("k1", entry("a"));
  cache.set("k2", entry("b"));
  const removed = cache.invalidate((_, value) => value.queryHash === "qh" && value.sourceEpoch === 1);
  assert.equal(removed, 2);
  assert.equal(cache.size, 0);

  // LRU 命中刷新：容量 3，命中 k1 后 k2 成为最旧条目被淘汰。
  const lru = new DecisionCache(3);
  lru.set("k1", entry("a"));
  lru.set("k2", entry("b"));
  lru.set("k3", entry("c"));
  assert.notEqual(lru.get("k1"), null); // k1 移到队尾
  lru.set("k4", entry("d")); // 淘汰最旧的 k2
  assert.notEqual(lru.get("k1"), null);
  assert.equal(lru.get("k2"), null);
  assert.notEqual(lru.get("k3"), null);
  assert.notEqual(lru.get("k4"), null);
});

test("telemetry：出站/回退分桶/缓存命中/token 计数（不落内容）", () => {
  const telemetry = new DecisionTelemetry();
  telemetry.recordStage({
    outboundCount: 2,
    cacheHitCount: 1,
    outcomes: [
      { candidateId: "a", status: "scored" },
      { candidateId: "b", status: "fallback", fallbackReason: "timeout" },
      { candidateId: "c", status: "fallback", fallbackReason: "invalid_score" },
    ],
    inputTokens: 100,
    outputTokens: 10,
    latencyMs: 42,
  });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.outboundCountTotal, 2);
  assert.equal(snapshot.scoredCountTotal, 1);
  assert.equal(snapshot.fallbackCountTotal, 2);
  assert.equal(snapshot.fallbackByReason.timeout, 1);
  assert.equal(snapshot.fallbackByReason.invalid_score, 1);
  assert.equal(snapshot.cacheHitCountTotal, 1);
  assert.equal(snapshot.inputTokensTotal, 100);
  assert.deepEqual(snapshot.latencySamplesMs, [42]);
  // 快照是拷贝：后续累计不影响已取快照。
  telemetry.recordStage({
    outboundCount: 1,
    cacheHitCount: 0,
    outcomes: [{ candidateId: "d", status: "scored" }],
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 5,
  });
  assert.equal(snapshot.outboundCountTotal, 2);
  assert.equal(telemetry.snapshot().outboundCountTotal, 3);
});

test("LocalFallback：全部候选回退、保持本地名次、零出站", () => {
  const candidates = candidatesOf(["a", "b"]);
  const outcomes = localFallbackOutcomes(candidates, "disabled_no_provider");
  assert.deepEqual(
    outcomes.map((outcome) => outcome.candidateId),
    ["a", "b"],
  );
  assert.ok(outcomes.every((outcome) => outcome.status === "fallback"));
});
