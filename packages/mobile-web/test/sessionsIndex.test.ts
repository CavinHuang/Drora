// P5c 首页 sessions-index 实时活性纯逻辑单测（specs/mobile-relay-r3-frontend.md §19/P5c
// 第 1 条验收）：snapshot 整包替换 / delta 水位衔接（upserted 覆盖、removed 删除）/
// 断档 resync 闩锁（恰一次、重置路径）/ phase 六相位映射（running·completed·error·draft
// 剔除）/ 非本订阅帧丢弃 / 活性合并（投影为主）。node:test + tsx，无网络、无 React。
// wire 候选按 shared schema 形状手工构造（conversationStore.test.ts 同款做法）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  V4_WIRE_PROTOCOL_VERSION,
  type SessionSummary,
  type SessionsIndexDelta,
} from "@zcode/shared/zcode-protocol-v4";
import {
  createSessionsIndexStore,
  mapSessionPhaseToStatus,
  mergeHomeWorkspaceLiveness,
} from "../src/app/sessionsIndexStore.js";
import type { ProjectedWorkspace } from "../src/app/entry.js";

const WORKSPACE_KEY = "C:\\repo\\demo";
const TOPIC = `sessions-index/${WORKSPACE_KEY}`;
const SUBSCRIPTION_ID = "sub-home-1";
const EPOCH = "epoch-home-1";
let ordinal = 0;

// ── 构造 helpers ──

function summary(
  sessionId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    workspaceId: WORKSPACE_KEY,
    title: `任务 ${sessionId}`,
    phase: "completedSuccess",
    sessionEnded: true,
    hasBackgroundWork: false,
    lastActivityAt: 100,
    createdAt: 50,
    ...overrides,
    sessionId,
  };
}

function snapshotFrame(toSeq: number, sessions: SessionSummary[], logEpoch = EPOCH) {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq: 0,
    toSeq,
    sentAt: 1,
    payload: {
      kind: "snapshot" as const,
      snapshot: { protocolVersion: 1, workspaceId: WORKSPACE_KEY, logEpoch, sessions },
    },
  };
}

function deltasFrame(fromSeq: number, toSeq: number, deltas: SessionsIndexDelta[]) {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq,
    toSeq,
    sentAt: 1,
    payload: { kind: "deltas" as const, deltas },
  };
}

function completeWire(logical: unknown, subscriptionId = SUBSCRIPTION_ID, topic = TOPIC) {
  ordinal += 1;
  return {
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "complete" as const,
    deliveryKind: "initial" as const,
    logicalFrameId: `lf-${ordinal}`,
    logicalFrameOrdinal: ordinal,
    topic,
    subscriptionId,
    frame: logical,
  };
}

function upserted(session: SessionSummary): SessionsIndexDelta {
  return { op: "session.upserted", session };
}

function removed(sessionId: string): SessionsIndexDelta {
  return { op: "session.removed", sessionId };
}

function summaryIds(summaries: readonly SessionSummary[]): string[] {
  return summaries.map((item) => item.sessionId);
}

// ── snapshot / delta 帧应用 ──

test("snapshot 帧整包替换：记 seq/logEpoch/ready；再次 snapshot 不合并旧会话", () => {
  const store = createSessionsIndexStore({ workspaceKey: WORKSPACE_KEY });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(completeWire(snapshotFrame(5, [summary("s1"), summary("s2")])));
  assert.deepEqual(store.getState(), {
    logEpoch: EPOCH,
    seq: 5,
    subscriptionId: SUBSCRIPTION_ID,
    ready: true,
  });
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["s1", "s2"]);
  // 第二个 snapshot：整包替换（旧 s2 不残留），纪元以帧载荷为准。
  store.acceptWireFrame(completeWire(snapshotFrame(9, [summary("s3")]), SUBSCRIPTION_ID, TOPIC));
  assert.equal(store.getState().seq, 9);
  assert.equal(store.getState().logEpoch, EPOCH);
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["s3"]);
});

