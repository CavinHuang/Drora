import { useMemo, useState } from "react";
import { ArrowUpRightIcon, UsersIcon } from "lucide-react";
import {
  deriveSessionTeamActivity,
  TEAM_LEAD_ASSIGNEE,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamOpenTarget } from "./TeamNavigation.js";
import { useTeamNavigation } from "./TeamNavigation.js";
import { TeamStatusBadge } from "./TeamStatusBadge.js";
import { TeamAvatar } from "./TeamAvatar.js";
import { TeamCollaborationPanel } from "./TeamCollaborationPanel.js";
import { mapTeamProjectionToViewModel } from "./view-model.js";

export function TeamConversationSummary({
  team,
  target,
}: {
  team: TeamProjectionState;
  target: TeamOpenTarget;
}) {
  const { intl } = useDroraIntl(),
    open = useTeamNavigation();
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(() => mapTeamProjectionToViewModel(team), [team]);
  const summary = deriveSessionTeamActivity(team)!;
  const latest = team.status === "staged" ? undefined : model.mailboxTail.at(-1);
  const actor = (value: string) =>
    value === TEAM_LEAD_ASSIGNEE
      ? intl.formatMessage({ id: "team.ui.lead" })
      : (model.members.find((member) => member.memberName === value || member.agentId === value)
          ?.memberName ?? value);
  const onOpen = () => (open ? open(target) : setExpanded((value) => !value));
  return (
    <section
      className="my-4 rounded-xl border border-card-border bg-card p-3"
      data-testid="team-conversation-summary"
      aria-label={intl.formatMessage({ id: "team.ui.current" })}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <UsersIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words text-ui-base font-medium">
          {team.name ?? intl.formatMessage({ id: "team.ui.title" })}
        </span>
        <TeamStatusBadge status={team.status} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={onOpen}
          aria-label={intl.formatMessage({ id: "team.ui.open" })}
        >
          <ArrowUpRightIcon className="size-4" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm text-foreground-subtle">
        {team.status === "staged" ? (
          intl.formatMessage(
            { id: "team.ui.planned" },
            { members: summary.memberCount, tasks: summary.total },
          )
        ) : (
          <>
            <span className="flex gap-1">
              {team.members.slice(0, 3).map((member) => (
                <TeamAvatar
                  key={member.agentId}
                  name={member.memberName}
                  color={member.profileColor}
                />
              ))}
            </span>
            <span>
              {intl.formatMessage({ id: "team.ui.members" }, { count: summary.memberCount })}
            </span>
            <span>
              {intl.formatMessage(
                { id: "team.ui.progress" },
                { completed: summary.completed, total: summary.total },
              )}
            </span>
          </>
        )}
      </div>
      {latest ? (
        <button
          type="button"
          className="mt-3 flex w-full items-start gap-2 border-t border-border pt-2 text-left text-ui-sm hover:text-icon-blue"
          onClick={onOpen}
        >
          <span className="min-w-0 flex-1 break-words">
            {actor(latest.from)} → {actor(latest.to)}
            <span className="mt-1 block text-foreground-subtle">
              {latest.summary ?? intl.formatMessage({ id: "team.panel.mailboxNoSummary" })} ·{" "}
              {intl.formatMessage({
                id:
                  latest.delivered === true
                    ? "team.ui.delivered"
                    : latest.delivered === false
                      ? "team.ui.queued"
                      : "team.ui.deliveryUnknown",
              })}
            </span>
          </span>
          <ArrowUpRightIcon className="size-3.5 shrink-0" />
        </button>
      ) : null}
      {open === null ? (
        <Button
          variant="ghost"
          className="mt-2 pointer-coarse:min-h-11"
          onClick={onOpen}
          aria-expanded={expanded}
        >
          {intl.formatMessage({ id: "team.ui.details" })}
        </Button>
      ) : null}
      {open === null && expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          <TeamCollaborationPanel key={team.teamId} model={model} />
        </div>
      ) : null}
    </section>
  );
}
