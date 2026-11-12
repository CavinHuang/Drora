/**
 * g4/g9 平台扩展契约（specs/obsidian-vault-phase2-true-extraction.md §2/§6/§8/§10-P2）。
 * 从 contract.ts 拆出（契约文件行数上限 300）：键常量与方法名在此单一出处；生产方（本体
 * renderer plugin-ui）与消费方（沙箱页面 alias）都经 index.ts 引用这里，运行时校验 schema
 * 在同目录 schemas.ts。
 */

/**
 * g4：hostContext 只读扩展键 `drora/locale` / `drora/theme`。官方 hostContext 标准位已有
 * theme/locale（宿主本就填充并随 host-context-changed 更新），这两个 Drora 键是 spec 裁定的
 * 显式只读声明：值与标准位同源（`buildPluginUiHostContext` 唯一构造点同步写入），页面只读——
 * 沙箱 alias 不提供任何写回成员，宿主也不接受页面提交主题/locale（防回环：宿主 UI store 是
 * 唯一所有者）。面板页面按需 feature detect，旧宿主不携带则走页面内自管切换兜底。
 */
export const MCP_APPS_LOCALE_CONTEXT_KEY = "drora/locale";
export const MCP_APPS_THEME_CONTEXT_KEY = "drora/theme";

/** g9 页面→宿主白名单动作：把交接负载投递到当前会话 composer（updateModelContext 同一投递通道先例扩展）。 */
export const MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD = "drora/openConversationHandoff";
/** g9 页面→宿主白名单动作：宿主 renderer 原生目录选择对话框（configureVault 根目录选择，§3 映射）。 */
export const MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD = "drora/openDirectoryPicker";
/**
 * g9 页面→宿主白名单动作：请求宿主导航到只读目标。P2 最小面只支持 `kind:"surface"`
 * （打开/聚焦同插件清单声明的面板 tab，payload 经 openWith 通知转交目标面板）；
 * 不开放任意 URL / 文件系统导航（§8 白名单最小面，不绕权限系统）。
 */
export const MCP_APPS_NAVIGATE_METHOD = "drora/navigate";
/** g9 宿主→面板方向：`drora/openWith { payload }` 通知（C5a citation 打开路由，宿主携带 receiptId 等载荷）。 */
export const MCP_APPS_OPEN_WITH_METHOD = "drora/openWith";

/** g9 页面→宿主白名单动作名（方法名去掉 `drora/` 前缀的稳定序）。 */
export const MCP_APPS_HOST_ACTION_NAMES = [
  "openConversationHandoff",
  "openDirectoryPicker",
  "navigate",
] as const;
export type McpAppsHostActionName = (typeof MCP_APPS_HOST_ACTION_NAMES)[number];

/**
 * hostCapabilities.experimental 宣告键：值 `{ actions: [...] }` 只列宿主真实接了 handler 的动作
 * （声明与 handler 一一对应，与 message/updateModelContext 同一纪律）；页面据此 feature detect，
 * 未列出的动作请求会得到 -32601。
 */
export const MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY = "drora/hostActions";

/** `drora/openWith` 通知的 params 形状；payload 语义由目标插件面板自定义（透传，宿主不解释）。 */
export interface McpAppsOpenWithParams {
  payload?: unknown;
}
/** `drora/navigate` 请求的 params 形状（P2 最小面：仅 surface 目标）。 */
export interface McpAppsNavigateParams {
  kind: "surface";
  /** 目标面板的清单 `ui.surfaces[].id`；仅接受同插件声明的 surface（宿主解析清单校验）。 */
  surfaceId: string;
  /** 随导航转交给目标面板的 openWith 载荷（透传）。 */
  payload?: unknown;
}
/** `drora/openDirectoryPicker` 的 params / result 形状（用户取消时 path 为 null）。 */
export interface McpAppsOpenDirectoryPickerParams {
  title?: string;
}
export interface McpAppsOpenDirectoryPickerResult {
  path: string | null;
}
