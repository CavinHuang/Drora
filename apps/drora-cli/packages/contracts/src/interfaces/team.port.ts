/**
 * Agents Team 端口契约（specs/agents-team.md §6.2；接口细则
 * docs/agent-team-implementation-2026-10-16/00-master-design.md §3.1/§3.2）。
 *
 * v2 模块化纪律（spec §11）：本文件是 team 类型族的唯一落点——**不修改
 * subagent.port.ts**，与子代理端口的集成由 core/src/team 私有端口承载。
 * 契约键单一出处（AGENTS.md:56）：journal 前缀、灰度 settings 键、产物目录名
 * 的字面量只在本文件常量区定义一次。
 */

/** 成队时定死的权限模式记录值（spec §8.1；闭合集照 workflow-actor-permission.ts）。 */
export type TeamPermissionMode = "build" | "edit" | "yolo" | "guarded" | "auto";

/** team 状态机 wire 枚举（spec §2.6；staged 为两阶段成队态，archived 为归档终态）。 */
export type TeamStatus =
  | "staged"
  | "active"
  | "idle"
  | "completed"
  | "halted"
  | "escalated"
  | "cancelled"
  | "archived";

/** 任务状态机（spec §2.3；迁移表见 core/src/team/board.ts）。 */
export type TeamTaskStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

/** 成员运行态投影（spec §3.3.1）。 */
export type TeamMemberState = "spawning" | "working" | "terminal" | "removed";

/** 邮箱投递结果（值域与 subagent.port.ts SubagentSendMessageDelivery 字面量对齐；非类型引用）。 */
export type TeamSendDelivery = "queued" | "steered" | "resumed";

// ---------- 契约键常量（单一出处；消费方必须引用这里） ----------

/** team journal 持久化键前缀（session store 侧；core journal 读写同源）。 */
export const TEAM_JOURNAL_KEY_PREFIX = "team.";

/** team 功能灰度 settings 键（默认关闭；bootstrap 装配与设置 UI 同源）。 */
export const AGENTS_TEAM_SETTINGS_ENABLED_KEY = "agentsTeam.enabled";

/** 团队产物目录（工作区相对；清理策略见 spec §13 开放问题）。 */
export const TEAM_ARTIFACTS_DIR = ".drora/team-artifacts";

/**
 * 成员默认 maxTurns（长寿命策略）。真实消费点（§21 A6，2026-10-24 注释订正）：
 * bootstrap install 的 resolveMemberBinding 装配值与 core member-runtime 长寿命
 * 策略兜底（`binding?.memberMaxTurns ?? request.maxTurns ?? 本常量`）；原注释
 * 「成队/建成员时 hub 兜底填入」描述的消费路径不存在。
 */
export const TEAM_MEMBER_DEFAULT_MAX_TURNS = 40;

/** 团队成员数默认上限（spec §1；settings 可调）。 */
export const TEAM_MEMBERS_MAX_DEFAULT = 5;

// ---------- 花名册 / 任务板只读快照 ----------

export interface TeamMemberView {
  agentId: string;
  memberName: string;
  profile?: string;
  profileColor?: string;
  state: TeamMemberState;
  currentTaskId?: string;
  childSessionId?: string;
  /**
   * 成员路由快照回读（spec §8.7）：staged 草案修订（reviseTeamPlan /
   * setTeamMemberName 以查询面重建草案入参）必须原样回写，否则 stageTeam 整体
   * 替换 members + journalStagedFact 会把建队时刻定死的路由静默清空
   * （2026-10-21 缺口10 修复前仅代码注释登记，无 spec 决策记录）。
   */
  modelSelection?: { provider: string; model: string; thought?: string };
}

export interface TeamRosterSnapshot {
  teamId: string;
  leadSessionId: string;
  permissionMode?: TeamPermissionMode;
  status: TeamStatus;
  /** team 名（stageTeam.name 回读；草案重建不丢名，同 modelSelection 语义）。 */
  name?: string;
  /** 管理者成员名（§22 契约 1；投影桥上 wire）。 */
  managerName?: string;
  members: readonly TeamMemberView[];
}

