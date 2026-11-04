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

/** mate.sqlite schema 版本；迁移只加不破，未知版本报 schema_incompatible（01 §1.1）。 */
export const ASSISTANT_STORE_SCHEMA_VERSION = 1;

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
// 工单状态机（spec §7/§8：P1 三态简化 awaiting_output 并入 done；P2 恢复四态只加不破）
// ---------------------------------------------------------------------------

export const ASSISTANT_TICKET_STATUSES = {
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
} as const;
