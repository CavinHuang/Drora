import { requestVerificationReasons } from "../request-security-edition/verification-policy.js";
import { droraProtocolTraceSchema } from "./trace.js";
// 团队目录摘要复用 V4 的同一严格契约；兼容入口不复制 schema 或字段定义。
export {
  SESSION_TEAM_ACTIVITY_KEY,
  sessionTeamActivitySchema,
  type SessionTeamActivity,
} from "../drora-protocol-v4/sessions-index-team-activity.js";
// Bot 反向回复的名字解析/待澄清结果与 App、CLI 使用同一严格 schema。
export { channelReplyRequestSchema, channelReplyResultSchema } from "../channel-mention.js";
export { droraProtocolTraceSchema, type DroraProtocolTrace } from "./trace.js";
import {
  databaseMigrationFactsSchema,
  databaseStartupErrorCodeSchema,
  databaseStartupErrorDetailsSchema,
} from "../database-startup.js";
import {
  MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE,
  MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS,
  MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS,
  mcpAppsAppToolCallResultSchema,
  mcpAppsAppToolDescriptorSchema,
} from "../mcp-apps/appTools.js";
import { mcpAppsSamplingParamsSchema, mcpAppsSamplingResultSchema } from "../mcp-apps/sampling.js";
import { mcpAppInstanceSchema } from "../mcp-apps/instance.js";
export { conversationQuoteSchema, conversationQuotesSchema } from "../conversationSelection.js";
/* oxlint-disable eslint(max-lines) -- Drora Protocol schema 需要单文件导出，方便 app 与 agent 共享同一份协议契约。 */
// ── 旧协议删除边界──────────────────────
// 剩余 ~257 个导出：旧 Drora Protocol 方法契约、请求/响应/事件 schema、
// session/workspace state snapshot 投影等（承重类型已迁 drora-protocol-legacy-types.ts）。
// 已连根删除的死词（词表+schema+两侧实现）：session/steer、session/rewind、
// session/rewindCascade、session/previewFileRewind、session/applyFileRewind、
// prompt/enhance 全簇（含 promptEnhanceResult 通知）、plugins/marketplace/list；
// session/fork 客户端链已删（op+schema 留存 = v4 forkSessionAtMessage 钩子消费）。
// 消费者：services 旧栈（droraProtocolClient/droraAgent/droraAgentService/droraSession*）、
// CLI bootstrap 旧协议 server（drora-protocol/server-operations、plugins、session-mapper 等）、
// UI 旧投影（droraSessionProjection 等读路径）。
// 上述旧协议 client/server 组删除时，本文件整体删除。
// 注：外部零消费 schema 多为存活 schema 联合的内部依赖，随宿主文件一起处理，勿单删。
import { z } from "zod";
import { accountProviderUnavailableReasonSchema } from "../account-provider-state.js";
import { bashOutputDisplaySchema } from "../bash-output-display.js";
import { droraAutomationBotDeliveryTargetSchema } from "../bots.js";
import { executionOutputPreviewSchema } from "../execution-output-preview.js";
import { completeModelPropertiesDataSchema } from "../model-config.js";
import { modelExecutionSchema } from "../model-execution.js";
export type { ModelExecutionSelectionFallback } from "../model-execution.js";
export * from "../off-peak-execution.js";
import { modelSelectionSchema } from "../model-selection.js";
import { APP_USAGE_RANGES, appUsageSnapshotSchema } from "../usage-stats.js";
import { DYNAMIC_WORKFLOW_MODES } from "../dynamic-workflow-feature.js";
import { errorAttributionSchema } from "../drora-protocol-v4/snapshot.js";
// 后台详情共享精简的只读响应 schema，不携带命令或计时元数据。
export * from "../background-bash-output.js";
export * from "../process-diagnostic.js";
export { attachmentSourceKindSchema, type AttachmentSourceKind } from "../attachment-source.js";
import { PROTOCOL_V4_LIMITS } from "../drora-protocol-v4/core.js";
// Persona P0 契约键单一出处（AGENTS.md）：能力位/偏好键/方法 wire 名引用 contracts 常量，
// 不在本文件另写字面量（合同 §4.1）。P1a 的受控四键与受控值集合同样引用单一出处。
import {
  PERSONA_ERROR_CODES,
  PERSONA_EXPORT_FORMAT,
  PERSONA_EXPORT_FORMAT_VERSION,
  PERSONA_LEARNING_BUDGET,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1,
  PERSONA_PROTOCOL_METHODS,
  PERSONA_RUNTIME_PREFERENCE_ENABLED,
  type PersonaErrorCode,
} from "../contracts/persona.js";

export const droraTopicResourceReadParamsSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    taskId: z.string().min(1).max(256),
    inputId: z.string().min(1).max(256),
    authorizationId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(256),
    resourceIndex: z.number().int().nonnegative(),
  })
  .strict();
export const droraTopicResourceReadResultSchema = z
  .object({
    ref: z.string().min(1),
    fileName: z.string().min(1).max(1024),
    mime: z.string().min(1).max(256),
    bytes: z.number().int().min(0).max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
  })
  .strict();
export const droraTopicResourceCancelParamsSchema = z
  .object({ requestId: z.string().min(1).max(256), taskId: z.string().min(1).max(256) })
  .strict();
export const droraTopicResourceCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();
export type DroraTopicResourceReadParams = z.infer<typeof droraTopicResourceReadParamsSchema>;
export type DroraTopicResourceReadResult = z.infer<typeof droraTopicResourceReadResultSchema>;
export { activeWorkSummarySchema, type ActiveWorkSummary } from "../drora-protocol-v4/snapshot.js";
// browser-use 命令/结果契约单一来源：agent 构造、协议校验和 main executor 共用同一 schema。
import {
  browserBackendListResultSchema,
  browserSessionContextKindSchema,
} from "../browser-use/backend.js";
import { browserClientModeSchema, browserCommandSchema } from "../browser-use/commands.js";
import { browserCommandResultSchema } from "../browser-use/result.js";
import { appToolSearchModeSchema } from "../app-runtime-preferences.js";
import { integratedTerminalShellSelectionSchema } from "../validationAppSettings.js";
import { droraTaskModeSchema } from "../drora-task-mode-schema.js";
import { OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS } from "../official-mcp-auth.js";
import {
  droraSyntheticUserMessageSourceSchema as legacyDroraSyntheticUserMessageSourceSchema,
  droraDeliveryKindSchema,
  droraInteractionRequestOriginSchema,
  droraMessagePartSchema,
  droraMessageVisibilitySchema,
  droraMessageWithPartsSchema,
  droraPermissionDecisionSchema,
  droraPermissionResponseSchema,
  droraPermissionUpdateSchema,
  droraSessionApiRetryStatusSchema,
  droraSessionContextUsageSchema,
  droraSessionGoalSchema,
  droraSessionGoalVerificationSchema,
  droraSessionGoalVerificationTimelineSchema,
  droraSessionInfoSchema,
  droraSessionKindSchema,
  droraSessionModeSchema,
  droraSessionRuntimeStateSchema,
  droraSessionStatusSchema,
  droraToolStateSchema,
  droraWorkspaceRefSchema,
} from "../drora-protocol-legacy-types.js";

export * from "../localTtft.js";
export {
  hookExecutionProjectionSchema,
  hookInvocationRowSchema,
  type HookExecutionProjection,
  type HookInvocationRow,
} from "../drora-protocol-v4/rows.js";

export {
  sessionsIndexReconcileParamsSchema,
  sessionsIndexReconcileResultSchema,
  type SessionsIndexReconcileParams,
  type SessionsIndexReconcileResult,
} from "../drora-protocol-v4/sessions-index.js";

export const DRORA_PROTOCOL_NAME = "Drora Protocol" as const;
export const DRORA_PROTOCOL_VERSION = 1 as const;
// V4 wire 与 legacy 主协议并存；禁止为了 V4 physical framing 改写 legacy 版本。
export const DRORA_PROTOCOL_V4_WIRE_VERSION = 3 as const;
export const droraRuntimeCapabilitiesSchema = z.object({
  historyFirst: z.boolean().optional(),
  independentPlanState: z.boolean().optional(),
  // Persona 控制合同 v1（合同 §4.1）：CLI 仅在 persona 控制路由已注册时为 true；
  // 缺失/method-not-found/断线一律视为不可用，原会话继续，不试发 persona 方法。
  // 键引用 contracts 常量，与 Host↔UI 的 hello.capabilities 同一字面量。
  [PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1]: z.boolean().optional(),
});
export const droraProtocolErrorCodes = {
  sessionUnavailable: -32004,
} as const;

const nonEmptyString = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const timestampMsSchema = z.number().int().nonnegative();
const protocolInstantSchema = z.union([timestampMsSchema, nonEmptyString, z.date()]);

// Tool result display 不受模型文本 budget 约束；Node REPL 图片必须在 Agent/App 协议边界
// 做严格限长，避免截图把 continuous 或 replayable 消息扩成无界载荷。
export const droraNodeReplImageToolResultDisplaySchema = z
  .object({
    kind: z.literal("node_repl_images"),
    images: z
      .array(
        z
          .object({
            base64: z
              .string()
              .min(1)
              .max(200 * 1024),
            mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/iu),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    truncated: z.boolean().optional(),
    source: z.literal("browser_turn_end").optional(),
  })
  .strict();

// 同理：CreateWorkflow 的类型检查诊断也是 display 通道，必须在协议边界限长，
// 避免大量诊断把 continuous/replayable 消息扩成无界载荷。
// causalityGraph 在工具输出边界已限长，这里镜像同一组上界（与 v4 rows 保持一致）。
// 图的词汇表刻意很小：step 卡片 + actor 车道 + 一种箭头（runs after，`back` 只标回边）+
// 返回物标记。分析器的 kind / certainty / exact / region 不进载荷。
// 名字只在运行时成形（`` agent(`研究员${i + 1}`) ``）时静态能拿到的形状：第一个洞之前的
// 字面量（head）与最后一个洞之后的字面量（tail）。至少一个在场，两者都已 trim 且含实义字符。
// Bug 修复：这两个字段随 0a8b059f40 落进 contracts 与 v4 镜像，v3 这份漏改——.strict()
// 之下带插值名的工作流会让整个 display 验证失败、图整块消失，所以这里必须与 v4 逐字段对齐。
const droraWorkflowNamePatternSchema = z
  .object({
    head: z.string().min(1).max(128).optional(),
    tail: z.string().min(1).max(128).optional(),
  })
  .strict();

// 一条边 = runs after；step 边与阶段边同形，`back` 只标循环回边。
const droraWorkflowEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    back: z.literal(true).optional(),
  })
  .strict();

