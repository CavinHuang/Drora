import { UsersIcon } from "lucide-react";
import type { SessionTeamActivity } from "@drora/shared/drora-protocol-v4";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { TeamStatusBadge } from "./TeamStatusBadge.js";
import { useTeamNavigation, type TeamOpenTarget } from "./TeamNavigation.js";

export function TeamSessionLine({
  activity,
  target,
}: {
  activity: SessionTeamActivity | undefined;
  target?: TeamOpenTarget;
}) {
  const { intl } = useDroraIntl(),
    open = useTeamNavigation();
  if (!activity) return null;
  const content = (
    <>
      <UsersIcon className="size-3 shrink-0" />
      <TeamStatusBadge status={activity.status} />
      <span className="shrink-0 font-mono text-ui-xs">
        {activity.completed}/{activity.total}
      </span>
    </>
  );
  const className =
    "mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-left text-ui-sm text-foreground-subtle";
  return open && target ? (
    <button
      type="button"
      className={`${className} rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`}
      aria-label={intl.formatMessage({ id: "team.ui.open" })}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(target);
      }}
      data-testid="team-session-line"
    >
      {content}
    </button>
  ) : (
    <div className={className} data-testid="team-session-line">
      {content}
    </div>
  );
}
