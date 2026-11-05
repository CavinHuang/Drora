import { createRoot } from "react-dom/client";
import { useCallback, useMemo, useState } from "react";
import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import type { AssistantMode } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantRouterSuggestionView,
  AssistantSnapshot,
  AssistantTicketView,
  AssistantTriggerView,
  IAssistantTicketService,
  IServiceAccessor,
} from "@drora/services";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import { MateSidePane } from "../../src/app-shell/MateSidePane.js";
import { MateSessionLine } from "../../src/mate/session-line.js";
import { MatePetSync } from "../../src/root/MatePetSync.js";
import type { IPlatformService } from "@drora/shared";
import type { MateSidePaneTab } from "../../src/lib/workspaceSidePane.js";
import "../../src/styles.css";

/**
 * Mate 面板浏览器验收夹具（真实 React + 仓库 CSS；docs/mate-implementation-plan-2026-11-04/
 * 01-p1-detailed-design.md §6 场景 1/2/4 + 02 号 §1.4/§7 Surface A·C 场景）。服务为内存版
 * IAssistantTicketService 形状：recordTrigger/approveDecision/onDidChange 全部内存实现 +
 * 推送，不代表真实 Host/CLI。
 *
 * 与服务实现的语义对齐点（诚实标注）：
 * - approveDecision 置 decided_by=user（卡片脱离待决策集、releaseCount 积累）——与服务侧
 *   2026-11-05 修复后的真实语义一致（assistantTicketsService.ts approve 事务补写 decided_by，
 *   服务测试 assistantTicketsService.test.ts 已锁定）。
 * - 同 decision 二次放行幂等返回首次 ticketId（P1 验收场景 4；对应服务的 dispatchIndex）。
 * - 工单状态 dispatched→running→done 由夹具定时器推进（400ms/1400ms），usage/汇报为固定值。
 * - fixture-resync 重推当前快照，模拟断连重连后的 resync 推送（01 §6 场景 5 后半）；
 *   真实断连/重订链路不在本 renderer-only 夹具内。
 *
 * P2 Surface 批次扩展（mate-surface-ac.test.mjs 消费；P1 mate-observe-ui.test.mjs 场景
 * 保持兼容——新控件不点不触发）：
 * - fixture-inject-<kind> 按钮：直注入带 Router 建议（suggested dispatch/attach/failed/
 *   hold 四态）的决策卡——真实 Router 评估在 host 侧（services routerEvaluation），renderer
 *   夹具只验收 Surface 呈现与预填放行传参。
 * - fixture-queued-next 开关：下一次 approve 模拟软预算排队（返回 queued:true、工单
 *   queued+queuedReason、不推进终态）——真实排队判定在服务侧写域/预算检查。
 * - lastApproveInput 全量捕获（fixture-approve-input）：断言决策卡预填参
 *   （targetWorkspaceIdentity/attachToSessionId/dispatchMode）确实随放行发出。
 * - 建票字段按入参真实映射 dispatchMode A/B/C 与 decisionId/anchorCommandId；
 *   generationCount 由 fixture-rollover-next 开关模拟换代（真实换代是 host 代际事务）。
 *
 * P3 接缝批扩展（mate-source-pet.test.mjs 消费；P1/P2 场景保持兼容——新控件不点不触发）：
 * - 决策卡带 sourceKind（local/phone），手机点名决策卡渲染来源徽标；
 * - fixture-inject-phone：submitSourceEntry 带 channel_ref 建卡（真实 Source 事件面在
 *   host 侧 sources/，renderer 夹具按 ingestSourceEvent 同构语义模拟）；
 * - 放行回填 ticket.channel_ref（assistantSnapshot 同列）；fixture-phone-followup 同
 *   通道追加 → 直通（不建新 trigger/decision，anchor 序号推进），经 fixture-last-ingest
 *   读点断言。桌宠接缝发布/导航链路的平台面在 MatePetSync/useMatePetEvents + desktop
 *   matePetBridge 单测与 Electron 真机链路覆盖，不在本 renderer 夹具内。
 */

const tab: MateSidePaneTab = {
  id: "mate:fixture-ws",
  type: "mate",
  openedAt: 0,
  workspaceKey: "fixture-ws",
  workspacePath: "/fixture/ws",
  workspaceIdentity: "fixture/workspace",
};

