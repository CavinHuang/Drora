import type {
  CallToolResult,
  Implementation,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/client";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type {
  McpAppsDownloadFileItem,
  McpAppsNavigateParams,
  McpAppsOpenDirectoryPickerParams,
  McpAppsOpenDirectoryPickerResult,
} from "@drora/shared/mcp-apps";

/** `window.drora` / `window.openai` 的公开形状；实现在 aliasRuntime / openaiAlias，两边只依赖这里。 */
export interface DroraAliasApi {
  readonly toolInput: Record<string, unknown> | null;
  readonly toolOutput: unknown;
  readonly toolResponseMetadata: Record<string, unknown> | null;
  readonly toolCancelled: { reason?: string } | null;
  readonly theme: "light" | "dark" | null;
  readonly locale: string | null;
  readonly displayMode: McpUiDisplayMode | null;
  readonly maxHeight: number | null;
  readonly safeArea: McpUiHostContext["safeAreaInsets"] | null;
  readonly userAgent: string | null;
  /** 握手结果原样暴露（官方 SDK 的 getHostVersion / getHostCapabilities / getHostContext 同义）；握手前为 null。 */
  readonly hostInfo: Implementation | null;
  readonly hostCapabilities: McpUiHostCapabilities | null;
  readonly hostContext: McpUiHostContext | null;
  readonly protocolVersion: string | null;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  /** 读取同插件服务器的资源（MCP `resources/read`），结果与 MCP 同形；blob 为 base64。 */
  readResource(uri: string): Promise<ReadResourceResult>;
  listResources(input?: { cursor?: string }): Promise<ListResourcesResult>;
  listResourceTemplates(input?: { cursor?: string }): Promise<ListResourceTemplatesResult>;
  /**
   * 订阅资源变更（Drora 扩展，宿主宣告 `experimental["drora/resourceSubscribe"]`；server 须声明 resources.subscribe）。
   * 变更只带 uri，页面自行 readResource；沙箱销毁时宿主自动退订。
   */
  subscribeResource(uri: string): Promise<void>;
  unsubscribeResource(uri: string): Promise<void>;
  onResourceUpdated(listener: (uri: string) => void): () => void;
  onResourceListChanged(listener: () => void): () => void;
  requestDisplayMode(input: { mode: McpUiDisplayMode }): Promise<{ mode: McpUiDisplayMode }>;
  openExternal(input: { href: string }): void;
  /** 请求宿主保存文件（沙箱内 `<a download>` 被阻止）；任一取消 / 失败 resolve `{ isError: true }`。 */
  downloadFile(contents: McpAppsDownloadFileItem[]): Promise<{ isError?: boolean }>;
  notifyIntrinsicHeight(height: number): void;
  /** 界面状态：初值随握手经 hostContext 扩展键下发；setWidgetState 后本地立即可读。 */
  readonly widgetState: unknown;
  /**
   * Drora 扩展 `ui/set-widget-state`（宿主宣告 `experimental["drora/widgetState"]`）：宿主内存保存、会话内有效，
   * 不承诺跨进程恢复；宿主不可用时 reject -32601。要给模型信息走 updateModelContext。
   */
  setWidgetState(widgetState: unknown): Promise<void>;
  /** 以用户身份发送后续消息；宿主无用户手势时会弹确认框，用户取消则 reject。 */
  sendFollowUpMessage(input: {
    prompt: string;
    structuredContent?: Record<string, unknown>;
  }): Promise<void>;
  /** 附加到下一轮 prompt 的上下文（composer 里可见、可删）。 */
  updateModelContext(input: {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
  }): Promise<void>;
  /**
   * g9 宿主动作桥（specs/obsidian-vault-phase2-true-extraction.md §6/§8；宿主宣告
   * `experimental["drora/hostActions"].actions`，未宣告的动作 reject -32601）：
   * 把交接负载投递到当前会话 composer（与 updateModelContext 同一通道，来源标记独立）。
   */
  openConversationHandoff(input: {
    content: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
  }): Promise<void>;
  /** 宿主 renderer 原生目录选择对话框（configureVault 根目录选择）；用户取消 resolve `{ path: null }`。 */
  selectDirectory(input?: McpAppsOpenDirectoryPickerParams): Promise<McpAppsOpenDirectoryPickerResult>;
  /** 请求宿主导航到只读目标（P2 最小面：同插件清单声明的 surface 面板，payload 经 openWith 转交）。 */
  navigate(input: McpAppsNavigateParams): Promise<void>;
  /**
   * g9 宿主→面板：宿主经 `drora/openWith` 通知投递打开载荷（C5a citation 打开路由）。
   * 页面应在启动期注册，未注册时通知被 SDK 丢弃；握手前到达的载荷由宿主暂存到 initialized 后补发。
   */
  onOpenWith(listener: (payload: unknown) => void): () => void;
  /** 每次 tool-input / tool-result / tool-cancelled / host-context-changed / setWidgetState 后回调。 */
  subscribe(listener: () => void): () => void;
  /** 显式触发握手；不调用时任一成员首次被访问即触发。 */
  ready(): Promise<void>;
}

/** `window.openai` 兼容交集：兼容接口成员，全部转调同一实例；不支持的成员保持 undefined。 */
export interface OpenAiCompatApi {
  readonly toolInput: Record<string, unknown> | null;
  readonly toolOutput: unknown;
  readonly toolResponseMetadata: Record<string, unknown> | null;
  readonly widgetState: unknown;
  readonly theme: "light" | "dark" | null;
  readonly locale: string | null;
  readonly displayMode: McpUiDisplayMode | null;
  readonly maxHeight: number | null;
  readonly safeArea: McpUiHostContext["safeAreaInsets"] | null;
  readonly userAgent: string | null;
  setWidgetState(state: unknown): Promise<void>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  sendFollowUpMessage(input: { prompt: string }): Promise<void>;
  requestDisplayMode(input: { mode: McpUiDisplayMode }): Promise<{ mode: McpUiDisplayMode }>;
  openExternal(input: { href: string }): void;
  notifyIntrinsicHeight(height: number): void;
}
