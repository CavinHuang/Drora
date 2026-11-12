import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY,
  MCP_APPS_NESTED_FRAMES_EXPERIMENTAL_KEY,
  MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY,
  MCP_APPS_SURFACE_EXPERIMENTAL_KEY,
  MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY,
  buildMcpAppsCspExperimentalCapability,
  type McpAppsHostActionName,
} from "@drora/shared/mcp-apps";

/** 宿主实例真实可用的交互；缺省项对应的能力不声明，插件据此降级。 */
export interface PluginUiHostCapabilityInput {
  canSample?: boolean;
  canSendFollowUpMessage: boolean;
  canUpdateModelContext: boolean;
  canSetWidgetState: boolean;
  /** 宿主能代理 resources/subscribe 并把 server 通知路由回本实例。 */
  canSubscribeResources: boolean;
  /** 平台有 saveFile（桌面）才声明 downloadFile。 */
  canDownloadFile: boolean;
  /**
   * g9 页面→宿主白名单动作（specs/obsidian-vault-phase2-true-extraction.md §6/§8）：
   * 只列真实接了 handler 的动作；空数组 / 缺省不宣告，页面据此回退降级路径（D10）。
   */
  hostActions?: readonly McpAppsHostActionName[];
  /** 常驻面板实例：宣告 `experimental["drora/surface"]: { id }`，页面据此判断自己运行在面板里。 */
  surfaceId?: string;
  /** 窗口恢复键，仅接受宿主派生的不透明摘要。 */
  surfaceStateKey?: string;
}

/**
 * hostCapabilities 的唯一构造点。声明与 handler 一一对应：没有会话动作绑定就不声明 message，没有 composer 就不声明
 * updateModelContext。Drora 扩展（widgetState、resourceSubscribe、surface、csp 放宽、nestedFrames）一律放 `experimental["drora/…"]`，
 * 官方 SDK 的 zod 会剥掉标准位之外的未知能力键。
 */
export function buildPluginUiHostCapabilities(
  input: PluginUiHostCapabilityInput,
): McpUiHostCapabilities {
  return {
    openLinks: {},
    serverTools: {},
    serverResources: input.canSubscribeResources ? { listChanged: true } : {},
    logging: {},
    ...(input.canSample ? { sampling: {} } : {}),
    ...(input.canDownloadFile ? { downloadFile: {} } : {}),
    // image 随 text 一起声明（png / jpeg / webp，单张 ≤ 4 MiB）。
    ...(input.canSendFollowUpMessage ? { message: { text: {}, image: {} } } : {}),
    ...(input.canUpdateModelContext
      ? { updateModelContext: { text: {}, structuredContent: {}, image: {} } }
      : {}),
    experimental: {
      ...buildMcpAppsCspExperimentalCapability(),
      [MCP_APPS_NESTED_FRAMES_EXPERIMENTAL_KEY]: {},
      ...(input.canSetWidgetState ? { [MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY]: {} } : {}),
      ...(input.canSubscribeResources
        ? { [MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY]: {} }
        : {}),
      // g9：宿主动作桥只宣告真实接了 handler 的动作（与 message / updateModelContext 同一
      // 「声明与 handler 一一对应」纪律）；白名单外动作由 SDK 回 -32601。
      ...(input.hostActions?.length
        ? { [MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY]: { actions: [...input.hostActions] } }
        : {}),
      ...(input.surfaceId
        ? {
            [MCP_APPS_SURFACE_EXPERIMENTAL_KEY]: {
              id: input.surfaceId,
              stateKey: input.surfaceStateKey,
            },
          }
        : {}),
    },
  };
}
