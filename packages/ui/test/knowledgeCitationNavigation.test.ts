import { describe, expect, it } from "vitest";
import type { KnowledgeResolveCitationResult } from "@drora/services";
import {
  createKnowledgeCitationScopeEpoch,
  decideKnowledgeCitationNavigation,
  isKnowledgeCitationScopeCurrent,
  isVaultCitationFocusCurrent,
  matchesKnowledgeCitationReadback,
} from "../src/v4/vault/knowledge/knowledgeCitationNavigation.js";

const quote = { startLine: 3, endLine: 4, startOffset: 10, endOffset: 35 };
const citation = {
  receiptId: "evr_open",
  sessionId: "session-1",
  runId: "run-1",
  articleId: "note-1",
  relativePath: "notes/a.md",
  title: "Note A",
  heading: "Section",
  quote,
  excerpt: "Verified text",
  createdAtMs: 1,
};
function validate(resolved: KnowledgeResolveCitationResult, sessionId = "session-1") {
  return decideKnowledgeCitationNavigation({ resolved, receiptId: "evr_open", sessionId });
}
function current(changes: Partial<typeof citation> = {}): KnowledgeResolveCitationResult {
  return { status: "current", citation: { ...citation, ...changes } };
}

describe("Obsidian citation navigation authorization", () => {
  it("uses only the current server-resolved destination and exact quote", () => {
    expect(validate(current())).toEqual({
      ok: true, relativePath: "notes/a.md", quote, excerpt: "Verified text",
    });
  });

  it("rejects receipts issued for a different session or identifier", () => {
    expect(validate(current(), "another-session")).toEqual({ ok: false, reason: "forbidden" });
    expect(validate(current({ receiptId: "evr_elsewhere" }))).toEqual({ ok: false, reason: "forbidden" });
    expect(validate(current({ sessionId: "another-session" }))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("cannot use an absolute path, parent traversal or a malformed quote", () => {
    for (const relativePath of ["../../outside.md", "/etc/passwd", "C:/secrets.md", "notes/../else.md", "notes\\a.md", "notes//a.md"]) {
      expect(validate(current({ relativePath }))).toEqual({ ok: false, reason: "forbidden" });
    }
    for (const invalid of [
      { ...quote, startLine: 0 },
      { ...quote, endLine: 1 },
      { ...quote, startOffset: -1 },
      { ...quote, endOffset: 2 },
    ]) {
      expect(validate(current({ quote: invalid }))).toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("fails closed for stale/missing/forbidden or unavailable source", () => {
    for (const status of ["stale", "missing", "forbidden", "source_stale"] as const) {
      const result = validate({ status, reason: null } as unknown as KnowledgeResolveCitationResult);
      expect(result).toEqual({
        ok: false,
        reason: status === "source_stale" ? "unavailable" : status,
      });
    }
  });
  it("revokes a pending navigation when request, mount, Vault, session, workspace or service changes", () => {
    const baseline = {
      requestActive: true, mounted: true,
      originalVaultId: "vault-1", currentVaultId: "vault-1",
      sessionId: "session-1", activeSessionId: "session-1",
      workspaceKey: "/workspace-1", activeWorkspaceKey: "/workspace-1",
      sameQueryService: true,
    };
    expect(isKnowledgeCitationScopeCurrent(baseline)).toBe(true);
    for (const changes of [
      { requestActive: false }, { mounted: false },
      { currentVaultId: "vault-2" }, { currentVaultId: null },
      { activeSessionId: "session-2" }, { activeWorkspaceKey: "/workspace-2" },
      { sameQueryService: false },
    ]) {
      expect(isKnowledgeCitationScopeCurrent({ ...baseline, ...changes })).toBe(false);
    }
  });
  it("invalidates an old request permanently across A→B→A and unmount/remount", () => {
    const tracker = createKnowledgeCitationScopeEpoch();
    const service = {};
    const vaultA = {
      sessionId: "session-1", workspaceKey: "/workspace",
      vaultId: "vault-a", queryService: service,
    };
    const original = tracker.observe(vaultA);
    expect(tracker.observe(vaultA)).toBe(original);
    expect(tracker.isCurrent(original)).toBe(true);
    tracker.observe({ ...vaultA, sessionId: "session-2" });
    expect(tracker.isCurrent(original)).toBe(false);
    const returned = tracker.observe(vaultA);
    expect(returned).toBeGreaterThan(original);
    expect(tracker.isCurrent(returned)).toBe(true);
    expect(tracker.isCurrent(original)).toBe(false);
    tracker.observe({ ...vaultA, vaultId: "vault-b" });
    tracker.observe(vaultA);
    expect(tracker.isCurrent(returned)).toBe(false);
    const active = tracker.currentVersion();
    tracker.revoke();
    expect(tracker.isCurrent(active)).toBe(false);
    const remounted = tracker.observe(vaultA);
    expect(tracker.isCurrent(remounted)).toBe(true);
    expect(tracker.isCurrent(active)).toBe(false);
  });

  it("invalidates pending opens when replacing the query service without changing the Vault", () => {
    const tracker = createKnowledgeCitationScopeEpoch();
    const scope = {
      sessionId: "session-1", workspaceKey: "/workspace", vaultId: "vault-a",
      queryService: {},
    };
    const captured = tracker.observe(scope);
    tracker.observe({ ...scope, queryService: {} });
    expect(tracker.isCurrent(captured)).toBe(false);
  });

  it("does not apply a pending quote highlight across A→B→A or unmount", () => {
    const epoch = createKnowledgeCitationScopeEpoch();
    const scope = { sessionId: "A", workspaceKey: "/work", vaultId: "V", queryService: {} };
    const original = epoch.observe(scope);
    expect(isVaultCitationFocusCurrent(original, epoch.currentVersion())).toBe(true);
    expect(isVaultCitationFocusCurrent(undefined, epoch.currentVersion())).toBe(true);
    epoch.observe({ ...scope, sessionId: "B" });
    const returnToA = epoch.observe(scope);
    expect(isVaultCitationFocusCurrent(original, returnToA)).toBe(false);
    expect(isVaultCitationFocusCurrent(returnToA, returnToA)).toBe(true);
    epoch.revoke();
    expect(isVaultCitationFocusCurrent(returnToA, epoch.currentVersion())).toBe(false);
    expect(isVaultCitationFocusCurrent(0, returnToA)).toBe(false);
  });

  it("rejects a changed second file read before any editor navigation", () => {
    const original = "Intro\r\nAlpha   original\r\nTrailing";
    const startOffset = "Intro\n".length;
    const endOffset = "Intro\nAlpha   original".length;
    const position = { startLine: 2, endLine: 2, startOffset, endOffset };
    expect(matchesKnowledgeCitationReadback(original, position, "Alpha original")).toBe(true);
    expect(matchesKnowledgeCitationReadback(
      "Intro\r\nAlpha   replaced\r\nTrailing", position, "Alpha original",
    )).toBe(false);
    expect(matchesKnowledgeCitationReadback("Intro\nAlpha", position, "Alpha original")).toBe(false);
    expect(matchesKnowledgeCitationReadback(original, position, "")).toBe(false);
    expect(matchesKnowledgeCitationReadback(
      original, { ...position, endOffset: 10_000 }, "Alpha original",
    )).toBe(false);
  });

  it("matches long/truncated excerpts using exactly the Receipt producer projection", () => {
    const quoteText = "source ".repeat(55);
    const full = "header\n" + quoteText + "\nfooter";
    const position = { startLine: 2, endLine: 2, startOffset: 7, endOffset: 7 + quoteText.length };
    const expected = quoteText.trim().slice(0, 240) + "…";
    expect(matchesKnowledgeCitationReadback(full, position, expected)).toBe(true);
    expect(matchesKnowledgeCitationReadback(
      "header\n" + "damage " + quoteText.slice(7) + "\nfooter", position, expected,
    )).toBe(false);
  });

});