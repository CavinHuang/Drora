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
