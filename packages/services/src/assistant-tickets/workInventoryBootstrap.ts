/**
 * 全域工作台账的装配侧运行时（P8，09 详设 §1.2/§1.3 v2 定案）。
 *
 * 三源组装（provider 闭包，同步、幂等）：
 * 1. mate 工单快照：`readAssistantWorkTicketRows` 直接读 mate.sqlite（只读 SQL，
 *    界 ticketsMax；incarnation_current JSON 里取 sessionId/hostPath）。
 * 2. sessions-index 内存投影：经 AssistantSessionsIndexPort（node.ts ensureAssistantSessionsIndexSub
 *    同一订阅面）对 bootstrap 集合逐 workspace **常驻** watchSessions——持有者=本
 *    管理器的 disposer（装配层），dispose 只释放自身 watcher；引擎 watcher 清零的
 *    拆除语义（遗留 16 修复）不会拆掉常驻订阅（watchers 非零即不拆），反之引擎
 *    仍在用的域也不会被台账退订拆掉。快照初值经 listSessions 拉（await ready——
 *    冷启动语义的载体），增量经 resident watcher delta 维护。
 * 3. off-peak：taskIndexRepo.listTaskMetas() 不传 workspacePath 查全部（repo 支持，
 *    taskIndexRepo.ts listTaskMetas 注释；node.ts 闭包注入）→ **装配层缓存**：
 *    provider 同步读缓存，缓存刷新由 refreshOffPeakCache（tasks-index 变化回调现实
 *    载体=state:projects/task-groups 广播，node.ts 接线）驱动，在途去重。
 *
 * **变更指纹跳过**（09 §4 对策后半「组装输出 hash 未变则复用引用」）：assembleWorkInventory
 * 是不读时钟的纯函数（workInventory.ts），输出内容完全由其输入域决定——provider 每次
 * 先对（工单行/订阅域会话投影/off-peak 缓存）算稳定指纹，未变则直接复用上次视图引用，
 * 跳过重组装的对象分配。工单事件高频 publish 时快照按内容序列化、UI memo 依赖引用
 * 稳定，复用引用消掉这条放大路径（本文件 inventoryInputFingerprint 注释即对账点）。
 *
 * **bootstrap 三步**（09 §1.3，破循环依赖）：
 *   步 1 初始集合 = deriveInventoryBootstrapTargets（工单 ∪ 项目集，不依赖 sessions-index）；
 *   步 2 逐 workspace 常驻订阅；
 *   步 3 动态发现 = 每次 provider/reconcile 重推导 desired 集合并对账（工单新目标/
 *   项目集新条目 → 补订阅；超 inventoryWorkspaceSetMax=16 → desired 之外最久未活动
 *   者退订）。sessions-index v4 帧本身不携带跨域 workspace 引用（SessionSummary 无
 *   workspace 字段），「delta 出现新 workspace 引用」在现 wire 上无载体——动态发现
 *   收敛为刷新驱动的重推导（任何 delta/ticket publish/广播都会触发对账），已登记
 *   09 §1.1「无全域订阅形态」的现实边界。
 *
 * **部分源缺席=inventory 整体缺席**（09 §1.2）：任一订阅快照未 ready（冷启动）或
 * 失败、tasks-index 缓存未落（冷启动）、mate 读点抛错 → provider 返回 null（快照
 * 不携带 inventory 字段——诚实缺席，不拼半张账）。
 *
 * 纯函数本体在 workInventory.ts（测试落点=host 侧测试，09 §1.8）。
 */
import {
  ASSISTANT_INVENTORY_DEFAULTS,
  ASSISTANT_SNAPSHOT_LIMITS,
  type MateWorkInventoryView,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantSessionSummaryLite, AssistantSessionsIndexPort } from "./assistantPorts.js";
import { isBudgetActiveStatus } from "./writeDomain.js";
import {
  assembleWorkInventory,
  deriveInventoryBootstrapTargets,
  inventoryTargetKey,
  reconcileInventoryTargets,
  type WorkInventoryOffpeakTaskRow,
  type WorkInventorySessionRow,
  type WorkInventoryTicketRow,
  type WorkInventoryWorkspaceTarget,
} from "./workInventory.js";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";

