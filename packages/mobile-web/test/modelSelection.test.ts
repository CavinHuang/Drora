// R3 P3c 模型选择器第一档 + 上下文用量纯逻辑单测（spec §16 第 2/3 条）。node:test + tsx，
// 无网络、无 React 渲染：store 派生面（getRevision/getModelSelectionState）、TaskSession
// CAS 收敛（switchModel/getModelSelectionView，假 accessor）、ModelMenu 纯 helpers。
// 快照形状对照 packages/shared/src/zcode-protocol-v4/snapshot.ts；wire 候选构造同
// conversationStore.test.ts（complete 帧无分片 checksum）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  V4_WIRE_PROTOCOL_VERSION,
  type CommandAck,
  type CommandEnvelope,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { createConversationStore } from "../src/app/conversationStore.js";
import {
  sendSwitchModelConfigCas,
  TaskSession,
  type SwitchModelSelection,
  type TaskSessionTarget,
} from "../src/app/taskSession.js";
import {
  formatCompactTokenCount,
  isModelSelected,
  resolveCurrentThoughtLevel,
  resolveModelThoughtLevels,
  type ModelMenuState,
} from "../src/ui/ModelMenu.js";

const SESSION_ID = "sess-model";
const SUBSCRIPTION_ID = "sub-1";
const EPOCH = "epoch-1";

// ── 构造 helpers ──

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: SESSION_ID,
    logEpoch: EPOCH,
    seq: 1,
    revision: 1,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: true },
    },
    inputRouting: { mode: "startNow" },
    meta: { title: "", titleSource: "default" },
    modelTransition: null,
    workspaceHookAdmission: null,
    config: {
      provider: "p",
      model: "m",
      thought: "t",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
    ...overrides,
  };
}

/** 喂一帧 initial snapshot 给 store（complete wire 无分片，无需 checksum）。 */
function feedSnapshot(snapshot: ConversationSnapshot) {
  const store = createConversationStore({ sessionId: SESSION_ID });
  store.setSubscription({
    subscriptionId: SUBSCRIPTION_ID,
    mode: "snapshot",
    logEpoch: EPOCH,
  });
  store.acceptWireFrame({
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "complete",
    deliveryKind: "initial",
    logicalFrameId: "lf-1",
    logicalFrameOrdinal: 1,
    topic: `conversation/${SESSION_ID}`,
    subscriptionId: SUBSCRIPTION_ID,
    frame: {
      topic: `conversation/${SESSION_ID}`,
      subscriptionId: SUBSCRIPTION_ID,
      fromSeq: 0,
      toSeq: snapshot.seq,
      sentAt: 1,
      payload: { kind: "snapshot", snapshot },
    },
  });
  return store;
}

/** 私有构造绕过（测试专用）：不触网，只注入假 accessor 与真实 store。 */
function makeSession(input: {
  accessor: unknown;
  snapshot?: ConversationSnapshot;
}): TaskSession {
  const Ctor = TaskSession as unknown as new (
    accessor: unknown,
    target: TaskSessionTarget,
    client: null,
    bridgeSessionId: string,
    store: ReturnType<typeof createConversationStore>,
    frameSubscription: null,
  ) => TaskSession;
  const store = input.snapshot ? feedSnapshot(input.snapshot) : createConversationStore({ sessionId: SESSION_ID });
  return new Ctor(
    input.accessor,
    { workspacePath: "D:/ws", sessionId: SESSION_ID },
    null,
    "bridge-1",
    store,
    null,
  );
}

function ackOf(status: CommandAck["status"], overrides: Partial<CommandAck> = {}): CommandAck {
  return { commandId: "ack-1", status, revisionAtDecision: 0, ...overrides };
}

// ── store 派生面（spec §16 第 2/3 条）──