const droraCreateWorkflowCausalityGraphDisplaySchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            // `hole`：开着的留白自己的站点（docs/dynamic-workflow/presentation.md「Holes on the timeline」）；镜像 v4。
            kind: z.enum(["ask", "world-read", "hole"]),
            label: z.string().min(1).max(128),
            // 内联 `agent()` receiver 让 label 落到兜底串时，那个名字的静态形状。
            labelPattern: droraWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            lane: z.string().min(1).max(64),
            lanes: z.array(z.string().min(1).max(64)).max(32).optional(),
            // 展开自的站点 id，只出现在 may-set 车道展开的拷贝上（实时叠加的关联键）；
            // 加字段是 additive 的，不带它的旧载荷照常通过 .strict()。
            source: z.string().min(1).max(64).optional(),
            // 作者用 `phase("…")` 标记划入的阶段。
            // 与图的 phases / phaseEdges / exits 同进同退：全在场或全缺席。
            phase: z.string().min(1).max(64).optional(),
            repeat: z.enum(["stack", "serial"]).optional(),
            // 这个站点是某次补全写进来的：值是那个留白的站点 id；镜像 v4。
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(64),
    lanes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            // `name` 缺席而 agent() 首参是带洞的模板串时的静态形状；与 name 互斥。
            namePattern: droraWorkflowNamePatternSchema.optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(32),
    // 参与者与交接；镜像 v4。
    participants: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            phase: z.string().min(1).max(64),
            lane: z.string().min(1).max(64),
            steps: z.array(z.string().min(1).max(64)).min(1).max(64),
            member: z
              .object({ index: z.number().int().nonnegative(), of: z.number().int().positive() })
              .strict()
              .optional(),
            many: z.literal(true).optional(),
          })
          .strict(),
      )
      .max(64),
    handoffs: z
      .array(
        droraWorkflowEdgeSchema
          .extend({ types: z.array(z.string().min(1).max(128)).min(1).max(8).optional() })
          .strict(),
      )
      .max(256),
    // 阶段词汇表：作者施加的分组结构，主画面以它为节点。与 phaseEdges / exits / Step.phase
    // 全有或全无——零标记脚本全缺席，UI 据此退回 step/车道视图。零成员阶段也在表里。
    // `unphased` 无 name，显示名由 UI 本地化。
    phases: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            name: z.string().min(1).max(128).optional(),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
            // 进入本阶段时还在跑的其他阶段（它们的 strand 尚未 join），阶段表序，不含自己，
            // 为空时缺席。是节点事实而不是边——控制没有从那里转移过来，所以不进 phaseEdges。
            // 时间轴据此把相邻阶段折成一条分叉的「带」，侧栏迷你轨道画成双线段。
            alongside: z.array(z.string().min(1).max(64)).min(1).max(32).optional(),
            // 这个阶段是某次补全写进来的：值是那个留白的站点 id；镜像 v4。
            fill: z.string().min(1).max(64).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    phaseEdges: z.array(droraWorkflowEdgeSchema).max(128).optional(),
    // 阶段流（docs/dynamic-workflow/presentation.md「Streams」）：两端互为 alongside 的 data 边，
    // 只有 {from, to}——不是 runs after，不进 phaseEdges、不带 back。与词汇表同进同退。
    phaseStreams: z
      .array(z.object({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) }).strict())
      .max(128)
      .optional(),
    // 还开着的留白，源码序（docs/dynamic-workflow/authoring.md「Holes」）；镜像 v4。
    holes: z
      .array(
        z
          .object({
            siteId: z.string().min(1).max(64),
            name: z.string().min(1).max(128),
            type: z.string().min(1).max(128),
            phase: z.string().min(1).max(64).optional(),
            tail: z.boolean().optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
    // 控制流可在其后正常完成的阶段（阶段视图的「阶段 → 返回物」箭头）；组内可为空数组。
    exits: z.array(z.string().min(1).max(64)).max(32).optional(),
    sink: z.array(z.string().min(1).max(64)).max(64).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const droraCreateWorkflowToolResultDisplaySchema = z
  .object({
    kind: z.literal("create_workflow"),
    ok: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    diagnostics: z
      .array(
        z
          .object({
            line: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            code: z.number().int().nonnegative(),
            message: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .max(100),
    causalityGraph: droraCreateWorkflowCausalityGraphDisplaySchema.optional(),
    truncated: z.boolean().optional(),
    // FillWorkflowHole 行补的是哪处留白（docs/dynamic-workflow/presentation.md「The fill row」）；镜像 v4。
    // 修复原因：dwf-recursive 只给 contracts 与 v4 加了留白字段，v3 的 .strict() 拒掉整条 tool.updated，
    // 桌面端 v3 订阅于是把含留白的 CreateWorkflow / FillWorkflowHole 结果当无效事件丢掉。
    fill: z
      .object({
        siteId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        draftPath: z.string().min(1).max(1_024).optional(),
        line: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const droraToolResultObjectSchema = jsonObjectSchema.superRefine((result, context) => {
  const display = result.display;
  if (typeof display !== "object" || display === null || Array.isArray(display)) {
    return;
  }
  const kind = (display as Record<string, unknown>).kind;
  const schemaByKind: Record<string, z.ZodTypeAny> = {
    node_repl_images: droraNodeReplImageToolResultDisplaySchema,
    create_workflow: droraCreateWorkflowToolResultDisplaySchema,
    bash_output: bashOutputDisplaySchema,
  };
  const schema = typeof kind === "string" ? schemaByKind[kind] : undefined;
  if (!schema) return;
  const parsed = schema.safeParse(display);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    context.addIssue({ ...issue, path: ["display", ...issue.path] });
  }
});

export const droraProtocolRequestIdSchema = z.union([z.string(), z.number().int()]);
export type DroraProtocolRequestId = z.infer<typeof droraProtocolRequestIdSchema>;

// 远程历史附件仅通过现有连接的私有反向频道传输，单块保持在 RPC 帧预算内。
export const TOPIC_RESOURCE_RELAY_CHUNK_BYTES = 384 * 1024;
export const TOPIC_RESOURCE_RELAY_CHANNEL = "host-topic-resource";
export const droraTopicResourceRelayRequestSchema = droraTopicResourceReadParamsSchema
  .extend({
    workspacePath: z.string().min(1).max(4096),
    workspaceIdentity: z.string().min(1).max(4096),
    remoteSessionId: z.string().min(1).max(256),
    trace: droraProtocolTraceSchema.optional(),
  })
  .strict();
export type DroraTopicResourceRelayRequest = z.infer<typeof droraTopicResourceRelayRequestSchema>;
export const droraTopicResourceRelayKeySchema = droraTopicResourceCancelParamsSchema;
export const droraTopicResourceRelayChunkRequestSchema = droraTopicResourceRelayKeySchema
  .extend({
    index: z.number().int().nonnegative(),
  })
  .strict();
export const droraTopicResourceRelayMetadataSchema = z
  .object({
    fileName: z.string().min(1).max(1024),
    mime: z.string().min(1).max(256),
    bytes: z.number().int().min(0).max(PROTOCOL_V4_LIMITS.attachmentMaxBytes),
    totalChunks: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(PROTOCOL_V4_LIMITS.attachmentMaxBytes / TOPIC_RESOURCE_RELAY_CHUNK_BYTES)),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export const droraTopicResourceRelayChunkSchema = z
  .object({
    dataBase64: z.string().max((TOPIC_RESOURCE_RELAY_CHUNK_BYTES / 3) * 4),
  })
  .strict();

export const droraProtocolRequestSchema = z
  .object({
    id: droraProtocolRequestIdSchema,
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: droraProtocolTraceSchema.optional(),
  })
  .strict();
export type DroraProtocolRequest = z.infer<typeof droraProtocolRequestSchema>;

export const droraProtocolNotificationSchema = z
  .object({
    method: nonEmptyString,
    params: z.unknown().optional(),
    trace: droraProtocolTraceSchema.optional(),
  })
  .strict();
export type DroraProtocolNotification = z.infer<typeof droraProtocolNotificationSchema>;

export const droraProtocolResponseSchema = z
  .object({
    id: droraProtocolRequestIdSchema,
    result: z.unknown(),
  })
  .strict();
export type DroraProtocolResponse = z.infer<typeof droraProtocolResponseSchema>;

export const droraProtocolErrorSchema = z
  .object({
    id: droraProtocolRequestIdSchema,
    error: z
      .object({
        code: z.number().int(),
        message: nonEmptyString,
        data: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type DroraProtocolError = z.infer<typeof droraProtocolErrorSchema>;

export const droraProtocolMessageSchema = z.union([
  droraProtocolRequestSchema,
  droraProtocolNotificationSchema,
  droraProtocolResponseSchema,
  droraProtocolErrorSchema,
]);
export type DroraProtocolMessage = z.infer<typeof droraProtocolMessageSchema>;

export const droraProtocolNotifications = {
  storageStartup: "startup/storageState",
  providerRuntimeHeadersCancelled: "interaction/providerRuntimeHeadersCancelled",
  mcpTelemetry: "process/mcpTelemetry",
  mcpResourceSamples: "process/mcpResourceSamples",
  toolExecResource: "process/toolExecResource",
  pluginOperationProgress: "plugins/operationProgress",
  processResourceSample: "process/resourceSample",
  processNetworkRequests: "process/networkRequests",
} as const;

/** 启动控制面独立于 task stream；数据库身份不可携带路径/凭据。 */
export const droraStorageStartupStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().min(1).max(128),
    sequence: z.number().int().positive(),
    databaseId: z.string().min(1).max(128),
    databaseKind: z.enum(["session", "tasks-index"]),
    phase: z.enum(["checking", "waiting_for_lock", "migrating", "committing", "ready", "failed"]),
    // 包含锁内、版本 SQL 之前的可选 lastAppliedMigrationId；旧通知仍可解析。
    migration: databaseMigrationFactsSchema.optional(),
    elapsedMs: z.number().nonnegative().finite(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    errorCode: databaseStartupErrorCodeSchema.optional(),
    ...databaseStartupErrorDetailsSchema.shape,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.phase === "failed" && !state.errorCode)
      context.addIssue({ code: "custom", message: "failed requires errorCode" });
  });
export type DroraStorageStartupState = z.infer<typeof droraStorageStartupStateSchema>;

const droraMcpTelemetryPlatformSchema = z.enum([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
  "cygwin",
]);
const droraMcpTelemetryArchSchema = z.enum([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
]);
const droraMcpTelemetryBaseSchema = z
  .object({
    arch: droraMcpTelemetryArchSchema,
    occurredAt: z.number().int().nonnegative(),
    platform: droraMcpTelemetryPlatformSchema,
  })
  .strict();
const droraMcpProcessTelemetryBaseShape = {
  mcpId: z
    .string()
    .regex(
      /^(?:builtin:(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+(?::(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+)*|(?:plugin|custom):[a-f0-9]{12})$/,
    ),
  mcpInstanceId: nonEmptyString,
  mcpIsolation: z.enum(["session", "workspace"]),
  mcpSource: z.enum(["builtin", "plugin", "custom"]),
} as const;

export const droraMcpTelemetryEventSchema = z.discriminatedUnion("kind", [
  droraMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_start"),
      ...droraMcpProcessTelemetryBaseShape,
    })
    .strict(),
  droraMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("process_crash"),
      ...droraMcpProcessTelemetryBaseShape,
      affectedSessionCount: z.number().int().nonnegative().max(10_000),
      exitCode: z.number().int().nullable(),
      signal: nonEmptyString.nullable(),
      uptimeMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  droraMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("session_startup"),
      configuredCount: z.number().int().nonnegative().max(10_000),
      connectedCount: z.number().int().nonnegative().max(10_000),
      failedCount: z.number().int().nonnegative().max(10_000),
      processCount: z.number().int().nonnegative().max(10_000),
      sessionId: nonEmptyString,
    })
    .strict(),
  droraMcpTelemetryBaseSchema
    .extend({
      kind: z.literal("memory"),
      ...droraMcpProcessTelemetryBaseShape,
      memoryKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
      memoryScope: z.enum(["process_tree", "direct_process"]),
      orphanSuspected: z.boolean(),
      ownerSessionCount: z.number().int().nonnegative().max(10_000),
      unownedSeconds: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
]);
export type DroraMcpTelemetryEvent = z.infer<typeof droraMcpTelemetryEventSchema>;

/** MCP 每五分钟只探测一次，周期由生产者与设备总量过期判据共用。 */
export const DRORA_MCP_RESOURCE_SAMPLE_INTERVAL_MS = 5 * 60_000;

export const droraMcpResourceSampleSchema = z
  .object({
    mcpId: droraMcpProcessTelemetryBaseShape.mcpId,
    instanceToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    sampledAt: z.number().int().nonnegative(),
    intervalMs: z.number().finite().positive(),
    processCount: z.number().int().positive().max(100_000),
    rssKbTotal: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rssKbMaxProcess: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cpuTimeMsDelta: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    uptimeMinutes: z.number().int().nonnegative(),
    platform: droraMcpTelemetryPlatformSchema,
    arch: droraMcpTelemetryArchSchema,
    logicalCpuCount: z.number().int().positive().max(4_096),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();
export type DroraMcpResourceSample = z.infer<typeof droraMcpResourceSampleSchema>;
// 通知输入有界；main 另按每个上报窗口的 32 个 MCP 分组执行事件额度。
export const droraMcpResourceSamplesSchema = z.array(droraMcpResourceSampleSchema).max(1_024);

export const BASH_RESOURCE_SAMPLE_INTERVAL_MS = 15_000;
export const BASH_RESOURCE_MAX_SAMPLES = 20;

/** Bash 子进程的有界完成事实；禁止命令、路径与会话标识进入遥测旁路。 */
export const droraToolExecResourceSchema = z
  .object({
    // 同一完成事实可能经多个 Host 转发；随机标识仅供 main 去重，旧 CLI 缺字段仍兼容。
    completionToken: z.string().uuid().optional(),
    platform: droraMcpTelemetryPlatformSchema,
    toolName: z.literal("bash"),
    durationMs: z.number().finite().min(BASH_RESOURCE_SAMPLE_INTERVAL_MS),
    exitKind: z.enum(["completed", "timeout", "killed", "error"]),
    treeRssKbPeak: z.number().finite().nonnegative().optional(),
    treeCpuTimeMs: z.number().finite().nonnegative().optional(),
    sampleCount: z.number().int().nonnegative().max(BASH_RESOURCE_MAX_SAMPLES),
    cliRssKb: z.number().finite().nonnegative(),
    systemFreeMemoryKb: z.number().finite().nonnegative(),
  })
  .strict();
export type DroraToolExecResource = z.infer<typeof droraToolExecResourceSchema>;

export const droraProcessResourceSampleSchema = z
  .object({
    platform: z.enum([
      "aix",
      "android",
      "darwin",
      "freebsd",
      "haiku",
      "linux",
      "netbsd",
      "openbsd",
      "sunos",
      "win32",
      "cygwin",
    ]),
    arch: z.enum([
      "arm",
      "arm64",
      "ia32",
      "loong64",
      "mips",
      "mipsel",
      "ppc",
      "ppc64",
      "riscv64",
      "s390",
      "s390x",
      "x64",
    ]),
    logicalCpuCount: z.number().int().positive().max(4_096),
    intervalMs: z
      .number()
      .int()
      .positive()
      .max(7 * 24 * 60 * 60 * 1_000),
    cpuCores: z.number().finite().nonnegative().max(4_096),
    cpuPercent: z.number().finite().nonnegative().max(100_000),
    rssKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /**
     * 以下四项为遥测新增字段，全部可选：旧 CLI 发来的样本仍能通过校验，因此
     * **不递增协议握手版本号**（握手版本是兼容性开关，不是字段版本）。
     */
    heapUsedKb: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    uptimeMinutes: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 365 * 24 * 60)
      .optional(),
    totalMemoryGb: z.number().int().nonnegative().max(1_048_576).optional(),
    /**
     * CLI 进程启动时随机生成的实例标识，仅供 app 侧 main 统计「同时存活几个 CLI 进程」
     * 与「最大单进程 RSS」。不进 ARMS 属性、不含 pid。收紧字符集是隐私红线的机械保障：
     * 路径、workspace 标识这类内容不可能通过校验。
     */
    instanceToken: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  })
  .strict();
export type DroraProcessResourceSample = z.infer<typeof droraProcessResourceSampleSchema>;

export const droraProcessChildProcessesParamsSchema = z.object({}).strict();
export const droraProcessChildProcessSchema = z
  .object({
    pid: z.number().int().positive(),
    serverName: nonEmptyString,
    mcpSource: z.enum(["builtin", "plugin", "custom"]),
    /** 官方/第三方插件的插件名（`plugin:<name>:<key>` 的 name，或官方 host MCP 对应插件）；custom 无 */
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export const droraProcessChildProcessesResultSchema = z
  .object({
    processes: z.array(droraProcessChildProcessSchema).max(10_000),
  })
  .strict();
export type DroraProcessChildProcess = z.infer<typeof droraProcessChildProcessSchema>;
export type DroraProcessChildProcessesResult = z.infer<
  typeof droraProcessChildProcessesResultSchema
>;

export type DroraDeliveryKind = z.infer<typeof droraDeliveryKindSchema>;
// TurnStarted 与持久 message 必须共用同一来源词表；否则 live event 能通过而 cold
// message 在 app/agent 边界被拒绝，造成 continuous/replayable 语义分叉。
// 持久消息与输入沿用同一 source schema；agent_listing_delta 只作 provider context，不触发新 turn。
const droraTurnInputSourceSchema = legacyDroraSyntheticUserMessageSourceSchema;
export const droraSessionPersistenceSchema = z.enum(["immediate", "deferred"]);
export type DroraSessionPersistence = z.infer<typeof droraSessionPersistenceSchema>;
export type DroraWorkspaceRef = z.infer<typeof droraWorkspaceRefSchema>;
export const droraPermissionOptionSchema = z
  .object({
    optionId: nonEmptyString,
    kind: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    response: droraPermissionResponseSchema,
  })
  .strict();

const droraProtocolMcpEntrySchema = z
  .object({
    name: nonEmptyString,
    value: z.string(),
  })
  .strict();

const droraProtocolMcpOAuthSchema = z.union([
  z
    .object({
      type: z.literal("client_credentials"),
      clientId: nonEmptyString,
      clientSecret: nonEmptyString,
      clientName: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("authorization_code"),
      clientId: nonEmptyString.optional(),
      clientSecret: nonEmptyString.optional(),
      clientName: nonEmptyString.optional(),
      redirectPath: nonEmptyString.optional(),
      scope: z.string().optional(),
    })
    .strict(),
]);

export const droraProtocolMcpServerSchema = z.union([
  z
    .object({
      name: nonEmptyString,
      command: nonEmptyString,
      args: z.array(z.string()),
      env: z.array(droraProtocolMcpEntrySchema),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      alwaysLoad: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      name: nonEmptyString,
      type: z.enum(["http", "sse"]),
      url: nonEmptyString,
      headers: z.array(droraProtocolMcpEntrySchema),
      oauth: droraProtocolMcpOAuthSchema.optional(),
      isolation: z.enum(["session", "workspace"]).optional(),
      protocolVersion: z.enum(["legacy", "auto", "2026-07-28"]).optional(),
      alwaysLoad: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
]);
export type DroraProtocolMcpServer = z.infer<typeof droraProtocolMcpServerSchema>;

export const droraMcpServerStatusKindSchema = z.enum([
  "connecting",
  "connected",
  "disabled",
  "disconnected",
  "failed",
  "untrusted",
]);
export const MCP_SERVER_FAILURE_KINDS = [
  "config_invalid",
  "runtime_unavailable",
  "process_start_failed",
  "network_unreachable",
  "connection_timeout",
  "protocol_negotiation_failed",
  "tool_list_failed",
  "unexpected_disconnect",
  "oauth_authorization_failed",
  "official_origin_untrusted",
  "not_authenticated",
  "coding_plan_required",
  "server_not_found",
  "server_unavailable",
  "rate_limited",
  "server_internal_error",
  "protocol_error",
  "status_unavailable",
  "connection_failed",
] as const;
export const mcpServerFailureKindSchema = z.enum(MCP_SERVER_FAILURE_KINDS);
export type McpServerFailureKind = z.infer<typeof mcpServerFailureKindSchema>;
export const droraMcpServerStatusSnapshotSchema = z
  .object({
    status: droraMcpServerStatusKindSchema,
    transport: z.enum(["stdio", "http", "sse"]),
    toolCount: z.number().int().nonnegative(),
    updatedAt: nonEmptyString,
    error: z.string().optional(),
    failureKind: mcpServerFailureKindSchema.optional(),
    serverRequestId: nonEmptyString.optional(),
    protocolEra: z.enum(["legacy", "modern"]).optional(),
    authorization: z
      .object({
        type: z.literal("oauth_authorization_code"),
        authorizationUrl: nonEmptyString,
        startedAt: nonEmptyString,
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraMcpServerStatusSnapshot = z.infer<typeof droraMcpServerStatusSnapshotSchema>;

export const droraMcpListModeSchema = z.enum(["connect", "status"]);
export type DroraMcpListMode = z.infer<typeof droraMcpListModeSchema>;

export const droraMcpListParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    mcpServers: z.array(droraProtocolMcpServerSchema).optional(),
    mode: droraMcpListModeSchema.default("connect"),
  })
  .strict();
export const droraMcpListResultSchema = z
  .object({
    statuses: z.record(z.string(), droraMcpServerStatusSnapshotSchema),
  })
  .strict();
export type DroraMcpListResult = z.infer<typeof droraMcpListResultSchema>;

// 插件 UI：UI 发起的 MCP 资源读取与工具调用，
// 按 pluginId 限定 server 归属，agent 侧 fail closed。
export const droraMcpUiOpenInstanceParamsSchema = z
  .object({
    accountContext: z.string().max(256).optional(),
    workspace: droraWorkspaceRefSchema,
    sessionId: nonEmptyString,
    pluginId: nonEmptyString,
    serverName: nonEmptyString,
    scopeId: nonEmptyString.max(4096),
    resourceUri: nonEmptyString.max(2048),
    ownerWebContentsId: z.number().int().positive(),
  })
  .strict();
export const droraMcpUiOpenInstanceResultSchema = mcpAppInstanceSchema;
export type DroraMcpUiOpenInstanceParams = z.infer<typeof droraMcpUiOpenInstanceParamsSchema>;
const droraMcpUiPluginScopeShape = {
  instance: mcpAppInstanceSchema,

  workspace: droraWorkspaceRefSchema,
  sessionId: nonEmptyString,
  pluginId: nonEmptyString,
  serverName: nonEmptyString,
};
export const droraMcpUiCloseInstanceParamsSchema = z
  .object({ ...droraMcpUiPluginScopeShape, onlyIfIdle: z.boolean().optional() })
  .strict();
export const droraMcpUiCloseInstanceResultSchema = z.object({ closed: z.boolean() }).strict();
export const droraMcpReadResourceParamsSchema = z
  .object({ ...droraMcpUiPluginScopeShape, uri: nonEmptyString.max(2048) })
  .strict();
export type DroraMcpReadResourceParams = z.infer<typeof droraMcpReadResourceParamsSchema>;
export const droraMcpResourceContentSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const droraMcpReadResourceResultSchema = z
  .object({ contents: z.array(droraMcpResourceContentSchema) })
  .strict();
export type DroraMcpReadResourceResult = z.infer<typeof droraMcpReadResourceResultSchema>;

/**
 * 插件页面发起的 `resources/read` 代理。
 * 与 `mcp/readResource`（宿主取 ui:// HTML）参数同形，但结果去掉 `_meta`、受 8 MiB 与 mimeType 白名单约束。
 */
export const droraMcpUiReadResourceParamsSchema = droraMcpReadResourceParamsSchema;
export type DroraMcpUiReadResourceParams = z.infer<typeof droraMcpUiReadResourceParamsSchema>;
export const droraMcpUiResourceContentSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
  })
  .strict();
export const droraMcpUiReadResourceResultSchema = z
  .object({ contents: z.array(droraMcpUiResourceContentSchema) })
  .strict();
export type DroraMcpUiReadResourceResult = z.infer<typeof droraMcpUiReadResourceResultSchema>;

export const droraMcpUiSamplingParamsSchema = z
  .object({
    ...droraMcpUiPluginScopeShape,
    operationId: nonEmptyString.max(128),
    request: mcpAppsSamplingParamsSchema,
  })
  .strict();
export const droraMcpUiCancelSamplingParamsSchema = z
  .object({ ...droraMcpUiPluginScopeShape, operationId: nonEmptyString.max(128) })
  .strict();
export const droraMcpUiSamplingResultSchema = mcpAppsSamplingResultSchema;
export type DroraMcpUiSamplingParams = z.infer<typeof droraMcpUiSamplingParamsSchema>;
export type DroraMcpUiCancelSamplingParams = z.infer<typeof droraMcpUiCancelSamplingParamsSchema>;

export const droraMcpUiCallToolParamsSchema = z
  .object({
    ...droraMcpUiPluginScopeShape,
    toolName: nonEmptyString,
    arguments: z.record(z.string(), z.unknown()).optional(),
    /** 宿主生成的调用 id，配合 `mcp/uiCancelCall` 取消进行中的调用。 */
    callId: nonEmptyString.max(128),
  })
  .strict();
export type DroraMcpUiCallToolParams = z.infer<typeof droraMcpUiCallToolParamsSchema>;
/** 取消页面发起的工具调用（卡片卸载、会话切换）；agent 侧 abort 到 MCP client。 */
export const droraMcpUiCancelCallParamsSchema = z
  .object({ ...droraMcpUiPluginScopeShape, callId: nonEmptyString.max(128) })
  .strict();
export type DroraMcpUiCancelCallParams = z.infer<typeof droraMcpUiCancelCallParamsSchema>;
export const droraMcpUiCancelCallResultSchema = z.object({ cancelled: z.boolean() }).strict();
export type DroraMcpUiCancelCallResult = z.infer<typeof droraMcpUiCancelCallResultSchema>;
/** 页面发起的 resources/list、resources/templates/list、subscribe、unsubscribe 代理。 */
export const droraMcpUiListResourcesParamsSchema = z
  .object({ ...droraMcpUiPluginScopeShape, cursor: nonEmptyString.max(2048).optional() })
  .strict();
export type DroraMcpUiListResourcesParams = z.infer<typeof droraMcpUiListResourcesParamsSchema>;
const droraMcpUiResourceDescriptorSchema = z
  .object({
    uri: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    // MCP Resource 的标准字段；规范把资源级 csp / prefersBorder 放在这里，宿主读 HTML 项缺 _meta 时回退用。
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const droraMcpUiListResourcesResultSchema = z
  .object({
    resources: z.array(droraMcpUiResourceDescriptorSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type DroraMcpUiListResourcesResult = z.infer<typeof droraMcpUiListResourcesResultSchema>;
export const droraMcpUiListResourceTemplatesResultSchema = z
  .object({
    resourceTemplates: z.array(
      z
        .object({
          uriTemplate: z.string(),
          name: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          mimeType: z.string().optional(),
        })
        .strict(),
    ),
    nextCursor: z.string().optional(),
  })
  .strict();
export type DroraMcpUiListResourceTemplatesResult = z.infer<
  typeof droraMcpUiListResourceTemplatesResultSchema
>;
/** 订阅者身份 = 会话 + 沙箱作用域 + 实例代际（initId）；dispose 只退订本代际，新实例不受影响。 */
export const droraMcpUiResourceSubscriptionParamsSchema = z
  .object({
    ...droraMcpUiPluginScopeShape,
    scopeId: nonEmptyString.max(256),
    generation: z.number().int().nonnegative(),
    uri: nonEmptyString.max(2048),
  })
  .strict();
export type DroraMcpUiResourceSubscriptionParams = z.infer<
  typeof droraMcpUiResourceSubscriptionParamsSchema
>;
export const droraMcpUiResourceSubscriptionResultSchema = z.object({}).strict();
/**
 * App-Provided Tools：实例身份 = 会话 + 沙箱作用域 + 代际（与资源订阅同一三元组）。
 * 登记按实例整体替换；调用认领 / 回传按 callId 幂等。
 */
const droraMcpUiAppToolInstanceShape = {
  ...droraMcpUiPluginScopeShape,
  scopeId: nonEmptyString.max(256),
  generation: z.number().int().nonnegative(),
};
export const droraMcpUiRegisterAppToolsParamsSchema = z
  .object({
    ...droraMcpUiAppToolInstanceShape,
    tools: z.array(mcpAppsAppToolDescriptorSchema).max(MCP_APPS_APP_TOOLS_MAX_PER_INSTANCE),
  })
  .strict();
export type DroraMcpUiRegisterAppToolsParams = z.infer<
  typeof droraMcpUiRegisterAppToolsParamsSchema
>;
export const droraMcpUiRegisterAppToolsResultSchema = z
  .object({ tools: z.array(z.object({ name: z.string(), modelName: z.string() }).strict()) })
  .strict();
export type DroraMcpUiRegisterAppToolsResult = z.infer<
  typeof droraMcpUiRegisterAppToolsResultSchema
>;
export const droraMcpUiUnregisterAppToolsParamsSchema = z
  .object(droraMcpUiAppToolInstanceShape)
  .strict();
export type DroraMcpUiUnregisterAppToolsParams = z.infer<
  typeof droraMcpUiUnregisterAppToolsParamsSchema
>;
export const droraMcpUiUnregisterAppToolsResultSchema = z
  .object({ removed: z.number().int().nonnegative() })
  .strict();
export type DroraMcpUiUnregisterAppToolsResult = z.infer<
  typeof droraMcpUiUnregisterAppToolsResultSchema
>;
export const droraMcpUiClaimAppToolCallParamsSchema = z
  .object({
    ...droraMcpUiAppToolInstanceShape,
    callId: nonEmptyString.max(MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS),
  })
  .strict();
export type DroraMcpUiClaimAppToolCallParams = z.infer<
  typeof droraMcpUiClaimAppToolCallParamsSchema
>;
export const droraMcpUiAppToolAcceptedResultSchema = z.object({ accepted: z.boolean() }).strict();
export type DroraMcpUiAppToolAcceptedResult = z.infer<typeof droraMcpUiAppToolAcceptedResultSchema>;
export const droraMcpUiResolveAppToolCallParamsSchema = z
  .object({
    ...droraMcpUiAppToolInstanceShape,
    callId: nonEmptyString.max(MCP_APPS_APP_TOOL_CALL_ID_MAX_CHARS),
    result: mcpAppsAppToolCallResultSchema.optional(),
    error: z
      .object({ message: z.string().max(MCP_APPS_APP_TOOL_ERROR_MESSAGE_MAX_CHARS) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.result === undefined) !== (value.error === undefined), {
    message: "exactly one of result or error is required",
  });
export type DroraMcpUiResolveAppToolCallParams = z.infer<
  typeof droraMcpUiResolveAppToolCallParamsSchema
>;
export const droraMcpUiCallToolResultSchema = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type DroraMcpUiCallToolResult = z.infer<typeof droraMcpUiCallToolResultSchema>;

export const droraSessionImportMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    timestamp: timestampMsSchema.optional(),
  })
  .strict();
export type DroraSessionImportMessage = z.infer<typeof droraSessionImportMessageSchema>;

export const droraSessionImportHistorySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("claudeCode"),
      title: z.string().optional(),
      createdAt: timestampMsSchema.optional(),
      updatedAt: timestampMsSchema.optional(),
      messages: z.array(droraSessionImportMessageSchema).min(1),
    })
    .strict(),
  z
    .object({
      source: z.literal("sharedContext"),
      title: z.string().trim().min(1),
      createdAt: timestampMsSchema.optional(),
      markdown: z.string().min(1),
      provenance: z
        .object({
          shareId: z.string().trim().min(1),
          contextId: z.string().trim().min(1).optional(),
          shareUrl: z.string().url().optional(),
          status: z.enum(["pending", "reserved", "attached", "discarded"]).optional(),
          projectionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          artifactSetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          formatterVersion: z.literal(1),
          markdownSha256: z.string().regex(/^[0-9a-f]{64}$/u),
          installedArtifacts: z.array(
            z
              .object({
                artifactId: z.string().trim().min(1),
                workspaceRelativePath: z.string().trim().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
]);
export type DroraSessionImportHistory = z.infer<typeof droraSessionImportHistorySchema>;

export const droraThoughtLevelOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();
export const droraModelReasoningOptionsSchema = z
  .object({
    levels: z.array(droraThoughtLevelOptionSchema),
    defaultLevel: nonEmptyString.optional(),
  })
  .strict();
export type DroraModelReasoningOptions = z.infer<typeof droraModelReasoningOptionsSchema>;

export const droraModelFormatPropertiesSchema = completeModelPropertiesDataSchema.pick({
  inputFormat: true,
  outputFormat: true,
});
export type DroraModelFormatProperties = z.infer<typeof droraModelFormatPropertiesSchema>;

export const droraModelOptionSchema = z
  .object({
    ref: modelSelectionSchema,
    label: nonEmptyString,
    providerLabel: nonEmptyString.optional(),
    description: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    reasoning: droraModelReasoningOptionsSchema.optional(),
    properties: droraModelFormatPropertiesSchema,
    disabledReason: z.string().optional(),
  })
  .strict();
export type DroraModelOption = z.infer<typeof droraModelOptionSchema>;

export const droraAccountAccessSchema = z.discriminatedUnion("planKind", [
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("start-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("individual-coding-plan"),
    })
    .strict(),
  z
    .object({
      type: z.literal("zhipu-account"),
      family: z.enum(["zai", "bigmodel"]),
      planKind: z.literal("team-coding-plan"),
      productId: nonEmptyString,
      organizationId: nonEmptyString,
      projectId: nonEmptyString,
    })
    .strict(),
]);
export type DroraAccountAccess = z.infer<typeof droraAccountAccessSchema>;

/** Active Model 固定的账号访问类别；当前商品和 Team scope 由账号服务在请求期解析。 */
export const droraProviderAccountAccessSchema = z
  .object({
    type: z.literal("zhipu-account"),
    accountType: z.enum(["zai", "bigmodel"]),
    // `highspeed` 指加速卡这一账号访问类别（隐藏 Provider + 免签网关），与模型名
    // GLM-5.1-Highspeed 无关，仅字面重合。见 docs/highspeed/highspeed-access-mode-migration.md。
    mode: z.enum([
      "start-plan",
      "individual-coding-plan",
      "team-coding-plan",
      "off-peak",
      "highspeed",
    ]),
    entitled: z.boolean(),
  })
  .strict();
export type DroraProviderAccountAccess = z.infer<typeof droraProviderAccountAccessSchema>;

export type DroraSessionMode = z.infer<typeof droraSessionModeSchema>;
export type DroraSessionKind = z.infer<typeof droraSessionKindSchema>;
export type DroraSessionGoal = z.infer<typeof droraSessionGoalSchema>;

export const droraSessionTodoItemSchema = z
  .object({
    content: nonEmptyString,
    status: z.enum(["pending", "in_progress", "completed"]),
    priority: z.enum(["high", "medium", "low"]),
  })
  .strict();
export const droraSessionGoalStatsSchema = z
  .object({
    timeUsedSeconds: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
    tokenBudget: z.number().int().positive().nullable(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    iterationCount: z.number().int().nonnegative(),
  })
  .strict();
export type DroraSessionGoalStats = z.infer<typeof droraSessionGoalStatsSchema>;
export type DroraSessionGoalVerification = z.infer<typeof droraSessionGoalVerificationSchema>;
export type DroraSessionGoalVerificationTimeline = z.infer<
  typeof droraSessionGoalVerificationTimelineSchema
>;

export const droraSessionTodoGroupSchema = z
  .object({
    id: nonEmptyString,
    source: z.enum(["goal_iteration", "session"]),
    goalIteration: z.number().int().positive().optional(),
    targetId: nonEmptyString.optional(),
    startedAt: timestampMsSchema.optional(),
    updatedAt: timestampMsSchema.optional(),
    todos: z.array(droraSessionTodoItemSchema),
  })
  .strict();
export type DroraSessionTodoGroup = z.infer<typeof droraSessionTodoGroupSchema>;

export const droraSessionSettingsStateSchema = z
  .object({
    model: z
      .object({
        // 未绑定是合法恢复状态；不能为满足协议而伪造模型或阻断历史读取。
        current: modelSelectionSchema.optional(),
        available: z.array(droraModelOptionSchema),
        lastUsed: modelSelectionSchema.optional(),
      })
      .strict(),
    thoughtLevel: z
      .object({
        enabled: z.boolean(),
        current: nonEmptyString.optional(),
        defaultLevel: nonEmptyString.optional(),
        available: z.array(droraThoughtLevelOptionSchema),
      })
      .strict(),
    mode: z
      .object({
        current: droraSessionModeSchema,
      })
      .strict(),
    permission: z
      .object({
        mode: droraSessionModeSchema.optional(),
        rulesRevision: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraSessionSettingsState = z.infer<typeof droraSessionSettingsStateSchema>;
export const droraPendingPermissionSchema = z
  .object({
    requestId: nonEmptyString,
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown().optional(),
    origin: droraInteractionRequestOriginSchema.optional(),
    options: z.array(droraPermissionOptionSchema).min(1),
    requestedAt: timestampMsSchema,
  })
  .strict();
export type DroraPendingPermission = z.infer<typeof droraPendingPermissionSchema>;

export const droraActiveToolCallSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    status: z.enum(["pending", "running", "completed", "failed", "denied"]),
    startedAt: timestampMsSchema.optional(),
  })
  .strict();
export type DroraActiveToolCall = z.infer<typeof droraActiveToolCallSchema>;

export const droraSessionProjectionSchema = z
  .object({
    sessionId: nonEmptyString,
    status: droraSessionStatusSchema,
    mode: droraSessionModeSchema,
    turnCount: z.number().int().nonnegative(),
    totalTokenCount: z.number().int().nonnegative(),
    contextUsed: z.number().int().nonnegative(),
    contextWindow: z.number().int().nonnegative(),
    currentTurnId: nonEmptyString.optional(),
    pendingPermissions: z.array(droraPendingPermissionSchema),
    activeToolCalls: z.array(droraActiveToolCallSchema),
    backgroundJobs: z.array(jsonObjectSchema),
    target: droraSessionGoalSchema.nullable().optional(),
    lastError: z
      .object({
        type: nonEmptyString,
        code: nonEmptyString.optional(),
        message: nonEmptyString,
        detail: z.string().optional(),
        attribution: errorAttributionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraSessionProjection = z.infer<typeof droraSessionProjectionSchema>;
export type DroraToolState = z.infer<typeof droraToolStateSchema>;
export const droraSlashCommandSchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    inputHint: z.string().optional(),
    source: z.enum(["builtin", "custom"]).optional(),
  })
  .strict();
export type DroraSessionApiRetryStatus = z.infer<typeof droraSessionApiRetryStatusSchema>;
export type DroraSessionContextUsage = z.infer<typeof droraSessionContextUsageSchema>;
export const droraModelStreamingKindSchema = z.enum([
  "start",
  "finish",
  "error",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "tool_call",
]);
export const droraModelStreamingEventPayloadSchema = z
  .object({
    assistantMessageId: z.string().optional(),
    delta: z.string().optional(),
    done: z.boolean().optional(),
    input: z.unknown().optional(),
    kind: droraModelStreamingKindSchema,
    partId: z.string().optional(),
    providerExecuted: z.boolean().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })
  .strict();
export const droraSessionStateSnapshotSchema = z
  .object({
    protocol: z
      .object({
        name: z.literal(DRORA_PROTOCOL_NAME),
        version: z.literal(DRORA_PROTOCOL_VERSION),
      })
      .strict(),
    session: droraSessionInfoSchema,
    settings: droraSessionSettingsStateSchema,
    projection: droraSessionProjectionSchema,
    runtime: droraSessionRuntimeStateSchema,
    messages: z.array(droraMessageWithPartsSchema),
    goalStats: droraSessionGoalStatsSchema.optional(),
    todos: z.array(droraSessionTodoItemSchema).optional(),
    todoGroups: z.array(droraSessionTodoGroupSchema).optional(),
    slashCommands: z.array(droraSlashCommandSchema).optional(),
  })
  .strict();
export type DroraSessionStateSnapshot = z.infer<typeof droraSessionStateSnapshotSchema>;

export const droraEventEnvelopeSchema = z
  .object({
    eventId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    seq: z.number().int().nonnegative(),
    traceId: nonEmptyString.optional(),
    timestamp: timestampMsSchema,
    deliveryKind: droraDeliveryKindSchema.optional(),
  })
  .strict();

const droraComputerUseOperationEventBaseSchema = z
  .object({
    eventId: nonEmptyString,
    sequenceNumber: z.number().int().nonnegative(),
    sessionId: nonEmptyString,
    timestamp: timestampMsSchema,
  })
  .strict();

const droraComputerUseTurnStartedEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-started"),
  turnId: nonEmptyString,
});
const droraComputerUseTurnCompletedEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-completed"),
  turnId: nonEmptyString,
});
const droraComputerUseTurnFailedEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("turn-failed"),
  turnId: nonEmptyString,
});
const droraComputerUseToolScheduledEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-scheduled"),
  turnId: nonEmptyString,
  toolCallId: nonEmptyString,
  toolName: nonEmptyString,
  // 这个 cell 是否在用 Computer Use。只表达布尔事实，不再携带动作名——旧的
  // operationAction 靠从模型源码里抽取动作名得到，SDK 面一变就整体失配（见
  // bootstrap/src/drora-protocol/computer-use-operation-event.ts 的 usesComputerUse）。
  // 只挂在 scheduled 上：ToolCallStartedPayload 没有 input，start 时已拿不到模型源码。
  computerUse: z.literal(true).optional(),
});
const droraComputerUseToolStartedEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("tool-started"),
  turnId: nonEmptyString.optional(),
  toolCallId: nonEmptyString,
  toolName: nonEmptyString.optional(),
});
const droraComputerUseSessionClosedEventSchema = droraComputerUseOperationEventBaseSchema.extend({
  kind: z.literal("session-closed"),
});

export const droraComputerUseOperationEventSchema = z.discriminatedUnion("kind", [
  droraComputerUseTurnStartedEventSchema,
  droraComputerUseTurnCompletedEventSchema,
  droraComputerUseTurnFailedEventSchema,
  droraComputerUseToolScheduledEventSchema,
  droraComputerUseToolStartedEventSchema,
  droraComputerUseSessionClosedEventSchema,
]);
export type DroraComputerUseOperationEvent = z.infer<typeof droraComputerUseOperationEventSchema>;

export const droraSessionEventTypeSchema = z.enum([
  "session.created",
  "session.resumed",
  "session.updated",
  "session.titleUpdated",
  "session.closed",
  "turn.started",
  "turn.steerQueued",
  "turn.steerDrained",
  "turn.completed",
  "turn.failed",
  "message.upserted",
  "message.removed",
  "part.started",
  "part.delta",
  "part.upserted",
  "part.removed",
  "model.streaming",
  "tool.updated",
  "permission.requested",
  "permission.resolved",
  "userInput.requested",
  "userInput.resolved",
  "checkpoint.created",
  "rewind.triggered",
  "streamRecovery.updated",
]);
export type DroraSessionEventType = z.infer<typeof droraSessionEventTypeSchema>;

export const droraProtocolErrorDetailSchema = z
  .object({
    type: nonEmptyString,
    message: nonEmptyString,
    stack: z.string().optional(),
    code: z.string().optional(),
    detail: z.string().optional(),
    underlyingErrorMessage: z.string().optional(),
    underlyingErrorDetail: z.string().optional(),
    attribution: errorAttributionSchema.optional(),
    retryable: z.boolean().optional(),
    data: z.unknown().optional(),
  })
  .strict();
export const droraSessionCreatedEventPayloadSchema = z
  .object({
    mode: droraSessionModeSchema,
    contextWindow: z.number().int().nonnegative(),
  })
  .strict();
export const droraSessionResumedEventPayloadSchema = z
  .object({
    directory: nonEmptyString,
    interruptedToolCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    partCount: z.number().int().nonnegative(),
    recoveredCompactTimelineCount: z.number().int().nonnegative().optional(),
    recoveredSteerInputCount: z.number().int().nonnegative().optional(),
    resumedTodoCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export const droraSessionTitleUpdatedEventPayloadSchema = z
  .object({
    messageID: nonEmptyString.optional(),
    previousTitle: z.string(),
    source: z.enum(["default", "first_input", "generated", "custom"]),
    title: z.string(),
  })
  .strict();
export const droraTurnStartedEventPayloadSchema = z
  .object({
    // CLI 的高精度执行时间可含小数；漏声明会使 strict 校验丢弃整条开始事件，Bot 因此无法清空上一轮回复。
    executionStartedAt: z.number().nonnegative().optional(),
    turnNumber: z.number().int().nonnegative(),
    input: z.string(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    inputSource: droraTurnInputSourceSchema.optional(),
    inputVisibility: droraMessageVisibilitySchema.optional(),
    executionKind: z.enum(["agent", "controlOnly"]).optional(),
    targetId: nonEmptyString.optional(),
    messageId: nonEmptyString.optional(),
    foregroundExecutionId: nonEmptyString.optional(),
    intent: jsonObjectSchema.optional(),
    originMeta: jsonObjectSchema.optional(),
    // runtime 会透传后台唤醒来源，strict schema 必须同步声明以免丢弃整条事件。
    backgroundSource: z.enum(["bash", "subagent"]).optional(),
    attachments: z.array(jsonObjectSchema).optional(),
  })
  .strict();
const droraTurnSteerSourceSchema = z.enum(["plan_approval_feedback", "workflow_refine_feedback"]);
const droraTurnSteerCommandKindSchema = z.enum(["sendText", "sendGoalCommand", "compact"]);
const droraTurnSteerDeliverySchema = z.enum(["queue", "guide"]);

export const droraTurnSteerQueuedEventPayloadSchema = z
  .object({
    pendingInputId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    input: z.string(),
    inputPreview: z.string(),
    inputSize: z.number().int().nonnegative(),
    commandKind: droraTurnSteerCommandKindSchema.optional(),
    source: droraTurnSteerSourceSchema.optional(),
    toolDisallowlist: z.array(nonEmptyString).optional(),
    delivery: droraTurnSteerDeliverySchema.optional(),
    targetTurnId: nonEmptyString,
    queueLength: z.number().int().nonnegative(),
    intent: jsonObjectSchema.optional(),
  })
  .strict();
export const droraTurnSteerDrainedEventPayloadSchema = z
  .object({
    pendingInputIds: z.array(nonEmptyString),
    queryIds: z.array(nonEmptyString).optional(),
    targetTurnId: nonEmptyString,
    injectedMessageIds: z.array(nonEmptyString),
    drainedInputs: z
      .array(
        z
          .object({
            pendingInputId: nonEmptyString,
            messageId: nonEmptyString,
            text: z.string(),
            delivery: droraTurnSteerDeliverySchema.optional(),
            intent: jsonObjectSchema.optional(),
            toolDisallowlist: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const droraTurnCompletedEventPayloadSchema = z
  .object({
    response: z.string(),
    tokenCount: z.number().int().nonnegative(),
    usage: z.unknown().optional(),
    toolCallCount: z.number().int().nonnegative(),
    historyRoundCount: z.number().int().nonnegative().optional(),
    duration: z.number().nonnegative(),
    // runtime turn.completed 会附带 cacheStats，协议 schema 之前漏掉该字段。
    // strict 校验失败会让桌面端丢掉终态事件，表现为消息已完成但 UI 一直没有回复。
    cacheStats: z
      .object({
        totalMessages: z.number().int().nonnegative(),
        cachedMessages: z.number().int().nonnegative(),
        lastCacheHit: z.boolean(),
        cacheReadTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    inputId: nonEmptyString.optional(),
    resultType: z.enum([
      "success",
      // "cancelled": 用户主动中断属于正常结束，复用 turn.completed 上报，避免被映射成 turn.failed。
      "cancelled",
      "error_max_turns",
      "error_max_budget",
      "error_during_execution",
      "error_max_tool_calls",
    ]),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const droraTurnFailedEventPayloadSchema = z
  .object({
    error: droraProtocolErrorDetailSchema,
    turnPhase: z.string(),
    inputId: nonEmptyString.optional(),
    backgroundSubagentResultConsumed: z.boolean().optional(),
  })
  .strict();
export const droraMessageUpsertedEventPayloadSchema = z
  .object({
    content: z.string(),
    attachments: z.array(z.unknown()).optional(),
    toolCalls: z.array(z.unknown()).optional(),
    type: z.string().optional(),
    compactBoundary: z.unknown().optional(),
  })
  .strict();
export const droraMessageRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
export const droraMessagePartDeltaEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    field: z.enum(["text", "reasoning", "input", "output"]).optional(),
    delta: z.string(),
  })
  .strict();
export const droraMessagePartUpsertedEventPayloadSchema = z
  .object({
    part: droraMessagePartSchema,
  })
  .strict();
export const droraMessagePartRemovedEventPayloadSchema = z
  .object({
    messageId: nonEmptyString,
    partId: nonEmptyString,
    reason: z.string().optional(),
  })
  .strict();
const droraToolCallBasePayloadSchema = z
  .object({
    toolCallId: nonEmptyString,
    toolName: z.string().optional(),
    parentToolCallId: nonEmptyString.optional(),
    source: z.enum(["subagent"]).optional(),
    agentId: nonEmptyString.optional(),
    agentType: nonEmptyString.optional(),
    // subagent mirror 会携带后台归因；strict schema 漏字段会让 session/event 整条被丢弃。
    background: z.boolean().optional(),
    childSessionId: nonEmptyString.optional(),
    childToolCallId: nonEmptyString.optional(),
    description: z.string().optional(),
  })
  .strict();

export const droraToolUpdatedEventPayloadSchema = z.discriminatedUnion("kind", [
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("scheduled"),
      // 修复：CLI 调度事件已携带所属消息 ID；漏声明会让严格校验丢弃整条事件。
      assistantMessageId: nonEmptyString.optional(),
      toolName: nonEmptyString,
      input: z.unknown().optional(),
      inputByteLength: z.number().int().nonnegative().optional(),
      inputOmitted: z.boolean().optional(),
      inputRef: z.literal("model_stream").optional(),
      dependencies: z.array(nonEmptyString).optional(),
      parallelGroupIndex: z.number().int().nonnegative().optional(),
      canRunParallel: z.boolean().optional(),
      schedule: jsonObjectSchema.optional(),
    })
    .strict(),
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("started"),
      startedAt: protocolInstantSchema,
    })
    .strict(),
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("progress"),
      elapsedMs: z.number().nonnegative().optional(),
      pid: z.number().int().optional(),
      stdoutBytes: z.number().int().nonnegative().optional(),
      stderrBytes: z.number().int().nonnegative().optional(),
      outputBytes: z.number().int().nonnegative().optional(),
      outputPreview: executionOutputPreviewSchema.optional(),
      stdoutTail: z.string().optional(),
      stderrTail: z.string().optional(),
    })
    .strict(),
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("result"),
      result: droraToolResultObjectSchema,
      duration: z.number().nonnegative(),
    })
    .strict(),
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("error"),
      error: droraProtocolErrorDetailSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("batch"),
      toolCallIds: z.array(nonEmptyString),
      successCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
    })
    .strict(),
  droraToolCallBasePayloadSchema
    .extend({
      kind: z.literal("raw"),
      payload: jsonObjectSchema,
    })
    .strict(),
]);
export const droraPermissionRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string(),
    input: z.unknown(),
    suggestedPermissionUpdates: z.array(droraPermissionUpdateSchema).optional(),
    approvalMode: z.literal("user-once").optional(),
    origin: droraInteractionRequestOriginSchema.optional(),
    options: z.array(droraPermissionOptionSchema).min(1),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const droraPermissionResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString.optional(),
    decision: droraPermissionDecisionSchema.optional(),
    reason: z.string().optional(),
    modifiedInput: z.unknown().optional(),
    inputSummary: z.unknown().optional(),
    childSessionId: nonEmptyString.optional(),
    background: z.boolean().optional(),
  })
  .strict();
export const droraUserInputRequestedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    prompt: z.string(),
    inputType: z.enum(["text", "choice", "confirm"]).optional(),
    choices: z.array(z.string()).optional(),
  })
  .strict();
export const droraUserInputResolvedEventPayloadSchema = z
  .object({
    requestId: nonEmptyString,
    value: z.unknown().optional(),
    cancelled: z.boolean().optional(),
  })
  .strict();
export const droraSessionClosedEventPayloadSchema = z
  .object({
    reason: z.string().optional(),
  })
  .strict();

function droraSessionEventEnvelopeFor<T extends DroraSessionEventType>(
  type: T,
  payload: z.ZodTypeAny,
) {
  return droraEventEnvelopeSchema.extend({
    type: z.literal(type),
    payload: payload.optional(),
  });
}

export const droraSessionEventSchema = z.discriminatedUnion("type", [
  droraSessionEventEnvelopeFor("session.created", droraSessionCreatedEventPayloadSchema),
  droraSessionEventEnvelopeFor("session.resumed", droraSessionResumedEventPayloadSchema),
  droraSessionEventEnvelopeFor("session.updated", jsonObjectSchema),
  droraSessionEventEnvelopeFor("session.titleUpdated", droraSessionTitleUpdatedEventPayloadSchema),
  droraSessionEventEnvelopeFor("session.closed", droraSessionClosedEventPayloadSchema),
  droraSessionEventEnvelopeFor("turn.started", droraTurnStartedEventPayloadSchema),
  droraSessionEventEnvelopeFor("turn.steerQueued", droraTurnSteerQueuedEventPayloadSchema),
  droraSessionEventEnvelopeFor("turn.steerDrained", droraTurnSteerDrainedEventPayloadSchema),
  droraSessionEventEnvelopeFor("turn.completed", droraTurnCompletedEventPayloadSchema),
  droraSessionEventEnvelopeFor("turn.failed", droraTurnFailedEventPayloadSchema),
  droraSessionEventEnvelopeFor("message.upserted", droraMessageUpsertedEventPayloadSchema),
  droraSessionEventEnvelopeFor("message.removed", droraMessageRemovedEventPayloadSchema),
  droraSessionEventEnvelopeFor("part.started", droraMessagePartUpsertedEventPayloadSchema),
  droraSessionEventEnvelopeFor("part.delta", droraMessagePartDeltaEventPayloadSchema),
  droraSessionEventEnvelopeFor("part.upserted", droraMessagePartUpsertedEventPayloadSchema),
  droraSessionEventEnvelopeFor("part.removed", droraMessagePartRemovedEventPayloadSchema),
  droraSessionEventEnvelopeFor("model.streaming", droraModelStreamingEventPayloadSchema),
  droraSessionEventEnvelopeFor("tool.updated", droraToolUpdatedEventPayloadSchema),
  droraSessionEventEnvelopeFor("permission.requested", droraPermissionRequestedEventPayloadSchema),
  droraSessionEventEnvelopeFor("permission.resolved", droraPermissionResolvedEventPayloadSchema),
  droraSessionEventEnvelopeFor("userInput.requested", droraUserInputRequestedEventPayloadSchema),
  droraSessionEventEnvelopeFor("userInput.resolved", droraUserInputResolvedEventPayloadSchema),
  droraSessionEventEnvelopeFor("checkpoint.created", jsonObjectSchema),
  droraSessionEventEnvelopeFor("rewind.triggered", jsonObjectSchema),
  droraSessionEventEnvelopeFor("streamRecovery.updated", jsonObjectSchema),
]);
export type DroraSessionEvent = z.infer<typeof droraSessionEventSchema>;

export const droraSessionEventsResultSchema = z
  .object({
    events: z.array(droraSessionEventSchema),
  })
  .strict();
export const droraSessionMessagesResultSchema = z
  .object({
    messages: z.array(droraMessageWithPartsSchema),
  })
  .strict();
export const droraStateUpdatedNotificationSchema = z
  .object({
    type: z.literal("state.updated"),
    scope: z.enum(["server", "workspace", "session"]),
    workspace: droraWorkspaceRefSchema.optional(),
    sessionId: nonEmptyString.optional(),
    revision: z.number().int().nonnegative(),
    reason: z.string().optional(),
    patch: z.unknown(),
  })
  .strict();
export type DroraStateUpdatedNotification = z.infer<typeof droraStateUpdatedNotificationSchema>;

export const droraSessionSubscribeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: droraDeliveryKindSchema,
    afterSeq: z.number().int().nonnegative().optional(),
    includeSnapshot: z.boolean().default(false),
  })
  .strict();
export type DroraSessionSubscribeParams = z.infer<typeof droraSessionSubscribeParamsSchema>;

export const droraSessionSubscribeResultSchema = z
  .object({
    sessionId: nonEmptyString,
    eventSeq: z.number().int().nonnegative(),
    events: z.array(droraSessionEventSchema),
    snapshot: droraSessionStateSnapshotSchema.optional(),
  })
  .strict();
export const droraSessionListResultSchema = z
  .object({
    sessions: z.array(droraSessionInfoSchema),
  })
  .strict();

const droraSessionSubagentBaseSchema = z
  .object({
    childSessionId: nonEmptyString,
    agentId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    subagentType: nonEmptyString,
    title: nonEmptyString,
    summary: z.string().optional(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const droraSessionRunningSubagentSchema = droraSessionSubagentBaseSchema.extend({
  status: z.enum(["running", "waiting", "blocked"]),
});
export type DroraSessionRunningSubagent = z.infer<typeof droraSessionRunningSubagentSchema>;

export const droraSessionEndedSubagentSchema = droraSessionSubagentBaseSchema.extend({
  status: z.enum(["success", "failed", "cancelled", "lost"]),
});
export type DroraSessionEndedSubagent = z.infer<typeof droraSessionEndedSubagentSchema>;

export const droraSessionSubagentsResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    childSessionIds: z.array(nonEmptyString),
    running: z.array(droraSessionRunningSubagentSchema),
    ended: z
      .object({
        total: z.number().int().nonnegative(),
        items: z.array(droraSessionEndedSubagentSchema),
        nextCursor: nonEmptyString.optional(),
      })
      .strict(),
  })
  .strict();
export type DroraSessionSubagentsResult = z.infer<typeof droraSessionSubagentsResultSchema>;
/** 服务端 feature key 的取值域在协议里的 zod 形态（packages/shared/src/dynamic-workflow-feature.ts）。 */
export const droraDynamicWorkflowModeSchema = z.enum(DYNAMIC_WORKFLOW_MODES);

export const droraSessionCreateParamsSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    sessionId: nonEmptyString.optional(),
    workspace: droraWorkspaceRefSchema,
    parentSessionId: nonEmptyString.optional(),
    mode: droraSessionModeSchema.optional(),
    model: modelSelectionSchema.optional(),
    persistence: droraSessionPersistenceSchema.optional(),
    thoughtLevel: nonEmptyString.optional(),
    titleGenerationEnabled: z.boolean().optional(),
    mcpServers: z.array(droraProtocolMcpServerSchema).optional(),
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    importedHistory: droraSessionImportHistorySchema.optional(),
    // host 只按本地服务装配/远程/端形态决定是否注册工具，不读取灰度；
    // 缺省不下发 = 不注册；灰度与套餐准入在实际创建的 Host handler 校验。
    offPeakToolEnabled: z.boolean().optional(),
    // 动态工作流灰度：与 offPeakToolEnabled 同一
    // 模式——host 裁决后下发，缺省不下发 = 不注册工作流工具簇（fail-closed）。
    dynamicWorkflowEnabled: z.boolean().optional(),
    // 灰度 mode 随布尔同行下发（launch.md「On demand: activation」）：`onDemand` 让 CLI 把十个
    // 工具推迟到会话首次 `/workflow` 才注册；缺席 = 按布尔行事（alwaysOn），供旧 Host 配对。
    dynamicWorkflowMode: droraDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type DroraSessionCreateParams = z.infer<typeof droraSessionCreateParamsSchema>;

export const droraSessionResumeParamsSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    sessionId: nonEmptyString,
    workspace: droraWorkspaceRefSchema.optional(),
    // 旧 session 尚无 runtime/model_selection entry 时，由同 task 的索引元数据提供迁移 hint。
    thoughtLevel: nonEmptyString.optional(),
    mcpServers: z.array(droraProtocolMcpServerSchema).optional(),
    // 冷恢复重建 runtime 时必须沿用 create 的工具面约束（否则会绕过 allow/deny，尤其 CUA 会话）。
    toolAllowlist: z.array(nonEmptyString).optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
    // 与 create 同语义；resume 不带会导致冷恢复丢 Off-Peak 工具面。
    offPeakToolEnabled: z.boolean().optional(),
    // 与 create 同语义；resume 不带会导致冷恢复丢工作流工具簇。
    dynamicWorkflowEnabled: z.boolean().optional(),
    dynamicWorkflowMode: droraDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type DroraSessionResumeParams = z.infer<typeof droraSessionResumeParamsSchema>;

export const droraSessionListParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema.optional(),
    sessionIds: z.array(nonEmptyString).min(1).max(64).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type DroraSessionListParams = z.infer<typeof droraSessionListParamsSchema>;

export const droraSessionSubagentsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    endedCursor: nonEmptyString.optional(),
    endedLimit: z.number().int().positive().max(100).default(20),
  })
  .strict();
export type DroraSessionSubagentsParams = z.infer<typeof droraSessionSubagentsParamsSchema>;

export const droraUsageStatsParamsSchema = z
  .object({
    range: z.enum(APP_USAGE_RANGES),
    timeZone: z.string().optional(),
  })
  .strict();
export const droraUsageStatsResultSchema = appUsageSnapshotSchema;
export const droraTaskTokenUsageParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
export const droraTaskTokenUsageResultSchema = z
  .object({
    sessionId: nonEmptyString,
    totalTokens: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    modelRequestCount: z.number().int().nonnegative(),
    modelErrorCount: z.number().int().nonnegative(),
    inputBaselineBySource: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export type DroraTaskTokenUsageResult = z.infer<typeof droraTaskTokenUsageResultSchema>;

export const droraSessionReadParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    deliveryKind: droraDeliveryKindSchema.optional(),
    messageLimit: z.number().int().positive().optional(),
    afterSeq: z.number().int().nonnegative().optional(),
    // "index"：仅 task index resync 使用，返回剥离 tool/reasoning/data URL 大载荷的同结构 snapshot，
    // 结果禁止回写 UI 状态；缺省等同 "full"。
    contentProfile: z.enum(["full", "index"]).optional(),
  })
  .strict();
export type DroraSessionReadParams = z.infer<typeof droraSessionReadParamsSchema>;

export const droraSessionMessagesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterMessageId: nonEmptyString.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type DroraSessionMessagesParams = z.infer<typeof droraSessionMessagesParamsSchema>;

export const droraSessionEventsParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    afterSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type DroraSessionEventsParams = z.infer<typeof droraSessionEventsParamsSchema>;

export const droraSessionRuntimePreferencesScopeSchema = z.enum([
  "runtime-materialization",
  "user-execution",
]);
export type DroraSessionRuntimePreferencesScope = z.infer<
  typeof droraSessionRuntimePreferencesScopeSchema
>;

// subagents/readRuntimeConfig 返回 Host 已解析的完整快照或显式内置回退，不再传 Markdown。
export {
  subagentRuntimeConfigSchema,
  type SubagentRuntimeConfig,
} from "../subagent-runtime-config.js";
export const droraSubagentsReadRuntimeConfigParamsSchema = z
  .object({ sessionId: nonEmptyString })
  .strict();

export const DRORA_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS = 15_000;

export const droraSessionRequestRuntimePreferencesParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    scope: droraSessionRuntimePreferencesScopeSchema,
  })
  .strict();
export type DroraSessionRequestRuntimePreferencesParams = z.infer<
  typeof droraSessionRequestRuntimePreferencesParamsSchema
>;

export const DEFAULT_DRORA_MODEL_CONTEXT_BUDGET_STRATEGY = "preflight-v1" as const;

// 3.12.2：legacy 仅为旧协议接收兼容；Runtime 一律归一为上面的共享默认策略。
export const droraModelContextBudgetStrategySchema = z.enum(["legacy", "preflight-v1"]);
export type DroraModelContextBudgetStrategy = z.infer<typeof droraModelContextBudgetStrategySchema>;

export const droraSessionRuntimePreferencesResultSchema = z
  .object({
    additionalDirectories: z.array(nonEmptyString).max(256).optional(),
    nativeSearchEnhancementsEnabled: z.boolean(),
    toolSearchMode: appToolSearchModeSchema.default("off"),
    subagentRuntimeConfigEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().default(false),
    askUserQuestionAutoResolutionEnabled: z.boolean().default(true),
    integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
    // 兼容旧 Host：缺少字段时在协议解析边界使用当前默认策略。
    modelContextBudgetStrategy: droraModelContextBudgetStrategySchema.default(
      DEFAULT_DRORA_MODEL_CONTEXT_BUDGET_STRATEGY,
    ),
    // 执行许可 E（spec §5）：新 Host 确认 CLI 的 personaControlV1 能力后才附加；
    // 旧 CLI 不收到该字段，新 CLI 对缺失值按 false（`=== true` 判定，缺省即关闭）。
    [PERSONA_RUNTIME_PREFERENCE_ENABLED]: z.boolean().optional(),
  })
  .strict();
export type DroraSessionRuntimePreferencesResult = z.infer<
  typeof droraSessionRuntimePreferencesResultSchema
>;

/**
 * App 在提交 prompt 前只读采集的 IAB 可见状态。该字段只用于 provider-visible
 * ambient context，不进入用户可见 transcript；内容有界，禁止携带页面正文或凭据。
 */
export const droraBrowserAmbientContextSchema = z
  .object({
    tabCount: z.number().int().positive().max(100),
    currentUrl: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
export type DroraBrowserAmbientContext = z.infer<typeof droraBrowserAmbientContextSchema>;

export const droraSessionSendParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    modelExecution: modelExecutionSchema.optional(),
    inputId: nonEmptyString.optional(),
    queryId: nonEmptyString.optional(),
    content: z.string(),
    attachments: z.array(jsonObjectSchema).optional(),
    browserAmbientContext: droraBrowserAmbientContextSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    expectedProviderRevision: nonEmptyString.optional(),
    automationId: nonEmptyString.optional(),
    offPeakTaskId: nonEmptyString.optional(),
    offPeakRunType: z.enum(["init", "resume"]).optional(),
    botDeliveryTarget: droraAutomationBotDeliveryTargetSchema.optional(),
    toolDenylist: z.array(nonEmptyString).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.automationId && payload.offPeakTaskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "automationId and offPeakTaskId are mutually exclusive",
      });
    }
    if (payload.offPeakRunType && !payload.offPeakTaskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "offPeakRunType requires offPeakTaskId",
        path: ["offPeakRunType"],
      });
    }
    if (payload.modelExecution && !payload.modelSelection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "modelExecution requires modelSelection",
        path: ["modelExecution"],
      });
    }
  });
export const droraSessionSendResultSchema = z
  .object({
    sessionId: nonEmptyString,
    accepted: z.literal(true),
    stateRevision: z.number().int().nonnegative(),
  })
  .strict();
export type DroraSessionSendResult = z.infer<typeof droraSessionSendResultSchema>;

export const droraSessionHistoryTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("turn"),
      turnIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message"),
      messageId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("checkpoint"),
      checkpointId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("latestCheckpoint"),
    })
    .strict(),
]);
export type DroraSessionHistoryTarget = z.infer<typeof droraSessionHistoryTargetSchema>;

