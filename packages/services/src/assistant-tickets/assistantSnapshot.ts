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

interface TicketRow {
  id: string;
  brief: string;
  status: string;
  write_domain: string | null;
  dispatch_mode: string | null;
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

function ticketRowToView(row: TicketRow): AssistantSnapshot["tickets"][number] {
  const incarnation = JSON.parse(row.incarnation_current) as {
    sessionId?: string;
    anchorCommandId?: string | null;
  };
  const usage = JSON.parse(row.usage_accum) as { inputTokens?: number; outputTokens?: number };
  let generations: unknown = undefined;
  try {
    generations = JSON.parse(row.incarnation_generations);
  } catch {
    generations = undefined;
  }
  return {
    id: row.id,
    brief: row.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax),
    status: row.status,
    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
    usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
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
              r.state AS router_state, r.verdict AS router_verdict, r.error AS router_error
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
    };
  });
  const ticketRows = (
    raw
      .prepare(
        `SELECT id, brief, status, write_domain, dispatch_mode, queued_reason, decision_id, channel_ref, target_workspace_identity,
              incarnation_current, incarnation_generations, usage_accum, output_summary, fail_reason, updated_ms,
              stale_ms, stale_kind
         FROM ticket ORDER BY created_ms DESC LIMIT ?`,
      )
      .all(ASSISTANT_SNAPSHOT_LIMITS.ticketsMax) as unknown as TicketRow[]
  ).map((row) => ticketRowToView(row));
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
  const nowMs = Date.now();
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
