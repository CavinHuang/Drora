import type { McpUiAppCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpAppsDisplayMode,
  McpAppsHostTitleBar,
  McpAppsToolResultPayload,
  PluginSandboxHandle,
} from "@drora/shared/mcp-apps";
import type {
  PluginUiHostControllerDeps,
  PluginUiHostPhase,
  PluginUiHostScope,
} from "../app/pluginUiHostController.js";
import type { PluginUiPresentation } from "../contract.js";
export interface UsePluginUiHostInput {
  presentation: PluginUiPresentation;
  scope: PluginUiHostScope;
  theme: "light" | "dark";
  locale: string;
  displayMode: McpAppsDisplayMode;
  toolInput: Record<string, unknown> | undefined;
  toolResult: McpAppsToolResultPayload | undefined;
  /** 投喂的是哪次调用；变化（面板换到新一次调用）时把 toolInput 作为 tool-input 通知推给页面。 */
  toolCallId?: string;
  /** 宿主工具被停止；变为 true 时向页面发一次 tool-cancelled。 */
  toolCancelled?: boolean;
  hostVersion: string;
  /** 本实例真实可切换到的模式；缺省两种都可。变化时经 host-context-changed 通知页面。 */
  availableDisplayModes?: readonly McpAppsDisplayMode[];
  onDisplayModeRequest?: (mode: McpAppsDisplayMode) => McpAppsDisplayMode;
  onOpenExternal?: (url: string) => void;
  /** 容器宽度，用于 hostContext.containerDimensions；未知时 0。 */
  width: number;
  /** fullscreen 容器的头部；inline 不传。 */
  titleBar?: McpAppsHostTitleBar;
  /** false 时不创建沙箱（如侧栏已接管同一作用域）；默认 true。 */
  enabled?: boolean;
  /**
   * 会话交互回调：缺省时对应请求回 -32601，能力声明也不带该项。
   * g9 白名单动作（openConversationHandoff / directoryPicker / navigate）同规则：
   * 注入哪个宣告哪个；directoryPicker 有平台缺省实现（桌面 selectDirectory），无需调用方提供。
   */
  interactions?: Pick<
    PluginUiHostControllerDeps,
    | "onSendFollowUpMessage"
    | "onUpdateModelContext"
    | "onOpenConversationHandoff"
    | "onSelectDirectory"
    | "onNavigate"
  >;
}

export interface UsePluginUiHostResult {
  /** 平台或服务不支持插件 UI 时为 false，调用方回退到普通 MCP 卡片。 */
  pageKey: string;
  supported: boolean;
  phase: PluginUiHostPhase;
  handle: PluginSandboxHandle | null;
  height: number;
  error: string | null;
  /** 页面 `ui/initialize` 声明的能力；握手前 undefined，握手后至少为 {}。展示位置与模式请求均受此约束。 */
  appCapabilities: McpUiAppCapabilities | undefined;
  /** 销毁当前实例并重新 prepare（Agent 运行凭证换代）；guest 崩溃 / 加载失败后由错误态按钮触发。 */
  reload(): void;
}

export interface Page {
  readonly kind: "mcp";
  key: string;
  task: string;
  visible: boolean;
  snapshot(): UsePluginUiHostResult;
  subscribe(listener: () => void): () => void;
  start(): void;
  update(input: UsePluginUiHostInput): void;
  updateToolFeed(
    input: Pick<UsePluginUiHostInput, "toolCallId" | "toolInput" | "toolResult" | "toolCancelled">,
  ): void;
  bind(node: HTMLElement, sidebar: boolean): () => void;
  busy(): boolean;
  running(): boolean;
  suspend(force?: boolean): Promise<boolean>;
  /**
   * g9 宿主→面板 openWith（specs/obsidian-vault-phase2-true-extraction.md §6/§8）：
   * 转发到 controller.notifyOpenWith；页面未握手时由 controller 暂存补发。
   */
  notifyOpenWith(payload: unknown): void;
  destroy(): void;
}
