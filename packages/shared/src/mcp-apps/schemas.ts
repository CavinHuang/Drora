import { z } from "zod";
import {
  MCP_APPS_RESOURCE_URI_MAX_CHARS,
  MCP_APPS_CONTENT_MAX_BYTES,
  MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES,
  MCP_APPS_SURFACE_ID_MAX_CHARS,
  MCP_APPS_SURFACE_ID_PATTERN,
  MCP_APPS_WIDGET_META_MAX_BYTES,
} from "./contract.js";

/**
 * 以下 schema 是 mcp-apps-protocol 的运行时校验面：只覆盖 Drora 自己的投影 / 元数据形状。
 * 页面 ↔ 宿主的 `ui/*` 参数由官方 SDK（`McpUi*Schema`）校验，这里不重复。类型见 contract.ts。
 */

export const mcpAppsDisplayModeSchema = z.enum(["inline", "fullscreen", "pip"]);
export const mcpAppsToolVisibilitySchema = z.enum(["model", "app"]);
/** 面板 id。 */
export const mcpAppsSurfaceIdSchema = z
  .string()
  .min(1)
  .max(MCP_APPS_SURFACE_ID_MAX_CHARS)
  .regex(MCP_APPS_SURFACE_ID_PATTERN);

// ============================================================
// g9 宿主动作桥（specs/obsidian-vault-phase2-true-extraction.md §6/§8/§10-P2）。
// 宿主 handler（plugin-ui interactionPorts）与沙箱页面（aliasRuntime）两侧复用同一 schema，
// 方法名常量在 contract.ts——契约键单一出处，两侧不各写一份字面量。
// ============================================================
/** `drora/openConversationHandoff` 参数：与 ui/update-model-context 同形（内容块 + 可选结构化负载）。 */
export const mcpAppsOpenConversationHandoffParamsSchema = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())).min(1),
    structuredContent: z.unknown().optional(),
  })
  .loose();
/** `drora/openDirectoryPicker` 参数 / 结果（用户取消 path 为 null）。 */
export const mcpAppsOpenDirectoryPickerParamsSchema = z
  .object({ title: z.string().max(200).optional() })
  .loose();
export const mcpAppsOpenDirectoryPickerResultSchema = z
  .object({ path: z.string().nullable() })
  .loose();
/** `drora/navigate` 参数（P2 最小面：仅 surface 目标，surfaceId 复用清单 id 校验）。 */
export const mcpAppsNavigateParamsSchema = z
  .object({
    kind: z.literal("surface"),
    surfaceId: mcpAppsSurfaceIdSchema,
    payload: z.unknown().optional(),
  })
  .loose();
/** `drora/openWith` 通知参数（payload 透传，宿主不解释；纯打开命令可省略 payload）。 */
export const mcpAppsOpenWithParamsSchema = z
  .object({ payload: z.unknown().optional() })
  .loose();

export const mcpToolUiCspSchema = z
  .object({
    connectDomains: z.array(z.string().min(1).max(512)).optional(),
    resourceDomains: z.array(z.string().min(1).max(512)).optional(),
    frameDomains: z.array(z.string().min(1).max(512)).optional(),
    baseUriDomains: z.array(z.string().min(1).max(512)).optional(),
  })
  .strict();

/** 资源级 `_meta["zcode/csp"]` 归一化后的形状（只有为 true 的键）。 */
export const mcpAppCspRelaxationsSchema = z
  .object({ unsafeEval: z.boolean().optional(), wasmUnsafeEval: z.boolean().optional() })
  .strict();

export const mcpToolUiDescriptorSchema = z
  .object({
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    visibility: z.array(mcpAppsToolVisibilitySchema).optional(),
    preferredDisplayMode: mcpAppsDisplayModeSchema.optional(),
    csp: mcpToolUiCspSchema.optional(),
    prefersBorder: z.boolean().optional(),
    surface: mcpAppsSurfaceIdSchema.optional(),
    showInline: z.boolean().optional(),
  })
  .strict();

/**
 * `display.ui`：agent 投影到 ToolCallRow.display 的插件 UI 元数据。
 * contracts 与 drora-protocol-v4 两处 strict schema 都从这里复用，避免三份手写不同步。
 */
export const mcpToolDisplayUiSchema = z
  .object({
    pluginId: z.string().min(1).max(256),
    resourceUri: z.string().min(1).max(MCP_APPS_RESOURCE_URI_MAX_CHARS),
    preferredDisplayMode: mcpAppsDisplayModeSchema.optional(),
    prefersBorder: z.boolean().optional(),
    csp: mcpToolUiCspSchema.optional(),
    // 上限按 UTF-8 字节由 agent 侧保证；这里的 max 按字符数只是兜底（字符数 ≤ 字节数）。
    structuredContent: z.string().max(MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES).optional(),
    widgetMeta: z.string().max(MCP_APPS_WIDGET_META_MAX_BYTES).optional(),
    /** 原始 `content` 数组的 JSON 文本（≤ 32 KiB），页面 tool-result 用它而不是拼接的纯文本。 */
    content: z.string().max(MCP_APPS_CONTENT_MAX_BYTES).optional(),
    truncated: z.boolean().optional(),
    /** 被省略字段的 UTF-8 字节数之和。 */
    truncatedBytes: z.number().int().nonnegative().optional(),
    /** MCP 结果 `isError: true`（调用本身完成、工具报错）；页面 tool-result 带 isError，面板不用它覆盖上一份成功快照。 */
    isError: z.literal(true).optional(),
    /** 工具级强制常驻（`openai/widgetShowCodexWidgetInline`），卡片不进折叠区。 */
    showInline: z.literal(true).optional(),
    // 所属面板；contracts 侧 mcpToolDisplayUiPayloadSchema 同步。
    surface: mcpAppsSurfaceIdSchema.optional(),
  })
  .strict();
export type McpToolDisplayUi = z.infer<typeof mcpToolDisplayUiSchema>;

/** 当前执行的成功 UI 工具结果；独立于 conversation 订阅，不用于历史回放。 */
export const pluginUiToolResultNotificationSchema = z
  .object({
    sessionId: z.string().min(1),
    toolCallId: z.string().min(1),
    serverName: z.string().min(1),
    ui: mcpToolDisplayUiSchema.refine((ui) => !ui.isError),
    input: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PluginUiToolResultNotification = z.infer<typeof pluginUiToolResultNotificationSchema>;
