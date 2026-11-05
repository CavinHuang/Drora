/**
 * Drora Mate（个人助理「大副」）跨进程契约常量（specs/drora-personal-assistant.md §5；
 * 实施依据 docs/mate-implementation-plan-2026-11-04/00-master-plan.md §2 + 01-p1-detailed-design.md §1）。
 *
 * 契约键单一出处（AGENTS.md）：以下字面量只在此定义一次，生产方（services
 * assistant-tickets 服务）与消费方（CLI/host/UI）引用同一常量，禁止两处独立写字面量；
 * 改名任何一侧前先全链 grep 生产与消费。结构照 contracts/persona.ts 先例
 * （版本常量 + 存储位置键 + 封闭枚举 + 严格只读类型）。
 *
 * 明确不进本文件：
 * - AssistantSnapshot/ticket 等运行时形状：services assistant-tickets 模块所有
 *   （host 侧 zod parse；UI 经 services index type-only 引用，01 号详设 §1.2）；
 * - v4 wire 命令族：视 P2 Spike S2-T0 结论而定（spec §5），成立时另立
 *   drora-protocol-v4/assistant.ts 并在此只留方法名常量。
 */

// ---------------------------------------------------------------------------
// 版本常量（值随首次发行冻结；语义变更必须递增并走迁移/兼容流程，照 persona.ts）
// ---------------------------------------------------------------------------

/** mate.sqlite schema 版本；迁移只加不破，未知版本报 schema_incompatible（01 §1.1）。
 * v2（2026-11-05，P2）：新增 router_evaluation 表与 ticket.write_domain 列。 */
export const ASSISTANT_STORE_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// 身份与派发模式（spec §1 命名契约 / §7 三模式；P2 定案见 02 详设 §1.1/§5）
// ---------------------------------------------------------------------------

/**
 * assistant 虚拟 workspace 的身份键（02 详设 §1.1 定案）：身份键规则
 * `workspaceIdentity?.trim() || workspacePath` 下 identity 是隔离键；对应
 * workspacePath（cwd/CLI 会话状态落位）由 services paths.getAssistantWorkspaceDir()
 * 单点派生（host 内部路径，不跨进程，不进契约）。
 */
export const ASSISTANT_IDENTITY = "drora-mate";

/** 派发模式（spec §7 派发桥）：A=独立单工单；B=建队（prompt 驱动 /team）；C=附着既有会话。 */
export const ASSISTANT_DISPATCH_MODES = {
  independent: "A",
  team: "B",
  attach: "C",
} as const;

export type AssistantDispatchMode =
  (typeof ASSISTANT_DISPATCH_MODES)[keyof typeof ASSISTANT_DISPATCH_MODES];

/** 代际 cause 封闭枚举（spec §8；换代只由锚校验/生命周期事件/lease 失效触发）。 */
export const ASSISTANT_GENERATION_CAUSES = {
  superseded: "superseded",
  lost: "lost",
  userPicked: "user_picked",
  expired: "expired",
} as const;

export type AssistantGenerationCause =
  (typeof ASSISTANT_GENERATION_CAUSES)[keyof typeof ASSISTANT_GENERATION_CAUSES];

/** 生产默认值（spec §9 软预算 P2 恢复 3；config kv 缺席时回落到这里）。 */
export const ASSISTANT_DEFAULTS = {
  budgetMaxActivePerWorkspace: 3,
} as const;

// ---------------------------------------------------------------------------
// 持久化位置键（spec §1 命名契约：数据文件名 mate.sqlite；路径拼接只引用这里的字面量）
// ---------------------------------------------------------------------------

export const ASSISTANT_STORAGE_KEYS = {
  /** 应用配置目录下的资料目录名。 */
  directory: "mate",
  /** 该目录内的 SQLite 库文件名。 */
  database: "mate.sqlite",
} as const;

// ---------------------------------------------------------------------------
// 封闭枚举（准入矩阵 spec §6；派发权限档 spec §7；照 persona RECEIPT_SCOPES 形态）
// ---------------------------------------------------------------------------

/** 准入模式：observe=全量零执行（点名出决策卡、未指名记 would-accept）；auto P1 恒锁。 */
export const ASSISTANT_MODES = {
  off: "off",
  observe: "observe",
  auto: "auto",
} as const;

export type AssistantMode = (typeof ASSISTANT_MODES)[keyof typeof ASSISTANT_MODES];

/** 触发强度：explicit=名单内点名/工单 follow-up；inferred=名单内未指名/名单外机器。 */
export const ASSISTANT_STRENGTHS = {
  explicit: "explicit",
  inferred: "inferred",
} as const;

export type AssistantStrength = (typeof ASSISTANT_STRENGTHS)[keyof typeof ASSISTANT_STRENGTHS];

/** 准入产出：决策卡（explicit×observe）与 would-accept（inferred×observe）分离，01 §1.1。 */
export const ASSISTANT_OUTCOMES = {
  decisionCard: "decision_card",
  wouldAccept: "would_accept",
  rejected: "rejected",
  ignored: "ignored",
} as const;

export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[keyof typeof ASSISTANT_OUTCOMES];

/**
 * 派发权限档（Mandate scope.permissionTier）：即 DroraSessionMode 子集
 * （plan/edit/auto 三值不派发）。yolo 必须决策卡人工放行（spec §2.5）；
 * 默认 build/guarded（00 master plan §2）。载体是 v4 createSession 的 config.mode
 * （payload.permissionScope 是 z.literal("session") 唯一值，不承载权限档——二审 B1）。
 */
export const ASSISTANT_PERMISSION_TIERS = {
  build: "build",
  guarded: "guarded",
  yolo: "yolo",
} as const;

