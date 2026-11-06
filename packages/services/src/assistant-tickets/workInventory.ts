/**
 * 全域工作台账组装纯函数（P8，09 详设 §1.3/§1.4 v2 定案）。
 *
 * 职责（纯、幂等、无 IO——db/订阅/时钟由调用方注入为普通值）：
 * - deriveInventoryBootstrapTargets：bootstrap 初始集合推导（09 §1.3 步 1）——
 *   近 14d 工单的 target workspace（incarnation hostPath 精确定位）∪ tasks-index
 *   项目集，按 (identity, hostPath) 去重、按最近活动排序、截断到订阅集界
 *   （inventoryWorkspaceSetMax=16）。不依赖 sessions-index——破循环依赖。
 * - reconcileInventoryTargets：订阅集对账（09 §1.3 步 3 动态发现+退订界）——
 *   desired ⊕ current 超界时先退「desired 之外最久未活动」者，保持台账必需要看
 *   的 workspace 优先在订阅内；缺者补订阅、多者退订。
 * - assembleWorkInventory：三源合并 → MateWorkInventoryView（09 §1.4）——工单/
 *   会话·teams/off-peak 三 kind 行按 workspace 身份键分组，managed 标记
 *   （sessionId ∈ 活动工单 incarnation.sessionId 集），视图有界截断
 *   （inventoryWorkspaceMax=6 / inventoryRowMax=20，最近活动优先贪心分配，
 *   预算耗尽的空组丢弃），同输入恒同输出（排序显式 tie-break，幂等）。
 *
 * workspace 身份键统一 AGENTS 规则：workspaceIdentity?.trim() || workspacePath
 * （resolveInventoryWorkspaceKey 单出处）。无目标 identity 的工单不产出台账行
 * （仍走工单面板呈现，台账按项目分组不收）。
 *
 * 测试落点=host 侧测试（09 §1.8：合并/managed/有界/自举集合推导矩阵），
 * 照 mateWatchdogCron.test 先例登记 scripts/drora-isolated-test-files.json。
 */
import {
  ASSISTANT_SNAPSHOT_LIMITS,
  MATE_WORK_INVENTORY_ROW_KINDS,
  type MateWorkInventoryRow,
  type MateWorkInventoryView,
  type MateWorkInventoryWorkspace,
} from "@drora/shared";

// ---------------------------------------------------------------------------
// 三源行输入形状（装配层闭包喂入；与 mate.sqlite 列/sessions-index Lite/tasks-index
// meta 的投影一一对应，字段只保留台账所需的最小集）
// ---------------------------------------------------------------------------

/** 大副工单行（mate.sqlite ticket 表投影；hostPath 取 incarnation_current JSON）。 */
export interface WorkInventoryTicketRow {
  readonly ticketId: string;
  /** raw brief（本文件负责截断到 inventoryTitleMax，调用方不必预截）。 */
  readonly title: string;
  readonly status: string;
  readonly targetWorkspaceIdentity: string | null;
  /** 当代执行体会话（incarnation.sessionId；未派发=null）。 */
  readonly sessionId: string | null;
  /** 会话落位目录（incarnation.hostPath；缺省=null→订阅时回落共享对话目录）。 */
  readonly hostPath: string | null;
  readonly updatedAtMs: number;
  /** watchdog 停滞标记（null=未标记；总览卡「停滞点」信号）。 */
  readonly staleSinceMs: number | null;
}

/** 会话行（sessions-index 内存投影的 AssistantSessionSummaryLite 投影）。 */
export interface WorkInventorySessionRow {
  readonly sessionId: string;
  readonly title: string;
  readonly phase: string;
  readonly sessionEnded: boolean;
  readonly updatedAtMs: number;
  /** teamActivity.status 投影（无 team=undefined；「运行中的 teams」信号）。 */
  readonly teamStatus?: string;
}

/** off-peak 任务行（tasks-index meta 中 offPeakTaskId 有值的行投影）。 */
export interface WorkInventoryOffpeakTaskRow {
  readonly taskId: string;
  readonly title: string;
  readonly status?: string;
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly updatedAtMs: number;
}

/** 订阅目标（sessions-index 按 (identity, hostPath) 定位一个 workspace 域）。 */
export interface WorkInventoryWorkspaceTarget {
  readonly identity: string;
  readonly hostPath?: string;
}

// ---------------------------------------------------------------------------
// workspace 身份键（AGENTS 规则单出处；bootstrap 推导与视图分组共用）
// ---------------------------------------------------------------------------

export function resolveInventoryWorkspaceKey(
  identity: string | null | undefined,
  workspacePath?: string | null,
): string | null {
  const trimmed = identity?.trim();
  if (trimmed) return trimmed;
  const path = workspacePath?.trim();
  return path ? path : null;
}

