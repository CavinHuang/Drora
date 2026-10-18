import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";
import { projectDesktopPet } from "../src/lib/desktopPetProjection.js";

const scope = {
  workspacePath: "C:/repo",
  workspaceIdentity: "remote:one",
  remoteSessionId: "connection-1",
};
function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "task-1",
    workspaceId: "workspace-1",
    title: "Task",
    phase: "running",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 1,
    createdAt: 1,
    ...overrides,
  };
}

test("interaction takes priority and preserves workspace identity for navigation", () => {
  const result = projectDesktopPet({
    scope,
    sessions: [session({ pendingInteraction: { interactionId: "ask-1", kind: "userInput" } })],
    previous: null,
  });
  assert.equal(result.mode, "attention");
  assert.deepEqual(result.target, {
    workspacePath: "C:/repo",
    workspaceIdentity: "remote:one",
    remoteSessionId: "connection-1",
    sessionId: "task-1",
  });
});

test("selected task carries only its bounded assistant preview into the pet", () => {
  const result = projectDesktopPet({
    scope,
    sessions: [
      session({ sessionId: "older", lastActivityAt: 1, lastAssistantPreview: "old message" }),
      session({
        sessionId: "current",
        lastActivityAt: 2,
        lastAssistantPreview: "  Checking files\nnow  ",
      }),
    ],
    previous: null,
  });
  assert.equal(result.mode, "working");
  assert.equal(result.preview, "Checking files now");
  assert.equal(result.target?.sessionId, "current");
  const longPreview = projectDesktopPet({
    scope,
    sessions: [session({ lastAssistantPreview: "x".repeat(160) })],
    previous: null,
  });
  assert.equal(longPreview.preview?.length, 120);
});

test("initial historical completion is idle, later terminal edge is shown once", () => {
  const completed = session({
    phase: "completedSuccess",
    sessionEnded: true,
    lastAssistantPreview: "Finished the earlier task",
  });
  const initial = projectDesktopPet({ scope, sessions: [completed], previous: null });
  assert.equal(initial.mode, "idle");
  assert.equal(initial.preview, undefined);
  const transition = projectDesktopPet({
    scope,
    sessions: [completed],
    previous: new Map([["task-1", session()]]),
  });
  assert.equal(transition.mode, "completed");
  const repeated = projectDesktopPet({
    scope,
    sessions: [completed],
    previous: new Map([["task-1", completed]]),
  });
  assert.equal(repeated.mode, "idle");
});

test("background work stays active and empty runtime state becomes idle", () => {
  const active = projectDesktopPet({
    scope,
    sessions: [session({ phase: "completedSuccess", hasBackgroundWork: true })],
    previous: null,
  });
  assert.equal(active.mode, "working");
  assert.equal(projectDesktopPet({ scope, sessions: [], previous: null }).mode, "idle");
});

test("a later approval request outranks concurrent work", () => {
  const result = projectDesktopPet({
    scope,
    sessions: [
      session({ sessionId: "task-running", lastActivityAt: 10 }),
      session({
        sessionId: "task-needs-user",
        phase: "completedSuccess",
        lastActivityAt: 9,
        pendingInteraction: { interactionId: "ask-2", kind: "permission" },
      }),
    ],
    previous: null,
  });
  assert.equal(result.mode, "attention");
  assert.equal(result.activeCount, 1);
  assert.equal(result.attentionCount, 1);
  assert.equal(result.target?.sessionId, "task-needs-user");
});

test("tray orders input, blocked, ready and running, and retains identity on every row", () => {
  const running = session({ sessionId: "working", lastActivityAt: 100 });
  const completed = session({
    sessionId: "completed",
    phase: "completedSuccess",
    lastActivityAt: 2,
  });
  const failed = session({ sessionId: "error", phase: "error", lastActivityAt: 3 });
  const attention = session({
    sessionId: "attention",
    lastActivityAt: 1,
    pendingInteraction: { interactionId: "approval", kind: "permission" },
  });
  const result = projectDesktopPet({
    scope,
    sessions: [running, completed, failed, attention],
    previous: new Map([
      ["completed", session({ sessionId: "completed" })],
      ["error", session({ sessionId: "error" })],
    ]),
  });
  assert.deepEqual(
    result.activities?.map((row) => row.mode),
    ["attention", "error", "completed", "working"],
  );
  for (const row of result.activities!)
    assert.equal(row.target.remoteSessionId, scope.remoteSessionId);
});

test("terminal activity survives later preview updates but not a restarted run", () => {
  const completed = session({ phase: "completedSuccess", lastActivityAt: 2 });
  const first = projectDesktopPet({
    scope,
    sessions: [completed],
    previous: new Map([["task-1", session()]]),
  });
  const updated = { ...completed, lastActivityAt: 3, lastAssistantPreview: "Final summary" };
  const next = projectDesktopPet({
    scope,
    sessions: [updated],
    previous: new Map([["task-1", completed]]),
    recentActivities: first.activities,
  });
  assert.equal(next.activities?.[0]?.revision, 3);
  assert.equal(next.preview, "Final summary");
  assert.equal(
    projectDesktopPet({
      scope,
      sessions: [session()],
      previous: new Map([["task-1", updated]]),
      recentActivities: next.activities,
    }).mode,
    "working",
  );
});

test("tray projection is bounded and initial historical failures do not create fresh activity", () => {
  assert.equal(
    projectDesktopPet({ scope, sessions: [session({ phase: "error" })], previous: null }).mode,
    "idle",
  );
  const result = projectDesktopPet({
    scope,
    sessions: Array.from({ length: 50 }, (_, i) =>
      session({
        sessionId: `s-${i}`,
        title: "x".repeat(200),
        lastAssistantPreview: "x".repeat(200),
      }),
    ),
    previous: null,
  });
  assert.equal(result.activities?.length, 30);
  assert.equal(result.activeCount, 50);
  assert.equal(result.activities?.[0]?.title.length, 160);
  assert.equal(result.activities?.[0]?.preview?.length, 120);
});
