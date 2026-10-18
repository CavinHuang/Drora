// ============================================================
// team：agents team 的 wire 投影 schema + v4 团队命令 payload（snapshot/delta 的 team 键）
// ============================================================
// 纯 schema + 纯函数纪律（照 workflow-runs.ts 体例）：本文件只放 schema 与常量，
// 禁止任何运行时/IO/传输逻辑。权威依据：specs/agents-team.md §6.3/§6.4 与
// docs/agent-team-implementation-2026-10-16/00-master-design.md §3.3/§6.2（下称 design）。
// 上游判定（spec §0）：官方 ZCode 无任何多代理协作协议面，本文件是纯 Drora 自研增量——
// team 的 wire 命令名、snapshot/delta 键名、限额常量只在本文件常量区定义一次
// （AGENTS.md 契约键单一出处；spec §6.4 / design §3.3.6）。
import { z } from "zod";

// ── 契约常量（单一出处；snapshot.ts / delta.ts / 消费方引用这里）──

/** snapshot 的 team 投影字段名 / statePatch 的 team 键名（snapshot.ts 与 delta.ts 用它作键）。 */
export const TEAM_SNAPSHOT_KEY = "team";

/**
 * team 限额常量（design §3.3.5 的 `PROTOCOL_V4_LIMITS.team` 值族；值在这里定义一次，
 * core.ts 的 PROTOCOL_V4_LIMITS.team 引用本常量）。整键替换的投影字节量由
 * boardTasksMax / teamMailboxTailWindow / teamMessageMaxChars 三条界压回有界。
 */
/**
 * 「lead」寻址键（assignee/from/to 的 lead 取值；spec §16.2）。单一出处：
 * UI 侧 lead 任务标签/发件人判定与 core 的 LEAD_ASSIGNEE_KEY 均引用本常量，
 * 任何一侧不得再手写 "lead" 字面量（2026-10-18 team UI 审查修复）。
 */
export const TEAM_LEAD_ASSIGNEE = "lead";

export const TEAM_LIMITS = {
  /** 任务板条目上限（spec §6.3：任务板受 boardTasksMax 约束，建议 100）。 */
  boardTasksMax: 100,
  /** 邮箱持久保留上限/成员（尾窗投影的数据源；spec §6.3 建议 20）。 */
  teamMessagesRetentionPerMember: 20,
  /** 投影尾窗：mailboxTail 只保留最近 N 条，≤ retention（spec §6.3 建议 10）。 */
  teamMailboxTailWindow: 10,
  /** 单条成员消息体上限（relay envelope 有界；spec §6.3 建议 8000）。 */
  teamMessageMaxChars: 8_000,
  /** 依赖产物预算：单项截断（design §3.3.5 / spec §16.2）。 */
  dependencyDigestPerItemChars: 2_000,
  /** 依赖产物预算：总量（design §3.3.5 / spec §16.2）。 */
  dependencyDigestTotalChars: 12_000,
  /** 成员默认 maxTurns（长寿命策略；与 contracts TEAM_MEMBER_DEFAULT_MAX_TURNS 同值，M1 先落，镜像登记）。 */
  memberDefaultMaxTurns: 40,
  // 以下为线上字符串/数组上界（design §3.3.5 未逐条列出，照 WORKFLOW_RUNS_LIMITS 体例补充：
  // 协议边界上的所有载荷有界——数字必须有界，字符串同理）。
  /** 花名册投影硬上界。默认成员上限 5 由 settings 治理（contracts TEAM_MEMBERS_MAX_DEFAULT）；
   *  这条只挡坏载荷，不是产品上限。 */
  membersMax: 64,
  /** 单任务依赖数上界（DAG 扇入）。 */
  dependsOnMax: 64,
  /** 单任务产物引用数上界。 */
  artifactRefsMax: 32,
  /** 单任务验收标准条数上界。 */
  acceptanceMax: 32,
  /** 标识符上界：teamId/taskId/agentId/messageId/attemptId 等（同 workflowRun.runId 的 128）。 */
  maxIdChars: 128,
  /** 名称上界：memberName/team name/profile 名/assignee/from/to（同 maxActorNameLength 的 128）。 */
  maxNameChars: 128,
  /** childSessionId 上界（同 maxSessionIdLength 的 256）。 */
  maxSessionIdChars: 256,
  /** profileColor 上界（颜色 token / hex，标识不是文本）。 */
  maxColorChars: 32,
  /** 文本字段上界：任务标题/规格/verify/note/reason 等（与单条消息同量级，wire 帧有界）。 */
  maxTextChars: 8_000,
  /** 邮箱摘要上界（照 maxInstructionsHeadLength 的「一眼可读」量级；正文有 journal 可查）。 */
  maxSummaryChars: 240,
  /** artifacts.dir 路径上界。 */
  maxDirChars: 512,
  /** artifactRefs 单条引用（路径/引用 id）上界。 */
  maxArtifactRefChars: 256,
} as const;

