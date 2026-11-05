/**
 * 汇报卡完整版服务面（04 详设 §3；P4 第二棒，从 assistantTicketsService/dispatchEngine
 * 拆出——单文件 ≤800 行纪律，先例：autoDispatch/quotaCenterService/routerEvaluation）。
 *
 * 职责（04 详设 §3 落地注记）：
 * - 工件只读核验编排：W1 worktree 工单 turn ended（ledger 置 awaiting_output，schema v6
 *   列 awaiting_since_ms）后事务外异步核验——分支相对目标 workspace HEAD 有新提交 →
 *   done（终态钩子 worktree 清理+queued FIFO 释放照旧）；无新提交=核验失败 → 滞留喂
 *   watchdog（>60min → stale+建议人工核验）；核验端口缺席=P1 形态诚实降级（直落
 *   done，同 workspace 探测端口缺席先例）；git 失败/探测不可用=「不可校验」≠核验
 *   失败，滞留等待人工（锚对账 unavailable≠失配同款语义）。
 * - 人工出口：confirmTicketOutput（awaiting→done+终态钩子）与
 *   confirmTicketIncrements（置 increments_confirmed_ms，唯一写路径）。
 * - watchdog awaiting 判据事实源：collectAwaitingCandidates（status=awaiting_output）。
 *
 * 纯编排：db/端口由调用方注入；永不自动终止——除 awaiting_output 外不改任何状态，
 * stopMandate/换代等既有路径不受影响。
 */
import { ASSISTANT_ERROR_CODES, ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantErrorCode } from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import { getAssistantPorts } from "./assistantPorts.js";
import { parseWriteDomainColumn } from "./writeDomain.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

/** awaiting/确认面读的工单行（只读列集）。 */
export interface AssistantCompletionTicketRow {
  readonly id: string;
  readonly status: string;
  readonly write_domain: string | null;
  readonly target_workspace_identity: string;
  readonly awaiting_since_ms: number | null;
  readonly increments_confirmed_ms: number | null;
}

export function readCompletionTicketRow(
  raw: AssistantDatabaseRaw,
  ticketId: string,
): AssistantCompletionTicketRow | undefined {
  return raw
    .prepare(
      "SELECT id, status, write_domain, target_workspace_identity, awaiting_since_ms, increments_confirmed_ms FROM ticket WHERE id = ?",
    )
    .get(ticketId) as AssistantCompletionTicketRow | undefined;
}

/**
 * watchdog awaiting 判据事实源（04 详设 §1 判据表第 2 行）：status=awaiting_output 的
 * 工单 → awaitingCandidates（sinceMs=awaiting_since_ms 列；NULL 视为本轮时刻，不猜滞
 * 留起点）。服务在 runWatchdogRound 每轮喂入。
 */
export function collectAwaitingCandidates(
  raw: AssistantDatabaseRaw,
  fallbackMs: number,
): { ticketId: string; sinceMs: number }[] {
  const rows = raw
    .prepare("SELECT id, awaiting_since_ms FROM ticket WHERE status = ?")
    .all(ASSISTANT_TICKET_STATUSES.awaitingOutput) as Array<{
    id: string;
    awaiting_since_ms: number | null;
  }>;
  return rows.map((row) => ({
    ticketId: row.id,
    sinceMs: row.awaiting_since_ms ?? fallbackMs,
  }));
}

export interface AssistantCompletionDeps {
  readonly db: AssistantDatabase;
  /** 核验落定/确认后推送快照（服务闭包 publish）。 */
  readonly publish: () => void;
  /** awaiting→done 落终态后的后续动作（worktree 清理+queued FIFO 释放；引擎注入）。 */
  readonly onTicketTerminal: (input: {
    readonly ticketId: string;
    readonly workspaceIdentity: string;
    readonly status: string;
  }) => void;
}

/**
 * awaiting_output → done 的唯一落库路径（核验通过与人工确认共用）：状态守卫=仅
 * awaiting 行可落（不猜其他状态）；awaiting_since_ms 同事务清除；终态钩子在事务
 * 提交后执行（ledger pendingTerminal 同款纪律——钩子异常不回滚已提交归账）。
 */
export function settleAwaitingTicketTx(
  deps: AssistantCompletionDeps,
  ticketId: string,
): boolean {
  let identity = "";
  const applied = deps.db.transaction((raw) => {
    const row = readCompletionTicketRow(raw, ticketId);
    if (!row || row.status !== ASSISTANT_TICKET_STATUSES.awaitingOutput) return false;
    identity = row.target_workspace_identity;
    raw
      .prepare(
        "UPDATE ticket SET status = ?, awaiting_since_ms = NULL, updated_ms = ? WHERE id = ?",
      )
      .run(ASSISTANT_TICKET_STATUSES.done, nowMs(), ticketId);
    return true;
  });
  if (applied) {
    deps.onTicketTerminal({ ticketId, workspaceIdentity: identity, status: ASSISTANT_TICKET_STATUSES.done });
    deps.publish();
    logger.info("assistant-tickets awaiting 工单落终态 done", { ticketId });
  }
  return applied;
}

