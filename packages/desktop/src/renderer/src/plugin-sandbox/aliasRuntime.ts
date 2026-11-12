import type {
  CallToolResult,
  Implementation,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ReadResourceResult,
  RequestOptions,
  Transport,
} from "@modelcontextprotocol/client";
import { EmptyResultSchema, ListResourceTemplatesResultSchema } from "@modelcontextprotocol/core";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiToolCancelledNotification,
  McpUiToolInputNotification,
  McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";
import type {
  McpAppsDownloadFileItem,
  McpAppsNavigateParams,
  McpAppsOpenDirectoryPickerResult,
} from "@drora/shared/mcp-apps";
import {
  MCP_APPS_NAVIGATE_METHOD,
  MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
  MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
  MCP_APPS_OPEN_WITH_METHOD,
  MCP_APPS_SET_WIDGET_STATE_METHOD,
  MCP_APPS_WIDGET_STATE_CONTEXT_KEY,
  mcpAppsOpenDirectoryPickerResultSchema,
  mcpAppsOpenWithParamsSchema,
} from "@drora/shared/mcp-apps";
import type { OpenAiCompatApi, DroraAliasApi } from "./aliasApi.js";
import { createOpenAiCompatApi, readOpenAiGlobals } from "./openaiAlias.js";

/**
 * 插件 iframe 内 `window.drora` / `window.openai` 别名的运行时：官方 ext-apps `App` 上的薄封装，协议、握手、
 * 错误码全部来自 SDK，自己不持有 JSON-RPC。纯逻辑（消息经注入的 App 收发），alias.ts 负责接 DOM。
 *
 * 懒连接：别名脚本注入到每个插件页面，而用官方 SDK 自建 `App` 的页面（官方示例）不会碰 `window.drora`；
 * 首次访问任一成员才握手，避免同一页面对宿主发两次 ui/initialize。
 */
