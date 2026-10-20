import { describe, expect, it } from "vitest";
import type { KnowledgeResolveCitationResult } from "@drora/services";
import {
  createKnowledgeCitationScopeEpoch,
  navigateKnowledgeCitation,
} from "../src/v4/vault/knowledge/knowledgeCitationNavigation.js";

const quote = { startLine: 3, endLine: 4, startOffset: 10, endOffset: 35 };
const current: KnowledgeResolveCitationResult = {
  status: "current",
  citation: {
    receiptId: "evr_ok",
    sessionId: "session-1",
    runId: "run-1",
    articleId: "note-1",
    relativePath: "notes/a.md",
    title: "A",
    heading: "Section",
    quote,
    excerpt: "Verified content",
    fileSha256: "a".repeat(64),
    createdAtMs: 1,
  },
};
const run = (overrides: Partial<Parameters<typeof navigateKnowledgeCitation>[0]> = {}) =>
  navigateKnowledgeCitation({
    sessionId: "session-1",
    receiptId: "evr_ok",
    isCurrent: () => true,
    resolveCitation: async () => current,
    openNote: async () => true,
    ...overrides,
  });

describe("Obsidian citation resolver-to-reader transaction", () => {
  it("uses the server-resolved path and quote, never model-authored links", async () => {
    const opened: unknown[] = [];
    expect(
      await run({
        openNote: async (path, resolvedQuote, isCurrent, excerpt, sha256) => {
          opened.push([path, resolvedQuote, isCurrent(), excerpt, sha256]);
          return true;
        },
      }),
    ).toEqual({ ok: true });
    expect(opened).toEqual([["notes/a.md", quote, true, "Verified content", "a".repeat(64)]]);
  });

  it("will not call the resolver when no longer mounted or authorized", async () => {
    let calls = 0;
    expect(
      await run({
        isCurrent: () => false,
        resolveCitation: async () => {
          calls++;
          return current;
        },
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(calls).toBe(0);
  });

  it("rejects stale, forged and mismatched citations before reading any note", async () => {
    for (const resolved of [
      { status: "stale", reason: null } as KnowledgeResolveCitationResult,
      { ...current, citation: { ...current.citation!, receiptId: "evr_other" } },
      { ...current, citation: { ...current.citation!, sessionId: "session-2" } },
      { ...current, citation: { ...current.citation!, relativePath: "../outside.md" } },
    ]) {
      let opens = 0;
      const result = await run({
        resolveCitation: async () => resolved,
        openNote: async () => {
          opens++;
          return true;
        },
      });
      expect(result.ok).toBe(false);
      expect(opens).toBe(0);
    }
  });

  it("never opens when the Vault is switched during a delayed resolve", async () => {
    let finish: ((result: KnowledgeResolveCitationResult) => void) | undefined;
    let active = true;
    let opened = 0;
    const pending = run({
      isCurrent: () => active,
      resolveCitation: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      openNote: async () => {
        opened++;
        return true;
      },
    });
    active = false;
    finish?.(current);
    expect(await pending).toEqual({ ok: false, reason: "forbidden" });
    expect(opened).toBe(0);
  });

  it("rejects a failed file read or scope change while opening", async () => {
    expect(await run({ openNote: async () => false })).toEqual({
      ok: false,
      reason: "failed",
    });
    let active = true;
    const result = await run({
      isCurrent: () => active,
      openNote: async () => {
        active = false;
        return true;
      },
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("maps resolver and reader errors to explicit fail-closed outcomes", async () => {
    expect(
      await run({
        resolveCitation: async () => {
          throw new Error("offline");
        },
      }),
    ).toEqual({ ok: false, reason: "failed" });
    expect(
      await run({
        openNote: async () => {
          throw new Error("file unavailable");
        },
      }),
    ).toEqual({ ok: false, reason: "failed" });
  });
  it("never revives a delayed resolver across A→B→A even when all identities match again", async () => {
    const tracker = createKnowledgeCitationScopeEpoch();
    const scope = {
      sessionId: "session-1",
      workspaceKey: "/workspace",
      vaultId: "vault-a",
      queryService: {},
    };
    const oldVersion = tracker.observe(scope);
    let finish: ((result: KnowledgeResolveCitationResult) => void) | undefined;
    const opened: string[] = [];
    const pending = run({
      isCurrent: () => tracker.isCurrent(oldVersion),
      resolveCitation: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      openNote: async (path) => {
        opened.push(path);
        return true;
      },
    });
    tracker.observe({ ...scope, sessionId: "session-2" });
    const newVersion = tracker.observe(scope);
    expect(newVersion).toBeGreaterThan(oldVersion);
    finish?.(current);
    expect(await pending).toEqual({ ok: false, reason: "forbidden" });
    expect(opened).toEqual([]);
    expect(
      await run({
        isCurrent: () => tracker.isCurrent(newVersion),
        openNote: async (path) => {
          opened.push(path);
          return true;
        },
      }),
    ).toEqual({ ok: true });
    expect(opened).toEqual(["notes/a.md"]);
  });
});