test("delta 帧仅在 fromSeq === seq 衔接时应用：upserted 覆盖 / removed 删除 / 迟到帧丢弃", () => {
  const store = createSessionsIndexStore({ workspaceKey: WORKSPACE_KEY });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(
    completeWire(snapshotFrame(5, [summary("s1", { phase: "running" }), summary("s2")])),
  );
  // 衔接 delta（fromSeq === 5）：upserted 按 sessionId 覆盖。
  store.acceptWireFrame(
    completeWire(
      deltasFrame(5, 6, [upserted(summary("s1", { phase: "completedSuccess", lastActivityAt: 300 }))]),
    ),
  );
  assert.equal(store.getState().seq, 6);
  assert.equal(store.getSummary("s1")?.phase, "completedSuccess");
  assert.equal(store.getSummary("s1")?.lastActivityAt, 300);
  // 衔接 delta：removed 删除。
  store.acceptWireFrame(completeWire(deltasFrame(6, 7, [removed("s2")])));
  assert.equal(store.getState().seq, 7);
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["s1"]);
  // 迟到帧（toSeq <= seq）静默丢弃：水位/内容都不动。
  store.acceptWireFrame(completeWire(deltasFrame(5, 7, [upserted(summary("late"))])));
  assert.equal(store.getState().seq, 7);
  assert.equal(store.getSummary("late"), null);
  // 后续衔接 delta 继续应用。
  store.acceptWireFrame(completeWire(deltasFrame(7, 8, [upserted(summary("s4"))])));
  assert.equal(store.getState().seq, 8);
  assert.deepEqual(summaryIds(store.getSessionSummaries()).sort(), ["s1", "s4"]);
});

test("断档不猜：fromSeq !== seq → onResync 恰一次（闩锁）；snapshot/setSubscription 重置后可再触发", () => {
  let resyncCount = 0;
  const store = createSessionsIndexStore({
    workspaceKey: WORKSPACE_KEY,
    onResync: () => {
      resyncCount += 1;
    },
  });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(completeWire(snapshotFrame(5, [summary("s1")])));
  // 断档帧：不应用、触发 onResync 一次。
  store.acceptWireFrame(completeWire(deltasFrame(3, 6, [upserted(summary("gap"))])));
  assert.equal(resyncCount, 1);
  assert.equal(store.getState().seq, 5);
  assert.equal(store.getSummary("gap"), null);
  // 闩锁：后续断档帧/迟到帧都不再触发。
  store.acceptWireFrame(completeWire(deltasFrame(4, 7, [upserted(summary("gap2"))])));
  store.acceptWireFrame(completeWire(deltasFrame(5, 7, [upserted(summary("late"))])));
  assert.equal(resyncCount, 1);
  // snapshot 帧重置闩锁（含 resync 后服务端下发的全量帧路径）。
  store.acceptWireFrame(completeWire(snapshotFrame(8, [summary("s9")])));
  assert.equal(resyncCount, 1);
  store.acceptWireFrame(completeWire(deltasFrame(2, 10, [upserted(summary("gap3"))])));
  assert.equal(resyncCount, 2);
  // setSubscription（resync ACK）同样重置闩锁；重置后的断档帧再次触发。
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(completeWire(deltasFrame(1, 12, [upserted(summary("gap4"))])));
  assert.equal(resyncCount, 3);
});