/** 订阅键（与视图分组键不同域：视图按 identity 分组，订阅按 (identity, hostPath)）。 */
export function inventoryTargetKey(target: WorkInventoryWorkspaceTarget): string {
  return `${target.identity}\u0000${target.hostPath ?? ""}`;
}

// ---------------------------------------------------------------------------
// bootstrap 初始集合推导（09 §1.3 步 1：工单 ∪ tasks-index，不依赖 sessions-index）
// ---------------------------------------------------------------------------

export function deriveInventoryBootstrapTargets(input: {
  tickets: readonly WorkInventoryTicketRow[];
  offpeakTasks: readonly WorkInventoryOffpeakTaskRow[];
  nowMs: number;
  /** 工单时间窗（ms；contracts ASSISTANT_INVENTORY_DEFAULTS.bootstrapTicketWindowMs）。 */
  windowMs: number;
  /** 订阅集界（contracts inventoryWorkspaceSetMax）。 */
  setMax: number;
}): WorkInventoryWorkspaceTarget[] {
  interface Candidate {
    readonly target: WorkInventoryWorkspaceTarget;
    recency: number;
  }
  const byKey = new Map<string, Candidate>();
  const consider = (
    identity: string | null,
    hostPath: string | undefined,
    recency: number,
  ): void => {
    if (!identity) return;
    const target: WorkInventoryWorkspaceTarget = {
      identity,
      ...(hostPath !== undefined ? { hostPath } : {}),
    };
    const key = inventoryTargetKey(target);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { target, recency });
      return;
    }
    existing.recency = Math.max(existing.recency, recency);
  };
  // 源 1：近 windowMs 工单的 target workspace（updated_ms 为活动基准；hostPath 用
  // incarnation 落位精确匹配订阅域——与派发引擎 watchSessions 同参）。
  const cutoff = input.nowMs - input.windowMs;
  for (const ticket of input.tickets) {
    if (ticket.updatedAtMs < cutoff) continue;
    consider(
      resolveInventoryWorkspaceKey(ticket.targetWorkspaceIdentity),
      ticket.hostPath ?? undefined,
      ticket.updatedAtMs,
    );
  }
  // 源 2：tasks-index 项目集（可枚举全集，无时间窗；identity 缺席按路径回落）。
  for (const task of input.offpeakTasks) {
    consider(
      resolveInventoryWorkspaceKey(task.workspaceIdentity, task.workspacePath),
      task.workspacePath,
      task.updatedAtMs,
    );
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        b.recency - a.recency ||
        inventoryTargetKey(a.target).localeCompare(inventoryTargetKey(b.target)),
    )
    .slice(0, Math.max(0, input.setMax))
    .map((candidate) => candidate.target);
}

// ---------------------------------------------------------------------------
// 订阅集对账（09 §1.3 步 3：动态发现补订阅 + 超界 LRU 退订）
// ---------------------------------------------------------------------------

export interface InventoryTargetReconcilePlan {
  /** 当前未订阅的 desired 目标（调用方逐个补常驻订阅）。 */
  readonly subscribe: readonly WorkInventoryWorkspaceTarget[];
  /** 应退订的当前订阅键（超界最久未活动者；只在 desired 之外的余量中挑选）。 */
  readonly evictKeys: readonly string[];
}

export function reconcileInventoryTargets(input: {
  desired: readonly WorkInventoryWorkspaceTarget[];
  /** 当前订阅集：key → 最近活动时刻（ms）。 */
  current: ReadonlyMap<string, number>;
  setMax: number;
}): InventoryTargetReconcilePlan {
  const desiredKeys = new Set(input.desired.map(inventoryTargetKey));
  const subscribe = input.desired.filter(
    (target) => !input.current.has(inventoryTargetKey(target)),
  );
  // 补齐后的总量；超出 setMax 时只从「desired 之外」的余量订阅里按 LRU 退——
  // desired 本身已被推导截断到 setMax，台账必需要看的域不被动态发现的陈旧余量挤掉。
  const sizeAfterSubscribe = input.current.size + subscribe.length;
  const evictKeys: string[] = [];
  if (sizeAfterSubscribe > input.setMax) {
    const extras = [...input.current.entries()]
      .filter(([key]) => !desiredKeys.has(key))
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    const evictCount = sizeAfterSubscribe - input.setMax;
    for (const [key] of extras.slice(0, Math.max(0, evictCount))) evictKeys.push(key);
  }
  return { subscribe, evictKeys };
}

// ---------------------------------------------------------------------------
// 三源合并组装（09 §1.4：有界、幂等、managed 标记）
// ---------------------------------------------------------------------------

