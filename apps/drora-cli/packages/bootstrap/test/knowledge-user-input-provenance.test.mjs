import assert from "node:assert/strict";
import test from "node:test";
import { buildUserInputRow } from "../src/drora-protocol-v4/projection-rows.ts";

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