test("无已应用基线（ready=false）的 delta 帧按退化断档处理（同闩锁）", () => {
  let resyncCount = 0;
  const store = createSessionsIndexStore({
    workspaceKey: WORKSPACE_KEY,
    onResync: () => {
      resyncCount += 1;
    },
  });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  assert.equal(store.getState().ready, false);
  store.acceptWireFrame(completeWire(deltasFrame(0, 1, [upserted(summary("s1"))])));
  store.acceptWireFrame(completeWire(deltasFrame(1, 2, [upserted(summary("s2"))])));
  assert.equal(resyncCount, 1);
  assert.equal(store.getState().ready, false);
  assert.deepEqual(store.getSessionSummaries(), []);
  // resync 兜底：全量 snapshot 收敛。
  store.acceptWireFrame(completeWire(snapshotFrame(2, [summary("s1"), summary("s2")])));
  assert.equal(store.getState().ready, true);
  assert.deepEqual(summaryIds(store.getSessionSummaries()).sort(), ["s1", "s2"]);
});

test("非本订阅帧静默丢弃：ACK 前 / 异 subscriptionId / 异 topic / 坏载荷", () => {
  let resyncCount = 0;
  const store = createSessionsIndexStore({
    workspaceKey: WORKSPACE_KEY,
    onResync: () => {
      resyncCount += 1;
    },
  });
  // ACK 未返回（subscriptionId=null）：一律丢弃（无 barrier 暂存，依赖 initial 收敛）。
  store.acceptWireFrame(completeWire(snapshotFrame(5, [summary("pre")])));
  assert.equal(store.getState().subscriptionId, null);
  assert.deepEqual(store.getSessionSummaries(), []);
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  // workspace 级 fan-out 会把同 topic 其他订阅者的帧送到这里：subscriptionId 不匹配丢弃。
  store.acceptWireFrame(completeWire(snapshotFrame(6, [summary("foreign")]), "sub-other"));
  // 非 sessions-index topic（或他工作区 topic）丢弃。
  store.acceptWireFrame(
    completeWire(snapshotFrame(7, [summary("foreign2")]), SUBSCRIPTION_ID, "sessions-index/other"),
  );
  // 非对象 / 未知 kind 候选丢弃。
  store.acceptWireFrame(null);
  store.acceptWireFrame({ kind: "carrier-pigeon", topic: TOPIC, subscriptionId: SUBSCRIPTION_ID });
  // 本订阅 + 本 topic 但载荷不合法：assembler typed fault 静默忽略，状态不动。
  store.acceptWireFrame(completeWire({ topic: TOPIC, subscriptionId: SUBSCRIPTION_ID, garbage: true }));
  assert.equal(resyncCount, 0);
  assert.deepEqual(store.getSessionSummaries(), []);
  assert.equal(store.getState().seq, 0);
  // 之后本人帧仍正常应用（守卫没把好帧一起丢掉）。
  store.acceptWireFrame(completeWire(snapshotFrame(5, [summary("s1")])));
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["s1"]);
});

test("getSessionSummaries 按 lastActivityAt 降序且缓存稳定引用（内容不变不新建数组）", () => {
  const store = createSessionsIndexStore({ workspaceKey: WORKSPACE_KEY });
  store.setSubscription({ subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: EPOCH });
  store.acceptWireFrame(
    completeWire(
      snapshotFrame(3, [
        summary("old", { lastActivityAt: 10 }),
        summary("new", { lastActivityAt: 30 }),
        summary("mid", { lastActivityAt: 20 }),
      ]),
    ),
  );
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["new", "mid", "old"]);
  const sameRef = store.getSessionSummaries();
  assert.equal(store.getSessionSummaries(), sameRef);
  // delta 应用后缓存失效：重算并换新引用。
  store.acceptWireFrame(
    completeWire(deltasFrame(3, 4, [upserted(summary("old", { lastActivityAt: 50 }))])),
  );
  assert.notEqual(store.getSessionSummaries(), sameRef);
  assert.deepEqual(summaryIds(store.getSessionSummaries()), ["old", "new", "mid"]);
});

// ── phase 映射（六相位闭集）──

