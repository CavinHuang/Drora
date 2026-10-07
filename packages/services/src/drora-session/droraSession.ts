import { ServiceChannels } from "@drora/shared";
import type {
  TraceId,
  DroraAgentMcpServer,
  DroraDeliveryKind,
  DroraMessageWithParts,
  ModelSelection,
  DroraPermissionRequestParams,
  DroraUserInputRequestParams,
  DroraUserInputResponse,
  DroraSessionInfo,
  DroraSessionImportHistory,
  DroraSessionEvent,
  DroraSessionMode,
  DroraSessionPersistence,
  DroraSessionStateSnapshot,
  DroraStateUpdatedNotification,
  DroraWorkspacePresentation,
} from "@drora/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface DroraSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type DroraSessionReadWorkspacePresentationParams = DroraSessionWorkspaceTarget;

export interface DroraTaskTarget extends DroraSessionWorkspaceTarget {
  sessionId: string;
}

export interface DroraSessionCreateParams extends DroraSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: DroraSessionMode;
  model?: ModelSelection;
  persistence?: DroraSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: DroraAgentMcpServer[];
  importedHistory?: DroraSessionImportHistory;
}

export interface DroraSessionResumeParams extends DroraTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: DroraAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface DroraSessionListParams extends DroraSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface DroraSessionReadParams extends DroraTaskTarget {
  deliveryKind?: DroraDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface DroraSessionMessagesParams extends DroraTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface DroraSessionEventsParams extends DroraTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface DroraSessionSetModelParams extends DroraTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface DroraSessionSetThoughtLevelParams extends DroraTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface DroraSessionSetModeParams extends DroraTaskTarget {
  mode: DroraSessionMode;
  expectedRevision?: number;
}

export interface DroraSessionSubscribeParams extends DroraTaskTarget {
  deliveryKind: DroraDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type DroraSessionServiceEvent =
  | { type: "session.event"; event: DroraSessionEvent }
  | { type: "state.updated"; notification: DroraStateUpdatedNotification }
  | { type: "permission.request"; request: DroraPermissionRequestParams }
  | { type: "userInput.request"; request: DroraUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: DroraUserInputResponse;
    }
  | { type: "snapshot"; snapshot: DroraSessionStateSnapshot };

export interface DroraSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface DroraSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IDroraSessionService {
  initializeWorkspace(params: DroraSessionWorkspaceTarget): Promise<DroraSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: DroraSessionWorkspaceTarget,
  ): Promise<DroraSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: DroraSessionReadWorkspacePresentationParams,
  ): Promise<DroraWorkspacePresentation>;
  createSession(params: DroraSessionCreateParams): Promise<DroraSessionStateSnapshot>;
  resumeSession(params: DroraSessionResumeParams): Promise<DroraSessionStateSnapshot>;
  listSessions(params: DroraSessionListParams): Promise<DroraSessionInfo[]>;
  readSession(params: DroraSessionReadParams): Promise<DroraSessionStateSnapshot>;
  readSessionMessages(params: DroraSessionMessagesParams): Promise<DroraMessageWithParts[]>;
  readSessionEvents(params: DroraSessionEventsParams): Promise<DroraSessionEvent[]>;
  promoteDeferredDraftSession(params: DroraTaskTarget): Promise<void>;
  closeSession(params: DroraTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: DroraTaskTarget): Promise<boolean>;
  setModel(params: DroraSessionSetModelParams): Promise<DroraSessionStateSnapshot>;
  setThoughtLevel(params: DroraSessionSetThoughtLevelParams): Promise<DroraSessionStateSnapshot>;
  setMode(params: DroraSessionSetModeParams): Promise<DroraSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IDroraSessionService = createServiceDescriptor<IDroraSessionService>(
  ServiceChannels.DroraSession,
);
