/**
 * Mate 夹具快照投影件（mate-browser.fixture-service 拆出——单文件 ≤800 行纪律，
 * 先例：mate-browser.fixture-inventory.ts）。fixture-service 内存实体 → 快照视图行
 * 的纯映射（无闭包、同输入恒同输出），实体形状常量随映射同文件（类型与投影不分居）。
 */
import { ASSISTANT_MODES, ASSISTANT_PERMISSION_TIERS, ASSISTANT_STRENGTHS } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantRouterSuggestionView,
  AssistantTicketView,
  IAssistantTicketService,
} from "@drora/services";

export interface FixtureDecision {
  id: number;
  triggerId: string;
  outcome: string;
  decidedBy: "gate" | "user";
  triggerText: string;
  decidedMs: number;
  sourceKind: string;
  /** P9：autonomy 卡强度字面量（contracts ASSISTANT_AUTONOMY_STRENGTH=autonomous；缺席=explicit）。 */
  strength?: string;
  /** P7（08 号详设 §3.4）：query_status 臂的确定性答复文本。 */
  answer?: string;
  routerState?: "pending" | "suggested" | "failed";
  routerSuggestion?: AssistantRouterSuggestionView;
  routerError?: string;
}

export interface FixtureTicket {
  id: string;
  brief: string;
  status: string;
  targetWorkspaceIdentity: string;
  sessionId: string | null;
  outputSummary: string | null;
  failReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  updatedAtMs: number;
  dispatchMode?: "A" | "B" | "C";
  decisionId?: number | null;
  anchorCommandId?: string | null;
  generationCount?: number;
  queuedReason?: string | null;
  channelRef?: string | null;
  // P4 第二棒（04 详设 §3）：核验滞留/增量确认/按代成本投影（快照同形可选字段）。
  awaitingSinceMs?: number | null;
  incrementsConfirmedMs?: number | null;
  usageByGeneration?: AssistantTicketView["usageByGeneration"];
  briefFull?: string;
}

/** approveDecision 入参捕获（Surface A 预填传参断言读点）。 */
export type FixtureApproveInput = Parameters<IAssistantTicketService["approveDecision"]>[0];

/** 内存工单实体 → 快照工单视图行（可选字段缺席不携带——诚实投影）。 */
export function toFixtureTicketViews(tickets: readonly FixtureTicket[]): AssistantTicketView[] {
  return tickets.map((ticket) => ({
    id: ticket.id,
    brief: ticket.brief,
    status: ticket.status,
    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
    usage: { ...ticket.usage },
    outputSummary: ticket.outputSummary,
    failReason: ticket.failReason,
    targetWorkspaceIdentity: ticket.targetWorkspaceIdentity,
    sessionId: ticket.sessionId,
    updatedAtMs: ticket.updatedAtMs,
    ...(ticket.dispatchMode ? { dispatchMode: ticket.dispatchMode } : {}),
    ...(ticket.decisionId !== undefined ? { decisionId: ticket.decisionId } : {}),
    ...(ticket.anchorCommandId !== undefined ? { anchorCommandId: ticket.anchorCommandId } : {}),
    ...(ticket.generationCount !== undefined ? { generationCount: ticket.generationCount } : {}),
    ...(ticket.queuedReason !== undefined ? { queuedReason: ticket.queuedReason } : {}),
    ...(ticket.channelRef !== undefined ? { channelRef: ticket.channelRef } : {}),
    ...(ticket.awaitingSinceMs !== undefined ? { awaitingSinceMs: ticket.awaitingSinceMs } : {}),
    ...(ticket.incrementsConfirmedMs !== undefined
      ? { incrementsConfirmedMs: ticket.incrementsConfirmedMs }
      : {}),
    ...(ticket.usageByGeneration !== undefined
      ? { usageByGeneration: ticket.usageByGeneration }
      : {}),
    ...(ticket.briefFull !== undefined ? { briefFull: ticket.briefFull } : {}),
  }));
}

/** 内存决策实体 → 快照决策视图行（autonomy 卡 strength 字面量如实透传；P10a-2 起
 * answer 随行——与服务 assistantSnapshot 单投影口径对齐，快照首屏的答复气泡消费）。 */
export function toFixtureDecisionViews(
  decisions: readonly FixtureDecision[],
): AssistantDecisionView[] {
  return decisions.map((decision) => ({
    id: decision.id,
    triggerId: decision.triggerId,
    strength: (decision.strength ??
      ASSISTANT_STRENGTHS.explicit) as AssistantDecisionView["strength"],
    mode: ASSISTANT_MODES.observe,
    outcome: decision.outcome,
    decidedBy: decision.decidedBy,
    decidedMs: decision.decidedMs,
    triggerText: decision.triggerText,
    sourceKind: decision.sourceKind,
    ...(decision.answer !== undefined ? { answer: decision.answer } : {}),
    ...(decision.routerState ? { routerState: decision.routerState } : {}),
    ...(decision.routerSuggestion ? { routerSuggestion: decision.routerSuggestion } : {}),
    ...(decision.routerError ? { routerError: decision.routerError } : {}),
  }));
}