test("phase 映射：running/prewarming→running、completed*→completed、error→error、draft→剔除", () => {
  assert.equal(mapSessionPhaseToStatus("running"), "running");
  assert.equal(mapSessionPhaseToStatus("prewarming"), "running");
  assert.equal(mapSessionPhaseToStatus("completedSuccess"), "completed");
  assert.equal(mapSessionPhaseToStatus("completedInterrupted"), "completed");
  assert.equal(mapSessionPhaseToStatus("error"), "error");
  // draft：无持久行活性语义（返回 null，合并层剔除任务行）。
  assert.equal(mapSessionPhaseToStatus("draft"), null);
});

// ── 活性合并（投影为主，sessions-index 只并活性字段）──

function projectWorkspace(tasks: ProjectedWorkspace["tasks"]): ProjectedWorkspace {
  return {
    workspaceKey: WORKSPACE_KEY,
    name: "demo",
    kind: "local",
    path: WORKSPACE_KEY,
    updatedAtMs: null,
    connectionState: "connected",
    tasks,
  };
}

test("活性合并：status/updatedAt 覆盖，custom title 权威，draft 剔除，投影外不新增", () => {
  const workspace = projectWorkspace([
    // 投影 t1：bootstrap running；实时 running + custom 重命名 + 更新 lastActivityAt。
    { sessionId: "t1", title: "投影标题一", createdAtMs: 1, updatedAtMs: 100, status: "running" },
    // 投影 t2：bootstrap completed；实时 error（非 custom 标题不覆盖）。
    { sessionId: "t2", title: "投影标题二", createdAtMs: 2, updatedAtMs: 90, status: "completed" },
    // 投影 t3：实时 draft → 行剔除。
    { sessionId: "t3", title: "投影标题三", createdAtMs: 3, updatedAtMs: 80, status: "completed" },
  ]);
  const merged = mergeHomeWorkspaceLiveness(workspace, [
    summary("t1", {
      phase: "running",
      title: "重命名任务",
      titleSource: "custom",
      lastActivityAt: 500,
    }),
    summary("t2", {
      phase: "error",
      title: "生成标题",
      titleSource: "generated",
      lastActivityAt: 400,
    }),
    summary("t3", { phase: "draft" }),
    // 投影外会话（sessions-index 独有）：不新增行（不决定行存在性）。
    summary("ghost", { phase: "running" }),
  ]);
  assert.deepEqual(merged.workspaceKey, WORKSPACE_KEY);
  assert.equal(merged.tasks.length, 2);
  const t1 = merged.tasks.find((task) => task.sessionId === "t1");
  assert.equal(t1?.status, "running");
  assert.equal(t1?.title, "重命名任务"); // titleSource=custom 权威。
  assert.equal(t1?.updatedAtMs, 500); // lastActivityAt 覆盖。
  assert.equal(t1?.createdAtMs, 1); // 投影字段保留。
  const t2 = merged.tasks.find((task) => task.sessionId === "t2");
  assert.equal(t2?.status, "error");
  assert.equal(t2?.title, "投影标题二"); // generated/default 标题不覆盖投影。
  assert.equal(t2?.updatedAtMs, 400);
  assert.equal(merged.tasks.some((task) => task.sessionId === "t3"), false); // draft 剔除。
  assert.equal(merged.tasks.some((task) => task.sessionId === "ghost"), false); // 投影外不新增。
});

test("活性合并：无摘要的行保持投影原样（bootstrap/list 仍是权威数据源）", () => {
  const workspace = projectWorkspace([
    { sessionId: "t1", title: "投影标题", createdAtMs: 1, updatedAtMs: 100, status: "running", unreadAtMs: null, hasBackgroundWork: false },
  ]);
  const merged = mergeHomeWorkspaceLiveness(workspace, []);
  // §32.37 未读 null（已读）行条件展开——合并结果不携带未读键。
  // §32.50 hasBackgroundWork false 亦条件展开。
  assert.deepEqual(merged.tasks, [
    { sessionId: "t1", title: "投影标题", createdAtMs: 1, updatedAtMs: 100, status: "running" },
  ]);
});
