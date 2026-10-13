import type { ComponentProps } from "react";
import type { WebRemoteControlDialog } from "../WebRemoteControlDialog.js";
export type RemoteDeploymentDialogProps = ComponentProps<typeof WebRemoteControlDialog>;
export interface WorkspaceMainViewTarget {
  workspaceKey: string;
  sessionId?: string;
}
