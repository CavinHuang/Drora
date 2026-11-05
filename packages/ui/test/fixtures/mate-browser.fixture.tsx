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
import type { MateSidePaneTab } from "../../src/lib/workspaceSidePane.js";
import "../../src/styles.css";

/**
 * Mate 面板浏览器验收夹具（真实 React + 仓库 CSS；docs/mate-implementation-plan-2026-11-04/
 * 01-p1-detailed-design.md §6 场景 1/2/4）。服务为内存版 IAssistantTicketService 形状：
 * recordTrigger/approveDecision/onDidChange 全部内存实现 + 推送，不代表真实 Host/CLI。
 *
 * 与服务实现的语义对齐点（诚实标注）：
 * - approveDecision 置 decided_by=user（卡片脱离待决策集、releaseCount 积累）——与服务侧
 *   2026-11-05 修复后的真实语义一致（assistantTicketsService.ts approve 事务补写 decided_by，
 *   服务测试 assistantTicketsService.test.ts 已锁定）。
 * - 同 decision 二次放行幂等返回首次 ticketId（P1 验收场景 4；对应服务的 dispatchIndex）。
 * - 工单状态 dispatched→running→done 由夹具定时器推进（400ms/1400ms），usage/汇报为固定值。
 * - fixture-resync 重推当前快照，模拟断连重连后的 resync 推送（01 §6 场景 5 后半）；
 *   真实断连/重订链路不在本 renderer-only 夹具内。
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
}

function createMateFixtureService(onBrief?: (brief: string) => void) {
  let seq = 0;
  let mode: AssistantMode = ASSISTANT_MODES.observe;
  let allowlist: string[] = ["fixture/user-a"];
  let updatedAtMs = 1_000;
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
    }));
    return {
      version: 2,
      mode,
      allowlist: [...allowlist],
      budget: { maxActivePerWorkspace: 1 },
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
      });
      publish();
      return { ok: true, value: { triggerId, outcome } };
    },

    async approveDecision(input) {
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
      });
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

    async getConfig() {
      return {
        ok: true as const,
        value: { mode, allowlist: [...allowlist], budgetMaxActivePerWorkspace: 1, worktreeDisabled: false },
      };
    },

    async getSnapshot() {
      return buildSnapshot();
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
  return { service, buildSnapshot, approveDirect: service.approveDecision, resync: publish };
}

function Fixture() {
  const [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [lastBrief, setLastBrief] = useState("");
  const { service, approveDirect, resync } = useMemo(
    () => createMateFixtureService(setLastBrief),
    [],
  );
  // 夹具只需 accessor.assistantTicketService 一个字段（useAssistantTickets 判空降级的读点）。
  const accessor = useMemo(
    () => ({ assistantTicketService: service }) as IServiceAccessor,
    [service],
  );
  const handleApproveAgain = useCallback(async () => {
    // 场景 4：绕过 UI 直调服务（同 decisionId 二次放行），断言不二派。
    const decisionId = 2; // 场景顺序：TR-1=inferred，TR-2=explicit → 决策卡 id=2
    await approveDirect({ decisionId, permissionTier: ASSISTANT_PERMISSION_TIERS.build });
  }, [approveDirect]);
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
              <output data-testid="fixture-open-session">{openSession ?? ""}</output>
              <output data-testid="fixture-last-brief">{lastBrief}</output>
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