/** 任务卡规格（MetaGPT 式结构化交接产物；M5 contract 字段为 additive 预留）。 */
export interface TeamTaskSpec {
  goal: string;
  acceptance: string[];
  outputFormat?: string;
}

export interface TeamTaskContract {
  objective: string;
  acceptance: string[];
  inScope?: string[];
  outOfScope?: string[];
  verify?: string;
  kind?: string;
}

export interface TeamTaskCard {
  taskId: string;
  title: string;
  spec: TeamTaskSpec;
  status: TeamTaskStatus;
  assignee?: string;
  attempt: number;
  attemptId?: string;
  dependsOn: string[];
  artifactRefs: string[];
  output?: string;
  createdAt: string;
  updatedAt: string;
  recoveryRetried?: boolean;
  contract?: TeamTaskContract;
}

export interface TeamBoardSnapshot {
  teamId: string;
  tasks: readonly TeamTaskCard[];
  limit: number;
}

// ---------- 写操作输入 ----------

export interface TeamTaskCreateInput {
  title: string;
  spec: TeamTaskSpec;
  assignee?: string;
  dependsOn: string[];
  artifactRefs?: string[];
  contract?: TeamTaskContract;
}

export interface TeamTaskUpdateInput {
  taskId: string;
  /** 必须携带当前 attemptId；缺失 E1 / 失效 E2（错误分类即协议，spec §16.1）。 */
  attemptId: string;
  patch: {
    status?: TeamTaskStatus;
    output?: string;
    artifactRefs?: string[];
  };
  /** 终态后的署名追补：只追加不改 verdict、不需重认领（spec §16.1）。 */
  acceptanceSupplement?: {
    acceptanceResults?: string[];
    commandsRun?: string[];
    evidenceNote?: string;
  };
}

export interface TeamSendInput {
  /** memberName 或 agentId；名字必须仍指向原成员（E5）。 */
  to: string;
  message: string;
  summary?: string;
  /** 任务报告溯源世代（发送侧；isCurrentMail 第一谓词）。 */
  sourceTaskId?: string;
  sourceAttemptId?: string;
  /** 任务定向邮件：投递时 hub 快照目标 attemptId 作世代过滤（spec §16.3）。 */
  targetTaskId?: string;
}

export interface TeamReassignInput {
  taskId: string;
  /** memberName 或 "lead"（lead 接管直接 in_progress，无 claim 握手）。 */
  to: string;
  reason: string;
}

/**
 * lead 显式重开入参（spec §16 契约 5，2026-10-23 登记）：仅 failed 任务可重开，
 * 回共享池开新世代槽位。无 reason/to 字段——重开回共享池（定向指派经 reassign），
 * 不携带指派与措辞载荷，保持与 reassign 正交。
 */
export interface TeamReopenInput {
  taskId: string;
}

export interface TeamStageMemberDraft {
  memberName: string;
  /**
   * 2026-10-23 空白归一（specs/agents-team.md §19 契约 2）：对齐 wire 的
   * min(1).optional（drora-protocol-v4/team.ts 成员/stagedDraft 行）——缺省与空白
   * 均为合法入参，hub 落库前归一为键缺席；必填会逼生产点写 `?? ""`，让空串破
   * wire min(1) 烧每一帧（§17 契约 4 只封了超上界半边）。
   */
  profile?: string;
  modelSelection?: { provider: string; model: string; thought?: string };
}

