/**
 * Mate 夹具对话流分页件（P10a，10 号详设 §2.4；mate-browser.fixture-service 拆出——
 * 单文件 ≤800 行纪律，先例：fixture-inventory/fixture-autonomy/fixture-quota）。
 * 内存版 readMateThread：语义与服务 mateThread.ts 同构（三源合并/倒序取正序回/
 * beforeMs 严格小于/limit 上界/同刻并列组 trigger→decision→ticket 呈现序/界刻补齐），
 * 供 P10a-2 对话管理台浏览器验收消费；真实 SQL 读作在服务侧（assistantMateThread.test.ts 锁定）。
 * 本文件同时承载 P7 查询直答注入件（createQueryReplyInjectFixture——对话面状态件归拢：
 * fixture-service ≤800 行纪律，语义不变）。
 */
import { ASSISTANT_TICKET_STATUSES, ASSISTANT_STRENGTHS, MATE_THREAD_LIMITS } from "@drora/shared";
import type { AssistantTriggerView, IAssistantTicketService, MateThreadRow } from "@drora/services";
import {
  toFixtureDecisionViews,
  type FixtureDecision,
  type FixtureTicket,
} from "./mate-browser.fixture-snapshot.js";

/** 归并行（与服务 mateThread.ts 同构：时刻+kind 序+同源 id）。 */
interface MergedRow {
  readonly atMs: number;
  readonly rank: 0 | 1 | 2;
  readonly id: string;
  readonly row: MateThreadRow;
}

function compareDesc(a: MergedRow, b: MergedRow): number {
  if (b.atMs !== a.atMs) return b.atMs - a.atMs;
  if (b.rank !== a.rank) return b.rank - a.rank;
  return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

/**
 * 创建内存版 readMateThread（entities 传可变数组引用——随夹具注入动作实时反映）。
 * answer 由本处直接透传（fixture-snapshot 的快照行映射不携带 answer 是既有面现状，
 * 对话流按服务语义携带——服务侧 answer 语义见 assistantSnapshot.assistantDecisionRowToView）。
 */
export function createMateThreadFixture(entities: {
  readonly triggers: AssistantTriggerView[];
  readonly decisions: FixtureDecision[];
  readonly tickets: FixtureTicket[];
}): IAssistantTicketService["readMateThread"] {
  return async (input) => {
    const limit = input.limit ?? MATE_THREAD_LIMITS.defaultPageSize;
    if (!Number.isInteger(limit) || limit < 1 || limit > MATE_THREAD_LIMITS.maxPageSize) {
      return {
        ok: false,
        error: {
          code: "mate.validation.failed",
          reason: `limit 必须为 1-${MATE_THREAD_LIMITS.maxPageSize} 的整数`,
        },
      };
    }
    const workspaceKey = input.workspaceKey?.trim() || undefined;
    const visibleDecisions = entities.decisions.filter((decision) => {
      const trigger = entities.triggers.find((item) => item.id === decision.triggerId);
      return (
        (input.beforeMs === undefined || decision.decidedMs < input.beforeMs) &&
        (!workspaceKey || trigger?.targetWorkspaceIdentity === workspaceKey)
      );
    });
    const merged: MergedRow[] = [
      ...entities.triggers
        .filter(
          (trigger) =>
            (input.beforeMs === undefined || trigger.atMs < input.beforeMs) &&
            (!workspaceKey || trigger.targetWorkspaceIdentity === workspaceKey),
        )
        .map(
          (trigger): MergedRow => ({
            atMs: trigger.atMs,
            rank: 0,
            id: trigger.id,
            row: { kind: "trigger", atMs: trigger.atMs, trigger },
          }),
        ),
      ...visibleDecisions.map((decision): MergedRow => {
        const view = toFixtureDecisionViews([decision])[0]!;
        return {
          atMs: view.decidedMs,
          rank: 1,
          id: String(view.id),
          row: {
            kind: "decision",
            atMs: view.decidedMs,
            decision: decision.answer !== undefined ? { ...view, answer: decision.answer } : view,
          },
        };
      }),
      ...entities.tickets
        .filter(
          (ticket) =>
            (ticket.status === ASSISTANT_TICKET_STATUSES.done ||
              ticket.status === ASSISTANT_TICKET_STATUSES.failed) &&
            (input.beforeMs === undefined || ticket.updatedAtMs < input.beforeMs) &&
            (!workspaceKey || ticket.targetWorkspaceIdentity === workspaceKey),
        )
        .map(
          (ticket): MergedRow => ({
            atMs: ticket.updatedAtMs,
            rank: 2,
            id: ticket.id,
            row: {
              kind: "ticket",
              atMs: ticket.updatedAtMs,
              ticket: {
                ticketId: ticket.id,
                brief: ticket.brief,
                status: ticket.status,
                targetWorkspaceIdentity: ticket.targetWorkspaceIdentity,
                outputSummary: ticket.outputSummary,
                failReason: ticket.failReason,
                ...(ticket.generationCount !== undefined
                  ? { generationCount: ticket.generationCount }
                  : {}),
              },
            },
          }),
        ),
    ].sort(compareDesc);
    const mainPage = merged.slice(0, limit);
    // 与服务同构：分页界不切开同刻并列组（界刻补齐；页可略超 limit）。
    let page = mainPage;
    if (mainPage.length === limit) {
      const boundary = mainPage[mainPage.length - 1]!;
      const extras = merged
        .slice(limit)
        .filter((row) => row.atMs === boundary.atMs)
        .sort(compareDesc);
      page = [...mainPage, ...extras];
    }
    return {
      ok: true,
      value: {
        rows: page.map((entry) => entry.row).reverse(),
        nextBeforeMs: mainPage.length === limit ? mainPage[mainPage.length - 1]!.atMs : null,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// P7 查询直答注入件（自 fixture-service 迁入——对话面状态件归拢，语义不变：
// MSA14 验收消费，答复文本即断言锚；无工单产生）。
// ---------------------------------------------------------------------------

/** 注入一条 status_replied 查询直答（返回 decision id）。 */
export function createQueryReplyInjectFixture(deps: {
  readonly triggers: AssistantTriggerView[];
  readonly decisions: FixtureDecision[];
  readonly workspaceIdentity: string | undefined;
  readonly publish: () => void;
  /** 序号分配（闭包持有 seq 的自增读点——保持 fixture-service 既有单一序号源）。 */
  readonly allocateSeq: () => number;
}): (text?: string) => number {
  return (text = "查询直答 fixture 答复") => {
    const seq = deps.allocateSeq();
    const triggerId = `TR-${seq}`;
    deps.triggers.push({
      id: triggerId,
      sourceKind: "local",
      strength: ASSISTANT_STRENGTHS.explicit,
      identity: "fixture/user-a",
      text,
      atMs: Date.now(),
      targetWorkspaceIdentity: deps.workspaceIdentity,
    });
    deps.decisions.push({
      id: seq,
      triggerId,
      outcome: "status_replied",
      decidedBy: "gate",
      triggerText: text,
      decidedMs: Date.now(),
      sourceKind: "local",
      answer: `答复：ws-a 进行中 1（修复登录），最近完成 1；数据时刻 ${new Date().toLocaleTimeString("zh-CN")}`,
    });
    deps.publish();
    return seq;
  };
}