// ── 枚举（闭合集；加值 = wire 偏斜代价，见 snapshot.ts backgroundWorkSummarySchema.kind 的教训）──

/** team 状态机八值（design §3.3.1：spec §6.3 七值 + archived = 差异 D3，abandonTeamPlan 归档载体）。 */
export const teamStatusSchema = z.enum([
  "staged",
  "active",
  "idle",
  "completed",
  "halted",
  "escalated",
  "cancelled",
  "archived",
]);
export type TeamStatusWire = z.infer<typeof teamStatusSchema>;

/** 成队时定死的权限模式记录值（spec §8.1 闭合集；缺席 = 未记录，旧版本回退继承 lead 当前模式）。 */
export const teamPermissionModeSchema = z.enum(["build", "edit", "yolo", "guarded", "auto"]);
export type TeamPermissionModeWire = z.infer<typeof teamPermissionModeSchema>;

/** 任务状态机（spec §2.3；迁移表 pending→claimed→in_progress→终态在 core/src/team/board.ts 裁决）。 */
export const teamTaskStatusSchema = z.enum([
  "pending",
  "claimed",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);
export type TeamTaskStatusWire = z.infer<typeof teamTaskStatusSchema>;

/** 成员运行态投影四值（design §3.3.1；working/terminal 循环由 hub 按终态/复活事实驱动）。 */
export const teamMemberStateSchema = z.enum(["spawning", "working", "terminal", "removed"]);
export type TeamMemberStateWire = z.infer<typeof teamMemberStateSchema>;

// ── 任务卡 ──

/** 任务规格（MetaGPT 式结构化交接产物；与 contracts TeamTaskSpec 字面量对齐，非类型引用）。 */
export const teamTaskSpecSchema = z.object({
  goal: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
  acceptance: z
    .array(z.string().min(1).max(TEAM_LIMITS.maxTextChars))
    .max(TEAM_LIMITS.acceptanceMax),
  outputFormat: z.string().min(1).max(TEAM_LIMITS.maxTextChars).optional(),
});
export type TeamTaskSpecWire = z.infer<typeof teamTaskSpecSchema>;

/** M5 质量门禁的 additive 预留字段（spec §2.3；v1 不强制，缺席即未启用门禁）。 */
export const teamTaskContractSchema = z.object({
  objective: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
  acceptance: z
    .array(z.string().min(1).max(TEAM_LIMITS.maxTextChars))
    .max(TEAM_LIMITS.acceptanceMax),
  inScope: z.array(z.string().min(1).max(TEAM_LIMITS.maxArtifactRefChars)).optional(),
  outOfScope: z.array(z.string().min(1).max(TEAM_LIMITS.maxArtifactRefChars)).optional(),
  verify: z.string().min(1).max(TEAM_LIMITS.maxTextChars).optional(),
  kind: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
});
export type TeamTaskContractWire = z.infer<typeof teamTaskContractSchema>;

/**
 * 任务卡 wire 投影（design §3.3.2）。
 *
 * 含 attempt 字段族：`attempt`（单调计数）与 `attemptId`（本次执行的唯一能力凭证，
 * pending 无——所以 optional）；`recoveryRetried` 是冷恢复单次重试已用标记（投影可见，
 * 防 UI 把「待重试」误显示成「从未派过」）。
 *
 * **刻意不携带** `handoffId` / `reassigning` / `parked`：它们是 hub 内部交接态（spec §16.1
 * 双令牌模型的世代号与在途标记），不是显示事实——转派中的状态由 assignee + attempt 轮换
 * 表达。同族教训：已知键上的解析错误不会被剥离（会让整个 patch 失败、整帧被丢），wire 面
 * 只放显示需要的事实。
 */
export const teamTaskCardSchema = z.object({
  taskId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  title: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
  spec: teamTaskSpecSchema,
  status: teamTaskStatusSchema,
  /** memberName 或 TEAM_LEAD_ASSIGNEE（lead 接管，spec §16.2）。缺席 = 共享池待认领。 */
  assignee: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  /** 单调 attempt 计数（spec §16.1 双令牌之一）；每次转派/重试 +1。 */
  attempt: z.number().int().nonnegative(),
  /** 本次执行的唯一凭证（UUID）；迟到写入按旧 attemptId 拒绝（spec §2.3）。pending 无。 */
  attemptId: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
  dependsOn: z.array(z.string().min(1).max(TEAM_LIMITS.maxIdChars)).max(TEAM_LIMITS.dependsOnMax),
  artifactRefs: z
    .array(z.string().min(1).max(TEAM_LIMITS.maxArtifactRefChars))
    .max(TEAM_LIMITS.artifactRefsMax),
  /** ISO 8601（CLI 时钟产出；客户端禁止拿本地时钟与协议时间相减，core.ts 时钟规则）。 */
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 冷恢复单次重试已用标记（spec §2.3：失败不退化为可无限重派的 pending）。 */
  recoveryRetried: z.boolean().optional(),
  /** M5 质量门禁 additive 预留（v1 不强制）。 */
  contract: teamTaskContractSchema.optional(),
});
export type TeamTaskCardProjection = z.infer<typeof teamTaskCardSchema>;

// ── 成员 / 邮箱尾窗 / 板 / staged 草案 ──

/** 成员卡（design §3.3.1；profileColor 自 `.drora/agents/*.md` 的 color 字段作视觉标识）。 */
export const teamMemberProjectionSchema = z.object({
  agentId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  memberName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  profile: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  profileColor: z.string().min(1).max(TEAM_LIMITS.maxColorChars).optional(),
  state: teamMemberStateSchema,
  /** 该成员当前持有的未完成任务；idle/终态时缺席。 */
  currentTaskId: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
  /** 持有该成员转录的 child 会话（下钻 TeamMemberSidePane 的联接键）。 */
  childSessionId: z.string().min(1).max(TEAM_LIMITS.maxSessionIdChars).optional(),
});
export type TeamMemberProjection = z.infer<typeof teamMemberProjectionSchema>;

/**
 * 邮箱尾窗条目（design §3.3.1）：**投影只保留尾窗**（≤ {@link TEAM_LIMITS.teamMailboxTailWindow}），
 * 完整邮箱在 team journal（design §3.3.3 的 MailboxEntry 内部态含正文与投递世代，不上 wire）。
 * 尾窗条目刻意只有摘要与投递事实：正文不是显示事实，世代过滤是 hub 裁决语义。
 */
export const teamMailboxTailEntrySchema = z.object({
  messageId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  /** memberName 或 "lead"。 */
  from: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  /** memberName 或 agentId。 */
  to: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  summary: z.string().min(1).max(TEAM_LIMITS.maxSummaryChars).optional(),
  /** ISO 8601。 */
  at: z.string(),
  /** 任务报告溯源（发送侧世代，spec §16.3 结构化溯源）。 */
  sourceTaskId: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
  sourceAttemptId: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
  /** ack 只认注入（spec §16.3）：queued 不算送达。 */
  delivered: z.boolean(),
});
export type TeamMailboxTailEntry = z.infer<typeof teamMailboxTailEntrySchema>;

/** 共享任务板投影：tasks 全量（≤ boardTasksMax）+ limit（读面显示「N/M」用）。 */
export const teamBoardSchema = z.object({
  tasks: z.array(teamTaskCardSchema).max(TEAM_LIMITS.boardTasksMax),
  limit: z.number().int().positive(),
});
export type TeamBoardProjection = z.infer<typeof teamBoardSchema>;

/**
 * staged 草案的成员行。`modelSelection` 是建队时刻的路由快照（spec §8.7：建队/建成员
 * 那一刻的世界被固定），形态 {provider, model, thought?}——与 command 面的
 * ModelSelection（providerId/modelId/options.reasoningLevel）**不是**同一词汇，刻意不共用 schema。
 */
export const teamStagedDraftMemberSchema = z.object({
  memberName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  profile: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  modelSelection: z
    .object({
      provider: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
      model: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
      thought: z.string().min(1).max(TEAM_LIMITS.maxIdChars).optional(),
    })
    .optional(),
});
export type TeamStagedDraftMember = z.infer<typeof teamStagedDraftMemberSchema>;

/** staged 草案的任务行（编辑器可改负责人/依赖；完整 spec 在批准后经 task_created 落板）。 */
export const teamStagedDraftTaskSchema = z.object({
  taskId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  title: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
  assignee: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  dependsOn: z.array(z.string().min(1).max(TEAM_LIMITS.maxIdChars)).max(TEAM_LIMITS.dependsOnMax),
});
export type TeamStagedDraftTask = z.infer<typeof teamStagedDraftTaskSchema>;

/** 两阶段成队草案（design §3.3.1；仅 staged 态携带）。 */
export const teamStagedDraftSchema = z.object({
  draftMembers: z.array(teamStagedDraftMemberSchema).max(TEAM_LIMITS.membersMax),
  draftTasks: z.array(teamStagedDraftTaskSchema).max(TEAM_LIMITS.boardTasksMax),
  /** 「回对话修改」标记（spec §10：追问一次修改方向，之后必须原子更新同一草案）。 */
  awaitingFeedback: z.boolean(),
});
export type TeamStagedDraft = z.infer<typeof teamStagedDraftSchema>;

/** 产物区引用（spec §2.3：`.drora/team-artifacts/{teamId}`；目录名契约在 contracts TEAM_ARTIFACTS_DIR）。 */
export const teamArtifactsSchema = z.object({
  dir: z.string().min(1).max(TEAM_LIMITS.maxDirChars),
});
export type TeamArtifacts = z.infer<typeof teamArtifactsSchema>;

/**
 * team 投影状态（design §3.3.1；spec §6.3 的 snapshot `team` 字段 / delta `team` 键）。
 *
 * status 与 permissionMode 是 team 状态机（spec §2.6）与权限徽标（spec §8.1）的显示依据。
 * `stagedDraft` 仅 staged 态携带；`artifacts` 缺席 = 无产物区。花名册 ≤ membersMax、
 * 任务板 ≤ boardTasksMax、邮箱只留尾窗——**键级整体替换**的字节量因此有界。
 */
export const teamProjectionStateSchema = z.object({
  teamId: z.string().min(1).max(TEAM_LIMITS.maxIdChars),
  name: z.string().min(1).max(TEAM_LIMITS.maxNameChars).optional(),
  status: teamStatusSchema,
  /** 成队定死的记录值；缺席 = 未记录（旧版本 journal，读侧回退继承 lead 当前模式）。 */
  permissionMode: teamPermissionModeSchema.optional(),
  members: z.array(teamMemberProjectionSchema).max(TEAM_LIMITS.membersMax),
  board: teamBoardSchema,
  mailboxTail: z.array(teamMailboxTailEntrySchema).max(TEAM_LIMITS.teamMailboxTailWindow),
  /** 仅 staged 态携带（两阶段成队草案）。 */
  stagedDraft: teamStagedDraftSchema.optional(),
  artifacts: teamArtifactsSchema.optional(),
});
export type TeamProjectionState = z.infer<typeof teamProjectionStateSchema>;

// ── v4 用户面命令 payload（八条；design §6.2）──

/**
 * 八条团队命令的 payload schema，键名即 wire 命令名（契约键单一出处：spec §6.4 /
 * design §3.3.6——bootstrap handler 与双端 commandFactory 引用这里的键）。
 *
 * **全部非行级**：团队命令不落 conversation 行，不携 baseRevision（照 resumeWorkflowRun
 * 同类论证，command.ts:272-278——假 CAS 只会误伤），不入 COMMANDS_REQUIRING_BASE_REVISION。
 * 草案与理由的权威表在 design §6.2。
 */
export const TEAM_COMMAND_PAYLOAD_SCHEMAS = {
  /** staged 草案的「确认并启动」：唯一创建成员入口；草案全文是 hub 的服务端事实，载荷为空。 */
  approveTeamPlan: z.object({}),
  /** 「回对话修改」：草案标记为等待反馈并取消规划回合；修改方向由用户在对话里说（spec §10）。 */
  reviseTeamPlan: z.object({
    note: z.string().min(1).max(TEAM_LIMITS.maxTextChars).optional(),
  }),
  /** 「放弃」：归档草案（status=archived）并禁止自动重建（spec §2.6）。 */
  abandonTeamPlan: z.object({}),
  /** 用户对成员说话的唯一通道（spec §1：必须经 lead 侧团队命令走邮箱投递，teammate 会话本体只读）。 */
  sendTeamMessage: z.object({
    to: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
    message: z.string().min(1).max(TEAM_LIMITS.teamMessageMaxChars),
    summary: z.string().min(1).max(TEAM_LIMITS.maxSummaryChars).optional(),
  }),
  /** 成员移除 v1 只走用户命令（spec 实现设计裁决第 7 条：不给 lead 模型移除工具）；hub 走移除安全序。 */
  stopTeamMember: z.object({
    memberName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
    reason: z.string().min(1).max(TEAM_LIMITS.maxTextChars).optional(),
  }),
  /** 成员改名（spec §2.4 名字重定向防护基线：花名册 name→agentId 绑定更新）。 */
  setTeamMemberName: z.object({
    memberName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
    newName: z.string().min(1).max(TEAM_LIMITS.maxNameChars),
  }),
  /** 用户停队：halted ≠ escalated（spec §1）；halted 后普通建任务不得静默恢复。 */
  haltTeam: z.object({
    reason: z.string().min(1).max(TEAM_LIMITS.maxTextChars).optional(),
  }),
  /** 显式恢复：reason 必填（spec §1「显式 TeamResume 且带理由」）。 */
  resumeTeam: z.object({
    reason: z.string().min(1).max(TEAM_LIMITS.maxTextChars),
  }),
} as const;

export type TeamV4CommandType = keyof typeof TEAM_COMMAND_PAYLOAD_SCHEMAS;

/** 八条命令名元组（PR-2.2 handler 注册表 spread 与 CAS 对照断言消费）。 */
export const TEAM_V4_COMMAND_TYPES = Object.keys(
  TEAM_COMMAND_PAYLOAD_SCHEMAS,
) as readonly TeamV4CommandType[];