test("store 无快照：revision=0，模型选择派生面全空", () => {
  const store = createConversationStore({ sessionId: SESSION_ID });
  assert.equal(store.getRevision(), 0);
  assert.deepEqual(store.getModelSelectionState(), {
    current: null,
    fallback: null,
    thoughtLevels: [],
    availability: null,
    usage: null,
  });
});

test("store getModelSelectionState：current/fallback/thoughtLevels/availability/usage 浅取", () => {
  const store = feedSnapshot(
    makeSnapshot({
      revision: 7,
      config: {
        provider: "acme",
        model: "m1",
        thought: "high",
        thoughtLevels: ["low", "high"],
        followupMode: "queue",
        mode: "build",
        modelSelection: {
          providerId: "acme",
          modelId: "m1",
          options: { reasoningLevel: "high" },
        },
      },
      availability: {
        fork: { allowed: true },
        compact: { allowed: true },
        switchModelConfig: { allowed: false, reasonCode: "guard.busy" },
        setFollowupMode: { allowed: true },
        queueEdit: { allowed: true },
        sendQueuedNow: { allowed: true },
        pauseGoal: { allowed: true },
        resumeGoal: { allowed: true },
      },
      usage: {
        contextWindow: {
          usedTokens: 12000,
          maxTokens: 128000,
          autoCompactThresholdTokens: null,
        },
        cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    }),
  );
  assert.equal(store.getRevision(), 7);
  const state = store.getModelSelectionState();
  assert.deepEqual(state.current, {
    providerId: "acme",
    modelId: "m1",
    options: { reasoningLevel: "high" },
  });
  assert.deepEqual(state.fallback, { provider: "acme", model: "m1", thought: "high" });
  assert.deepEqual(state.thoughtLevels, ["low", "high"]);
  assert.deepEqual(state.availability, { allowed: false, reasonCode: "guard.busy" });
  assert.deepEqual(state.usage, { usedTokens: 12000, maxTokens: 128000 });
});

test("store getModelSelectionState：allowed 无 reasonCode；usage 判空（null/0/负值）", () => {
  const base = makeSnapshot({
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: true },
    },
  });
  const allowed = feedSnapshot(base).getModelSelectionState();
  assert.deepEqual(allowed.availability, { allowed: true });

  const usedZero = feedSnapshot(
    makeSnapshot({
      usage: {
        contextWindow: { usedTokens: 0, maxTokens: 128000, autoCompactThresholdTokens: null },
        cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    }),
  ).getModelSelectionState();
  assert.equal(usedZero.usage, null);

  const negativeMax = feedSnapshot(
    makeSnapshot({
      usage: {
        contextWindow: { usedTokens: 10, maxTokens: -1, autoCompactThresholdTokens: null },
        cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    }),
  ).getModelSelectionState();
  assert.equal(negativeMax.usage, null);
});

// 结构兼容哨兵：store 派生面可直接赋给 ModelMenu 的 state prop（结构化类型，无 ui→app import）。
test("ModelMenuState 与 store 派生面结构兼容", () => {
  const store = feedSnapshot(makeSnapshot());
  const state: ModelMenuState = store.getModelSelectionState();
  assert.ok(state);
});

// ── ModelMenu 纯 helpers ──

test("resolveModelThoughtLevels：view optionSpecs 优先，缺失/空回落 thoughtLevels", () => {
  assert.deepEqual(
    resolveModelThoughtLevels(
      { config: { optionSpecs: { reasoningLevel: { values: ["a", "b"] } } } },
      ["x"],
    ),
    ["a", "b"],
  );
  assert.deepEqual(resolveModelThoughtLevels({ config: {} }, ["x", "y"]), ["x", "y"]);
  assert.deepEqual(resolveModelThoughtLevels(undefined, ["x"]), ["x"]);
  assert.deepEqual(resolveModelThoughtLevels({ config: {} }, []), []);
});

test("isModelSelected：current 优先，回落 fallback 投影", () => {
  const withCurrent: ModelMenuState = {
    current: { providerId: "acme", modelId: "m1" },
    fallback: { provider: "other", model: "m9", thought: "" },
    thoughtLevels: [],
    availability: null,
    usage: null,
  };
  assert.equal(isModelSelected(withCurrent, "acme", "m1"), true);
  assert.equal(isModelSelected(withCurrent, "other", "m9"), false);

  const fallbackOnly: ModelMenuState = {
    current: null,
    fallback: { provider: "other", model: "m9", thought: "" },
    thoughtLevels: [],
    availability: null,
    usage: null,
  };
  assert.equal(isModelSelected(fallbackOnly, "other", "m9"), true);
  assert.equal(isModelSelected(fallbackOnly, "acme", "m1"), false);
});

test("resolveCurrentThoughtLevel：显式档优先，空串投影档不参与勾选", () => {
  assert.equal(
    resolveCurrentThoughtLevel({
      current: { providerId: "a", modelId: "m", options: { reasoningLevel: "low" } },
      fallback: { provider: "a", model: "m", thought: "high" },
      thoughtLevels: [],
      availability: null,
      usage: null,
    }),
    "low",
  );
  assert.equal(
    resolveCurrentThoughtLevel({
      current: null,
      fallback: { provider: "a", model: "m", thought: "high" },
      thoughtLevels: [],
      availability: null,
      usage: null,
    }),
    "high",
  );
  assert.equal(
    resolveCurrentThoughtLevel({
      current: null,
      fallback: { provider: "a", model: "m", thought: "" },
      thoughtLevels: [],
      availability: null,
      usage: null,
    }),
    undefined,
  );
});

test("formatCompactTokenCount：k/M compact（locale 语义同桌面 tokenNumberFormat）", () => {
  assert.equal(formatCompactTokenCount(999, "en-US"), "999");
  assert.equal(formatCompactTokenCount(12000, "en-US"), "12K");
  assert.equal(formatCompactTokenCount(128000, "en-US"), "128K");
  assert.equal(formatCompactTokenCount(12000, "zh-CN"), "1.2万");
  assert.equal(formatCompactTokenCount(Number.NaN, "en-US"), "");
});

// ── TaskSession.getModelSelectionView / switchModel（spec §16 第 3 条）──

const SNAPSHOT_WITH_SELECTION = makeSnapshot({
  revision: 3,
  config: {
    provider: "acme",
    model: "m1",
    thought: "high",
    thoughtLevels: [],
    followupMode: "queue",
    mode: "build",
    modelSelection: {
      providerId: "acme",
      modelId: "m1",
      options: { reasoningLevel: "high" },
    },
  },
});

test("getModelSelectionView：selection 传 store 当前 config.modelSelection，失败收敛 null", async () => {
  const seen: Array<{ selection: unknown } | undefined> = [];
  const session = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      modelSelectionService: {
        getView: async (input?: { selection: unknown }) => {
          seen.push(input);
          return { revision: 11, providers: [], selection: input?.selection };
        },
      },
    },
  });
  const view = await session.getModelSelectionView();
  assert.deepEqual(seen[0]?.selection, {
    providerId: "acme",
    modelId: "m1",
    options: { reasoningLevel: "high" },
  });
  assert.equal((view as { selection: unknown } | null)?.selection, seen[0]?.selection);

  const failing = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      modelSelectionService: {
        getView: async () => {
          throw new Error("bridge closed");
        },
      },
    },
  });
  assert.equal(await failing.getModelSelectionView(), null);
});

