/**
 * W03 发送链路复验接线测试——specs/obsidian-knowledge.md §5.3。
 *
 * 真 handler（NATIVE_HANDLERS.sendText / sendQueuedNow 原生实现）+ 桩 core host：
 * 验证 admission 前复验、guide 禁用回退、提升漏斗复验与失败回滚边界。
 * 运行：node --import tsx --test apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { KNOWLEDGE_EVIDENCE_GUARDS } from "@drora/shared";
import { SessionEventType } from "@drora/contracts";
import { NATIVE_HANDLERS } from "../src/drora-protocol-v4/commands/handlers/index.js";
import { ProductProjection } from "../src/drora-protocol-v4/product-projection.js";

const SESSION_ID = "session-e2e";

function createRecordApp(overrides = {}) {
  const calls = {
    sendInput: [],
    reserveQueueItem: [],
    markQueueItemPromoting: [],
    removeQueueItem: [],
    releaseReservation: [],
    acquireLease: [],
    releaseLease: [],
  };
  const app = {
    sessionId: SESSION_ID,
    getMode: () => "build",
    getModel: () => "test-provider/test-model",
    readToolResultArtifact: async () => {
      throw new Error("not expected");
    },
    sendInput: async (input, options) => {
      calls.sendInput.push({ input, options });
      return { kind: "started_turn", completion: Promise.resolve({}), turnId: "turn-1" };
    },
    reserveQueueItem: async (...args) => {
      calls.reserveQueueItem.push(args);
      return true;
    },
    markQueueItemPromoting: async (...args) => {
      calls.markQueueItemPromoting.push(args);
      return true;
    },
    removeQueueItem: async (...args) => {
      calls.removeQueueItem.push(args);
      return true;
    },
    releaseQueueItemReservation: async (...args) => {
      calls.releaseReservation.push(args);
      return true;
    },
    runtime: {
      getSessionModelSelection: () => ({ providerId: "test-provider", modelId: "test-model" }),
      acquireForegroundPromotionLease: (input) => {
        calls.acquireLease.push(input);
        return { kind: "acquired" };
      },
      releaseForegroundPromotionLease: (leaseId) => {
        calls.releaseLease.push(leaseId);
      },
    },
    ...overrides,
  };
  return { app, calls };
}

function createHost({ app, calls, verifier, queueItem, routingMode = null }) {
  return {
    getRecord: (sessionId) =>
      sessionId === SESSION_ID
        ? {
            app,
            traceContext: { traceId: "trace-1" },
            workspace: { workspacePath: "/tmp/ws" },
            persistence: "immediate",
          }
        : undefined,
    logger: { info() {}, warn() {} },
    getInputRoutingMode: () => routingMode,
    getQueueItem: (_sessionId, queueItemId) =>
      queueItem && queueItem.queueItemId === queueItemId ? queueItem : null,
    ...(verifier
      ? {
          verifyInputEvidence: async (input) => {
            calls.verifierInputs = calls.verifierInputs ?? [];
            calls.verifierInputs.push(input);
            return verifier(input);
          },
        }
      : {}),
    ...(() => {
      // host 自身也要能被 spy（verifier 调用计数挂在 calls 上）。
      return {};
    })(),
  };
}

function sendTextEnvelope(overrides = {}) {
  return {
    baseRevision: 3,
    commandId: "cmd-1",
    clientId: "test-client",
    sessionId: SESSION_ID,
    type: "sendText",
    payload: { text: "用选中的文章回答", ...overrides.payload },
    issuedAt: Date.now(),
    ...overrides.envelope,
  };
}

test("sendText：无证据输入不触发复验，intent 不携带 evidenceRefs", async () => {
  const { app, calls } = createRecordApp();
  const verifierCalls = [];
  const host = createHost({
    app,
    calls,
    verifier: (input) => {
      verifierCalls.push(input);
      return { ok: true };
    },
  });
  const result = await NATIVE_HANDLERS.sendText(host, sendTextEnvelope({}));
  assert.equal(result.type, "inputAccepted");
  assert.equal(result.delivery, "startNow");
  assert.equal(verifierCalls.length, 0);
  assert.equal(calls.sendInput.length, 1);
  const intent = calls.sendInput[0].options.intent;
  assert.equal(intent.evidenceRefs, undefined);
  assert.equal(intent.requestedDelivery, "startNow");
});

test("sendText：证据输入在 admission 前复验；guide 请求被回退 queue（A17 第 3 层）", async () => {
  const { app, calls } = createRecordApp();
  const refs = [{ receiptId: "evr_abc" }];
  const host = createHost({
    app,
    calls,
    verifier: () => ({ ok: true }),
  });
  const result = await NATIVE_HANDLERS.sendText(
    host,
    sendTextEnvelope({ payload: { requestedDelivery: "guide", evidenceRefs: refs } }),
  );
  assert.equal(result.type, "inputAccepted");
  // 复验发生在 admission（sendInput）之前且恰好一次。
  assert.equal(calls.verifierInputs.length, 1);
  assert.deepEqual(calls.verifierInputs[0].evidenceRefs, refs);
  assert.equal(calls.sendInput.length, 1);
  const intent = calls.sendInput[0].options.intent;
  // guide 禁用：实际投递回退 queue，记录 guard reason，refs 原样固定进 intent。
  assert.equal(intent.requestedDelivery, "queue");
  assert.equal(intent.fallbackReasonCode, KNOWLEDGE_EVIDENCE_GUARDS.guideForbidden);
  assert.deepEqual(intent.evidenceRefs, refs);
});

test("sendText：复验拒绝 → 领域错误带 guard reasonCode，模型输入绝不启动", async () => {
  const { app, calls } = createRecordApp();
  const host = createHost({
    app,
    calls,
    verifier: () => ({ ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.stale, reason: "file_modified" }),
  });
  await assert.rejects(
    () =>
      NATIVE_HANDLERS.sendText(
        host,
        sendTextEnvelope({ payload: { evidenceRefs: [{ receiptId: "evr_stale" }] } }),
      ),
    (error) => {
      assert.equal(error.reasonCode, KNOWLEDGE_EVIDENCE_GUARDS.stale);
      assert.equal(error.name, "EvidenceGuardRejectionError");
      return true;
    },
  );
  assert.equal(calls.sendInput.length, 0);
});

test("sendText：宿主未注入复验端口（旧宿主）→ additive 放行", async () => {
  const { app, calls } = createRecordApp();
  const host = createHost({ app, calls, verifier: undefined });
  const result = await NATIVE_HANDLERS.sendText(
    host,
    sendTextEnvelope({ payload: { evidenceRefs: [{ receiptId: "evr_legacy" }] } }),
  );
  assert.equal(result.type, "inputAccepted");
  assert.equal(calls.sendInput.length, 1);
  assert.deepEqual(calls.sendInput[0].options.intent.evidenceRefs, [{ receiptId: "evr_legacy" }]);
});

function queuedItem(overrides = {}) {
  return {
    sourceCommandId: "cmd-queued-1",
    queueItemId: "queue_cmd-queued-1",
    clientId: "test-client",
    kind: "sendText",
    text: "排队后的证据提问",
    attachments: [],
    delivery: { requested: "queue", admitted: "queue" },
    order: { admissionSeq: 2 },
    steer: { state: "notRequested" },
    dispatch: { state: "queued" },
    admittedAt: Date.now(),
    ...overrides,
  };
}

function queuedNowEnvelope(queueItemId) {
  return {
    baseRevision: 4,
    commandId: "cmd-promote-1",
    clientId: "test-client",
    sessionId: SESSION_ID,
    type: "sendQueuedNow",
    payload: { queueItemId },
    issuedAt: Date.now(),
  };
}

test("sendQueuedNow：提升漏斗复验通过 → 正常提升，intent 携带 refs", async () => {
  const refs = [{ receiptId: "evr_ok" }];
  const { app, calls } = createRecordApp();
  const item = queuedItem({ evidenceRefs: refs });
  const host = createHost({ app, calls, verifier: () => ({ ok: true }), queueItem: item });
  await NATIVE_HANDLERS.sendQueuedNow(host, queuedNowEnvelope(item.queueItemId));
  // 复验先于 reserve（失败时不留 reservation 半态）。
  assert.equal(calls.verifierInputs.length, 1);
  assert.ok(calls.reserveQueueItem.length >= 1);
  assert.ok(calls.markQueueItemPromoting.length >= 1);
  assert.ok(calls.removeQueueItem.length >= 1);
  assert.equal(calls.sendInput.length, 1);
  const intent = calls.sendInput[0].options.intent;
  assert.deepEqual(intent.evidenceRefs, refs);
  assert.equal(intent.sourceCommandId, item.sourceCommandId);
  // 提升 lease 已释放（不随 sendInput started 泄漏）。
  assert.ok(calls.releaseLease.length >= 1);
});

test("sendQueuedNow：复验拒绝 → 在 reserve 前抛 guard 错误，队列项原位保留（A17）", async () => {
  const { app, calls } = createRecordApp();
  const item = queuedItem({ evidenceRefs: [{ receiptId: "evr_revoked" }] });
  const host = createHost({
    app,
    calls,
    queueItem: item,
    verifier: () => ({
      ok: false,
      guard: KNOWLEDGE_EVIDENCE_GUARDS.forbidden,
      reason: "source_unconfigured",
    }),
  });
  await assert.rejects(
    () => NATIVE_HANDLERS.sendQueuedNow(host, queuedNowEnvelope(item.queueItemId)),
    (error) => {
      assert.equal(error.reasonCode, KNOWLEDGE_EVIDENCE_GUARDS.forbidden);
      return true;
    },
  );
  // 复验拒绝发生在 reserve 之前：无 reservation、无提升、无删除——队首原位保留。
  assert.equal(calls.reserveQueueItem.length, 0);
  assert.equal(calls.markQueueItemPromoting.length, 0);
  assert.equal(calls.removeQueueItem.length, 0);
  assert.equal(calls.sendInput.length, 0);
});

test("sendQueuedNow：无证据项不受影响（零 refs 不触发复验）", async () => {
  const { app, calls } = createRecordApp();
  const item = queuedItem({});
  const host = createHost({
    app,
    calls,
    queueItem: item,
    verifier: () => {
      throw new Error("无 refs 不应调用 verifier");
    },
  });
  await NATIVE_HANDLERS.sendQueuedNow(host, queuedNowEnvelope(item.queueItemId));
  assert.equal(calls.sendInput.length, 1);
  assert.equal(calls.sendInput[0].options.intent.evidenceRefs, undefined);
});

// ── 修复轮回归（评审 blocking #1）：生产队列项来自 ProductProjection 的事件投影，
// 不是测试手造对象。必须证明「真投影 → getQueueItem → sendQueuedNow 复验」全链
// evidenceRefs 不丢失——漏映射会让执行时复验恒为空放行（A17 失效）。

function projectionWithQueuedEvidenceItem() {
  const projection = new ProductProjection(SESSION_ID, "epoch-e2e");
  projection.applyEvent({
    type: SessionEventType.SessionCreated,
    sequenceNumber: 1,
    timestamp: new Date(),
    payload: { config: {} },
  });
  const refs = [{ receiptId: "evr_proj0000000000000000000000001" }];
  projection.applyEvent({
    type: SessionEventType.TurnSteerQueued,
    sequenceNumber: 2,
    timestamp: new Date(),
    payload: {
      pendingInputId: "queue_cmd-proj-1",
      inputId: "cmd-proj-1",
      input: "排队后的证据提问",
      inputPreview: "排队后的证据提问",
      inputSize: 9,
      targetTurnId: "turn-1",
      queueLength: 1,
      intent: {
        sourceCommandId: "cmd-proj-1",
        queueItemId: "queue_cmd-proj-1",
        clientId: "test-client",
        kind: "sendText",
        admissionSeq: 2,
        admittedAt: Date.now(),
        requestedDelivery: "queue",
        admittedDelivery: "queue",
        evidenceRefs: refs,
      },
    },
  });
  return { projection, refs };
}

test("真投影链：TurnSteerQueued intent 的 evidenceRefs 进入 queue item（评审 blocking #1 回归）", () => {
  const { projection, refs } = projectionWithQueuedEvidenceItem();
  const item = projection.getSnapshot().queue.items[0];
  assert.ok(item, "投影应产生 queue item");
  assert.deepEqual(item.evidenceRefs, refs);
});

test("真投影→sendQueuedNow：复验拒绝在 reserve 前生效（生产队列项形状）", async () => {
  const { projection } = projectionWithQueuedEvidenceItem();
  const { app, calls } = createRecordApp();
  const host = createHost({
    app,
    calls,
    queueItem: null, // 占位：下方用 host.getQueueItem 覆盖为真投影读取。
    verifier: () => ({
      ok: false,
      guard: KNOWLEDGE_EVIDENCE_GUARDS.stale,
      reason: "file_modified",
    }),
  });
  host.getQueueItem = (sessionId, queueItemId) =>
    projection.getSnapshot().queue.items.find((entry) => entry.queueItemId === queueItemId) ?? null;
  await assert.rejects(
    () => NATIVE_HANDLERS.sendQueuedNow(host, queuedNowEnvelope("queue_cmd-proj-1")),
    (error) => {
      assert.equal(error.reasonCode, KNOWLEDGE_EVIDENCE_GUARDS.stale);
      return true;
    },
  );
  assert.equal(calls.reserveQueueItem.length, 0);
  assert.equal(calls.markQueueItemPromoting.length, 0);
  assert.equal(calls.removeQueueItem.length, 0);
  assert.equal(calls.sendInput.length, 0);
});

test("真投影→sendQueuedNow：复验通过后提升，提升 intent 携带投影出的 refs", async () => {
  const { projection, refs } = projectionWithQueuedEvidenceItem();
  const { app, calls } = createRecordApp();
  const host = createHost({
    app,
    calls,
    queueItem: null,
    verifier: () => ({ ok: true }),
  });
  host.getQueueItem = (sessionId, queueItemId) =>
    projection.getSnapshot().queue.items.find((entry) => entry.queueItemId === queueItemId) ?? null;
  await NATIVE_HANDLERS.sendQueuedNow(host, queuedNowEnvelope("queue_cmd-proj-1"));
  assert.equal(calls.sendInput.length, 1);
  assert.deepEqual(calls.sendInput[0].options.intent.evidenceRefs, refs);
  assert.equal(calls.sendInput[0].options.intent.sourceCommandId, "cmd-proj-1");
});
