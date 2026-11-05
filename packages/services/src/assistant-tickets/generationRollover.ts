/**
 * 代际滚动与 follow-up（specs/drora-personal-assistant.md §8；02 详设 §2/§3）。
 *
 * 从 dispatchEngine 抽出的换代子侧（文件 ≤800 行纪律）：锚对账（Tier2 预检）、
 * follow-up（Tier1 直读投递）、换代事务（旧代归档+浓缩段重派）。执行细节（带序
 * commandId/锚回写/帧订阅）仍属引擎——经注入的 runDispatchCall/attachDispatch 复用，
 * 单一写者纪律不变（台账写经同一 db 连接）。
 *
 * 触发源仅三种（禁超时兜底）：锚校验失配（fork/rewind）/生命周期删除归档/lease 失效
 * （远程，P3 接线）；任一时刻最多一代 active（appendGeneration 闭合纪律）。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_GENERATION_CAUSES,
  ASSISTANT_TICKET_STATUSES,
  type AssistantErrorCode,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantDispatchResult } from "./assistantPorts.js";
import { getAssistantPorts } from "./assistantPorts.js";
import type { AssistantResult } from "./assistantTickets.js";
import {
  appendGeneration,
  composeGenerationDigest,
  normalizeGenerationCause,
  parseIncarnation,
  resolveAnchorVerdict,
  serializeIncarnation,
  type AnchorProbe,
  type AssistantIncarnation,
  type AssistantIncarnationGeneration,
} from "./incarnation.js";
import { parseWriteDomainColumn, type AssistantWriteDomain } from "./writeDomain.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

function fail<T>(code: AssistantErrorCode, reason?: string): AssistantResult<T> {
  return { ok: false, error: { code, reason } };
}

export interface GenerationRolloverTicketRow {
  id: string;
  brief: string;
  status: string;
  write_domain: string | null;
  target_workspace_identity: string;
  incarnation_current: string;
  incarnation_generations: string;
  usage_accum: string;
  output_summary: string | null;
  updated_ms: number;
}

export type ReadTicketRow = (raw: AssistantDatabaseRaw, ticketId: string) => GenerationRolloverTicketRow | undefined;

export interface GenerationRolloverDeps {
  readonly db: AssistantDatabase;
  readonly publish: () => void;
  readonly readTicketRow: ReadTicketRow;
  /** 引擎的派发执行（带序 commandId/锚回写/帧订阅挂接）。 */
  readonly runDispatchCall: (input: {
    ticketId: string;
    targetIdentity: string;
    briefOrText: string;
    tier: "build" | "guarded";
    mode: "A" | "B" | "C";
    hostPath?: string;
    attachSessionId?: string;
  }) => Promise<AssistantDispatchResult>;
  /** 引擎的附着执行（Tier2 校验 + cause='attached' 回写）。 */
  readonly attachDispatch: (input: {
    ticketId: string;
    text: string;
    targetIdentity: string;
    sessionId: string;
  }) => Promise<AssistantDispatchResult>;
  readonly markTicketFailed: (ticketId: string, reason: string) => void;
  /** 引擎的写域规划（W1 续用语义；allowWorktree 缺省 true=Mode A）。 */
  readonly resolveWorktree: (input: {
    ticketId: string;
    targetIdentity: string;
    existingDomain?: AssistantWriteDomain;
    allowWorktree?: boolean;
  }) => Promise<
    { ok: true; hostPath?: string; domain?: AssistantWriteDomain } | { ok: false; reason: string }
  >;
  /** 旧代帧退订（换代前调用；无监听时幂等 no-op）。 */
  readonly unwatchTicketRow: (row: GenerationRolloverTicketRow) => void;
  readonly hasWatchForTicket: (ticketId: string) => boolean;
}