test("switchModel：首发 accepted，信封 CAS/payload 形状正确", async () => {
  const calls: CommandEnvelope[] = [];
  const session = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      zcodeAgentService: {
        sendConversationCommandV4: async (params: { envelope: CommandEnvelope }) => {
          calls.push(params.envelope);
          return ackOf("accepted", { revisionAtDecision: 3 });
        },
      },
    },
  });
  const command: SwitchModelSelection = { providerId: "acme", modelId: "m2" };
  const result = await session.switchModel(command);
  assert.deepEqual(result, { ok: true, staleRetried: false });
  assert.equal(calls.length, 1);
  const envelope = calls[0]!;
  assert.equal(envelope.type, "switchModelConfig");
  assert.equal(envelope.sessionId, SESSION_ID);
  assert.equal(envelope.clientId, `zcode-mobile-${SESSION_ID}`);
  // CAS：baseRevision = 读快照时点的 store revision（快照 revision=3）。
  assert.equal(envelope.baseRevision, 3);
  // thought 缺省 ""（目标模型默认档；跨模型切档丢弃源 thought 由调用方决定）。
  assert.deepEqual(envelope.payload, { provider: "acme", model: "m2", thought: "" });
});

test("switchModel：stale 用 revisionAtDecision 单次收敛重发（新 commandId）", async () => {
  const calls: CommandEnvelope[] = [];
  const acks: CommandAck[] = [
    ackOf("stale", { commandId: "ack-stale", revisionAtDecision: 9 }),
    ackOf("accepted", { commandId: "ack-ok", revisionAtDecision: 9 }),
  ];
  const session = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      zcodeAgentService: {
        sendConversationCommandV4: async (params: { envelope: CommandEnvelope }) => {
          calls.push(params.envelope);
          return acks[calls.length - 1]!;
        },
      },
    },
  });
  const result = await session.switchModel({ providerId: "acme", modelId: "m2", thoughtLevel: "low" });
  assert.deepEqual(result, { ok: true, staleRetried: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.baseRevision, 3);
  // 重发 baseRevision = stale ACK 的 revisionAtDecision。
  assert.equal(calls[1]!.baseRevision, 9);
  // stale 裁决不进幂等表：每次尝试新 commandId。
  assert.notEqual(calls[0]!.commandId, calls[1]!.commandId);
  // 显式档位透传。
  assert.deepEqual(calls[1]!.payload, { provider: "acme", model: "m2", thought: "low" });
});

