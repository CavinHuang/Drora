import type { TeamLeadPort, TeamMemberPort, TeamTaskUpdateInput } from "@drora/contracts";
import { TEAM_LIMITS } from "@drora/shared/drora-protocol-v4";
import { z } from "zod";
import { createCoreError, CoreErrorType } from "../runtime/deps.js";
import type { ToolEntry, ToolHandler } from "../tool/types.js";

/**
 * 团队协作工具面（spec §6.2）：闭包捕获 TeamMemberPort 的自包含 ToolEntry——
 * v2 注入方式（无 deps 字段接缝），由 install 注册进 hub 自建注册表实例。
 * lead 专属动作：TeamSpawn 舞台工具与 TeamReassign 转派/接管（specs/agents-team.md
 * §19 契约 4——sticky-parked 任务唯一轮换面，spec §1「转派/接管只有 lead 工具能做」）
 * 在本文件；审批/停队/恢复走 v4 用户面命令，不做模型工具——审批是用户动作，模型
 * 不得自批。本文件其余为成员侧协作面（强制保留集合）。
 */

const TASK_LIST_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { tasks: { type: "array", items: { type: "object" } } },
  required: ["tasks"],
  additionalProperties: false,
} as const;

function requirePort(getPort: () => TeamMemberPort | undefined, toolName: string): TeamMemberPort {
  const port = getPort();
  if (port === undefined) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `Team port is not configured for ${toolName}`,
      { recoverable: false },
    );
  }
  return port;
}

function teamToolEntry(input: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  runtimeInputSchema: z.ZodTypeAny;
  outputSchema: Record<string, unknown>;
  readOnly: boolean;
  handler: ToolHandler;
}): ToolEntry {
  return {
    capability: input.description,
    metadata: {
      name: input.name,
      description: input.description,
      readOnly: input.readOnly,
      destructive: false,
      concurrentSafe: true,
      timeoutMs: 10000,
      sideEffectScope: "session",
      riskLevel: "low",
      needsApproval: false,
    },
    handler: input.handler,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    runtimeInputSchema: input.runtimeInputSchema,
    runtimeOutputSchema: z.object({}).passthrough(),
    permission: {
      permission: `team.${input.name}`,
      reason: input.description,
      riskLevel: "low",
      sideEffectScope: "session",
      needsApproval: false,
      patternSources: ["toolName", "input"],
      alwaysAllowPatternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: 32_768,
      maxModelBytes: 32_768,
      strategy: "truncate",
      preview: { maxBytes: 4_096, direction: "head" },
    },
    timeout: { defaultMs: 10_000, maxMs: 10_000, allowCallOverride: false },
    cancellation: {
      supported: true,
      cleanup: "none",
      userVisibleMessage: `${input.name} was cancelled before the team port returned`,
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
  };
}

// §21 C（2026-10-24）：原 TeamTaskUpdatePatchSchema（status/output/artifactRefs 补丁
// schema）零消费（死 schema）已删——TeamTaskUpdateInputSchema 内联同款字段校验。

const TeamTaskUpdateInputSchema = z.object({
  task_id: z.string().min(1),
  attempt_id: z.string().min(1),
  status: z
    .enum(["pending", "claimed", "in_progress", "completed", "failed", "cancelled"])
    .optional(),
  output: z.string().optional(),
  artifact_refs: z.array(z.string()).optional(),
  acceptance_supplement: z
    .object({
      acceptance_results: z.array(z.string()).optional(),
      commands_run: z.array(z.string()).optional(),
      evidence_note: z.string().optional(),
    })
    .optional(),
});

const TeamSendInputSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1),
  summary: z.string().optional(),
  source_task_id: z.string().optional(),
  source_attempt_id: z.string().optional(),
  target_task_id: z.string().optional(),
});

/** 会话→端口解析：lead 会话绑定 TeamLeadPort，成员子会话绑定各自 TeamMemberPort。 */
export type TeamToolPortResolver = (context: { sessionId: string }) => TeamMemberPort | undefined;

/** lead 专属端口解析：只解析 lead 会话（E10 lead 专属由装配结构性保证）。 */
export type TeamLeadPortResolver = (context: { sessionId: string }) => TeamLeadPort | undefined;

