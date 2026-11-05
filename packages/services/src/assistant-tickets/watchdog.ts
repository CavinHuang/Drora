/**
 * Watchdog——停滞判据与标记（04 详设 §1；spec §10 P4 落地注记）。
 *
 * 驱动=desktop host 进程内部定时器（host/cronMateWatchdog.ts，不进任何会话），
 * 每 tick 调服务内部入口 runWatchdogRound → 本文件裁决「是否到轮」（kv
 * `watchdog_interval_ms` 可调、`watchdog_last_round_ms` 记账——kv 改值即时生效）。
 *
 * 判据表（只标记不改写；通知动作仅三类：标记/通知（配额内）/无动作；
 * **永不自动终止、永不自动换代、永不自动重试**——spec §10 不变式，本文件不持有
 * 任何状态机写路径）：
 *   running 停滞：status=running 且 updated_ms 距今 >30min → stale 标记+通知
 *   awaiting 滞留：§3 工件核验事实源喂入 awaitingCandidates（>60min → 建议人工核验；
 *     本批缺席=判据不激活，核验面随汇报卡完整版交付）
 *   排队饥饿：status=queued 且 updated_ms 距今 >24h → 仅告知卡通知（不置 stale）
 *
 * 通知经 §4 配额中心统一计数接口判定（kind=report）：配额内 → kv `watchdog_notices`
 * 有界通知区（快照 ≤5 投影）；超额 → 自动聚合次日摘要（quotaCenter 落账）。
 * stale 列（schema v5）唯一写者=本文件；判据解除（状态流转/新事件推进 updated_ms）
 * 同轮清除，ticket 被快照容量裁剪/删除时通知随轮清空。
 *
 * 纯模块：无 IO（db/配额判定/时钟由调用方注入）。
 */
