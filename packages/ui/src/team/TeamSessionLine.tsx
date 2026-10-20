import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, UsersIcon } from "lucide-react";
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
  // 旧会话没有团队摘要，不能因新增入口引入 Provider 要求或额外订阅。
  return activity ? <TeamSessionLineContent activity={activity} target={target} /> : null;
}

function TeamSessionLineContent({
  activity,
  target,
}: {
  activity: SessionTeamActivity;
  target?: TeamOpenTarget;
}) {
  const { intl } = useDroraIntl(),
    open = useTeamNavigation();
  const [expanded, setExpanded] = useState(false);
  const content = (
    <>
      <UsersIcon className="size-3 shrink-0" />
      <TeamStatusBadge status={activity.status} />
      <span className="shrink-0 font-mono text-ui-xs">
        {activity.completed}/{activity.total}
      </span>
      <span>{intl.formatMessage({ id: "team.ui.members" }, { count: activity.memberCount })}</span>
    </>
  );
  const className =
    "mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-left text-ui-sm text-foreground-subtle";
  return (
    <div className="min-w-0" data-testid="team-session-summary">
      {open && target ? (
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
      )}
      {activity.working !== undefined || activity.blocked !== undefined ? (
        <div className="mt-1 flex flex-wrap gap-x-2 text-ui-sm text-foreground-subtle">
          {activity.working !== undefined ? (
            <span>
              {intl.formatMessage({ id: "team.ui.workingCount" }, { count: activity.working })}
            </span>
          ) : null}
          {activity.blocked ? (
            <span>
              {intl.formatMessage({ id: "team.ui.blockedCount" }, { count: activity.blocked })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="mt-2 h-0.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-label={intl.formatMessage(
          { id: "team.ui.progress" },
          { completed: activity.completed, total: activity.total },
        )}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, activity.total)}
        aria-valuenow={Math.min(activity.completed, activity.total)}
      >
        <div
          className="h-full bg-success"
          style={{
            width: `${activity.total ? Math.min(100, (activity.completed / activity.total) * 100) : 0}%`,
          }}
        />
      </div>
      {/* 中文依据：远控宿主把整行作为按钮；无导航端口时只显示摘要，不能在行内再嵌套按钮。 */}
      {activity.members?.length && open && target ? (
        <>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 rounded-md py-1 text-ui-sm text-foreground-subtle hover:text-foreground pointer-coarse:min-h-11"
            aria-expanded={expanded}
            data-testid="team-session-members-toggle"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
          >
            {expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            {intl.formatMessage({ id: "team.panel.membersAria" })}
          </button>
          {expanded ? (
            <ul className="ml-1 flex flex-col gap-1 border-l border-border pl-2">
              {activity.members.map((member) => (
                <li key={member.agentId}>
                  <button
                    type="button"
                    disabled={!open || !target}
                    className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-ui-sm hover:bg-hover pointer-coarse:min-h-11"
                    data-testid="team-session-member"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (open && target)
                        open({
                          ...target,
                          focus: { teamId: activity.teamId, kind: "member", id: member.agentId },
                        });
                    }}
                  >
                    <span className="min-w-0 break-words">{member.memberName}</span>
                    <span className="shrink-0 text-foreground-subtle">
                      {intl.formatMessage({ id: `team.member.state.${member.state}` })}
                    </span>
                  </button>
                </li>
              ))}
              {activity.members.length < activity.memberCount ? (
                <li className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "team.ui.nodeScope" },
                    { shown: activity.members.length, total: activity.memberCount },
                  )}
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
