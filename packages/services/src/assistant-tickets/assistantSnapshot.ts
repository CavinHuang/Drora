/**
 * 台账快照投影（01 详设 §1.2：renderer 只读投影；P2 从服务文件抽出，逻辑不变）。
 *
 * P2 新增投影字段：决策卡 Router 建议（router_evaluation LEFT JOIN）与工单写域/代际/
 * 锚/派发模式（ticket P2 列 + incarnation JSON）。快照有界容量沿用
 * ASSISTANT_SNAPSHOT_LIMITS；version=2（assistantTickets.ts 注释即对账点）。
 *
 * 纯投影：只读 db，无副作用；publish 时序由服务闭包负责。
 */
import {
  ASSISTANT_OUTCOMES,
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

interface TicketRow {
  id: string;
  brief: string;
  status: string;
  write_domain: string | null;
  dispatch_mode: string | null;
  queued_reason: string | null;
  target_workspace_identity: string;
  incarnation_current: string;
  incarnation_generations: string;
  usage_accum: string;
  output_summary: string | null;
  fail_reason: string | null;
  updated_ms: number;
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
): AssistantSnapshot {
  const triggers = (
    raw
      .prepare(
        "SELECT id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms FROM trigger ORDER BY at_ms DESC LIMIT ?",
      )
      .all(ASSISTANT_SNAPSHOT_LIMITS.triggersMax) as Array<{
      id: string;
      source_kind: string;
      simulated_strength: string;
      identity: string;
      workspace_identity: string | null;
      text: string;
      at_ms: number;
    }>
  ).map((row) => ({
    id: row.id,
    sourceKind: row.source_kind,
    strength: row.simulated_strength as AssistantSnapshot["triggers"][number]["strength"],
    identity: row.identity,
    text: row.text,
    atMs: row.at_ms,
    targetWorkspaceIdentity: row.workspace_identity,
  }));
  const decisions = (
    raw
      .prepare(
        `SELECT d.id, d.trigger_id, d.strength, d.mode, d.outcome, d.decided_by, d.decided_ms, t.text AS trigger_text,
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
        `SELECT id, brief, status, write_domain, dispatch_mode, queued_reason, target_workspace_identity,
              incarnation_current, incarnation_generations, usage_accum, output_summary, fail_reason, updated_ms
         FROM ticket ORDER BY created_ms DESC LIMIT ?`,
      )
      .all(ASSISTANT_SNAPSHOT_LIMITS.ticketsMax) as unknown as TicketRow[]
  ).map((row) => ticketRowToView(row));
  const wouldAcceptCount = (
    raw
      .prepare("SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ?")
      .get(ASSISTANT_OUTCOMES.wouldAccept) as { n: number }
  ).n;
  const releaseCount = (
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ? AND decided_by = ?",
      )
      .get(ASSISTANT_OUTCOMES.decisionCard, "user") as { n: number }
  ).n;

  return {
    version: 2,
    mode: config.mode,
    allowlist: config.allowlist,
    budget: { maxActivePerWorkspace: config.budgetMaxActivePerWorkspace },
    trust: { wouldAcceptCount, releaseCount },
    triggers,
    decisions,
    tickets: ticketRows,
    updatedAtMs: Date.now(),
  };
}
