/**
 * Mate 夹具对话流分页件（P10a，10 号详设 §2.4；mate-browser.fixture-service 拆出——
 * 单文件 ≤800 行纪律，先例：fixture-inventory/fixture-autonomy/fixture-quota）。
 * 内存版 readMateThread：语义与服务 mateThread.ts 同构（三源合并/倒序取正序回/
 * beforeMs 严格小于/limit 上界/同刻并列组 trigger→decision→ticket 呈现序/界刻补齐），
 * 供 P10a-2 对话管理台浏览器验收消费；真实 SQL 读作在服务侧（assistantMateThread.test.ts 锁定）。
 * 本文件同时承载 P7 查询直答注入件（createQueryReplyInjectFixture——对话面状态件归拢：
 * fixture-service ≤800 行纪律，语义不变）与 P10a-2 对话台验收状态件
 * （createThreadHistoryFixture：快照截断窗+旧史注入+recordTrigger 入参读点）。
 */
import {
  ASSISTANT_OUTCOMES,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_TICKET_STATUSES,
  ASSISTANT_STRENGTHS,
  MATE_THREAD_LIMITS,
} from "@drora/shared";
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
    // 与服务同构（P10 审查发现 2 修复）：beforeMs 非有限数拒绝（不猜测收敛）。
    if (input.beforeMs !== undefined && !Number.isFinite(input.beforeMs)) {
      return {
        ok: false,
        error: { code: "mate.validation.failed", reason: "beforeMs 必须为有限数" },
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
                // 与服务同构（P10 审查发现 2 修复）：brief 按快照口径截断 briefPreviewMax。
                brief: ticket.brief.slice(0, ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax),
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

// ---------------------------------------------------------------------------
// P10a-2 对话台验收状态件（mate-surface-ac MSA18 消费；真实语义在服务/产品侧）：
// - 快照截断窗：toggleTruncation 开启后 buildSnapshot 只携带各源**最新 N 行**（模拟
//   真实快照 triggersMax/decisionsMax/ticketsMax 的 LRU 截断——夹具取小窗 N=5 便于分页
//   验收；readMateThread 读全量实体=台账，与真实「快照截断首屏+分页读台账」同构）。
// - 旧史注入：seedHistory 向实体压入一批**早于**现有全部行的 trigger+decision 对（含
//   2 条 status_replied）与 2 张 done 工单（1 张带换代）——「加载更早」分页的可断言史。
// - recordTrigger 入参读点：captureTriggerInput 捕获触发原文（MSA18 断言 composer 发送
//   =explicit+target=workspaceKey 与 /mate 拦截同链；fixture-last-trigger 输出读点）。
// ---------------------------------------------------------------------------

/** 夹具截断窗（真实=ASSISTANT_SNAPSHOT_LIMITS.triggersMax=50 等；夹具取小窗便于分页验收）。 */
const FIXTURE_THREAD_TRUNCATION_WINDOW = 5;
/** 旧史注入的 trigger+decision 对数（升序编号 1..8；其中 1/2 为 status_replied 直答）。 */
const FIXTURE_THREAD_SEED_PAIRS = 8;

type FixtureTriggerInput = Parameters<IAssistantTicketService["recordTrigger"]>[0];

export function createThreadHistoryFixture(deps: {
  readonly pushTrigger: (trigger: AssistantTriggerView) => void;
  readonly pushDecision: (decision: FixtureDecision) => void;
  readonly pushTicket: (ticket: FixtureTicket) => void;
  readonly publish: () => void;
  readonly workspaceIdentity: string | undefined;
  /** 序号分配（闭包持有 seq 的自增读点——保持 fixture-service 既有单一序号源）。 */
  readonly allocateSeq: () => number;
}): {
  /** 快照截断开关（toggle；开启后 publish 生效）。 */
  toggleTruncation(): void;
  /** 注入旧史（一次注入一批；重复点击再注一批——时基递减保持「更早」语义）。 */
  seedHistory(): void;
  /** recordTrigger 入参捕获（composer 同链断言读点）。 */
  captureTriggerInput(input: FixtureTriggerInput): void;
  /** 最近一次 recordTrigger 入参摘要（`simulated=<s> target=<t> text=<text>`）。 */
  lastTriggerInput(): string;
  /** 快照实体裁剪：截断关闭=原引用直通；开启=各源最新 N 行（不改动实体本体）。 */
  scopeEntities(entities: {
    readonly triggers: readonly AssistantTriggerView[];
    readonly decisions: readonly FixtureDecision[];
    readonly tickets: readonly FixtureTicket[];
  }): {
    triggers: readonly AssistantTriggerView[];
    decisions: readonly FixtureDecision[];
    tickets: readonly FixtureTicket[];
  };
} {
  let truncated = false;
  let seededBatches = 0;
  let lastTrigger = "";

  function newest<T>(rows: readonly T[], at: (row: T) => number): T[] {
    return [...rows].sort((a, b) => at(b) - at(a)).slice(0, FIXTURE_THREAD_TRUNCATION_WINDOW);
  }

  return {
    toggleTruncation() {
      truncated = !truncated;
      deps.publish();
    },
    seedHistory() {
      seededBatches += 1;
      // 时基：每批比上一批再早 100h，批内间隔 1 分钟升序（旧史 1 最旧——升序呈现断言锚）。
      const base = Date.now() - seededBatches * 100 * 60 * 60 * 1000 - 10 * 60 * 60 * 1000;
      for (let index = 1; index <= FIXTURE_THREAD_SEED_PAIRS; index += 1) {
        const seq = deps.allocateSeq();
        const atMs = base + index * 60_000;
        const reply = index <= 2;
        const text = `MSA18 旧史 ${index}：${reply ? "点名问询" : "未指名观察"}`;
        deps.pushTrigger({
          id: `TR-${seq}`,
          sourceKind: "local",
          strength: reply ? ASSISTANT_STRENGTHS.explicit : ASSISTANT_STRENGTHS.inferred,
          identity: "fixture/user-a",
          text,
          atMs,
          targetWorkspaceIdentity: deps.workspaceIdentity,
        });
        deps.pushDecision({
          id: seq,
          triggerId: `TR-${seq}`,
          outcome: reply ? ASSISTANT_OUTCOMES.statusReplied : ASSISTANT_OUTCOMES.wouldAccept,
          decidedBy: "gate",
          triggerText: text,
          decidedMs: atMs,
          sourceKind: "local",
          ...(reply ? { answer: `旧史答复 ${index}：ws 旧史窗口内进行中 0，最近完成 1` } : {}),
        });
      }
      // 旧史工单两张（done；第二张带换代=第 2 代标注断言锚）。
      const ticketBase = base + FIXTURE_THREAD_SEED_PAIRS * 60_000 + 60_000;
      for (const [offset, brief, generationCount] of [
        [0, "MSA18 旧史工单 1", 0],
        [60_000, "MSA18 旧史工单 2", 1],
      ] as const) {
        const seq = deps.allocateSeq();
        deps.pushTicket({
          id: `T-${seq}`,
          brief,
          briefFull: brief,
          status: ASSISTANT_TICKET_STATUSES.done,
          targetWorkspaceIdentity: deps.workspaceIdentity ?? "",
          sessionId: `sess-thread-${seq}`,
          outputSummary: `完成：${brief} 摘要`,
          failReason: null,
          usage: { inputTokens: 32, outputTokens: 64 },
          updatedAtMs: ticketBase + offset,
          dispatchMode: "A",
          decisionId: null,
          anchorCommandId: null,
          generationCount,
        });
      }
      deps.publish();
    },
    captureTriggerInput(input) {
      // P10b 修复轮：管理入口触发（manageIntent=true，台账行「经大副停掉/取消」）在摘要
      // 追加 manage=true 段——MSA19 断言 UI 传参（auto 下服务侧降级 decision_card 的准入
      // 守卫由 assistantManageActions.test.ts 锁定）；composer 等无标记触发摘要不变。
      lastTrigger = `simulated=${input.simulated} target=${input.targetWorkspaceIdentity ?? "-"} text=${input.text}${
        input.manageIntent ? " manage=true" : ""
      }`;
    },
    lastTriggerInput() {
      return lastTrigger;
    },
    scopeEntities(entities) {
      if (!truncated) return entities;
      return {
        triggers: newest(entities.triggers, (row) => row.atMs),
        decisions: newest(entities.decisions, (row) => row.decidedMs),
        tickets: newest(entities.tickets, (row) => row.updatedAtMs),
      };
    },
  };
}
