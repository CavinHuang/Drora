/**
 * Mate 面板浏览器验收夹具的服务工厂（mate-browser.fixture.tsx 拆出——单文件 ≤800 行
 * 纪律；2026-11-05 P4 第二棒）。内存版 IAssistantTicketService synthetic：recordTrigger/
 * approveDecision/onDidChange 全部内存实现 + 推送，不代表真实 Host/CLI。语义对齐点
 * （approve 置 decided_by=user/二次放行幂等/终局定时推进/P4 核验滞留与配额判定同构简化）
 * 见 mate-browser.fixture.tsx 文件头与 mate-p4-ui.test.mjs。
 * 2026-11-06 二轮审查（F1 守卫）：approve 目标解析与真实链同构（入参 → Router 建议 →
 * trigger 落库值），tab.workspaceIdentity 兜底已移除——UI 忘传 target 的 F1 类回归在
 * 本验收面可红（validationFailed），不再被夹具恒兜底掩盖。
 * 2026-11-06 三轮复审拆件（≤800 纪律兑现）：台账/自主节奏状态件在此前批已拆
 * fixture-inventory/fixture-autonomy；本批再拆 fixture-quota（P4 配额中心/打扰闸/
 * watchdog 通知区）、fixture-trust（信任门达标投影+auto-locked 开关）、
 * fixture-snapshot（内存实体→快照视图行纯映射+实体类型）。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import type { AssistantMode } from "@drora/shared";
import { createInventoryInjectFixture } from "./mate-browser.fixture-inventory.js";
import {
  AUTONOMY_FIXTURE_BRIEF,
  createAutonomyRhythmFixture,
  injectAutonomyCardFixture,
} from "./mate-browser.fixture-autonomy.js";
import { createQuotaFixture } from "./mate-browser.fixture-quota.js";
import { createTrustGateFixture } from "./mate-browser.fixture-trust.js";
import {
  toFixtureDecisionViews,
  toFixtureTicketViews,
  type FixtureApproveInput,
  type FixtureDecision,
  type FixtureTicket,
} from "./mate-browser.fixture-snapshot.js";
import type {
  AssistantRouterSuggestionView,
  AssistantSnapshot,
  AssistantTriggerView,
  IAssistantTicketService,
} from "@drora/services";
import type { MateSidePaneTab } from "../../src/lib/workspaceSidePane.js";

// 实体形状类型随投影件落 fixture-snapshot（类型与映射不分居）；此处再导出维持
// fixture-service 既有 import 路径稳定。
export type { FixtureDecision, FixtureTicket, FixtureApproveInput };

/** 夹具 workspace tab（注入事件 trigger 落库 target 归属——injectRouterDecision/手机
 * 入口同构真实链「trigger 携带发生处 workspace identity」；**不再作 approve 兜底**，
 * 2026-11-06 F1 守卫。fixture 组件共用同实例）。 */
export const tab: MateSidePaneTab = {
  id: "mate:fixture-ws",
  type: "mate",
  openedAt: 0,
  workspaceKey: "fixture-ws",
  workspacePath: "/fixture/ws",
  workspaceIdentity: "fixture/workspace",
};

