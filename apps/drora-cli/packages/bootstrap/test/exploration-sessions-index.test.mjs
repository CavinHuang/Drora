// 探索模式 sessions-index 投影单测：探索字段（forkSourceMessageId/forkSourceLabel）
// 的缺席→出现必须产 delta（不被 conflation 吃掉），相同字段重复 ingest 必须合并。
// specs/exploration-mode.md 验收场景 6 的投影面。经 tsx 直接消费 src。
import assert from "node:assert/strict";
import { SessionsIndexProjection } from "../src/drora-protocol-v4/sessions-index-projection.js";


async function testSessionsIndexProjectionForkFields() {
  // 投影类住在 bootstrap（core 不依赖它）；这里直接对导出的纯归约断言。
  const projection = new SessionsIndexProjection("w", "epoch-1");

  function snapshot(sessionId) {
    return {
      sessionId,
      rows: { window: [], totalCount: 0 },
      backgroundWorks: [],
      workflowRuns: [],
      pendingInteractions: [],
      control: { phase: "completedSuccess", sessionEnded: true },
      meta: { title: "分支", titleSource: "generated" },
    };
  }

  const base = {
    createdAt: 1,
    lastActivityAt: 1,
    parentSessionId: "sess_main",
  };
  projection.upsertFromConversation(snapshot("sess_b1"), base);
  let summary = projection.getSnapshot().sessions.find((item) => item.sessionId === "sess_b1");
  assert.ok(summary);
  assert.equal(summary.parentSessionId, "sess_main");
  assert.equal(summary.forkSourceMessageId, undefined);

  // 同一快照补上探索来源：字段缺席→出现是语义变化，必须产 delta。
  const withFork = { ...base, forkSourceMessageId: "msg_a1", forkSourceLabel: "这条回复" };
  const changed = projection.upsertFromConversation(snapshot("sess_b1"), withFork);
  assert.ok(Array.isArray(changed) && changed.length > 0, "fork source appearance must produce a delta");
  summary = projection.getSnapshot().sessions.find((item) => item.sessionId === "sess_b1");
  assert.equal(summary.forkSourceMessageId, "msg_a1");
  assert.equal(summary.forkSourceLabel, "这条回复");

  // 相同字段重复 ingest：conflation 生效，不产 delta。
  const unchanged = projection.upsertFromConversation(snapshot("sess_b1"), withFork);
  assert.ok(Array.isArray(unchanged) && unchanged.length === 0, "identical fork fields must conflate");
}

await testSessionsIndexProjectionForkFields();
console.log("ok - testSessionsIndexProjectionForkFields");

// ── 探索分支的 goal policy：不受「parent 有 active target」guard 阻塞 ──

async function testExplorationGoalBoundaryPolicy() {
  const { resolveStableForkTargetFromTranscript } = await import(
    "../src/drora-protocol-v4/stable-fork-target.js"
  );

  function userMsg(id, turnId) {
    return {
      info: {
        id,
        sessionID: "sess_main",
        role: "user",
        parentID: null,
        turnId,
        time: { created: 1, updated: 1 },
      },
      parts: [],
    };
  }
  function assistantMsg(id, turnId, parentId) {
    return {
      info: {
        id,
        sessionID: "sess_main",
        role: "assistant",
        parentID: parentId,
        turnId,
        error: undefined,
        time: { created: 2, updated: 2 },
      },
      parts: [],
    };
  }
  const messages = [
    userMsg("u1", "turn-1"),
    assistantMsg("a1", "turn-1", "u1"),
  ];
  const candidate = {
    rowId: 1,
    startMessageId: "u1",
    boundaryMessageId: "a1",
    productTurnId: "pt-1",
    transcriptTurnId: "turn-1",
  };

  // parent 有 active target + verifier ledger：默认 policy 拒绝（既有 fork 语义）。
  const activeStore = {
    messages: async () => messages,
    readTarget: async () => ({ status: "active" }),
    sessionEntries: async () => [{ id: "v1" }],
  };
  const blocked = await resolveStableForkTargetFromTranscript({
    candidate,
    messages,
    store: activeStore,
  });
  assert.equal(blocked.ok, false, "default policy must stay blocked by active goal");
  assert.equal(blocked.reasonCode, "guard.forkTargetAmbiguous");

  // 探索 policy：降级 none，正常解析。
  const exploration = await resolveStableForkTargetFromTranscript({
    candidate,
    messages,
    store: activeStore,
    goalBoundaryPolicy: "none",
  });
  assert.equal(exploration.ok, true, "exploration policy must bypass active-goal guard");
  assert.ok(exploration.ok && exploration.goalBoundary.kind === "none");
  // none 不写回锚点（activeStore 没有 persist 能力也无妨——关键是返回不携带 goal 快照）。

  // 无 goal 场景：两种 policy 结果一致（none）。
  const idleStore = {
    messages: async () => messages,
    readTarget: async () => null,
    sessionEntries: async () => [],
    // persistResolvedAnchor 会惰性补写锚点；测试 store 提供 no-op。
    saveMessage: async () => {},
  };
  const forDefault = await resolveStableForkTargetFromTranscript({
    candidate,
    messages,
    store: idleStore,
  });
  const forExploration = await resolveStableForkTargetFromTranscript({
    candidate,
    messages,
    store: idleStore,
    goalBoundaryPolicy: "none",
  });
  assert.ok(forDefault.ok && forDefault.goalBoundary.kind === "none");
  assert.ok(forExploration.ok && forExploration.goalBoundary.kind === "none");
}

await testExplorationGoalBoundaryPolicy();
console.log("ok - testExplorationGoalBoundaryPolicy");