import {
  ASSISTANT_DISTURBANCE_KINDS,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_TICKET_STATUSES,
  ASSISTANT_WATCHDOG_DEFAULTS,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import {
  admitAssistantDisturbanceTx,
  readAssistantQuotaDay,
  assistantQuotaDayTotal,
} from "./quotaCenter.js";
import {
  ASSISTANT_TRUST_GATE_KV_KEYS,
  computeTrustStats,
  readTrustCounts,
} from "./trustGate.js";

const logger = createServiceLogger("assistant-tickets");

/** kv 配置键（mate.sqlite kv 表；键名即 kv.key 字面量，单出处；模块内自产自读）。 */
export const ASSISTANT_WATCHDOG_KV_KEYS = {
  /** 上轮执行时刻（轮询节流记账）。 */
  lastRoundMs: "watchdog_last_round_ms",
  /** 轮询间隔 ms（缺省 ASSISTANT_WATCHDOG_DEFAULTS.intervalMs；坏值回落缺省）。 */
  intervalMs: "watchdog_interval_ms",
  /** 配额内通知区（JSON 数组，有界；快照投影源）。 */
  notices: "watchdog_notices",
} as const;

/** watchdog 通知条目（kv 存储/快照投影同形）。 */
export interface AssistantWatchdogNotice {
  readonly ticketId: string;
  readonly kind: string;
  readonly summary: string;
  readonly atMs: number;
}

/** 判据输入的工单行（快照列集；只读）。 */
export interface AssistantWatchdogTicketRow {
  readonly id: string;
  readonly status: string;
  readonly updatedMs: number;
  readonly staleMs: number | null;
  readonly staleKind: string | null;
}

/** awaiting 滞留判据的核验事实源接缝（§3 工件核验交付后由服务喂入；本批恒空）。 */
export interface AssistantAwaitingCandidate {
  readonly ticketId: string;
  readonly sinceMs: number;
}

/** 判据产出（apply 前的纯中间量）。 */
export interface AssistantWatchdogFinding {
  readonly ticketId: string;
  readonly kind: "running_stall" | "awaiting_unverified" | "queued_starve";
  /** 判据摘要（通知文本；bounded 由调用方截断）。 */
  readonly summary: string;
  /** 置 stale 标记（仅 running_stall/awaiting_unverified；排队饥饿只通知）。 */
  readonly markStale: boolean;
}

/** 轮执行结果（host face 返回值；观测/测试用）。 */
export interface AssistantWatchdogRoundResult {
  /** false=未到轮（interval 节流），其余字段无意义。 */
  ran: boolean;
  readonly atMs: number;
  readonly markedStaleTicketIds: readonly string[];
  readonly clearedStaleCount: number;
  readonly notifiedCount: number;
  readonly aggregatedCount: number;
}

/** 轮询间隔读取（坏/缺值回落 contracts 缺省；≤0 视为坏值不采纳）。 */
export function readAssistantWatchdogIntervalMs(
  kvGet: (key: string) => string | undefined,
): number {
  const raw = kvGet(ASSISTANT_WATCHDOG_KV_KEYS.intervalMs);
  if (raw === undefined) return ASSISTANT_WATCHDOG_DEFAULTS.intervalMs;
  const parsed = Number(raw);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return ASSISTANT_WATCHDOG_DEFAULTS.intervalMs;
}

/**
 * 判据计算（纯函数；04 详设 §1 判据表）。阈值参数化（测试注入；生产取
 * ASSISTANT_WATCHDOG_DEFAULTS）。updated_ms 是唯一停滞基准：任何 turn/team 归账
 * 事件都会推进它（ticketLedger 单调纪律），因此「updated_ms 距今超阈」即「无新
 * 事件」的充分条件——不需要第二条 turn 计数器（避免重复状态）。
 */
export function computeAssistantWatchdogFindings(
  tickets: readonly AssistantWatchdogTicketRow[],
  input: {
    nowMs: number;
    runningStallMs?: number;
    awaitingStallMs?: number;
    queuedStarveMs?: number;
    awaitingCandidates?: readonly AssistantAwaitingCandidate[];
  },
): AssistantWatchdogFinding[] {
  const runningStallMs = input.runningStallMs ?? ASSISTANT_WATCHDOG_DEFAULTS.runningStallMs;
  const awaitingStallMs = input.awaitingStallMs ?? ASSISTANT_WATCHDOG_DEFAULTS.awaitingStallMs;
  const queuedStarveMs = input.queuedStarveMs ?? ASSISTANT_WATCHDOG_DEFAULTS.queuedStarveMs;
  const awaitingByTicket = new Map(
    (input.awaitingCandidates ?? []).map((candidate) => [candidate.ticketId, candidate.sinceMs]),
  );
  const findings: AssistantWatchdogFinding[] = [];
  for (const ticket of tickets) {
    const idleMs = input.nowMs - ticket.updatedMs;
    if (ticket.status === ASSISTANT_TICKET_STATUSES.running && idleMs > runningStallMs) {
      findings.push({
        ticketId: ticket.id,
        kind: "running_stall",
        summary: `工单运行停滞超过 ${Math.round(runningStallMs / 60000)} 分钟无新事件，请人工查看目标会话`,
        markStale: true,
      });
      continue;
    }
    const awaitingSinceMs = awaitingByTicket.get(ticket.id);
    if (
      awaitingSinceMs !== undefined &&
      !isTerminalStatus(ticket.status) &&
      input.nowMs - awaitingSinceMs > awaitingStallMs
    ) {
      findings.push({
        ticketId: ticket.id,
        kind: "awaiting_unverified",
        summary: "工单产出未通过只读核验滞留超过阈值，建议人工核验工件",
        markStale: true,
      });
      continue;
    }
    if (ticket.status === ASSISTANT_TICKET_STATUSES.queued && idleMs > queuedStarveMs) {
      findings.push({
        ticketId: ticket.id,
        kind: "queued_starve",
        summary: "工单排队超过 24 小时未获得预算空位，建议调整每 workspace 活动工单预算",
        markStale: false,
      });
    }
  }
  return findings;
}

function isTerminalStatus(status: string): boolean {
  return (
    status === ASSISTANT_TICKET_STATUSES.done || status === ASSISTANT_TICKET_STATUSES.failed
  );
}

/** 通知区读取（坏/缺值 → 空数组）。 */
export function readAssistantWatchdogNotices(raw: AssistantDatabaseRaw): AssistantWatchdogNotice[] {
  const row = raw
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(ASSISTANT_WATCHDOG_KV_KEYS.notices) as { value: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AssistantWatchdogNotice =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as AssistantWatchdogNotice).ticketId === "string" &&
        typeof (entry as AssistantWatchdogNotice).kind === "string" &&
        typeof (entry as AssistantWatchdogNotice).summary === "string" &&
        typeof (entry as AssistantWatchdogNotice).atMs === "number",
    );
  } catch {
    return [];
  }
}

