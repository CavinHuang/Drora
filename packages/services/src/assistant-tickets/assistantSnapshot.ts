/**
 * 台账快照投影（01 详设 §1.2：renderer 只读投影；P2 从服务文件抽出，逻辑不变）。
 *
 * P2 新增投影字段：决策卡 Router 建议（router_evaluation LEFT JOIN）与工单写域/代际/
 * 锚/派发模式（ticket P2 列 + incarnation JSON）。快照有界容量沿用
 * ASSISTANT_SNAPSHOT_LIMITS；version=2（assistantTickets.ts 注释即对账点）。
 *
 * P4 增量投影（可选追加，version 不变）：ticket stale 标记（watchdog schema v5 列）、
 * trust 信任门字段（实时 counts + kv 阈值）、配额中心投影（当日 kv 记录 + 服务闭包
 * 缓存配额值——判定以 admitDisturbance 实时读为准）、watchdog 有界通知区（kv）。
 *
 * 纯投影：只读 db，无副作用；publish 时序由服务闭包负责。
 */
import {
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SNAPSHOT_LIMITS,
  type AssistantPermissionTier,
  ASSISTANT_CONFIG_LIMITS,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
import type {
  AssistantConfigView,
  AssistantSnapshot,
  AssistantWriteDomainView,
} from "./assistantTickets.js";
import { computeTrustStats, isTrustGateOpen, readTrustCounts, readTrustGateThresholds } from "./trustGate.js";
import {
  assistantQuotaDayTotal,
  assistantQuotaKindCounts,
  collectPendingAssistantDigest,
  formatAssistantQuotaDayKey,
  readAssistantQuotaDay,
  resolveAssistantDailyQuota,
} from "./quotaCenter.js";
import { readAssistantWatchdogNotices } from "./watchdog.js";
import { parseDispatchIntent } from "./dispatchIntent.js";

interface TicketRow {
  id: string;
  brief: string;
  status: string;
  write_domain: string | null;
  dispatch_mode: string | null;
  dispatch_intent: string | null;
  queued_reason: string | null;
  decision_id: number | null;
  channel_ref: string | null;
  target_workspace_identity: string;
  incarnation_current: string;
  incarnation_generations: string;
  usage_accum: string;
  output_summary: string | null;
  fail_reason: string | null;
  updated_ms: number;
  stale_ms: number | null;
  stale_kind: string | null;
  awaiting_since_ms: number | null;
  increments_confirmed_ms: number | null;
}

/** ticket.write_domain JSON → 视图（缺列/坏 JSON 一律回退 {kind:"workspace"} 诚实降级）。 */
export function parseWriteDomainView(raw: string | null): AssistantWriteDomainView | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AssistantWriteDomainView>;
    if (parsed.kind === "worktree" && typeof parsed.path === "string" && typeof parsed.branch === "string") {
      return { kind: "worktree", path: parsed.path, branch: parsed.branch };
    }
    if (parsed.kind === "paths" && Array.isArray(parsed.paths)) {
      return { kind: "paths", paths: parsed.paths.filter((p): p is string => typeof p === "string") };
    }
    if (parsed.kind === "workspace") return { kind: "workspace" };
    return undefined;
  } catch {
    return undefined;
  }
}

/** 序列化写域（建票事务写列用；与服务视图同形）。 */
export function serializeWriteDomain(domain: AssistantWriteDomainView): string {
  return JSON.stringify(domain);
}

/** usage_log 行的投影原料（落窗归代输入）。 */
interface UsageLogRow {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly atMs: number;
}

/** 分代成本行（assistantTickets.ts AssistantTicketView["usageByGeneration"] 元素同形）。 */
export interface AssistantUsageGenerationRow {
  readonly generation: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly current?: boolean;
}

/**
 * usage_log 落窗归代（04 详设 §3「usage_log JOIN incarnation_generations」；纯函数，
 * 单测锁定）。窗口=[归档代 fromMs,toMs] + 当代 [boundAtMs,∞)；usage 行归「fromMs ≤
 * at_ms 的最后一个窗口」，早于首窗的行归第 1 代——Σ分代=usage_accum 合计不丢账。
 * durationMs=窗口跨度（当代=投影时刻迄今）。条数超界（contracts
 * usageGenerationsMax）时最旧窗口合并进首个保留窗（Σ 不变；换代极罕，防御分支）。
 */
