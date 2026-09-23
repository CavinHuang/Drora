import type {
  DroraTaskMeta,
  DroraProvider,
  DroraTaskChangeSummary,
  EditorInfo,
  GitRepositorySummary,
  RemoteTarget,
  UserInfo,
} from "@drora/shared";

export interface WorkspaceHeaderState {
  selectedProvider: DroraProvider;
}

export type WorkspaceHeaderVariant = "task" | "draft";

export interface WorkspaceHeaderReloadSessionOptions {
  resumeTaskId?: string | null;
  provider?: DroraProvider | null;
}

export interface WorkspaceHeaderTitleSectionProps {
  variant?: WorkspaceHeaderVariant;
  readOnlyReason?: string;
  workspaceAbsPath: string;
  remoteSessionId?: string;
  workspaceIdentity?: string;
  remoteTarget?: RemoteTarget;
  localWorkspacePath?: string;
  projectName: string;
  activeTaskTitle: string;
  activeTaskChangeSummary?: DroraTaskChangeSummary | null;
  activeTaskId: string | null;
  activeTraceId: string | null;
  activeSessionId: string | null;
  activeTaskProvider: DroraProvider | null;
  resolvedActiveTaskMeta?: DroraTaskMeta | null;
  gitSummary: GitRepositorySummary;
  gitDirtyFileCount: number;
  sessionLogPath: string | null;
  nativeSessionLogProvider: DroraProvider | null;
  nativeSessionLogPath: string | null;
  nativeSessionLogExists: boolean;
  nativeSessionLogLoading: boolean;
  onReloadSession?: (options?: WorkspaceHeaderReloadSessionOptions) => void | Promise<void>;
  reloadSessionDisabled?: boolean;
  reloadSessionPending?: boolean;
  onRefreshGit: () => void;
  workspaceHeaderState: WorkspaceHeaderState;
  isMacDesktop?: boolean;
  isMacFullscreen?: boolean;
  isWindowsDesktop?: boolean;
  simplifyForNarrowRemote?: boolean;
  selectedEditor: EditorInfo | null;
  compact?: boolean;
}

export interface WorkspaceHeaderActionSectionProps {
  variant?: WorkspaceHeaderVariant;
  activeTaskId?: string | null;
  user?: UserInfo | null;
  readOnlyReason?: string;
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  isDesktop?: boolean;
  isTerminalOpen: boolean;
  isSidePaneOpen: boolean;
  onToggleTerminal: () => void;
  onToggleSidePane: () => void;
  toggleSidePaneShortcutLabel?: string;
  onSelectedEditorChange?: (editor: EditorInfo | null) => void;
  simplifyForNarrowRemote?: boolean;
  hideHelpMenu?: boolean;
  showWindowControls?: boolean;
  useWindowsCaptionSpacing?: boolean;
}
