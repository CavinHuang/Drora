/**
 * D1 回归（2026-10-17 R2 subagent 验收实证）：wire 侧 conversationQuotes 携带
 * evidenceReceiptId（D-2 修复引入），模型边界序列化必须按白名单挑选字段——
 * Receipt ID 是 opaque 服务端凭据，进入 prompt 即违反「来源原文不作为模型可见
 * Receipt ID」安全不变量（曾以网络回放工件实证泄漏，本用例锁死）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/conversation-quotes.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { withConversationQuotes } from "../src/runtime/helpers/conversation-quotes.js";

test("D1：conversation_quote 序列化不含 evidenceReceiptId（白名单投影）", () => {
  const out = withConversationQuotes("问题正文", [
    {
      text: "已验证摘录",
      path: "notes/a.md",
      senderName: "leo",
      senderId: "u1",
      messageId: "m1",
      sentAt: "2026-10-17T00:00:00.000Z",
      evidenceReceiptId: "evr_secret_must_not_leak",
    } as never,
  ]);
  assert.ok(out.includes("<conversation_quote>"));
  assert.ok(out.includes("已验证摘录"));
  assert.ok(out.includes("notes/a.md"));
  assert.ok(!out.includes("evr_secret_must_not_leak"), "Receipt ID 不得进入模型 prompt");
  assert.ok(!out.includes("evidenceReceiptId"), "字段名本身也不得出现");
});

test("D1：多引用量同样全量消毒，白名单字段全保留", () => {
  const out = withConversationQuotes("q", [
    { text: "a", evidenceReceiptId: "evr_x" } as never,
    { text: "b", path: "n.md", senderName: "k" } as never,
  ]);
  const block = out.slice(out.indexOf("<conversation_quote>"));
  assert.ok(!block.includes("evr_"));
  assert.ok(block.includes('"text":"a"'));
  assert.ok(block.includes('"path":"n.md"'));
  assert.ok(block.includes('"senderName":"k"'));
});

test("无引用时不产生 conversation_quote 块", () => {
  assert.ok(!withConversationQuotes("正文", undefined).includes("<conversation_quote>"));
  assert.ok(!withConversationQuotes("正文", []).includes("<conversation_quote>"));
});