export function createMateFixtureService(
  onBrief?: (brief: string) => void,
  onApproveInput?: (input: FixtureApproveInput) => void,
  /** P4 第二棒：打扰闸判定读点回调（bubble 气泡闸 e2e 实时断言用）。 */
  onAdmit?: (record: string) => void,
) {
  let seq = 0;
  let mode: AssistantMode = ASSISTANT_MODES.observe;
  let allowlist: string[] = ["fixture/user-a"];
  let updatedAtMs = 1_000;
  let lastApproveInput: FixtureApproveInput | null = null;
  // P2 软预算默认回 3（contracts ASSISTANT_DEFAULTS；P1 fixture 曾用 1）。
  let budgetMax = 3;
  // P5 设置中心（06 号详设）：fixture 内存态（高级区/Source/模型偏好回显用）。
  let trustThresholds = { minRate: 0.8, minSamples: 15 };
  let watchdogIntervalMinutes = 15;
  let modelPreference: { providerId: string; modelId: string; reasoningLevel?: string } | null =
    null;
  let sourcesConfig: {
    feishu?: { enabled?: boolean };
    phone?: { enabled?: boolean };
    github?: { enabled?: boolean; repo?: string; mentionName?: string };
  } = {};
  let identityMap: { feishu?: Record<string, string>; github?: Record<string, string> } = {};
  // W1 worktree 用户开关（P2 审查修复补交互入口；setWorktreeDisabled 唯一写路径）。
  let worktreeDisabled = false;
  let queueNextApprove = false;
  let rolloverNextApprove = false;
  // P4 第二棒：下一次终局进核验滞留（awaiting_output）开关。
  let awaitNextTicket = false;
  // P3 接缝批：手机入口 ingest 结果读点（direct:<ticketId>:<text> / gate:<triggerId>:<outcome>）。
  let lastIngest = "";
  // P8b 台账注入状态件拆 mate-browser.fixture-inventory.ts（≤800 行纪律）；P9 自主
  // 节奏状态件拆 mate-browser.fixture-autonomy.ts；P4 配额/打扰闸/watchdog 通知区
  // 状态件拆 mate-browser.fixture-quota.ts；信任门投影/auto-locked 拆
  // mate-browser.fixture-trust.ts。缺席/就绪语义见各拆件文件头。
  const autonomyRhythm = createAutonomyRhythmFixture(publish);
  const quotaFixture = createQuotaFixture({ publish, onAdmit });
  const trustFixture = createTrustGateFixture(publish);
  const triggers: AssistantTriggerView[] = [];
  const decisions: FixtureDecision[] = [];
  const tickets: FixtureTicket[] = [];
  const ticketByDecision = new Map<number, { ticketId: string; sessionId: string }>();
  const listeners = new Set<(snapshot: AssistantSnapshot) => void>();

  function publish(): void {
    updatedAtMs += 1;
    const snapshot = buildSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  function buildSnapshot(): AssistantSnapshot {
    // 实体→视图行纯映射拆 mate-browser.fixture-snapshot.ts（≤800 行纪律）。
    const ticketViews = toFixtureTicketViews(tickets);
    const decisionViews = toFixtureDecisionViews(decisions);
    return {
      version: 2,
      mode,
      allowlist: [...allowlist],
      budget: { maxActivePerWorkspace: budgetMax },
      modelPreference,
      trustGateThresholds: trustThresholds,
      watchdogIntervalMinutes,
      sourcesConfig,
      identityMap,
      worktreeDisabled,
      trust: {
        wouldAcceptCount: decisions.filter(
          (item) => item.outcome === ASSISTANT_OUTCOMES.wouldAccept,
        ).length,
        releaseCount: decisions.filter(
          (item) => item.outcome === ASSISTANT_OUTCOMES.decisionCard && item.decidedBy === "user",
        ).length,
        // P4 修复轮：信任门达标投影（开关打开才携带——旧 Host 缺席=入口不渲染的诚实
        // 降级语义保持可验）；投影件拆 mate-browser.fixture-trust.ts。
        ...trustFixture.gateOpenProjection(),
      },
      triggers: [...triggers],
      decisions: decisionViews,
      tickets: ticketViews,
      // P4 配额中心投影（状态件拆 mate-browser.fixture-quota.ts；读取时日切结算）。
      quota: quotaFixture.quotaView(),
      watchdogNotices: quotaFixture.watchdogNoticesView(),
      ...(inventoryInject.ready ? { inventoryReady: true as const } : {}),
      ...(inventoryInject.view ? { inventory: inventoryInject.view } : {}),
      ...(autonomyRhythm.rhythm ? { rhythm: autonomyRhythm.rhythm } : {}),
      updatedAtMs,
    };
  }

  function finishTicket(ticketId: string): void {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket || ticket.status !== ASSISTANT_TICKET_STATUSES.dispatched) return;
    ticket.status = ASSISTANT_TICKET_STATUSES.running;
    ticket.updatedAtMs = Date.now();
    publish();
    setTimeout(() => {
      if (ticket.status !== ASSISTANT_TICKET_STATUSES.running) return;
      // P4 第二棒：fixture-await-next 开关 → 终局进 awaiting_output（核验滞留面：快照
      // awaitingSinceMs+按代成本投影+增量横幅由 rolloverNext/确认列驱动），与服务
      // 「turn ended+核验未通过」语义同构简化——真实核验在 host 侧 reportCompletion。
      if (awaitNextTicket) {
        awaitNextTicket = false;
        ticket.status = ASSISTANT_TICKET_STATUSES.awaitingOutput as string;
        ticket.awaitingSinceMs = Date.now();
        ticket.usage = { inputTokens: 96, outputTokens: 300 };
        ticket.usageByGeneration = [
          { generation: 1, inputTokens: 48, outputTokens: 120, durationMs: 90_000 },
          { generation: 2, inputTokens: 48, outputTokens: 180, durationMs: 45_000, current: true },
        ];
        ticket.outputSummary = "完成：fixture 汇报首行摘要（核验未通过滞留）";
        ticket.updatedAtMs = Date.now();
        publish();
        return;
      }
      ticket.status = ASSISTANT_TICKET_STATUSES.done;
      ticket.usage = { inputTokens: 128, outputTokens: 456 };
      // P4 第二棒：done 工单也带按代成本投影（单代=当代一行；多代随 rolloverNext）。
      ticket.usageByGeneration =
        (ticket.generationCount ?? 0) > 0
          ? [
              { generation: 1, inputTokens: 64, outputTokens: 200, durationMs: 120_000 },
              {
                generation: 2,
                inputTokens: 64,
                outputTokens: 256,
                durationMs: 30_000,
                current: true,
              },
            ]
          : [
              {
                generation: 1,
                inputTokens: 128,
                outputTokens: 456,
                durationMs: 150_000,
                current: true,
              },
            ];
      ticket.outputSummary = "完成：fixture 汇报首行摘要";
      ticket.updatedAtMs = Date.now();
      publish();
    }, 1400);
  }

  /** 注入带 Router 建议的决策卡（P2 Surface 呈现与预填传参验收；真实评估在 host 侧）。 */
  function injectRouterDecision(
    routerState: "suggested" | "failed",
    suggestion?: AssistantRouterSuggestionView,
    text = "点名：Router 预填场景",
  ): number {
    seq += 1;
    const triggerId = `TR-${seq}`;
    triggers.push({
      id: triggerId,
      sourceKind: "local",
      strength: ASSISTANT_STRENGTHS.explicit,
      identity: "fixture/user-a",
      text,
      atMs: Date.now(),
      targetWorkspaceIdentity: tab.workspaceIdentity,
    });
    decisions.push({
      id: seq,
      triggerId,
      outcome: ASSISTANT_OUTCOMES.decisionCard,
      decidedBy: "gate",
      triggerText: text,
      decidedMs: Date.now(),
      sourceKind: "local",
      routerState,
      ...(suggestion ? { routerSuggestion: suggestion } : {}),
      ...(routerState === "failed" ? { routerError: "router evaluation schema mismatch" } : {}),
    });
    publish();
    return seq;
  }

  /** P9 自主节奏 suggest 卡注入（注入件拆 mate-browser.fixture-autonomy.ts；MSA16）。 */
  function injectAutonomyCard(text: string = AUTONOMY_FIXTURE_BRIEF): number {
    return injectAutonomyCardFixture(
      {
        allocateId: () => {
          seq += 1;
          return seq;
        },
        pushTrigger: (trigger) => triggers.push(trigger),
        pushDecision: (decision) => decisions.push(decision),
        publish,
        workspaceIdentity: tab.workspaceIdentity ?? undefined,
      },
      text,
    );
  }

  /**
   * 注入 auto_notice×gate 告知卡（F4 验收，mate-surface-ac MSA12 消费；真实 auto 直派
   * 判定在 host 侧，renderer 夹具按诚实边界只造快照事实）。带同 decisionId 的 done 工单
   * ——告知卡工单号行经 ticket.decisionId 反查呈现（MateAutoNoticeRow 读点）。
   */
  function injectAutoNotice(text = "自动执行：点名任务（auto 直派）"): number {
    seq += 1;
    const triggerId = `TR-${seq}`;
    triggers.push({
      id: triggerId,
      sourceKind: "local",
      strength: ASSISTANT_STRENGTHS.explicit,
      identity: "fixture/user-a",
      text,
      atMs: Date.now(),
      targetWorkspaceIdentity: tab.workspaceIdentity,
    });
    tickets.push({
      id: `T-${seq}`,
      brief: text,
      briefFull: text,
      status: ASSISTANT_TICKET_STATUSES.done,
      targetWorkspaceIdentity: tab.workspaceIdentity ?? "",
      sessionId: `sess-auto-${seq}`,
      outputSummary: "完成：auto 直派 fixture 汇报摘要",
      failReason: null,
      usage: { inputTokens: 64, outputTokens: 128 },
      updatedAtMs: Date.now(),
      dispatchMode: "A",
      decisionId: seq,
      anchorCommandId: `T-${seq}-1`,
      generationCount: 0,
    });
    decisions.push({
      id: seq,
      triggerId,
      outcome: ASSISTANT_OUTCOMES.autoNotice,
      decidedBy: "gate",
      triggerText: text,
      decidedMs: Date.now(),
      sourceKind: "local",
    });
    publish();
    return seq;
  }

  // P7（08 号详设 §3.4）：注入 status_replied 查询直答（MSA14 验收消费——答复文本
  // 即 MSA 断言锚；无工单产生）。
  function injectQueryReply(text = "查询直答 fixture 答复"): number {
    seq += 1;
    const triggerId = `TR-${seq}`;
    triggers.push({
      id: triggerId,
      sourceKind: "local",
      strength: ASSISTANT_STRENGTHS.explicit,
      identity: "fixture/user-a",
      text,
      atMs: Date.now(),
      targetWorkspaceIdentity: tab.workspaceIdentity,
    });
    decisions.push({
      id: seq,
      triggerId,
      outcome: "status_replied",
      decidedBy: "gate",
      triggerText: text,
      decidedMs: Date.now(),
      sourceKind: "local",
      answer: `答复：ws-a 进行中 1（修复登录），最近完成 1；数据时刻 ${new Date().toLocaleTimeString("zh-CN")}`,
    });
    publish();
    return seq;
  }

  /**
   * P8b 台账注入（MSA15 验收消费；状态件拆 mate-browser.fixture-inventory.ts——
   * 工单实体须落 snapshot.tickets：总览卡工单行点击=selectTicket，详情视图按快照
   * 工单集渲染——诚实降级）。同点重复注入幂等。
   */
  const inventoryInject = createInventoryInjectFixture({
    hasTicket: (ticketId) => tickets.some((ticket) => ticket.id === ticketId),
    pushTicket: (ticket) => tickets.push(ticket),
    publish,
    workspaceKey: tab.workspaceIdentity ?? tab.workspaceKey,
  });
  const injectInventory = (): void => inventoryInject.inject();
  const clearInventory = (): void => inventoryInject.clear();
  const emptyInventory = (): void => inventoryInject.empty();

  /**
   * P9 节奏投影注入（MSA16 消费；状态件在 mate-browser.fixture-autonomy.ts——夹具从
   * 「旧 Host 缺席」态注入一份缺省投影以验收节奏区渲染与写入回显）。
   */
  const injectRhythm = (): void => autonomyRhythm.injectRhythm();

  const service: IAssistantTicketService = {
    async recordTrigger(input) {
      seq += 1;
      const triggerId = `TR-${seq}`;
      triggers.push({
        id: triggerId,
        sourceKind: "local",
        strength: input.simulated,
        identity: "fixture/user-a",
        text: input.text,
        atMs: Date.now(),
        ...(input.targetWorkspaceIdentity
          ? { targetWorkspaceIdentity: input.targetWorkspaceIdentity }
          : {}),
      });
      const outcome =
        input.simulated === ASSISTANT_STRENGTHS.explicit
          ? ASSISTANT_OUTCOMES.decisionCard
          : ASSISTANT_OUTCOMES.wouldAccept;
      decisions.push({
        id: seq,
        triggerId,
        outcome,
        decidedBy: "gate",
        triggerText: input.text,
        decidedMs: Date.now(),
        sourceKind: "local",
      });
      publish();
      return { ok: true, value: { triggerId, outcome } };
    },

    async approveDecision(input) {
      lastApproveInput = { ...input };
      onApproveInput?.(lastApproveInput);
      // P1 验收场景 4：同 decision 二次放行幂等返回首次结果（不二派）。
      const existing = ticketByDecision.get(input.decisionId);
      if (existing) return { ok: true, value: existing };
      const decision = decisions.find((item) => item.id === input.decisionId);
      if (!decision || decision.outcome !== ASSISTANT_OUTCOMES.decisionCard) {
        return { ok: false, error: { code: "mate.decision.not_found" } };
      }
      // 2026-11-06 二轮审查（F1 守卫）：放行目标解析与真实链同构
      // （assistantTicketsService.approve：入参显式 target → Router 建议预填 → trigger
      // 落库值 decision.workspace_identity），**移除夹具 tab.workspaceIdentity 兜底**——
      // 旧兜底让 UI 忘传 target 时 approve 恒命中、F1 类回归（UI 条件透传改回）在本
      // 验收面永不复现；现在 target 链断即 validationFailed「缺少派发目标」同码拒绝。
      const triggerTarget = triggers.find(
        (trigger) => trigger.id === decision.triggerId,
      )?.targetWorkspaceIdentity;
      const targetIdentity =
        input.targetWorkspaceIdentity ??
        decision.routerSuggestion?.targetWorkspaceIdentity ??
        triggerTarget ??
        "";
      if (!targetIdentity) {
        return {
          ok: false,
          error: {
            code: ASSISTANT_ERROR_CODES.validationFailed,
            reason: "缺少派发目标 workspace（fixture 与真实链同构拒绝）",
          },
        };
      }
      seq += 1;
      const ticketId = `T-${seq}`;
      const sessionId = `sess-${seq}`;
      const brief = input.briefAppendix
        ? `${decision.triggerText}\n${input.briefAppendix}`
        : decision.triggerText;
      // 契约语义：放行即 decided_by=user（卡片脱离待决策集；releaseCount 积累）。
      decision.decidedBy = "user";
      // P3 接缝批：trigger.channel_ref 回填 ticket.channel_ref（assistantSnapshot 同列
      // 语义——放行建票即绑定通道，同通道 follow-up 命中即直通）。
      const triggerChannelRef =
        triggers.find((trigger) => trigger.id === decision.triggerId)?.channelRef ?? null;
      if (queueNextApprove) {
        // P2 软预算排队（specs §9）：工单 queued 立项+告知文案，不推进终态。
        queueNextApprove = false;
        tickets.push({
          id: ticketId,
          brief,
          briefFull: brief,
          status: ASSISTANT_TICKET_STATUSES.queued,
          targetWorkspaceIdentity: targetIdentity,
          sessionId,
          outputSummary: null,
          failReason: null,
          usage: { inputTokens: 0, outputTokens: 0 },
          updatedAtMs: Date.now(),
          dispatchMode: input.dispatchMode ?? "A",
          decisionId: input.decisionId,
          anchorCommandId: null,
          generationCount: 0,
          queuedReason: "同 workspace 活动工单已达软预算 3，已进入排队",
        });
        ticketByDecision.set(input.decisionId, { ticketId, sessionId });
        onBrief?.(brief);
        publish();
        return { ok: true, value: { ticketId, sessionId, queued: true } };
      }
      tickets.push({
        id: ticketId,
        brief,
        briefFull: brief,
        status: ASSISTANT_TICKET_STATUSES.dispatched,
        targetWorkspaceIdentity: targetIdentity,
        sessionId,
        outputSummary: null,
        failReason: null,
        usage: { inputTokens: 0, outputTokens: 0 },
        updatedAtMs: Date.now(),
        dispatchMode: input.attachToSessionId ? "C" : (input.dispatchMode ?? "A"),
        decisionId: input.decisionId,
        anchorCommandId: `${ticketId}-1`,
        generationCount: rolloverNextApprove ? 1 : 0,
        channelRef: triggerChannelRef,
      });
      rolloverNextApprove = false;
      ticketByDecision.set(input.decisionId, { ticketId, sessionId });
      // 01 §6 场景 3 的验收读点：brief=原文+追加段两段（E 改单不改写原文）。
      onBrief?.(brief);
      publish();
      setTimeout(() => finishTicket(ticketId), 400);
      return { ok: true, value: { ticketId, sessionId } };
    },

    async ignoreDecision(input) {
      const decision = decisions.find((item) => item.id === input.decisionId);
      if (decision) {
        decision.outcome = ASSISTANT_OUTCOMES.rejected;
        decision.decidedBy = "user";
        publish();
      }
      return { ok: true, value: { ok: true } };
    },

    // P3 Source 注册表手机入口（03 详设 §3 事件面定型）：fixture 按 recordTrigger 同构
    // 模拟（identity=fixture 本机用户、sourceKind=phone），供手机入口浏览器验收复用。
    // P3 接缝批补齐服务同构语义：channel_ref 命中活动工单 → 直通（不建新 trigger/
    // decision，原文并入 brief 尾行模拟 follow-up 投递、anchor 序号推进）；放行建票时
    // trigger.channel_ref 回填 ticket.channel_ref（assistantSnapshot 同列语义）。
    async submitSourceEntry(input) {
      if (input.channelRef) {
        const bound = tickets.find(
          (ticket) =>
            ticket.channelRef === input.channelRef &&
            ticket.status !== ASSISTANT_TICKET_STATUSES.done &&
            ticket.status !== ASSISTANT_TICKET_STATUSES.failed,
        );
        if (bound) {
          const seqNo =
            bound.anchorCommandId && /-(\d+)$/.test(bound.anchorCommandId)
              ? Number(/-(\d+)$/.exec(bound.anchorCommandId)?.[1]) + 1
              : 1;
          bound.anchorCommandId = `${bound.id}-${seqNo}`;
          bound.updatedAtMs = Date.now();
          lastIngest = `direct:${bound.id}:${input.text}`;
          publish();
          return {
            ok: true,
            value: {
              triggerId: null,
              outcome: null,
              directThrough: true,
              ticketId: bound.id,
              sessionId: bound.sessionId ?? undefined,
            },
          };
        }
      }
      seq += 1;
      const triggerId = `TR-${seq}`;
      triggers.push({
        id: triggerId,
        sourceKind: "phone",
        strength: input.mention ? ASSISTANT_STRENGTHS.explicit : ASSISTANT_STRENGTHS.inferred,
        identity: "fixture/user-a",
        text: input.text,
        atMs: input.atMs ?? Date.now(),
        ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
        ...(input.channelRef ? { channelRef: input.channelRef } : {}),
        ...(input.targetWorkspaceIdentity
          ? { targetWorkspaceIdentity: input.targetWorkspaceIdentity }
          : {}),
      });
      const outcome =
        input.mention && allowlist.includes("fixture/user-a")
          ? ASSISTANT_OUTCOMES.decisionCard
          : ASSISTANT_OUTCOMES.wouldAccept;
      decisions.push({
        id: seq,
        triggerId,
        outcome,
        decidedBy: "gate",
        triggerText: input.text,
        decidedMs: Date.now(),
        sourceKind: "phone",
      });
      lastIngest = `gate:${triggerId}:${outcome}`;
      publish();
      return {
        ok: true,
        value: { triggerId, outcome, directThrough: false },
      };
    },

    async dismissObservation(input) {
      for (const decision of decisions) {
        if (
          decision.triggerId === input.triggerId &&
          decision.outcome === ASSISTANT_OUTCOMES.wouldAccept
        ) {
          decision.outcome = ASSISTANT_OUTCOMES.ignored;
          decision.decidedBy = "user";
        }
      }
      publish();
      return { ok: true, value: { ok: true } };
    },

    // specs §11 能力审查修复批：详情页「停止」按钮的读点——内存版同构语义（非终态→
    // failed+stopped_by_user+时刻推进；真实服务另有 worktree 清理/排队 FIFO 释放）。
    async stopMandate(input) {
      const ticket = tickets.find((item) => item.id === input.ticketId);
      if (!ticket) return { ok: false, error: { code: "mate.ticket.not_found" } };
      if (
        ticket.status !== ASSISTANT_TICKET_STATUSES.done &&
        ticket.status !== ASSISTANT_TICKET_STATUSES.failed
      ) {
        ticket.status = ASSISTANT_TICKET_STATUSES.failed;
        ticket.failReason = "stopped_by_user";
        ticket.updatedAtMs = Date.now();
      }
      publish();
      return { ok: true, value: { ok: true } };
    },

    // P4 第二棒（04 详设 §3）人工出口（fixture 内存版同构语义）：核验确认=非 awaiting
    // 拒绝（ticketNotFound）、awaiting→done+增量横幅仍在；增量确认=置确认时刻（幂等）。
    async confirmTicketOutput(input) {
      const ticket = tickets.find((item) => item.id === input.ticketId);
      if (!ticket || ticket.status !== (ASSISTANT_TICKET_STATUSES.awaitingOutput as string)) {
        return { ok: false, error: { code: "mate.ticket.not_found" } };
      }
      ticket.status = ASSISTANT_TICKET_STATUSES.done;
      ticket.awaitingSinceMs = null;
      publish();
      return { ok: true, value: { ok: true } };
    },

    async confirmTicketIncrements(input) {
      const ticket = tickets.find((item) => item.id === input.ticketId);
      if (!ticket) return { ok: false, error: { code: "mate.ticket.not_found" } };
      ticket.incrementsConfirmedMs = Date.now();
      publish();
      return { ok: true, value: { ok: true } };
    },

    async revokeMandate() {
      return { ok: true, value: { ok: true } };
    },

    async setMode(next) {
      // P4 修复轮：fixture-auto-locked-next 开关 → 下一次 setMode("auto") 模拟服务侧
      // 复核失败 mate.auto.locked（状态件拆 mate-browser.fixture-trust.ts——确认框到
      // setMode 之间信任回落；assistantP4Host 同码锁定真实判定）。
      const locked = trustFixture.consumeAutoLockedRejection(next);
      if (locked) return locked;
      mode = next;
      publish();
      return { ok: true, value: { ok: true } };
    },

    async setAllowlist(identities) {
      allowlist = [...identities];
      publish();
      return { ok: true, value: { ok: true } };
    },

    async setWorktreeDisabled(disabled) {
      worktreeDisabled = disabled;
      publish();
      return { ok: true, value: { ok: true } };
    },

    // P7（08 号详设）：查询答复卡 dismiss（status_replied → ignored；快照回显出清）。
    async dismissQueryReply(input) {
      const decision = decisions.find((d) => d.id === input.decisionId);
      if (decision && decision.outcome === "status_replied") decision.outcome = "ignored";
      publish();
      return { ok: true, value: { ok: true } };
    },

    // P5 设置中心：六 setter 内存实现（快照回显；MSA13 验收消费）。
    async setBudget(input) {
      budgetMax = input.maxActivePerWorkspace;
      publish();
      return { ok: true, value: { ok: true } };
    },
    // P9 节奏区两 setter（内存实现件拆 mate-browser.fixture-autonomy.ts；快照回显）。
    setAutonomyEnabled: (input) => autonomyRhythm.setAutonomyEnabled(input),
    setAutonomyIntervalMinutes: (input) => autonomyRhythm.setAutonomyIntervalMinutes(input),
    async setTrustGateThresholds(input) {
      trustThresholds = {
        minRate: input.minRate ?? trustThresholds.minRate,
        minSamples: input.minSamples ?? trustThresholds.minSamples,
      };
      publish();
      return { ok: true, value: { ok: true } };
    },
    async setWatchdogIntervalMinutes(input) {
      watchdogIntervalMinutes = input.minutes;
      publish();
      return { ok: true, value: { ok: true } };
    },
    async setSourcesConfig(input) {
      sourcesConfig = input;
      publish();
      return { ok: true, value: { ok: true } };
    },
    async setSourceIdentityMap(input) {
      identityMap = { ...input };
      publish();
      return { ok: true, value: { ok: true } };
    },
    async setModelPreference(input) {
      modelPreference = input;
      publish();
      return { ok: true, value: { ok: true } };
    },

    async getConfig() {
      return {
        ok: true as const,
        value: {
          mode,
          allowlist: [...allowlist],
          budgetMaxActivePerWorkspace: budgetMax,
          worktreeDisabled: false,
          trustGateThresholds: trustThresholds,
          watchdogIntervalMinutes,
          modelPreference,
          sourcesConfig,
          identityMap,
        },
      };
    },

    async getSnapshot() {
      return buildSnapshot();
    },

    // P4 配额中心/打扰闸内存实现（状态件拆 mate-browser.fixture-quota.ts——判定语义
    // 与服务 admitDisturbanceTx 同构简化：decision 永不抑制仍计数、report/bubble 超配
    // 额聚合当日 digest；闸判定读点经 onAdmit 回调）。
    admitDisturbance: (input) => quotaFixture.admitDisturbance(input),

    async getDisturbanceQuota() {
      return { ok: true as const, value: quotaFixture.quotaView() };
    },

    markDailyDigestDelivered: () => quotaFixture.markDailyDigestDelivered(),

    onDidChange(listener) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
  };
  return {
    service,
    buildSnapshot,
    approveDirect: service.approveDecision,
    resync: publish,
    injectRouterDecision,
    injectAutoNotice,
    injectQueryReply,
    // P9 自主节奏验收控件（mate-surface-ac MSA16 消费；既有场景不点不触发）。
    injectAutonomyCard,
    /** 注入节奏投影（enabled=true/30min 缺省——「有节奏投影的 Host」态）。 */
    injectRhythm,
    submitSource: service.submitSourceEntry,
    /** F1 守卫读点（mate-surface-ac MSA11 消费）：绕过 UI 直调 approveDecision 且
     * **不带 targetWorkspaceIdentity**——命中 trigger 落库回读臂（真实链 decision.
     * workspace_identity 兜底语义）；UI 触发未恒传 workspaceKey 的回归在此得到
     * validationFailed（e2e 以建票成功=fixture-last-brief 推进为准绳）。 */
    approveBare: async () => {
      const latest = [...decisions]
        .reverse()
        .find(
          (item) =>
            item.outcome === ASSISTANT_OUTCOMES.decisionCard && !ticketByDecision.has(item.id),
        );
      if (!latest) return;
      return service.approveDecision({
        decisionId: latest.id,
        permissionTier: ASSISTANT_PERMISSION_TIERS.build,
      });
    },
    /** 手机入口 ingest 结果读点（direct:<ticketId>:<text> / gate:<triggerId>:<outcome>）。 */
    lastIngest(): string {
      return lastIngest;
    },
    queueNext(): void {
      queueNextApprove = true;
    },
    rolloverNext(): void {
      rolloverNextApprove = true;
    },
    // ---- P4 第二棒验收控件（mate-p4-ui.test.mjs 消费；P1-P3 场景不点不触发） ----
    /** 下一次终局进核验滞留（awaiting_output；快照带 awaitingSinceMs+按代成本投影）。 */
    awaitNext(): void {
      awaitNextTicket = true;
    },
    /** 注入一条 watchdog 通知（快照 watchdogNotices ≤5 投影源；状态件 fixture-quota）。 */
    injectNotice(ticketId: string, kind: string, summary: string): void {
      quotaFixture.injectNotice(ticketId, kind, summary);
    },
    /** 推送 N 条 report 类打扰（超额即聚合 digest；e2e 断言摘要卡与状态条配额行）。 */
    pushReports(count: number, summary: string): void {
      quotaFixture.pushReports(count, summary);
    },
    /** 气泡闸判定读点（kind:summary:allowed）。 */
    lastAdmit(): string {
      return quotaFixture.lastAdmit();
    },
    // ---- P4 修复轮验收控件（mate-trust-auto.test.mjs 消费；既有场景不点不触发） ----
    /** 信任门达标投影开关（快照 trust 携带 gateOpen/rate/samples/阈值——只造投影，
     * 不伪造 host 侧统计与复核判定；状态件 fixture-trust）。 */
    setTrustGateOpen(open: boolean): void {
      trustFixture.setTrustGateOpen(open);
    },
    /** 下一次 setMode("auto") 模拟服务侧复核失败 mate.auto.locked（一次性消费）。 */
    setAutoLockedNext(): void {
      trustFixture.setAutoLockedNext();
    },
    // ---- P8b 台账验收控件（mate-surface-ac MSA15 消费；既有场景不点不触发） ----
    /** 注入全域台账视图（含本组工单/双会话/闲时行+跨项目组；工单行 T-inv-1 落
     * snapshot.tickets 支撑下钻断言）。 */
    injectInventory,
    /** 清空台账视图（ready 保持 true）→「投影就绪中」态。 */
    clearInventory,
    /** 空台账视图（workspaces 空）→「无工作」空态。 */
    emptyInventory,
  };
}
