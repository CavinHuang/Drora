// R3 P3a conversationStore 纯逻辑单测（spec §14 验收：七 op 应用 / 水位守卫 / 断档 resync /
// 分片重组）。node:test + tsx，无网络、无 React。wire 候选按 shared schema 形状手工构造；
// crc32/base64 因 wire-binary 未在 shared exports 暴露而本地实现（多项式与 shared
// crc32WireBytes 一致；若不一致 assembler 以 checksum fault 拒绝，本文件分片用例即红）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  V4_WIRE_PROTOCOL_VERSION,
  type ConversationDelta,
  type ConversationRow,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { createConversationStore } from "../src/app/conversationStore.js";

const SESSION_ID = "sess-store";
const TOPIC = `conversation/${SESSION_ID}`;
const SUBSCRIPTION_ID = "sub-1";
const OTHER_SUBSCRIPTION_ID = "sub-2";
const EPOCH = "epoch-1";
let ordinal = 0;

// ── 构造 helpers ──

function crc32Hex(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

function assistantTextRow(
  rowId: number,
  text: string,
  state: "streaming" | "complete",
): ConversationRow {
  return {
    kind: "assistantText",
    rowId,
    turnId: `t${rowId}`,
    createdAt: 1,
    createdAtSeq: rowId,
    text,
    state,
  };
}

function userInputRow(rowId: number, text: string): ConversationRow {
  return {
    kind: "userInput",
    rowId,
    turnId: `t${rowId}`,
    createdAt: 1,
    createdAtSeq: rowId,
    text,
    origin: "realUser",
  };
}

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
    config: { provider: "p", model: "m", thought: "t", followupMode: "queue" },
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

function snapshotFrame(snapshot: ConversationSnapshot) {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq: 0,
    toSeq: snapshot.seq,
    sentAt: 1,
    payload: { kind: "snapshot" as const, snapshot },
  };
}

function deltasFrame(fromSeq: number, toSeq: number, deltas: ConversationDelta[]) {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq,
    toSeq,
    sentAt: 1,
    payload: { kind: "deltas" as const, deltas },
  };
}

function completeWire(frame: unknown, subscriptionId = SUBSCRIPTION_ID) {
  ordinal += 1;
  return {
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "complete" as const,
    deliveryKind: "initial" as const,
    logicalFrameId: `lf-${ordinal}`,
    logicalFrameOrdinal: ordinal,
    topic: TOPIC,
    subscriptionId,
    frame,
  };
}

/** 把 logical frame 的 JSON 字节切成 count 个连续分片（assembler 的 FRAGMENT_WIRE_KEYS 全集）。 */
function fragmentWires(logical: unknown, count = 2, subscriptionId = SUBSCRIPTION_ID) {
  ordinal += 1;
  const bytes = new TextEncoder().encode(JSON.stringify(logical));
  const checksum = crc32Hex(bytes);
  const mid = Math.ceil(bytes.byteLength / count);
  return Array.from({ length: count }, (_, index) => ({
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "fragment" as const,
    deliveryKind: "online" as const,
    logicalFrameId: `lf-${ordinal}`,
    logicalFrameOrdinal: ordinal,
    topic: TOPIC,
    subscriptionId,
    fragmentIndex: index,
    fragmentCount: count,
    logicalBytes: bytes.byteLength,
    checksum: { algorithm: "crc32", value: checksum },
    dataBase64: Buffer.from(bytes.slice(index * mid, (index + 1) * mid)).toString("base64"),
  }));
}

interface Harness {
  store: ReturnType<typeof createConversationStore>;
  notifications: number;
  resyncCount(): number;
}

function setup(): Harness {
  const resyncs: number[] = [];
  const store = createConversationStore({
    sessionId: SESSION_ID,
    onResync: () => {
      resyncs.push(1);
    },
  });
  const harness: Harness = {
    store,
    notifications: 0,
    resyncCount: () => resyncs.length,
  };
  store.subscribe(() => {
    harness.notifications += 1;
  });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  return harness;
}

function rowText(row: ConversationRow | undefined): string {
  if (row?.kind === "assistantText") return row.text;
  return "";
}

// ── 用例 ──

