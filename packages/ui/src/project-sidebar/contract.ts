import type { Locale, RemoteTarget, UserInfo } from "@drora/shared";
import type { LucideIcon } from "lucide-react";
import type {
  AppProps,
  CreateTaskRequest,
  RemoteWorkspaceRecoveryStatus,
} from "@/app-shell/types.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { Theme } from "@/useTheme.js";
export { LEGACY_SINGLE_ROOT_PROJECT_PREFIX } from "@drora/services";
export type { WebRemoteControlMobileTaskView, WebRemoteControlStatus } from "@drora/shared";
export interface ProjectDevice {
  id: string;
  label: string;
  status: string;
  sourceServerId?: string;
}

export interface ProjectRowAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  run(): void;
  disabled?: boolean;
  destructive?: boolean;
}
export {
  buildRemoteHostWorkspaceIdentity,
  parseRemoteWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@drora/shared";
export type {
  WindowHostTaskAddress,
  WindowHostControllerTaskActivity,
} from "@drora/shared/drora-protocol-v4";
export type {
  TaskGroup,
  TaskGroupColor,
  TaskGroupStructure,
  GroupTaskRef,
  GroupNode,
  MoveGroupNode,
  ProjectTree,
  ProjectTask,
  ProjectTaskRef,
  VirtualProject,
  SaveProjectInput,
  IProjectService,
  IWindowControllerService,
  IDroraTaskService,
  WindowHostControllerMutation,
  WindowHostControllerFrame,
  WindowHostTaskUnreadSignal,
  IRemoteProjectService,
  RemoteProjectDirectory,
  RemoteProjectEntry,
  RemoteProjectHost,
} from "@drora/services";
export interface ProjectAvailability {
  entryId?: string;
  online: boolean;
  unresolved?: boolean;
}
export type { Locale, Theme };
export type ProjectSidebarView = "projects" | "grouped" | "timeline";
export interface SidebarFileTreeTarget {
  workspacePath: string;
  workspaceName: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  revealPath?: string;
  temporaryExternalDirectory?: boolean;
}
export interface SidebarFileTreeOpenRequest {
  id: number;
  target: SidebarFileTreeTarget;
}
/** 项目、时间线共用同一 Host 行集合；回调只负责现有导航，不维护组织状态。 */
export interface ProjectSidebarProps {
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
  activePreviewPath?: string | null;
  onOpenFileManager?: (target: SidebarFileTreeTarget) => void;
  onSelectTask: (
    targetWorkspacePath: string,
    taskId: string,
    targetWorkspaceIdentity?: string,
    targetRemoteSessionId?: string,
    expectedUnreadAt?: number,
  ) => void;
  onStartDraftInWorkspace: (targetWorkspacePath: string, targetWorkspaceIdentity?: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenBrowserUrl?: (url: string) => void;
  fileTreeOpenRequest?: SidebarFileTreeOpenRequest | null;
  onCreateTask: (request?: CreateTaskRequest) => void;
  onCreateConversationTask: () => void;
  onCreateConversationTaskOnSource?: (sourceServerId: string) => void;
  onOpenFolderFromWorkspaceMenu: () => void;
  onOpenRemoteWorkspace?: AppProps["onOpenRemoteWorkspace"];
  webRemoteControlWorkspaceSwitcher?: import("@/root/types.js").WebRemoteControlWorkspaceSwitcherApi;
  theme: Theme;
  onConnectRemote: (
    options: RemoteTarget,
    requestId?: string,
    context?: { confirmSourceServerInstall?: boolean },
    feedback?: import("@/app-shell/types.js").RemoteConnectionFeedbackOptions,
  ) => Promise<string>;
  onSelectRemoteProject: (
    sessionId: string,
    path: string,
    localWorkspacePath?: string,
    preparedWorkspaceIdentity?: string,
    isCurrent?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  onCancelRemoteProject: (sessionId: string) => Promise<void>;
  onReconnectRemoteWorkspace: (workspaceKey: string) => Promise<void>;
  onLogout?: () => void;
  onLogin?: () => void;
  user?: UserInfo | null;
  reconnectingRemoteWorkspaceKeys: string[];
  remoteWorkspaceRecoveryByWorkspaceKey?: Record<string, RemoteWorkspaceRecoveryStatus>;
  remoteWorkspaceErrorByWorkspaceKey: Record<string, string>;
  isDesktop?: boolean;
  isWebRemoteControl?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  toggleSidebarShortcutLabel?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  goBackShortcutLabel?: string;
  goForwardShortcutLabel?: string;
  onOpenCommandCenter: () => void;
  onOpenRepoWiki?: () => void;
  repoWikiActive?: boolean;
  onOpenAutomations?: () => void;
  onOpenPluginStore?: () => void;
  automationsActive?: boolean;
  pluginStoreActive?: boolean;
  // Drora 扩展槽位：vault 侧栏入口。上游 v3.16.1 重写 ProjectSidebarProps 时无该槽位，
  // 旧入口随合并丢失（审计 docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md F7）；
  // 按可选扩展点回植——仅 Shell 接线 onOpenVault 时渲染按钮，路由仍由 Shell 唯一持有。
  onOpenVault?: () => void;
  vaultActive?: boolean;
  onFileTreeOpenChange?: (open: boolean) => void;
  onWebRemoteTaskOpen?: (options: { crossWorkspace: boolean }) => void;
  onWebRemoteTaskSwitchingChange?: (switching: boolean) => void;
}