export function computeUsageByGeneration(input: {
  readonly usageRows: readonly UsageLogRow[];
  readonly generations: readonly { readonly fromMs: number; readonly toMs: number }[];
  readonly currentFromMs: number;
  readonly nowMs: number;
}): AssistantUsageGenerationRow[] {
  interface Window {
    generation: number;
    fromMs: number;
    toMs: number;
    current: boolean;
  }
  let windows: Window[] = input.generations.map((generation, index) => ({
    generation: index + 1,
    fromMs: generation.fromMs,
    toMs: generation.toMs,
    current: false,
  }));
  windows.push({
    generation: input.generations.length + 1,
    fromMs: input.currentFromMs,
    toMs: Number.POSITIVE_INFINITY,
    current: true,
  });
  const max = ASSISTANT_SNAPSHOT_LIMITS.usageGenerationsMax;
  if (windows.length > max) {
    const keepFrom = windows.length - max;
    const absorbed = windows.slice(0, keepFrom + 1);
    const firstAbsorbed = absorbed.at(0);
    const lastAbsorbed = absorbed.at(-1);
    if (firstAbsorbed && lastAbsorbed) {
      const merged: Window = {
        generation: firstAbsorbed.generation,
        fromMs: firstAbsorbed.fromMs,
        toMs: lastAbsorbed.toMs,
        current: false,
      };
      windows = [
        merged,
        ...windows.slice(keepFrom + 1).map((window, index) => ({ ...window, generation: index + 2 })),
      ];
    }
  }
  const buckets = windows.map((window) => ({
    window,
    inputTokens: 0,
    outputTokens: 0,
  }));
  for (const row of input.usageRows) {
    let target = 0;
    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index];
      if (bucket && bucket.window.fromMs <= row.atMs) target = index;
    }
    const targetBucket = buckets[target];
    if (!targetBucket) continue; // 空窗集防御（windows 恒含当代，理论不可达）。
    targetBucket.inputTokens += row.inputTokens;
    targetBucket.outputTokens += row.outputTokens;
  }
  return buckets.map((bucket) => ({
    generation: bucket.window.generation,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    durationMs:
      bucket.window.current
        ? Math.max(0, input.nowMs - bucket.window.fromMs)
        : Math.max(0, bucket.window.toMs - bucket.window.fromMs),
    ...(bucket.window.current ? { current: true } : {}),
  }));
}

/** 一次查询取本页工单的 usage_log 行（快照有界：只查 ticketsMax 页内 id）。 */
function loadUsageLogRows(
  raw: AssistantDatabaseRaw,
  ticketIds: readonly string[],
): Map<string, UsageLogRow[]> {
  const byTicket = new Map<string, UsageLogRow[]>();
  if (ticketIds.length === 0) return byTicket;
  const placeholders = ticketIds.map(() => "?").join(", ");
  const rows = raw
    .prepare(
      `SELECT ticket_id, input_tokens, output_tokens, at_ms FROM usage_log WHERE ticket_id IN (${placeholders}) ORDER BY at_ms ASC`,
    )
    .all(...ticketIds) as Array<{
    ticket_id: string;
    input_tokens: number;
    output_tokens: number;
    at_ms: number;
  }>;
  for (const row of rows) {
    const bucket = byTicket.get(row.ticket_id) ?? [];
    bucket.push({ inputTokens: row.input_tokens, outputTokens: row.output_tokens, atMs: row.at_ms });
    byTicket.set(row.ticket_id, bucket);
  }
  return byTicket;
}

