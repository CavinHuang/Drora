import { describe, expect, it } from "vitest";
import type { SessionEntryInfo } from "@drora/contracts";
import {
  createTeamJournalSessionStoreSink,
  TEAM_JOURNAL_ENTRY_TYPE,
} from "../../src/team/journal.js";
import { readTeamHistoryPage } from "../../src/team/history.js";

describe("ATUI06–08 saved team history", () => {
  it("reads beyond the mailbox tail across reopened readers, with stable isolated pages", async () => {
    const entries: SessionEntryInfo[] = [];
    const store = {
      saveSessionEntry: async (entry: SessionEntryInfo) => {
        entries.push(structuredClone(entry));
      },
      sessionEntries: async () => entries,
    };
    const sink = createTeamJournalSessionStoreSink({ sessionStore: store, sessionId: "parent" });
    for (let i = 1; i <= 45; i++)
      sink.append({
        at: "2026-10-19T08:00:00Z",
        payload: { kind: "resumed", teamId: i % 5 === 0 ? "other" : "team-a", reason: "continue" },
      });
    await sink.flush();
    const latest = await readTeamHistoryPage({
      sessionStore: store,
      sessionId: "parent",
      teamId: "team-a",
      limit: 20,
    });
    expect(latest.events).toHaveLength(20);
    expect(latest.throughSeq).toBe(44);
    sink.append({ at: "2026-10-19T08:01:00Z", payload: { kind: "halted", teamId: "team-a" } });
    await sink.flush();
    const older = await readTeamHistoryPage({
      sessionStore: store,
      sessionId: "parent",
      teamId: "team-a",
      limit: 20,
      beforeSeq: latest.nextBeforeSeq,
      throughSeq: latest.throughSeq,
    });
    const ids = [...older.events, ...latest.events].map((e) => e.seq);
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    expect(ids).toEqual(Array.from({ length: 44 }, (_, i) => i + 1).filter((i) => i % 5 !== 0));
    expect(older.nextBeforeSeq).toBeUndefined();
    expect(latest.events.every((e) => e.kind === "resumed")).toBe(true);
  });

  it("preserves message source, explicit delivery and detects malformed entries", async () => {
    const raw = (seq: number, payload: unknown): SessionEntryInfo => ({
      id: String(seq),
      sessionID: "parent" as never,
      type: TEAM_JOURNAL_ENTRY_TYPE,
      time: { created: 1, updated: 1 },
      data: { seq, at: "2026-10-19T08:00:00Z", payload },
    });
    const entries = [
      raw(1, {
        kind: "message_appended",
        teamId: "a",
        entry: {
          messageId: "m",
          from: "backend",
          to: "frontend",
          message: "full message",
          sourceTaskId: "t",
          sourceAttemptId: "attempt",
          at: "2026-10-19T08:00:00Z",
          deliveredAccepted: true,
        },
      }),
      raw(2, {
        kind: "message_delivered",
        teamId: "a",
        messageIds: ["m"],
        via: "steered",
        at: "2026-10-19T08:00:01Z",
      }),
      raw(3, { kind: "task_updated", teamId: "a" }),
      raw(4, { kind: "future_kind", teamId: "a" }),
      raw(2, { kind: "message_delivered", teamId: "a", messageIds: ["m"], via: "steered" }),
    ];
    const page = await readTeamHistoryPage({
      sessionStore: { sessionEntries: async () => entries },
      sessionId: "parent",
      teamId: "a",
    });
    expect(page.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(page.events[0]).toMatchObject({
      message: "full message",
      sourceTaskId: "t",
      sourceAttemptId: "attempt",
      delivered: true,
    });
    expect(page.skippedEntries).toBeGreaterThanOrEqual(2);
    const queued = await readTeamHistoryPage({
      sessionStore: { sessionEntries: async () => entries },
      sessionId: "parent",
      teamId: "a",
      throughSeq: 1,
    });
    expect(queued.events[0]?.delivered).toBe(false);
    const damagedReceipt = await readTeamHistoryPage({
      sessionStore: {
        sessionEntries: async () => [
          entries[0]!,
          raw(2, { kind: "message_delivered", teamId: "a", messageIds: ["m", null] }),
        ],
      },
      sessionId: "parent",
      teamId: "a",
    });
    expect(damagedReceipt.events[0]?.delivered).toBe(false);
    expect(damagedReceipt.skippedEntries).toBe(1);
  });

  it("does not disguise absent persistence or failed reads as empty history", async () => {
    await expect(
      readTeamHistoryPage({ sessionStore: undefined, sessionId: "p", teamId: "a" }),
    ).rejects.toThrow();
    await expect(
      readTeamHistoryPage({
        sessionStore: {
          sessionEntries: async () => {
            throw new Error("read failed");
          },
        },
        sessionId: "p",
        teamId: "a",
      }),
    ).rejects.toThrow("read failed");
  });
});
