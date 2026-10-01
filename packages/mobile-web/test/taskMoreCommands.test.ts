// §32.3 模式切换 + 更多菜单一期单测（specs/mobile-relay-r3-frontend.md §32）。node:test + tsx：
// switchCollaborationMode CAS 收敛（与 modelSelection.test.ts 的 switchModelConfig 同构断言）、
// renameSession 信封与 ACK 收敛、composer 模式弹层与更多菜单静态渲染（官方 testid/文案）。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CommandAck,
  CommandEnvelope,
  ConversationSnapshot,
} from "@drora/shared/drora-protocol-v4";
import { V4_WIRE_PROTOCOL_VERSION } from "@drora/shared/drora-protocol-v4";
import { createConversationStore } from "../src/app/conversationStore.js";
import {
  sendSwitchCollaborationModeCas,
  TaskSession,
  type TaskSessionTarget,
} from "../src/app/taskSession.js";
import { MODE_SELECT_ITEMS } from "../src/app/TaskComposer.js";
import { TaskComposer } from "../src/app/TaskComposer.js";
import { TaskMoreMenu } from "../src/app/TaskMoreMenu.js";
import { IntlProvider } from "../src/ui/intl.js";
import { EMPTY_MODEL_SELECTION_STATE } from "../src/app/conversationStore.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const SESSION_ID = "sess-mode";
const EPOCH = "epoch-1";

function ackOf(status: CommandAck["status"], overrides: Partial<CommandAck> = {}): CommandAck {
  return { commandId: "ack-1", status, revisionAtDecision: 0, ...overrides };
}

function makeSnapshot(revision = 3): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: SESSION_ID,
    logEpoch: EPOCH,
    seq: 1,
    revision,
    control: {
      // 官方 phase 闭集无 "idle"（draft/prewarming/running/completed*），错值会被
      // 装配器 zod 静默拒帧（proto.frameAssemblyInvalidPayload）。
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
  } as unknown as ConversationSnapshot;
}

function feedSnapshot(snapshot: ConversationSnapshot) {
  const store = createConversationStore({ sessionId: SESSION_ID });
  store.setSubscription({
    subscriptionId: "sub-1",
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
    subscriptionId: "sub-1",
    frame: {
      topic: `conversation/${SESSION_ID}`,
      subscriptionId: "sub-1",
      fromSeq: 0,
      toSeq: snapshot.seq,
      sentAt: 1,
      payload: { kind: "snapshot", snapshot },
    },
  });
  return store;
}

/** 私有构造绕过（测试专用）：不触网，只注入假 accessor 与真实 store。 */
function makeSession(input: { accessor: unknown; snapshot?: ConversationSnapshot }): TaskSession {
  const Ctor = TaskSession as unknown as new (
    accessor: unknown,
    target: TaskSessionTarget,
    client: null,
    bridgeSessionId: string,
    store: ReturnType<typeof createConversationStore>,
    frameSubscription: null,
  ) => TaskSession;
  const store = input.snapshot
    ? feedSnapshot(input.snapshot)
    : createConversationStore({ sessionId: SESSION_ID });
  return new Ctor(
    input.accessor,
    { workspacePath: "D:/ws", sessionId: SESSION_ID },
    null,
    "bridge-1",
    store,
    null,
  );
}

// ── switchCollaborationMode CAS ──

test("switchMode：信封 type/payload 官方闭集，baseRevision 取读快照时点 revision", async () => {
  const calls: CommandEnvelope[] = [];
  const session = makeSession({
    snapshot: makeSnapshot(3),
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async (params: { envelope: CommandEnvelope }) => {
          calls.push(params.envelope);
          return ackOf("accepted");
        },
      },
    },
  });
  const result = await session.switchMode("yolo");
  assert.deepEqual(result, { ok: true, staleRetried: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.type, "switchCollaborationMode");
  assert.equal(calls[0]!.baseRevision, 3);
  assert.deepEqual(calls[0]!.payload, { mode: "yolo" });
});

test("switchMode：stale 用 revisionAtDecision 单次收敛重发（新 commandId）", async () => {
  const calls: CommandEnvelope[] = [];
  const acks: CommandAck[] = [
    ackOf("stale", { revisionAtDecision: 9 }),
    ackOf("accepted", { revisionAtDecision: 9 }),
  ];
  const session = makeSession({
    snapshot: makeSnapshot(3),
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async (params: { envelope: CommandEnvelope }) => {
          calls.push(params.envelope);
          return acks[calls.length - 1]!;
        },
      },
    },
  });
  assert.deepEqual(await session.switchMode("plan"), { ok: true, staleRetried: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.baseRevision, 3);
  assert.equal(calls[1]!.baseRevision, 9);
  assert.notEqual(calls[0]!.commandId, calls[1]!.commandId);
});

test("switchMode：rejected / transport 失败收敛 ok:false", async () => {
  const rejected = makeSession({
    snapshot: makeSnapshot(),
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async () => ackOf("rejected", { reasonCode: "proto.busy" }),
      },
    },
  });
  assert.deepEqual(await rejected.switchMode("edit"), { ok: false, staleRetried: false });

  const transport = makeSession({
    snapshot: makeSnapshot(),
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async () => {
          throw new Error("bridge closed");
        },
      },
    },
  });
  assert.deepEqual(await transport.switchMode("edit"), { ok: false, staleRetried: false });
});