export const droraSessionForkParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    target: droraSessionHistoryTargetSchema.default({
      kind: "latestCheckpoint",
    }),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DroraSessionForkParams = z.infer<typeof droraSessionForkParamsSchema>;

export const droraSessionForkResultSchema = z
  .object({
    forkedSessionId: nonEmptyString,
    parentSessionId: nonEmptyString.optional(),
    targetMessageId: nonEmptyString.optional(),
    targetCheckpointId: nonEmptyString.optional(),
    response: z.string(),
    snapshot: droraSessionStateSnapshotSchema,
  })
  .strict();
export type DroraSessionForkResult = z.infer<typeof droraSessionForkResultSchema>;

export const droraSessionCompactParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    instructions: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DroraSessionCompactParams = z.infer<typeof droraSessionCompactParamsSchema>;

export const droraSessionCompactResultSchema = z
  .object({
    response: z.string(),
    snapshot: droraSessionStateSnapshotSchema,
    compact: z
      .object({
        state: z.enum(["accepted", "already_running"]),
        inputId: nonEmptyString.optional(),
        operationId: nonEmptyString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraSessionCompactResult = z.infer<typeof droraSessionCompactResultSchema>;

export const droraSessionGoalActionSchema = z.enum([
  "show",
  "set",
  "replace",
  "pause",
  "resume",
  "clear",
]);
export type DroraSessionGoalAction = z.infer<typeof droraSessionGoalActionSchema>;

export const droraSessionGoalParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    inputId: nonEmptyString.optional(),
    action: droraSessionGoalActionSchema,
    objective: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DroraSessionGoalParams = z.infer<typeof droraSessionGoalParamsSchema>;

export const droraSessionGoalResultSchema = z
  .object({
    response: z.string(),
    snapshot: droraSessionStateSnapshotSchema,
    startedTurn: z.boolean().optional(),
  })
  .strict();
export type DroraSessionGoalResult = z.infer<typeof droraSessionGoalResultSchema>;

export const droraSessionStopParamsSchema = z
  .object({
    sessionId: nonEmptyString,
  })
  .strict();
const droraBackgroundTaskInfoStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "spawn_error",
  "lost",
]);

export const droraBackgroundTaskInfoSchema = z
  .object({
    taskId: nonEmptyString,
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    taskKind: z.enum(["bash", "subagent"]).optional(),
    blocked: z.boolean().optional(),
    blockedReason: z.string().optional(),
    cancellable: z.boolean().optional(),
    cancelRequestedAt: protocolInstantSchema.optional(),
    command: z.string().optional(),
    description: z.string().optional(),
    status: droraBackgroundTaskInfoStatusSchema,
    pid: z.number().int().positive().optional(),
    startedAt: protocolInstantSchema.optional(),
    completedAt: protocolInstantSchema.optional(),
    outputPath: z.string().optional(),
    stderrPersistedOutputPath: z.string().optional(),
    stdoutPersistedOutputPath: z.string().optional(),
    outputBytes: z.number().int().nonnegative().optional(),
    outputTruncated: z.boolean().optional(),
    outputTail: z.string().optional(),
    stderrBytes: z.number().int().nonnegative().optional(),
    stderrTail: z.string().optional(),
    stdoutBytes: z.number().int().nonnegative().optional(),
    stdoutTail: z.string().optional(),
    terminalId: nonEmptyString.optional(),
  })
  .strict();
export const droraSessionCancelBackgroundTaskParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    taskId: nonEmptyString,
  })
  .strict();