interface FixtureDecision {
  id: number;
  triggerId: string;
  outcome: string;
  decidedBy: "gate" | "user";
  triggerText: string;
  decidedMs: number;
  sourceKind: string;
  routerState?: "pending" | "suggested" | "failed";
  routerSuggestion?: AssistantRouterSuggestionView;
  routerError?: string;
}

interface FixtureTicket {
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
}

/** approveDecision 入参捕获（Surface A 预填传参断言读点）。 */
export type FixtureApproveInput = Parameters<IAssistantTicketService["approveDecision"]>[0];

function createMateFixtureService(
  onBrief?: (brief: string) => void,
  onApproveInput?: (input: FixtureApproveInput) => void,
) {
  let seq = 0;
  let mode: AssistantMode = ASSISTANT_MODES.observe;
  let allowlist: string[] = ["fixture/user-a"];
  let updatedAtMs = 1_000;
  let lastApproveInput: FixtureApproveInput | null = null;
  // P2 软预算默认回 3（contracts ASSISTANT_DEFAULTS；P1 fixture 曾用 1）。
  let budgetMax = 3;
  // W1 worktree 用户开关（P2 审查修复补交互入口；setWorktreeDisabled 唯一写路径）。
  let worktreeDisabled = false;
  let queueNextApprove = false;
  let rolloverNextApprove = false;
  // P3 接缝批：手机入口 ingest 结果读点（direct:<ticketId>:<text> / gate:<triggerId>:<outcome>）。
  let lastIngest = "";
  // P4 配额中心内存版（IAssistantTicketService 形状补齐；判定语义与服务 admitDisturbance
  // 同构简化：decision 永不抑制仍计数、report/bubble 超配额聚合当日 digest）。
  const quotaDay = { date: "", decision: 0, report: 0, bubble: 0, digest: [] as string[], digestDelivered: false };
  let dailyQuota = 5;
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
    const ticketViews: AssistantTicketView[] = tickets.map((ticket) => ({
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
    }));
    const decisionViews: AssistantDecisionView[] = decisions.map((decision) => ({
      id: decision.id,
      triggerId: decision.triggerId,
      strength: ASSISTANT_STRENGTHS.explicit,
      mode: ASSISTANT_MODES.observe,
      outcome: decision.outcome,
      decidedBy: decision.decidedBy,
      decidedMs: decision.decidedMs,
      triggerText: decision.triggerText,
      sourceKind: decision.sourceKind,
      ...(decision.routerState ? { routerState: decision.routerState } : {}),
      ...(decision.routerSuggestion ? { routerSuggestion: decision.routerSuggestion } : {}),
      ...(decision.routerError ? { routerError: decision.routerError } : {}),
    }));
    return {
      version: 2,
      mode,
      allowlist: [...allowlist],
      budget: { maxActivePerWorkspace: budgetMax },
      worktreeDisabled,
      trust: {
        wouldAcceptCount: decisions.filter(
          (item) => item.outcome === ASSISTANT_OUTCOMES.wouldAccept,
        ).length,
        releaseCount: decisions.filter(
          (item) => item.outcome === ASSISTANT_OUTCOMES.decisionCard && item.decidedBy === "user",
        ).length,
      },
      triggers: [...triggers],
      decisions: decisionViews,
      tickets: ticketViews,
      quota: (() => {
        const today = new Date().toISOString().slice(0, 10);
        if (quotaDay.date !== today) {
          quotaDay.date = today;
          quotaDay.decision = 0;
          quotaDay.report = 0;
          quotaDay.bubble = 0;
          quotaDay.digest = [];
        }
        const total = quotaDay.decision + quotaDay.report + quotaDay.bubble;
        return {
          date: quotaDay.date,
          quota: dailyQuota,
          used: { decision: quotaDay.decision, report: quotaDay.report, bubble: quotaDay.bubble },
          total,
          remaining: Math.max(0, dailyQuota - total),
          pendingDigest: quotaDay.digestDelivered ? [] : [{ date: quotaDay.date, items: [...quotaDay.digest] }],
        };
      })(),
      watchdogNotices: [],
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
      ticket.status = ASSISTANT_TICKET_STATUSES.done;
      ticket.usage = { inputTokens: 128, outputTokens: 456 };
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
          status: ASSISTANT_TICKET_STATUSES.queued,
          targetWorkspaceIdentity: input.targetWorkspaceIdentity ?? tab.workspaceIdentity ?? "",
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
        status: ASSISTANT_TICKET_STATUSES.dispatched,
        targetWorkspaceIdentity: input.targetWorkspaceIdentity ?? tab.workspaceIdentity ?? "",
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

    async stopMandate() {
      return { ok: true, value: { ok: true } };
    },

    async revokeMandate() {
      return { ok: true, value: { ok: true } };
    },

    async setMode(next) {
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

    async getConfig() {
      return {
        ok: true as const,
        value: {
          mode,
          allowlist: [...allowlist],
          budgetMaxActivePerWorkspace: budgetMax,
          worktreeDisabled: false,
        },
      };
    },

    async getSnapshot() {
      return buildSnapshot();
    },

    async admitDisturbance(input) {
      const today = new Date().toISOString().slice(0, 10);
      if (quotaDay.date !== today) {
        quotaDay.date = today;
        quotaDay.decision = 0;
        quotaDay.report = 0;
        quotaDay.bubble = 0;
        quotaDay.digest = [];
        quotaDay.digestDelivered = false;
      }
      quotaDay[input.kind] += 1;
      const total = quotaDay.decision + quotaDay.report + quotaDay.bubble;
      const aggregated = input.kind !== "decision" && total > dailyQuota;
      if (aggregated && input.summary) {
        quotaDay.digest.push(input.summary.slice(0, 200));
      }
      publish();
      return {
        ok: true as const,
        value: {
          allowed: !aggregated,
          date: today,
          used: total,
          quota: dailyQuota,
          aggregated,
        },
      };
    },

    async getDisturbanceQuota() {
      const snapshot = buildSnapshot();
      return { ok: true as const, value: snapshot.quota! };
    },

    async markDailyDigestDelivered() {
      quotaDay.digestDelivered = true;
      publish();
      return { ok: true as const, value: { ok: true as const } };
    },

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
    submitSource: service.submitSourceEntry,
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
  };
}

function Fixture() {
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [lastBrief, setLastBrief] = useState("");
  const [lastApprove, setLastApprove] = useState("");
  const [lastIngest, setLastIngest] = useState("");
  // P3 桌宠接缝发布方验收：捕获 MatePetSync 经 platform.publishMatePet 发布的最新投影
  // （真实 Main 转发/宠物窗渲染在 desktop matePetBridge/tray DOM 单测与真机链路覆盖）。
  const [lastProjection, setLastProjection] = useState("");
  const {
    service,
    approveDirect,
    resync,
    injectRouterDecision,
    submitSource,
    lastIngest: readLastIngest,
    queueNext,
    rolloverNext,
  } = useMemo(
    () =>
      createMateFixtureService(setLastBrief, (input) =>
        setLastApprove(
          `mode=${input.dispatchMode ?? "-"} attach=${input.attachToSessionId ?? "-"} target=${
            input.targetWorkspaceIdentity ?? "-"
          } tier=${input.permissionTier ?? "-"}`,
        ),
      ),
    [],
  );
  // 夹具只需 accessor.assistantTicketService 一个字段（useAssistantTickets 判空降级的读点）。
  const accessor = useMemo(
    () => ({ assistantTicketService: service }) as IServiceAccessor,
    [service],
  );
  const petPlatform = useMemo(
    () =>
      ({
        publishMatePet: (projection: unknown) => setLastProjection(JSON.stringify(projection)),
      }) as unknown as IPlatformService,
    [],
  );
  const handleApproveAgain = useCallback(async () => {
    // 场景 4：绕过 UI 直调服务（同 decisionId 二次放行），断言不二派。
    const decisionId = 2; // 场景顺序：TR-1=inferred，TR-2=explicit → 决策卡 id=2
    await approveDirect({ decisionId, permissionTier: ASSISTANT_PERMISSION_TIERS.build });
  }, [approveDirect]);
  // P3 接缝批验收控件：手机点名入口（带通道绑定）→ 决策卡（phone 徽标）→ 放行回填
  // channel_ref → 同通道追加消息直通（不建新卡）。
  const handlePhoneNamed = useCallback(() => {
    void submitSource({
      text: "手机点名：看下移动端白屏",
      mention: true,
      remoteSessionId: "rs-phone-1",
      channelRef: "phone:session:rs-phone-1",
      targetWorkspaceIdentity: tab.workspaceIdentity ?? undefined,
    }).then(() => setLastIngest(readLastIngest()));
  }, [readLastIngest, submitSource]);
  const handlePhoneFollowUp = useCallback(() => {
    void submitSource({
      text: "补充：横屏复现",
      mention: true,
      channelRef: "phone:session:rs-phone-1",
    }).then(() => setLastIngest(readLastIngest()));
  }, [readLastIngest, submitSource]);
  return (
    // TooltipProvider 照 Root.tsx 根层共享一次：MateConfigSection 的 auto 禁用钮经
    // ControlHintTooltip 消费 Radix 上下文，缺 Provider 会整树抛错（PR-1B 审查发现 1）。
    <DroraIntlProvider key={locale} initialLocale={locale}>
      <TooltipProvider>
        <ServiceProvider services={accessor}>
          <div className="bg-background text-foreground">
            <div className="fixture-controls flex flex-wrap gap-2 p-3 text-ui-base">
              <button data-testid="fixture-approve-again" onClick={() => void handleApproveAgain()}>
                Approve again (idempotency)
              </button>
              {/* 01 §6 场景 5 后半：重推快照模拟断连重连后的 resync（推送一致，UI 状态不变）。 */}
              <button data-testid="fixture-resync" onClick={resync}>
                Resync snapshot
              </button>
              <button
                data-testid="fixture-locale"
                onClick={() => setLocale((value) => (value === "zh-CN" ? "en-US" : "zh-CN"))}
              >
                Language
              </button>
              {/* P2 Surface 批次：注入带 Router 建议的决策卡（呈现+预填传参验收）。 */}
              <button
                data-testid="fixture-inject-dispatch"
                onClick={() =>
                  injectRouterDecision("suggested", {
                    kind: "dispatch",
                    targetWorkspaceIdentity: "fixture/workspace-b",
                    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
                    briefBase: "verbatim",
                    reason: "请求未指名既有会话，建议新开独立工单",
                    evidence: ["原文提到『修一下构建』", "名单内 workspace-b 空闲"],
                  })
                }
              >
                Inject dispatch suggestion
              </button>
              <button
                data-testid="fixture-inject-attach"
                onClick={() =>
                  injectRouterDecision("suggested", {
                    kind: "attach",
                    sessionId: "sess-attach-9",
                    targetWorkspaceIdentity: "fixture/workspace",
                    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
                    briefBase: "verbatim",
                    reason: "原文提到沿用登录页会话上下文",
                    evidence: ["原文提到『接着上次那个会话』"],
                  })
                }
              >
                Inject attach suggestion
              </button>
              <button
                data-testid="fixture-inject-failed"
                onClick={() => injectRouterDecision("failed")}
              >
                Inject failed router
              </button>
              <button data-testid="fixture-queue-next" onClick={queueNext}>
                Queue next approve
              </button>
              <button data-testid="fixture-rollover-next" onClick={rolloverNext}>
                Rollover next approve
              </button>
              {/* P3 接缝批：手机 Source 入口（phone 徽标决策卡 + channel_ref 直通）。 */}
              <button data-testid="fixture-inject-phone" onClick={handlePhoneNamed}>
                Inject phone named trigger
              </button>
              <button data-testid="fixture-phone-followup" onClick={handlePhoneFollowUp}>
                Phone follow-up (direct-through)
              </button>
              {/* MateSessionLine 两态演示（任务行徽标组件级验收；真实挂接在任务行列表）。 */}
              <div
                className="w-full"
                data-testid="fixture-session-line-with"
                data-active-count="2"
                data-pending="3"
              >
                <MateSessionLine
                  activity={{ activeCount: 2, pendingDecisions: 3, updatedAtMs: 1 }}
                />
              </div>
              <div className="w-full" data-testid="fixture-session-line-absent">
                <MateSessionLine activity={undefined} />
              </div>
              {/* P3 桌宠接缝：发布方组件（窗口 Host services 作用域同构）+ 投影读点。 */}
              <div className="w-full" data-testid="fixture-mate-pet-sync">
                <MatePetSync platform={petPlatform} />
              </div>
              <output data-testid="fixture-open-session">{openSession ?? ""}</output>
              <output data-testid="fixture-last-brief">{lastBrief}</output>
              <output data-testid="fixture-approve-input">{lastApprove}</output>
              <output data-testid="fixture-last-ingest">{lastIngest}</output>
              <output data-testid="fixture-mate-pet-projection">{lastProjection}</output>
            </div>
            <div className="mx-auto" style={{ width: 480, height: 780 }}>
              <MateSidePane
                tab={tab}
                focused
                onOpenMateSession={({ sessionId }) => setOpenSession(sessionId)}
              />
            </div>
          </div>
        </ServiceProvider>
      </TooltipProvider>
    </DroraIntlProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