export interface TeamStageInput {
  name?: string;
  /**
   * 团队管理者（specs/agents-team.md §22 契约 1，2026-10-26）：模型建草案时自行命名的
   * manager——hub 物化为 roster 首位成员并记 record.managerName；管理工具/终态汇报的
   * actor。与 draftMembers 重名由 hub 按 E13 同门拒绝。
   */
  manager: TeamStageMemberDraft;
  draftMembers: readonly TeamStageMemberDraft[];
  /**
   * 草案任务可携带既有 taskId（2026-10-21 缺口5 身份保持）：staged 再次入库
   * （reviseTeamPlan/setTeamMemberName 以 board 重建草案）时保留原 ID，dependsOn
   * 引用才不悬空。仅 staging 路径消费；portTaskCreate 忽略（成员侧工具 schema
   * 亦无此键，成员不能注入任意 ID）。新任务缺省由 hub 生成 task_<uuid>。
   */
  draftTasks: readonly (TeamTaskCreateInput & { taskId?: string })[];
  /**
   * 参数保留待后续卡（§21 A3，2026-10-24 订正）——v1 不实现直通，两阶段审批是
   * 唯一成队入口（spec §1）；TeamSpawn 工具 schema 不暴露该键（§14 缺口0 登记），
   * 生产不可达。原「仅用户明确要求跳过审批时直通」的注释与实现三方漂移已收口。
   */
  skipApproval?: boolean;
}

// ---------- 结果与错误 ----------

/** 错误码 E1-E14（文案常量唯一出处 core/src/team/errors.ts；表见设计 §3.1.2）。 */
export type TeamPortErrorCode =
  | "missing_attempt_id"
  | "attempt_revoked"
  | "attempt_generation_mismatch"
  | "invalid_transition"
  | "name_redirect"
  | "member_removed"
  | "team_not_present"
  | "team_halted"
  | "board_limit_reached"
  | "team_lead_only"
  | "message_target_terminal_retired"
  | "mailbox_persist_failed"
  | "message_too_large"
  | "draft_duplicate_member"
  | "draft_unknown_assignee"
  | "member_spawn_failed"
  // 2026-10-21 缺口5：草案 taskId 身份保持 + 依赖校验（spec §14）。unknown_dependency
  // 同时用于 portTaskCreate 的运行态存在性校验（悬空依赖任务会永久 pending）。
  | "draft_duplicate_task"
  | "unknown_dependency"
  | "dependency_cycle"
  // 2026-10-22 spec §16 契约 2（终态不可变补齐）：终态任务的 output/artifactRefs
  // 不可改写，唯一合法通道是 acceptance_supplement 署名追补（spec §16.1）。不复用
  // attempt_revoked——其教学文案「已被转派」对已完工任务是错误陈述（错误分类即协议）。
  | "terminal_read_only"
  // 2026-10-23 spec §17 契约 4（草案字段与 wire 限额同门）：草案原样进 team 投影，
  // 超限字段会让投影一 emit 就烧掉会话流的每一帧（proto.frameAssemblyInvalidPayload
  // → fail-closed 白屏）。在 stageTeam 源头拒绝，调用方改短字段而不是让坏载荷落库。
  | "draft_field_too_long"
  // 2026-10-27 L7：reassign 目标忙闲校验——「一成员至多一个开放任务」（spec §2.3）
  // 在转派侧的拒绝码；认领面同义状态是 taskClaim 的 busy_with_open_task，此处是
  // TeamMutationResult.error 面（教学式分类：改选空闲成员，错误分类即协议）。
  | "member_busy"
  // 2026-10-27 L10：草案空白名拒绝——memberName 是 wire 面 agent↔task 关系的联接键
  // （§1 草案校验），空白不能像空白 profile 那样归一为键缺席；与 draft_field_too_long
  // 同门（§17 契约 4 烧帧防护），管 port 直调绕过工具 schema min(1) 的形态。
  | "draft_blank_name";

export interface TeamPortError {
  code: TeamPortErrorCode;
  message: string;
  hint?: string;
}

export interface TeamMutationResult {
  status: "ok" | "rejected";
  error?: TeamPortError;
}

export interface TeamTaskMutationResult extends TeamMutationResult {
  task?: TeamTaskCard;
}

export type TeamTaskClaimResult =
  | { status: "claimed"; taskId: string; attemptId: string; attempt: number }
  | { status: "already_taken" }
  | { status: "dependencies_not_ready"; blockedBy: string[] }
  | { status: "busy_with_open_task"; currentTaskId: string }
  | { status: "rejected"; error: TeamPortError };

