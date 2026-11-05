import { memo } from "react";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantTicketView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

import { mateTicketGenerationNumber } from "./view-model.js";

/**
 * 汇报卡（01 §5 MateReportCard + P2 徽标批）：done=✅（success）+output_summary+实耗+
 * [打开会话][详情]；failed=⚠（destructive）+fail_reason+同钮。queued 不进汇报卡
 * （容器按 status 路由：queued=工单行排队灯档；done/failed=本卡）。
 *
 * P2：①代际徽标（generationCount>0 时「第 N 代」，mateTicketGenerationNumber 与工单行
 * 同口径——specs §8 换代不换账，成本页在详情四页签）；②[详情] 进入 Surface C 下钻
 * （onOpenDetail 由容器接 mateStore.selectTicket；缺席=渠道无详情视图，钮不渲染）。
 * 「打开会话」跳转由容器经挂载点 handleSelectTaskInChat 同位通道落到目标会话。
 */
export const MateReportCard = memo(function MateReportCard({
  ticket,
  onOpenSession,
  onOpenDetail,
}: {
  ticket: AssistantTicketView;
  onOpenSession?: (sessionId: string) => void;
  /** Surface C 下钻入口（P2：容器接 mateStore.selectTicket；缺席不渲染钮）。 */
  onOpenDetail?: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const failed = ticket.status === ASSISTANT_TICKET_STATUSES.failed;
  const summary = failed ? ticket.failReason : ticket.outputSummary;
  const generationCount = ticket.generationCount ?? 0;
  return (
    <div
      className="rounded-lg border border-card-border bg-card p-3"
      data-testid={failed ? "mate-report-failed" : "mate-report-done"}
    >
      <div className="flex items-center gap-2">
        {failed ? (
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
        ) : (
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
        )}
        <span className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: failed ? "mate.report.failed" : "mate.report.done" })}
        </span>
        {generationCount > 0 ? (
          <span
            className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
            data-testid="mate-report-generation"
          >
            {intl.formatMessage(
              { id: "mate.ticket.generation" },
              { gen: mateTicketGenerationNumber(ticket) },
            )}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest">
          {intl.formatMessage(
            { id: "mate.report.cost" },
            { input: ticket.usage.inputTokens, output: ticket.usage.outputTokens },
          )}
        </span>
      </div>
      {summary ? (
        <p
          className="mt-1.5 break-words text-ui-sm text-foreground-subtle"
          data-testid="mate-report-summary"
        >
          {summary}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onOpenSession && ticket.sessionId ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              if (ticket.sessionId) onOpenSession(ticket.sessionId);
            }}
            data-testid="mate-report-open-session"
          >
            {intl.formatMessage({ id: "mate.report.openSession" })}
          </Button>
        ) : null}
        {onOpenDetail ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onOpenDetail(ticket.id)}
            data-testid="mate-report-detail"
          >
            {intl.formatMessage({ id: "mate.detail.title" })}
          </Button>
        ) : null}
      </div>
    </div>
  );
});