test("① snapshot 帧整包替换并记账 seq/logEpoch/ready + 通知面", () => {
  const harness = setup();
  const { store, resyncCount } = harness;
  assert.equal(store.getState().ready, false);
  assert.equal(harness.notifications, 1); // setSubscription 即一次状态变化通知
  const snapshot = makeSnapshot({
    seq: 5,
    rows: { window: [assistantTextRow(1, "hello", "complete")], totalCount: 1, firstRowId: 1 },
  });
  store.acceptWireFrame(completeWire(snapshotFrame(snapshot)));
  const state = store.getState();
  assert.equal(state.ready, true);
  assert.equal(state.seq, 5);
  assert.equal(state.logEpoch, EPOCH);
  assert.equal(state.subscriptionId, SUBSCRIPTION_ID);
  // store 保存的是 schema 解析后的快照（default 键已补齐），只对关键事实断言。
  assert.equal(store.getState().snapshot?.seq, 5);
  assert.equal(store.getState().snapshot?.logEpoch, EPOCH);
  assert.equal(store.getRows().length, 1);
  assert.equal(store.getRows()[0]?.rowId, 1);
  // 断档前不误触发 resync；通知面只对已接受的状态变化触发（snapshot 应用 = 第 2 次）。
  assert.equal(resyncCount(), 0);
  assert.equal(harness.notifications, 2);
});

test("② row.appended/upserted/removed/delta 四 op 经 applyConversationDeltas 生效", () => {
  const { store } = setup();
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 1,
          rows: { window: [userInputRow(1, "hi")], totalCount: 1, firstRowId: 1 },
        }),
      ),
    ),
  );
  assert.equal(store.getRows().length, 1);

  store.acceptWireFrame(
    completeWire(
      deltasFrame(1, 2, [{ op: "row.appended", row: assistantTextRow(2, "he", "streaming") }]),
    ),
  );
  assert.equal(store.getState().seq, 2);
  assert.equal(store.getRows().length, 2);
  assert.equal(rowText(store.getRows()[1]), "he");

  store.acceptWireFrame(
    completeWire(
      deltasFrame(2, 3, [{ op: "row.upserted", row: assistantTextRow(2, "hello", "streaming") }]),
    ),
  );
  assert.equal(store.getState().seq, 3);
  assert.equal(store.getRows().length, 2);
  assert.equal(rowText(store.getRows()[1]), "hello");

  store.acceptWireFrame(
    completeWire(
      deltasFrame(3, 4, [{ op: "row.delta", rowId: 2, path: "text", append: " world" }]),
    ),
  );
  assert.equal(store.getState().seq, 4);
  assert.equal(rowText(store.getRows()[1]), "hello world");

  store.acceptWireFrame(completeWire(deltasFrame(4, 5, [{ op: "row.removed", fromRowId: 2 }])));
  assert.equal(store.getState().seq, 5);
  assert.equal(store.getRows().length, 1);
  assert.equal(store.getRows()[0]?.kind, "userInput");
});

test("③ 迟到 delta（toSeq <= seq）静默丢弃", () => {
  const { store, resyncCount } = setup();
  store.acceptWireFrame(completeWire(snapshotFrame(makeSnapshot({ seq: 5 }))));
  const before = store.getRows().slice();
  store.acceptWireFrame(
    completeWire(
      deltasFrame(4, 5, [{ op: "row.appended", row: assistantTextRow(9, "late", "streaming") }]),
    ),
  );
  assert.equal(store.getState().seq, 5);
  assert.deepEqual(store.getRows(), before);
  assert.equal(resyncCount(), 0);
});

test("④ 断档（fromSeq !== seq）触发 onResync 恰一次且不应用", () => {
  const { store, resyncCount } = setup();
  store.acceptWireFrame(completeWire(snapshotFrame(makeSnapshot({ seq: 5 }))));
  const before = store.getRows().slice();
  store.acceptWireFrame(
    completeWire(
      deltasFrame(6, 7, [{ op: "row.appended", row: assistantTextRow(3, "gap", "streaming") }]),
    ),
  );
  assert.equal(resyncCount(), 1);
  assert.equal(store.getState().seq, 5);
  assert.deepEqual(store.getRows(), before);
  // 闩锁：同一断档窗口内的后续帧不再重复触发。
  store.acceptWireFrame(
    completeWire(
      deltasFrame(8, 9, [{ op: "row.appended", row: assistantTextRow(4, "gap2", "streaming") }]),
    ),
  );
  assert.equal(resyncCount(), 1);
});

test("⑤ fragment 两片重组后应用", () => {
  const { store, resyncCount } = setup();
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 1,
          rows: { window: [userInputRow(1, "hi")], totalCount: 1, firstRowId: 1 },
        }),
      ),
    ),
  );
  const fragments = fragmentWires(
    deltasFrame(1, 2, [{ op: "row.appended", row: assistantTextRow(2, "assembled", "streaming") }]),
  );
  assert.equal(fragments.length, 2);
  store.acceptWireFrame(fragments[0]);
  // 首片不产生任何应用/断档判定。
  assert.equal(store.getState().seq, 1);
  assert.equal(store.getRows().length, 1);
  assert.equal(resyncCount(), 0);
  store.acceptWireFrame(fragments[1]);
  assert.equal(store.getState().seq, 2);
  assert.equal(store.getRows().length, 2);
  assert.equal(rowText(store.getRows()[1]), "assembled");
});