function ticketRowToView(
  row: TicketRow,
  usageRows: readonly UsageLogRow[],
  nowMs: number,
): AssistantSnapshot["tickets"][number] {
  const incarnation = JSON.parse(row.incarnation_current) as {
    sessionId?: string;
    anchorCommandId?: string | null;
    boundAtMs?: number;
  };
  const usage = JSON.parse(row.usage_accum) as { inputTokens?: number; outputTokens?: number };
  let generations: unknown = undefined;
  let generationWindows: { fromMs: number; toMs: number }[] = [];
  try {
    generations = JSON.parse(row.incarnation_generations);
    if (Array.isArray(generations)) {
      generationWindows = generations
        .filter(
          (entry): entry is { fromMs: number; toMs: number } =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { fromMs?: unknown }).fromMs === "number" &&
            typeof (entry as { toMs?: unknown }).toMs === "number",
        )
        .map((entry) => ({ fromMs: entry.fromMs, toMs: entry.toMs }));
    }
  } catch {
    generations = undefined;
  }
  return {
    id: row.id,
    brief: row.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax),
    // P4 第二棒（04 详设 §3 证据页签）：brief 全量 verbatim（界 ticketBriefFullMax）。
    briefFull: row.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.ticketBriefFullMax),
    status: row.status,
    // 派发档位投影（2026-11-05 全链审查修复）：旧实现恒投影 build（死值，guarded 工单
    // 显示错误档位，会误导未来消费方）。真值=落库 dispatch_intent.tier（建票事务写、
    // queued 释放/换代重放同源）；无 intent 的旧行（P2 v3 前数据）诚实回落 build，
    // yolo 恒不落 intent（spec §2.5 必须人工放行）。
    permissionTier:
      parseDispatchIntent(row.dispatch_intent)?.tier === ASSISTANT_PERMISSION_TIERS.guarded
        ? ASSISTANT_PERMISSION_TIERS.guarded
        : ASSISTANT_PERMISSION_TIERS.build,
    usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
    // P4 第二棒（04 详设 §3 按代成本）：usage_log 落窗归代投影（Σ=合计不丢账）。
    usageByGeneration: computeUsageByGeneration({
      usageRows,
      generations: generationWindows,
      currentFromMs: incarnation.boundAtMs ?? 0,
      nowMs,
    }),
    outputSummary: row.output_summary,
    failReason: row.fail_reason,
    targetWorkspaceIdentity: row.target_workspace_identity,
    sessionId: incarnation.sessionId ?? null,
    updatedAtMs: row.updated_ms,
    ...(row.dispatch_mode ? { dispatchMode: row.dispatch_mode as "A" | "B" | "C" } : {}),
    ...(parseWriteDomainView(row.write_domain) ? { writeDomain: parseWriteDomainView(row.write_domain) } : {}),
    ...(Array.isArray(generations) ? { generationCount: generations.length } : {}),
    anchorCommandId: incarnation.anchorCommandId ?? null,
    queuedReason: row.queued_reason,
    decisionId: row.decision_id,
    channelRef: row.channel_ref,
    // P4 watchdog stale 标记投影（schema v5 列；NULL=未标记）。
    staleSinceMs: row.stale_ms,
    staleKind: row.stale_kind,
    // P4 第二棒（schema v6 列）：核验滞留起始与增量确认时刻（NULL=不滞留/未确认）。
    awaitingSinceMs: row.awaiting_since_ms,
    incrementsConfirmedMs: row.increments_confirmed_ms,
  };
}

