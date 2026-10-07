import { useEffect } from "react";
import type { DesktopPetPresentation, IPlatformService } from "@drora/shared";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { projectDesktopPet } from "@/lib/desktopPetProjection.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";

const IDLE: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };
const TERMINAL_CUE_MS = 4000;

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
  const { settings } = useSettings();
  const { workspacePath, workspaceIdentity, endpointKey, rpcReady, enabled, platform } = params;
  const petEnabled = enabled && settings?.desktopPetEnabled === true;
  useEffect(() => {
    const publish = platform?.publishDesktopPet;
    if (!petEnabled) return;
    if (!rpcReady || !publish || !workspacePath || !droraAgentService) {
      publish?.(IDLE);
      return;
    }
    const scope: SessionsIndexScope = {
      workspacePath,
      workspaceKey: workspaceIdentity?.trim() || workspacePath,
      ...(workspaceIdentity?.trim() ? { workspaceIdentity: workspaceIdentity.trim() } : {}),
      ...(endpointKey ? { endpointKey } : {}),
    };
    const store = acquireSessionsIndex(scope, droraAgentService);
    let previous: Map<string, SessionSummary> | null = null;
    let cueTimer: ReturnType<typeof setTimeout> | null = null;
    const clearCue = () => {
      if (cueTimer) clearTimeout(cueTimer);
      cueTimer = null;
    };
    const sync = () => {
      clearCue();
      if (store.getStatus() !== "live") {
        previous = null;
        publish(IDLE);
        return;
      }
      const sessions = store.getSessions();
      const presentation = projectDesktopPet({
        scope: { ...scope, remoteSessionId: endpointKey },
        sessions,
        previous,
      });
      previous = new Map(sessions.map((session) => [session.sessionId, session]));
      publish(presentation);
      if (presentation.mode === "completed" || presentation.mode === "error") {
        cueTimer = setTimeout(() => {
          cueTimer = null;
          publish(
            projectDesktopPet({
              scope: { ...scope, remoteSessionId: endpointKey },
              sessions: store.getSessions(),
              previous,
            }),
          );
        }, TERMINAL_CUE_MS);
      }
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      clearCue();
      releaseSessionsIndex(scope, store);
      publish(IDLE);
    };
  }, [
    droraAgentService,
    petEnabled,
    endpointKey,
    platform,
    rpcReady,
    workspaceIdentity,
    workspacePath,
  ]);
}
