/**
 * Mate 视图模型纯函数（docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §5
 * 「view-model 纯函数……零副作用，单测主战场」）。
 *
 * 快照本体永远来自 IAssistantTicketService 的推送（useAssistantTickets 订阅），这里只做
 * 无副作用的投影：分组 / 计数 / 信任透传 + 供组件复用的判定谓词。禁止在此发请求、
 * 写状态或触碰 DOM——输入快照不被改写（filter/copy 产生新数组）。
 *
 * 服务投影语义（对齐 services/src/assistant-tickets 实读）：
 * - 待决策卡 = outcome=decision_card 且 decidedBy=gate（放行后 decided_by 记 user，
 *   卡片脱离待决策集；trust.releaseCount 的 SQL 口径同为 decision_card+user）；
 * - 观察行（would-accept）= outcome=would_accept（dismiss 后改记 ignored，自然出清）；
 * - 进行中（软预算口径）= status ∈ {dispatched, running, awaiting_output}（P4 起
 *   awaiting 占预算位，04 §3；服务侧 isBudgetActiveStatus 单一出处同集）；
 * - queued（specs §9 软预算排队）不计入软预算活动数，状态条单列 queued 计数。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SOURCE_KINDS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import type { AssistantPermissionTier } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantRouterSuggestionView,
  AssistantServiceError,
  AssistantSnapshot,
  AssistantTicketView,
  AssistantTrustView,
  MateThreadRow,
} from "@drora/services";

/** Side Pane 过滤 pills（01 §5：待决策/进行中/观察中/全部）。 */
export type MateFilter = "decision" | "running" | "observe" | "all";

/**
 * 未指名目标 workspace 的分组键：TicketView.targetWorkspaceIdentity 为 null/"" 时归入。
 * 服务侧 targetIdentity 缺省即空串（assistantTicketsService targetIdentity ?? ""），键统一取 ""。
 */
export const MATE_UNTARGETED_WORKSPACE_KEY = "";

/** 按 MateFilter 折叠后某个目标 workspace 的工单组（组头消费 usageTotal=组内实耗合计）。 */
export interface MateWorkspaceGroup {
  /** 目标 workspaceIdentity；未指名目标为 MATE_UNTARGETED_WORKSPACE_KEY。 */
  readonly key: string;
  readonly tickets: readonly AssistantTicketView[];
  /** 组内实耗合计（token-only，01 §1.1；服务侧已按差值口径累计）。 */
  readonly usageTotal: { readonly inputTokens: number; readonly outputTokens: number };
}

/** 过滤 pills 的全局计数（与当前 filter 无关，供 pills 徽标恒定显示）。 */
export interface MateViewCounts {
  /** 待决策卡数（decision_card + gate）。 */
  readonly decision: number;
  /** 进行中工单数（dispatched+running）。 */
  readonly running: number;
  /** would-accept 观察记录数。 */
  readonly observe: number;
  /** 全部条目数 = 待决策卡 + 全部工单 + 观察记录。 */
  readonly all: number;
}

export interface MateViewModel {
  /** 按目标 workspace 分组的工单（filter 决定哪些工单入组；决策卡/观察行不分组——投影无目标字段）。 */
  readonly groups: readonly MateWorkspaceGroup[];
  readonly counts: MateViewCounts;
  /** 快照信任透传（wouldAcceptCount / releaseCount，服务侧口径）。 */
  readonly trust: AssistantTrustView;
}

/** P7（08 号详设 §3.4）：查询直答行 = outcome=status_replied（dismiss 后改 ignored 出清）。 */
export function isMateQueryReply(decision: AssistantDecisionView): boolean {
  return decision.outcome === "status_replied";
}

/** 待决策卡：explicit×observe 且尚未被人工处置（decidedBy 仍为 gate）。 */
export function isMatePendingDecision(decision: AssistantDecisionView): boolean {
  return decision.outcome === ASSISTANT_OUTCOMES.decisionCard && decision.decidedBy === "gate";
}

