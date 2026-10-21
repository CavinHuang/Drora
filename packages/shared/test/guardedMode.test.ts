import { describe, expect, it } from "vitest";
import {
  getDroraAgentAvailableModes,
  getDroraAgentModeSelectOptions,
  normalizeAvailableDroraMode,
} from "../src/drora-agent-model-state.js";
import { submissionModeSchema } from "../src/drora-protocol-v4/submission.js";
import { droraSessionModeSchema } from "../src/drora-protocol-legacy-types.js";
import { executionStateSchema, resolveExecutionState } from "../src/execution-state.js";

describe("guarded wire and mode catalog", () => {
  it("preserves guarded across independent Plan transitions and serialization", () => {
    const current = resolveExecutionState({ mode: "guarded", planEnabled: true });
    expect(executionStateSchema.parse(current)).toEqual({ mode: "guarded", planEnabled: true });
    expect(resolveExecutionState({ planEnabled: false }, current)).toEqual({
      mode: "guarded",
      planEnabled: false,
    });
  });
  it("round trips the opt-in value without changing the default", () => {
    expect(submissionModeSchema.parse("guarded")).toBe("guarded");
    expect(droraSessionModeSchema.parse("guarded")).toBe("guarded");
    expect(normalizeAvailableDroraMode("guarded")).toBe("guarded");
    const ids = getDroraAgentAvailableModes().map((mode) => mode.id);
    expect(ids).toEqual(["build", "guarded", "plan", "yolo"]);
    expect(getDroraAgentModeSelectOptions().map((option) => option.value)).toEqual(ids);
    expect(submissionModeSchema.safeParse("unknown").success).toBe(false);
  });
  it("keeps historical edit valid without advertising it as a new choice", () => {
    expect(submissionModeSchema.parse("edit")).toBe("edit");
    expect(droraSessionModeSchema.parse("edit")).toBe("edit");
    expect(normalizeAvailableDroraMode("edit")).toBe("edit");
    expect(getDroraAgentAvailableModes().some((mode) => mode.id === "edit")).toBe(false);
  });
});
