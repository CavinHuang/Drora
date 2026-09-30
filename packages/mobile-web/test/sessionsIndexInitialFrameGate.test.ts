import assert from "node:assert/strict";
import test from "node:test";
import {
  V4_WIRE_PROTOCOL_VERSION,
  sessionsIndexTopic,
  type SessionSummary,
} from "@drora/shared/drora-protocol-v4";
import { createInitialFrameGate } from "../src/app/sessionsIndexInitialFrameGate.js";
import {
  createSessionsIndexStore,
  mergeHomeWorkspaceLiveness,
} from "../src/app/sessionsIndexStore.js";

const workspaceKey = "C:/demo";
const topic = sessionsIndexTopic(workspaceKey);
const subscriptionId = "sub-home";
const ack = { subscriptionId, mode: "snapshot" as const, logEpoch: "epoch-1" };

function snapshotWire(id = subscriptionId) {
  const summary: SessionSummary = {
    workspaceId: workspaceKey,
    sessionId: "task-1",
    title: "任务一",
    phase: "running",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 200,
    createdAt: 100,
  };
  return {
    wireVersion: V4_WIRE_PROTOCOL_VERSION,
    kind: "complete" as const,
    deliveryKind: "initial" as const,
    logicalFrameId: "initial-1",
    logicalFrameOrdinal: 1,
    topic,
    subscriptionId: id,
    frame: {
      topic,
      subscriptionId: id,
      fromSeq: 0,
      toSeq: 1,
      sentAt: 1,
      payload: {
        kind: "snapshot" as const,
        snapshot: {
          protocolVersion: 1,
          workspaceId: workspaceKey,
          logEpoch: "epoch-1",
          sessions: [summary],
        },
      },
    },
  };
}

test("ACK 前 initial snapshot 暂存后按订阅认领，任务投影改为 running", () => {
  const store = createSessionsIndexStore({ workspaceKey });
  const gate = createInitialFrameGate({ topic, onOwnedFrame: store.acceptWireFrame });
  gate.accept(snapshotWire("foreign-sub"));
  gate.accept(snapshotWire());
  assert.equal(store.getState().ready, false);
  const initial = gate.claim(subscriptionId);
  assert.ok(initial);
  store.setSubscription(ack);
  for (const candidate of initial) store.acceptWireFrame(candidate);
  assert.equal(store.getState().ready, true);
  assert.equal(store.getSessionSummaries().length, 1);
  const merged = mergeHomeWorkspaceLiveness(
    {
      workspaceKey,
      name: "demo",
      kind: "local",
      path: workspaceKey,
      updatedAtMs: null,
      connectionState: "connected",
      tasks: [
        {
          sessionId: "task-1",
          title: "任务一",
          createdAtMs: 100,
          updatedAtMs: 150,
          status: "completed",
        },
      ],
    },
    store.getSessionSummaries(),
  );
  assert.equal(merged.tasks[0]?.status, "running");
  gate.accept(snapshotWire("foreign-sub"));
  assert.equal(store.getSessionSummaries().length, 1);
});

test("暂存超界整批作废，close/reset 后可重新认领", () => {
  const seen: unknown[] = [];
  const gate = createInitialFrameGate({
    topic,
    onOwnedFrame: (candidate) => seen.push(candidate),
    maxStagedWires: 1,
  });
  gate.accept(snapshotWire());
  gate.accept(snapshotWire());
  assert.equal(gate.claim(subscriptionId), null);
  assert.deepEqual(seen, []);
  gate.clear();
  gate.accept(snapshotWire());
  assert.equal(gate.claim(subscriptionId)?.length, 1);
  gate.accept(snapshotWire());
  assert.equal(seen.length, 1);
});