function writeAssistantWatchdogNotices(
  raw: AssistantDatabaseRaw,
  notices: readonly AssistantWatchdogNotice[],
  updatedAtMs: number,
): void {
  raw
    .prepare(
      "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
    )
    .run(
      ASSISTANT_WATCHDOG_KV_KEYS.notices,
      JSON.stringify(notices.slice(0, ASSISTANT_SNAPSHOT_LIMITS.watchdogNoticesMax)),
      updatedAtMs,
    );
}

export interface AssistantWatchdogDeps {
  readonly db: AssistantDatabase;
  /** 轮后推送快照（服务闭包的 publish；无变化时不推）。 */
  readonly publish: () => void;
  /** 配额值（服务闭包当轮实时读 settings 端口后传入；配额中心判定口径）。 */
  readonly readDailyQuota: () => Promise<number>;
}

/**
 * 一轮 watchdog（到轮判定 → 判据 → 标记/清标记 → 配额判定通知 → 审计落账）。
 * 事务顺序：到轮记账与标记同事务；通知判定逐条同事务（配额日记录与通知区同库，
 * 单写者连接串行化）。publish 仅在确有变化时触发（照 mateActivity 投影去重纪律）。
 */
export async function runAssistantWatchdogRound(
  deps: AssistantWatchdogDeps,
  input: { nowMs?: number; awaitingCandidates?: readonly AssistantAwaitingCandidate[] } = {},
): Promise<AssistantWatchdogRoundResult> {
  const nowMs = input.nowMs ?? Date.now();
  const kvGet = (key: string) => {
    const row = deps.db.raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  };
  const intervalMs = readAssistantWatchdogIntervalMs(kvGet);
  const lastRaw = kvGet(ASSISTANT_WATCHDOG_KV_KEYS.lastRoundMs);
  const lastMs = lastRaw !== undefined ? Number(lastRaw) : null;
  if (lastMs !== null && Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) {
    return {
      ran: false,
      atMs: nowMs,
      markedStaleTicketIds: [],
      clearedStaleCount: 0,
      notifiedCount: 0,
      aggregatedCount: 0,
    };
  }

  const quota = await deps.readDailyQuota();
  const ticketRows = deps.db.raw
    .prepare(
      "SELECT id, status, updated_ms, stale_ms, stale_kind FROM ticket ORDER BY updated_ms ASC",
    )
    .all() as Array<{
    id: string;
    status: string;
    updated_ms: number;
    stale_ms: number | null;
    stale_kind: string | null;
  }>;
  const tickets: AssistantWatchdogTicketRow[] = ticketRows.map((row) => ({
    id: row.id,
    status: row.status,
    updatedMs: row.updated_ms,
    staleMs: row.stale_ms,
    staleKind: row.stale_kind,
  }));
  const findings = computeAssistantWatchdogFindings(tickets, {
    nowMs,
    ...(input.awaitingCandidates ? { awaitingCandidates: input.awaitingCandidates } : {}),
  });
  const findingByTicket = new Map(findings.map((finding) => [finding.ticketId, finding]));
  const previousNotices = readAssistantWatchdogNotices(deps.db.raw);

  let clearedStaleCount = 0;
  let notifiedCount = 0;
  let aggregatedCount = 0;
  const markedStaleTicketIds: string[] = [];
  const nextNotices: AssistantWatchdogNotice[] = [];

  // 事务 1：到轮记账 + 信任门统计审计投影落账（04 详设 §2「kv 聚合，watchdog 同轮更新」；
  // setMode 判定不读本投影——它读实时 counts，trustGate.ts 注释即对账点）+ stale 标记/清除。
  deps.db.transaction((raw: AssistantDatabaseRaw) => {
    raw
      .prepare(
        "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
      )
      .run(ASSISTANT_WATCHDOG_KV_KEYS.lastRoundMs, String(nowMs), nowMs);
    const trustStats = computeTrustStats(readTrustCounts(raw));
    raw
      .prepare(
        "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
      )
      .run(
        ASSISTANT_TRUST_GATE_KV_KEYS.stats,
        JSON.stringify({
          releaseRate: trustStats.releaseRate,
          sampleCount: trustStats.sampleCount,
          updatedAtMs: nowMs,
        }),
        nowMs,
      );
    for (const finding of findings) {
      if (!finding.markStale) continue;
      const row = tickets.find((ticket) => ticket.id === finding.ticketId);
      if (!row || row.staleMs !== null) continue;
      raw
        .prepare(
          "UPDATE ticket SET stale_ms = ?, stale_kind = ? WHERE id = ? AND stale_ms IS NULL",
        )
        .run(nowMs, finding.kind, finding.ticketId);
      markedStaleTicketIds.push(finding.ticketId);
    }
    // 判据解除：已标记但本轮无对应 finding（状态流转/新事件推进 updated_ms/工单删除）→ 清除。
    for (const ticket of tickets) {
      if (ticket.staleMs === null) continue;
      const finding = findingByTicket.get(ticket.id);
      if (finding && finding.markStale) continue;
      raw
        .prepare("UPDATE ticket SET stale_ms = NULL, stale_kind = NULL WHERE id = ?")
        .run(ticket.id);
      clearedStaleCount += 1;
    }
  });

  // 事务 2+：通知逐条过配额闸（kind=report；超额由 quotaCenter 聚合次日摘要）。
  // 只对「新 finding 或既有通知未解除」的工单产生通知条目，避免同轮重复计数。
  for (const finding of findings) {
    const summary = finding.summary.slice(
      0,
      ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestItemMax,
    );
    const verdict = deps.db.transaction((raw: AssistantDatabaseRaw) =>
      admitAssistantDisturbanceTx(raw, {
        kind: ASSISTANT_DISTURBANCE_KINDS.report,
        summary,
        atMs: nowMs,
        quota,
      }),
    );
    if (verdict.aggregated) aggregatedCount += 1;
    if (verdict.allowed) {
      notifiedCount += 1;
      nextNotices.push({
        ticketId: finding.ticketId,
        kind: finding.kind,
        summary,
        atMs: nowMs,
      });
    }
  }
  // 通知区=本轮新通知 ∪ 仍命中的旧通知（判据解除的工单条目出清；容量截断保最新）。
  for (const notice of previousNotices) {
    if (findingByTicket.has(notice.ticketId)) {
      nextNotices.push(notice);
    }
  }
  deps.db.transaction((raw: AssistantDatabaseRaw) => {
    writeAssistantWatchdogNotices(raw, nextNotices, nowMs);
  });

  const changed =
    markedStaleTicketIds.length > 0 ||
    clearedStaleCount > 0 ||
    notifiedCount > 0 ||
    aggregatedCount > 0;
  if (changed) {
    deps.publish();
  }
  if (findings.length > 0 || changed) {
    logger.info("assistant-tickets watchdog 轮执行", {
      findings: findings.length,
      markedStale: markedStaleTicketIds.length,
      clearedStale: clearedStaleCount,
      notified: notifiedCount,
      aggregated: aggregatedCount,
    });
  }
  return {
    ran: true,
    atMs: nowMs,
    markedStaleTicketIds,
    clearedStaleCount,
    notifiedCount,
    aggregatedCount,
  };
}

/** 查询/快照投影用：当日打扰用量（读当日记录；不做判定）。 */
export function readAssistantWatchdogQuotaUsage(
  raw: AssistantDatabaseRaw,
  dayKey: string,
): number {
  return assistantQuotaDayTotal(readAssistantQuotaDay(raw, dayKey));
}
