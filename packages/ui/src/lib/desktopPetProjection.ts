import type { DesktopPetPresentation, DesktopPetTarget } from "@zcode/shared";
import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";

interface Scope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

function targetOf(scope: Scope, session: SessionSummary): DesktopPetTarget {
  return {
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity?.trim()
      ? { workspaceIdentity: scope.workspaceIdentity.trim() }
      : {}),
    ...(scope.remoteSessionId ? { remoteSessionId: scope.remoteSessionId } : {}),
    sessionId: session.sessionId,
  };
}

function hasPendingInteraction(session: SessionSummary): boolean {
  return Boolean(
    session.pendingInteraction ||
    (session.pendingInteractionSummary?.permissionCount ?? 0) > 0 ||
    (session.pendingInteractionSummary?.userInputCount ?? 0) > 0,
  );
}

function hasActiveWork(session: SessionSummary): boolean {
  return session.phase === "prewarming" || session.phase === "running" || session.hasBackgroundWork;
}

function terminalMode(session: SessionSummary): "completed" | "error" | null {
  if (session.phase === "error") return "error";
  if (session.phase === "completedSuccess" || session.phase === "completedInterrupted") {
    return "completed";
  }
  return null;
}

function previewOf(session: SessionSummary): string | undefined {
  const preview = session.lastAssistantPreview?.replace(/\s+/g, " ").trim().slice(0, 120);
  return preview || undefined;
}

/** A bounded desktop presentation of the authoritative sessions-index state. */
export function projectDesktopPet(params: {
  scope: Scope;
  sessions: readonly SessionSummary[];
  previous: ReadonlyMap<string, SessionSummary> | null;
}): DesktopPetPresentation {
  const ordered = [...params.sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const active = ordered.filter(hasActiveWork);
  const attention = ordered.filter(hasPendingInteraction);
  const counts = {
    activeCount: Math.min(active.length, 999),
    attentionCount: Math.min(attention.length, 999),
  };
  const selectedAttention = attention[0];
  if (selectedAttention) {
    const preview = previewOf(selectedAttention);
    return {
      ...counts,
      mode: "attention",
      target: targetOf(params.scope, selectedAttention),
      ...(preview ? { preview } : {}),
    };
  }
  const selectedActive = active[0];
  if (selectedActive) {
    const preview = previewOf(selectedActive);
    return {
      ...counts,
      mode: "working",
      target: targetOf(params.scope, selectedActive),
      ...(preview ? { preview } : {}),
    };
  }
  if (params.previous) {
    for (const session of ordered) {
      const previous = params.previous.get(session.sessionId);
      const terminal = terminalMode(session);
      if (previous && terminal && terminalMode(previous) !== terminal) {
        const preview = previewOf(session);
        return {
          ...counts,
          mode: terminal,
          target: targetOf(params.scope, session),
          ...(preview ? { preview } : {}),
        };
      }
    }
  }
  return { ...counts, mode: "idle" };
}