test("sendSwitchCollaborationModeCas：纯函数直发信封形状（stale 收敛 + 新 commandId）", async () => {
  const calls: CommandEnvelope[] = [];
  const result = await sendSwitchCollaborationModeCas({
    send: async (envelope) => {
      calls.push(envelope);
      return calls.length === 1
        ? ackOf("stale", { revisionAtDecision: 5 })
        : ackOf("duplicate");
    },
    sessionId: SESSION_ID,
    clientId: "drora-mobile-test",
    baseRevision: 0,
    mode: "build",
  });
  assert.deepEqual(result, { ok: true, staleRetried: true });
  assert.deepEqual(calls[0]!.payload, { mode: "build" });
  assert.deepEqual(calls[1]!.payload, { mode: "build" });
});

// ── renameSession（§32.3：v4 renameSession{title}，官方 schema 逐字） ──

test("renameSession：信封 type/payload，accepted/duplicate/noop 均 true", async () => {
  const calls: CommandEnvelope[] = [];
  const session = makeSession({
    snapshot: makeSnapshot(),
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async (params: { envelope: CommandEnvelope }) => {
          calls.push(params.envelope);
          return ackOf("accepted");
        },
      },
    },
  });
  assert.equal(await session.renameSession("新标题"), true);
  assert.equal(calls[0]!.type, "renameSession");
  assert.deepEqual(calls[0]!.payload, { title: "新标题" });
  // 非 CAS 命令：不带 baseRevision。
  assert.equal(calls[0]!.baseRevision, undefined);
});

test("renameSession：rejected / transport 失败返回 false 不抛", async () => {
  const rejected = makeSession({
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async () => ackOf("rejected", { reasonCode: "invalid" }),
      },
    },
  });
  assert.equal(await rejected.renameSession("x"), false);

  const transport = makeSession({
    accessor: {
      droraAgentService: {
        sendConversationCommandV4: async () => {
          throw new Error("bridge closed");
        },
      },
    },
  });
  assert.equal(await transport.renameSession("x"), false);
});

// ── 渲染面（静态 markup + 官方 testid/文案） ──

function renderComposer(props: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  const base = {
    draft: "",
    sending: false,
    stopping: false,
    controlState: null,
    queueState: null,
    modelState: EMPTY_MODEL_SELECTION_STATE,
    modelView: null,
    modelLoading: false,
    modelMenuOpen: false,
    configMode: "build",
    onDraftChange: () => {},
    onSend: () => {},
    onStop: () => {},
    onToggleModelMenu: () => {},
    onModelSelect: () => {},
    onCloseModelMenu: () => {},
  };
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(TaskComposer, { ...base, ...props }),
    ),
  );
}

test("composer 模式触发器：无 onModeSelect 保持只读（aria-disabled），有则弹层可用", () => {
  const readonly = renderComposer();
  assert.match(readonly, /data-testid="chat-mode-select-trigger"/);
  assert.match(readonly, /aria-disabled="true"/);

  const active = renderComposer({ onModeSelect: () => {} });
  assert.match(active, /aria-haspopup="menu"/);
  assert.match(active, /aria-expanded="false"/);
  // 官方 mode.label.glm.build 文案（configMode=build 回流标签）。
  assert.match(active, /变更前确认/);
});

test("composer 模式弹层：官方四项闭集（build/edit/plan/yolo 顺序照官方 schema）", () => {
  assert.deepEqual(MODE_SELECT_ITEMS, ["build", "edit", "plan", "yolo"]);
  // 触发器 + 只读回退两条静态面；弹层展开属交互态（DOM 集成验收，spec §32.1 记录）。
  const html = renderComposer({ onModeSelect: () => {} });
  assert.ok(html.includes("chat-mode-select-trigger"));
});

function renderMoreMenu(props: Partial<Parameters<typeof TaskMoreMenu>[0]> = {}) {
  const base = {
    open: true,
    onClose: () => {},
    workspacePath: "D:/ws/demo",
    sessionId: SESSION_ID,
    title: "旧标题",
    onRename: () => Promise.resolve(true),
  };
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(TaskMoreMenu, { ...base, ...props }),
    ),
  );
}

test("更多菜单：一期三项官方文案 + 官方键（重命名/复制路径/复制会话 ID）", () => {
  const html = renderMoreMenu();
  assert.match(html, /data-testid="task-more-rename"/);
  assert.match(html, /重命名任务/);
  assert.match(html, /data-testid="task-more-copy-path"/);
  assert.match(html, /复制路径/);
  assert.match(html, /data-testid="task-more-copy-session-id"/);
  assert.match(html, /复制会话 ID/);
});

test("更多菜单：closed 不渲染任何弹层节点", () => {
  const html = renderMoreMenu({ open: false });
  assert.ok(!html.includes("task-more-rename"));
});
