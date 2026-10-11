/**
 * W09 证据附件区回归（specs/obsidian-knowledge.md §5f.1，WSG-UI-1/2）。
 *
 * 覆盖：scope 存储与跨作用域隔离、receiptId 去重、上限 8（契约
 * MAX_EVIDENCE_REFS_PER_INPUT）、发送 payload 形态（只含 opaque receiptId）。
 * 纯进程内（append/scope/payload 为纯函数，不经 window dispatch）。
 * 运行：node --import tsx --test packages/ui/test/knowledgeEvidenceAttachment.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_EVIDENCE_REFS_PER_INPUT } from "@drora/shared";
import {
  appendKnowledgeEvidenceAttachment,
  getKnowledgeEvidenceAttachmentScope,
  setKnowledgeEvidenceAttachmentScope,
  toEvidenceRefPayload,
  type KnowledgeEvidenceAttachment,
} from "../src/lib/knowledgeEvidenceAttachment.js";

function attachment(receiptId: string): KnowledgeEvidenceAttachment {
  return {
    receiptId,
    relativePath: `notes/${receiptId}.md`,
    quoteExcerpt: "上下文窗口 压缩策略",
    title: `笔记 ${receiptId}`,
  };
}

test("WSG-UI-1：scope 存储按 workspaceKey+sessionId 隔离，draft 与会话互不可见", () => {
  setKnowledgeEvidenceAttachmentScope("session-a", "ws1", [attachment("evr_a")]);
  assert.deepEqual(
    getKnowledgeEvidenceAttachmentScope("session-a", "ws1").map((item) => item.receiptId),
    ["evr_a"],
  );
  // 其他会话 / 其他工作区 / 草稿 scope 不可见。
  assert.deepEqual(getKnowledgeEvidenceAttachmentScope("session-b", "ws1"), []);
  assert.deepEqual(getKnowledgeEvidenceAttachmentScope("session-a", "ws2"), []);
  assert.deepEqual(getKnowledgeEvidenceAttachmentScope(null, "ws1"), []);
  setKnowledgeEvidenceAttachmentScope("session-a", "ws1", []);
  assert.deepEqual(getKnowledgeEvidenceAttachmentScope("session-a", "ws1"), []);
});

test("WSG-UI-1：同 receiptId 去重（duplicate=true 且不重复追加）", () => {
  const first = appendKnowledgeEvidenceAttachment([], attachment("evr_1"));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.duplicate, false);
  const second = appendKnowledgeEvidenceAttachment(first.attachments, attachment("evr_1"));
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.duplicate, true);
  assert.equal(second.attachments.length, 1);
});

test("WSG-UI-1：上限 = 契约 MAX_EVIDENCE_REFS_PER_INPUT（8），超限返回 count", () => {
  let current: readonly KnowledgeEvidenceAttachment[] = [];
  for (let index = 0; index < MAX_EVIDENCE_REFS_PER_INPUT; index += 1) {
    const result = appendKnowledgeEvidenceAttachment(current, attachment(`evr_${index}`));
    assert.equal(result.ok, true);
    if (result.ok) current = result.attachments;
  }
  const overflow = appendKnowledgeEvidenceAttachment(current, attachment("evr_overflow"));
  assert.deepEqual(overflow, { ok: false, reason: "count" });
});

test("WSG-UI-2：发送 payload 只含 opaque receiptId（不携带展示字段）", () => {
  const payload = toEvidenceRefPayload([
    attachment("evr_x1"),
    attachment("evr_x2"),
  ]);
  assert.deepEqual(payload, [{ receiptId: "evr_x1" }, { receiptId: "evr_x2" }]);
});
