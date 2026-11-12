/**
 * Vault 面板宿主桥（specs/obsidian-vault-phase2-true-extraction.md §2/§6/§10-P5）。
 *
 * 单一 App 连接（ext-apps 官方 SDK，drora-site/office 同款纪律）：
 * - 数据通道：`resources/read`（mcp/uiReadResource，无审批、8 MiB、MIME 白名单）——
 *   只读面板全部数据经此，见 src/mcp/uiResources.ts 文件头论证；
 * - g9 双向动作桥（P2 落地）：页面→宿主 openConversationHandoff / openDirectoryPicker；
 *   宿主→面板 openWith 通知在 connect 前注册（SDK 未注册即丢弃，CONTRACT.md:13）；
 * - g4 locale/theme：hostContext 标准位 + `drora/theme`/`drora/locale` 只读键同源
 *   （buildPluginUiHostContext 唯一构造点），页面只读不回写（防回环）；
 * - 草稿：`ui/set-widget-state` 落宿主内存，重建时经 hostContext 下发（后台回收草稿
 *   保护的服务端持久化形态随写操作面另批，D13 保守缺省）。
 */
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import {
  MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY,
  MCP_APPS_LOCALE_CONTEXT_KEY,
  MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
  MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
  MCP_APPS_OPEN_WITH_METHOD,
  MCP_APPS_THEME_CONTEXT_KEY,
  MCP_APPS_WIDGET_STATE_CONTEXT_KEY,
  mcpAppsOpenDirectoryPickerResultSchema,
  mcpAppsOpenWithParamsSchema,
} from "@drora/shared/mcp-apps";
import type { UiDataResult } from "./model.js";

/** 面板数据端点前缀（与 server src/mcp/uiResources.ts 同值；URI 空间两侧共用的部署副本）。 */
const UI_DATA_PREFIX = "ui://obsidian/data/";

export type OpenWithListener = (payload: unknown) => void;

export interface VaultPanelHost {
  context(): McpUiHostContext | undefined;
  /** g9 宿主动作能力宣告（experimental["drora/hostActions"].actions）；旧宿主缺省 undefined。 */
  hostActionNames(): readonly string[] | undefined;
  readData<T>(endpoint: string, params?: Record<string, string | number>): Promise<UiDataResult<T>>;
  /** 握手下发的初始 widgetState（含草稿；旧宿主 / 首次为 undefined）。 */
  initialWidgetState(): unknown;
  /** 草稿写宿主内存 store（ui/set-widget-state）；旧宿主不认时静默丢弃（site 同款回退）。 */
  saveDraft(draft: unknown): void;
  selectDirectory(title: string): Promise<{ path: string | null } | { error: string }>;
  openConversationHandoff(text: string): Promise<void>;
  /** g9 宿主→面板 openWith（启动期注册，connect 前生效）。 */
  onOpenWith(listener: OpenWithListener): void;
  theme(): "light" | "dark" | undefined;
  locale(): string | undefined;
}

export async function connectPanelHost(onContextChange: () => void): Promise<VaultPanelHost> {
  // §2 display modes：面板型页面只声明 fullscreen（inline 不适用）。不声明 tools
  // 能力——面板不提供 app-provided tools（office capture_view 先例是另一形态）。
  const app = new App(
    { name: "obsidian-vault-panel", version: "1" },
    { availableDisplayModes: ["fullscreen"] },
    { autoResize: false },
  );

  // openWith 通知必须启动期注册：SDK 对未注册的通知直接丢弃（P2 落地语义）。
  const openWithListeners = new Set<OpenWithListener>();
  app.setNotificationHandler(
    MCP_APPS_OPEN_WITH_METHOD,
    { params: mcpAppsOpenWithParamsSchema },
    (params: { payload?: unknown }) => {
      for (const listener of openWithListeners) listener(params?.payload);
    },
  );

  app.onhostcontextchanged = () => {
    applyContext(app.getHostContext());
    onContextChange();
  };
  await app.connect();
  applyContext(app.getHostContext());

  return {
    context: () => app.getHostContext(),
    hostActionNames: () => {
      const experimental = app.getHostCapabilities()?.experimental as
        | Record<string, { actions?: string[] } | undefined>
        | undefined;
      return experimental?.[MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY]?.actions;
    },
    async readData<T>(endpoint: string, params?: Record<string, string | number>) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params ?? {})) {
        search.set(key, String(value));
      }
      const suffix = search.size > 0 ? `?${search.toString()}` : "";
      try {
        const result = await app.readServerResource({ uri: `${UI_DATA_PREFIX}${endpoint}${suffix}` });
        const content = result.contents[0];
        const parsed: unknown =
          content && "text" in content ? JSON.parse(content.text) : undefined;
        if (isUiDataResult(parsed)) return parsed as UiDataResult<T>;
      } catch {
        // 统一按网络错误封套：页面走重试/降级呈现（site read 同款纪律）。
      }
      return { ok: false, error: { code: "network", message: "resource read failed" } };
    },
    initialWidgetState: () => app.getHostContext()?.[MCP_APPS_WIDGET_STATE_CONTEXT_KEY],
    saveDraft(draft) {
      void app
        .request({ method: "ui/set-widget-state", params: { widgetState: draft } }, EmptyResultSchema)
        .catch(() => {
          /* 旧宿主不认扩展方法：草稿仅存活于页面内存（重开回到默认视图）。 */
        });
    },
    async selectDirectory(title) {
      try {
        return await app.request(
          { method: MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD, params: { title } },
          mcpAppsOpenDirectoryPickerResultSchema,
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    async openConversationHandoff(text) {
      await app.request(
        {
          method: MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
          params: { content: [{ type: "text", text }] },
        },
        EmptyResultSchema,
      );
    },
    onOpenWith(listener) {
      openWithListeners.add(listener);
    },
    theme() {
      const context = app.getHostContext();
      if (!context) return undefined;
      // g4：Drora 只读键与标准位同源；Drora 键优先（显式声明），缺省回落标准位。
      const explicit = context[MCP_APPS_THEME_CONTEXT_KEY];
      return explicit === "light" || explicit === "dark" ? explicit : context.theme ?? undefined;
    },
    locale() {
      const context = app.getHostContext();
      if (!context) return undefined;
      const explicit = context[MCP_APPS_LOCALE_CONTEXT_KEY];
      return typeof explicit === "string" && explicit ? explicit : context.locale ?? undefined;
    },
  };
}

/** server uiResources 统一封套判形（ok 布尔 + data/error 二选一）。 */
function isUiDataResult(value: unknown): value is UiDataResult<unknown> {
  return typeof value === "object" && value !== null && "ok" in value;
}

function applyContext(context: McpUiHostContext | undefined): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