/** 任务卡 → 工具出参（snake_case wire 形；collab 面与 lead 的 TeamReassign 共用）。 */
const taskCardJson = (card: ReturnType<TeamMemberPort["taskGet"]>) => ({
  task_id: card?.taskId,
  title: card?.title,
  status: card?.status,
  assignee: card?.assignee,
  attempt: card?.attempt,
  attempt_id: card?.attemptId,
  depends_on: card?.dependsOn,
  output: card?.output,
});

/** 成员侧协作工具（强制保留集合；即使 profile 收窄也注册，spec §6.2）。 */
export function createTeamCollabToolEntries(resolvePort: TeamToolPortResolver): ToolEntry[] {
  return [
    teamToolEntry({
      name: "TeamTaskList",
      description: "List the shared team task board (read-only).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      runtimeInputSchema: z.object({}).passthrough(),
      outputSchema: TASK_LIST_OUTPUT_SCHEMA,
      readOnly: true,
      handler: async (_raw, context) => {
        const board = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamTaskList",
        ).boardRead();
        return {
          tasks: board.tasks.map((task) => ({
            task_id: task.taskId,
            title: task.title,
            status: task.status,
            assignee: task.assignee,
            attempt: task.attempt,
            depends_on: task.dependsOn,
          })),
        };
      },
    }),
    teamToolEntry({
      name: "TeamTaskGet",
      description: "Read one team task card, including its current attempt_id.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
        additionalProperties: false,
      },
      runtimeInputSchema: z.object({ task_id: z.string().min(1) }),
      outputSchema: { type: "object", properties: { task: { type: "object" } } },
      readOnly: true,
      handler: async (raw, context) => {
        const parsed = z.object({ task_id: z.string().min(1) }).parse(raw);
        const card = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamTaskGet",
        ).taskGet(parsed.task_id);
        return { task: card === undefined ? undefined : taskCardJson(card) };
      },
    }),
    teamToolEntry({
      name: "TeamTaskCreate",
      description:
        "Create a task on the shared team board with an explicit goal, acceptance criteria and dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          acceptance: { type: "array", items: { type: "string" } },
          assignee: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
        },
        required: ["title", "goal", "acceptance"],
        additionalProperties: false,
      },
      runtimeInputSchema: z.object({
        title: z.string().min(1),
        goal: z.string().min(1),
        acceptance: z.array(z.string()),
        assignee: z.string().optional(),
        depends_on: z.array(z.string()).optional(),
      }),
      outputSchema: { type: "object", properties: { task: { type: "object" } } },
      readOnly: false,
      handler: async (raw, context) => {
        const parsed = z
          .object({
            title: z.string().min(1),
            goal: z.string().min(1),
            acceptance: z.array(z.string()),
            assignee: z.string().optional(),
            depends_on: z.array(z.string()).optional(),
          })
          .parse(raw);
        const result = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamTaskCreate",
        ).taskCreate({
          title: parsed.title,
          spec: { goal: parsed.goal, acceptance: parsed.acceptance },
          dependsOn: parsed.depends_on ?? [],
          ...(parsed.assignee === undefined ? {} : { assignee: parsed.assignee }),
        });
        if (result.status === "rejected") {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error?.message ?? "task create rejected"}`,
            { context: { code: result.error?.code }, recoverable: false },
          );
        }
        return { task: result.task === undefined ? undefined : taskCardJson(result.task) };
      },
    }),
    teamToolEntry({
      name: "TeamTaskClaim",
      description:
        "Claim a ready team task. Returns the attempt_id required for every subsequent update. You cannot own a second open task.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
        additionalProperties: false,
      },
      runtimeInputSchema: z.object({ task_id: z.string().min(1) }),
      outputSchema: { type: "object" },
      readOnly: false,
      handler: async (raw, context) => {
        const parsed = z.object({ task_id: z.string().min(1) }).parse(raw);
        const result = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamTaskClaim",
        ).taskClaim(parsed.task_id);
        if (result.status === "rejected") {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error.message}${result.error.hint === undefined ? "" : ` ${result.error.hint}`}`,
            { context: { code: result.error.code }, recoverable: false },
          );
        }
        return result;
      },
    }),
    teamToolEntry({
      name: "TeamTaskUpdate",
      description:
        "Advance a claimed team task. Requires the attempt_id from your assignment; stale attempts are rejected after reassignment. claimed cannot jump to completed.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          attempt_id: { type: "string" },
          status: { type: "string", enum: ["in_progress", "completed", "failed", "cancelled"] },
          output: { type: "string" },
          artifact_refs: { type: "array", items: { type: "string" } },
          acceptance_supplement: { type: "object" },
        },
        required: ["task_id", "attempt_id"],
        additionalProperties: false,
      },
      runtimeInputSchema: TeamTaskUpdateInputSchema,
      outputSchema: { type: "object", properties: { task: { type: "object" } } },
      readOnly: false,
      handler: async (raw, context) => {
        const parsed = TeamTaskUpdateInputSchema.parse(raw);
        const input: TeamTaskUpdateInput = {
          taskId: parsed.task_id,
          attemptId: parsed.attempt_id,
          patch: {
            ...(parsed.status === undefined ? {} : { status: parsed.status }),
            ...(parsed.output === undefined ? {} : { output: parsed.output }),
            ...(parsed.artifact_refs === undefined ? {} : { artifactRefs: parsed.artifact_refs }),
          },
          ...(parsed.acceptance_supplement === undefined
            ? {}
            : {
                acceptanceSupplement: {
                  ...(parsed.acceptance_supplement.acceptance_results === undefined
                    ? {}
                    : { acceptanceResults: parsed.acceptance_supplement.acceptance_results }),
                  ...(parsed.acceptance_supplement.commands_run === undefined
                    ? {}
                    : { commandsRun: parsed.acceptance_supplement.commands_run }),
                  ...(parsed.acceptance_supplement.evidence_note === undefined
                    ? {}
                    : { evidenceNote: parsed.acceptance_supplement.evidence_note }),
                },
              }),
        };
        const result = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamTaskUpdate",
        ).taskUpdate(input);
        if (result.status === "rejected") {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error?.message ?? "task update rejected"}${result.error?.hint === undefined ? "" : ` ${result.error.hint}`}`,
            { context: { code: result.error?.code }, recoverable: false },
          );
        }
        return { task: result.task === undefined ? undefined : taskCardJson(result.task) };
      },
    }),
    teamToolEntry({
      name: "TeamSendMessage",
      description:
        "Send a durable message to a teammate or the team lead. Delivery wakes the recipient; the lead is never a relay you must go through.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string" },
          message: { type: "string" },
          summary: { type: "string" },
          source_task_id: { type: "string" },
          source_attempt_id: { type: "string" },
          target_task_id: { type: "string" },
        },
        required: ["to", "message"],
        additionalProperties: false,
      },
      runtimeInputSchema: TeamSendInputSchema,
      outputSchema: {
        type: "object",
        properties: { message_id: { type: "string" }, delivery: { type: "string" } },
        required: ["message_id", "delivery"],
      },
      readOnly: false,
      handler: async (raw, context) => {
        const parsed = TeamSendInputSchema.parse(raw);
        const result = requirePort(
          () => resolvePort({ sessionId: context.sessionId }),
          "TeamSendMessage",
        ).send({
          to: parsed.to,
          message: parsed.message,
          ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
          ...(parsed.source_task_id === undefined ? {} : { sourceTaskId: parsed.source_task_id }),
          ...(parsed.source_attempt_id === undefined
            ? {}
            : { sourceAttemptId: parsed.source_attempt_id }),
          ...(parsed.target_task_id === undefined ? {} : { targetTaskId: parsed.target_task_id }),
        });
        if (result.status === "failed") {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error.message}${result.error.hint === undefined ? "" : ` ${result.error.hint}`}`,
            { context: { code: result.error.code }, recoverable: false },
          );
        }
        return { message_id: result.messageId, delivery: result.delivery };
      },
    }),
  ];
}