export type AssistantPermissionTier =
  (typeof ASSISTANT_PERMISSION_TIERS)[keyof typeof ASSISTANT_PERMISSION_TIERS];

// ---------------------------------------------------------------------------
// 工单状态机（spec §7/§8：P2 新增 queued（软预算排队）——只加不破。
// awaiting_output 四态恢复依赖汇报/outbox 管线（P4 汇报卡完整版），P2 维持
// turn_completed→done 的 P1 折叠，避免出现无推进路径的悬挂态）
// ---------------------------------------------------------------------------

export const ASSISTANT_TICKET_STATUSES = {
  /** 软预算满时的排队态（spec §9：超出排队+告知卡，释放即 FIFO 派发）。 */
  queued: "queued",
  dispatched: "dispatched",
  running: "running",
  done: "done",
  failed: "failed",
} as const;

export type AssistantTicketStatus =
  (typeof ASSISTANT_TICKET_STATUSES)[keyof typeof ASSISTANT_TICKET_STATUSES];

// ---------------------------------------------------------------------------
// 管理错误码（封闭集合；服务失败臂只携带固定码，正文入 fail_reason 不进错误码）
// ---------------------------------------------------------------------------

export const ASSISTANT_ERROR_CODES = {
  /** setMode("auto")：信任门未开（P1 恒拒）。 */
  autoLocked: "mate.auto.locked",
  /** yolo 档派发：必须决策卡人工放行。 */
  yoloRequiresHumanApproval: "mate.yolo.requiresHumanApproval",
  /** sqlite busy 超时后仍失败。 */
  storeBusy: "mate.store.busy",
  /** 库版本迁移失败/未知版本。 */
  storeMigration: "mate.store.migration",
  /** 决策卡不存在/已被消费。 */
  decisionNotFound: "mate.decision.not_found",
  /** 名单校验失败（空 identity 等）。 */
  validationFailed: "mate.validation.failed",
  /** 工单不存在或已终态。 */
  ticketNotFound: "mate.ticket.not_found",
  /** 派发目标 ACK 拒绝（v4 通道）。 */
  dispatchRejected: "mate.dispatch.rejected",
  /** Router 评估通道未装配/失败：诚实降级 Tier3 问人，不重试模型（02 详设 §1.2）。 */
  routerUnavailable: "mate.router.unavailable",
  /** 附着目标校验失败（不存在/归属 identity 不符，02 详设 §2 Tier2 派发桥校验）。 */
  attachTargetInvalid: "mate.attach.invalid",
  /** 锚校验失配/会话已失位（spec §8 换代触发源①②）。 */
  anchorMismatch: "mate.incarnation.anchor_mismatch",
} as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES];

// ---------------------------------------------------------------------------
// 有界快照容量（AssistantSnapshot 上界；01 §1.2——renderer 只读投影，防止无界增长）
// ---------------------------------------------------------------------------

export const ASSISTANT_SNAPSHOT_LIMITS = {
  triggersMax: 50,
  decisionsMax: 50,
  ticketsMax: 100,
  /** TicketView.brief 首行截断长度（code point）。 */
  briefPreviewMax: 120,
  /** Router 决策证据条数上界（02 详设 §1.2：evidence 数组有界）。 */
  routerEvidenceMax: 3,
  /** Router 证据引用单条长度上界（code point，02 详设 §1.2：原文片段 ≤80 字）。 */
  routerEvidenceQuoteMax: 80,
  /** 候选卡 verbatim 截断长度（code point，02 详设 §1.3：截断 1500 字）。 */
  candidateBriefMax: 1500,
  /** Router 无状态壳轮转阈值：每 N 张工单归档旧会话建新会话（02 详设 §1.1）。 */
  routerRotateEveryTickets: 10,
} as const;

// ---------------------------------------------------------------------------
// assistantActivity wire（spec §11.4 / 02 详设 §6；host 任务行 overlay 携带，
// controller frame → 桌面与手机同源消费；旧帧字段缺席合法）
// ---------------------------------------------------------------------------

/** 任务行 activity 内 mate 摘要的 wire 字段名（与 teamActivity 键同位；单出处）。 */
export const SESSION_MATE_ACTIVITY_KEY = "mate";

/** mate 摘要有界容量（schema 同值引用，防两处漂移）。 */
export const ASSISTANT_MATE_ACTIVITY_LIMITS = {
  activeCountMax: 99,
  pendingDecisionsMax: 99,
} as const;

// ---------------------------------------------------------------------------
// assistantActivity wire schema（本文件处于 shared-contracts 受管根——schema 与键常量
// 同处，避免在未受管的 drora-protocol-v4 目录新增文件；drora-protocol-v4/index.ts
// re-export 供 controller.ts 与 wire 消费方使用，语义与 teamActivity schema 同位）
// ---------------------------------------------------------------------------

import { z } from "zod";

/** host 侧 TicketService 快照合成的任务行 mate 摘要（strict、有界、旧帧缺席合法）。 */
export const sessionMateActivitySchema = z
  .object({
    /** 目标 workspace 的活动工单数（dispatched/running）。 */
    activeCount: z
      .number()
      .int()
      .nonnegative()
      .max(ASSISTANT_MATE_ACTIVITY_LIMITS.activeCountMax),
    /** 目标 workspace 的待决策卡数（decision_card 未决）。 */
    pendingDecisions: z
      .number()
      .int()
      .nonnegative()
      .max(ASSISTANT_MATE_ACTIVITY_LIMITS.pendingDecisionsMax),
    /** 摘要合成时刻（host 时钟；仅展示新鲜度，不参与排序语义）。 */
    updatedAtMs: z.number().finite().nonnegative(),
  })
  .strict();
export type SessionMateActivity = z.infer<typeof sessionMateActivitySchema>;
