import { VaultView } from "@/v4/VaultView.js";

/** Self-developed main-view registration: ownership remains in Vault/Knowledge services. */
export function isDroraWorkspaceMainView(view: string): boolean {
  return view === "vault";
}

export function DroraWorkspaceMainView({
  sessionId,
  workspaceKey,
  onCitationOpen,
  onAgentHandoffPrepared,
}: {
  sessionId?: string;
  workspaceKey: string;
  /** Only called after Vault accepted a genuine, still-current citation. */
  onCitationOpen?: () => void;
  /** Handoff is staged only after the live Composer acknowledges the sources. */
  onAgentHandoffPrepared?: () => void;
}) {
  return (
    <VaultView
      sessionId={sessionId}
      workspaceKey={workspaceKey}
      onCitationOpen={onCitationOpen}
      onAgentHandoffPrepared={onAgentHandoffPrepared}
    />
  );
}