// ---------- lead 专属：staged 草案入口（2026-10-21 缺口0，spec §14） ----------

// 输入限额与 wire 同门（specs/agents-team.md §17 契约 4，单一出处 TEAM_LIMITS）：
// 草案成员/任务会原样进 team 投影，wire 对 profile/memberName 有 ≤maxNameChars、
// title/goal 等有 ≤maxTextChars 的硬上界——模型给出的超长 profile 曾让投影一 emit
// 就烧掉每一帧（session_7117760500 实证：对话区 fail-closed 白屏）。在工具入参边界
// 拒绝，模型当场自纠，而不是让坏载荷落库后烧订阅。
const TeamSpawnInputSchema = z.object({
  name: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  members: z
    .array(
      z.object({
        name: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
        profile: z.string().max(TEAM_LIMITS.maxNameChars).optional(),
        model_selection: z
          .object({
            provider: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
            model: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
            thought: z.string().max(TEAM_LIMITS.maxIdChars).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(TEAM_LIMITS.membersMax),
  tasks: z
    .array(
      z.object({
        task_id: z.string().max(TEAM_LIMITS.maxIdChars).optional(),
        title: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
        goal: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
        acceptance: z
          .array(z.string().min(1).max(TEAM_LIMITS.maxTextChars))
          .max(TEAM_LIMITS.acceptanceMax),
        output_format: z.string().max(TEAM_LIMITS.maxTextChars).optional(),
        assignee: z.string().max(TEAM_LIMITS.maxNameChars).optional(),
        depends_on: z
          .array(z.string().min(1).max(TEAM_LIMITS.maxIdChars))
          .max(TEAM_LIMITS.dependsOnMax)
          .optional(),
      }),
    )
    .max(TEAM_LIMITS.boardTasksMax),
});

// §19 契约 4（2026-10-23）：TeamReassign 转派/接管入参限额与 TeamSpawn 同门
//（§17 契约 4：限额单一出处 TEAM_LIMITS，超限在工具入参边界报错，模型当场自纠）；
// min(1) 拒空串——这是工具入参面校验，与 §19 契约 2 的 hub 落库空白归一是两门，不混用。
const TeamReassignInputSchema = z.object({
  task_id: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  to: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  reason: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
});

/**
 * lead 专属工具族（spec §6.2/§14 缺口0）：TeamSpawn 是 staged 草案的唯一生产入口
 * ——/team 命令展开后模型用它建花名册 + 任务 DAG，Approve & Run 是用户侧动作
 * （v4 命令 approveTeamPlan），模型不得自批（「不批自己的实现」同源）。staged 态
 * 再次调用 = 原子更新同一草案（spec §10）；task_id 可选携带用于修订时身份保持
 * （缺口5——dependsOn 引用旧 ID 不悬空）。
 *
 * TeamReassign（specs/agents-team.md §19 契约 4）是转派/接管的唯一生产入口
 * （spec §1「转派/接管只有 lead 工具能做」）：sticky-parked 任务的轮换面；
 * 成员会话经 resolver 解析 undefined，E10 team_lead_only 由装配结构性保证。
 */
export function createTeamLeadToolEntries(resolveLeadPort: TeamLeadPortResolver): ToolEntry[] {
  return [
    teamToolEntry({
      name: "TeamSpawn",
      description:
        "Stage an agent team draft (member roster + task DAG) for the user to review. No member is spawned until the user approves the plan. Call once with the full roster and DAG; re-call to atomically revise the same draft (pass task_id to keep task identity).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          members: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                profile: { type: "string" },
                model_selection: {
                  type: "object",
                  properties: {
                    provider: { type: "string" },
                    model: { type: "string" },
                    thought: { type: "string" },
                  },
                  required: ["provider", "model"],
                },
              },
              required: ["name"],
            },
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task_id: { type: "string" },
                title: { type: "string" },
                goal: { type: "string" },
                acceptance: { type: "array", items: { type: "string" } },
                output_format: { type: "string" },
                assignee: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
              },
              required: ["title", "goal", "acceptance"],
            },
          },
        },
        required: ["members", "tasks"],
        additionalProperties: false,
      },
      runtimeInputSchema: TeamSpawnInputSchema,
      outputSchema: { type: "object", properties: { team: { type: "object" } } },
      readOnly: false,
      handler: async (raw, context) => {
        const port = resolveLeadPort({ sessionId: context.sessionId });
        if (port === undefined) {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            "Team port is not configured for TeamSpawn (lead session only)",
            { recoverable: false },
          );
        }
        const parsed = TeamSpawnInputSchema.parse(raw);
        const result = port.stageTeam({
          ...(parsed.name === undefined ? {} : { name: parsed.name }),
          draftMembers: parsed.members.map((member) => ({
            memberName: member.name,
            // §19 契约 2：透传 optional profile（缺省即键缺席），不再 `?? ""`——
            // 空串落库会破 wire min(1)，烧投影每一帧；空白归一在 hub.stageTeam 物化处。
            profile: member.profile,
            ...(member.model_selection === undefined
              ? {}
              : { modelSelection: member.model_selection }),
          })),
          draftTasks: parsed.tasks.map((task) => ({
            ...(task.task_id === undefined ? {} : { taskId: task.task_id }),
            title: task.title,
            spec: {
              goal: task.goal,
              acceptance: task.acceptance,
              ...(task.output_format === undefined ? {} : { outputFormat: task.output_format }),
            },
            ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
            dependsOn: task.depends_on ?? [],
          })),
        });
        if (result.status === "rejected") {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error?.message ?? "team stage rejected"}${result.error?.hint === undefined ? "" : ` ${result.error.hint}`}`,
            { context: { code: result.error?.code }, recoverable: false },
          );
        }
        // 回显落库后的真实 task_id 全表（depends_on 引用它修订草案）+ 等待审批指引。
        const roster = port.roster();
        const board = port.boardRead();
        return {
          team: {
            team_id: result.teamId,
            status: roster.status,
            members: roster.members.map((member) => ({
              name: member.memberName,
              profile: member.profile ?? "",
            })),
            tasks: board.tasks.map((task) => ({
              task_id: task.taskId,
              title: task.title,
              assignee: task.assignee,
              depends_on: task.dependsOn,
            })),
            next: "The draft is staged for user approval. Tell the user to review it in the team panel and press Approve & Run. Do not spawn anything yourself; wait for their decision.",
          },
        };
      },
    }),
    // §19 契约 4：转派/接管工具条目——hub.reassign 三步交接（失效旧凭证 →
    // interruptAndSettle 静默 → handoffId 再入新者胜）之上的模型入口；内核语义零改动。
    teamToolEntry({
      name: "TeamReassign",
      description:
        "Reassign one of the team's open tasks to another member, or take it over yourself with to=\"lead\" (lead takeover moves the task to in_progress directly, no claim handshake). Only non-terminal tasks can be reassigned: the current assignee's attempt is revoked and they are told the task moved on. As lead you can hold at most one open task (claimed/in_progress) at a time; a second takeover is rejected.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["task_id", "to", "reason"],
        additionalProperties: false,
      },
      runtimeInputSchema: TeamReassignInputSchema,
      outputSchema: { type: "object", properties: { task: { type: "object" } } },
      readOnly: false,
      handler: async (raw, context) => {
        // §19 契约 4：成员会话 resolver 返回 undefined → 结构性拒（E10 lead 专属的
        // 装配保证，成员零通路；照 TeamSpawn 同门）。端口检查先于 schema 解析。
        const port = resolveLeadPort({ sessionId: context.sessionId });
        if (port === undefined) {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            "Team port is not configured for TeamReassign (lead session only)",
            { recoverable: false },
          );
        }
        const parsed = TeamReassignInputSchema.parse(raw);
        // reason 是端口必填载荷（TeamReassignInput）；hub.reassign 现状不消费不持久化
        //（照 §16 契约 5 reopen「无 reason 持久化面」同规）——原样透传，不在此加工。
        const result = await port.reassign({
          taskId: parsed.task_id,
          to: parsed.to,
          reason: parsed.reason,
        });
        if (result.status === "rejected") {
          // §19 契约 4：六拒绝语义全数透传（team_halted / team_not_present /
          // invalid_transition / attempt_revoked / name_redirect / team_lead_only）——
          // error.code 挂 CoreError.context，拒绝文案与 hint 原样出显。
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            `${result.error?.message ?? "reassign rejected"}${result.error?.hint === undefined ? "" : ` ${result.error.hint}`}`,
            { context: { code: result.error?.code }, recoverable: false },
          );
        }
        // ok：回显轮换后的任务卡（新 assignee 与新 attempt 世代），lead 依此核对轮换。
        return { task: taskCardJson(port.taskGet(parsed.task_id)) };
      },
    }),
  ];
}