export type DroraSessionCancelBackgroundTaskParams = z.infer<
  typeof droraSessionCancelBackgroundTaskParamsSchema
>;

export const droraSessionCancelBackgroundTaskResultSchema = z
  .object({
    cancelled: z.boolean(),
    reason: z.string().optional(),
    snapshot: droraBackgroundTaskInfoSchema.optional(),
    status: droraBackgroundTaskInfoStatusSchema,
    taskId: nonEmptyString,
  })
  .strict();
export type DroraSessionCancelBackgroundTaskResult = z.infer<
  typeof droraSessionCancelBackgroundTaskResultSchema
>;

export const droraSessionSetModelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    model: modelSelectionSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type DroraSessionSetModelParams = z.infer<typeof droraSessionSetModelParamsSchema>;

export const droraSessionSetThoughtLevelParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    thoughtLevel: nonEmptyString.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: z.boolean().default(true),
  })
  .strict();
export type DroraSessionSetThoughtLevelParams = z.infer<
  typeof droraSessionSetThoughtLevelParamsSchema
>;

export const droraSessionSetModeParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    mode: droraSessionModeSchema,
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DroraSessionSetModeParams = z.infer<typeof droraSessionSetModeParamsSchema>;

export const droraSessionCloseParamsSchema = z
  .object({
    sessionId: nonEmptyString,
    expectedPersistence: droraSessionPersistenceSchema.optional(),
  })
  .strict();
export type DroraSessionCloseParams = z.infer<typeof droraSessionCloseParamsSchema>;
export const droraSessionCloseResultSchema = z
  .object({
    closed: z.boolean().optional(),
  })
  .strict();
export type DroraSessionCloseResult = z.infer<typeof droraSessionCloseResultSchema>;
export const droraWorkspaceReadPresentationParamsSchema = z
  .object({ workspace: droraWorkspaceRefSchema })
  .strict();
export const droraWorkspacePresentationSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    mode: droraSessionModeSchema,
    slashCommands: z.array(droraSlashCommandSchema),
  })
  .strict();
export type DroraWorkspacePresentation = z.infer<typeof droraWorkspacePresentationSchema>;
const workspaceHookSha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const droraWorkspaceHookTrustGrantParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    bundleDigest: workspaceHookSha256DigestSchema,
    hookDeclarationDigest: workspaceHookSha256DigestSchema,
  })
  .strict();
export type DroraWorkspaceHookTrustGrantParams = z.infer<
  typeof droraWorkspaceHookTrustGrantParamsSchema
>;
export const droraWorkspaceHookTrustGrantReasonCodeSchema = z.enum([
  "workspace_hooks_blocked_by_policy",
  "workspace_hooks_bundle_changed",
  "workspace_hooks_snapshot_mismatch",
  "workspace_hooks_policy_requires_pretrust",
  "workspace_hooks_trust_store_corrupt",
  "workspace_hooks_config_unreadable",
]);
export type DroraWorkspaceHookTrustGrantReasonCode = z.infer<
  typeof droraWorkspaceHookTrustGrantReasonCodeSchema
>;
export const droraWorkspaceHookTrustGrantResultSchema = z
  .object({
    accepted: z.boolean(),
    reasonCode: droraWorkspaceHookTrustGrantReasonCodeSchema.optional(),
  })
  .strict();
export type DroraWorkspaceHookTrustGrantResult = z.infer<
  typeof droraWorkspaceHookTrustGrantResultSchema
>;
const droraWorkspaceModelToolCallSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    input: z.unknown(),
  })
  .strict();
const droraWorkspaceModelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }).strict(),
  z.object({ role: z.literal("user"), content: z.string() }).strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(droraWorkspaceModelToolCallSchema).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      content: z.string(),
      toolCallId: nonEmptyString,
      toolName: nonEmptyString,
      isError: z.boolean().optional(),
    })
    .strict(),
]);
const droraWorkspaceModelToolSchema = z
  .object({
    name: nonEmptyString,
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

export const droraWorkspaceGenerateTextParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    selection: modelSelectionSchema,
    prompt: nonEmptyString.optional(),
    messages: z.array(droraWorkspaceModelMessageSchema).min(1).optional(),
    tools: z.array(droraWorkspaceModelToolSchema).optional(),
    querySource: nonEmptyString,
    maxOutputTokens: z.number().int().positive().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict()
  .refine((value) => value.prompt !== undefined || value.messages !== undefined, {
    message: "prompt 或 messages 至少需要提供一个",
  });
export const droraWorkspaceGenerateTextResultSchema = z
  .object({
    text: z.string(),
    selection: modelSelectionSchema,
    toolCalls: z.array(droraWorkspaceModelToolCallSchema).optional(),
    // 可选以兼容仍在运行的旧 app-server；新 CLI 始终返回结构化结束原因。
    finishReason: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().nonnegative().optional(),
        outputTokens: z.number().nonnegative().optional(),
        totalTokens: z.number().nonnegative().optional(),
        cacheReadTokens: z.number().nonnegative().optional(),
        cacheWriteTokens: z.number().nonnegative().optional(),
        reasoningTokens: z.number().nonnegative().optional(),
        serverToolUse: z
          .object({
            webSearchRequests: z.number().nonnegative().optional(),
            webFetchRequests: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraWorkspaceGenerateTextParams = z.infer<
  typeof droraWorkspaceGenerateTextParamsSchema
>;
export type DroraWorkspaceModelMessage = z.infer<typeof droraWorkspaceModelMessageSchema>;
export type DroraWorkspaceModelTool = z.infer<typeof droraWorkspaceModelToolSchema>;
export type DroraWorkspaceGenerateTextResult = z.infer<
  typeof droraWorkspaceGenerateTextResultSchema
>;
export const droraWorkspaceCancelGenerateTextParamsSchema = z
  .object({ operationId: nonEmptyString })
  .strict();
export const droraWorkspaceCancelGenerateTextResultSchema = z
  .object({ operationId: nonEmptyString, cancelled: z.boolean() })
  .strict();

export const droraProviderTestModelConnectivityParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    selection: modelSelectionSchema,
  })
  .strict();
export const droraProviderTestModelConnectivityResultSchema = z
  .object({ success: z.literal(true) })
  .strict();
export type DroraProviderTestModelConnectivityParams = z.infer<
  typeof droraProviderTestModelConnectivityParamsSchema
>;
export type DroraProviderTestModelConnectivityResult = z.infer<
  typeof droraProviderTestModelConnectivityResultSchema
>;

export const droraProviderUpdateAccountConfigParamsSchema = z
  .object({
    revision: nonEmptyString,
    basedOnDroraBuiltinRevision: nonEmptyString,
    // Provider Config 的字段校验由 @drora/provider 负责；协议层只约束可传输信封。
    providers: z.record(z.string(), z.unknown()),
    // 账号状态与 Overlay 必须一起传递，否则 Worker 会丢失非当前套餐的执行门禁。
    states: z.record(
      z.string(),
      z
        .object({
          availability: z.enum(["available", "pending", "unavailable", "unknown"]),
          entitled: z.boolean(),
          unavailableReason: accountProviderUnavailableReasonSchema.optional(),
          current: z.boolean().optional(),
          connectionKey: z.string().optional(),
          effectiveAt: z.number().finite().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export const droraProviderUpdateAccountConfigResultSchema = z
  .object({
    // 收到账号结果不代表配套 Built-in 已到达；应用版本只能读取 Registry 快照。
    receivedRevision: nonEmptyString,
    providerCount: z.number().int().nonnegative(),
    status: z.enum(["received", "unchanged"]),
  })
  .strict();
export type DroraProviderUpdateAccountConfigResult = z.infer<
  typeof droraProviderUpdateAccountConfigResultSchema
>;
/** Worker 从所属 Environment 的正式 Config Store 重建进程内 Provider Registry。 */
export const droraProviderRefreshRegistryParamsSchema = z
  .object({
    reason: nonEmptyString,
  })
  .strict();
export const droraProviderRefreshRegistryResultSchema = z
  .object({
    refreshed: z.literal(true),
  })
  .strict();
export type DroraProviderRefreshRegistryParams = z.infer<
  typeof droraProviderRefreshRegistryParamsSchema
>;
export type DroraProviderRefreshRegistryResult = z.infer<
  typeof droraProviderRefreshRegistryResultSchema
>;
export const droraInteractionPreferencesSchema = z
  .object({
    askUserQuestionAutoResolutionEnabled: z.boolean(),
  })
  .strict();
export type DroraInteractionPreferences = z.infer<typeof droraInteractionPreferencesSchema>;

export const droraWorkspaceUpdateInteractionPreferencesParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    preferences: droraInteractionPreferencesSchema,
  })
  .strict();
export type DroraWorkspaceUpdateInteractionPreferencesParams = z.infer<
  typeof droraWorkspaceUpdateInteractionPreferencesParamsSchema
>;

export const droraWorkspaceUpdateInteractionPreferencesResultSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    askUserQuestionAutoResolutionEnabled: z.boolean(),
    snoozedInteractionCount: z.number().int().nonnegative(),
  })
  .strict();
export type DroraWorkspaceUpdateInteractionPreferencesResult = z.infer<
  typeof droraWorkspaceUpdateInteractionPreferencesResultSchema
>;

export const droraModelIoPreferencesSchema = z
  .object({
    fullRetentionEnabled: z.boolean(),
  })
  .strict();
export type DroraModelIoPreferences = z.infer<typeof droraModelIoPreferencesSchema>;

export const droraWorkspaceUpdateModelIoPreferencesParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    preferences: droraModelIoPreferencesSchema,
  })
  .strict();
export type DroraWorkspaceUpdateModelIoPreferencesParams = z.infer<
  typeof droraWorkspaceUpdateModelIoPreferencesParamsSchema
>;

export const droraWorkspaceUpdateModelIoPreferencesResultSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    fullRetentionEnabled: z.boolean(),
    updatedSessionCount: z.number().int().nonnegative(),
  })
  .strict();
export type DroraWorkspaceUpdateModelIoPreferencesResult = z.infer<
  typeof droraWorkspaceUpdateModelIoPreferencesResultSchema
>;

export const droraWorkspaceUpdateOffPeakToolPolicyParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type DroraWorkspaceUpdateOffPeakToolPolicyParams = z.infer<
  typeof droraWorkspaceUpdateOffPeakToolPolicyParamsSchema
>;

export const droraWorkspaceUpdateOffPeakToolPolicyResultSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type DroraWorkspaceUpdateOffPeakToolPolicyResult = z.infer<
  typeof droraWorkspaceUpdateOffPeakToolPolicyResultSchema
>;

// 动态工作流灰度门禁：workspace 级事实，
// 与 Off-Peak 同一套 host→CLI 同步模式；旧 CLI method-not-found → host 降级忽略。
export const droraWorkspaceUpdateDynamicWorkflowPolicyParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    enabled: z.boolean(),
    // launch.md「On demand: activation」：mode 与布尔同行；缺席时 CLI 按布尔行事（alwaysOn）。
    mode: droraDynamicWorkflowModeSchema.optional(),
  })
  .strict();
