import {
  DESKTOP_PET_CONTRACT,
  DESKTOP_PET_ACTIVITY_PRIORITY as priority,
  type DesktopPetActivity,
  type DesktopPetPresentation,
  type DesktopPetTarget,
} from "@drora/shared";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";

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
  recentActivities?: readonly DesktopPetActivity[];
}): DesktopPetPresentation {
  const ordered = [...params.sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const active = ordered.filter(hasActiveWork);
  const attention = ordered.filter(hasPendingInteraction);
  const counts = {
    activeCount: Math.min(active.length, 999),
    attentionCount: Math.min(attention.length, 999),
  };
  const retained = new Map(
    (params.recentActivities ?? []).map((row) => [row.target.sessionId, row]),
  );
  const activities: DesktopPetActivity[] = [];
  for (const item of ordered) {
    const terminal = terminalMode(item);
    const old = params.previous?.get(item.sessionId);
    const recent = retained.get(item.sessionId);
    const freshTerminal =
      terminal && ((old && terminalMode(old) !== terminal) || recent?.mode === terminal);
    const mode = hasPendingInteraction(item)
      ? "attention"
      : hasActiveWork(item)
        ? "working"
        : freshTerminal
          ? terminal
          : null;
    if (mode)
      activities.push({
        target: targetOf(params.scope, item),
        title: item.title.slice(0, 160),
        mode,
        ...(previewOf(item) ? { preview: previewOf(item) } : {}),
        revision: item.lastActivityAt,
      });
  }
  activities.sort((a, b) => priority[a.mode] - priority[b.mode] || b.revision - a.revision);
  const bounded = activities.slice(0, DESKTOP_PET_CONTRACT.maxActivities);
  const first = bounded[0];
  if (first)
    return {
      ...counts,
      mode: first.mode,
      target: first.target,
      preview: first.preview,
      activities: bounded,
    };
  return { ...counts, mode: "idle", activities: [] };
}