export interface AliasAppLike {
  connect(transport?: Transport, options?: RequestOptions): Promise<void>;
  getHostVersion(): Implementation | undefined;
  getHostCapabilities(): McpUiHostCapabilities | undefined;
  getHostContext(): McpUiHostContext | undefined;
  ontoolinput: ((params: McpUiToolInputNotification["params"]) => void) | undefined;
  ontoolresult: ((params: McpUiToolResultNotification["params"]) => void) | undefined;
  ontoolcancelled: ((params: McpUiToolCancelledNotification["params"]) => void) | undefined;
  onhostcontextchanged: ((params: McpUiHostContext) => void) | undefined;
  callServerTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<CallToolResult>;
  readServerResource(params: { uri: string }): Promise<ReadResourceResult>;
  listServerResources(params?: { cursor?: string }): Promise<ListResourcesResult>;
  /** 规范方法（resources/templates/list、resources/subscribe…）与 Drora 扩展方法走基类 request。 */
  request(
    request: { method: string; params?: Record<string, unknown> },
    resultSchema: unknown,
  ): Promise<unknown>;
  setNotificationHandler(
    method: "notifications/resources/updated" | "notifications/resources/list_changed",
    handler: (notification: { params?: { uri?: string } }) => void,
  ): void;
  /**
   * Drora 扩展通知（g9 `drora/openWith`）：官方 SDK 对非 spec 方法只接受
   * 「schemas 二参 + handler 三参」形式（一参形式会抛 "not a spec notification method"）。
   */
  setNotificationHandler(
    method: "drora/openWith",
    schemas: { params: unknown },
    handler: (params: { payload?: unknown }, notification: unknown) => void,
  ): void;
  openLink(params: { url: string }): Promise<unknown>;
  requestDisplayMode(params: { mode: McpUiDisplayMode }): Promise<{ mode: McpUiDisplayMode }>;
  sendSizeChanged(params: { width?: number; height?: number }): Promise<void>;
  sendMessage(params: {
    role: "user";
    content: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
  updateModelContext(params: {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
  downloadFile(params: { contents: McpAppsDownloadFileItem[] }): Promise<{ isError?: boolean }>;
}

export const DRORA_GLOBALS_EVENT = "drora:globals";

export interface PluginSandboxAliasRuntime {
  drora: DroraAliasApi;
  openai: OpenAiCompatApi;
  /** 是否已经（或正在）握手；诊断用。 */
  readonly connecting: boolean;
  /**
   * 页面自建的官方 `App` 已在与宿主通信（别名尚未握手前就看到宿主发来的 JSON-RPC）：别名放弃握手。
   * 同一页面两个 `App` 共用一条 postMessage 通道会撞请求 id（都从 0 起）并让宿主收到两次 initialized。
   */
  markForeignApp(): void;
}

export function createPluginSandboxAliasRuntime(options: {
  app: AliasAppLike;
  /** 官方 App 的 connect 缺省用 window.parent 的 PostMessageTransport；这里注入以便控制目标窗口。 */
  transport?: Transport;
  protocolVersion: string;
  onChange?: (globals: Record<string, unknown>) => void;
}): PluginSandboxAliasRuntime {
  const { app } = options;
  let toolInput: Record<string, unknown> | null = null;
  let toolOutput: unknown = null;
  let toolResponseMetadata: Record<string, unknown> | null = null;
  let toolCancelled: { reason?: string } | null = null;
  let widgetState: unknown = null;
  let widgetStateSeeded = false;
  let connectPromise: Promise<void> | null = null;
  let foreignApp = false;
  const listeners = new Set<() => void>();
  const resourceUpdatedListeners = new Set<(uri: string) => void>();
  const resourceListChangedListeners = new Set<() => void>();
  // g9：宿主→面板 openWith 载荷监听（命令语义，页面启动期注册）。
  const openWithListeners = new Set<(payload: unknown) => void>();

  const notify = () => {
    for (const listener of listeners) listener();
    options.onChange?.(readOpenAiGlobals(openai));
  };

  app.ontoolinput = (params) => {
    toolInput = params.arguments ?? {};
    notify();
  };
  app.ontoolresult = (params) => {
    toolOutput = params.structuredContent ?? null;
    toolResponseMetadata = (params._meta as Record<string, unknown> | undefined) ?? null;
    notify();
  };
  app.ontoolcancelled = (params) => {
    toolCancelled = params.reason ? { reason: params.reason } : {};
    notify();
  };
  app.onhostcontextchanged = () => notify();
  app.setNotificationHandler("notifications/resources/updated", (notification) => {
    const uri = notification.params?.uri;
    if (typeof uri !== "string") return;
    for (const listener of resourceUpdatedListeners) listener(uri);
  });
  app.setNotificationHandler("notifications/resources/list_changed", () => {
    for (const listener of resourceListChangedListeners) listener();
  });
  // g9：宿主经 `drora/openWith` 通知投递打开载荷（C5a citation 打开路由）；未注册监听时静默丢弃。
  // `drora/openWith` 非 spec 方法，必须走 schemas 三参形式（SDK 对一参形式只放行 spec 方法）。
  app.setNotificationHandler(
    MCP_APPS_OPEN_WITH_METHOD,
    { params: mcpAppsOpenWithParamsSchema },
    (params) => {
      for (const listener of openWithListeners) listener(params?.payload);
    },
  );

  /** 失败只记录一次，后续访问不重试（与页面自建 App 的失败语义一致）。 */
  const ready = (): Promise<void> => {
    if (foreignApp && !connectPromise) {
      return Promise.reject(
        new Error(
          "window.drora is unavailable: this page already connected its own MCP Apps App; use it directly",
        ),
      );
    }
    if (!connectPromise) {
      connectPromise = app.connect(options.transport).then(
        () => {
          // widgetState 初值随握手经 hostContext 扩展键下发（宿主只在创建桥时带一次）。
          if (!widgetStateSeeded) {
            widgetStateSeeded = true;
            const seeded = (app.getHostContext() as Record<string, unknown> | undefined)?.[
              MCP_APPS_WIDGET_STATE_CONTEXT_KEY
            ];
            if (seeded !== undefined) widgetState = seeded;
          }
          notify();
        },
        (error) => {
          console.warn("[plugin-sandbox-alias] connect failed", error);
          throw error;
        },
      );
    }
    return connectPromise;
  };
  const whenReady = <T>(run: () => Promise<T>): Promise<T> => ready().then(run);

  const hostContext = () => app.getHostContext() ?? null;
  const droraTarget: DroraAliasApi = {
    get toolInput() {
      return toolInput;
    },
    get toolOutput() {
      return toolOutput;
    },
    get toolResponseMetadata() {
      return toolResponseMetadata;
    },
    get toolCancelled() {
      return toolCancelled;
    },
    get theme() {
      return hostContext()?.theme ?? null;
    },
    get locale() {
      return hostContext()?.locale ?? null;
    },
    get displayMode() {
      return hostContext()?.displayMode ?? null;
    },
    get maxHeight() {
      // SDK 把 containerDimensions 建成 height|maxHeight 的联合，两个分支都可能带值，按对象读。
      const dimensions = hostContext()?.containerDimensions as
        | { height?: number; maxHeight?: number }
        | undefined;
      return dimensions?.maxHeight ?? dimensions?.height ?? null;
    },
    get safeArea() {
      return hostContext()?.safeAreaInsets ?? null;
    },
    get userAgent() {
      return hostContext()?.userAgent ?? null;
    },
    get hostInfo() {
      return app.getHostVersion() ?? null;
    },
    get hostCapabilities() {
      return app.getHostCapabilities() ?? null;
    },
    get hostContext() {
      return hostContext();
    },
    get protocolVersion() {
      return app.getHostVersion() ? options.protocolVersion : null;
    },
    callTool: (name, args) =>
      whenReady(() => app.callServerTool({ name, ...(args ? { arguments: args } : {}) })),
    readResource: (uri) => whenReady(() => app.readServerResource({ uri })),
    listResources: (input) =>
      whenReady(() => app.listServerResources(input?.cursor ? { cursor: input.cursor } : {})),
    listResourceTemplates: (input) =>
      whenReady(
        () =>
          app.request(
            {
              method: "resources/templates/list",
              params: input?.cursor ? { cursor: input.cursor } : {},
            },
            ListResourceTemplatesResultSchema,
          ) as Promise<ListResourceTemplatesResult>,
      ),
    subscribeResource: (uri) =>
      whenReady(() =>
        app.request({ method: "resources/subscribe", params: { uri } }, EmptyResultSchema),
      ).then(() => undefined),
    unsubscribeResource: (uri) =>
      whenReady(() =>
        app.request({ method: "resources/unsubscribe", params: { uri } }, EmptyResultSchema),
      ).then(() => undefined),
    onResourceUpdated(listener) {
      resourceUpdatedListeners.add(listener);
      return () => resourceUpdatedListeners.delete(listener);
    },
    onResourceListChanged(listener) {
      resourceListChangedListeners.add(listener);
      return () => resourceListChangedListeners.delete(listener);
    },
    requestDisplayMode: (input) => whenReady(() => app.requestDisplayMode(input)),
    openExternal(input) {
      void whenReady(() => app.openLink({ url: input.href })).catch(() => undefined);
    },
    downloadFile: (contents) => whenReady(() => app.downloadFile({ contents })),
    notifyIntrinsicHeight(height) {
      void whenReady(() => app.sendSizeChanged({ height })).catch(() => undefined);
    },
    get widgetState() {
      return widgetState;
    },
    setWidgetState(state) {
      widgetState = state;
      notify();
      return whenReady(() =>
        app.request(
          { method: MCP_APPS_SET_WIDGET_STATE_METHOD, params: { widgetState: state } },
          EmptyResultSchema,
        ),
      ).then(() => undefined);
    },
    sendFollowUpMessage: (input) =>
      whenReady(() =>
        app.sendMessage({
          role: "user",
          content: [{ type: "text", text: input.prompt }],
          ...(input.structuredContent ? { structuredContent: input.structuredContent } : {}),
        }),
      ).then(() => undefined),
    updateModelContext: (input) =>
      whenReady(() =>
        app.updateModelContext({
          ...(input.content ? { content: input.content } : {}),
          ...(input.structuredContent ? { structuredContent: input.structuredContent } : {}),
        }),
      ).then(() => undefined),
    // g9 宿主动作桥（specs/obsidian-vault-phase2-true-extraction.md §6/§8）：三个白名单动作
    // 均走官方 App 的扩展 request（与 ui/set-widget-state 同一通道，无新传输）；宿主未接
    // handler 时 SDK 回 -32601，页面据此走降级路径（D10）。
    openConversationHandoff: (input) =>
      whenReady(() =>
        app.request(
          {
            method: MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
            params: {
              content: input.content,
              ...(input.structuredContent !== undefined
                ? { structuredContent: input.structuredContent }
                : {}),
            },
          },
          EmptyResultSchema,
        ),
      ).then(() => undefined),
    selectDirectory: (input) =>
      whenReady(() =>
        app.request(
          {
            method: MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
            ...(input?.title !== undefined ? { params: { title: input.title } } : {}),
          },
          mcpAppsOpenDirectoryPickerResultSchema,
        ),
      ).then((result) => {
        // 宿主回 `{ path: string | null }`；schema 之外的读取保持防御（未知宿主回空对象）。
        const path = (result as { path?: unknown } | undefined)?.path;
        return typeof path === "string" ? { path } : { path: null };
      }) as Promise<McpAppsOpenDirectoryPickerResult>,
    navigate: (input: McpAppsNavigateParams) =>
      whenReady(() =>
        app.request(
          {
            method: MCP_APPS_NAVIGATE_METHOD,
            params: {
              kind: "surface",
              surfaceId: input.surfaceId,
              ...(input.payload !== undefined ? { payload: input.payload } : {}),
            },
          },
          EmptyResultSchema,
        ),
      ).then(() => undefined),
    onOpenWith(listener: (payload: unknown) => void) {
      openWithListeners.add(listener);
      return () => {
        openWithListeners.delete(listener);
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready,
  };
  // 任一成员首次被访问即触发握手（读 toolInput 也算：页面通常先读再等事件）。
  const lazy = <T extends object>(target: T): T =>
    new Proxy(Object.freeze(target), {
      get(object, key, receiver) {
        if (typeof key === "string") void ready().catch(() => undefined);
        return Reflect.get(object, key, receiver);
      },
    });
  const drora = lazy(droraTarget);
  const openai = lazy(createOpenAiCompatApi(droraTarget));

  return {
    drora,
    openai,
    get connecting() {
      return connectPromise !== null;
    },
    markForeignApp() {
      if (!connectPromise) foreignApp = true;
    },
  };
}
