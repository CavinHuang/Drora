import assert from "node:assert/strict";
import test from "node:test";
import { buildUserInputRow } from "../src/drora-protocol-v4/projection-rows.ts";
import { userInputRowSchema } from "@drora/shared/drora-protocol-v4";
import { SessionEventType } from "@drora/contracts";
import { synthesizeEventsFromMessages } from "../src/drora-protocol-v4/transcript-hydration.js";
import { buildPersistedConversationInputIntent } from "../../core/src/runtime/methods/input-intent-persistence.ts";

const base = { rowId: 22, turnId: "turn-22", createdAt: 1, createdAtSeq: 1 };

test("admitted evidence receipts survive CLI userInput row projection with source command identity", () => {
  const refs = [{ receiptId: "evr_a" }, { receiptId: "evr_b" }];
  const row = buildUserInputRow(base, {
    input: "Original prompt",
    inputId: "command-22",
    intent: {
      sourceCommandId: "command-22",
      text: "Original prompt",
      evidenceRefs: refs,
    },
  });
  assert.equal(row.kind, "userInput");
  assert.equal(row.turnId, "turn-22");
  assert.equal(row.sourceCommandId, "command-22");
  assert.equal(row.origin, "realUser");
  assert.deepEqual(row.evidenceRefs, refs);
  assert.notEqual(row.evidenceRefs, refs, "projector must snapshot the canonical refs");
  assert.deepEqual(userInputRowSchema.parse(row).evidenceRefs, refs, "Zod protocol must not strip the receipts");
});

test("ordinary and legacy inputs never gain synthetic evidence provenance", () => {
  const noEvidence = buildUserInputRow(base, {
    input: "[1] note.md",
    inputId: "command-23",
  });
  assert.equal(noEvidence.evidenceRefs, undefined);
  const emptyEvidence = buildUserInputRow(base, {
    input: "[1] note.md",
    inputId: "command-23",
    intent: { evidenceRefs: [] },
  });
  assert.equal(emptyEvidence.evidenceRefs, undefined);
});

test("G12 cold transcript hydration restores ONLY persisted, schema-validated CLI Receipt refs", () => {
  const receiptId = "evr_coldvalidated000000000000000000001";
  const prompt = "Answer from the selected local note [1]";
  // P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C6）：Core 序列化器
  // 不再持久化 evidenceRefs（写入路径全删）——新账本条目恒无 refs；本用例改以
  // 手工构造的「旧持久化账本」记录（schema 合法）验证冷恢复投影仍能读出历史
  // 引用（渲染消费端 C5a 依赖），伪造形状仍 fail-closed 丢弃。
  const canonical = buildPersistedConversationInputIntent(prompt, {
    sourceCommandId: "cmd-cold-1",
    queueItemId: "queue_cmd-cold-1",
    clientId: "client-desktop",
    kind: "sendText",
    text: prompt,
    admissionSeq: 1,
    admittedAt: 200,
    requestedDelivery: "startNow",
    admittedDelivery: "startNow",
    conversationQuotes: [{ text: "Real local evidence excerpt", path: "note.md" }],
    evidenceRefs: [{ receiptId }],
  }, "drained");
  assert.ok(canonical);
  assert.equal(canonical.evidenceRefs, undefined,
    "P7: the Core serializer must not persist evidence refs into new ledger entries");

  // 旧持久化账本形态（升级前的 durable 记录）：refs 随 metadata 原样存在。
  const legacyCanonical = {
    ...canonical,
    evidenceRefs: [{ receiptId }],
  };

  const message = {
    info: {
      id: "user-cold-1",
      sessionID: "session-cold",
      role: "user",
      time: { created: 100 },
      metadata: { conversationInputIntent: legacyCanonical },
    },
    parts: [{
      id: "part-cold-1",
      sessionID: "session-cold",
      messageID: "user-cold-1",
      type: "text",
      text: prompt,
    }],
  };
  const turnOf = (input) => synthesizeEventsFromMessages(
    [input], { sessionId: "session-cold", baseTimestampMs: 100 },
  ).find((event) => event.type === SessionEventType.TurnStarted);

  const restored = turnOf(message);
  assert.ok(restored, "Cold transcript must synthesize a real TurnStarted event");
  assert.deepEqual(restored.payload.intent?.evidenceRefs, [{ receiptId }],
    "Legacy persisted Receipt IDs must survive transcript replay for renderer citation rows");
  assert.deepEqual(restored.payload.intent?.conversationQuotes, legacyCanonical.conversationQuotes);
  assert.equal(restored.payload.intent?.sourceCommandId, legacyCanonical.sourceCommandId);

  // A model claim or malformed persisted field can NEVER mint a trusted
  // Receipt. Schema failure should fail closed instead of falling back to [1].
  const noReceipt = turnOf({
    ...message,
    info: {
      ...message.info,
      metadata: { conversationInputIntent: { ...legacyCanonical, evidenceRefs: undefined } },
    },
  });
  assert.equal(noReceipt?.payload?.intent?.evidenceRefs, undefined);
  const forged = turnOf({
    ...message,
    info: {
      ...message.info,
      metadata: { conversationInputIntent: { ...legacyCanonical, evidenceRefs: [{ receiptId: "fake_path" }] } },
    },
  });
  assert.equal(forged?.payload?.intent?.evidenceRefs, undefined,
    "Invalid persisted Receipt shape must not silently acquire source authority");
});
