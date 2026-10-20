import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { TeamUiNavigationTarget } from "./contract.js";

export type TeamOpenTarget = TeamUiNavigationTarget;
const TeamNavigation = createContext<((target: TeamOpenTarget) => void) | null>(null);
const TeamFocusRequest = createContext<TeamOpenTarget | null>(null);
export function TeamNavigationProvider({
  onOpen,
  children,
}: {
  onOpen?: (target: TeamOpenTarget) => void;
  children: ReactNode;
}) {
  const ref = useRef(onOpen);
  ref.current = onOpen;
  const [request, setRequest] = useState<TeamOpenTarget | null>(null);
  const stable = useMemo(
    () => (target: TeamOpenTarget) => {
      setRequest({ ...target });
      ref.current?.(target);
    },
    [],
  );
  return (
    <TeamNavigation.Provider value={onOpen ? stable : null}>
      <TeamFocusRequest.Provider value={request}>{children}</TeamFocusRequest.Provider>
    </TeamNavigation.Provider>
  );
}
export function useTeamFocus(target: TeamOpenTarget) {
  const request = useContext(TeamFocusRequest);
  if (
    !request ||
    request.parentSessionId !== target.parentSessionId ||
    (request.workspaceIdentity?.trim() || request.workspacePath) !==
      (target.workspaceIdentity?.trim() || target.workspacePath) ||
    (request.remoteSessionId &&
      target.remoteSessionId &&
      request.remoteSessionId !== target.remoteSessionId)
  )
    return undefined;
  return request.focus;
}
export function useTeamNavigation() {
  return useContext(TeamNavigation);
}