/** would-accept 观察行（inferred×observe；dismiss 后 outcome 变 ignored 自然出清）。 */
export function isMateObserveDecision(decision: AssistantDecisionView): boolean {
  return decision.outcome === ASSISTANT_OUTCOMES.wouldAccept;
}

/**
 * auto 告知卡（F4，spec §6 auto 执行语义「执行（出告知卡）」的 UI 兑现）：outcome=
 * auto_notice 且 decidedBy=gate（服务侧恒 gate——不计入放行率分母/分子，spec §6 落地
 * 注记）。只读呈现，无处置动作（工单本体已有工单行/汇报卡承载状态）。
 */
export function isMateAutoNoticeDecision(decision: AssistantDecisionView): boolean {
  return decision.outcome === ASSISTANT_OUTCOMES.autoNotice && decision.decidedBy === "gate";
}

/**
 * auto 告知卡的工单号回查：按 ticket.decisionId 精确匹配（与 findMateDecisionForTicket
 * 同款反向投影）。工单被快照容量裁剪（ticketsMax LRU）后返回 null——调用方诚实降级
 * 不渲染工单号，不猜测。
 */
export function findMateTicketIdForDecision(
  snap: AssistantSnapshot,
  decisionId: number,
): string | null {
  return snap.tickets.find((ticket) => ticket.decisionId === decisionId)?.id ?? null;
}

/** 进行中工单：dispatched（已派发未开局）与 running（turn started 后）都算。 */
export function isMateActiveTicket(status: AssistantTicketView["status"]): boolean {
  return (
    status === ASSISTANT_TICKET_STATUSES.dispatched ||
    status === ASSISTANT_TICKET_STATUSES.running ||
    // P4 第二棒（04 详设 §3）：工件核验滞留占活动位（worktree 未清理，终态才释放）——
    // 与服务侧 activeCountFor 同口径（queuedRelease.ts ACTIVE_STATUSES）。
    status === ASSISTANT_TICKET_STATUSES.awaitingOutput
  );
}

/** 排队工单（P2 软预算满时的 queued 态，specs §9）：不占活动数，状态条单列。 */
export function isMateQueuedTicket(status: AssistantTicketView["status"]): boolean {
  return status === ASSISTANT_TICKET_STATUSES.queued;
}

/**
 * 工单当前代序号（specs §8）：快照 generationCount=已归档代数，当前代=归档数+1；
 * 未派发（无字段）返回 1（首代）。纯函数供工单行/详情页/对话流摘要行共用，不各自 +1。
 * P10a-2 起入参泛化为结构类型（AssistantTicketView 与 MateThreadTicketRow 同形消费）。
 */
