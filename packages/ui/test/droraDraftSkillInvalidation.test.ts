import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDroraSessionService } from "@drora/services";
import { invalidateDeferredDraftSessionForSkillChange } from "../src/lib/droraDraftSkillInvalidation.js";
import { useDroraSessionStore } from "../src/store/droraSessionStore.js";

function createSessionService(
  closeSession: IDroraSessionService["closeSession"] = vi.fn(async () => {}),
): Pick<IDroraSessionService, "closeSession"> {
  return { closeSession };
}

beforeEach(() => {
  useDroraSessionStore.setState((state) => ({
    ...state,
    workspaces: {},
  }));
});

describe("invalidateDeferredDraftSessionForSkillChange", () => {
  it("closes and clears the current workspace draft session", async () => {
    const closeSession = vi.fn(async () => {});
    const workspacePath = "/workspace/app";
    const workspaceIdentity = "ssh:dev";
    useDroraSessionStore.getState().setDraftSessionId(workspacePath, "draft-1", workspaceIdentity);

    await invalidateDeferredDraftSessionForSkillChange({
      reason: "test",
      workspacePath,
      workspaceIdentity,
      droraSessionService: createSessionService(closeSession),
    });

    expect(closeSession).toHaveBeenCalledWith({
      workspacePath,
      workspaceIdentity,
      sessionId: "draft-1",
    });
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .draftSessionId,
    ).toBeNull();
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
        .draftRuntimeInvalidationVersion,
    ).toBe(1);
  });

  it("invalidates a protocol-v4 prewarm even when there is no legacy draft session", async () => {
    const closeSession = vi.fn(async () => {});
    const workspacePath = "/workspace/app";

    await invalidateDeferredDraftSessionForSkillChange({
      reason: "test",
      workspacePath,
      droraSessionService: createSessionService(closeSession),
    });

    expect(closeSession).not.toHaveBeenCalled();
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath)
        .draftRuntimeInvalidationVersion,
    ).toBe(1);
  });

  it("still clears the draft when closing the stale session fails", async () => {
    const closeSession = vi.fn(async () => {
      throw new Error("stale draft");
    });
    const workspacePath = "/workspace/app";
    useDroraSessionStore.getState().setDraftSessionId(workspacePath, "draft-1");

    await invalidateDeferredDraftSessionForSkillChange({
      reason: "test",
      workspacePath,
      droraSessionService: createSessionService(closeSession),
    });

    expect(closeSession).toHaveBeenCalledWith({
      workspacePath,
      sessionId: "draft-1",
    });
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath).draftSessionId,
    ).toBeNull();
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath)
        .draftRuntimeInvalidationVersion,
    ).toBe(1);
  });
});
