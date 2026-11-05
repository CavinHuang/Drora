import { memo, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import type { AssistantSnapshot, AssistantTicketView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";

import { MateLamp } from "./MateLamp.js";
import { mateTicketLampTone } from "./statusTone.js";
import {
  findMateDecisionForTicket,
  mateTicketGenerationNumber,
  mateRouterSuggestionKindMessageId,
} from "./view-model.js";

/**
 * 工单详情二级视图（02 详设 §7 Surface C：返回按钮+四页签 时间线/汇报/证据/成本）。
 *
 * 全部内容是快照投影（specs §11「所有面是 TicketService 快照的投影」），事实裁剪诚实
 * 标注（与 spec §11.3 落地注记一致）：
 * - 时间线=代际站：queued 站（queuedReason）→ 派发站（dispatchMode+sessionId）→ 锚站
 *   （anchorCommandId 或「尚未投递」）→ 当前代站（第 generationCount+1 代，强强调）。
 *   轨/站用 mate scope token（--color-mate-trace 族，DESIGN.md 已登记；不挪用 workflow
 *   家族）；站状态语义仍用共享状态色（灯=mateTicketLampTone）。
 * - 汇报页=output_summary/fail_reason；无汇报显示「尚无汇报」。
 * - 证据页=决策卡关联（快照 v2 ticket.decisionId→decisions[].id）：trigger verbatim+
 *   Router 建议 reason/evidence；无关联（手动建票或卡被快照容量裁剪）→ brief 原文
 *   诚实降级（不猜触发文本）。
 * - 成本页=usage input/output 合计+「按代分解随 P4」说明（快照只有 usage_accum 合计，
 *   不伪造逐代数据；specs §8 换代不换账）。
 *
 * 页签选择是纯视图态（本组件 useState，不入 mateStore——store 三件局部态契约不变）。
 */
type MateDetailTab = "timeline" | "report" | "evidence" | "cost";

const MATE_DETAIL_TABS: ReadonlyArray<{ id: MateDetailTab; messageId: string; testid: string }> = [
  { id: "timeline", messageId: "mate.detail.tab.timeline", testid: "mate-detail-tab-timeline" },
  { id: "report", messageId: "mate.detail.tab.report", testid: "mate-detail-tab-report" },
  { id: "evidence", messageId: "mate.detail.tab.evidence", testid: "mate-detail-tab-evidence" },
  { id: "cost", messageId: "mate.detail.tab.cost", testid: "mate-detail-tab-cost" },
];

export const MateTicketDetail = memo(function MateTicketDetail({
  snap,
  ticket,
  onBack,
  onOpenSession,
}: {
  snap: AssistantSnapshot;
  ticket: AssistantTicketView;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const [tab, setTab] = useState<MateDetailTab>("timeline");
  const generation = mateTicketGenerationNumber(ticket);
  const linkedDecision = findMateDecisionForTicket(snap, ticket);
  const suggestion = linkedDecision?.routerSuggestion;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mate-ticket-detail">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={onBack}
          data-testid="mate-detail-back"
          aria-label={intl.formatMessage({ id: "mate.detail.back" })}
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          <span className="ml-1">{intl.formatMessage({ id: "mate.detail.back" })}</span>
        </Button>
        <span className="truncate text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.detail.title" })}
        </span>
        <MateLamp tone={mateTicketLampTone(ticket.status)} />
        <span className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtle">
          {ticket.id}
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/50 px-3 py-1.5"
        role="tablist"
      >
        {MATE_DETAIL_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-testid={item.testid}
            onClick={() => setTab(item.id)}
            className={cn(
              // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
              "h-7 rounded-lg px-2 text-ui-sm transition-colors",
              tab === item.id
                ? "bg-selected font-medium text-foreground"
                : "text-foreground-subtle hover:bg-hover hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: item.messageId })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === "timeline" ? (
          <MateTimelineStations ticket={ticket} generation={generation} />
        ) : null}
        {tab === "report" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-report">
            {ticket.outputSummary ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.report.output" })}
                </p>
                <p className="whitespace-pre-wrap break-words text-ui-sm text-foreground">
                  {ticket.outputSummary}
                </p>
              </>
            ) : null}
            {ticket.failReason ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.report.failedReason" })}
                </p>
                <p className="whitespace-pre-wrap break-words text-ui-sm text-destructive">
                  {ticket.failReason}
                </p>
              </>
            ) : null}
            {!ticket.outputSummary && !ticket.failReason ? (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "mate.detail.report.none" })}
              </p>
            ) : null}
            {onOpenSession && ticket.sessionId ? (
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => {
                  if (ticket.sessionId) onOpenSession(ticket.sessionId);
                }}
                data-testid="mate-detail-report-open-session"
              >
                {intl.formatMessage({ id: "mate.report.openSession" })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {tab === "evidence" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-evidence">
            {linkedDecision ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.evidence.trigger" })}
                </p>
                <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-surface px-2.5 py-2 text-ui-sm text-foreground">
                  {linkedDecision.triggerText}
                </blockquote>
                {suggestion ? (
                  <>
                    <p className="mt-1 text-ui-sm font-medium text-foreground">
                      {intl.formatMessage({
                        id: mateRouterSuggestionKindMessageId(suggestion.kind),
                      })}
                    </p>
                    {suggestion.reason ? (
                      <p className="break-words text-ui-xs text-foreground-subtle">
                        {intl.formatMessage({ id: "mate.router.reason" })}：{suggestion.reason}
                      </p>
                    ) : null}
                    {suggestion.evidence.map((quote, index) => (
                      <blockquote
                        key={index}
                        className="break-words border-l-2 border-border pl-2 text-ui-xs text-foreground-subtle"
                      >
                        {quote}
                      </blockquote>
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-ui-xs text-foreground-subtle" role="status">
                  {intl.formatMessage({ id: "mate.detail.evidence.none" })}
                </p>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.evidence.brief" })}
                </p>
                <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-surface px-2.5 py-2 text-ui-sm text-foreground">
                  {ticket.brief}
                </blockquote>
              </>
            )}
          </div>
        ) : null}
        {tab === "cost" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-cost">
            <p className="font-mono text-ui-sm text-foreground">
              {intl.formatMessage(
                { id: "mate.report.cost" },
                { input: ticket.usage.inputTokens, output: ticket.usage.outputTokens },
              )}
            </p>
            <p className="text-ui-xs text-foreground-subtle" role="note">
              {intl.formatMessage({ id: "mate.detail.cost.perGeneration" })}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * 代际站时间线（mate scope token，DESIGN.md「Mate ticket timeline colors」）：轨段分两档
 * ——通向当前代站的活跃段=--color-mate-trace，其余空闲段=--color-mate-rule
 * （sub-hairline repeated furniture，弱于 --color-border；P2 审查修复：rule token 四主题
 * 已定义且登记 DESIGN.md 却零消费，按登记语义补齐）；当前代站圆点与描边=
 * --color-mate-trace-strong；站内文案层不编码状态色（状态语义只在头部灯）。
 */
function MateTimelineStations({
  ticket,
  generation,
}: {
  ticket: AssistantTicketView;
  generation: number;
}) {
  const { intl } = useDroraIntl();
  const stations: Array<{ key: string; label: string; detail?: string; current?: boolean }> = [];
  if (ticket.queuedReason) {
    stations.push({
      key: "queued",
      label: intl.formatMessage({ id: "mate.detail.timeline.queued" }),
      detail: ticket.queuedReason,
    });
  }
  if (ticket.dispatchMode) {
    stations.push({
      key: "dispatch",
      label: intl.formatMessage(
        { id: "mate.detail.timeline.dispatch" },
        { mode: ticket.dispatchMode },
      ),
      ...(ticket.sessionId
        ? {
            detail: intl.formatMessage(
              { id: "mate.router.session" },
              { sessionId: ticket.sessionId },
            ),
          }
        : {}),
    });
  }
  stations.push({
    key: "anchor",
    label: intl.formatMessage({ id: "mate.detail.timeline.anchor" }),
    detail: ticket.anchorCommandId
      ? ticket.anchorCommandId
      : intl.formatMessage({ id: "mate.detail.timeline.anchorNone" }),
  });
  stations.push({
    key: "current",
    label: intl.formatMessage({ id: "mate.detail.timeline.current" }, { gen: generation }),
    current: true,
  });

  return (
    <ol className="flex flex-col" data-testid="mate-detail-timeline">
      {stations.map((station, index) => {
        const isLast = index === stations.length - 1;
        return (
          <li
            key={station.key}
            className="relative flex gap-3 pb-4"
            data-testid={`mate-timeline-station-${station.key}`}
          >
            {!isLast ? (
              <span
                aria-hidden
                className="absolute left-[5px] top-4 bottom-0 w-px"
                style={{
                  // 轨段两档（DESIGN.md）：通向当前代站=trace 活跃段，其余=rule 空闲段。
                  backgroundColor: stations[index + 1]?.current
                    ? "var(--color-mate-trace)"
                    : "var(--color-mate-rule)",
                }}
              />
            ) : null}
            <span
              aria-hidden
              className="relative mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: station.current
                  ? "var(--color-mate-trace-strong)"
                  : "var(--color-background)",
                border: `1.5px solid ${station.current ? "var(--color-mate-trace-strong)" : "var(--color-mate-trace)"}`,
              }}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-ui-sm",
                  station.current ? "font-medium text-foreground" : "text-foreground-subtle",
                )}
              >
                {station.label}
              </p>
              {station.detail ? (
                <p className="mt-0.5 break-words font-mono text-ui-xs text-foreground-subtlest">
                  {station.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
