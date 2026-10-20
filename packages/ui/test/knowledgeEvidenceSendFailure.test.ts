import { describe, expect, it } from "vitest";
import { KNOWLEDGE_EVIDENCE_GUARDS } from "@drora/shared";
import { resolveKnowledgeEvidenceSendFailure } from "../src/v4/knowledgeEvidenceSendFailure.js";

describe("Obsidian CLI evidence Send rejection feedback", () => {
  it.each([
    [KNOWLEDGE_EVIDENCE_GUARDS.stale, "stale"],
    [KNOWLEDGE_EVIDENCE_GUARDS.missing, "missing"],
    [KNOWLEDGE_EVIDENCE_GUARDS.forbidden, "forbidden"],
    [KNOWLEDGE_EVIDENCE_GUARDS.unknown, "unknown"],
    [KNOWLEDGE_EVIDENCE_GUARDS.unavailable, "unavailable"],
  ] as const)("maps trusted CLI reason %s to user-facing %s", (reason, expected) => {
    expect(resolveKnowledgeEvidenceSendFailure(reason)).toBe(expected);
  });

  it("does not mistake unrelated errors, snippets, or model text for trusted CLI rejection", () => {
    expect(resolveKnowledgeEvidenceSendFailure("")).toBeNull();
    expect(resolveKnowledgeEvidenceSendFailure("SEND_FAILED")).toBeNull();
    expect(resolveKnowledgeEvidenceSendFailure("guard.evidenceMissing - model says so")).toBeNull();
    expect(
      resolveKnowledgeEvidenceSendFailure(KNOWLEDGE_EVIDENCE_GUARDS.guideForbidden),
    ).toBeNull();
  });
});
