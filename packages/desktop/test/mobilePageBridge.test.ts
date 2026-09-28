// serveMobilePageAction 单测：共享翻译层（LAN/relay 手机页单一实现）用假服务验证
// v1 动作帧 → 服务调用的参数形状与应答负载。
import assert from "node:assert/strict";
import test from "node:test";
import { serveMobilePageAction } from "../src/main/desktopMobilePageBridge.js";

function fakeServices(options: {
  tasks?: Array<Record<string, unknown>>;
  messages?: unknown[];
  events?: Array<{ seq: number }>;
}) {
  const calls: Array<{ service: string; method: string; params: unknown }> = [];
  return {
    calls,
    task: {
      async listTasks(params: unknown) {
        calls.push({ service: "task", method: "listTasks", params });
        return options.tasks ?? [];
      },
      async sendPrompt(params: unknown) {
        calls.push({ service: "task", method: "sendPrompt", params });
        return {};
      },
      async respondPermission(params: unknown) {
        calls.push({ service: "task", method: "respondPermission", params });
        return true;
      },
      async stopGeneration(params: unknown) {
        calls.push({ service: "task", method: "stopGeneration", params });
      },
    },
    session: {
      async readSessionMessages(params: unknown) {
        calls.push({ service: "session", method: "readSessionMessages", params });
        return options.messages ?? [];
      },
      async readSessionEvents(params: unknown) {
        calls.push({ service: "session", method: "readSessionEvents", params });
        return options.events ?? [];
      },
    },
  };
}

const workspace = { workspacePath: "C:/demo", workspaceIdentity: "id-1" };

test("list：透传 workspace 参数并映射 v1 taskList 负载", async () => {
  const services = fakeServices({
    tasks: [{ taskId: "t1", title: "标题", status: "running", updatedAt: 5 }],
  });
  const response = await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "list" },
    workspace,
  });
  assert.equal(response.type, "taskList");
  assert.deepEqual(response.tasks, [
    { taskId: "t1", title: "标题", status: "running", updatedAt: 5 },
  ]);
  assert.equal(services.calls[0]?.service, "task");
  assert.deepEqual(
    (services.calls[0]?.params as { workspacePath: string }).workspacePath,
    "C:/demo",
  );
  assert.deepEqual(
    (services.calls[0]?.params as { workspaceIdentity?: string }).workspaceIdentity,
    "id-1",
  );
});

test("open/events：sessionId=taskId 且携带 workspace 路由参数", async () => {
  const services = fakeServices({ messages: [{ role: "user" }], events: [{ seq: 7 }] });
  await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "open", taskId: "t9" },
    workspace,
  });
  const openCall = services.calls[0];
  assert.equal(openCall.service, "session");
  assert.equal(openCall.method, "readSessionMessages");
  assert.deepEqual((openCall.params as { sessionId: string }).sessionId, "t9");
  assert.deepEqual((openCall.params as { workspacePath: string }).workspacePath, "C:/demo");

  await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "events", taskId: "t9", afterSeq: 3 },
    workspace,
  });
  const eventsCall = services.calls.at(-1);
  assert.equal(eventsCall?.method, "readSessionEvents");
  assert.deepEqual((eventsCall.params as { afterSeq: number }).afterSeq, 3);
});

test("send：content 原样透传 + replayable 客户端标记 + accepted 应答", async () => {
  const services = fakeServices({});
  const response = await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "send", taskId: "t1", content: "  hello  " }, // trim 后发送
    workspace: { workspacePath: "C:/demo" },
  });
  assert.deepEqual(response, { type: "accepted", taskId: "t1" });
  const sendCall = services.calls[0];
  assert.equal(sendCall.method, "sendPrompt");
  const sendParams = sendCall.params as {
    content: string;
    clientMode: string;
    clientLabel: string;
  };
  assert.equal(sendParams.content, "hello"); // bridge 与 LAN 同款 trim
  assert.equal(sendParams.clientMode, "web-remote-replayable");
  assert.equal(sendParams.clientLabel, "mobile-web");
});

test("send：空白内容直接 accepted（不打扰服务）", async () => {
  const services = fakeServices({});
  const response = await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "send", taskId: "t1", content: "   " },
    workspace: { workspacePath: "C:/demo" },
  });
  assert.deepEqual(response, { type: "accepted", taskId: "t1" });
  assert.equal(services.calls.length, 0);
});

test("permission/stop：参数形状与应答负载", async () => {
  const services = fakeServices({});
  await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: {
      type: "permission",
      taskId: "t1",
      runId: "r-1",
      requestId: "rq-1",
      optionId: "allow",
      decision: "allow",
    },
    workspace: { workspacePath: "C:/demo" },
  });
  await serveMobilePageAction({
    task: services.task,
    session: services.session,
    frame: { type: "stop", taskId: "t1" },
    workspace: { workspacePath: "C:/demo" },
  });
  const permCall = services.calls[0];
  assert.equal(permCall.method, "respondPermission");
  assert.deepEqual((permCall.params as { runId?: string }).runId, "r-1");
  const stopCall = services.calls.at(-1);
  assert.equal(stopCall?.method, "stopGeneration");
});
