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
 * v2（2026-11-05，P2）：新增 router_evaluation 表与 ticket.write_domain 列。
 * v3（2026-11-05，P2 审查修复）：新增 ticket.dispatch_intent 列——建票事务落库放行时的
 * 派发意图（mode/attachSessionId/tier），queued FIFO 释放按落库形态重放派发，
 * 不再依赖派发成功后才写入的 dispatch_mode（修复「排队后 Mode B/C 退化为 Mode A」）。
 * v4（2026-11-05，P3）：新增 trigger.channel_ref / trigger.remote_session_id /
 * ticket.channel_ref 列——Source 注册表事件绑定（03 详设 §5：ticket 增 channel_ref
 * 索引，feishu thread / GitHub issue / 手机会话；同绑定 follow-up 直通 Tier1）。
 * v5（2026-11-05，P4）：新增 ticket.stale_ms / ticket.stale_kind 列——watchdog 停滞
 * 标记（04 详设 §1 判据表；watchdog 是唯一写者，判据解除同轮清除；旧行 NULL=未标记）。 */
export const ASSISTANT_STORE_SCHEMA_VERSION = 5;

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

/**
 * Source 注册表 source_kind 封闭枚举（03 详设 §1；spec §5 Trigger 来源）。值落
 * mate.sqlite trigger.source_kind 列与快照投影——字面量单出处，消费方（服务/快照/UI）
 * 只引用本常量，禁止两处独立写。
 */
export const ASSISTANT_SOURCE_KINDS = {
  local: "local",
  feishu: "feishu",
  phone: "phone",
  github: "github",
} as const;

export type AssistantSourceKind =
  (typeof ASSISTANT_SOURCE_KINDS)[keyof typeof ASSISTANT_SOURCE_KINDS];

/** Source 侧凭证键（credential service 键名空间；不落 kv、不进日志——03 详设 §4）。 */
export const ASSISTANT_CREDENTIAL_KEYS = {
  /** GitHub Source 轮询与回复用 PAT（独立 scope，复用/替换由装配层决定）。 */
  githubPat: "mate:github:pat",
} as const;

/** 生产默认值（spec §9 软预算 P2 恢复 3；config kv 缺席时回落到这里）。 */
export const ASSISTANT_DEFAULTS = {
  budgetMaxActivePerWorkspace: 3,
} as const;

/**
 * P4 auto 信任门缺省阈值（04 详设 §2；kv `trust_gate_min_rate`/`trust_gate_min_samples`
 * 可调，缺省回落到这里——阈值语义单一出处，kv 可调只覆盖值不覆盖语义）。
 */
export const ASSISTANT_TRUST_GATE_DEFAULTS = {
  /** 放行率开放线（人工放行 /（would-accept+人工放行））。 */
  minReleaseRate: 0.8,
  /** 样本数开放线（would-accept+人工放行 总数）。 */
  minSamples: 15,
} as const;

/**
 * P4 watchdog 缺省参数（04 详设 §1 判据表；轮询间隔 kv `watchdog_interval_ms` 可调，
 * 判据阈值为常量——判据语义钉死在判据表，避免「kv 手滑改判据」破坏不自动终止不变式）。
 */