export function assembleWorkInventory(input: {
  tickets: readonly WorkInventoryTicketRow[];
  /** 每个 sessions-index 订阅域的当前会话投影（同一 identity 多 hostPath 合并进同组）。 */
  sessionGroups: ReadonlyArray<{
    readonly identity: string;
    readonly sessions: readonly WorkInventorySessionRow[];
  }>;
  offpeakTasks: readonly WorkInventoryOffpeakTaskRow[];
  /** 活动工单当代执行体会话集（managed 标记基准；调用方按软预算口径筛 active）。 */
  activeTicketSessionIds: ReadonlySet<string>;
}): MateWorkInventoryView {
  const limits = ASSISTANT_SNAPSHOT_LIMITS;
  const truncate = (value: string, max: number): string => {
    const chars = [...value];
    return chars.length <= max ? value : chars.slice(0, max).join("");
  };
  const truncateTitle = (value: string): string => truncate(value, limits.inventoryTitleMax);

  interface Group {
    readonly key: string;
    readonly rows: MateWorkInventoryRow[];
  }
  const groups = new Map<string, Group>();
  const push = (identity: string | null, row: MateWorkInventoryRow): void => {
    if (!identity) return;
    let group = groups.get(identity);
    if (!group) {
      group = { key: identity, rows: [] };
      groups.set(identity, group);
    }
    group.rows.push(row);
  };

  // 源 1：工单行（无目标 identity 不产出——仍走工单面板，台账按项目分组不收）。
  for (const ticket of input.tickets) {
    push(resolveInventoryWorkspaceKey(ticket.targetWorkspaceIdentity), {
      kind: MATE_WORK_INVENTORY_ROW_KINDS.ticket,
      ticketId: ticket.ticketId,
      title: truncateTitle(ticket.title),
      status: truncate(ticket.status, 40),
      updatedAtMs: ticket.updatedAtMs,
      ...(ticket.staleSinceMs !== null ? { staleSinceMs: ticket.staleSinceMs } : {}),
    });
  }
  // 源 2：会话/teams 行（managed=当代工单执行体命中；工单自建的会话因此带标）。
  for (const group of input.sessionGroups) {
    for (const session of group.sessions) {
      const managed = input.activeTicketSessionIds.has(session.sessionId);
      push(group.identity, {
        kind: MATE_WORK_INVENTORY_ROW_KINDS.session,
        sessionId: session.sessionId,
        title: truncateTitle(session.title),
        phase: truncate(session.phase, 64),
        sessionEnded: session.sessionEnded,
        updatedAtMs: session.updatedAtMs,
        ...(session.teamStatus ? { teamStatus: truncate(session.teamStatus, 40) } : {}),
        ...(managed ? { managed: true } : {}),
      });
    }
  }
  // 源 3：off-peak 任务行（tasks-index 中 offPeakTaskId 有值的行）。
  for (const task of input.offpeakTasks) {
    push(resolveInventoryWorkspaceKey(task.workspaceIdentity, task.workspacePath), {
      kind: MATE_WORK_INVENTORY_ROW_KINDS.offpeak,
      taskId: task.taskId,
      title: truncateTitle(task.title),
      ...(task.status !== undefined ? { status: truncate(task.status, 40) } : {}),
      updatedAtMs: task.updatedAtMs,
    });
  }

  // 组序：组内最近活动 desc（组键 tie-break 保幂等）；行序：updatedAtMs desc（id tie-break）。
  const rowSort = (a: MateWorkInventoryRow, b: MateWorkInventoryRow): number =>
    b.updatedAtMs - a.updatedAtMs || rowTieBreakId(a).localeCompare(rowTieBreakId(b));
  const ordered = [...groups.values()]
    .map((group) => ({ key: group.key, rows: [...group.rows].sort(rowSort) }))
    .sort((a, b) => groupRecency(b) - groupRecency(a) || a.key.localeCompare(b.key));

  // 视图有界截断：先裁 workspace 界（最近活动组优先），再做行全局预算贪心（预算耗尽
  // 的组丢弃——台账视图里不出现零行组，诚实「无工作」只由真实空集表达）。
  const boundedGroups = ordered.slice(0, limits.inventoryWorkspaceMax);
  const workspaces: MateWorkInventoryWorkspace[] = [];
  let rowBudget = limits.inventoryRowMax;
  for (const group of boundedGroups) {
    if (rowBudget <= 0) break;
    const rows = group.rows.slice(0, rowBudget);
    if (rows.length === 0) break;
    workspaces.push({ key: group.key, rows });
    rowBudget -= rows.length;
  }
  return { workspaces };
}

function rowTieBreakId(row: MateWorkInventoryRow): string {
  if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.ticket) return row.ticketId;
  if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.session) return row.sessionId;
  return row.taskId;
}

function groupRecency(group: MateWorkInventoryWorkspace): number {
  return group.rows[0]?.updatedAtMs ?? 0; // rows 已按 updatedAtMs desc 排序，首行即组内最新
}