test("⑥ subscriptionId 不匹配静默丢（含 ACK 前到达）", () => {
  const resyncs: number[] = [];
  const store = createConversationStore({
    sessionId: SESSION_ID,
    onResync: () => {
      resyncs.push(1);
    },
  });
  // ACK 前（未 setSubscription）：一律丢弃，不触发 resync（无 barrier 暂存的有意分歧）。
  store.acceptWireFrame(completeWire(snapshotFrame(makeSnapshot({ seq: 3 }))));
  assert.equal(store.getState().ready, false);
  assert.equal(resyncs.length, 0);

  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(
    completeWire(snapshotFrame(makeSnapshot({ seq: 4 })), OTHER_SUBSCRIPTION_ID),
  );
  assert.equal(store.getState().ready, false);
  assert.equal(resyncs.length, 0);

  store.acceptWireFrame(completeWire(snapshotFrame(makeSnapshot({ seq: 4 }))));
  assert.equal(store.getState().ready, true);
  assert.equal(store.getState().seq, 4);
});

test("⑦ workflowRun.* 不崩溃且 state.updated 的 workflowRuns 键被剥除", () => {
  const { store, resyncCount } = setup();
  store.acceptWireFrame(completeWire(snapshotFrame(makeSnapshot({ seq: 1 }))));
  store.acceptWireFrame(
    completeWire(
      deltasFrame(1, 2, [
        { op: "workflowRun.updated", runId: "r1", revision: 1 },
        { op: "workflowRun.removed", runId: "r2", revision: 1 },
        {
          op: "state.updated",
          patch: {
            control: {
              phase: "completedSuccess",
              sessionEnded: true,
              canStop: false,
              stopState: "idle",
              stopTargetKind: "unknown",
              activeWorks: [],
              lastError: null,
              apiRetry: null,
            },
            workflowRuns: { revision: 9, runs: [] },
          },
        },
      ]),
    ),
  );
  // 水位照常推进（跳过是渲染层决定，不产生断档）；control 键照常应用。
  assert.equal(store.getState().seq, 2);
  assert.equal(resyncCount(), 0);
  assert.equal(store.getControlState().phase, "completedSuccess");
  // workflowRuns 键被整键剥除：不落到 store（移动端只认全量快照里的该键）。
  assert.equal(store.getState().snapshot?.workflowRuns, undefined);
});

test("⑧ replaceRows：logEpoch 不匹配拒绝；匹配则回补且被 snapshot 整包替换取代", () => {
  const { store } = setup();
  const backfill = [userInputRow(1, "hi"), assistantTextRow(2, "backfilled", "complete")];
  // 无订阅（logEpoch=null）与纪元不一致都拒绝。
  const detached = createConversationStore({ sessionId: SESSION_ID });
  detached.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  assert.equal(detached.replaceRows(backfill, 3, "epoch-other"), false);
  assert.equal(detached.getRows().length, 0);

  assert.equal(detached.replaceRows(backfill, 3, EPOCH), true);
  assert.equal(detached.getRows().length, 2);
  assert.equal(rowText(detached.getRows()[1]), "backfilled");

  // 收敛后：读水位超前已应用水位 → 拒绝（防 (seq, atSeq] 增量二次应用）。
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 5,
          rows: { window: [userInputRow(1, "hi")], totalCount: 1, firstRowId: 1 },
        }),
      ),
    ),
  );
  assert.equal(store.replaceRows(backfill, 6, EPOCH), false);
  // 同水位回补：替换窗口但不改水印。
  assert.equal(store.replaceRows(backfill, 5, EPOCH), true);
  assert.equal(store.getRows().length, 2);
  assert.equal(store.getState().seq, 5);
  // snapshot 帧到达即整包替换，回补窗口作废。
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 7,
          rows: { window: [userInputRow(4, "fresh")], totalCount: 1, firstRowId: 4 },
        }),
      ),
    ),
  );
  assert.equal(store.getRows().length, 1);
  assert.equal(store.getRows()[0]?.rowId, 4);
});