export function mateTicketGenerationNumber(ticket: { readonly generationCount?: number }): number {
  return (ticket.generationCount ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Surface A 状态条投影（02 详设 §1.4：mode/活动工单数；打扰配额 P4 交付不投影）
// ---------------------------------------------------------------------------

/** 状态条折叠（单行摘要）：mode + 软预算口径活动数/上限 + queued 数 + 待决策数。 */
export interface MateStatusLine {
  readonly mode: AssistantSnapshot["mode"];
  readonly active: number;
  readonly max: number;
  readonly queued: number;
  readonly pending: number;
}

/** 状态条投影：快照一次折叠出单行摘要；active 用软预算口径（dispatched+running）。 */
export function deriveMateStatusLine(snap: AssistantSnapshot): MateStatusLine {
  return {
    mode: snap.mode,
    active: snap.tickets.filter((ticket) => isMateActiveTicket(ticket.status)).length,
    max: snap.budget.maxActivePerWorkspace,
    queued: snap.tickets.filter((ticket) => isMateQueuedTicket(ticket.status)).length,
    pending: snap.decisions.filter(isMatePendingDecision).length,
  };
}

// ---------------------------------------------------------------------------
// P4 auto 信任门入口投影（04 详设 §2：Surface B 信任条达标后出现「切换 auto」）
// ---------------------------------------------------------------------------

/**
 * 「切换 auto」入口可用性（唯一入口纪律）：信任门开放（trust.gateOpen，服务侧实时
 * 判定的投影）且尚未处于 auto 模式。快照字段缺席（旧 Host）恒 false——诚实缺省，
 * 不在 UI 侧二次判定放行率（服务是唯一判定者）。
 */
export function isMateAutoSwitchAvailable(
  trust: AssistantTrustView,
  mode: AssistantSnapshot["mode"],
): boolean {
  return trust.gateOpen === true && mode !== ASSISTANT_MODES.auto;
}

/**
 * 信任门进度文案参数（mate.trust.gate.progress）：缺门槛字段（旧 Host 快照）→ null
 * 不渲染进度行，只显示既有计数（诚实降级）。
 */
export function resolveMateTrustGateProgress(trust: AssistantTrustView): {
  rate: number;
  samples: number;
  minRate: number;
  minSamples: number;
} | null {
  if (
    trust.releaseRate === undefined ||
    trust.sampleCount === undefined ||
    trust.gateThresholds === undefined
  ) {
    return null;
  }
  return {
    rate: Math.round(trust.releaseRate * 100),
    samples: trust.sampleCount,
    minRate: Math.round(trust.gateThresholds.minRate * 100),
    minSamples: trust.gateThresholds.minSamples,
  };
}

// ---------------------------------------------------------------------------
// P4 第二棒投影（04 详设 §3/§4 UI 侧）：配额行/核验滞留/未确认增量/按代成本
// ---------------------------------------------------------------------------

/** 状态条配额行投影：snapshot.quota 缺席（旧 Host）→ null 不渲染（诚实降级）。 */
export function resolveMateQuotaLine(snap: AssistantSnapshot): {
  used: number;
  quota: number;
  remaining: number;
} | null {
  if (!snap.quota) return null;
  return {
    used: snap.quota.total,
    quota: snap.quota.quota,
    remaining: snap.quota.remaining,
  };
}

/** 工单是否处于工件核验滞留（04 详设 §3；awaiting_output 非终态、占活动位）。 */
export function isMateAwaitingVerification(status: AssistantTicketView["status"]): boolean {
  return status === ASSISTANT_TICKET_STATUSES.awaitingOutput;
}

/**
 * 未确认增量行（spec §2.4 诚实规则，04 详设 §3）：换代工单（generationCount>0）且
 * 尚未人工确认（incrementsConfirmedMs 缺席/NULL）时常驻显示；确认按钮置列后出清。
 * 文案措辞与换代浓缩段同源（「第 N 代重启，第 N-1 代末尾改动未确认」）——本函数只
 * 出代数参数，不复制第二份措辞。
 */
export function mateUnconfirmedIncrement(ticket: AssistantTicketView): {
  gen: number;
  prev: number;
} | null {
  if ((ticket.generationCount ?? 0) <= 0) return null;
  if (ticket.incrementsConfirmedMs !== null && ticket.incrementsConfirmedMs !== undefined) {
    return null;
  }
  const gen = mateTicketGenerationNumber(ticket);
  return { gen, prev: gen - 1 };
}

/** watchdog 停滞徽标参数（工单行/汇报卡；staleSinceMs 缺席=未标记）。 */
export function mateStaleBadgeKind(
  ticket: AssistantTicketView,
): "running_stall" | "awaiting_unverified" | null {
  if (ticket.staleSinceMs === null || ticket.staleSinceMs === undefined) return null;
  return ticket.staleKind === "running_stall" || ticket.staleKind === "awaiting_unverified"
    ? ticket.staleKind
    : null;
}

/**
 * 按代成本行排序（成本页签）：generation 升序；旧 Host 字段缺席返回 null（诚实降级
 * 为合计说明）。Σ行=usage 合计（服务投影不变式），UI 不再二次校账。
 */
export function resolveMateUsageGenerations(
  ticket: AssistantTicketView,
): NonNullable<AssistantTicketView["usageByGeneration"]> | null {
  if (!ticket.usageByGeneration) return null;
  return [...ticket.usageByGeneration].sort((a, b) => a.generation - b.generation);
}

// ---------------------------------------------------------------------------
// P10a-2（10 号详设 §2.1/§2.4 v2.1）：对话管理台首屏投影——快照 → MateThreadRow 升序。
// 排序语义单一出处在服务 mateThread.ts（升序呈现序=atMs 升、kind 序 trigger→decision→
// ticket、同源 id 升）；此处是快照截断首屏的同构镜像，不建第二排序语义。
// ---------------------------------------------------------------------------

/** 对话流行 kind 序（升序呈现序；同刻并列组 trigger 在其 decision 前）。 */
const MATE_THREAD_ROW_RANK: Record<MateThreadRow["kind"], 0 | 1 | 2> = {
  trigger: 0,
  decision: 1,
  ticket: 2,
};

/** 行内稳定 id（trigger.id / decision.id / ticketId——去重与并列组次序共用）。 */
function mateThreadRowId(row: MateThreadRow): string {
  switch (row.kind) {
    case "trigger":
      return row.trigger.id;
    case "decision":
      return String(row.decision.id);
    case "ticket":
      return row.ticket.ticketId;
  }
}

/** 升序呈现序比较器（atMs 升 → kind 序升 → 同源 id 升；与服务倒序取正序回等价）。 */
function compareMateThreadRowsAsc(a: MateThreadRow, b: MateThreadRow): number {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  const rankDelta = MATE_THREAD_ROW_RANK[a.kind] - MATE_THREAD_ROW_RANK[b.kind];
  if (rankDelta !== 0) return rankDelta;
  const aId = mateThreadRowId(a);
  const bId = mateThreadRowId(b);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** 快照终态工单 → 对话流摘要行（brief 已是快照预览口径 ≤120，与服务行同界）。 */
function mateThreadTicketRowFromSnapshot(
  ticket: AssistantTicketView,
): MateThreadRow & { readonly kind: "ticket" } {
  return {
    kind: "ticket",
    atMs: ticket.updatedAtMs,
    ticket: {
      ticketId: ticket.id,
      brief: ticket.brief,
      status: ticket.status,
      targetWorkspaceIdentity: ticket.targetWorkspaceIdentity,
      outputSummary: ticket.outputSummary,
      failReason: ticket.failReason,
      ...(ticket.generationCount !== undefined ? { generationCount: ticket.generationCount } : {}),
    },
  };
}

/**
 * 对话流首屏（P10a-2，10 号详设 §2.4）：快照截断版投影为 MateThreadRow 升序——
 * trigger 全量（用户消息气泡源）/decision 全量（渲染侧按 outcome 分流：待决策卡内嵌/
 * 答复气泡/auto 告知卡；其余 outcome 不出消息——其后果由工单摘要行/观察区承接）/
 * ticket 仅终态（非终态走工单区既有面）。更早历史经 readMateThread 分页（缺省全流——
 * 与快照首屏同口径；workspaceKey 过滤参数留给按域消费方，本面不传）。
 */
export function deriveMateThreadRows(snap: AssistantSnapshot): readonly MateThreadRow[] {
  const rows: MateThreadRow[] = [
    ...snap.triggers.map(
      (trigger): MateThreadRow => ({ kind: "trigger", atMs: trigger.atMs, trigger }),
    ),
    ...snap.decisions.map(
      (decision): MateThreadRow => ({ kind: "decision", atMs: decision.decidedMs, decision }),
    ),
  ];
  for (const ticket of snap.tickets) {
    // 终态行才进对话流（done/failed；服务 readMateThread 同口径）。
    if (
      ticket.status === ASSISTANT_TICKET_STATUSES.done ||
      ticket.status === ASSISTANT_TICKET_STATUSES.failed
    ) {
      rows.push(mateThreadTicketRowFromSnapshot(ticket));
    }
  }
  return rows.sort(compareMateThreadRowsAsc);
}

/**
 * 合并首屏与已加载的更早页（升序；kind+id 去重）。分页游标 beforeMs 严格 <，旧页与
 * 快照窗在语义上不重叠——去重是同刻并列组边界的安全网，不是第二份语义。
 *
 * 键冲突取舍（P10 审查发现 3 修复，2026-11-07）：trigger/decision 行不可变
 * （trigger 落库后不改写、admission_decision.decided_ms 从不 UPDATE）——首见胜，
 * 旧页历史不可改写；**ticket 行是唯一可变行**（换代/终态推进 updated_ms，行时刻随
 * 之变化），且快照侧是新事实——冲突时取 atMs 更新鲜的一份，防已分页的旧终态行
 * 静默压制快照里的换代新行（对话流曾因此显示陈旧终态直到面板重挂）。
 */
export function mergeMateThreadRows(
  ...groups: readonly (readonly MateThreadRow[])[]
): readonly MateThreadRow[] {
  const byKey = new Map<string, MateThreadRow>();
  for (const group of groups) {
    for (const row of group) {
      const key = `${row.kind}:${mateThreadRowId(row)}`;
      const existing = byKey.get(key);
      if (existing === undefined || (row.kind === "ticket" && row.atMs > existing.atMs)) {
        byKey.set(key, row);
      }
    }
  }
  return [...byKey.values()].sort(compareMateThreadRowsAsc);
}

/**
 * 摘要行能否下钻详情：详情按快照工单集渲染——readMateThread 取回的旧工单可能已被
 * 快照容量（ticketsMax LRU）裁剪，此时行仍在流（台账事实）但详情不可达，诚实降级为
 * 不可点行，不猜不造空详情。
 */
export function isMateThreadTicketNavigable(snap: AssistantSnapshot, ticketId: string): boolean {
  return snap.tickets.some((ticket) => ticket.id === ticketId);
}

/**
 * 对话流绝对时刻（桌宠纪律：绝对时刻不做相对时长，纯 DOM 零定时器——渲染时一次成型
 * 不随时间刷新）：同本地日 HH:MM，跨日 MM-DD HH:MM（code-unit 稳定，不依赖 locale）。
 */
export function formatMateThreadClock(atMs: number, nowMs: number): string {
  const at = new Date(atMs);
  const now = new Date(nowMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const hhmm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay ? hhmm : `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${hhmm}`;
}

// ---------------------------------------------------------------------------
// Surface C 证据页关联投影（快照 v2：ticket.decisionId → decisions[].id）
// ---------------------------------------------------------------------------

/**
 * 工单 → 关联决策卡（证据页签）：按 ticket.decisionId 精确匹配 decisions[].id。
 * 手动建票（无 decisionId）或决策卡已被快照容量裁剪（decisionsMax=50 LRU）时返回
 * null——调用方按「无关联」诚实降级显示 brief 原文，不猜触发文本。
 */
export function findMateDecisionForTicket(
  snap: AssistantSnapshot,
  ticket: AssistantTicketView,
): AssistantDecisionView | null {
  if (ticket.decisionId === null || ticket.decisionId === undefined) return null;
  return snap.decisions.find((decision) => decision.id === ticket.decisionId) ?? null;
}

// ---------------------------------------------------------------------------
// Router 建议展示键映射（封闭映射；组件经 formatMessage 消费，不写字面量分支）
// ---------------------------------------------------------------------------

/** Router 建议四臂 → i18n 键（mate.router.suggested.*；未知 kind 返回 null 不渲染）。 */
export function mateRouterSuggestionKindMessageId(
  kind: AssistantRouterSuggestionView["kind"],
): string {
  switch (kind) {
    case "dispatch":
      return "mate.router.suggested.dispatch";
    case "attach":
      return "mate.router.suggested.attach";
    case "hold":
      return "mate.router.suggested.hold";
    case "reject":
      return "mate.router.suggested.reject";
    // P7 查询臂：建议段不渲染（答复由 answer 字段承载，见 MateQueryReply）——
    // 返回词典键（mate.router.suggested.query_status）供详情/排查展示。
    case "query_status":
      return "mate.router.suggested.query_status";
    // P10b 管理臂（10 号详设 §3.1）：决策卡建议区「管理动作」标题（对象/动作/理由/证据）。
    case "manage":
      return "mate.router.suggested.manage";
  }
}

// ---------------------------------------------------------------------------
// P10b 管理动作面（10 号详设 §3.1）：manage 臂呈现的封闭映射（对象/动作/执行结果）。
// 枚举值=contracts ASSISTANT_MANAGE_* 单出处经服务投影透传；未知值返回 null 不渲染。
// ---------------------------------------------------------------------------

/** manage 目标类别 → i18n 键（mate.manage.target.*）。 */
export function mateManageTargetKindMessageId(targetKind: string): string | null {
  switch (targetKind) {
    case "session":
      return "mate.manage.target.session";
    case "offpeak_task":
      return "mate.manage.target.offpeak_task";
    default:
      return null;
  }
}

/** manage 动作 → i18n 键（mate.manage.action.*）。 */
export function mateManageActionMessageId(action: string): string | null {
  switch (action) {
    case "stop_turn":
      return "mate.manage.action.stop_turn";
    case "cancel":
      return "mate.manage.action.cancel";
    default:
      return null;
  }
}

/** manage 执行结果状态 → i18n 键（mate.manage.state.*；MateDecisionCard 结果行与
 * MateThread 管理结果消息共用，不各写第二份措辞）。 */
export function mateManageStateMessageId(
  state: NonNullable<AssistantDecisionView["manageExecution"]>["state"],
): string {
  switch (state) {
    case "executing":
      return "mate.manage.state.executing";
    case "executed":
      return "mate.manage.state.executed";
    case "skipped":
      return "mate.manage.state.skipped";
    case "failed":
      return "mate.manage.state.failed";
  }
}

/** manage 放行终态行（outcome=managed）：对话流管理结果消息的判定谓词。 */
export function isMateManageExecutedDecision(decision: AssistantDecisionView): boolean {
  return decision.outcome === ASSISTANT_OUTCOMES.managed;
}

/** 权限档 → i18n 键（mate.card.tier.*；决策卡徽标与放行动作共用，P2 按建议渲染）。 */
export function matePermissionTierMessageId(tier: AssistantPermissionTier): string {
  switch (tier) {
    case ASSISTANT_PERMISSION_TIERS.build:
      return "mate.card.tier.build";
    case ASSISTANT_PERMISSION_TIERS.guarded:
      return "mate.card.tier.guarded";
    case ASSISTANT_PERMISSION_TIERS.yolo:
      return "mate.card.tier.yolo";
  }
}

/**
 * 触发来源 → i18n 键（mate.source.*；P3 Source 注册表呈现，spec §11 落地注记）。
 * 封闭映射跟随 ASSISTANT_SOURCE_KINDS 枚举；未知值返回 null 不渲染（不发明来源）。
 */
export function mateSourceKindMessageId(sourceKind: string): string | null {
  switch (sourceKind) {
    case ASSISTANT_SOURCE_KINDS.local:
      return "mate.source.local";
    case ASSISTANT_SOURCE_KINDS.feishu:
      return "mate.source.feishu";
    case ASSISTANT_SOURCE_KINDS.phone:
      return "mate.source.phone";
    case ASSISTANT_SOURCE_KINDS.github:
      return "mate.source.github";
    // P9（09 号详设 §2.2.1）：自主节奏 suggest 卡来源徽标——封闭映射跟随
    // ASSISTANT_SOURCE_KINDS 枚举扩充，未知值仍返回 null 不渲染。
    case ASSISTANT_SOURCE_KINDS.autonomy:
      return "mate.source.autonomy";
    default:
      return null;
  }
}

/**
 * 主投影：snap（service 推送快照）+ filter（pills 选择）→ 分组/计数/信任。
 * filter 只作用于 groups 的工单集：decision/observe 两档下无工单入组（决策卡与
 * 观察行由组件经上方谓词直接消费 snap.decisions，单一口径不复制）。
 */
export function deriveMateViewModel(snap: AssistantSnapshot, filter: MateFilter): MateViewModel {
  const pendingDecisions = snap.decisions.filter(isMatePendingDecision);
  const observeDecisions = snap.decisions.filter(isMateObserveDecision);
  const visibleTickets = snap.tickets.filter((ticket) => {
    switch (filter) {
      case "decision":
      case "observe":
        return false;
      case "running":
        return isMateActiveTicket(ticket.status);
      case "all":
        return true;
    }
  });

  return {
    groups: groupMateTickets(visibleTickets),
    counts: {
      decision: pendingDecisions.length,
      running: snap.tickets.filter((ticket) => isMateActiveTicket(ticket.status)).length,
      observe: observeDecisions.length,
      all: pendingDecisions.length + snap.tickets.length + observeDecisions.length,
    },
    trust: snap.trust,
  };
}

/**
 * 软预算投影（01 §1.1：同 workspace 活动工单软预算）：返回最重 workspace 的活动工单数
 * （dispatched+running），与 budget.maxActivePerWorkspace 相除得满载判定。与分组同键口径
 * （targetWorkspaceIdentity，null/"" 归未指名），纯函数零副作用——容器不内联统计
 * （PR-1B 二审发现 8）。
 */
export function resolveMateBudgetActive(snap: AssistantSnapshot): number {
  const perWorkspace = new Map<string, number>();
  for (const ticket of snap.tickets) {
    if (!isMateActiveTicket(ticket.status)) continue;
    const key = ticket.targetWorkspaceIdentity ?? MATE_UNTARGETED_WORKSPACE_KEY;
    perWorkspace.set(key, (perWorkspace.get(key) ?? 0) + 1);
  }
  return perWorkspace.size === 0 ? 0 : Math.max(...perWorkspace.values());
}

/** 分组：键=目标 workspaceIdentity（null/"" 归未指名组）；组间按键升序、组内按更新时间倒序。 */
function groupMateTickets(tickets: readonly AssistantTicketView[]): readonly MateWorkspaceGroup[] {
  const buckets = new Map<string, AssistantTicketView[]>();
  for (const ticket of tickets) {
    const key = ticket.targetWorkspaceIdentity ?? MATE_UNTARGETED_WORKSPACE_KEY;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(ticket);
    } else {
      buckets.set(key, [ticket]);
    }
  }
  const groups: MateWorkspaceGroup[] = [];
  for (const [key, bucket] of buckets) {
    const ordered = [...bucket].sort(
      (a, b) => b.updatedAtMs - a.updatedAtMs || (a.id < b.id ? -1 : 1),
    );
    groups.push({
      key,
      tickets: ordered,
      usageTotal: ordered.reduce(
        (total, ticket) => ({
          inputTokens: total.inputTokens + ticket.usage.inputTokens,
          outputTokens: total.outputTokens + ticket.usage.outputTokens,
        }),
        { inputTokens: 0, outputTokens: 0 },
      ),
    });
  }
  // 稳定输出：未指名组恒排首，其余按键 code-unit 升序（纯函数不依赖 locale）。
  groups.sort((a, b) => {
    if (a.key === MATE_UNTARGETED_WORKSPACE_KEY)
      return b.key === MATE_UNTARGETED_WORKSPACE_KEY ? 0 : -1;
    if (b.key === MATE_UNTARGETED_WORKSPACE_KEY) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return groups;
}

// ---------------------------------------------------------------------------
// 错误码 → i18n 键（封闭映射；mateMessages.ts 键守护对齐，01 §5 mate.error.*）
// ---------------------------------------------------------------------------

export type MateErrorMessageId =
  | "mate.error.store.busy"
  | "mate.error.store.migration"
  | "mate.error.yolo"
  | "mate.error.auto"
  | "mate.error.validation"
  | "mate.error.dispatchRejected"
  | "mate.error.generic"
  // P4 第二棒（04 详设 §4）：每日配额草稿本地校验失败（0-上界整数界，上界=contracts
  // ASSISTANT_DISTURBANCE_DEFAULTS.dailyQuotaMax 单出处）。
  | "mate.config.quota.invalid"
  // P5 高级区本地校验失败（06 号详设 §5；界=ASSISTANT_CONFIG_LIMITS 单出处）。
  | "mate.config.advanced.budgetInvalid"
  | "mate.config.advanced.rateInvalid"
  | "mate.config.advanced.samplesInvalid"
  | "mate.config.advanced.intervalInvalid"
  // P9 节奏区心跳间隔本地校验失败（09 号详设 §2；界=ASSISTANT_CONFIG_LIMITS
  // .autonomyIntervalMinutes 单出处 30-1440）。
  | "mate.config.rhythm.intervalInvalid"
  // P10b 管理动作面（10 号详设 §3.1）：manage 放行预检失败（可见集失配/通道未装配）。
  | "mate.error.manageInvalid"
  | "mate.error.manageUnavailable";

/** 服务失败臂 → 文案键；未知码一律落 generic，不把原始错误文本直接展示给用户。 */
export function resolveMateErrorMessageId(
  error: AssistantServiceError | null | undefined,
): MateErrorMessageId {
  switch (error?.code) {
    case ASSISTANT_ERROR_CODES.storeBusy:
      return "mate.error.store.busy";
    case ASSISTANT_ERROR_CODES.storeMigration:
      return "mate.error.store.migration";
    case ASSISTANT_ERROR_CODES.yoloRequiresHumanApproval:
      return "mate.error.yolo";
    case ASSISTANT_ERROR_CODES.autoLocked:
      return "mate.error.auto";
    case ASSISTANT_ERROR_CODES.validationFailed:
      // validationFailed 承载两类高频场景（名单为空 / 缺派发目标），给专属文案
      // 而非落 generic（PR-1B 三审发现 3）。
      return "mate.error.validation";
    case ASSISTANT_ERROR_CODES.dispatchRejected:
      // F1 远程形态（2026-11-06 二轮审查）：workspace probe 诚实拒绝（postApproval
      // 放行预检，spec §8「拒绝猜测，问人」）是正常设计路径——卡未消费可改选目标或
      // 等待建议后重放。落 generic「操作失败」会让远程 tab 反复重试恒败且零指引，
      // 与本批 CONTRACT.md 声明的「诚实拒绝可改选」呈现语义脱节。
      return "mate.error.dispatchRejected";
    case ASSISTANT_ERROR_CODES.manageTargetInvalid:
      // P10b（10 号详设 §3.1）：可见集失配拒绝（attach 同款 fail-closed）——专属文案
      // 说明「目标不在台账」，不落 generic（与 dispatchRejected 同理：正常设计路径）。
      return "mate.error.manageInvalid";
    case ASSISTANT_ERROR_CODES.manageUnavailable:
      return "mate.error.manageUnavailable";
    default:
      return "mate.error.generic";
  }
}

/**
 * 触发结果反馈行键（F2：双测试触发按钮的即时反馈，此前 off/observe 触发静默无反馈）。
 * 封闭映射只覆盖三态：decision_card / would_accept / ignored（ignored 文案说明
 * 「off 模式下已记录不执行」）。auto_notice 不在此——其呈现面是决策卡区的只读告知卡
 * （isMateAutoNoticeDecision），不在配置区重复出两处文案；未知 outcome 返回 null
 * 不渲染（封闭集合外不发明文案）。
 */
export function mateTriggerOutcomeFeedbackMessageId(outcome: string): string | null {
  switch (outcome) {
    case ASSISTANT_OUTCOMES.decisionCard:
      return "mate.trigger.feedback.decisionCard";
    case ASSISTANT_OUTCOMES.wouldAccept:
      return "mate.trigger.feedback.wouldAccept";
    case ASSISTANT_OUTCOMES.ignored:
      return "mate.trigger.feedback.ignored";
    default:
      return null;
  }
}