export const ASSISTANT_WATCHDOG_DEFAULTS = {
  /** 定时轮询间隔（ms；15 分钟/轮）。 */
  intervalMs: 15 * 60 * 1000,
  /** running 停滞判据阈值（ms；30 分钟）。 */
  runningStallMs: 30 * 60 * 1000,
  /** awaiting 滞留判据阈值（ms；60 分钟；§3 工件核验交付后激活）。 */
  awaitingStallMs: 60 * 60 * 1000,
  /** 排队饥饿判据阈值（ms；24 小时）。 */
  queuedStarveMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * 每日打扰配额缺省（04 详设 §4；AppSettings `droraMateDailyQuota` 缺席/坏值时回落）。
 */
export const ASSISTANT_DISTURBANCE_DEFAULTS = {
  dailyQuota: 5,
} as const;

/**
 * 每日打扰事件类别（04 详设 §4 三端同源计数；值落 mate.sqlite kv 日记录 JSON 与
 * IAssistantTicketService.admitDisturbance 入参——字面量单出处，生产方（服务）与
 * 消费方（UI/桌宠投影/watchdog）只引用本常量）。
 */
export const ASSISTANT_DISTURBANCE_KINDS = {
  /** 决策卡推送：永不抑制（安全优先于安静），仍计数。 */
  decision: "decision",
  /** 汇报推送（含 watchdog 通知）：当日累计超配额 → 转次日摘要聚合。 */
  report: "report",
  /** 桌宠气泡：同 report 口径。 */
  bubble: "bubble",
} as const;

export type AssistantDisturbanceKind =
  (typeof ASSISTANT_DISTURBANCE_KINDS)[keyof typeof ASSISTANT_DISTURBANCE_KINDS];

/**
 * AppSettings 键（spec §1 `drora.mate.*` 命名空间的 P4 首键；04 详设 §4）。
 * 属性载体照 PERSONA_RUNTIME_PREFERENCE_ENABLED 先例：AppSettings 是 camelCase
 * 接口属性，键字面量单出处本常量（protocol.ts 接口 + validationAppSettings 两处
 * schema + services 装配层读路径引用同一常量）。
 */
export const ASSISTANT_SETTINGS_KEYS = {
  /** 每日打扰配额（条/日；0=非决策类全静音聚合，决策类不受限）。 */
  dailyQuota: "droraMateDailyQuota",
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

/**
 * 准入产出：决策卡（explicit×observe）与 would-accept（inferred×observe）分离，01 §1.1。
 * auto_notice（04 详设 §2 P4）：auto 模式下已自动执行的事件（explicit 直派 /
 * inferred 评估通过派发）的告知卡——decided_by 恒 gate，不计入放行率统计
 * （releaseCount 口径=decision_card+user，不受本枚举扩充影响）。
 */
export const ASSISTANT_OUTCOMES = {
  decisionCard: "decision_card",
  wouldAccept: "would_accept",
  autoNotice: "auto_notice",
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
  /** Source 事件入口被开关关闭（source_config 对应 kind enabled ≠ true；spec §6 收尾注记）。 */
  sourceDisabled: "mate.source.disabled",
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
  /** Tier2 附着候选集上界（02 详设 §2：有界候选集；硬过滤后截断，不无界喂给 Router）。 */
  attachCandidatesMax: 5,
  /** Tier2 候选新鲜度上界（ms；02 详设 §2 硬过滤 updatedAt>7d，过期会话不作附着目标）。 */
  attachCandidateFreshMaxMs: 7 * 24 * 60 * 60 * 1000,
  // ---- P4（04 详设 §1/§4）：watchdog 通知区与配额摘要的有界容量 ----
  /** 快照 watchdogNotices 通知区条数上界（kv 存储同值裁剪，防无界增长）。 */
  watchdogNoticesMax: 5,
  /** 每日打扰摘要（次日聚合）单日条数上界。 */
  disturbanceDigestItemsMax: 20,
  /** 每日打扰摘要单条文本截断长度（code point）。 */
  disturbanceDigestItemMax: 200,
  /** 查询接口回扫未投递摘要的天数上界。 */
  disturbanceDigestDaysMax: 7,
} as const;

// ---------------------------------------------------------------------------
// 桌宠接缝 IPC 通道（spec §11 P3 落地注记；03 详设 §6；照 PlatformChannels/
// DESKTOP_PET_CONTRACT.channels 形态——字面量唯一出处，Main/renderer/pet/tray 四侧
// 引用同一常量，禁止裸写）。数据=主窗口 renderer 发布有界 MatePetProjection（schema
// 在 src/assistantPet.ts 单出处），Main 只转发（校验来源窗口）给宠物窗/tray 窗；
// rendererEvent=Main→Renderer 导航端口（菜单「打开大副」/tray 点卡直达/气泡点击共用）。
// pet/tray 不建第二 Host（03 详设 §6）。
// ---------------------------------------------------------------------------

export const MATE_PET_COMMANDS = {
  channels: {
    /** Renderer → Main：发布 MatePetProjection（仅桌面主窗口有发布方）。 */
    publish: "drora:mate-pet-publish",
    /** Main → Pet/Tray：推送 MatePetProjection 渲染帧（badge/速览区）。 */
    render: "drora:mate-pet-render",
    /** Pet/Tray → Main：速览/气泡动作（open-ticket / decide；Main 只转发给 renderer）。 */
    command: "drora:mate-pet-command",
    /** Main → Renderer：导航端口事件（open-mate / open-ticket / decide）。 */
    rendererEvent: "drora:mate-pet-renderer-event",
  },
} as const;

/** MatePetProjection 有界容量（schema 同值引用，防两处漂移；03 详设 §6 速览=精简）。 */
export const MATE_PET_PROJECTION_LIMITS = {
  /** 速览待决策卡条数上界。 */
  pendingMax: 5,
  /** 速览进行中工单条数上界。 */
  activeMax: 5,
  /** 单条文本（原文/汇报摘要）截断长度（code point，对齐 desktopPet preview 上限）。 */
  textMax: 120,
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
