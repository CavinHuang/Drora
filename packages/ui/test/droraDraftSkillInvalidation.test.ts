import { beforeEach, describe, expect, it } from "vitest";
import { invalidateDeferredDraftSessionForSkillChange } from "@/lib/droraDraftSkillInvalidation.js";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
beforeEach(() => {
  useDroraSessionStore.setState({ workspaces: {} });
});
describe("draft capability invalidation", () => {
  it("invalidates only the requested identity without changing its active task", async () => {
    const workspacePath = "/workspace/app";
    const workspaceIdentity = "remote:server:dev:/workspace/app";
    const store = useDroraSessionStore.getState();
    store.setActiveTaskId(workspacePath, "active", workspaceIdentity);
    await invalidateDeferredDraftSessionForSkillChange({
      reason: "test",
      workspacePath,
      workspaceIdentity: ` ${workspaceIdentity} `,
    });
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity),
    ).toMatchObject({
      activeTaskId: "active",
      draftRuntimeInvalidationVersion: 1,
    });
    expect(
      useDroraSessionStore.getState().getWorkspaceState(workspacePath)
        .draftRuntimeInvalidationVersion,
    ).toBe(0);
  });
  it("invalidates a prewarm on each capability change without a copied session id", async () => {
    for (const reason of ["skill-enabled", "plugin-updated"]) {
      await invalidateDeferredDraftSessionForSkillChange({
        reason,
        workspacePath: "/workspace/app",
      });
    }
    expect(
      useDroraSessionStore.getState().getWorkspaceState("/workspace/app")
        .draftRuntimeInvalidationVersion,
    ).toBe(2);
  });
  it("does not create a workspace for a settings view without an execution target", async () => {
    await invalidateDeferredDraftSessionForSkillChange({ reason: "test" });
    expect(useDroraSessionStore.getState().workspaces).toEqual({});
  });
});
