import { useEffect } from "react";
import type { DesktopPetActivity, DesktopPetPresentation, IPlatformService } from "@drora/shared";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import { leaseDesktopPetPublication } from "@/lib/desktopPetPublication.js";
import { projectDesktopPet } from "@/lib/desktopPetProjection.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";

const IDLE: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };

/** Reuses the existing sessions-index subscription registry; no task state is stored here. */
export function useDesktopPet(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  endpointKey?: string;
  rpcReady: boolean;
  enabled: boolean;
  platform: IPlatformService | null | undefined;
}): void {
  const { droraAgentService } = useServices();
  const { workspacePath, workspaceIdentity, endpointKey, rpcReady, enabled, platform } = params;
  useEffect(() => {
    if (!enabled || !platform?.publishDesktopPet) return;
    const lease = leaseDesktopPetPublication(platform);
    const publish = lease.update;
    if (!rpcReady || !workspacePath || !droraAgentService) {
      publish(IDLE);
      return lease.release;
    }
    const scope: SessionsIndexScope = {
      workspacePath,
      workspaceKey: workspaceIdentity?.trim() || workspacePath,
      ...(workspaceIdentity?.trim() ? { workspaceIdentity: workspaceIdentity.trim() } : {}),
      ...(endpointKey ? { endpointKey } : {}),
    };
    const store = acquireSessionsIndex(scope, droraAgentService);
    let previous: Map<string, SessionSummary> | null = null;
    let recentActivities: DesktopPetActivity[] = [];
    const sync = () => {
      if (store.getStatus() !== "live") {
        previous = null;
        recentActivities = [];
        publish(IDLE);
        return;
      }
      const sessions = store.getSessions();
      const presentation = projectDesktopPet({
        scope: { ...scope, remoteSessionId: endpointKey },
        sessions,
        previous,
        recentActivities,
      });
      previous = new Map(sessions.map((session) => [session.sessionId, session]));
      recentActivities = (presentation.activities ?? []).filter(
        (row) => row.mode === "completed" || row.mode === "error",
      );
      publish(presentation);
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      releaseSessionsIndex(scope, store);
      lease.release();
    };
  }, [
    droraAgentService,
    enabled,
    endpointKey,
    platform,
    rpcReady,
    workspaceIdentity,
    workspacePath,
  ]);
}
