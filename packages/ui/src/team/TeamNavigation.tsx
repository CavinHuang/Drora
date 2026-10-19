import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { TeamUiNavigationTarget } from "./contract.js";

export type TeamOpenTarget = TeamUiNavigationTarget;
const TeamNavigation = createContext<((target: TeamOpenTarget) => void) | null>(null);
export function TeamNavigationProvider({
  onOpen,
  children,
}: {
  onOpen?: (target: TeamOpenTarget) => void;
  children: ReactNode;
}) {
  const ref = useRef(onOpen);
  ref.current = onOpen;
  const stable = useMemo(() => (target: TeamOpenTarget) => ref.current?.(target), []);
  return (
    <TeamNavigation.Provider value={onOpen ? stable : null}>{children}</TeamNavigation.Provider>
  );
}
export function useTeamNavigation() {
  return useContext(TeamNavigation);
}