const logger = createServiceLogger("assistant-tickets");

// ---------------------------------------------------------------------------
// 源 1 读点：mate.sqlite 工单行（只读 SQL；调用方=provider/reconcile 闭包）
// ---------------------------------------------------------------------------

/** 台账工单行（mate.sqlite ticket 投影；字段=workInventory.WorkInventoryTicketRow）。 */
export interface AssistantWorkTicketRow extends WorkInventoryTicketRow {}

/**
 * 读台账工单行（只读；界 ASSISTANT_SNAPSHOT_LIMITS.ticketsMax——与快照工单页同界，
 * 建库以来最近的工单按 created_ms 倒序）。incarnation_current JSON 解析失败按
 * 无当代执行体处理（诚实降级，不炸读点）。
 */
export function readAssistantWorkTicketRows(raw: AssistantDatabaseRaw): AssistantWorkTicketRow[] {
  const rows = raw
    .prepare(
      `SELECT id, brief, status, target_workspace_identity, incarnation_current, updated_ms, stale_ms
       FROM ticket ORDER BY created_ms DESC LIMIT ?`,
    )
    .all(ASSISTANT_SNAPSHOT_LIMITS.ticketsMax) as Array<{
    id: string;
    brief: string;
    status: string;
    target_workspace_identity: string | null;
    incarnation_current: string;
    updated_ms: number;
    stale_ms: number | null;
  }>;
  return rows.map((row) => {
    let sessionId: string | null = null;
    let hostPath: string | null = null;
    try {
      const incarnation = JSON.parse(row.incarnation_current) as {
        sessionId?: unknown;
        hostPath?: unknown;
      };
      if (typeof incarnation.sessionId === "string") sessionId = incarnation.sessionId;
      if (typeof incarnation.hostPath === "string" && incarnation.hostPath.length > 0) {
        hostPath = incarnation.hostPath;
      }
    } catch {
      // 坏 JSON=无当代执行体（未派发/历史行），诚实降级。
    }
    return {
      ticketId: row.id,
      title: row.brief,
      status: row.status,
      targetWorkspaceIdentity: row.target_workspace_identity,
      sessionId,
      hostPath,
      updatedAtMs: row.updated_ms,
      staleSinceMs: row.stale_ms,
    };
  });
}

// ---------------------------------------------------------------------------
// tasks-index meta → 台账 off-peak 行的投影（node.ts 闭包注入 listTaskMetas）
// ---------------------------------------------------------------------------

/** tasks-index 行的台账投影输入（DroraTaskMeta 最小集；结构化类型防字段漂移）。 */
export interface WorkInventoryTaskMetaInput {
  readonly taskId: string;
  readonly title: string;
  readonly status?: string;
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly updatedAtMs: number;
  /** off-peak 身份标记（DroraTaskMeta.offPeakTaskId；有值才收台账行）。 */
  readonly offPeakTaskId?: string;
}

/**
 * meta → 台账 off-peak 行（offPeakTaskId 有值的行才收——闲时任务身份标记，兄弟标记
 * cronAutomationId 不收；项目集推导仍用全部 meta，见 deriveInventoryBootstrapTargets）。
 */
export function projectWorkInventoryOffpeakRows(
  metas: readonly WorkInventoryTaskMetaInput[],
): WorkInventoryOffpeakTaskRow[] {
  return metas
    .filter((meta) => typeof meta.offPeakTaskId === "string" && meta.offPeakTaskId.length > 0)
    .map((meta) => ({
      taskId: meta.taskId,
      title: meta.title,
      ...(meta.status !== undefined ? { status: meta.status } : {}),
      workspacePath: meta.workspacePath,
      ...(meta.workspaceIdentity !== undefined
        ? { workspaceIdentity: meta.workspaceIdentity }
        : {}),
      updatedAtMs: meta.updatedAtMs,
    }));
}