/**
 * 工件只读核验（04 详设 §3；ledger onAwaitingVerification 钩子驱动——事务提交后调用，
 * 结果经 settleAwaitingTicketTx 事务落库）。判定矩阵见文件头；publish 仅在需要让
 * 快照呈现「核验未通过」状态时触发（awaiting 进入已由 ledger publish 过）。
 */
export async function verifyTicketArtifacts(
  deps: AssistantCompletionDeps,
  ticketId: string,
): Promise<void> {
  const row = readCompletionTicketRow(deps.db.raw, ticketId);
  if (!row || row.status !== ASSISTANT_TICKET_STATUSES.awaitingOutput) return;
  const domain = parseWriteDomainColumn(row.write_domain);
  // 非 W1 工单无工件契约（ledger 不会置 awaiting；防御分支：误滞留按核验面缺席降级）。
  const { artifactVerify, workspaceProbe } = getAssistantPorts();
  if (!artifactVerify || domain?.kind !== "worktree") {
    logger.warn("assistant-tickets 工件核验端口缺席，按 P1 形态降级直落 done", { ticketId });
    settleAwaitingTicketTx(deps, ticketId);
    return;
  }
  // 核验基准=目标 workspace 主检出（分支由 worktree 建在主 HEAD；merge-base 在主检出
  // 运行才能区分「分支无新提交」与「主检出前进」——worktree 内 HEAD 即分支自身，不可用）。
  let workspacePath: string | undefined;
  try {
    const probe = workspaceProbe ? await workspaceProbe(row.target_workspace_identity) : null;
    if (probe?.ok) workspacePath = probe.workspacePath;
  } catch (error) {
    logger.warn("assistant-tickets 核验基准 workspace 探测失败", error);
  }
  if (!workspacePath) {
    logger.warn("assistant-tickets 工件核验不可用（无法定位基准检出），滞留待人工确认", {
      ticketId,
    });
    deps.publish();
    return;
  }
  const verdict = await artifactVerify
    .hasBranchCommits({ workspacePath, branch: domain.branch })
    .catch((error: unknown) => {
      logger.warn("assistant-tickets 工件核验端口异常", error);
      return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
    });
  if (verdict.ok && verdict.hasCommits) {
    settleAwaitingTicketTx(deps, ticketId);
    return;
  }
  if (verdict.ok) {
    // 核验失败（分支无新提交）→ 滞留喂 watchdog（>60min → stale+建议人工核验）。
    logger.info("assistant-tickets 工件核验未通过（分支无新提交），工单滞留 awaiting_output", {
      ticketId,
      branch: domain.branch,
    });
    deps.publish();
    return;
  }
  // 不可校验 ≠ 核验失败（锚对账同款语义）：滞留等待人工，不猜测、不自动重试。
  logger.warn("assistant-tickets 工件核验不可用，工单滞留 awaiting_output", {
    ticketId,
    reason: verdict.reason,
  });
  deps.publish();
}

/** confirmTicketOutput（人工核验通过）：仅 awaiting 行可确认；其余状态拒绝（不猜改写）。 */
export function confirmTicketOutput(
  deps: AssistantCompletionDeps,
  ticketId: string,
): { ok: true; value: { ok: true } } | { ok: false; error: { code: AssistantErrorCode; reason?: string } } {
  const row = readCompletionTicketRow(deps.db.raw, ticketId);
  if (!row) {
    return {
      ok: false,
      error: { code: ASSISTANT_ERROR_CODES.ticketNotFound, reason: `ticket ${ticketId} 不存在` },
    };
  }
  if (row.status !== ASSISTANT_TICKET_STATUSES.awaitingOutput) {
    return {
      ok: false,
      error: {
        code: ASSISTANT_ERROR_CODES.ticketNotFound,
        reason: `工单状态 ${row.status} 不在待核验滞留，人工确认只针对 awaiting_output`,
      },
    };
  }
  settleAwaitingTicketTx(deps, ticketId);
  return { ok: true, value: { ok: true } };
}

/**
 * confirmTicketIncrements（未确认增量行人工确认，04 详设 §3）：置
 * increments_confirmed_ms（唯一写路径；重复确认幂等不改写首确认时刻）。工单存在即可
 * 确认（活动/终态皆可——增量横幅的清除不依赖状态机）。
 */
export function confirmTicketIncrements(
  deps: AssistantCompletionDeps,
  ticketId: string,
): { ok: true; value: { ok: true } } | { ok: false; error: { code: AssistantErrorCode; reason?: string } } {
  const row = readCompletionTicketRow(deps.db.raw, ticketId);
  if (!row) {
    return {
      ok: false,
      error: { code: ASSISTANT_ERROR_CODES.ticketNotFound, reason: `ticket ${ticketId} 不存在` },
    };
  }
  if (row.increments_confirmed_ms !== null) {
    return { ok: true, value: { ok: true } }; // 幂等：已确认不回写新时刻。
  }
  deps.db.transaction((raw) => {
    raw
      .prepare("UPDATE ticket SET increments_confirmed_ms = ?, updated_ms = ? WHERE id = ?")
      .run(nowMs(), nowMs(), ticketId);
  });
  deps.publish();
  logger.info("assistant-tickets 换代增量人工确认", { ticketId });
  return { ok: true, value: { ok: true } };
}