export type DroraWorkspaceUpdateDynamicWorkflowPolicyParams = z.infer<
  typeof droraWorkspaceUpdateDynamicWorkflowPolicyParamsSchema
>;

export const droraWorkspaceUpdateDynamicWorkflowPolicyResultSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    enabled: z.boolean(),
  })
  .strict();
export type DroraWorkspaceUpdateDynamicWorkflowPolicyResult = z.infer<
  typeof droraWorkspaceUpdateDynamicWorkflowPolicyResultSchema
>;

export const droraPermissionRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString,
    toolName: nonEmptyString,
    reason: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    input: z.unknown(),
    origin: droraInteractionRequestOriginSchema.optional(),
    options: z.array(droraPermissionOptionSchema).min(1),
  })
  .strict();
export type DroraPermissionRequestParams = z.infer<typeof droraPermissionRequestParamsSchema>;

/** Agent 请求 app 枚举当前 workspace/session 可达且已完成握手的 browser backend。 */
export const droraBrowserListParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspaceKey: nonEmptyString,
    workspacePath: nonEmptyString,
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema,
    sessionContext: browserSessionContextKindSchema,
  })
  .strict();
export type DroraBrowserListParams = z.infer<typeof droraBrowserListParamsSchema>;

export const droraBrowserListResultSchema = browserBackendListResultSchema;
export type DroraBrowserListResult = z.infer<typeof droraBrowserListResultSchema>;

/** Agent 把一条 browser-use 命令发送给 app 执行。 */
export const droraBrowserExecuteParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    browserId: nonEmptyString.optional(),
    browserGeneration: z.number().int().nonnegative().optional(),
    workspaceKey: nonEmptyString.optional(),
    workspacePath: nonEmptyString.optional(),
    workspaceIdentity: nonEmptyString.optional(),
    remoteSessionId: nonEmptyString.optional(),
    clientMode: browserClientModeSchema.optional(),
    sessionContext: browserSessionContextKindSchema.optional(),
    command: browserCommandSchema,
  })
  .strict();
export type DroraBrowserExecuteParams = z.infer<typeof droraBrowserExecuteParamsSchema>;

// browser command result 是 app/agent 的同源协议结果；其中 duplicate_request_id 用于在真正维护
// pending/running 生命周期的边界拒绝 correlation key 冲突，不能依赖上游 UUID 概率保证。
export const droraBrowserExecuteResultSchema = browserCommandResultSchema;
export type DroraBrowserExecuteResult = z.infer<typeof droraBrowserExecuteResultSchema>;

export const droraUserInputOptionSchema = z
  .object({
    value: nonEmptyString,
    label: nonEmptyString,
    description: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();
export const droraUserInputQuestionSchema = z
  .object({
    question: nonEmptyString,
    header: nonEmptyString,
    options: z.array(droraUserInputOptionSchema).min(1),
    multiSelect: z.boolean().optional(),
  })
  .strict();
export type DroraUserInputQuestion = z.infer<typeof droraUserInputQuestionSchema>;

export const droraUserInputRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    toolCallId: nonEmptyString.optional(),
    toolName: nonEmptyString.optional(),
    prompt: z.string().optional(),
    questions: z.array(droraUserInputQuestionSchema).min(1).optional(),
    input: z.unknown().optional(),
    origin: droraInteractionRequestOriginSchema.optional(),
    schema: z.unknown().optional(),
  })
  .strict();
export type DroraUserInputRequestParams = z.infer<typeof droraUserInputRequestParamsSchema>;

export const droraUserInputResponseSchema = z
  .object({
    action: z.enum(["accept", "decline", "cancel"]),
    content: jsonObjectSchema.optional(),
    reason: z.string().optional(),
  })
  .strict();
export type DroraUserInputResponse = z.infer<typeof droraUserInputResponseSchema>;

export const droraProviderRuntimeHeadersRequestReasonSchema = z.enum(requestVerificationReasons);
export const droraProviderRuntimeHeadersRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    turnId: nonEmptyString.optional(),
    workspace: droraWorkspaceRefSchema,
    modelSelection: modelSelectionSchema,
    providerId: nonEmptyString,
    accountAccess: droraProviderAccountAccessSchema.optional(),
    expectedAccountScope: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    rejectedProjectTokenFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    reason: droraProviderRuntimeHeadersRequestReasonSchema,
  })
  .strict();
export type DroraProviderRuntimeHeadersRequestParams = z.infer<
  typeof droraProviderRuntimeHeadersRequestParamsSchema
>;

/** 请求取消只作用于同 workspace/session 的这一轮凭据刷新。 */
export const droraProviderRuntimeHeadersCancelledSchema = z
  .object({
    requestId: nonEmptyString,
    sessionId: nonEmptyString,
    workspace: droraWorkspaceRefSchema,
  })
  .strict();
export type DroraProviderRuntimeHeadersCancelled = z.infer<
  typeof droraProviderRuntimeHeadersCancelledSchema
>;

export const droraProviderRuntimeHeadersResponseSchema = z.discriminatedUnion("headersApplied", [
  z
    .object({
      headersApplied: z.literal(true),
      // 合并重接：成功必须携带当前请求的鉴权材料，不依赖旧 Registry 已被写入。
      requestAuth: z
        .object({
          apiKey: nonEmptyString.optional(),
          apiKeyId: z.string().trim().min(1).optional(),
          accountScope: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          headers: z.record(nonEmptyString, nonEmptyString).optional(),
        })
        .strict(),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      headersApplied: z.literal(false),
      errorMessage: nonEmptyString.optional(),
    })
    .strict(),
]);
export type DroraProviderRuntimeHeadersResponse = z.infer<
  typeof droraProviderRuntimeHeadersResponseSchema
>;

// ── 官方 Server MCP 鉴权──
// Agent 进程不是用户身份权威：它把 (pluginId, mcpKey, targetOrigin) 报给 host，由 host
// 解析当前 Coding Plan 凭证并回传本次请求的身份头。请求侧不含任何秘密。
// 与 interaction/requestProviderRuntimeHeaders 同类：Agent 发起、host 自动响应、零 UI。
export const droraOfficialMcpAuthHeadersRequestParamsSchema = z
  .object({
    requestId: nonEmptyString,
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString,
    mcpKey: nonEmptyString,
    targetOrigin: nonEmptyString,
  })
  .strict();
export type DroraOfficialMcpAuthHeadersRequestParams = z.infer<
  typeof droraOfficialMcpAuthHeadersRequestParamsSchema
>;

/**
 * 失败原因必须可枚举，避免调用方按文本分流；因此响应不含 errorMessage。
 *
 * `official_mcp_origin_untrusted` 是 host 侧二次校验的拒绝原因：`targetOrigin` 不等于当前
 * Drora API origin。判定只看 origin，`pluginId` / `mcpKey` 仅用于日志归属。与"未登录/无凭据"
 * 分开，才能在排查时区分"被拒绝"和"没身份"。
 */
export const droraOfficialMcpAuthFailureReasonSchema = z.enum(
  OFFICIAL_MCP_AUTH_PORT_FAILURE_REASONS,
);

export const droraOfficialMcpAuthHeadersResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      headers: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: droraOfficialMcpAuthFailureReasonSchema,
    })
    .strict(),
]);
export type DroraOfficialMcpAuthHeadersResponse = z.infer<
  typeof droraOfficialMcpAuthHeadersResponseSchema
>;

// ── Plugin management (list + enable/disable) ──
// 镜像 @drora/contracts 的 PluginMetadata, 仅保留 UI 需要的可序列化字段。
export const droraPluginOptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type DroraPluginOptionValue = z.infer<typeof droraPluginOptionValueSchema>;
export const droraPluginScopeSchema = z.enum(["user", "workspace"]);
export type DroraPluginScope = z.infer<typeof droraPluginScopeSchema>;
export const droraPluginHookDetailSchema = z
  .object({
    event: nonEmptyString,
    matcher: z.string().optional(),
    type: z.enum(["command", "process"]),
    command: nonEmptyString,
    args: z.array(z.string()).optional(),
    async: z.boolean().optional(),
    shell: z.union([z.literal(true), z.string()]).optional(),
    timeout: z.number().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    sourcePath: z.string(),
    runnable: z.boolean(),
  })
  .strict();
export const droraPluginUserConfigOptionSchema = z
  .object({
    default: droraPluginOptionValueSchema.optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    title: z.string().optional(),
    type: z.enum(["string", "number", "boolean", "directory", "file"]).optional(),
  })
  .strict();
export type DroraPluginUserConfigOption = z.infer<typeof droraPluginUserConfigOptionSchema>;

// 组件类型与详情弹窗/市场详情共用的分组顺序保持一致：agent / command / skill / hook / mcp。
// 注意：这三个 schema 必须定义在 droraPluginInfoSchema 之前，因为后者（.strict()）的 components 字段引用了它们。
export const droraPluginComponentKindSchema = z.enum(["agent", "command", "skill", "hook", "mcp"]);
export type DroraPluginComponentKind = z.infer<typeof droraPluginComponentKindSchema>;

export const droraPluginComponentItemSchema = z
  .object({
    name: nonEmptyString,
    // 描述来自组件 frontmatter（SKILL.md / command / agent）或 manifest；缺失时省略，不伪造。
    description: z.string().optional(),
  })
  .strict();
export const droraPluginComponentGroupSchema = z
  .object({
    kind: droraPluginComponentKindSchema,
    items: z.array(droraPluginComponentItemSchema),
  })
  .strict();
export type DroraPluginComponentGroup = z.infer<typeof droraPluginComponentGroupSchema>;

export const droraPluginUiSurfaceSchema = z
  .object({
    pluginId: nonEmptyString,
    pluginName: nonEmptyString,
    id: nonEmptyString.max(128),
    title: z.union([nonEmptyString, z.record(z.string(), z.string())]),
    icon: z.string().optional(),
    // 运行时 namespaced server 名（plugin:<name>:<server>），可直接用于 mcp/uiReadResource。
    server: nonEmptyString,
    resourceUri: nonEmptyString.max(2048),
    availability: z.literal("session"),
  })
  .strict();
export type DroraPluginUiSurface = z.infer<typeof droraPluginUiSurfaceSchema>;

export const droraPluginInfoSchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    source: nonEmptyString,
    marketplace: nonEmptyString,
    // manifest（plugin.json）的作者/主页回退字段；商店 listing 缺失时详情页信息区用它兜底。
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    skillCount: z.number().int().nonnegative().optional(),
    skillRootCount: z.number().int().nonnegative(),
    commandRootCount: z.number().int().nonnegative(),
    // 权威组件清单（名称 + 可选描述），由 CLI 对插件根目录枚举得出，与启用态无关。
    // 详情 UI 直接展示，取代旧的「数量取协议、名称靠 UI 侧 join」脆弱方案。optional 兼容旧 payload。
    components: z.array(droraPluginComponentGroupSchema).optional(),
    uiSurfaces: z.array(droraPluginUiSurfaceSchema).optional(),
    declaredMcpServerNames: z.array(z.string()).optional(),
    hostMcpServerNames: z.array(z.string()).optional(),
    mcpServerNames: z.array(z.string()),
    hookDetails: z.array(droraPluginHookDetailSchema).optional(),
    rootPath: z.string(),
    userConfig: z.record(z.string(), droraPluginUserConfigOptionSchema).optional(),
    configuredOptions: z.record(z.string(), droraPluginOptionValueSchema).optional(),
    // 缺省表示 package 可用；missing 用于保留已声明但目标 Host 尚未物化的配置行。
    packageStatus: z.literal("missing").optional(),
    rootSource: droraPluginScopeSchema.optional(),
    enabledSource: droraPluginScopeSchema.optional(),
    optionSources: z.record(z.string(), droraPluginScopeSchema).optional(),
  })
  .strict();
export type DroraPluginInfo = z.infer<typeof droraPluginInfoSchema>;

export const droraPluginDiagnosticSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["warning", "error"]).optional(),
    pluginId: z.string().optional(),
  })
  .strict();
export type DroraPluginDiagnostic = z.infer<typeof droraPluginDiagnosticSchema>;

export const droraPluginsListParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    configScope: droraPluginScopeSchema.optional(),
  })
  .strict();
export const droraPluginsListResultSchema = z
  .object({
    plugins: z.array(droraPluginInfoSchema),
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict();
export type DroraPluginsListResult = z.infer<typeof droraPluginsListResultSchema>;

// ── 插件 UI 面板入口──
// 工作区级只读投影：已启用插件清单 `ui.surfaces[]` 的合法条目；插件启停后 host 重新拉取。
export const droraPluginsListUiSurfacesParamsSchema = z
  .object({ workspace: droraWorkspaceRefSchema })
  .strict();
export type DroraPluginsListUiSurfacesParams = z.infer<
  typeof droraPluginsListUiSurfacesParamsSchema
>;
export const droraPluginsListUiSurfacesResultSchema = z
  .object({ surfaces: z.array(droraPluginUiSurfaceSchema) })
  .strict();
export type DroraPluginsListUiSurfacesResult = z.infer<
  typeof droraPluginsListUiSurfacesResultSchema
>;

// ── Plugin 对话引用 catalog（docs/plugin-reference-mention.md）──
// Session-scoped 只读投影：带 sessionId → 该 Session 创建时冻结的身份 catalog；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。身份与能力字段保持
// identifiers-only，不携带 rootPath/配置等；可选 icon/displayName(I18n)/description(I18n)
// 仅供 UI 展示与 Picker 搜索，不参与身份、权限或 runtime reminder。
export const droraPluginReferenceCatalogEntrySchema = z
  .object({
    // 仅 referenceCatalogWithCategory 返回；旧入口保持原结构。
    category: nonEmptyString.optional(),
    pluginId: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    icon: z.string().optional(),
    // 商店 listing 的 display-only 本地化显示名投影（沿 icon 先例）：让 Picker 能按
    // 中文显示名搜索/展示；locale 解析复用 shared 的 plugin-display-name helper。
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    // 仅供 Picker 展示，不进入能力身份或 model-only reminder。
    description: z.string().optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean(),
    // 非空 = 与其他 enabled Plugin 共享 manifest name 的 V1 fail closed 冲突：
    // Picker 禁选并展示原因，runtime 解析按 ambiguous 跳过。
    conflictingPluginIds: z.array(nonEmptyString),
    skillQualifiedNames: z.array(nonEmptyString),
    mcpServerNames: z.array(nonEmptyString),
    // 旧 Host 不投影该字段时按空数组兼容；只有新 Agent 会把它用于 reminder live 交集。
    subagentNames: z.array(nonEmptyString).default([]),
  })
  .strict();
export type DroraPluginReferenceCatalogEntry = z.infer<
  typeof droraPluginReferenceCatalogEntrySchema
>;

export const droraPluginsReferenceCatalogParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    // 已有 Session 的 Picker 必须带 sessionId 才能拿到 session-owned catalog；
    // session 不存在时按协议错误 fail closed，禁止静默回退 workspace authority。
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type DroraPluginsReferenceCatalogParams = z.infer<
  typeof droraPluginsReferenceCatalogParamsSchema
>;
export const droraPluginsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    plugins: z.array(droraPluginReferenceCatalogEntrySchema),
  })
  .strict();
export type DroraPluginsReferenceCatalogResult = z.infer<
  typeof droraPluginsReferenceCatalogResultSchema
>;

// ── Skill 对话引用 catalog──
// 新草稿读取 workspace 当前目录；已有 Session 读取 AgentRuntime 首次 context
// 初始化时冻结的发现结果。该协议只承载 Composer 的只读引用投影，不替代 Settings
// 的 Skill 管理接口，也不持久化 runtime 快照。
export const droraSkillReferenceCatalogEntrySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    description: z.string(),
    path: nonEmptyString,
    scope: z.enum(["workspace", "user", "plugin"]),
    enabled: z.literal(true),
    pluginName: nonEmptyString.optional(),
  })
  .strict();
export type DroraSkillReferenceCatalogEntry = z.infer<typeof droraSkillReferenceCatalogEntrySchema>;

export const droraSkillsReferenceCatalogParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    // 带 sessionId 时必须命中该进程内的 resident Session；未知 Session fail closed，
    // 禁止回退到 workspace 当前目录而把新 Skill 泄漏进旧对话。
    sessionId: nonEmptyString.optional(),
  })
  .strict();
export type DroraSkillsReferenceCatalogParams = z.infer<
  typeof droraSkillsReferenceCatalogParamsSchema
>;
export const droraSkillsReferenceCatalogResultSchema = z
  .object({
    authority: z.enum(["session", "workspace"]),
    skills: z.array(droraSkillReferenceCatalogEntrySchema),
  })
  .strict();
export type DroraSkillsReferenceCatalogResult = z.infer<
  typeof droraSkillsReferenceCatalogResultSchema
>;

// ── 已保存工作流的 GUI 中枢──
// workspace 级、无会话的五个方法，照 skills/referenceCatalog 的先例：每次调用现扫
// `<cwd>/.drora/workflows/`（挂载时快照会漏掉手改的文件）。形状与 @drora/contracts 的
// saved-workflow.ts 逐字对齐——依赖方向是 contracts → shared，所以这里结构化地再声明一遍，
// 而不是 import；两边的 strict 形状由 bootstrap 侧的协议测试互相钉住。
export const droraSavedWorkflowArgTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type DroraSavedWorkflowArgType = z.infer<typeof droraSavedWorkflowArgTypeSchema>;
export const droraSavedWorkflowArgDeclarationSchema = z
  .object({
    type: droraSavedWorkflowArgTypeSchema,
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();
export type DroraSavedWorkflowArgDeclaration = z.infer<
  typeof droraSavedWorkflowArgDeclarationSchema
>;
export const droraSavedWorkflowArgsDeclarationSchema = z.record(
  z.string(),
  droraSavedWorkflowArgDeclarationSchema,
);
export type DroraSavedWorkflowArgsDeclaration = z.infer<
  typeof droraSavedWorkflowArgsDeclarationSchema
>;
export const droraSavedWorkflowMetaSchema = z
  .object({
    description: nonEmptyString,
    whenToUse: nonEmptyString.optional(),
    args: droraSavedWorkflowArgsDeclarationSchema.optional(),
  })
  .strict();
export type DroraSavedWorkflowMeta = z.infer<typeof droraSavedWorkflowMetaSchema>;
// 作用域两档：项目档落 `<cwd>/.drora/workflows/`、全局档落 agent 机器的 `~/.drora/workflows/`。作用域由文件所在目录推得，frontmatter 不存 scope。
export const droraSavedWorkflowScopeSchema = z.enum(["project", "global"]);
export type DroraSavedWorkflowScope = z.infer<typeof droraSavedWorkflowScopeSchema>;
export const droraSavedWorkflowEntrySchema = z
  .object({
    name: nonEmptyString,
    description: z.string(),
    whenToUse: z.string().optional(),
    args: droraSavedWorkflowArgsDeclarationSchema.optional(),
    scope: droraSavedWorkflowScopeSchema,
    path: nonEmptyString,
  })
  .strict();
export type DroraSavedWorkflowEntry = z.infer<typeof droraSavedWorkflowEntrySchema>;
export const droraSavedWorkflowInvalidEntrySchema = z
  .object({ path: nonEmptyString, reason: nonEmptyString })
  .strict();
export type DroraSavedWorkflowInvalidEntry = z.infer<typeof droraSavedWorkflowInvalidEntrySchema>;
/** 名字非法 / 未找到 / frontmatter 坏 / 读错——与 core store 的 resolve 失败四态逐字对应。 */
export const droraSavedWorkflowFailureReasonSchema = z.enum([
  "invalid_name",
  "not_found",
  "parse_error",
  "read_error",
]);
export type DroraSavedWorkflowFailureReason = z.infer<typeof droraSavedWorkflowFailureReasonSchema>;
const droraSavedWorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: droraSavedWorkflowFailureReasonSchema,
    detail: z.string().optional(),
  })
  .strict();

export const droraWorkflowsListParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    // 缺省即 `project`（本项目档）。给 `global` 时改扫本机 `~/.drora/workflows/`；此时 `workspace`
    // 仍必填，但只是**载体运行时**——协议处理器对全局档不读它的路径。
    scope: droraSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type DroraWorkflowsListParams = z.infer<typeof droraWorkflowsListParamsSchema>;
