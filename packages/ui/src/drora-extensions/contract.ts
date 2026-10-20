import type { ComponentProps } from "react";
import type { WebRemoteControlDialog } from "@/web-remote-control/index.js";
export type RemoteDeploymentDialogProps = ComponentProps<typeof WebRemoteControlDialog>;
export interface WorkspaceMainViewTarget {
  workspaceKey: string;
  sessionId?: string;
}