test("switchModel：连续 stale / rejected / transport 失败均收敛 ok:false", async () => {
  const staleTwice = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      zcodeAgentService: {
        sendConversationCommandV4: async () =>
          ackOf("stale", { revisionAtDecision: 4 }),
      },
    },
  });
  assert.deepEqual(await staleTwice.switchModel({ providerId: "a", modelId: "m" }), {
    ok: false,
    staleRetried: true,
  });

  const rejected = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      zcodeAgentService: {
        sendConversationCommandV4: async () =>
          ackOf("rejected", { reasonCode: "proto.unavailable" }),
      },
    },
  });
  assert.deepEqual(await rejected.switchModel({ providerId: "a", modelId: "m" }), {
    ok: false,
    staleRetried: false,
  });

  const transport = makeSession({
    snapshot: SNAPSHOT_WITH_SELECTION,
    accessor: {
      zcodeAgentService: {
        sendConversationCommandV4: async () => {
          throw new Error("bridge closed");
        },
      },
    },
  });
  assert.deepEqual(await transport.switchModel({ providerId: "a", modelId: "m" }), {
    ok: false,
    staleRetried: false,
  });
});

test("sendSwitchModelConfigCas：无快照 baseRevision=0 首发（host 探测语义）", async () => {
  const calls: CommandEnvelope[] = [];
  const result = await sendSwitchModelConfigCas({
    send: async (envelope) => {
      calls.push(envelope);
      return ackOf("accepted");
    },
    sessionId: SESSION_ID,
    clientId: "zcode-mobile-test",
    baseRevision: 0,
    command: { providerId: "p", modelId: "m", thoughtLevel: "mid" },
  });
  assert.deepEqual(result, { ok: true, staleRetried: false });
  assert.equal(calls[0]!.baseRevision, 0);
  assert.deepEqual(calls[0]!.payload, { provider: "p", model: "m", thought: "mid" });
});
