import { describe, expect, it } from "vitest";
import {
  shouldHideDroraSessionForkAction,
  supportsDroraSessionFork,
} from "../src/lib/droraProviders.js";

describe("supportsDroraSessionFork", () => {
  it("所有 provider 都开放 session fork 入口", () => {
    expect(supportsDroraSessionFork("glm")).toBe(true);
    expect(supportsDroraSessionFork("claude")).toBe(true);
    expect(supportsDroraSessionFork("codex")).toBe(true);
    expect(supportsDroraSessionFork("gemini")).toBe(true);
    expect(supportsDroraSessionFork("opencode")).toBe(true);
  });
});

describe("shouldHideDroraSessionForkAction", () => {
  it("所有 provider 都不再隐藏 fork UI 入口", () => {
    expect(shouldHideDroraSessionForkAction("glm")).toBe(false);
    expect(shouldHideDroraSessionForkAction("claude")).toBe(false);
    expect(shouldHideDroraSessionForkAction("codex")).toBe(false);
    expect(shouldHideDroraSessionForkAction("gemini")).toBe(false);
    expect(shouldHideDroraSessionForkAction("opencode")).toBe(false);
  });
});
