import { memo, useState } from "react";
import { CircleCheckIcon, TriangleAlertIcon, HourglassIcon } from "lucide-react";
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantResult, AssistantTicketView, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { Button } from "@/components/ui/button.js";

import { resolveMateErrorMessageId } from "./view-model.js";
import { mateTicketGenerationNumber, mateStaleBadgeKind, mateUnconfirmedIncrement } from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

/**
 * 汇报卡（01 §5 MateReportCard + P2 徽标批 + P4 第二棒完整版，04 详设 §3）：
 * - done=✅（success）+output_summary+实耗+[打开会话][详情]；failed=⚠（destructive）+
 *   fail_reason+同钮；**awaiting_output=⏳（核验滞留面）**+滞留时长+[人工确认交付][详情]
 *   ——只读核验未通过/不可校验的滞留工单，人工确认走 confirmTicketOutput（awaiting→done+
 *   终态钩子），确认成功由快照推送收敛（卡随状态切 done 面）。
 * - **未确认增量行（常驻）**：换代工单（generationCount>0）且 incrementsConfirmedMs 缺席
 *   时显示「第 N 代重启，第 N-1 代末尾改动未确认」横幅（spec §2.4 措辞同源）+「确认增量」
 *   按钮（confirmTicketIncrements 置列后横幅出清；不回写 brief）。
 * - **stale 停滞徽标**：staleSinceMs 有值时出「运行停滞/核验滞留」徽标（watchdog 判据
 *   投影，mateStaleBadgeKind 封闭映射）。
 * queued 不进汇报卡（容器按 status 路由：queued=工单行排队灯档；done/failed/awaiting=本卡）。
 * 「打开会话」跳转由容器经挂载点 handleSelectTaskInChat 同位通道落到目标会话。
 */
export const MateReportCard = memo(function MateReportCard({
  ticket,
  service,
  workspaceKey,
  onOpenSession,
  onOpenDetail,
}: {
  ticket: AssistantTicketView;
  /** 服务动作入口（核验/增量确认经 mateStore single-flight；04 详设 §3）。 */
  service: IAssistantTicketService;
  /** workspace 分域键（mateStore 动作隔离）。 */
  workspaceKey: string;
  onOpenSession?: (sessionId: string) => void;
  /** Surface C 下钻入口（P2：容器接 mateStore.selectTicket；缺席不渲染钮）。 */
  onOpenDetail?: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const confirmOutput = useMateStore((state) => state.confirmTicketOutput);
  const confirmIncrements = useMateStore((state) => state.confirmTicketIncrements);
  const [failure, setFailure] = useState<string | null>(null);
  const awaiting = ticket.status === ASSISTANT_TICKET_STATUSES.awaitingOutput;
  const failed = ticket.status === ASSISTANT_TICKET_STATUSES.failed;
  const summary = failed ? ticket.failReason : ticket.outputSummary;
  const generationCount = ticket.generationCount ?? 0;
  const increment = mateUnconfirmedIncrement(ticket);
  const staleKind = mateStaleBadgeKind(ticket);
  const testId = awaiting
    ? "mate-report-awaiting"
    : failed
      ? "mate-report-failed"
      : "mate-report-done";

  const runAction = (pending: Promise<AssistantResult<unknown>>): void => {
    setFailure(null);
    pending
      .then((result) => {
        // 成功由快照推送收敛（状态/确认列变化即反馈）；失败臂出 role=alert。
        if (!result.ok) setFailure(resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
  };

  return (
    <div className="rounded-lg border border-card-border bg-card p-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        {awaiting ? (
          <HourglassIcon aria-hidden className="size-4 shrink-0 text-warning" />
        ) : failed ? (
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" />
        ) : (
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
        )}
        <span className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({
            id: awaiting ? "mate.report.awaiting" : failed ? "mate.report.failed" : "mate.report.done",
          })}
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
        {staleKind ? (
          <span
            className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            data-testid="mate-report-stale"
          >
            {intl.formatMessage({ id: `mate.watchdog.kind.${staleKind}` })}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest">
          {intl.formatMessage(
            { id: "mate.report.cost" },
            { input: ticket.usage.inputTokens, output: ticket.usage.outputTokens },
          )}
        </span>
      </div>
      {awaiting ? (
        <p
          className="mt-1.5 break-words text-ui-sm text-foreground-subtle"
          data-testid="mate-report-awaiting-since"
        >
          {intl.formatMessage(
            { id: "mate.report.awaiting.since" },
            { since: formatTaskRelativeTime(ticket.awaitingSinceMs ?? ticket.updatedAtMs, intl) },
          )}
        </p>
      ) : null}
      {summary ? (
        <p
          className="mt-1.5 break-words text-ui-sm text-foreground-subtle"
          data-testid="mate-report-summary"
        >
          {summary}
        </p>
      ) : null}
      {increment ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-surface px-2 py-1.5"
          data-testid="mate-report-increment"
        >
          <span className="min-w-0 flex-1 break-words text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "mate.report.increment" }, increment)}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => runAction(confirmIncrements(service, workspaceKey, { ticketId: ticket.id }))}
            data-testid="mate-report-increment-confirm"
          >
            {intl.formatMessage({ id: "mate.report.increment.confirm" })}
          </Button>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {awaiting ? (
          <Button
            size="xs"
            onClick={() => runAction(confirmOutput(service, workspaceKey, { ticketId: ticket.id }))}
            data-testid="mate-report-confirm-output"
          >
            {intl.formatMessage({ id: "mate.report.confirmOutput" })}
          </Button>
        ) : null}
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
      {failure !== null ? (
        <p role="alert" className="mt-1.5 text-ui-sm text-destructive" data-testid="mate-report-error">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});
