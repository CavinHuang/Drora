import { METHOD_NOT_FOUND, ProtocolError } from "@modelcontextprotocol/client";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { McpUiMessageResultSchema } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpAppsDownloadFileItem,
  McpAppsNavigateParams,
  McpAppsOpenDirectoryPickerParams,
  McpAppsOpenDirectoryPickerResult,
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
} from "@drora/shared/mcp-apps";
import {
  MCP_APPS_NAVIGATE_METHOD,
  MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
  MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
  MCP_APPS_SET_WIDGET_STATE_METHOD,
  concatMcpAppsTextContent,
  mcpAppsNavigateParamsSchema,
  mcpAppsOpenConversationHandoffParamsSchema,
  mcpAppsOpenDirectoryPickerParamsSchema,
  mcpAppsOpenDirectoryPickerResultSchema,
} from "@drora/shared/mcp-apps";
import { z } from "zod";
import type { PluginUiHostBridge } from "./pluginUiHostBridge.js";

/** 宿主实例注入的交互回调；缺省时对应请求回 -32601（能力声明与回调一一对应）。 */
export interface PluginUiInteractionCallbacks {
  /** sendFollowUpMessage 返回 reject 表示用户取消或无权限。 */
  onSendFollowUpMessage?(
    payload: {
      prompt: string;
      content?: Array<Record<string, unknown>>;
      structuredContent?: unknown;
    },
    context: { consumeUserGesture(): Promise<boolean>; assertCurrent(): void },
  ): Promise<void>;
  onUpdateModelContext?(payload: {
    content: Array<Record<string, unknown>>;
    structuredContent?: unknown;
  }): Promise<void>;
  /** 页面 `ui/set-widget-state { widgetState }`；宿主同步写内存 store 后回包。 */
  onUpdateWidgetState?(widgetState: unknown): Promise<void>;
  /** `ui/download-file`；逐项保存，取消 / 失败回 `{ isError: true }`。 */
  onDownloadFile?(contents: McpAppsDownloadFileItem[]): Promise<{ isError?: boolean }>;
  /**
   * g9 白名单动作 `drora/openConversationHandoff`（specs/obsidian-vault-phase2-true-extraction.md
   * §6/§8）：页面把交接负载投递到当前会话 composer。与 ui/update-model-context 同一投递通道
   * （CONTRACT.md:20 先例），只是来源标记独立，不进数据库状态。
   */
  onOpenConversationHandoff?(payload: {
    content: Array<Record<string, unknown>>;
    structuredContent?: unknown;
  }): Promise<void>;
  /**
   * g9 白名单动作 `drora/openDirectoryPicker`：宿主 renderer 原生目录选择对话框（沙箱页面无文件
   * 系统；configureVault 根目录选择，spec §3 映射）。用户取消 resolve `{ path: null }`。
   */
  onSelectDirectory?(input: McpAppsOpenDirectoryPickerParams): Promise<McpAppsOpenDirectoryPickerResult>;
  /**
   * g9 白名单动作 `drora/navigate`：请求宿主导航到只读目标（P2 最小面仅 surface）。
   * 返回 reject 表示目标面板不可达（未声明 / 未启用）。
   */
  onNavigate?(target: McpAppsNavigateParams): Promise<void>;
}

/**
 * `ui/message` 的参数：官方 schema 只认 role + content，会剥掉顶层未知键；扩展的 `structuredContent`
 * 要留下来（拼成 ```json 块随消息发出），所以宿主用自己的 loose schema 注册这个方法，而不是 `onmessage`。
 */
const pluginUiMessageParamsSchema = z
  .object({
    role: z.literal("user"),
    content: z.array(z.record(z.string(), z.unknown())).min(1),
    structuredContent: z.unknown().optional(),
  })
  .loose();
const pluginUiSetWidgetStateParamsSchema = z.object({ widgetState: z.unknown() }).loose();

// g9 白名单动作的参数 schema（specs/obsidian-vault-phase2-true-extraction.md §6/§8）。
// schema 在 shared/mcp-apps/schemas.ts 单一出处（页面侧 aliasRuntime 复用同一份）；
// 白名单即注册面：只注册这三个方法名，白名单外的 `drora/*` 方法由官方 SDK 回 -32601。
const pluginUiOpenConversationHandoffParamsSchema = mcpAppsOpenConversationHandoffParamsSchema;
const pluginUiOpenDirectoryPickerParamsSchema = mcpAppsOpenDirectoryPickerParamsSchema;
const pluginUiNavigateParamsSchema = mcpAppsNavigateParamsSchema;

/** 回调抛出的带 `code` 的错误（-32601 / -32000 / -32602）翻译成 JSON-RPC 错误，其余按内部错误处理。 */
function toProtocolError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof ProtocolError) return error;
  if (error instanceof Error && typeof code === "number")
    return new ProtocolError(code, error.message);
  return error;
}
const unsupported = (method: string) =>
  new ProtocolError(METHOD_NOT_FOUND, `${method} is not available for this app`);

/**
 * 会话交互（ui/message、ui/update-model-context、ui/download-file、Drora 扩展 ui/set-widget-state）接到官方
 * AppBridge：缺省回调回 -32601；ui/message 的手势 token 由 main 在 guest input-event 记录、一次性消费，没有句柄视为无手势。
 */
