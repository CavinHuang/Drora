// readMessages（session/messages op）schema 漂移回归锚（specs/mobile-relay-server.md
// 「session/messages schema 漂移」）：agent session store 产出的是 v4 行
// （info.id/sessionID/parentID、part.callID），而官方声明的结果 schema
// droraSessionMessagesResultSchema 是 legacy 形状（info.messageId/partId/callId）。
// 2026-09-29 修复：readMessages 出站前经 mapMessageWithParts 投影为声明契约形状。
// 经 tsx 直接消费 src（与 official-plugin-hook-runtime.test.mjs 先例一致；
// @drora/contracts、@drora/core、@drora/shared 依赖闭包需先 build）。
import assert from "node:assert/strict";
import { readMessages } from "../src/drora-protocol/server-operations.js";
import { droraSessionMessagesResultSchema } from "@drora/shared";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

// ── v4 store 行 fixture（apps/drora-cli/packages/contracts session-store.port 形状：
// messages() 返回 {info, parts} 行，info/parts 字段为 v4 命名）──
const v4Rows = [
  {
    info: {
      id: "msg-u1",
      sessionID: "sess-1",
      role: "user",
      time: { created: 100 },
      agent: "root",
    },
    parts: [
      {
        id: "p-1",
        sessionID: "sess-1",
        messageID: "msg-u1",
        type: "text",
        text: "你好",
      },
    ],
  },
  {
    info: {
      id: "msg-a1",
      sessionID: "sess-1",
      role: "assistant",
      time: { created: 200, completed: 300 },
      parentID: "msg-u1",
      modelId: "glm-4.6",
      providerId: "zai",
      mode: "regular",
      planEnabled: false,
      agent: "root",
      path: { cwd: "D:/demo", root: "D:/demo" },
      cost: 0.5,
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [
      {
        id: "p-2",
        sessionID: "sess-1",
        messageID: "msg-a1",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "files",
          title: "List files",
          metadata: {},
          time: { start: 210, end: 220 },
        },
      },
    ],
  },
];

await test("v4 原始行不满足官方声明结果 schema（漂移事实锚）", () => {
  const parsed = droraSessionMessagesResultSchema.safeParse({ messages: v4Rows });
  assert.equal(parsed.success, false, "未映射的 v4 行必须被声明 schema 拒绝");
});

function fakeContext() {
  return {
    sessions: new Map([
      [
        "sess-1",
        {
          app: { sessionId: "sess-1" },
          eventStore: { getEvents: async () => [] },
        },
      ],
    ]),
    deps: {
      sessionStore: {
        messages: async () => v4Rows,
        getSession: async () => null,
      },
    },
  };
}

await test("readMessages 出站经 mapMessageWithParts 投影，通过声明 schema", async () => {
  const result = await readMessages(fakeContext(), { sessionId: "sess-1" });
  assert.ok(Array.isArray(result.messages));
  assert.equal(result.messages.length, 2, "user+assistant 两条消息行");

  const parsed = droraSessionMessagesResultSchema.parse(result);
  const [user, assistant] = parsed.messages;

  // legacy info：messageId/sessionId/parentMessageId（v4 id/sessionID/parentID 的投影）。
  assert.equal(user.info.role, "user");
  assert.equal(user.info.messageId, "msg-u1");
  assert.equal(user.info.sessionId, "sess-1");
  assert.equal(assistant.info.role, "assistant");
  assert.equal(assistant.info.messageId, "msg-a1");
  assert.equal(assistant.info.parentMessageId, "msg-u1");

  // parts：partId/messageId/sessionId + tool callId（v4 callID 的投影），state 时间戳平面化。
  const userText = user.parts.find((part) => part.type === "text");
  assert.equal(userText?.partId, "p-1");
  assert.equal(userText?.messageId, "msg-u1");
  assert.equal(userText?.text, "你好");
  const toolPart = assistant.parts.find((part) => part.type === "tool");
  assert.equal(toolPart?.partId, "p-2");
  assert.equal(toolPart?.callId, "call-1");
  assert.equal(toolPart?.tool, "bash");
  assert.equal(toolPart.state.status, "completed");
  assert.equal(toolPart.state.startedAt, 210);
  assert.equal(toolPart.state.completedAt, 220);

  // v4 专有字段不得泄漏进声明契约载荷（strict schema 之外=内部字段）。
  assert.equal("mode" in assistant.info, false);
  assert.equal("planEnabled" in assistant.info, false);
});

await test("afterMessageId 分页：原始 info.id 与投影 messageId 同值命中", async () => {
  const context = fakeContext();
  const result = await readMessages(context, { sessionId: "sess-1", afterMessageId: "msg-u1" });
  assert.deepEqual(
    result.messages.map((message) => message.info.messageId),
    ["msg-a1"],
    "按 msg-u1 之后切片，只剩 assistant 行",
  );
});

await test("limit 尾窗在投影前生效", async () => {
  const result = await readMessages(fakeContext(), { sessionId: "sess-1", limit: 1 });
  assert.deepEqual(
    result.messages.map((message) => message.info.messageId),
    ["msg-a1"],
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall readMessages schema-drift tests passed");
