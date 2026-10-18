import type {
  TeamMemberState,
  TeamPermissionMode,
  TeamStatus,
  TeamTaskCard,
  TeamTaskContract,
  TeamTaskSpec,
  TeamTaskStatus,
  TeamSendDelivery,
} from "@drora/contracts";

/**
 * Team 内核内部态（spec §2.2 状态所有者表：唯一所有者是 lead runtime 的 TeamHub；
 * 本文件类型是 hub/board/mailbox 的共享词汇表。wire 投影形态见 shared team.ts ——
 * M2 PR-2.1；投影不携带 handoffId/reassigning/parked 等内部交接态）。
 */

export type { TeamMemberState, TeamStatus, TeamTaskStatus };

/** 内部任务记录：TeamTaskCard 的超集（+ 交接态与补充证据）。 */
export interface TeamTaskInternal {
  taskId: string;
  title: string;
  spec: TeamTaskSpec;
  status: TeamTaskStatus;
  /** memberName 或 "lead"。 */
  assignee?: string;
  /** 单调 attempt 计数（spec §16.1 双令牌之一）。 */
  attempt: number;
  /** 本次执行的能力凭证（UUID）；pending 无。 */
  attemptId?: string;
  /** 交接世代号：序列化「失效→静默→再入」异步过程（spec §16.1）。 */
  handoffId?: string;
  /** 交接进行中：目标成员的新投递等待静默。 */
  reassigning: boolean;
  dependsOn: string[];
  artifactRefs: string[];
  output?: string;
  createdAt: string;
  updatedAt: string;
  /** 冷恢复单次重试已用标记（spec §2.3；防无限重派）。 */
  recoveryRetried?: boolean;
  /** M5 质量门禁 additive 预留（v1 不强制）。 */
  contract?: TeamTaskContract;
  /** 终态署名追补（只追加；不改 verdict 不重认领）。 */
  acceptanceSupplement?: {
    acceptanceResults?: string[];
    commandsRun?: string[];
    evidenceNote?: string;
  };
}

/** 内部成员记录。 */
export interface TeamMemberInternal {
  agentId: string;
  memberName: string;
  profile?: string;
  profileColor?: string;
  state: TeamMemberState;
  childSessionId?: string;
  /** 当前路由快照（spec §8.7：建成员那一刻的世界被固定）。 */
  modelSelection?: { provider: string; model: string; thought?: string };
  /** 移除中/已移除（移除安全序见 spec §16.2）。 */
  removed: boolean;
}

/** 邮箱条目（spec §3.3.3；journal 持久化，投递状态机见 member-delivery）。 */
export interface TeamMailboxEntry {
  messageId: string;
  /** memberName 或 "lead"。 */
  from: string;
  /** memberName 或 agentId。 */
  to: string;
  message: string;
  summary?: string;
  at: string;
  sourceTaskId?: string;
  sourceAttemptId?: string;
  sourceTaskStatus?: TeamTaskStatus;
  targetTaskId?: string;
  targetAttemptId?: string;
  deliveredAt?: string;
  deliveredVia?: Exclude<TeamSendDelivery, "queued">;
  /** ack 只认注入（spec §16.3）：queued 不算送达。 */
  deliveredAccepted: boolean;
}

/** team 记录（hub 持有的聚合根；journal 事件流是它的持久化事实源，M3 PR-3.1）。 */
export interface TeamRecord {
  teamId: string;
  name?: string;
  leadSessionId: string;
  permissionMode?: TeamPermissionMode;
  status: TeamStatus;
  members: TeamMemberInternal[];
  tasks: TeamTaskInternal[];
  mailbox: TeamMailboxEntry[];
  createdAt: string;
  updatedAt: string;
}

/** 投影裁剪限额（契约键见 team.port.ts；shared PROTOCOL_V4_LIMITS.team 于 M2 落）。 */
export interface TeamInternalLimits {
  boardTasksMax: number;
  mailboxRetentionPerMember: number;
  mailboxTailWindow: number;
  messageMaxChars: number;
  dependencyDigestPerItemChars: number;
  dependencyDigestTotalChars: number;
}

export const TEAM_KERNEL_LIMITS: TeamInternalLimits = {
  boardTasksMax: 100,
  mailboxRetentionPerMember: 20,
  mailboxTailWindow: 10,
  messageMaxChars: 8_000,
  dependencyDigestPerItemChars: 2_000,
  dependencyDigestTotalChars: 12_000,
} as const;

/** TaskCard 投影（内部记录 → wire 卡；剥除内部交接态）。 */
export function taskCardOf(task: TeamTaskInternal): TeamTaskCard {
  return {
    taskId: task.taskId,
    title: task.title,
    spec: task.spec,
    status: task.status,
    ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    attempt: task.attempt,
    ...(task.attemptId === undefined ? {} : { attemptId: task.attemptId }),
    dependsOn: [...task.dependsOn],
    artifactRefs: [...task.artifactRefs],
    ...(task.output === undefined ? {} : { output: task.output }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.recoveryRetried === undefined ? {} : { recoveryRetried: task.recoveryRetried }),
    ...(task.contract === undefined ? {} : { contract: task.contract }),
  };
}

/**
 * 「lead」寻址键（assignee 的 lead 取值；与成员名命名空间隔离由 hub 校验保证）。
 * 2026-10-18 单一出处化：字面量定义在 @drora/shared TEAM_LEAD_ASSIGNEE，
 * 这里仅按内核内部名再导出——UI 侧 lead 判定直接引 shared 常量，两侧不再各写一份。
 */
export { TEAM_LEAD_ASSIGNEE as LEAD_ASSIGNEE_KEY } from "@drora/shared/drora-protocol-v4";