test("⑨ getControlState 从 snapshot.control/queue 浅取；无快照时给空态", () => {
  const detached = createConversationStore({ sessionId: SESSION_ID });
  assert.deepEqual(detached.getControlState(), {
    phase: null,
    canStop: false,
    stopState: null,
    activeWorks: [],
    queueItemCount: 0,
    queuePending: false,
  });

  const { store } = setup();
  const queueItem = {
    sourceCommandId: "c1",
    queueItemId: "q1",
    clientId: "client-1",
    kind: "sendText" as const,
    text: "follow-up",
    delivery: { requested: "queue" as const, admitted: "queue" as const },
    order: { admissionSeq: 0 },
    steer: { state: "notRequested" as const },
    dispatch: { state: "queued" as const },
    admittedAt: 1,
  };
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 1,
          control: {
            phase: "running",
            sessionEnded: false,
            canStop: true,
            stopState: "stoppable",
            stopTargetKind: "assistant",
            activeWorks: [{ kind: "primaryTurn", startedAt: 1 }],
            lastError: null,
            apiRetry: null,
          },
          queue: { items: [queueItem], autoDrain: false, pauseReason: "stopped" },
        }),
      ),
    ),
  );
  assert.deepEqual(store.getControlState(), {
    phase: "running",
    canStop: true,
    stopState: "stoppable",
    activeWorks: [{ kind: "primaryTurn", startedAt: 1 }],
    queueItemCount: 1,
    queuePending: true,
  });
});

// ── P3b 阻塞交互 / 队列状态选择器（spec §15 第 1、4 条）──

function permissionInteractionFixture() {
  return {
    interactionId: "ia-1",
    kind: "permission" as const,
    anchorRowId: null,
    createdAt: 1,
    payload: {
      kind: "permission" as const,
      toolCallId: "tc-1",
      toolName: "Bash",
      summary: "运行 ls",
      detail: null,
      options: [{ optionId: "allow", label: "允许", kind: "allowOnce" as const }],
    },
  };
}

test("⑩ getPendingInteractions：快照原样返回、state.updated 运行期更新可见、空/无快照返回 []", () => {
  // 无快照（未订阅/未收敛）：空数组，不是 undefined。
  const detached = createConversationStore({ sessionId: SESSION_ID });
  assert.deepEqual(detached.getPendingInteractions(), []);

  const { store } = setup();
  const interaction = permissionInteractionFixture();
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(makeSnapshot({ seq: 1, pendingInteractions: [interaction] })),
    ),
  );
  assert.deepEqual(store.getPendingInteractions(), [interaction]);

  // 运行期新增交互经 state.updated patch（键级整键替换）到达：选择器立即可见。
  const userInputInteraction = {
    interactionId: "ia-2",
    kind: "userInput" as const,
    anchorRowId: 3,
    createdAt: 2,
    payload: { kind: "userInput" as const, prompt: "继续？", freeText: true },
  };
  store.acceptWireFrame(
    completeWire(
      deltasFrame(1, 2, [
        { op: "state.updated", patch: { pendingInteractions: [interaction, userInputInteraction] } },
      ]),
    ),
  );
  assert.deepEqual(store.getPendingInteractions(), [interaction, userInputInteraction]);

  // 用户作答后 host 以空数组收走交互：同一整键替换语义，回到 []。
  store.acceptWireFrame(
    completeWire(
      deltasFrame(2, 3, [{ op: "state.updated", patch: { pendingInteractions: [] } }]),
    ),
  );
  assert.deepEqual(store.getPendingInteractions(), []);
});

test("⑪ getQueueState：itemCount/autoDrain/pauseReason 三字段从 snapshot.queue 派生；无快照给未暂停空态", () => {
  const detached = createConversationStore({ sessionId: SESSION_ID });
  assert.deepEqual(detached.getQueueState(), {
    itemCount: 0,
    autoDrain: true,
    pauseReason: undefined,
  });

  const { store } = setup();
  const queueItem = {
    sourceCommandId: "c9",
    queueItemId: "q9",
    clientId: "client-1",
    kind: "sendText" as const,
    text: "queued follow-up",
    delivery: { requested: "queue" as const, admitted: "queue" as const },
    order: { admissionSeq: 0 },
    steer: { state: "notRequested" as const },
    dispatch: { state: "queued" as const },
    admittedAt: 1,
  };
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(
        makeSnapshot({
          seq: 1,
          queue: { items: [queueItem], autoDrain: false, pauseReason: "manual" },
        }),
      ),
    ),
  );
  assert.deepEqual(store.getQueueState(), {
    itemCount: 1,
    autoDrain: false,
    pauseReason: "manual",
  });
});

// spec §15 验收第 3 项注明：resolveInteraction 的命令组装位于 taskSession.ts（v4 命令 +
// 桥内 IServiceAccessor，属网络面），不在本纯逻辑 store 内；按任务约定网络面不做单测。
// store 侧只提供 getPendingInteractions 派生选择器（⑩ 覆盖）。

