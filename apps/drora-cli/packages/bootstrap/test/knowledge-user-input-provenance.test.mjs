import assert from "node:assert/strict";
import test from "node:test";
import { buildUserInputRow } from "../src/drora-protocol-v4/projection-rows.ts";
import { userInputRowSchema } from "@drora/shared/drora-protocol-v4";
import { SessionEventType } from "@drora/contracts";
import { synthesizeEventsFromMessages } from "../src/drora-protocol-v4/transcript-hydration.js";

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
  const canonical = {
    sourceCommandId: "cmd-cold-1",
    queueItemId: "queue_cmd-cold-1",
    clientId: "client-desktop",
    kind: "sendText",
    text: prompt,
    attachments: [],
    admittedAt: 200,
    delivery: { requested: "startNow", admitted: "startNow" },
    order: { admissionSeq: 1 },
    steer: { state: "notRequested" },
    dispatch: { state: "admitted" },
    conversationQuotes: [{ text: "Real local evidence excerpt", path: "note.md" }],
    evidenceRefs: [{ receiptId }],
  };
  const message = {
    info: {
      id: "user-cold-1",
      sessionID: "session-cold",
      role: "user",
      time: { created: 100 },
      metadata: { conversationInputIntent: canonical },
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
    "Admitted Receipt IDs must survive the same transcript replay as conversationQuotes");
  assert.deepEqual(restored.payload.intent?.conversationQuotes, canonical.conversationQuotes);
  assert.equal(restored.payload.intent?.sourceCommandId, canonical.sourceCommandId);

  // A model claim or malformed persisted field can NEVER mint a trusted
  // Receipt. Schema failure should fail closed instead of falling back to [1].
  const noReceipt = turnOf({
    ...message,
    info: {
      ...message.info,
      metadata: { conversationInputIntent: { ...canonical, evidenceRefs: undefined } },
    },
  });
  assert.equal(noReceipt?.payload?.intent?.evidenceRefs, undefined);
  const forged = turnOf({
    ...message,
    info: {
      ...message.info,
      metadata: { conversationInputIntent: { ...canonical, evidenceRefs: [{ receiptId: "fake_path" }] } },
    },
  });
  assert.equal(forged?.payload?.intent?.evidenceRefs, undefined,
    "Invalid persisted Receipt shape must not silently acquire source authority");
});