export const droraWorkflowsListResultSchema = z
  .object({
    workflows: z.array(droraSavedWorkflowEntrySchema),
    invalid: z.array(droraSavedWorkflowInvalidEntrySchema),
    // 扫过的目录（本地绝对路径），即使目录还不存在也回：GUI 的文件监听靠它 watch。
    dir: nonEmptyString,
  })
  .strict();
export type DroraWorkflowsListResult = z.infer<typeof droraWorkflowsListResultSchema>;

export const droraWorkflowsGetParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    name: nonEmptyString,
    // 缺省 `project`；`global` 时只查本机全局根。`workspace` 语义同 list（全局档只当载体）。
    scope: droraSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type DroraWorkflowsGetParams = z.infer<typeof droraWorkflowsGetParamsSchema>;
export const droraWorkflowsGetResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      name: nonEmptyString,
      path: nonEmptyString,
      scope: droraSavedWorkflowScopeSchema,
      meta: droraSavedWorkflowMetaSchema,
      /** 脚本本体（frontmatter 之后逐字节），即被类型检查与执行的那一份。 */
      script: z.string(),
    })
    .strict(),
  droraSavedWorkflowFailureSchema,
]);
export type DroraWorkflowsGetResult = z.infer<typeof droraWorkflowsGetResultSchema>;

export const droraWorkflowsUpdateMetaParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    name: nonEmptyString,
    meta: droraSavedWorkflowMetaSchema,
    // 缺省 `project`；`global` 时只写本机全局根那一份。`workspace` 语义同 list。
    scope: droraSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type DroraWorkflowsUpdateMetaParams = z.infer<typeof droraWorkflowsUpdateMetaParamsSchema>;
export const droraWorkflowsUpdateMetaResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  droraSavedWorkflowFailureSchema,
]);
export type DroraWorkflowsUpdateMetaResult = z.infer<typeof droraWorkflowsUpdateMetaResultSchema>;

export const droraWorkflowsDeleteParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    name: nonEmptyString,
    // 缺省 `project`；`global` 时按 scope 选根删除（不再写死 roots[0]）。`workspace` 语义同 list。
    scope: droraSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type DroraWorkflowsDeleteParams = z.infer<typeof droraWorkflowsDeleteParamsSchema>;
export const droraWorkflowsDeleteResultSchema = z.union([
  z.object({ ok: z.literal(true), path: nonEmptyString }).strict(),
  droraSavedWorkflowFailureSchema,
]);
export type DroraWorkflowsDeleteResult = z.infer<typeof droraWorkflowsDeleteResultSchema>;

export const DRORA_WORKFLOWS_RUNS_MAX_LIMIT = 50;
export const droraWorkflowsRunsParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    /** 只要这个名字的 run（`dwf_run.name` 字面等值）；缺省即本项目全部 run。 */
    name: nonEmptyString.optional(),
    limit: z.number().int().min(1).max(DRORA_WORKFLOWS_RUNS_MAX_LIMIT),
    // 缺省 `project`：只查 `dwf_run.cwd === workspacePath` 的 run。`global` 时**不**按 cwd 过滤，
    // 跨所有项目取该名字的运行历史（全局工作流在任何项目里跑，历史因此跨 cwd）；结果行带 `cwd`
    // 供 GUI 标项目。`workspace` 语义同 list（全局档只当载体）。
    scope: droraSavedWorkflowScopeSchema.optional(),
  })
  .strict();
export type DroraWorkflowsRunsParams = z.infer<typeof droraWorkflowsRunsParamsSchema>;
// 三终态词汇：errored = 脚本之错，stopped = 被停下（可恢复）。
export const droraSavedWorkflowRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "errored",
  "stopped",
]);
export type DroraSavedWorkflowRunStatus = z.infer<typeof droraSavedWorkflowRunStatusSchema>;
export const droraSavedWorkflowRunStopReasonSchema = z.enum([
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
]);
export const droraSavedWorkflowRunSchema = z
  .object({
    runId: nonEmptyString,
    name: z.string().optional(),
    status: droraSavedWorkflowRunStatusSchema,
    // `status === "stopped"` 才在场。
    stopReason: droraSavedWorkflowRunStopReasonSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    spentTokens: z.number(),
    /** 发起它的会话与 CreateWorkflow 工具调用：有这两个才能从中枢打开实例详情。老行可缺。 */
    parentSessionId: z.string().optional(),
    toolCallId: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    // 实际运行的项目目录（`dwf_run.cwd`）。全局档的 `workflows/runs` 跨 cwd 查询，GUI 用它给
    // 每行标项目；项目档变体里它恒等于 workspacePath，GUI 可忽略。老行可缺。
    cwd: z.string().optional(),
    // 这次运行发布的**用户面产物**：中枢的运行历史行在
    // 状态词之后画一串 kind chips，详情页头部的「最近产物」条取最近一次 completed run 的这一份。
    // ⚠ 术语：这里的 artifact 是脚本经 `artifact.*` 发布给用户看的产出，不是脚本的顶层返回值。
    // 只带 chip 画得下的字段（≤ 8 件，取最新版的元数据）；字节与条目经 v4 查询按需读。
    // optional，照上面 `cwd` 的先例：老 CLI 不发，少一个键是退化不是错误。
    artifacts: z
      .array(
        z
          .object({
            id: nonEmptyString,
            kind: z.enum(["file", "markdown", "chart", "table", "metrics", "board"]),
            title: z.string().optional(),
            version: z.number(),
            contentType: z.string().optional(),
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .strict();
export type DroraSavedWorkflowRun = z.infer<typeof droraSavedWorkflowRunSchema>;
export const droraWorkflowsRunsResultSchema = z
  .object({
    runs: z.array(droraSavedWorkflowRunSchema),
    /** 为真时才在场：还有更多 run 没进这一页（多取一条判定，不是 length === limit）。 */
    truncated: z.literal(true).optional(),
  })
  .strict();
export type DroraWorkflowsRunsResult = z.infer<typeof droraWorkflowsRunsResultSchema>;

// workflows/move：把本机全局根的同名文件搬到 `workspace` 项目根。**只此一向**：项目→全局不是搬文件而是模型的概括（「提升为
// 全局」在该项目开新会话、经 SaveWorkflow 另存），所以没有 `to` 参数。同机同用户，rename 优先、EXDEV
// 回落 copy+unlink；逐字节搬，不改内容（frontmatter 不存 scope）；`move` 不覆盖——目标已存在即拒绝
// （覆盖是 SaveWorkflow 经确认窗才有的动作，不变式 7）。`workspace` 既是载体运行时也是目标项目。
export const droraWorkflowsMoveParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    name: nonEmptyString,
  })
  .strict();
export type DroraWorkflowsMoveParams = z.infer<typeof droraWorkflowsMoveParamsSchema>;
export const droraWorkflowsMoveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      /** 源落点路径（全局根，搬走前）。 */
      from: nonEmptyString,
      /** 目标落点路径（项目根，搬到处）。 */
      to: nonEmptyString,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      // target_exists：目标档已有同名（move 不覆盖）；not_found：源档没有这个名字；
      // read_error / write_error：搬运时的 I/O 失败；invalid_name：名字先验没过。
      reason: z.enum(["invalid_name", "not_found", "target_exists", "read_error", "write_error"]),
      path: z.string().optional(),
      detail: z.string().optional(),
    })
    .strict(),
]);
export type DroraWorkflowsMoveResult = z.infer<typeof droraWorkflowsMoveResultSchema>;

// ── 从一次 run 保存工作流（docs/dynamic-workflow/transcript-and-notifications.md「Saving the
// run, and running it again」）──
// 完成卡的「直接保存」走这条：**不收脚本，只收 runId**——要写的那份正文是这次 run 实际执行的
// 脚本，agent 从 journal 记录（`scriptText`）里读。脚本不经 GUI 走一圈有两个后果值得写下来：
// 修订过的 run 存下的是**结算它的**那一份，而工具行入参被快照裁成预览的老对话也照样存得出
// 同样的字节。名字合法性、覆盖、遮��与类型检查全部复用 SaveWorkflow 的同一套实现（不变式 3）。
/** 另一档已有同名定义（遮蔽事实）；与 contracts 的 SavedWorkflowShadowing 逐字对齐。 */
export const droraSavedWorkflowShadowingSchema = z.enum(["hides_global", "hidden_by_project"]);
export type DroraSavedWorkflowShadowing = z.infer<typeof droraSavedWorkflowShadowingSchema>;

export const droraWorkflowsSaveParamsSchema = z
  .object({
    // 两用：既是载体运行时，也是这次 run 的项目——journal 在它那里，项目根也在它那里。
    // 全局档同样带它（与 list/get 的「全局只当载体」不同）：脚本必须从这个 agent 的 journal 读。
    workspace: droraWorkspaceRefSchema,
    runId: nonEmptyString,
    name: nonEmptyString,
    meta: droraSavedWorkflowMetaSchema,
    // 缺省 `project`。
    scope: droraSavedWorkflowScopeSchema.optional(),
    // 只有 GUI 已经把覆盖警告摆给用户看过时才为 true；缺省即「目标已存在就拒绝」——
    // 覆盖是用户的决定，不是一次保存的副作用（与 `workflows/move` 不覆盖同一条纪律）。
    overwrite: z.boolean().optional(),
  })
  .strict();
export type DroraWorkflowsSaveParams = z.infer<typeof droraWorkflowsSaveParamsSchema>;
export const droraWorkflowsSaveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      name: nonEmptyString,
      scope: droraSavedWorkflowScopeSchema,
      path: nonEmptyString,
      /** 写的那一刻重新判定，不回抄入参里的 `overwrite`（与 SaveWorkflow 的 `overwritten` 同源）。 */
      overwritten: z.boolean(),
      shadowing: droraSavedWorkflowShadowingSchema.optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      // run_not_found：journal 里没有这条 run；script_missing：老记录没存脚本原文；
      // target_exists：目标已存在而调用方没说覆盖；compile_failed：类型检查没过，一个字节都没写。
      reason: z.enum([
        "invalid_name",
        "run_not_found",
        "script_missing",
        "target_exists",
        "compile_failed",
        "write_error",
      ]),
      path: z.string().optional(),
      detail: z.string().optional(),
    })
    .strict(),
]);
export type DroraWorkflowsSaveResult = z.infer<typeof droraWorkflowsSaveResultSchema>;

// ── 一次 run 对应哪个已保存工作流 ──
// 完成卡的「已保存」芯片与「再次运行」都问这一个问题，而答案**推导得来、不记在卡上**：重开
// 会话、换一个窗口保存、在对话里保存，都走同一条判定。判定住在 agent 一侧，因为两份事实
// （run 的 journal 记录与磁盘上的定义）都在那里；返回解析好的 entry，用户后来删掉的那一份
// 因此会自动不再算数。
/** 转写自对话的候选：模型用 `SaveWorkflow` 存过、并在入参里认领了这次 run。 */
export const droraWorkflowsForRunCandidateSchema = z
  .object({ name: nonEmptyString, scope: droraSavedWorkflowScopeSchema.optional() })
  .strict();
export type DroraWorkflowsForRunCandidate = z.infer<typeof droraWorkflowsForRunCandidateSchema>;
/** 候选上界：一次 run 在一段对话里被存过的次数远小于它。 */
export const DRORA_WORKFLOWS_FOR_RUN_MAX_CANDIDATES = 8;
export const droraWorkflowsForRunParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    runId: nonEmptyString,
    candidates: z
      .array(droraWorkflowsForRunCandidateSchema)
      .max(DRORA_WORKFLOWS_FOR_RUN_MAX_CANDIDATES)
      .optional(),
  })
  .strict();
export type DroraWorkflowsForRunParams = z.infer<typeof droraWorkflowsForRunParamsSchema>;
export const droraWorkflowsForRunResultSchema = z
  .object({
    /** 命中的定义；缺席即这次 run 还没有对应的已保存工作流。 */
    entry: droraSavedWorkflowEntrySchema.optional(),
    /** 命中的是哪一条规则（诊断与测试用；UI 只看 entry 在不在）。 */
    match: z.enum(["candidate", "script", "name"]).optional(),
    /** 这次 run 跑时用的实参（journal 原样），供「再次运行」预填实参窗。 */
    runArgs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type DroraWorkflowsForRunResult = z.infer<typeof droraWorkflowsForRunResultSchema>;

// 推荐 Prompt 的可信插件解析：UI 不拆解 stableId，也不从旧目录快照推断可安装性。
export const droraPluginSuggestedReferenceStatusSchema = z.enum([
  "ready",
  "disabled",
  "missing",
  "conflict",
  "unavailable",
]);
export type DroraPluginSuggestedReferenceStatus = z.infer<
  typeof droraPluginSuggestedReferenceStatusSchema
>;
export const droraPluginOperationStateSchema = z.enum([
  "checking",
  "refreshing",
  "installing",
  "enabling",
  "cancelling",
  "cancelled",
  "complete",
  "failed",
]);
export type DroraPluginOperationState = z.infer<typeof droraPluginOperationStateSchema>;
export const droraPluginOperationProgressNotificationSchema = z
  .object({
    operationId: nonEmptyString,
    state: z.literal("refreshing"),
  })
  .strict();
export type DroraPluginOperationProgressNotification = z.infer<
  typeof droraPluginOperationProgressNotificationSchema
>;
export const droraPluginsResolveSuggestedReferenceParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    stableId: nonEmptyString,
    operationId: nonEmptyString,
    clientMode: droraDeliveryKindSchema,
    deliveryKind: droraDeliveryKindSchema,
  })
  .strict();
export type DroraPluginsResolveSuggestedReferenceParams = z.infer<
  typeof droraPluginsResolveSuggestedReferenceParamsSchema
>;
export const droraPluginsSetEnabledParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString,
    enabled: z.boolean(),
    operationId: nonEmptyString.optional(),
    scope: droraPluginScopeSchema.optional(),
  })
  .strict();
export const droraPluginsSetEnabledResultSchema = z
  .object({
    plugin: droraPluginInfoSchema,
    enabled: z.boolean(),
  })
  .strict();
export type DroraPluginsSetEnabledResult = z.infer<typeof droraPluginsSetEnabledResultSchema>;

// 商店信息（Store Listing）：目录条目携带的展示性元数据（显示名/icon/分类/作者/链接/hero/
// 示例提示词），全部可选，UI 缺失时按降级矩阵处理（字母头像/隐藏区块/省略信息行）。
// i18n 采用 `<字段>I18n` map，locale 解析复用 shared 的 plugin-display-name helper。
export const droraPluginStoreListingSchema = z
  .object({
    displayName: z.string().optional(),
    displayNameI18n: z.record(z.string(), z.string()).optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
    icon: z.string().optional(),
    category: z.string().optional(),
    publisherType: z.enum(["official", "community"]).optional(),
    author: z.string().optional(),
    authorUrl: z.string().optional(),
    homepage: z.string().optional(),
    privacyPolicy: z.string().optional(),
    termsOfService: z.string().optional(),
    heroImage: z.string().optional(),
    examplePrompts: z.array(z.string()).optional(),
    examplePromptsI18n: z.record(z.string(), z.array(z.string())).optional(),
    /**
     * 需要付费套餐才好用的插件：市场目录条目声明 `requiresPaidPlan: true`，
     * UI 在标题右侧展示提示图标。描述的是「使用条件」而非「插件是收费商品」——
     * 不参与安装门禁与计费，命名也不绑定具体套餐商品名。
     */
    requiresPaidPlan: z.boolean().optional(),
  })
  .strict();
export type DroraPluginStoreListing = z.infer<typeof droraPluginStoreListingSchema>;

export const droraPluginsResolveSuggestedReferenceResultSchema = z
  .object({
    stableId: nonEmptyString,
    status: droraPluginSuggestedReferenceStatusSchema,
    marketplace: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    sourceTrust: z.literal("official").optional(),
    // 官方 Marketplace listing 的可选展示投影；不参与身份、安装或权限判断。
    icon: z.string().optional(),
    listing: droraPluginStoreListingSchema.optional(),
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "ready" && value.status !== "disabled" && value.status !== "missing") {
      return;
    }
    if (!value.marketplace || !value.pluginName || value.sourceTrust !== "official") {
      context.addIssue({
        code: "custom",
        message: "actionable suggested Plugin results require trusted install identity",
      });
    }
  });
export type DroraPluginsResolveSuggestedReferenceResult = z.infer<
  typeof droraPluginsResolveSuggestedReferenceResultSchema
>;

export const droraPluginMarketplaceSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    source: jsonObjectSchema,
    description: z.string().optional(),
    lastUpdated: z.string().optional(),
    pluginCount: z.number().int().nonnegative(),
    isOfficial: z.boolean().optional(),
    // 目录顶层 featured 策展名单（商店「公开」分段 Featured 区）。
    featured: z.array(z.string()).optional(),
    refreshFailure: z
      .object({
        code: z.string(),
        failedAt: z.string(),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraPluginMarketplaceSummary = z.infer<typeof droraPluginMarketplaceSummarySchema>;

export const droraAvailablePluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    installed: z.boolean(),
    componentTypes: z.array(z.string()).optional(),
    listing: droraPluginStoreListingSchema.optional(),
  })
  .strict();
export type DroraAvailablePluginSummary = z.infer<typeof droraAvailablePluginSummarySchema>;

export const droraInstalledPluginSummarySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    marketplace: nonEmptyString,
    description: z.string().optional(),
    version: z.string().optional(),
    enabled: z.boolean(),
    scope: droraPluginScopeSchema,
    installPath: z.string().optional(),
    installedAt: z.string().optional(),
    componentTypes: z.array(z.string()).optional(),
    hookDetails: z.array(droraPluginHookDetailSchema).optional(),
    updateStatus: z.enum(["none", "update-available", "version-changed"]).optional(),
    latestVersion: z.string().optional(),
    listing: droraPluginStoreListingSchema.optional(),
  })
  .strict();
export type DroraInstalledPluginSummary = z.infer<typeof droraInstalledPluginSummarySchema>;

export const droraPluginsOverviewParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    configScope: droraPluginScopeSchema.optional(),
  })
  .strict();
export const droraPluginsOverviewResultSchema = z
  .object({
    marketplaces: z.array(droraPluginMarketplaceSummarySchema),
    availablePlugins: z.array(droraAvailablePluginSummarySchema),
    installedPlugins: z.array(droraInstalledPluginSummarySchema),
    restorableBuiltins: z.array(droraAvailablePluginSummarySchema),
    diagnostics: z.array(droraPluginDiagnosticSchema),
    capability: z
      .object({
        supported: z.boolean(),
        reason: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type DroraPluginsOverviewResult = z.infer<typeof droraPluginsOverviewResultSchema>;

export const droraPluginsMarketplaceAddParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    source: nonEmptyString,
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const droraPluginsMarketplaceRemoveParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    marketplace: nonEmptyString,
  })
  .strict();
export const droraPluginsMarketplaceUpdateParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    marketplace: nonEmptyString.optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const droraPluginsMarketplaceMutationResultSchema = z
  .object({
    marketplace: droraPluginMarketplaceSummarySchema.optional(),
    marketplaces: z.array(droraPluginMarketplaceSummarySchema).optional(),
    diagnostics: z.array(droraPluginDiagnosticSchema).optional(),
  })
  .strict();
export type DroraPluginsMarketplaceMutationResult = z.infer<
  typeof droraPluginsMarketplaceMutationResultSchema
>;

export const droraPluginsInstallParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
    scope: droraPluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
    operationId: nonEmptyString.optional(),
  })
  .strict();
export const droraPluginsCancelOperationParamsSchema = z
  .object({
    operationId: nonEmptyString,
  })
  .strict();
export type DroraPluginsCancelOperationParams = z.infer<
  typeof droraPluginsCancelOperationParamsSchema
>;

export const droraPluginsCancelOperationResultSchema = z
  .object({
    operationId: nonEmptyString,
    cancelled: z.boolean(),
  })
  .strict();
export type DroraPluginsCancelOperationResult = z.infer<
  typeof droraPluginsCancelOperationResultSchema
>;
export const droraPluginsUninstallParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    removeCache: z.boolean().optional(),
  })
  .strict();
export const droraPluginsInstallResultSchema = z
  .object({
    installedPlugins: z.array(droraInstalledPluginSummarySchema),
    dependencyClosure: z.array(z.string()),
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict();
export type DroraPluginsInstallResult = z.infer<typeof droraPluginsInstallResultSchema>;

export const droraPluginsUninstallResultSchema = z
  .object({
    removedPlugin: droraInstalledPluginSummarySchema.optional(),
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict();
export type DroraPluginsUninstallResult = z.infer<typeof droraPluginsUninstallResultSchema>;

export const droraPluginsUpdateParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
  })
  .strict();
export const droraPluginsRestoreBuiltinParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString,
  })
  .strict();
export const droraPluginsRestoreBuiltinResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict();
export type DroraPluginsRestoreBuiltinResult = z.infer<
  typeof droraPluginsRestoreBuiltinResultSchema
>;

export const droraPluginsConfigureParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString,
    options: jsonObjectSchema,
    clearOptionKeys: z.array(nonEmptyString).optional(),
    scope: droraPluginScopeSchema.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
export const droraPluginsConfigureResultSchema = z
  .object({
    pluginId: nonEmptyString,
    diagnostics: z.array(droraPluginDiagnosticSchema),
  })
  .strict();
export type DroraPluginsConfigureResult = z.infer<typeof droraPluginsConfigureResultSchema>;

export const droraPluginsResetConfigParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginId: nonEmptyString,
    scope: droraPluginScopeSchema.optional(),
  })
  .strict();
export type DroraPluginsResetConfigParams = z.infer<typeof droraPluginsResetConfigParamsSchema>;

export const droraPluginsValidateParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginName: nonEmptyString.optional(),
    marketplace: nonEmptyString.optional(),
    source: nonEmptyString.optional(),
  })
  .strict();
