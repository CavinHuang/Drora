import assert from "node:assert/strict";
import test from "node:test";
import {
  V4_WIRE_PROTOCOL_VERSION,
  type CommandAck,
  type CommandEnvelope,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { createConversationStore } from "../src/app/conversationStore.js";
import { TaskSession, type TaskSessionTarget } from "../src/app/taskSession.js";

const SESSION_ID = "status-task";

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: SESSION_ID,
    logEpoch: "epoch-status",
    seq: 1,
    revision: 9,
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
    config: { provider: "p", model: "m", thought: "", followupMode: "queue", mode: "build" },
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

function makeSession(input: {
  snapshot?: ConversationSnapshot;
  send: (params: {
    envelope: CommandEnvelope;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<CommandAck>;
}) {
  const store = createConversationStore({ sessionId: SESSION_ID });
  if (input.snapshot) {
    store.setSubscription({
      subscriptionId: "sub-status",
      mode: "snapshot",
      logEpoch: "epoch-status",
    });
    store.acceptWireFrame({
      wireVersion: V4_WIRE_PROTOCOL_VERSION,
      kind: "complete",
      deliveryKind: "initial",
      logicalFrameId: "lf-status",
      logicalFrameOrdinal: 1,
      topic: `conversation/${SESSION_ID}`,
      subscriptionId: "sub-status",
      frame: {
        topic: `conversation/${SESSION_ID}`,
        subscriptionId: "sub-status",
        fromSeq: 0,
        toSeq: input.snapshot.seq,
        sentAt: 1,
        payload: { kind: "snapshot", snapshot: input.snapshot },
      },
    });
  }
  const Ctor = TaskSession as unknown as new (
    accessor: unknown,
    target: TaskSessionTarget,
    client: null,
    bridgeSessionId: string,
    store: ReturnType<typeof createConversationStore>,
    frameSubscription: null,
  ) => TaskSession;
  return new Ctor(
    { zcodeAgentService: { sendConversationCommandV4: input.send } },
    { workspacePath: "D:/repo", workspaceIdentity: "remote-key", sessionId: SESSION_ID },
    null,
    "bridge-status",
    store,
    null,
  );
}

const goal = {
  targetId: "target-1",
  objective: "完成远控任务",
  summaryTitle: null,
  timeUsedSeconds: 0,
  activeRunStartedAtMs: null,
  status: "active" as const,
  iteration: 1,
  verifications: [],
  iterations: [],
};

function ack(status: CommandAck["status"]): CommandAck {
  return { commandId: "ack-status", status, revisionAtDecision: 9 };
}

test("目标控制：无快照/能力关闭不发命令；pause/resume 携当前 CAS 与 workspace 身份", async () => {
  const calls: Array<{
    envelope: CommandEnvelope;
    workspacePath: string;
    workspaceIdentity?: string;
  }> = [];
  const send = async (params: (typeof calls)[number]) => {
    calls.push(params);
    return ack("accepted");
  };
  assert.equal(await makeSession({ send }).pauseGoal(), false);
  const unavailable = snapshot({
    goal,
    availability: { ...snapshot().availability, pauseGoal: { allowed: false } },
  });
  assert.equal(await makeSession({ snapshot: unavailable, send }).pauseGoal(), false);
  assert.equal(calls.length, 0);

  assert.equal(await makeSession({ snapshot: snapshot({ goal }), send }).pauseGoal(), true);
  assert.equal(calls[0]?.envelope.type, "pauseGoal");
  assert.equal(calls[0]?.envelope.baseRevision, 9);
  assert.deepEqual(calls[0]?.envelope.payload, {});
  assert.equal(calls[0]?.workspacePath, "D:/repo");
  assert.equal(calls[0]?.workspaceIdentity, "remote-key");

  const paused = snapshot({ goal: { ...goal, status: "paused" } });
  assert.equal(await makeSession({ snapshot: paused, send }).resumeGoal(), true);
  assert.equal(calls[1]?.envelope.type, "resumeGoal");
  assert.equal(calls[1]?.envelope.baseRevision, 9);
});

test("目标 CAS stale 与传输异常按失败收敛，不重试或伪造状态", async () => {
  let callCount = 0;
  const stale = makeSession({
    snapshot: snapshot({ goal }),
    send: async () => {
      callCount += 1;
      return ack("stale");
    },
  });
  assert.equal(await stale.pauseGoal(), false);
  assert.equal(callCount, 1);
  const broken = makeSession({
    snapshot: snapshot({ goal }),
    send: async () => {
      throw new Error("bridge closed");
    },
  });
  assert.equal(await broken.pauseGoal(), false);
});

test("目标暂停重复点击只下发一次，并等待同一 ACK", async () => {
  const calls: CommandEnvelope[] = [];
  let release!: (value: CommandAck) => void;
  const session = makeSession({
    snapshot: snapshot({ goal }),
    send: async ({ envelope }) => {
      calls.push(envelope);
      return await new Promise<CommandAck>((resolve) => {
        release = resolve;
      });
    },
  });
  const first = session.pauseGoal();
  const second = session.pauseGoal();
  assert.equal(calls.length, 1);
  release(ack("accepted"));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("后台任务取消：只收当前运行 workId、无 CAS，同 work 并发点击只发送一次", async () => {
  const calls: CommandEnvelope[] = [];
  let release!: (value: CommandAck) => void;
  const session = makeSession({
    snapshot: snapshot({
      backgroundWorks: [
        {
          workId: "work-1",
          kind: "bash",
          title: "检查项目",
          status: "running",
          startedAt: 1,
          anchorRowId: null,
        },
      ],
    }),
    send: async ({ envelope }) => {
      calls.push(envelope);
      return await new Promise<CommandAck>((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal(await session.cancelBackgroundWork("other-work"), false);
  const first = session.cancelBackgroundWork("work-1");
  const second = session.cancelBackgroundWork("work-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.type, "cancelBackgroundWork");
  assert.deepEqual(calls[0]?.payload, { workId: "work-1" });
  assert.equal(calls[0]?.baseRevision, undefined);
  release(ack("accepted"));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(calls.length, 1);
});
