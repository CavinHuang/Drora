import { HistoryIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTeamHistory, type TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { teamActor } from "./presentation.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelModel } from "./view-model.js";

export function TeamProcessPanel({
  model,
  connection,
  onSelect,
}: {
  model: TeamPanelModel;
  connection?: TeamHistoryConnection;
  onSelect: (focus: TeamUiFocus) => void;
}) {
  const { intl } = useDroraIntl(),
    history = useTeamHistory(model.teamId, connection);
  const lead = intl.formatMessage({ id: "team.ui.lead" });
  return (
    <section
      data-testid="team-process"
      aria-label={intl.formatMessage({ id: "team.ui.savedProcess" })}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-ui-sm">
          <HistoryIcon className="size-3.5" />
          {intl.formatMessage({ id: "team.ui.savedProcess" })}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pointer-coarse:min-h-11"
          onClick={history.latest}
          disabled={history.loading}
        >
          <RefreshCwIcon className="size-3" />
          {intl.formatMessage({ id: "team.ui.latest" })}
        </Button>
      </div>
      {history.loading ? (
        <p role="status" className="py-5 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.ui.historyLoading" })}
        </p>
      ) : history.error ? (
        <div
          role="status"
          data-testid="team-history-error"
          className="rounded-lg border border-border p-3 text-ui-sm"
        >
          <p>{intl.formatMessage({ id: "team.ui.historyUnavailable" })}</p>
          {connection ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 pointer-coarse:min-h-11"
              onClick={history.retry}
            >
              {intl.formatMessage({ id: "team.ui.retry" })}
            </Button>
          ) : null}
        </div>
      ) : history.data ? (
        <>
          {history.older ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-3 pointer-coarse:min-h-11"
              onClick={history.older}
              data-testid="team-history-older"
            >
              {intl.formatMessage({ id: "team.ui.older" })}
            </Button>
          ) : null}
          {!history.data.events.length ? (
            <p className="py-6 text-ui-sm text-foreground-subtle" data-testid="team-history-empty">
              {intl.formatMessage({ id: "team.ui.historyEmpty" })}
            </p>
          ) : null}
          <ol
            className="flex flex-col gap-3"
            aria-label={intl.formatMessage({ id: "team.ui.process" })}
          >
            {history.data.events.map((entry) => (
              <li
                key={entry.seq}
                className="border-l border-workflow-trace pl-3"
                data-testid="team-history-entry"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-ui-sm text-foreground-subtle">
                  <span className="font-mono">#{entry.seq}</span>
                  <time dateTime={entry.at}>{entry.at}</time>
                </div>
                <details className="mt-1 text-ui-caption">
                  <summary className="break-words rounded-md py-1 focus-visible:ring-2 focus-visible:ring-ring">
                    {intl.formatMessage({ id: `team.history.kind.${entry.kind}` })}
                    {entry.title ? ` · ${entry.title}` : ""}
                    {entry.from && entry.to
                      ? ` · ${teamActor(model, entry.from, lead)} → ${teamActor(model, entry.to, lead)}`
                      : ""}
                    {entry.memberName ? ` · ${entry.memberName}` : ""}
                  </summary>
                  {entry.message !== undefined ? (
                    <p className="mt-2 break-words whitespace-pre-wrap rounded-lg bg-surface p-2 text-ui-sm">
                      {entry.message}
                    </p>
                  ) : null}
                  {entry.delivered !== undefined ? (
                    <p className="mt-2 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({
                        id: entry.delivered ? "team.ui.delivered" : "team.ui.queued",
                      })}
                    </p>
                  ) : null}
                  {entry.reason ? (
                    <p className="mt-2 break-words text-ui-sm">{entry.reason}</p>
                  ) : null}
                  {entry.taskStatus ? (
                    <p className="mt-2 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: `team.task.status.${entry.taskStatus}` })}
                      {entry.assignee ? ` · ${teamActor(model, entry.assignee, lead)}` : ""}
                    </p>
                  ) : null}
                  {entry.sourceAttemptId ? (
                    <p className="mt-2 break-all font-mono text-ui-sm text-foreground-subtle">
                      {entry.sourceAttemptId}
                    </p>
                  ) : null}
                  {entry.messageIds?.length ? (
                    <p className="mt-2 break-all font-mono text-ui-sm text-foreground-subtle">
                      {entry.messageIds.join(" · ")}
                    </p>
                  ) : null}
                </details>
                {entry.taskId || entry.sourceTaskId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-1 pointer-coarse:min-h-11"
                    onClick={() =>
                      onSelect({
                        teamId: model.teamId,
                        kind: "task",
                        id: (entry.taskId ?? entry.sourceTaskId)!,
                      })
                    }
                  >
                    {intl.formatMessage({ id: "team.ui.currentTask" })} ·{" "}
                    {entry.taskId ?? entry.sourceTaskId}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          <p
            className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-ui-sm text-foreground-subtle"
            data-testid="team-history-range"
          >
            <SaveIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {intl.formatMessage({ id: "team.ui.historyRange" }, { seq: history.data.throughSeq })}
              {history.data.savedAt ? (
                <time className="mt-1 block" dateTime={history.data.savedAt}>
                  {history.data.savedAt}
                </time>
              ) : null}
            </span>
          </p>
          {history.data.skippedEntries ? (
            <p className="mt-2 text-ui-sm text-warning">
              {intl.formatMessage(
                { id: "team.ui.historySkipped" },
                { count: history.data.skippedEntries },
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
