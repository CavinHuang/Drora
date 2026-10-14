import type {
  ModelSelection,
  DroraAgentMcpServer,
  DroraAutomationScheduleRule,
  DroraMcpListMode,
} from "@drora/shared";
import type { McpAppsAppToolCallResult, McpAppsAppToolDescriptor } from "@drora/shared/mcp-apps";

export interface DroraAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface DroraAgentPluginViewParams extends DroraAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface DroraAgentListMcpServerStatusesParams extends DroraAgentWorkspaceTarget {
  mcpServers?: DroraAgentMcpServer[];
  mode?: DroraMcpListMode;
}

export interface DroraAgentAddPluginMarketplaceParams extends DroraAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface DroraAgentRemovePluginMarketplaceParams extends DroraAgentWorkspaceTarget {
  marketplace: string;
}

export interface DroraAgentUpdatePluginMarketplaceParams extends DroraAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface DroraAgentInstallPluginParams extends DroraAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface DroraAgentCancelPluginOperationParams {
  operationId: string;
}

export interface DroraAgentUninstallPluginParams extends DroraAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface DroraAgentUpdatePluginParams extends DroraAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface DroraAgentRestoreBuiltinPluginParams extends DroraAgentWorkspaceTarget {
  pluginId: string;
}

export interface DroraAgentConfigurePluginParams extends DroraAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface DroraAgentResetPluginConfigParams extends DroraAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface DroraAgentValidatePluginParams extends DroraAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface DroraAgentDescribePluginParams extends DroraAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface DroraAgentSetPluginEnabledParams extends DroraAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface DroraAgentPluginReferenceCatalogParams extends DroraAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface DroraAgentSkillReferenceCatalogParams extends DroraAgentWorkspaceTarget {
  sessionId?: string;
}

/** 插件 UI：UI 发起的 `ui://` 资源读取。 */
export interface DroraAgentReadMcpResourceParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  uri: string;
}

/** 插件 UI 页面发起的 `resources/read`；参数与 readMcpResource 同形，结果受 8 MiB 与 mimeType 白名单约束。 */
export type DroraAgentReadMcpResourceForUiParams = DroraAgentReadMcpResourceParams;

/** 插件 UI：UI 回调本插件工具；不进审批流，归属由 agent 侧 catalog fail closed。 */
export interface DroraAgentCallMcpToolForUiParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  /** 宿主生成的调用 id，配合 cancelMcpToolCallForUi。 */
  callId: string;
}
/** 插件 UI 页面发起的 resources/list、resources/templates/list、subscribe、unsubscribe。 */
export interface DroraAgentListMcpResourcesForUiParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  cursor?: string;
}
/** App-Provided Tools：实例身份 = 会话 + 沙箱作用域 + 代际。 */
export interface DroraAgentAppToolInstanceForUiParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  generation: number;
}
export interface DroraAgentRegisterAppToolsForUiParams extends DroraAgentAppToolInstanceForUiParams {
  tools: McpAppsAppToolDescriptor[];
}
export interface DroraAgentAppToolCallForUiParams extends DroraAgentAppToolInstanceForUiParams {
  callId: string;
}
export interface DroraAgentResolveAppToolCallForUiParams extends DroraAgentAppToolCallForUiParams {
  result?: McpAppsAppToolCallResult;
  error?: { message: string };
}
export interface DroraAgentMcpResourceSubscriptionForUiParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  generation: number;
  uri: string;
}
export interface DroraAgentCancelMcpToolCallForUiParams extends DroraAgentWorkspaceTarget {
  instance: import("@drora/shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  callId: string;
}
export interface DroraAgentResolveSuggestedPluginReferenceParams extends DroraAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface DroraAgentCreateAutomationParams extends DroraAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: DroraAutomationScheduleRule;
}

export interface DroraAgentUpdateAutomationParams extends DroraAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: DroraAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface DroraAgentAutomationIdParams extends DroraAgentWorkspaceTarget {
  automationId: string;
}

export interface DroraAgentSetAutomationEnabledParams extends DroraAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface DroraAgentDeleteAutomationRunParams extends DroraAgentWorkspaceTarget {
  runId: string;
}