// ---------------------------------------------------------------------------
// 管理器（常驻订阅 + provider；装配层 node.ts 持有与 dispose）
// ---------------------------------------------------------------------------

export interface WorkInventoryBootstrapDeps {
  /** sessions-index 端口（node.ts setAssistantSessionsIndexPort 同一实例）。 */
  readonly sessionsIndex: AssistantSessionsIndexPort;
  /** 源 1 读点（mate.sqlite 工单行；同步 SQL）。抛错=源缺席 → provider null。 */
  readonly listTicketRows: () => readonly AssistantWorkTicketRow[];
  /** 源 3 读点（tasks-index 全量 meta；异步——provider 只读其缓存）。 */
  readonly listOffPeakTaskMetas: () => Promise<readonly WorkInventoryTaskMetaInput[]>;
  /** 刷新环路回调（node.ts → host face refreshInventory → 服务节流重 publish）。 */
  readonly onRefreshNeeded: () => void;
}

// ---------------------------------------------------------------------------
// 变更指纹（09 §4 对策后半：组装输出 hash 未变则复用引用）
// ---------------------------------------------------------------------------

/**
 * 台账组装输入指纹（稳定串）。assembleWorkInventory 输入域全覆盖：
 * - 工单行全集（含 status/sessionId——managed 基准 activeTicketSessionIds 由其确定性
 *   推导，不另行参与；isBudgetActiveStatus 纯分类）；
 * - 各订阅域会话投影（sessions-index Lite 中被视图消费的字段：sessionId/title/phase/
 *   sessionEnded/updatedAtMs/teamActivity.status）；
 * - off-peak 缓存行全集。
 * 会话按（订阅键、sessionId）排序——delta upsert 改变 Map 插序不产生伪差异；工单按
 * SQL 序参与（保守：同集合不同序只损失一次复用机会，不漏更）。hostPath 不参与：它
 * 只影响订阅定位，不进视图行。
 */
function inventoryInputFingerprint(
  tickets: readonly AssistantWorkTicketRow[],
  subscriptions: ReadonlyMap<string, WorkspaceSubscription>,
  offpeakTasks: readonly WorkInventoryOffpeakTaskRow[],
): string {
  const sessionRows: string[] = [];
  for (const key of [...subscriptions.keys()].sort()) {
    const subscription = subscriptions.get(key);
    if (!subscription) continue;
    const sessions = [...subscription.sessions.values()].sort((a, b) =>
      a.sessionId.localeCompare(b.sessionId),
    );
    for (const session of sessions) {
      sessionRows.push(
        JSON.stringify([
          subscription.identity,
          session.sessionId,
          session.title,
          session.phase,
          session.sessionEnded,
          session.updatedAtMs,
          session.teamActivity?.status ?? null,
        ]),
      );
    }
  }
  return JSON.stringify([tickets, sessionRows, offpeakTasks]);
}

interface WorkspaceSubscription {
  readonly identity: string;
  readonly hostPath: string | undefined;
  /** watcher 拆除器（watchSessions 返回后回填；dispose 前 in-flight 阶段为 no-op）。 */
  dispose: () => void;
  /** listSessions 首拉已结算（true=快照在案；failed=true 时无快照）。 */
  ready: boolean;
  /** 订阅失败/通道不可用——该 workspace 的会话源缺席 → provider 整体缺席。 */
  failed: boolean;
  /** 当前会话投影（首拉快照整体替换；delta 逐条增删）。 */
  sessions: Map<string, AssistantSessionSummaryLite>;
  lastActivityAt: number;
}

export interface WorkInventoryBootstrap {
  /** 台账 provider（同步；setAssistantInventoryProvider 注入，服务 publish 读）。 */
  provider(): MateWorkInventoryView | null;
  /** tasks-index 缓存刷新（在途去重；settle 后对账+触发刷新环路）。 */
  refreshOffPeakCache(): void;
  /** 释放全部常驻订阅（持有者=装配层 disposer；不走引擎 watcher 清零语义）。 */
  dispose(): void;
}

