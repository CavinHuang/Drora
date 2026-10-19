import { ArrowRightLeftIcon, ArrowUpRightIcon } from "lucide-react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { teamActor, teamMemberFor } from "./presentation.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelModel } from "./view-model.js";

export function TeamRecentMessages({
  model,
  onSelect,
}: {
  model: TeamPanelModel;
  onSelect: (focus: TeamUiFocus) => void;
}) {
  const { intl } = useDroraIntl();
  const lead = intl.formatMessage({ id: "team.ui.lead" });
  if (model.status === "staged" || !model.mailboxTail.length) return null;
  return (
    <section className="mt-4 border-t border-border pt-3" data-testid="team-recent-messages">
      <div className="mb-3 flex items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
        <span>{intl.formatMessage({ id: "team.ui.recentProcess" })}</span>
        <button
          type="button"
          className="rounded-md px-1 py-1 hover:bg-hover pointer-coarse:min-h-11"
          onClick={() => onSelect({ teamId: model.teamId, kind: "process" })}
        >
          {intl.formatMessage({ id: "team.ui.process" })}{" "}
          <ArrowUpRightIcon className="inline size-3" />
        </button>
      </div>
      <ol className="flex flex-col gap-3">
        {model.mailboxTail.slice(-3).map((message) => {
          const sender = teamMemberFor(model, message.from);
          return (
            <li key={message.messageId} className="border-l border-workflow-trace pl-3 text-ui-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                {sender ? (
                  <button
                    type="button"
                    className="rounded-md hover:bg-hover pointer-coarse:min-h-11"
                    onClick={() =>
                      onSelect({ teamId: model.teamId, kind: "member", id: sender.agentId })
                    }
                  >
                    {sender.memberName}
                  </button>
                ) : (
                  <span>{teamActor(model, message.from, lead)}</span>
                )}
                <span className="text-foreground-subtlest">→</span>
                <span>{teamActor(model, message.to, lead)}</span>
                <time className="ml-auto text-foreground-subtle" dateTime={message.at}>
                  {message.at && Number.isFinite(Date.parse(message.at))
                    ? new Date(message.at).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : message.at}
                </time>
              </div>
              <p className="mt-1 break-words text-foreground-subtle">
                {message.summary ?? intl.formatMessage({ id: "team.panel.mailboxNoSummary" })}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-foreground-subtle">
                  {intl.formatMessage({
                    id:
                      message.delivered === true
                        ? "team.ui.delivered"
                        : message.delivered === false
                          ? "team.ui.queued"
                          : "team.ui.deliveryUnknown",
                  })}
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-1 py-1 text-icon-blue hover:bg-hover pointer-coarse:min-h-11"
                  data-testid="team-open-message"
                  onClick={() =>
                    onSelect({ teamId: model.teamId, kind: "message", id: message.messageId })
                  }
                >
                  <ArrowRightLeftIcon className="size-3" />
                  {intl.formatMessage({ id: "team.ui.messageDetails" })}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