export function createGenerationRollover(deps: GenerationRolloverDeps): {
  probeAttachTarget(input: { targetIdentity: string; sessionId: string }): Promise<AnchorProbe>;
  followUp(input: { ticketId: string; text: string }): Promise<AssistantDispatchResult>;
  recycle(input: { ticketId: string; cause: string; note?: string }): Promise<AssistantDispatchResult>;
} {
  const { db } = deps;

  async function probeAnchor(
    identity: string,
    sessionId: string,
    hostPath?: string,
  ): Promise<AnchorProbe> {
    const { sessionsIndex } = getAssistantPorts();
    if (!sessionsIndex) {
      return { kind: "unavailable", reason: "会话索引通道未装配（fail-closed，不猜锚位）" };
    }
    return sessionsIndex.probeSession(identity, sessionId, hostPath);
  }

  /**
   * Tier2 派发桥校验的预检入口（服务在放行事务之前调用）：失败时不消费决策卡、
   * 不建票——人工可改选"开新会话"（02 §2 Tier3 选项恒在）。
   */
  async function probeAttachTarget(input: {
    targetIdentity: string;
    sessionId: string;
  }): Promise<AnchorProbe> {
    const { workspaceProbe } = getAssistantPorts();
    let hostPath: string | undefined;
    if (workspaceProbe && input.targetIdentity) {
      const probe = await workspaceProbe(input.targetIdentity);
      if (probe.ok) hostPath = probe.workspacePath;
    }
    return probeAnchor(input.targetIdentity, input.sessionId, hostPath);
  }

  async function followUp(input: { ticketId: string; text: string }): Promise<AssistantDispatchResult> {
    const row = deps.readTicketRow(db.raw, input.ticketId);
    if (!row) return fail(ASSISTANT_ERROR_CODES.ticketNotFound, `ticket ${input.ticketId} 不存在`);
    if (
      row.status === ASSISTANT_TICKET_STATUSES.done ||
      row.status === ASSISTANT_TICKET_STATUSES.failed
    ) {
      return fail(ASSISTANT_ERROR_CODES.ticketNotFound, "工单已终态，不接受 follow-up");
    }
    const incarnation = parseIncarnation(row.incarnation_current);
    if (!incarnation.sessionId || !incarnation.anchorCommandId) {
      return fail(ASSISTANT_ERROR_CODES.validationFailed, "工单未绑定会话/无锚（Tier2/3 解析先行）");
    }
    const probe = await probeAnchor(
      row.target_workspace_identity,
      incarnation.sessionId,
      incarnation.hostPath,
    );
    // 不可校验 ≠ 失配（P2 审查修复）：reconcile 抛错/快照投影未就绪 → unavailable。
    // 此前该分支被当作失配触发换代重派——正常运行中的工单被误归档换代会话并重发
    // brief（任务重复执行风险），且扩大了 spec §8 的封闭换代触发源。按端口契约处置：
    // 如实报错（anchorMismatch 码+原因），不换代、不猜测、不自动重试（事件+校验驱动）。
    if (probe.kind === "unavailable") {
      return fail(
        ASSISTANT_ERROR_CODES.anchorMismatch,
        `锚对账不可用，follow-up 暂不投递（不换代、不猜测）：${probe.reason}`,
      );
    }
    const verdict = resolveAnchorVerdict(probe);
    if (verdict.mismatch) {
      // 触发源①：锚失配（fork/rewind/删除）→ 换代重派（台账浓缩），follow-up 随新代投递。
      const recycled = await recycle({
        ticketId: input.ticketId,
        cause:
          probe.kind === "missing" && probe.deleted
            ? ASSISTANT_GENERATION_CAUSES.lost
            : ASSISTANT_GENERATION_CAUSES.superseded,
        note: verdict.reason,
      });
      if (!recycled.ok) return recycled;
      return deps.attachDispatch({
        ticketId: input.ticketId,
        text: input.text,
        targetIdentity: row.target_workspace_identity,
        sessionId: recycled.value.sessionId,
      });
    }
    return deps.attachDispatch({
      ticketId: input.ticketId,
      text: input.text,
      targetIdentity: row.target_workspace_identity,
      sessionId: incarnation.sessionId,
    });
  }

  async function recycle(input: {
    ticketId: string;
    cause: string;
    note?: string;
  }): Promise<AssistantDispatchResult> {
    const worktree = await (async () => {
      const row = deps.readTicketRow(db.raw, input.ticketId);
      if (!row) return { ok: false as const, reason: `ticket ${input.ticketId} 不存在` };
      const existingDomain = parseWriteDomainColumn(row.write_domain);
      return deps.resolveWorktree({
        ticketId: input.ticketId,
        targetIdentity: row.target_workspace_identity,
        ...(existingDomain ? { existingDomain } : {}),
      });
    })();
    if (!worktree.ok) {
      return fail(ASSISTANT_ERROR_CODES.dispatchRejected, worktree.reason);
    }
    const brief = db.transaction((raw) => {
      const row = deps.readTicketRow(raw, input.ticketId);
      if (!row) return null;
      if (
        row.status === ASSISTANT_TICKET_STATUSES.done ||
        row.status === ASSISTANT_TICKET_STATUSES.failed
      ) {
        return null;
      }
      const incarnation = parseIncarnation(row.incarnation_current);
      const generations = JSON.parse(row.incarnation_generations) as AssistantIncarnationGeneration[];
      const normalized = normalizeGenerationCause(input.cause);
      const closed = appendGeneration(generations, {
        sessionId: incarnation.sessionId,
        fromMs: incarnation.boundAtMs || nowMs(),
        toMs: nowMs(),
        cause: normalized.cause,
        ...(input.note || normalized.noteSuffix
          ? { note: [input.note, normalized.noteSuffix].filter(Boolean).join("；") }
          : {}),
      });
      const usage = JSON.parse(row.usage_accum) as {
        inputTokens?: number;
        outputTokens?: number;
      };
      // 换代事务=旧代归档+新代立起（sessionId 空，派发成功即回写）；usage_accum 不动（按 ticketId 记账）。
      const nextIncarnation: AssistantIncarnation = {
        workspaceIdentity: incarnation.workspaceIdentity,
        sessionId: null,
        boundAtMs: nowMs(),
        cause: "dispatched",
        anchorCommandId: null,
        dispatchSeq: incarnation.dispatchSeq ?? 0,
        ...(worktree.domain?.kind === "worktree"
          ? { worktree: { path: worktree.domain.path, branch: worktree.domain.branch } }
          : {}),
        ...(worktree.hostPath ? { hostPath: worktree.hostPath } : {}),
      };
      raw
        .prepare(
          "UPDATE ticket SET incarnation_generations = ?, incarnation_current = ?, status = ?, updated_ms = ? WHERE id = ?",
        )
        .run(
          JSON.stringify(closed),
          serializeIncarnation(nextIncarnation),
          ASSISTANT_TICKET_STATUSES.dispatched,
          nowMs(),
          input.ticketId,
        );
      // brief=原文+台账浓缩段（历史 output_summary+usage 合计+未确认增量标注；02 §3）。
      const digest = composeGenerationDigest({
        nextGeneration: closed.length + 1,
        outputSummaries: row.output_summary
          ? [{ atMs: row.updated_ms, summary: row.output_summary }]
          : [],
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
        ...(input.note ? { unconfirmedNote: input.note } : {}),
      });
      return `${row.brief}\n\n---\n大副换代重派：\n${digest}`;
    });
    if (!brief) {
      return fail(ASSISTANT_ERROR_CODES.ticketNotFound, "工单不存在或已终态，不可换代");
    }
    const row = deps.readTicketRow(db.raw, input.ticketId);
    if (!row) return fail(ASSISTANT_ERROR_CODES.ticketNotFound, "工单不存在");
    if (deps.hasWatchForTicket(input.ticketId)) deps.unwatchTicketRow(row);
    const result = await deps.runDispatchCall({
      ticketId: input.ticketId,
      targetIdentity: row.target_workspace_identity,
      briefOrText: brief,
      tier: "build",
      mode: "A",
      ...(worktree.hostPath ? { hostPath: worktree.hostPath } : {}),
    });
    if (!result.ok) {
      deps.markTicketFailed(input.ticketId, result.error.reason ?? result.error.code);
      return result;
    }
    deps.publish();
    return result;
  }

  return { probeAttachTarget, followUp, recycle };
}