export function wirePluginUiInteractions(
  bridge: PluginUiHostBridge,
  deps: PluginUiInteractionCallbacks,
  platform: Pick<PluginSandboxPlatformPort, "consumeUserGesture">,
  currentHandle: () => PluginSandboxHandle | null,
): void {
  bridge.setRequestHandler(
    "ui/message",
    { params: pluginUiMessageParamsSchema, result: McpUiMessageResultSchema },
    async (rawParams) => {
      if (!deps.onSendFollowUpMessage) throw unsupported("ui/message");
      const params = rawParams as z.infer<typeof pluginUiMessageParamsSchema>;
      const handle = currentHandle();
      const assertCurrent = () => {
        if (!handle || currentHandle()?.instance.token !== handle.instance.token)
          throw new Error("MCP App instance was closed");
      };
      assertCurrent();
      try {
        await deps.onSendFollowUpMessage(
          {
            prompt: concatMcpAppsTextContent(params.content),
            content: params.content,
            ...(params.structuredContent !== undefined
              ? { structuredContent: params.structuredContent }
              : {}),
          },
          {
            assertCurrent,
            consumeUserGesture: () =>
              handle ? platform.consumeUserGesture(handle.sandboxId) : Promise.resolve(false),
          },
        );
      } catch (error) {
        throw toProtocolError(error);
      }
      return {};
    },
  );
  bridge.onupdatemodelcontext = async (params) => {
    if (!currentHandle()) throw new Error("MCP App instance was closed");
    if (!deps.onUpdateModelContext) throw unsupported("ui/update-model-context");
    try {
      await deps.onUpdateModelContext({
        content: (params.content ?? []) as Array<Record<string, unknown>>,
        ...(params.structuredContent !== undefined
          ? { structuredContent: params.structuredContent }
          : {}),
      });
    } catch (error) {
      throw toProtocolError(error);
    }
    return {};
  };
  bridge.ondownloadfile = async (params) => {
    if (!deps.onDownloadFile) throw unsupported("ui/download-file");
    try {
      return await deps.onDownloadFile(params.contents as McpAppsDownloadFileItem[]);
    } catch (error) {
      throw toProtocolError(error);
    }
  };
  bridge.setRequestHandler(
    MCP_APPS_SET_WIDGET_STATE_METHOD,
    { params: pluginUiSetWidgetStateParamsSchema, result: EmptyResultSchema },
    async (rawParams) => {
      if (!currentHandle()) throw new Error("MCP App instance was closed");
      if (!deps.onUpdateWidgetState) throw unsupported(MCP_APPS_SET_WIDGET_STATE_METHOD);
      const params = rawParams as z.infer<typeof pluginUiSetWidgetStateParamsSchema>;
      await deps.onUpdateWidgetState(params.widgetState);
      return {};
    },
  );

  // g9 页面→宿主白名单动作桥（specs/obsidian-vault-phase2-true-extraction.md §6/§8/§10-P2）：
  // 三个动作都在 AppBridge 扩展方法位注册（与 ui/set-widget-state 同款机制，传输仍是既有
  // postMessage MessagePort，不新增通道）；未注入回调的动作回 -32601，宿主能力宣告按真实
  // handler 裁剪（getHostCapabilities），声明与 handler 一一对应。
  bridge.setRequestHandler(
    MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
    { params: pluginUiOpenConversationHandoffParamsSchema, result: EmptyResultSchema },
    async (rawParams) => {
      if (!currentHandle()) throw new Error("MCP App instance was closed");
      if (!deps.onOpenConversationHandoff)
        throw unsupported(MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD);
      const params = rawParams as z.infer<typeof pluginUiOpenConversationHandoffParamsSchema>;
      await deps.onOpenConversationHandoff({
        content: params.content,
        ...(params.structuredContent !== undefined
          ? { structuredContent: params.structuredContent }
          : {}),
      });
      return {};
    },
  );
  bridge.setRequestHandler(
    MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
    {
      params: pluginUiOpenDirectoryPickerParamsSchema,
      result: mcpAppsOpenDirectoryPickerResultSchema,
    },
    async (rawParams) => {
      if (!currentHandle()) throw new Error("MCP App instance was closed");
      if (!deps.onSelectDirectory) throw unsupported(MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD);
      const params = rawParams as McpAppsOpenDirectoryPickerParams;
      return await deps.onSelectDirectory(
        params.title !== undefined ? { title: params.title } : {},
      );
    },
  );
  bridge.setRequestHandler(
    MCP_APPS_NAVIGATE_METHOD,
    { params: pluginUiNavigateParamsSchema, result: EmptyResultSchema },
    async (rawParams) => {
      if (!currentHandle()) throw new Error("MCP App instance was closed");
      if (!deps.onNavigate) throw unsupported(MCP_APPS_NAVIGATE_METHOD);
      const params = rawParams as McpAppsNavigateParams;
      await deps.onNavigate({
        kind: "surface",
        surfaceId: params.surfaceId,
        ...(params.payload !== undefined ? { payload: params.payload } : {}),
      });
      return {};
    },
  );
}