export type TeamSendResult =
  | { status: "success"; messageId: string; delivery: TeamSendDelivery }
  | { status: "failed"; error: TeamPortError };

export interface TeamStageResult extends TeamMutationResult {
  teamId?: string;
}

export interface TeamApproveResult extends TeamMutationResult {
  spawnedMembers?: readonly string[];
}

// ---------- 端口（两级接口，设计差异 D8） ----------

/**
 * 成员侧受限协作面：注入 teammate child runtime（经 core/src/team 私有端口构造
 * 回调闭包捕获——v2 注入方式，无 deps 字段接缝）。
 * 身份结构性免疫：port 知道自己注入进了哪个成员，from 不可伪造。
 */
export interface TeamMemberPort {
  roster(): TeamRosterSnapshot;
  /**
   * §22 契约 4：manager 成员的转派/接管（child session 自证 actor；hub isTeamActor
   * 判定——普通成员调用返回 team_lead_only）。2026-10-27 M9（决策 D1，裁定 3）：
   * lead 会话同样被拒（lead 零管理工具、纯结果消费者）。
   */
  reassign(input: TeamReassignInput): Promise<TeamMutationResult>;
  /**
   * 2026-10-27 M15（决策 D8）：manager 成员显式重开 failed 任务（failed→pending
   * 受控出边，spec §16 契约 5）——TeamReopen 工具的生产入口（child session 自证
   * actor；非 manager 调用一律 team_lead_only）。此前该出边有 hub 实现无任何
   * 生产入口（lead 端口无调用方），失败通知却教用户找 lead 重开。
   */
  reopen(input: TeamReopenInput): TeamTaskMutationResult;
  boardRead(): TeamBoardSnapshot;
  taskGet(taskId: string): TeamTaskCard | undefined;
  taskCreate(input: TeamTaskCreateInput): TeamTaskMutationResult;
  taskUpdate(input: TeamTaskUpdateInput): TeamTaskMutationResult;
  /** claim 只领不派：成功返回 attemptId 作为后续更新凭证（spec §16.2）。 */
  taskClaim(taskId: string): TeamTaskClaimResult;
  send(input: TeamSendInput): TeamSendResult;
}

/**
 * lead 侧裁决面：TeamMemberPort 全量 + lead 专属动作（staged 审批、恢复停队）。
 * 成员不可获得（team_lead_only E10 由装配结构性保证）。
 * 2026-10-27 M9/M15（裁定 3：lead 零管理工具）：reassign/reopen 从 lead 专属面移除
 * ——继承自 TeamMemberPort 的同名方法对 lead 绑定一律 team_lead_only（hub isTeamActor
 * 仅认 manager agentId）；原 reopenTask lead 专属声明删除（有实现无生产入口，重开归
 * manager 的 TeamReopen 工具）。
 */
export interface TeamLeadPort extends TeamMemberPort {
  /** staged 草案创建；staged 已存在时 = 原子更新同一草案（设计差异 D3）。 */
  stageTeam(input: TeamStageInput): TeamStageResult;
  /**
   * Approve & Run：唯一创建成员的裁决入口（原子 spawn，全败回滚草案）。
   * 2026-10-27 L9（决策 D10）：增可选 options（§10 增补三 permissionMode——批准时刻
   * 覆写成员权限模式，缺省维持建队捕获值）；port 契约签名补齐后生产 handler 改走
   * port，不再结构性直调 hub。
   * §10 增补六（2026-10-27）：rememberForSession——true 时 hub 置会话免问标志，
   * 本 lead 会话后续 TeamSpawn 草案自动批准（等价 workflow allowForSession）。
   */
  approveStage(options?: {
    permissionMode?: TeamPermissionMode;
    rememberForSession?: boolean;
  }): Promise<TeamApproveResult>;
  /** 恢复 halted/escalated；必须带非空 reason（E：用户停的队不得静默恢复）。 */
  resume(reason: string): TeamMutationResult;
}