export function createWorkInventoryBootstrap(
  deps: WorkInventoryBootstrapDeps,
): WorkInventoryBootstrap {
  const subscriptions = new Map<string, WorkspaceSubscription>();
  let offpeakCache: readonly WorkInventoryOffpeakTaskRow[] | null = null;
  let offpeakInFlight: Promise<void> | null = null;
  let disposed = false;
  // 变更指纹跳过（09 §4 对策后半）：上次非 null 视图引用与其输入指纹；null 检查见
  // provider 内守卫——冷启动/缺席路径不登记指纹，就绪后首轮必重组装。
  let lastInventoryView: MateWorkInventoryView | null = null;
  let lastInventoryFingerprint: string | null = null;

  function subscribeTarget(target: WorkInventoryWorkspaceTarget): void {
    const key = inventoryTargetKey(target);
    if (subscriptions.has(key)) return;
    const subscription: WorkspaceSubscription = {
      identity: target.identity,
      hostPath: target.hostPath,
      dispose: () => undefined,
      ready: false,
      failed: false,
      sessions: new Map<string, AssistantSessionSummaryLite>(),
      lastActivityAt: Date.now(),
    };
    subscriptions.set(key, subscription);
    // 常驻订阅（步 2）：delta 维护投影 + 触发刷新环路（节流在服务侧）。dispose 只
    // 释放本 watcher——watchers 非零期间引擎清零语义不会拆底层订阅（09 §1.2 步 1）。
    const handle = deps.sessionsIndex.watchSessions(target.identity, target.hostPath, (delta) => {
      if (disposed || subscription.failed) return;
      subscription.lastActivityAt = Date.now();
      if (delta.kind === "upserted") {
        subscription.sessions.set(delta.summary.sessionId, delta.summary);
      } else {
        subscription.sessions.delete(delta.sessionId);
      }
      deps.onRefreshNeeded();
    });
    subscription.dispose = handle.dispose;
    // 冷启动接缝（09 §1.3 步 4）：首拉快照（await state.ready），settle 后刷新环路
    // 让 provider 重新判定就绪——快照帧不产生 delta，必须显式补一拍。
    void (async () => {
      try {
        const result = await deps.sessionsIndex.listSessions(target.identity, target.hostPath);
        if (disposed) return;
        if (result.ok) {
          subscription.sessions = new Map(
            result.sessions.map((session) => [session.sessionId, session]),
          );
          subscription.ready = true;
        } else {
          subscription.failed = true;
          logger.warn("台账 sessions-index 快照不可用（该 workspace 源缺席）", {
            identity: target.identity,
            reason: result.reason,
          });
        }
      } catch (error) {
        if (disposed) return;
        subscription.failed = true;
        logger.warn("台账 sessions-index 首拉失败（该 workspace 源缺席）", error);
      } finally {
        if (!disposed) deps.onRefreshNeeded();
      }
    })();
  }

  /** 步 1+3：重推导 desired 集合并对账（补订阅/退订）。同步、无 IO 阻塞。 */
  function reconcileTargets(): readonly AssistantWorkTicketRow[] | null {
    if (disposed) return null;
    let ticketRows: readonly AssistantWorkTicketRow[];
    try {
      ticketRows = deps.listTicketRows();
    } catch {
      return null; // mate 读点不可用（dispose 竞态/库关闭）→ 本轮跳过对账
    }
    // 修复（2026-11-07 dev 实机）：failed 订阅（订阅失败/首拉不可用）此前常驻缓存
    // 永不重试——desired 对账只补缺失键，failed 键一直在场 → 三源永久缺席。失败订阅
    // 先拆除，让本轮 plan.subscribe 重建（配合 node.ts 订阅失败拆缓存，agent 就绪后
    // 随下一次 refresh 触发自愈）。
    for (const [key, subscription] of subscriptions) {
      if (subscription.failed) {
        subscriptions.delete(key);
        subscription.dispose();
      }
    }
    const desired = deriveInventoryBootstrapTargets({
      tickets: ticketRows,
      offpeakTasks: offpeakCache ?? [],
      nowMs: Date.now(),
      windowMs: ASSISTANT_INVENTORY_DEFAULTS.bootstrapTicketWindowMs,
      setMax: ASSISTANT_SNAPSHOT_LIMITS.inventoryWorkspaceSetMax,
    });
    const current = new Map<string, number>();
    for (const [key, subscription] of subscriptions) {
      current.set(key, subscription.lastActivityAt);
    }
    const plan = reconcileInventoryTargets({
      desired,
      current,
      setMax: ASSISTANT_SNAPSHOT_LIMITS.inventoryWorkspaceSetMax,
    });
    for (const target of plan.subscribe) subscribeTarget(target);
    for (const key of plan.evictKeys) {
      const subscription = subscriptions.get(key);
      if (!subscription) continue;
      subscriptions.delete(key);
      // 退订（09 §1.3 超界最久未活动者）：释放常驻持有；引擎仍在用的域由引擎
      // watcher 语义继续持有底层订阅（dispose 只摘除自身 watcher）。
      subscription.dispose();
    }
    return ticketRows;
  }

  function provider(): MateWorkInventoryView | null {
    if (disposed) return null;
    const ticketRows = reconcileTargets();
    if (ticketRows === null) return null; // 源 1 缺席
    if (offpeakCache === null) return null; // 源 3 冷启动（首读未落）
    for (const subscription of subscriptions.values()) {
      // 冷启动（!ready）/源缺席（failed）→ 整体缺席（09 §1.2 全有或全无；不拼半张账）。
      if (!subscription.ready || subscription.failed) return null;
    }
    // 变更指纹跳过（09 §4 对策后半）：输入域未变 ⇒ 纯组装输出内容恒同，直接复用上次
    // 视图引用——高频 publish 不再重组装产新对象（快照按内容序列化、UI memo 吃引用稳定）。
    const fingerprint = inventoryInputFingerprint(ticketRows, subscriptions, offpeakCache);
    if (lastInventoryView !== null && fingerprint === lastInventoryFingerprint) {
      return lastInventoryView;
    }
    const activeTicketSessionIds = new Set<string>();
    for (const ticket of ticketRows) {
      if (ticket.sessionId && isBudgetActiveStatus(ticket.status)) {
        activeTicketSessionIds.add(ticket.sessionId);
      }
    }
    const sessionGroups = [...subscriptions.values()].map((subscription) => ({
      identity: subscription.identity,
      sessions: [...subscription.sessions.values()].map(
        (session): WorkInventorySessionRow => ({
          sessionId: session.sessionId,
          title: session.title,
          phase: session.phase,
          sessionEnded: session.sessionEnded,
          updatedAtMs: session.updatedAtMs,
          ...(session.teamActivity ? { teamStatus: session.teamActivity.status } : {}),
        }),
      ),
    }));
    const view = assembleWorkInventory({
      tickets: ticketRows,
      sessionGroups,
      offpeakTasks: offpeakCache,
      activeTicketSessionIds,
    });
    lastInventoryFingerprint = fingerprint;
    lastInventoryView = view;
    return view;
  }

  function refreshOffPeakCache(): void {
    if (disposed || offpeakInFlight !== null) return;
    offpeakInFlight = (async () => {
      try {
        const metas = await deps.listOffPeakTaskMetas();
        if (disposed) return;
        offpeakCache = projectWorkInventoryOffpeakRows(metas);
      } catch (error) {
        // 失败保留旧缓存（可能仍为 null=冷启动缺席）；不清空已有事实，下一轮回调重试。
        logger.warn("台账 tasks-index 读点失败（沿用旧缓存/缺席）", error);
      } finally {
        offpeakInFlight = null;
        if (!disposed) {
          reconcileTargets();
          deps.onRefreshNeeded();
        }
      }
    })();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const subscription of subscriptions.values()) subscription.dispose();
    subscriptions.clear();
  }

  // 构造即首读 off-peak 缓存（冷启动闭环：settle → 对账 → 刷新环路 → publish 携带台账）。
  refreshOffPeakCache();

  return { provider, refreshOffPeakCache, dispose };
}