/** router_evaluation 行 → 决策卡建议视图（verdict JSON 与 routerDecision.ts 形状对齐）。 */
function parseRouterSuggestion(
  state: string | null,
  verdict: string | null,
): AssistantSnapshot["decisions"][number]["routerSuggestion"] {
  if (state !== "suggested" || !verdict) return undefined;
  try {
    const parsed = JSON.parse(verdict) as {
      kind?: string;
      arm?: Record<string, unknown>;
      reason?: string;
      evidence?: unknown;
    };
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((e): e is string => typeof e === "string")
      : [];
    const kind = parsed.kind;
    if (kind === "dispatch" || kind === "attach") {
      const arm = parsed.arm ?? {};
      return {
        kind,
        ...(typeof arm.targetWorkspaceIdentity === "string"
          ? { targetWorkspaceIdentity: arm.targetWorkspaceIdentity }
          : {}),
        ...(typeof arm.sessionId === "string" ? { sessionId: arm.sessionId } : {}),
        ...(typeof arm.permissionTier === "string"
          ? { permissionTier: arm.permissionTier as AssistantPermissionTier }
          : {}),
        ...(typeof arm.briefBase === "string" ? { briefBase: arm.briefBase as "verbatim" | "verbatim+appendix" } : {}),
        ...(typeof arm.appendix === "string" ? { appendix: arm.appendix } : {}),
        evidence,
      };
    }
    if (kind === "hold" || kind === "reject") {
      return { kind, ...(parsed.reason ? { reason: parsed.reason } : {}), evidence };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildAssistantSnapshot(
  raw: AssistantDatabaseRaw,
  config: AssistantConfigView,
  extras: { dailyQuota?: number } = {},
): AssistantSnapshot {
  const triggers = (
    raw
      .prepare(
        "SELECT id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms, channel_ref, remote_session_id FROM trigger ORDER BY at_ms DESC LIMIT ?",
      )
      .all(ASSISTANT_SNAPSHOT_LIMITS.triggersMax) as Array<{
      id: string;
      source_kind: string;
      simulated_strength: string;
      identity: string;
      workspace_identity: string | null;
      text: string;
      at_ms: number;
      channel_ref: string | null;
      remote_session_id: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    sourceKind: row.source_kind,
    strength: row.simulated_strength as AssistantSnapshot["triggers"][number]["strength"],
    identity: row.identity,
    text: row.text,
    atMs: row.at_ms,
    targetWorkspaceIdentity: row.workspace_identity,
    channelRef: row.channel_ref,
    remoteSessionId: row.remote_session_id,
  }));
  const decisions = (
    raw
      .prepare(
        `SELECT d.id, d.trigger_id, d.strength, d.mode, d.outcome, d.decided_by, d.decided_ms, t.text AS trigger_text,
              t.source_kind AS trigger_source_kind,
              r.state AS router_state, r.verdict AS router_verdict, r.error AS router_error,
              r.answer_text AS router_answer
         FROM admission_decision d
         JOIN trigger t ON t.id = d.trigger_id
         LEFT JOIN router_evaluation r ON r.decision_id = d.id
         ORDER BY d.decided_ms DESC LIMIT ?`,
      )
      .all(ASSISTANT_SNAPSHOT_LIMITS.decisionsMax) as Array<{
      id: number;
      trigger_id: string;
      strength: string;
      mode: string;
      outcome: string;
      decided_by: string;
      decided_ms: number;
      trigger_text: string;
      trigger_source_kind: string | null;
      router_state: string | null;
      router_verdict: string | null;
      router_error: string | null;
      router_answer: string | null;
    }>
  ).map((row) => {
    const suggestion = parseRouterSuggestion(row.router_state, row.router_verdict);
    return {
      id: row.id,
      triggerId: row.trigger_id,
      strength: row.strength as AssistantSnapshot["decisions"][number]["strength"],
      mode: row.mode as AssistantSnapshot["decisions"][number]["mode"],
      outcome: row.outcome,
      decidedBy: row.decided_by as AssistantSnapshot["decisions"][number]["decidedBy"],
      decidedMs: row.decided_ms,
      triggerText: row.trigger_text,
      // P3 来源徽标载体（可选追加，旧库/旧行 NULL 合法缺席）。
      ...(row.trigger_source_kind ? { sourceKind: row.trigger_source_kind } : {}),
      ...(row.router_state
        ? { routerState: row.router_state as "pending" | "suggested" | "failed" }
        : {}),
      ...(suggestion ? { routerSuggestion: suggestion } : {}),
      ...(row.router_error ? { routerError: row.router_error } : {}),
      // P7（08 号详设 §3.4）：查询直答文本（query_status 评估行携带；dismiss 后
      // outcome=ignored 但 answer 保留——消费方按 outcome 过滤呈现，见 MateQueryReply）。
      ...(row.router_answer ? { answer: row.router_answer } : {}),
    };
  });
  // 投影基准时刻（trust/quota/分代时长共用一个时钟读数，避免同帧内时刻漂移）。
  const nowMs = Date.now();
  // P4 第二棒（04 详设 §3 按代成本）：本页工单的 usage_log 行一次查询（界 ticketsMax）。
  const ticketRowsRaw = raw
    .prepare(
      `SELECT id, brief, status, write_domain, dispatch_mode, dispatch_intent, queued_reason, decision_id, channel_ref, target_workspace_identity,
            incarnation_current, incarnation_generations, usage_accum, output_summary, fail_reason, updated_ms,
            stale_ms, stale_kind, awaiting_since_ms, increments_confirmed_ms
       FROM ticket ORDER BY created_ms DESC LIMIT ?`,
    )
    .all(ASSISTANT_SNAPSHOT_LIMITS.ticketsMax) as unknown as TicketRow[];
  const usageRowsByTicket = loadUsageLogRows(
    raw,
    ticketRowsRaw.map((row) => row.id),
  );
  const ticketRows = ticketRowsRaw.map((row) =>
    ticketRowToView(
      row,
      usageRowsByTicket.get(row.id) ?? [],
      nowMs,
    ),
  );
  // 信任门统计（P4）：实时 counts（与 releaseCount/wouldAcceptCount 同一查询收口
  // trustGate.readTrustCounts）+ kv 可调阈值 → rate/samples/open 投影。
  const trustCounts = readTrustCounts(raw);
  const wouldAcceptCount = trustCounts.wouldAcceptCount;
  const releaseCount = trustCounts.releaseCount;
  const gateStats = computeTrustStats(trustCounts);
  const kvGet = (key: string) => {
    const row = raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  };
  const gateThresholds = readTrustGateThresholds(kvGet);
  // 配额中心投影（P4）：当日 kv 记录 + 近 ≤7 日未投递摘要；配额值=服务闭包缓存
  // （extras），判定以 admitDisturbance 实时读为准（quotaCenter 注释即对账点）。
  const quotaDay = readAssistantQuotaDay(raw, formatAssistantQuotaDayKey(nowMs));
  const dailyQuota = resolveAssistantDailyQuota(extras.dailyQuota);
  const quotaTotal = assistantQuotaDayTotal(quotaDay);
  return {
    version: 2,
    mode: config.mode,
    allowlist: config.allowlist,
    budget: { maxActivePerWorkspace: config.budgetMaxActivePerWorkspace },
    worktreeDisabled: config.worktreeDisabled,
    // P5 设置中心投影（06 号详设 §3；可选追加字段——旧 fixture 缺席合法）。
    modelPreference: config.modelPreference,
    trustGateThresholds: config.trustGateThresholds,
    watchdogIntervalMinutes: config.watchdogIntervalMinutes,
    sourcesConfig: config.sourcesConfig,
    // 行级截断（审查修复 F3）：嵌套两子表按行合并计数截断（旧 slice 作用在外层
    // 至多 2 个子表键上恒 no-op）；截断顺序 feishu 先于 github，超出界的历史手改
    // 数据在投影侧有界（写入口已封 50）。
    identityMap: (() => {
      const capped: { feishu?: Record<string, string>; github?: Record<string, string> } = {};
      let used = 0;
      for (const kind of ["feishu", "github"] as const) {
        const table = config.identityMap[kind];
        if (table === undefined) continue;
        const entries = Object.entries(table);
        const take = Math.max(0, ASSISTANT_CONFIG_LIMITS.identityMapMaxEntries - used);
        if (take === 0) break;
        capped[kind] = Object.fromEntries(entries.slice(0, take));
        used += Math.min(entries.length, take);
      }
      return capped;
    })(),
    trust: {
      wouldAcceptCount,
      releaseCount,
      releaseRate: gateStats.releaseRate,
      sampleCount: gateStats.sampleCount,
      gateOpen: isTrustGateOpen(gateStats, gateThresholds),
      gateThresholds,
    },
    triggers,
    decisions,
    tickets: ticketRows,
    quota: {
      date: formatAssistantQuotaDayKey(nowMs),
      quota: dailyQuota,
      used: assistantQuotaKindCounts(quotaDay),
      total: quotaTotal,
      remaining: Math.max(0, dailyQuota - quotaTotal),
      pendingDigest: collectPendingAssistantDigest(raw, nowMs),
    },
    watchdogNotices: readAssistantWatchdogNotices(raw).slice(
      0,
      ASSISTANT_SNAPSHOT_LIMITS.watchdogNoticesMax,
    ),
    updatedAtMs: nowMs,
  };
}