export const droraPluginsValidateResultSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: z.array(droraPluginDiagnosticSchema),
    compatibility: z
      .object({
        runnable: z.array(z.string()),
        diagnosticOnly: z.array(z.string()),
        unsupported: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type DroraPluginsValidateResult = z.infer<typeof droraPluginsValidateResultSchema>;

// plugins/describe：按需枚举单个插件的组件「名称 + 描述」。
// 已安装插件读本地缓存目录；未安装候选按需解析/临时 clone 源后枚举再清理。
export const droraPluginsDescribeParamsSchema = z
  .object({
    workspace: droraWorkspaceRefSchema,
    pluginName: nonEmptyString,
    marketplace: nonEmptyString,
  })
  .strict();
export const droraPluginsDescribeResultSchema = z
  .object({
    components: z.array(droraPluginComponentGroupSchema),
    diagnostics: z.array(droraPluginDiagnosticSchema).optional(),
    // 插件包内 plugin.json 的展示性回退字段；未安装候选详情页信息区在商店 listing 缺失时兜底。
    metadata: z
      .object({
        author: z.string().optional(),
        authorUrl: z.string().optional(),
        homepage: z.string().optional(),
        version: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DroraPluginsDescribeResult = z.infer<typeof droraPluginsDescribeResultSchema>;

export const droraAutomationScheduleRuleSchema = z
  .object({
    unit: z.enum(["minute", "hourly", "daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().positive(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    anchorAt: z.number().int(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    monthDays: z.array(z.number().int().min(1).max(31)).optional(),
    /** yearly 用：1-12 人类月份。缺省回退 anchorAt 的月份（兼容未写该字段的旧记录）。 */
    months: z.array(z.number().int().min(1).max(12)).optional(),
    monthlyMode: z.enum(["date", "weekday"]).optional(),
  })
  .strict();
export type DroraAutomationScheduleRuleProtocol = z.infer<typeof droraAutomationScheduleRuleSchema>;

/** 会话侧长间隔周期 carrier 的 unit 枚举（与 scheduleRule.unit 同集）。 */
export const droraAutomationIntervalUnitSchema = z.enum([
  "minute",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const droraAutomationProtocolSchema = z
  .object({
    automationId: nonEmptyString,
    title: z.string(),
    cronExpr: nonEmptyString,
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: droraTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    enabled: z.boolean(),
    lifecycleStatus: z.enum(["active", "completed", "failed", "paused"]),
    nextRunAt: timestampMsSchema.optional(),
    lastRunAt: timestampMsSchema.optional(),
    runCount: z.number().int().nonnegative(),
    recurring: z.boolean(),
    maxRuns: z.number().int().positive().optional(),
    // 自定义重复规则；缺省时调度回退到解析 cronExpr。会话卡片必须读到本字段才能展示
    // cron 无法表达的真实间隔（如每50小时、每40天，兼容 cronExpr 只是 0 * * * *）。
    scheduleRule: droraAutomationScheduleRuleSchema.optional(),
  })
  .strict();
export type DroraAutomationProtocol = z.infer<typeof droraAutomationProtocolSchema>;

export const droraAutomationCreateParamsSchema = z
  .object({
    title: z.string().optional(),
    cronExpr: nonEmptyString,
    relativeDelayMinutes: z.number().int().positive().max(525_600).optional(),
    prompt: nonEmptyString,
    modelSelection: modelSelectionSchema.optional(),
    mode: droraTaskModeSchema.optional(),
    targetTaskId: nonEmptyString.optional(),
    botDeliveryTarget: droraAutomationBotDeliveryTargetSchema.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().optional(),
    // 会话侧自定义重复 carrier：每 N 分钟/小时/天/周/月/年均通过此字段归一化为权威 scheduleRule，
    // cronExpr 仅作合法兼容展示。
    intervalUnit: droraAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  // intervalUnit 与 interval 必须配对提交（只传一个无法确定真实间隔）。
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  // 周期 carrier 与一次性相对延迟语义冲突，禁止同传。
  .refine((input) => input.intervalUnit === undefined || input.relativeDelayMinutes === undefined, {
    message: "intervalUnit cannot combine with a relative delayMinutes",
    path: ["intervalUnit"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine((input) => input.intervalUnit === undefined || input.maxRuns === undefined, {
    message: "intervalUnit is a recurring carrier and cannot combine with maxRuns",
    path: ["maxRuns"],
  });
export type DroraAutomationCreateProtocolParams = z.infer<typeof droraAutomationCreateParamsSchema>;

export const droraAutomationCreateResultSchema = z
  .object({ automation: droraAutomationProtocolSchema })
  .strict();
export type DroraAutomationCreateProtocolResult = z.infer<typeof droraAutomationCreateResultSchema>;

export const droraAutomationUpdateParamsSchema = z
  .object({
    automationId: nonEmptyString,
    title: nonEmptyString.optional(),
    cronExpr: nonEmptyString.optional(),
    prompt: nonEmptyString.optional(),
    recurring: z.boolean().optional(),
    maxRuns: z.number().int().positive().nullable().optional(),
    // 会话侧自定义重复 carrier（同 create 侧语义）。
    intervalUnit: droraAutomationIntervalUnitSchema.optional(),
    interval: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.cronExpr !== undefined ||
      input.prompt !== undefined ||
      input.recurring !== undefined ||
      input.maxRuns !== undefined ||
      input.intervalUnit !== undefined,
    { message: "automation update requires at least one field" },
  )
  .refine((input) => input.maxRuns !== null || input.recurring === true, {
    message: "clearing maxRuns requires recurring=true",
    path: ["maxRuns"],
  })
  .refine((input) => input.recurring !== true || typeof input.maxRuns !== "number", {
    message: "recurring=true cannot be combined with a numeric maxRuns",
    path: ["maxRuns"],
  })
  // intervalUnit 与 interval 必须配对提交（同 create 侧语义）。
  .refine((input) => (input.intervalUnit === undefined) === (input.interval === undefined), {
    message: "intervalUnit and interval must be set together",
    path: ["interval"],
  })
  .refine((input) => input.intervalUnit === undefined || input.recurring !== false, {
    message: "intervalUnit is a recurring carrier and cannot combine with recurring=false",
    path: ["recurring"],
  })
  .refine(
    (input) =>
      input.intervalUnit === undefined ||
      input.maxRuns === undefined ||
      (input.maxRuns === null && input.recurring === true),
    {
      message:
        "intervalUnit is a recurring carrier and only allows maxRuns=null with recurring=true",
      path: ["maxRuns"],
    },
  );
export type DroraAutomationUpdateProtocolParams = z.infer<typeof droraAutomationUpdateParamsSchema>;
export const droraAutomationUpdateResultSchema = z
  .object({ automation: droraAutomationProtocolSchema })
  .strict();
export type DroraAutomationUpdateProtocolResult = z.infer<typeof droraAutomationUpdateResultSchema>;

export const droraAutomationListParamsSchema = z.object({}).strict();
export type DroraAutomationListProtocolParams = z.infer<typeof droraAutomationListParamsSchema>;
export const droraAutomationListResultSchema = z
  .object({ automations: z.array(droraAutomationProtocolSchema) })
  .strict();
export type DroraAutomationListProtocolResult = z.infer<typeof droraAutomationListResultSchema>;

export const droraAutomationCheckTaskBindingParamsSchema = z
  .object({ targetTaskId: nonEmptyString })
  .strict();
export type DroraAutomationCheckTaskBindingProtocolParams = z.infer<
  typeof droraAutomationCheckTaskBindingParamsSchema
>;
export const droraAutomationCheckTaskBindingResultSchema = z
  .object({ bound: z.boolean() })
  .strict();
export type DroraAutomationCheckTaskBindingProtocolResult = z.infer<
  typeof droraAutomationCheckTaskBindingResultSchema
>;

export const droraAutomationDeleteParamsSchema = z
  .object({ automationId: nonEmptyString })
  .strict();
export type DroraAutomationDeleteProtocolParams = z.infer<typeof droraAutomationDeleteParamsSchema>;
export const droraAutomationDeleteResultSchema = z.object({ deleted: z.boolean() }).strict();
export type DroraAutomationDeleteProtocolResult = z.infer<typeof droraAutomationDeleteResultSchema>;

// ---- Off-Peak（闲时任务）会话内创建协议----
// 与 automation 兄弟并列（独立域，禁止互相复用标记/表）。workspace 由 host 端从
// 当前 session 注入，不进协议参数（对称 automation/create）。permissionMode 只开放产品
// 四档词表（D29-4）；缺省解析在 host 端（D49-4：yolo / allowed_models 末位 / 最高推理档）。
export const droraOffPeakPermissionModeSchema = z.enum([
  "build",
  "edit",
  "plan",
  "yolo",
  "guarded",
]);
export type DroraOffPeakProtocolPermissionMode = z.infer<typeof droraOffPeakPermissionModeSchema>;

export const droraOffPeakCreateParamsSchema = z
  .object({
    title: nonEmptyString,
    prompt: nonEmptyString,
    permissionMode: droraOffPeakPermissionModeSchema.optional(),
    model: nonEmptyString.optional(),
    thoughtLevel: nonEmptyString.optional(),
    // 会话内创建绑定当前会话（对齐 automation/create 的 targetTaskId），由 CLI 端口填入。
    boundSessionId: nonEmptyString.optional(),
  })
  .strict();
export type DroraOffPeakCreateProtocolParams = z.infer<typeof droraOffPeakCreateParamsSchema>;

// 协议侧任务快照：轮尾卡片与 OffPeakList 的最小字段面。
// 不暴露 serverTicketId（跨边界禁带）。
export const droraOffPeakTaskSnapshotSchema = z
  .object({
    offPeakTaskId: nonEmptyString,
    title: z.string(),
    status: z.enum(["queued", "paused", "running", "completed", "failed", "cancelled"]),
    queuePosition: z.number().int().positive().optional(),
    sessionId: nonEmptyString.optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type DroraOffPeakTaskProtocolSnapshot = z.infer<typeof droraOffPeakTaskSnapshotSchema>;

// 失败分类跨协议保真（镜像 shared OffPeakTaskCreateResult 的判别联合，错误不降级为字符串）。
// model 白名单预校失败复用 client_validation 分类 + errorCode "model_not_allowed"，不扩分类枚举。
export const droraOffPeakCreateResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: droraOffPeakTaskSnapshotSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      failureStage: z.enum(["client_validation", "ticket_request", "local_persist"]),
      errorCategory: z.enum([
        "client_validation",
        "eligibility_3101",
        "quota_3103",
        "network",
        "invalid_response",
        "local_persist",
        "unknown",
      ]),
      errorCode: z.string(),
    })
    .strict(),
]);
export type DroraOffPeakCreateProtocolResult = z.infer<typeof droraOffPeakCreateResultSchema>;

export const droraOffPeakListParamsSchema = z.object({}).strict();
export type DroraOffPeakListProtocolParams = z.infer<typeof droraOffPeakListParamsSchema>;
export const droraOffPeakListResultSchema = z
  .object({ tasks: z.array(droraOffPeakTaskSnapshotSchema) })
  .strict();
export type DroraOffPeakListProtocolResult = z.infer<typeof droraOffPeakListResultSchema>;

// ---- Knowledge（VaultView）agent 检索协议----
// agent 的只读 vault 检索入口（obsidian-knowledge.md §5f）：CLI VaultSearch 工具 →
// bootstrap 协议端口 → host droraAgentService 分发 → 进程内 IKnowledgeQueryService。
// 与 UI 检索同一条服务链（scope/sourceEpoch/coverage 语义全继承 §5b），agent 是第二个
// 消费方而非第二条链。入参只有 query + limit——§5b.1「无日期/路径范围过滤」对 agent
// 面同样成立；协议面不携带 decisionConsentId（决策出站与该工具无涉，§5d.6 零出站）。
export const droraKnowledgeSearchParamsSchema = z
  .object({
    // 原样查询文本；≤512 字符（与 KnowledgeCreateRunParams 同口径），由 host 服务校验兜底。
    query: nonEmptyString.max(512),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type DroraKnowledgeSearchProtocolParams = z.infer<typeof droraKnowledgeSearchParamsSchema>;

export const droraKnowledgeSearchCandidateSchema = z
  .object({
    // 稳定文章 id = sha256(vaultId + relativePath)；不含根路径，可安全出站（§5d.6 同口径）。
    articleId: nonEmptyString,
    relativePath: z.string(),
    title: z.string(),
    matchedHeading: z.string().nullable(),
    // 命中 chunk 的原文逐字节选（≤240 字符，§5b.5 命中感知窗口）。
    excerpt: z.string(),
    quote: z
      .object({
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
      })
      .strict(),
    rank: z.number().int().positive(),
    matchedChunkCount: z.number().int().positive(),
  })
  .strict();
export type DroraKnowledgeSearchProtocolCandidate = z.infer<
  typeof droraKnowledgeSearchCandidateSchema
>;

export const droraKnowledgeSearchResultSchema = z
  .object({
    // KnowledgeQueryStatus 直通（retrieving 不会出现在 search 落定后）。
    status: z.enum([
      "ready",
      "partial",
      "empty",
      "no_source",
      "source_stale",
      "cancelled",
      "failed",
    ]),
    // failed 的机器可读原因；不含绝对路径与笔记内容（§5b.6）。
    reason: z.string().nullable(),
    candidates: z.array(droraKnowledgeSearchCandidateSchema),
    diagnostics: z
      .object({
        // 索引 coverage 截断如实呈现（§5b.4）；无源为 null。
        coveragePartial: z.boolean().nullable(),
        // 检索是否自动扩大了一次（§5b.5 降级）；无源为 null。
        matchRelaxedToOr: z.boolean().nullable(),
        // 语义阶段词表（§5b.5）：unavailable/applied/skipped。
        semantic: z.enum(["unavailable", "applied", "skipped"]),
        // 向量独有进入候选池的数量（§5b.9 混合召回，additive 可选；旧 host 不带此键）。
        semanticRecalled: z.number().int().nonnegative().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type DroraKnowledgeSearchProtocolResult = z.infer<typeof droraKnowledgeSearchResultSchema>;

// ── Persona P0 管理方法（spec §4/§10、合同 §3/§4.1；wire 名单一出处 contracts/persona.ts）──
// 无会话管理：方法在 CLI 协议 server 注册，经 Host 的 CLI 控制连接代理；不 session/create、
// 不生成占位会话；控制域由服务绑定，params 不接受任意文件路径/dataRoot。未知字段拒绝（strict）。
// 管理结果统一 PersonaManagementResult 信封（ok/value | ok/code），code 取 contracts
// PERSONA_ERROR_CODES 封闭枚举；capture 的正常 omitted reason 不走管理错误通道。

const personaErrorCodeSchema = z.enum(
  Object.values(PERSONA_ERROR_CODES) as [PersonaErrorCode, ...PersonaErrorCode[]],
);

function personaManagementResultSchema<Value extends z.ZodType>(value: Value) {
  return z.union([
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), code: personaErrorCodeSchema }).strict(),
  ]);
}

const personaEditableCoreSchema = z
  .object({
    displayName: z.string(),
    selfDescription: z.string(),
    warmth: z.enum(["restrained", "balanced", "warm"]),
    directness: z.enum(["gentle", "balanced", "direct"]),
    humor: z.enum(["off", "light"]),
  })
  .strict();

const personaOverviewSchema = z.union([
  z
    .object({
      state: z.literal("initialized"),
      personaId: z.string().min(1),
      schemaVersion: z.number().int().nonnegative(),
      coreRevision: z.number().int().nonnegative(),
      templateVersion: z.number().int().nonnegative(),
      compilerVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ state: z.literal("uninitialized") }).strict(),
]);

const personaCoreSnapshotSchema = z.union([
  z
    .object({
      state: z.literal("current"),
      coreRevision: z.number().int().nonnegative(),
      core: personaEditableCoreSchema,
      template: z
        .object({
          templateVersion: z.number().int().nonnegative(),
          compilerVersion: z.number().int().nonnegative(),
          identityStatement: z.string(),
          principles: z.array(z.string()),
          capabilityHonesty: z.string(),
          relationshipBoundary: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      state: z.literal("built_in_preview"),
      core: personaEditableCoreSchema,
      template: z
        .object({
          templateVersion: z.number().int().nonnegative(),
          compilerVersion: z.number().int().nonnegative(),
          identityStatement: z.string(),
          principles: z.array(z.string()),
          capabilityHonesty: z.string(),
          relationshipBoundary: z.string(),
        })
        .strict(),
    })
    .strict(),
]);

const personaCoreMutationResultSchema = z.union([
  z
    .object({ status: z.literal("saved"), coreRevision: z.number().int().nonnegative() })
    .strict(),
  z.object({ status: z.literal("unchanged") }).strict(),
]);

const personaInitializeResultSchema = z.intersection(
  personaOverviewSchema,
  z.object({ status: z.enum(["created", "unchanged"]) }).strict(),
);

const personaPreviewResultSchema = z
  .object({
    text: z.string(),
    templateVersion: z.number().int().nonnegative(),
    compilerVersion: z.number().int().nonnegative(),
  })
  .strict();

export const droraPersonaGetOverviewParamsSchema = z.object({}).strict();
export const droraPersonaGetOverviewResultSchema = personaManagementResultSchema(
  personaOverviewSchema,
);
export type DroraPersonaOverviewResult = z.infer<typeof droraPersonaGetOverviewResultSchema>;

export const droraPersonaInitializeParamsSchema = z
  .object({ mutationId: nonEmptyString })
  .strict();
export const droraPersonaInitializeResultSchema = personaManagementResultSchema(
  personaInitializeResultSchema,
);
export type DroraPersonaInitializeResult = z.infer<typeof droraPersonaInitializeResultSchema>;

export const droraPersonaGetCoreParamsSchema = z.object({}).strict();
export const droraPersonaGetCoreResultSchema =
  personaManagementResultSchema(personaCoreSnapshotSchema);
export type DroraPersonaCoreResult = z.infer<typeof droraPersonaGetCoreResultSchema>;

export const droraPersonaUpdateCoreParamsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    patch: personaEditableCoreSchema.partial(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaUpdateCoreResultSchema =
  personaManagementResultSchema(personaCoreMutationResultSchema);
export type DroraPersonaCoreMutationResult = z.infer<typeof droraPersonaUpdateCoreResultSchema>;

export const droraPersonaResetCoreParamsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaResetCoreResultSchema = droraPersonaUpdateCoreResultSchema;

export const droraPersonaPreviewParamsSchema = z
  .object({
    draft: personaEditableCoreSchema,
    situationId: nonEmptyString.optional(),
  })
  .strict();
export const droraPersonaPreviewResultSchema =
  personaManagementResultSchema(personaPreviewResultSchema);
export type DroraPersonaPreviewResult = z.infer<typeof droraPersonaPreviewResultSchema>;

// 独立应用状态查询（合同 §3 getPersonaApplication）：sessionId+turnId 寻址当前 Runtime；
// 重启后无内存记录即 not_available，不伪造冷历史。Host 代理走该会话的 CLI 连接。
export const droraPersonaGetApplicationParamsSchema = z
  .object({ sessionId: nonEmptyString, turnId: nonEmptyString })
  .strict();
export const droraPersonaGetApplicationResultSchema = z
  .object({
    status: z.enum(["applied", "omitted", "not_available"]),
    turnId: nonEmptyString.optional(),
    reason: z.string().max(256).optional(),
  })
  .strict();
export type DroraPersonaGetApplicationParams = z.infer<
  typeof droraPersonaGetApplicationParamsSchema
>;
export type DroraPersonaGetApplicationResult = z.infer<
  typeof droraPersonaGetApplicationResultSchema
>;

// ── P1a 使用策略/交流默认/导出（合同 §1.2/§2/§3/§4.2/§7；spec §5/§8/§9）──
// 受控四键与枚举值引用 shared contracts 单一出处；未知 key/value 由服务层 validation_failed
// 拒绝。忘记是逻辑撤销屏障（generation++），无 unchanged 终态；导出无资料返回 uninitialized
// 且不为导出初始化默认身份。

const personaPreferenceKeySchema = z.enum([
  PERSONA_PREFERENCE_KEYS.replyLanguage,
  PERSONA_PREFERENCE_KEYS.explanationDetail,
  PERSONA_PREFERENCE_KEYS.preferredAddress,
  PERSONA_PREFERENCE_KEYS.collaborationStyle,
]);

export const droraPersonaSetPolicyParamsSchema = z
  .object({
    expectedPolicyRevision: z.number().int().nonnegative(),
    usePreferences: z.boolean(),
    // P1b（合同 §3「usePreferences/autoLearn/预算 patch」）：L patch，缺省＝保持当前值。
    // 关 U 的级联（同事务关 L、撤租约、清候选/负载）由存储侧执行，与本字段取值无关。
    autoLearn: z.boolean().optional(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaSetPolicyResultSchema = personaManagementResultSchema(
  z.union([
    z
      .object({
        status: z.literal("saved"),
        policyRevision: z.number().int().nonnegative(),
        policyEpoch: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ status: z.literal("unchanged") }).strict(),
  ]),
);
export type DroraPersonaSetPolicyResult = z.infer<typeof droraPersonaSetPolicyResultSchema>;

export const droraPersonaSavePreferenceParamsSchema = z
  .object({
    key: personaPreferenceKeySchema,
    value: z.string().max(512),
    expectedRevision: z.number().int().nonnegative(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaSavePreferenceResultSchema = personaManagementResultSchema(
  z.union([
    z
      .object({
        status: z.literal("saved"),
        revision: z.number().int().nonnegative(),
        keyGeneration: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ status: z.literal("unchanged") }).strict(),
  ]),
);
export type DroraPersonaSavePreferenceResult = z.infer<
  typeof droraPersonaSavePreferenceResultSchema
>;

export const droraPersonaForgetPreferenceParamsSchema = z
  .object({
    key: personaPreferenceKeySchema,
    expectedRevision: z.number().int().nonnegative(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaForgetPreferenceResultSchema = personaManagementResultSchema(
  z
    .object({
      status: z.literal("forgotten"),
      revision: z.number().int().nonnegative(),
      keyGeneration: z.number().int().nonnegative(),
    })
    .strict(),
);
export type DroraPersonaForgetPreferenceResult = z.infer<
  typeof droraPersonaForgetPreferenceResultSchema
>;

export const droraPersonaListPreferencesParamsSchema = z.object({}).strict();
export const droraPersonaListPreferencesResultSchema = personaManagementResultSchema(
  z
    .object({
      preferences: z
        .array(
          z
            .object({
              key: personaPreferenceKeySchema,
              // active 槽为当前值；forgotten 槽为空串（应用可访问正文已清）。
              value: z.string(),
              revision: z.number().int().nonnegative(),
              keyGeneration: z.number().int().nonnegative(),
              // P1b（合同 §1.2）：自动提取＝extraction/inferred。旧 CLI 不带新字段时
              // 缺省回 settings/explicit（可选字段，不做 .default 注入以保持 wire 纯净）。
              provenanceKind: z.enum(["settings", "extraction"]),
              epistemicStatus: z.enum(["explicit", "inferred"]),
              pinned: z.boolean(),
              // P1b 争议/抑制/候选关联（合同 §6）。disputed/autoSuppressed 解析后必填
              // （z.default）：P1a 时代的直通 fixture/旧 CLI 不带这两个键，按「无争议/
              // 未抑制」缺省解析；新 CLI（personaControlV1 双端同版发货）恒发。缺省值
              // 只是对旧 wire 载荷的解析 accommodation，不是跨版本语义承诺。
              disputed: z.boolean().default(false),
              autoSuppressed: z.boolean().default(false),
              pendingCandidate: z
                .object({
                  proposedValue: z.string(),
                  evidenceId: nonEmptyString,
                  expectedGeneration: z.number().int().nonnegative(),
                  createdAt: z.number().int().nonnegative(),
                })
                .strict()
                .optional(),
              updatedAt: z.number().int().nonnegative(),
              status: z.enum(["active", "forgotten"]),
            })
            .strict(),
        )
        .max(16),
    })
    .strict(),
);
export type DroraPersonaListPreferencesResult = z.infer<
  typeof droraPersonaListPreferencesResultSchema
>;

export const droraPersonaPrepareExportParamsSchema = z.object({}).strict();
export const droraPersonaPrepareExportResultSchema = personaManagementResultSchema(
  z
    .object({
      format: z.literal(PERSONA_EXPORT_FORMAT),
      formatVersion: z.literal(PERSONA_EXPORT_FORMAT_VERSION),
      capturedAt: nonEmptyString,
      coreRevision: z.number().int().nonnegative(),
      policyRevision: z.number().int().nonnegative(),
      core: personaEditableCoreSchema,
      templateVersion: z.number().int().nonnegative(),
      compilerVersion: z.number().int().nonnegative(),
      preferences: z
        .array(
          z
            .object({
              key: personaPreferenceKeySchema,
              value: z.string(),
              revision: z.number().int().nonnegative(),
              provenanceKind: z.literal("settings"),
              epistemicStatus: z.literal("explicit"),
            })
            .strict(),
        )
        .max(16),
      omittedCounts: z
        .object({ inferredOmittedUnverifiable: z.number().int().nonnegative() })
        .strict(),
      limitations: z.array(z.string()),
    })
    .strict(),
);
export type DroraPersonaPrepareExportResult = z.infer<
  typeof droraPersonaPrepareExportResultSchema
>;

// ── P1b 有限学习管理（合同 §3 allowLearningForKey 与 P1b 读侧概览；spec §5/§8）──
// allowLearningForKey：解除该键抑制并 generation++（合同 §4.2「只接受之后的新机会」）；
// CAS 前置是该键当前 generation（槽缺席按 0）。争议不由它解决——保存/忘记才是争议解决路径。
// getPersonaLearningOverview：来源/预算/工作概览读侧；行形状与 adapters 仓储只读方法
// （readSnapshot.policy / readLearningBudgetUsage / readInferredSlotSources）逐键对齐，
// 计数与 bootstrap 学习消费者 PersonaLearningCounters 逐键对齐（P1a 教训：wire strict 与
// 仓储行形状冲突只能在协议分发测试里暴露）。上界引用 shared PERSONA_LEARNING_BUDGET。

export const droraPersonaAllowLearningParamsSchema = z
  .object({
    key: personaPreferenceKeySchema,
    expectedGeneration: z.number().int().nonnegative(),
    mutationId: nonEmptyString,
  })
  .strict();
export const droraPersonaAllowLearningResultSchema = personaManagementResultSchema(
  z.union([
    z
      .object({
        status: z.literal("saved"),
        revision: z.number().int().nonnegative(),
        keyGeneration: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ status: z.literal("unchanged") }).strict(),
  ]),
);
export type DroraPersonaAllowLearningResult = z.infer<
  typeof droraPersonaAllowLearningResultSchema
>;

export const droraPersonaGetLearningOverviewParamsSchema = z.object({}).strict();
export const droraPersonaGetLearningOverviewResultSchema = personaManagementResultSchema(
  z.union([
    z
      .object({
        state: z.literal("initialized"),
        policy: z
          .object({
            usePreferences: z.boolean(),
            autoLearn: z.boolean(),
            policyRevision: z.number().int().nonnegative(),
            policyEpoch: z.number().int().nonnegative(),
            learningGeneration: z.number().int().nonnegative(),
          })
          .strict(),
        // UTC 日预算台账（adapters readLearningBudgetUsage 行）；上界常量由 UI 从
        // shared PERSONA_LEARNING_BUDGET 取，不在 wire 重复。
        budget: z
          .object({
            day: nonEmptyString,
            attemptsUsed: z
              .number()
              .int()
              .nonnegative()
              .max(PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax),
            inputTokensUsed: z
              .number()
              .int()
              .nonnegative()
              .max(PERSONA_LEARNING_BUDGET.dailyInputTokensMax),
            outputTokensUsed: z
              .number()
              .int()
              .nonnegative()
              .max(PERSONA_LEARNING_BUDGET.dailyOutputTokensMax),
          })
          .strict(),
        // inferred 槽合并来源定位（无正文；每键 ≤mergedSourcesMaxPerKey、全表 ≤键数×上界）。
        sources: z
          .array(
            z
              .object({
                key: personaPreferenceKeySchema,
                evidenceId: nonEmptyString,
                workspaceKey: nonEmptyString,
                sessionId: nonEmptyString,
              })
              .strict(),
          )
          .max(
            Object.keys(PERSONA_PREFERENCE_KEYS).length *
              PERSONA_LEARNING_BUDGET.mergedSourcesMaxPerKey,
          ),
        // 本 CLI 进程学习消费者计数（固定类别；跨进程不聚合，UI 不得当全局事实展示）。
        counters: z
          .object({
            received: z.number().int().nonnegative(),
            droppedQueueFull: z.number().int().nonnegative(),
            acceptAccepted: z.number().int().nonnegative(),
            acceptAlreadyAccepted: z.number().int().nonnegative(),
            acceptSkipped: z.record(z.string(), z.number().int().nonnegative()),
            workApplied: z.number().int().nonnegative(),
            workNoChange: z.number().int().nonnegative(),
            workRejected: z.number().int().nonnegative(),
            workRetryWait: z.number().int().nonnegative(),
            workConflicts: z.number().int().nonnegative(),
            orchestrationErrors: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    z.object({ state: z.literal("uninitialized") }).strict(),
  ]),
);
export type DroraPersonaGetLearningOverviewResult = z.infer<
  typeof droraPersonaGetLearningOverviewResultSchema
>;


export const droraProtocolMethods = {
  runtimeCapabilities: "runtime/capabilities",
  computerUseOperationEvent: "computer-use/operation-event",
  sessionCreate: "session/create",
  sessionResume: "session/resume",
  sessionList: "session/list",
  sessionSubagents: "session/subagents",
  sessionRequestRuntimePreferences: "session/requestRuntimePreferences",
  subagentsReadRuntimeConfig: "subagents/readRuntimeConfig",
  sessionRead: "session/read",
  sessionMessages: "session/messages",
  sessionEvents: "session/events",
  sessionDebug: "session/debug",
  sessionSubscribe: "session/subscribe",
  // @deprecated（部分）：send 主路径已收敛 v4 sendText；仅剩 adapter 附件
  // 回退分支消费（v4 attachmentRef 上传/寄存命令面未建模），待附件命令面落地后移除。
  sessionSend: "session/send",
  // @deprecated：host 客户端方法已删（stop 已收敛 v4 stop 命令）。
  // wire case 留兼容（transport bypass 名单仍引用），随旧词整体删除时一并移除。
  sessionStop: "session/stop",
  // @deprecated：host 客户端方法已删（已收敛 v4 cancelBackgroundWork 命令）。
  // wire case 留兼容，随旧词整体删除时一并移除。
  sessionCancelBackgroundTask: "session/cancelBackgroundTask",
  // @deprecated：host 客户端方法已删（v4 forkAssistant 原生 handler 经
  // forkSessionAtMessage 钩子直调 server-operations.forkSession op）。wire case 与
  // fork params/result schema 保留＝op 存活面；fork record 归 v4 原生重写。
  sessionFork: "session/fork",
  sessionCompact: "session/compact",
  sessionGoal: "session/goal",
  sessionClose: "session/close",
  // setModel 仍被 droraSessionService 的 desktop 旧链路消费；replayable
  // switchModelConfig 已直接由目标 Environment Registry 解析 Selection。
  sessionSetModel: "session/setModel",
  // replayable facade 的思考深度/模式已收敛 v4 switchModelConfig/
  // switchCollaborationMode；剩余消费 = droraSessionService（desktop 旧链路，随
  // 桌面 v4 UI 收口清零）与 setMode 的 auto 值残留（v4 值域刻意排除 auto）。
  sessionSetThoughtLevel: "session/setThoughtLevel",
  sessionSetMode: "session/setMode",
  workspaceReadPresentation: "workspace/readPresentation",
  workspaceHookTrustGrant: "workspace/hooks/trustGrant",
  // 进程级 Account Provider Config 与 workspace 运行目录分离。
  providerUpdateAccountConfig: "provider/updateAccountConfig",
  providerRefreshRegistry: "provider/refreshRegistry",
  workspaceUpdateInteractionPreferences: "workspace/updateInteractionPreferences",
  workspaceUpdateModelIoPreferences: "workspace/updateModelIoPreferences",
  // Off-Peak 工具面门禁是 workspace 级事实（灰度 + 本地/远程），由 host 在 agent 就绪时同步；
  // CLI 对 legacy create/resume 与 v4 冷恢复统一读取。旧 CLI method-not-found → host 降级忽略。
  workspaceUpdateOffPeakToolPolicy: "workspace/updateOffPeakToolPolicy",
  // 动态工作流灰度门禁：同 Off-Peak 的同步模式。
  workspaceUpdateDynamicWorkflowPolicy: "workspace/updateDynamicWorkflowPolicy",
  // LLM 执行面在 CLI，直连不可行；消费仅 services 内部
  // （commit message），待 v4 workspace 查询/命令面覆盖后移除。
  workspaceGenerateText: "workspace/generateText",
  workspaceCancelGenerateText: "workspace/cancelGenerateText",
  providerTestModelConnectivity: "provider/testModelConnectivity",
  mcpList: "mcp/list",
  mcpReadResource: "mcp/readResource",
  mcpUiOpenInstance: "mcp/uiOpenInstance",
  mcpUiCloseInstance: "mcp/uiCloseInstance",
  mcpUiValidateInstance: "mcp/uiValidateInstance",
  mcpUiSampling: "mcp/uiSampling",
  mcpUiCancelSampling: "mcp/uiCancelSampling",
  mcpUiCallTool: "mcp/uiCallTool",
  mcpUiCancelCall: "mcp/uiCancelCall",
  mcpUiReadResource: "mcp/uiReadResource",
  mcpUiListResources: "mcp/uiListResources",
  mcpUiListResourceTemplates: "mcp/uiListResourceTemplates",
  mcpUiSubscribeResource: "mcp/uiSubscribeResource",
  mcpUiUnsubscribeResource: "mcp/uiUnsubscribeResource",
  // App-Provided Tools：页面工具登记 / 注销，与模型调用的认领 / 回传（信箱投递走 v4 live 增量）。
  mcpUiRegisterAppTools: "mcp/uiRegisterAppTools",
  mcpUiUnregisterAppTools: "mcp/uiUnregisterAppTools",
  mcpUiClaimAppToolCall: "mcp/uiClaimAppToolCall",
  mcpUiResolveAppToolCall: "mcp/uiResolveAppToolCall",
  pluginsList: "plugins/list",
  pluginsReferenceCatalog: "plugins/referenceCatalog",
  pluginsListUiSurfaces: "plugins/listUiSurfaces",
  pluginsReferenceCatalogWithCategory: "plugins/referenceCatalogWithCategory",
  skillsReferenceCatalog: "skills/referenceCatalog",
  // 已保存工作流的 GUI 中枢：workspace 级、无会话。
  workflowsList: "workflows/list",
  workflowsGet: "workflows/get",
  workflowsUpdateMeta: "workflows/updateMeta",
  workflowsDelete: "workflows/delete",
  workflowsRuns: "workflows/runs",
  // 在项目档 / 全局档之间移动同名文件。
  workflowsMove: "workflows/move",
  // 完成卡的「直接保存」与「已保存」判定（docs/dynamic-workflow/transcript-and-notifications.md）：
  // 前者按 runId 从 journal 取脚本落盘，后者回答「这次 run 对应哪个已保存工作流」。
  workflowsSave: "workflows/save",
  workflowsForRun: "workflows/forRun",
  pluginsResolveSuggestedReference: "plugins/resolveSuggestedReference",
  pluginsSetEnabled: "plugins/setEnabled",
  pluginsOverview: "plugins/overview",
  pluginsMarketplaceAdd: "plugins/marketplace/add",
  pluginsMarketplaceRemove: "plugins/marketplace/remove",
  pluginsMarketplaceUpdate: "plugins/marketplace/update",
  pluginsInstall: "plugins/install",
  pluginsCancelOperation: "plugins/cancelOperation",
  pluginsUninstall: "plugins/uninstall",
  pluginsUpdate: "plugins/update",
  pluginsRestoreBuiltin: "plugins/restoreBuiltin",
  pluginsConfigure: "plugins/configure",
  pluginsResetConfig: "plugins/resetConfig",
  pluginsValidate: "plugins/validate",
  pluginsDescribe: "plugins/describe",
  automationCreate: "automation/create",
  topicResourceRead: "topic/resource/read",
  channelReply: "bot/channel/reply",
  topicResourceCancel: "topic/resource/cancel",
  automationUpdate: "automation/update",
  automationCheckTaskBinding: "automation/checkTaskBinding",
  automationList: "automation/list",
  automationDelete: "automation/delete",
  // Off-Peak 会话内创建：与 automation 兄弟并列的独立方法族。
  offPeakCreate: "offPeak/create",
  offPeakList: "offPeak/list",
  // @deprecated：host 消费已清零（droraAgentService 改走 v4/usage/stats）。
  // 仅剩 CLI server 的 wire 兼容 case；随旧词整体删除时一并移除。
  usageStats: "usage/stats",
  // Drora Protocol 对 agent 只暴露 session-first 方法；task 是 UI 投影概念，不能泄露进协议方法名。
  // @deprecated：host 已改走 v4/conversation/usage；后续与 usage/stats 一并移除。
  sessionUsage: "session/usage",
  // 资源管理器：CLI 回报其 MCP 子进程 pid 与插件归属（纯内存，无 I/O），采样在 Host 侧完成。
  processChildProcesses: "process/childProcesses",
  processNetworkCapture: "process/networkCapture",
  interactionRequestPermission: "interaction/requestPermission",
  interactionRequestUserInput: "interaction/requestUserInput",
  interactionRequestProviderRuntimeHeaders: "interaction/requestProviderRuntimeHeaders",
  interactionRequestOfficialMcpAuthHeaders: "interaction/requestOfficialMcpAuthHeaders",
  // browser-use 反向请求由 agent 发起，host 转给 main 中的 CDP executor。
  interactionBrowserList: "interaction/browserList",
  interactionBrowserExecute: "interaction/browserExecute",
  // agent 只读 vault 检索（VaultSearch 工具，obsidian-knowledge.md §5f）：CLI→host，
  // host 分发到进程内 knowledge query 服务；无 knowledge 服务的 host 结构化报不可用。
  knowledgeSearch: "knowledge/search",
  // Persona P0 无会话管理（spec §4/§10、合同 §3/§4.1）：Host 经 CLI 控制连接代理，
  // 不 session/create、不生成占位会话；wire 名单一出处 contracts/persona.ts。
  personaGetOverview: PERSONA_PROTOCOL_METHODS.getOverview,
  personaInitialize: PERSONA_PROTOCOL_METHODS.initialize,
  personaGetCore: PERSONA_PROTOCOL_METHODS.getCore,
  personaUpdateCore: PERSONA_PROTOCOL_METHODS.updateCore,
  personaResetCore: PERSONA_PROTOCOL_METHODS.resetCore,
  personaPreview: PERSONA_PROTOCOL_METHODS.preview,
  personaGetApplication: PERSONA_PROTOCOL_METHODS.getApplication,
  personaSetPolicy: PERSONA_PROTOCOL_METHODS.setPolicy,
  personaSavePreference: PERSONA_PROTOCOL_METHODS.savePreference,
  personaForgetPreference: PERSONA_PROTOCOL_METHODS.forgetPreference,
  personaListPreferences: PERSONA_PROTOCOL_METHODS.listPreferences,
  personaPrepareExport: PERSONA_PROTOCOL_METHODS.prepareExport,
  // P1b 有限学习管理（合同 §3 allowLearningForKey＋读侧概览；wire 名单一出处 contracts）。
  personaAllowLearningForKey: PERSONA_PROTOCOL_METHODS.allowLearningForKey,
  personaGetLearningOverview: PERSONA_PROTOCOL_METHODS.getLearningOverview,
} as const;

export type DroraProtocolMethod = (typeof droraProtocolMethods)[keyof typeof droraProtocolMethods];

export const droraProtocolEmptyResultSchema = z.object({}).strict();

// 最新 V4 主链已不再依赖旧版全量方法表；这里仅保留仍被兼容测试和 browser broker
// 消费的最小契约集合，避免重新引入已移除的 legacy 方法。
export const droraProtocolSessionMethodContracts = {
  [droraProtocolMethods.mcpUiOpenInstance]: {
    params: droraMcpUiOpenInstanceParamsSchema,
    result: droraMcpUiOpenInstanceResultSchema,
  },
  [droraProtocolMethods.mcpUiCloseInstance]: {
    params: droraMcpUiCloseInstanceParamsSchema,
    result: droraMcpUiCloseInstanceResultSchema,
  },
  [droraProtocolMethods.mcpUiValidateInstance]: {
    params: droraMcpUiCloseInstanceParamsSchema,
    result: droraMcpUiResourceSubscriptionResultSchema,
  },
  [droraProtocolMethods.workspaceHookTrustGrant]: {
    params: droraWorkspaceHookTrustGrantParamsSchema,
    result: droraWorkspaceHookTrustGrantResultSchema,
  },
  [droraProtocolMethods.mcpList]: {
    params: droraMcpListParamsSchema,
    result: droraMcpListResultSchema,
  },
  [droraProtocolMethods.mcpReadResource]: {
    params: droraMcpReadResourceParamsSchema,
    result: droraMcpReadResourceResultSchema,
  },
  [droraProtocolMethods.mcpUiSampling]: {
    params: droraMcpUiSamplingParamsSchema,
    result: droraMcpUiSamplingResultSchema,
  },
  [droraProtocolMethods.mcpUiCancelSampling]: {
    params: droraMcpUiCancelSamplingParamsSchema,
    result: droraMcpUiCancelCallResultSchema,
  },
  [droraProtocolMethods.mcpUiCallTool]: {
    params: droraMcpUiCallToolParamsSchema,
    result: droraMcpUiCallToolResultSchema,
  },
  [droraProtocolMethods.mcpUiCancelCall]: {
    params: droraMcpUiCancelCallParamsSchema,
    result: droraMcpUiCancelCallResultSchema,
  },
  [droraProtocolMethods.mcpUiReadResource]: {
    params: droraMcpUiReadResourceParamsSchema,
    result: droraMcpUiReadResourceResultSchema,
  },
  [droraProtocolMethods.mcpUiListResources]: {
    params: droraMcpUiListResourcesParamsSchema,
    result: droraMcpUiListResourcesResultSchema,
  },
  [droraProtocolMethods.mcpUiListResourceTemplates]: {
    params: droraMcpUiListResourcesParamsSchema,
    result: droraMcpUiListResourceTemplatesResultSchema,
  },
  [droraProtocolMethods.mcpUiSubscribeResource]: {
    params: droraMcpUiResourceSubscriptionParamsSchema,
    result: droraMcpUiResourceSubscriptionResultSchema,
  },
  [droraProtocolMethods.mcpUiUnsubscribeResource]: {
    params: droraMcpUiResourceSubscriptionParamsSchema,
    result: droraMcpUiResourceSubscriptionResultSchema,
  },
  [droraProtocolMethods.mcpUiRegisterAppTools]: {
    params: droraMcpUiRegisterAppToolsParamsSchema,
    result: droraMcpUiRegisterAppToolsResultSchema,
  },
  [droraProtocolMethods.mcpUiUnregisterAppTools]: {
    params: droraMcpUiUnregisterAppToolsParamsSchema,
    result: droraMcpUiUnregisterAppToolsResultSchema,
  },
  [droraProtocolMethods.mcpUiClaimAppToolCall]: {
    params: droraMcpUiClaimAppToolCallParamsSchema,
    result: droraMcpUiAppToolAcceptedResultSchema,
  },
  [droraProtocolMethods.mcpUiResolveAppToolCall]: {
    params: droraMcpUiResolveAppToolCallParamsSchema,
    result: droraMcpUiAppToolAcceptedResultSchema,
  },
  [droraProtocolMethods.interactionBrowserList]: {
    params: droraBrowserListParamsSchema,
    result: droraBrowserListResultSchema,
  },
  [droraProtocolMethods.interactionBrowserExecute]: {
    params: droraBrowserExecuteParamsSchema,
    result: droraBrowserExecuteResultSchema,
  },
} as const satisfies Partial<
  Record<DroraProtocolMethod, { params: z.ZodTypeAny; result: z.ZodTypeAny }>
>;

export type DroraProtocolSessionMethodContract =
  (typeof droraProtocolSessionMethodContracts)[keyof typeof droraProtocolSessionMethodContracts];

// 启动入口的独立存储命令与严格结果 schema，和 CLI 共用一份契约。
export {
  STORAGE_MIGRATION_COMMAND,
  storageMigrationReportSchema,
} from "../sqlite-migrations/contract.js";

/** 仅存储准备子进程的私有控制帧，原始路径不进入业务事件或遥测。 */
export const droraStoragePreparationFrameSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("startup/storagePath"),
      params: z.object({ path: z.string().min(1).max(32768) }).strict(),
    })
    .strict(),
  z
    .object({ method: z.literal("startup/storagePrepared"), params: z.object({}).strict() })
    .strict(),
  z
    .object({ method: z.literal("startup/storageState"), params: droraStorageStartupStateSchema })
    .strict(),
]);
export const droraStoragePathReadySchema = z
  .object({ method: z.literal("startup/storagePathReady"), reuse: z.boolean().optional() })
  .strict();

// 桌面本地 TTFT 的严格事实合同；检查点不能替代实际内容帧。
export { localTtftFactsSchema } from "../localTtft.js";
// 群来源由可信 Host 注入，V4 命令与持久化输入使用相同运行时校验。
export {
  botIdentitySchema,
  botTopicInputMessageSchema,
  botGroupInputSourceSchema,
  type BotGroupInputSource,
} from "../bots.js";
export {
  botTopicContextSchema,
  botTopicMessageSchema,
  type BotTopicHistoryBatch,
  type BotTopicMessage,
} from "../bots.js";
