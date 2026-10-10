/**
 * 智能问库状态机测试（W04 / specs/obsidian-knowledge.md §5c）。
 *
 * 纯模型单测：run 代数守卫（A22）、意图分类、候选展开、证据态、状态条映射。
 * 运行：node --import tsx --test packages/ui/test/knowledgeAskModel.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeArticleCandidate, KnowledgeIndexStatus, KnowledgeRunView } from "@drora/services";
import {
  ASK_DEFAULT_VISIBLE_CANDIDATES,
  createInitialKnowledgeAskState,
  deriveAskBanners,
  detectAskIntentHint,
  getAskOutcome,
  reduceKnowledgeAsk,
  resolveAskIntent,
  sliceCandidates,
} from "../src/v4/vault/knowledge/knowledgeAskModel.js";

function makeCandidate(overrides: Partial<KnowledgeArticleCandidate> = {}): KnowledgeArticleCandidate {
  return {
    articleId: "art-1",
    title: "上下文窗口优化.md",
    relativePath: "notes/上下文窗口优化.md",
    matchedHeading: "记忆策略",
    excerpt: "长期记忆不能替代上下文窗口……",
    quote: { startLine: 3, endLine: 5, startOffset: 20, endOffset: 80 },
    fileSha256: "f".repeat(64),
    chunkSha256: "c".repeat(64),
    rank: 1,
    score: 1.25,
    matchedChunkCount: 2,
    evidenceStatus: "unverified",
    ...overrides,
  };
}

function makeRun(overrides: Partial<KnowledgeRunView> = {}): KnowledgeRunView {
  return {
    runId: "run-1",
    runGeneration: 1,
    status: "ready",
    query: "长期记忆",
    sessionId: "sess-1",
    source: { vaultId: "vault-1", sourceEpoch: 1 },
    createdAtMs: 1,
    finishedAtMs: 2,
    candidates: [makeCandidate()],
    coverage: null,
    diagnostics: {
      semantic: "unavailable",
      semanticReason: "port_not_configured",
      lexicalChunkHits: 3,
      lexicalCandidates: 3,
      matchRelaxedToOr: false,
    },
    reason: null,
    ...overrides,
  };
}

function makeIndexStatus(overrides: Partial<KnowledgeIndexStatus> = {}): KnowledgeIndexStatus {
  return {
    configured: true,
    source: { vaultId: "vault-1", sourceEpoch: 1, displayName: "测试库" },
    coverage: {
      indexedFiles: 4,
      indexedChunks: 9,
      excludedHidden: 0,
      excludedSymlink: 0,
      excludedNotMarkdown: 0,
      excludedOverSize: 0,
      excludedOverQuota: 0,
      excludedDepth: 0,
      truncatedFiles: 0,
      partial: false,
    },
    job: null,
    lease: { heldBySelf: false, owner: null, fence: 1, expiresAtMs: null },
    semantic: "unavailable",
    ...overrides,
  };
}

function submitStarted(state = createInitialKnowledgeAskState(), query = "长期记忆") {
  return reduceKnowledgeAsk(state, {
    type: "submitStarted",
    query,
    clientRequestId: "req-1",
    intent: "find",
  });
}

test("意图分类：比较 > 问内容 > 找文章，默认 find，手选优先", () => {
  assert.equal(detectAskIntentHint("对比这两篇文章的区别"), "compare");
  assert.equal(detectAskIntentHint("比较 A 和 B"), "compare");
  assert.equal(detectAskIntentHint("为什么上下文窗口重要"), "answer");
  assert.equal(detectAskIntentHint("如何做检索"), "answer");
  assert.equal(detectAskIntentHint("找那篇讲上下文窗口的文章"), "find");
  assert.equal(detectAskIntentHint("完全无关的词"), "find");
  // 用户手选优先：auto 之外的选择不被查询词覆盖。
  assert.equal(resolveAskIntent("answer", "找文章"), "answer");
  assert.equal(resolveAskIntent("find", "为什么"), "find");
  assert.equal(resolveAskIntent("auto", "为什么"), "answer");
});

test("提交生命周期：submitStarted 归档上一轮并清空证据，runCreated/runSettled 落位", () => {
  const settled = reduceKnowledgeAsk(
    reduceKnowledgeAsk(
      reduceKnowledgeAsk(createInitialKnowledgeAskState(), {
        type: "submitStarted",
        query: "第一轮",
        clientRequestId: "req-0",
        intent: "find",
      }),
      { type: "runCreated", run: makeRun({ runId: "run-0", status: "retrieving" }) },
    ),
    { type: "runSettled", run: makeRun({ runId: "run-0", status: "ready" }) },
  );
  assert.equal(settled.phase, "settled");
  assert.equal(getAskOutcome(settled), "ready");

  // 第二次提交：旧 run → previous，证据态作废，选中清空。
  const withEvidence = reduceKnowledgeAsk(settled, {
    type: "evidenceResolved",
    articleId: "art-1",
    state: { phase: "verified", receiptId: "evr_x", excerpt: "e", relativePath: "p", title: "t", heading: null, quote: { startLine: 1, endLine: 2, startOffset: 0, endOffset: 1 } },
  });
  const resubmitted = submitStarted(withEvidence, "第二轮");
  assert.equal(resubmitted.phase, "submitting");
  assert.equal(resubmitted.current, null);
  assert.equal(resubmitted.previous?.run.runId, "run-0");
  assert.equal(resubmitted.selectedArticleId, null);
  assert.deepEqual(resubmitted.evidence, {});
  assert.equal(getAskOutcome(resubmitted), "submitting");

  const created = reduceKnowledgeAsk(resubmitted, {
    type: "runCreated",
    run: makeRun({ runId: "run-1", status: "retrieving" }),
  });
  assert.equal(created.phase, "retrieving");
  assert.equal(created.current?.clientRequestId, "req-1");
  assert.equal(created.pendingSubmit, null);
});

test("A22：旧 run 的迟到事件与结果不得覆盖新 run", () => {
  let state = submitStarted();
  state = reduceKnowledgeAsk(state, {
    type: "runCreated",
    run: makeRun({ runId: "run-2", runGeneration: 2, status: "retrieving" }),
  });

  // 旧 run 的状态事件（runId 不匹配）→ 忽略。
  state = reduceKnowledgeAsk(state, {
    type: "runEvent",
    event: { runId: "run-1", runGeneration: 1, seq: 5, status: "ready" },
  });
  assert.equal(state.current?.lastSeq, 0);
  // 代数不匹配 → 忽略。
  state = reduceKnowledgeAsk(state, {
    type: "runEvent",
    event: { runId: "run-2", runGeneration: 1, seq: 6, status: "ready" },
  });
  assert.equal(state.current?.lastSeq, 0);
  // 合法事件接受，且 seq 必须严格递增（乱序到达的旧 seq 忽略）。
  state = reduceKnowledgeAsk(state, {
    type: "runEvent",
    event: { runId: "run-2", runGeneration: 2, seq: 3, status: "retrieving" },
  });
  assert.equal(state.current?.lastSeq, 3);
  state = reduceKnowledgeAsk(state, {
    type: "runEvent",
    event: { runId: "run-2", runGeneration: 2, seq: 2, status: "retrieving" },
  });
  assert.equal(state.current?.lastSeq, 3);

  // 旧 run 的 search 快照（runId 不匹配）→ 忽略，不覆盖 current。
  state = reduceKnowledgeAsk(state, {
    type: "runSettled",
    run: makeRun({ runId: "run-1", runGeneration: 1, status: "ready", candidates: [makeCandidate({ articleId: "stale" })] }),
  });
  assert.equal(state.current?.run.runId, "run-2");
  assert.equal(state.current?.run.candidates.length, 1);
});

test("取消保留已有结果；失败保留上一轮", () => {
  // 真实取消时序：cancelRun（服务端置 cancelled）→ cancelSucceeded（UI 立即落定）→
  // search 返回 cancelled 视图（候选已清空，previous 保留）。
  let state = submitStarted();
  state = reduceKnowledgeAsk(state, { type: "runCreated", run: makeRun({ runId: "run-1", status: "retrieving" }) });
  state = reduceKnowledgeAsk(state, { type: "cancelSucceeded" });
  assert.equal(state.current?.cancelledByUser, true);
  assert.equal(state.phase, "settled");
  state = reduceKnowledgeAsk(state, {
    type: "runSettled",
    run: makeRun({ runId: "run-1", status: "cancelled", candidates: [] }),
  });
  assert.equal(getAskOutcome(state), "cancelled");
  assert.equal(state.previous, null);

  // 已落定（ready）后的迟到 cancelSucceeded 不追溯取消：结果照常展示。
  let settledState = submitStarted();
  settledState = reduceKnowledgeAsk(settledState, {
    type: "runCreated",
    run: makeRun({ runId: "run-2", status: "retrieving" }),
  });
  settledState = reduceKnowledgeAsk(settledState, {
    type: "runSettled",
    run: makeRun({ runId: "run-2", status: "ready", candidates: [makeCandidate()] }),
  });
  settledState = reduceKnowledgeAsk(settledState, { type: "cancelSucceeded" });
  assert.equal(getAskOutcome(settledState), "ready");
  assert.equal(settledState.current?.run.candidates.length, 1);

  // 新提交失败：previous 仍可见（PRD 禁止清空上次可用结果）。
  const failed = reduceKnowledgeAsk(submitStarted(settledState, "新查询"), {
    type: "submitFailed",
    message: "host 断连",
  });
  assert.equal(failed.phase, "failed");
  assert.equal(failed.error, "host 断连");
  assert.equal(failed.previous?.run.candidates.length, 1);
  assert.equal(getAskOutcome(failed), "failed");
});

test("候选展开：默认 5 篇，可展开全部；选中只由用户动作驱动", () => {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makeCandidate({ articleId: `art-${i}`, rank: i + 1 }),
  );
  const slice = sliceCandidates(candidates, ASK_DEFAULT_VISIBLE_CANDIDATES);
  assert.equal(slice.visible.length, 5);
  assert.equal(slice.hiddenCount, 3);
  assert.equal(slice.canExpand, true);

  let state = submitStarted();
  state = reduceKnowledgeAsk(state, { type: "runCreated", run: makeRun({ runId: "run-1", status: "retrieving", candidates }) });
  state = reduceKnowledgeAsk(state, {
    type: "runSettled",
    run: makeRun({ runId: "run-1", status: "ready", candidates }),
  });
  // run 落定不自动选中任何候选（A09 多候选不强选）。
  assert.equal(state.selectedArticleId, null);
  state = reduceKnowledgeAsk(state, { type: "expandCandidates", limit: candidates.length });
  const expanded = sliceCandidates(state.current?.run.candidates ?? [], state.visibleCandidateLimit);
  assert.equal(expanded.visible.length, 8);
  assert.equal(expanded.canExpand, false);
  state = reduceKnowledgeAsk(state, { type: "candidateSelected", articleId: "art-3" });
  assert.equal(state.selectedArticleId, "art-3");
});

test("getAskOutcome：服务端结构化状态完整映射（含 partial/无源/过期）", () => {
  const base = submitStarted();
  assert.equal(getAskOutcome(base), "submitting");

  const cases: Array<[KnowledgeRunView["status"], string]> = [
    ["no_source", "noVault"],
    ["source_stale", "sourceStale"],
    ["empty", "empty"],
    ["partial", "partial"],
    ["ready", "ready"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
  ];
  for (const [status, expected] of cases) {
    let state = reduceKnowledgeAsk(base, {
      type: "runCreated",
      run: makeRun({ runId: "run-x", status: "retrieving" }),
    });
    state = reduceKnowledgeAsk(state, { type: "runSettled", run: makeRun({ runId: "run-x", status }) });
    assert.equal(getAskOutcome(state), expected, `status ${status}`);
  }
});

test("deriveAskBanners：九态映射——无源/索引缺失/partial/语义不可用/Jev 关闭/无会话", () => {
  // 1) 无 Vault：状态与索引双侧任一即可，且短路后续条目。
  const noVault = deriveAskBanners({
    state: createInitialKnowledgeAskState(),
    indexStatus: makeIndexStatus({ configured: false }),
    hasSession: true,
  });
  assert.deepEqual(noVault, ["noVault"]);

  // 2) 索引未建 + partial + 语义不可用（可叠加）。
  const bare = deriveAskBanners({
    state: createInitialKnowledgeAskState(),
    indexStatus: makeIndexStatus({
      coverage: {
        indexedFiles: 0,
        indexedChunks: 0,
        excludedHidden: 2,
        excludedSymlink: 0,
        excludedNotMarkdown: 1,
        excludedOverSize: 0,
        excludedOverQuota: 0,
        excludedDepth: 0,
        truncatedFiles: 0,
        partial: true,
      },
    }),
    hasSession: true,
  });
  assert.ok(bare.includes("indexMissing"));
  assert.ok(bare.includes("indexPartial"));
  assert.ok(bare.includes("semanticUnavailable"));
  assert.ok(!bare.includes("indexing"));

  // 3) 索引进行中不报缺失。
  const running = deriveAskBanners({
    state: createInitialKnowledgeAskState(),
    indexStatus: makeIndexStatus({
      coverage: {
        indexedFiles: 0,
        indexedChunks: 0,
        excludedHidden: 0,
        excludedSymlink: 0,
        excludedNotMarkdown: 0,
        excludedOverSize: 0,
        excludedOverQuota: 0,
        excludedDepth: 0,
        truncatedFiles: 0,
        partial: false,
      },
      job: {
        jobId: "job-1",
        kind: "reconcile",
        status: "running",
        generation: 1,
        fence: 1,
        sourceEpoch: 1,
        startedAtMs: 1,
        finishedAtMs: null,
        reason: null,
        indexedFiles: 0,
        indexedChunks: 0,
      },
    }),
    hasSession: true,
  });
  assert.ok(running.includes("indexing"));
  assert.ok(!running.includes("indexMissing"));

  // 4) 有候选：jevOff 提示本地排序；无会话 + answer 意图：模型不可用。
  let state = submitStarted(undefined, "为什么");
  state = reduceKnowledgeAsk(state, {
    type: "submitStarted",
    query: "为什么",
    clientRequestId: "req-2",
    intent: "answer",
  });
  state = reduceKnowledgeAsk(state, {
    type: "runCreated",
    run: makeRun({ runId: "run-3", status: "retrieving" }),
  });
  state = reduceKnowledgeAsk(state, {
    type: "runSettled",
    run: makeRun({
      runId: "run-3",
      status: "ready",
      diagnostics: {
        semantic: "unavailable",
        semanticReason: "port_not_configured",
        lexicalChunkHits: 1,
        lexicalCandidates: 1,
        matchRelaxedToOr: true,
      },
    }),
  });
  const bannersNoSession = deriveAskBanners({ state, indexStatus: makeIndexStatus(), hasSession: false });
  assert.ok(bannersNoSession.includes("jevOff"));
  assert.ok(bannersNoSession.includes("modelUnavailable"));
  assert.ok(bannersNoSession.includes("expandedSearch"));
  // 有会话时模型不可用不出现。
  const bannersWithSession = deriveAskBanners({ state, indexStatus: makeIndexStatus(), hasSession: true });
  assert.ok(!bannersWithSession.includes("modelUnavailable"));
  // find 意图不依赖会话，无 modelUnavailable。
  const findState = reduceKnowledgeAsk(
    reduceKnowledgeAsk(
      submitStarted(undefined, "找文章"),
      { type: "submitStarted", query: "找文章", clientRequestId: "req-3", intent: "find" },
    ),
    {
      type: "runCreated",
      run: makeRun({ runId: "run-4", status: "retrieving" }),
    },
  );
  const findSettled = reduceKnowledgeAsk(findState, {
    type: "runSettled",
    run: makeRun({ runId: "run-4", status: "ready" }),
  });
  const findBanners = deriveAskBanners({ state: findSettled, indexStatus: makeIndexStatus(), hasSession: false });
  assert.ok(!findBanners.includes("modelUnavailable"));

  // 5) 无答案：noAnswer；过期：sourceStale。
  let emptyState = reduceKnowledgeAsk(submitStarted(), {
    type: "runCreated",
    run: makeRun({ runId: "run-5", status: "retrieving" }),
  });
  emptyState = reduceKnowledgeAsk(emptyState, {
    type: "runSettled",
    run: makeRun({ runId: "run-5", status: "empty", candidates: [] }),
  });
  assert.ok(deriveAskBanners({ state: emptyState, indexStatus: makeIndexStatus(), hasSession: true }).includes("noAnswer"));

  let staleState = reduceKnowledgeAsk(submitStarted(), {
    type: "runCreated",
    run: makeRun({ runId: "run-6", status: "retrieving" }),
  });
  staleState = reduceKnowledgeAsk(staleState, {
    type: "runSettled",
    run: makeRun({ runId: "run-6", status: "source_stale", candidates: [] }),
  });
  assert.ok(deriveAskBanners({ state: staleState, indexStatus: makeIndexStatus(), hasSession: true }).includes("sourceStale"));
});
