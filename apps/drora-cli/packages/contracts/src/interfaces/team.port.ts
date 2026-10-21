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

/** 成员默认 maxTurns（长寿命策略；成队/建成员时 hub 兜底填入）。 */
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

export interface TeamStageMemberDraft {
  memberName: string;
  profile: string;
  modelSelection?: { provider: string; model: string; thought?: string };
}

export interface TeamStageInput {
  name?: string;
  draftMembers: readonly TeamStageMemberDraft[];
  /**
   * 草案任务可携带既有 taskId（2026-10-21 缺口5 身份保持）：staged 再次入库
   * （reviseTeamPlan/setTeamMemberName 以 board 重建草案）时保留原 ID，dependsOn
   * 引用才不悬空。仅 staging 路径消费；portTaskCreate 忽略（成员侧工具 schema
   * 亦无此键，成员不能注入任意 ID）。新任务缺省由 hub 生成 task_<uuid>。
   */
  draftTasks: readonly (TeamTaskCreateInput & { taskId?: string })[];
  /** 仅用户明确要求跳过审批时直通（spec §1 两阶段成队）。 */
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
  | "dependency_cycle";

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
  boardRead(): TeamBoardSnapshot;
  taskGet(taskId: string): TeamTaskCard | undefined;
  taskCreate(input: TeamTaskCreateInput): TeamTaskMutationResult;
  taskUpdate(input: TeamTaskUpdateInput): TeamTaskMutationResult;
  /** claim 只领不派：成功返回 attemptId 作为后续更新凭证（spec §16.2）。 */
  taskClaim(taskId: string): TeamTaskClaimResult;
  send(input: TeamSendInput): TeamSendResult;
}

/**
 * lead 侧裁决面：TeamMemberPort 全量 + lead 专属动作（转派/接管、恢复停队、
 * staged 审批）。成员不可获得（team_lead_only E10 由装配结构性保证）。
 */
export interface TeamLeadPort extends TeamMemberPort {
  /** staged 草案创建；staged 已存在时 = 原子更新同一草案（设计差异 D3）。 */
  stageTeam(input: TeamStageInput): TeamStageResult;
  /** Approve & Run：唯一创建成员的裁决入口（原子 spawn，全败回滚草案）。 */
  approveStage(): Promise<TeamApproveResult>;
  /** 转派/接管：先失效旧 attempt，等旧成员静默后开新 attempt（spec §16.1）。 */
  reassign(input: TeamReassignInput): Promise<TeamMutationResult>;
  /** 恢复 halted/escalated；必须带非空 reason（E：用户停的队不得静默恢复）。 */
  resume(reason: string): TeamMutationResult;
}
