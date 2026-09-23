import type { DroraSessionStateSnapshot } from "@drora/shared";
import type {
  DroraSessionWorkspaceTarget,
  DroraTaskTarget,
} from "#src/drora-session/droraSession.js";

function getWorkspaceKey(target: DroraSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: DroraTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createDroraDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: DroraSessionWorkspaceTarget, snapshot: DroraSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: DroraTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: DroraTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
