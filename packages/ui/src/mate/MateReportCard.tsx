import { memo } from "react";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantTicketView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

/**
 * 汇报卡（01 §5 MateReportCard）：done=✅（success）+output_summary+实耗+[打开会话]；
 * failed=⚠（destructive）+fail_reason+[打开会话]。「打开会话」跳转由容器经挂载点
 * handleSelectTaskInChat 同位通道落到目标会话（照 useAppPanels handleOpenTeamSidePane
 * 的 workspace 解析同位先例；P1 派发目标恒为本 workspace，跳转随 tab 的 workspace 身份）。
 */
export const MateReportCard = memo(function MateReportCard({
  ticket,
  onOpenSession,
}: {
  ticket: AssistantTicketView;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const failed = ticket.status === ASSISTANT_TICKET_STATUSES.failed;
  const summary = failed ? ticket.failReason : ticket.outputSummary;
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
      {onOpenSession && ticket.sessionId ? (
        <Button
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => {
            if (ticket.sessionId) onOpenSession(ticket.sessionId);
          }}
          data-testid="mate-report-open-session"
        >
          {intl.formatMessage({ id: "mate.report.openSession" })}
        </Button>
      ) : null}
    </div>
  );
});
