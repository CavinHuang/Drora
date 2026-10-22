import { useMemo, useState } from "react";
import { ArrowUpRightIcon, UsersIcon } from "lucide-react";
import {
  deriveSessionTeamActivity,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import type { TeamUiFocus } from "./contract.js";
import { approveTeamPlan, abandonTeamPlan, reviseTeamPlan } from "./commands.js";
import type { TeamOpenTarget } from "./TeamNavigation.js";
import { useTeamNavigation } from "./TeamNavigation.js";
import { TeamStatusBadge } from "./TeamStatusBadge.js";
import { TeamAvatar } from "./TeamAvatar.js";
import {
  TeamStagedEditor,
  teamCommandOutcomeToStagedFailure,
  type TeamStagedCommandFailure,
} from "./TeamStagedEditor.js";
import { TeamWorkspaceViews } from "./TeamWorkspaceViews.js";
import { TeamStageRail } from "./TeamStageRail.js";
import { TeamRecentMessages } from "./TeamRecentMessages.js";
import { mapTeamProjectionToViewModel } from "./view-model.js";

export function TeamConversationSummary(props: {
  team: TeamProjectionState;
  target: TeamOpenTarget;
  connection?: TeamHistoryConnection;
}) {
  return <TeamConversationSummaryContent key={props.team.teamId} {...props} />;
}

function TeamConversationSummaryContent({
  team,
  target,
  connection,
}: {
  team: TeamProjectionState;
  target: TeamOpenTarget;
  connection?: TeamHistoryConnection;
}) {
  const { intl } = useDroraIntl(),
    open = useTeamNavigation();
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<TeamUiFocus>();
  const model = useMemo(() => mapTeamProjectionToViewModel(team), [team]);
  const summary = deriveSessionTeamActivity(team)!;
  // staged 审批内联（2026-10-22 用户裁定：审批对齐 workflow 模式——会话流内、用户驱动；
  // 废除 PR-2.4c 的「自动打开 TeamPanel」桥，78b72ba8 的桥曾因 h-full 包装在无布局
  // 上下文裸挂载把壳层顶出一屏）。命令经 connection.sendCommand 走 team/commands.ts
  // 单一通道，与面板内审批同一条路径；connection 缺席（纯历史视图）退化为只读摘要。
  // 三动作失败出显（spec §10 呈现规则4）：outcome 消费后经
  // teamCommandOutcomeToStagedFailure（单一映射出处）交回编辑器内联 role=alert；
  // 任一动作再次发起时置空清除。同侧栏挂载点一体适用，命令单一通道不变。
  const [stagedFailure, setStagedFailure] = useState<TeamStagedCommandFailure | null>(null);
  const sendCommand = connection?.sendCommand;
  const select = (next: TeamUiFocus) => {
    if (open) open({ ...target, focus: next });
    else {
      setFocus(next);
      setExpanded(true);
    }
  };
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
          sendCommand && model.stagedDraft ? (
            <div className="mt-1 w-full">
              <TeamStagedEditor
                draft={model.stagedDraft}
                failure={stagedFailure}
                onApprove={() => {
                  setStagedFailure(null);
                  void approveTeamPlan({ sessionId: target.parentSessionId, sendCommand }).then(
                    (outcome) => {
                      const failure = teamCommandOutcomeToStagedFailure("approve", outcome);
                      if (failure !== null) setStagedFailure(failure);
                    },
                  );
                }}
                onRevise={(note) => {
                  setStagedFailure(null);
                  void reviseTeamPlan({
                    sessionId: target.parentSessionId,
                    sendCommand,
                    ...(note === undefined ? {} : { note }),
                  }).then((outcome) => {
                    const failure = teamCommandOutcomeToStagedFailure("revise", outcome);
                    if (failure !== null) setStagedFailure(failure);
                  });
                }}
                onAbandon={() => {
                  setStagedFailure(null);
                  void abandonTeamPlan({ sessionId: target.parentSessionId, sendCommand }).then(
                    (outcome) => {
                      const failure = teamCommandOutcomeToStagedFailure("abandon", outcome);
                      if (failure !== null) setStagedFailure(failure);
                    },
                  );
                }}
              />
            </div>
          ) : (
            intl.formatMessage(
              { id: "team.ui.planned" },
              { members: summary.memberCount, tasks: summary.total },
            )
          )
        ) : (
          <>
            <span className="flex gap-1">
              {team.members.slice(0, 3).map((member) => (
                <button
                  type="button"
                  key={member.agentId}
                  className="rounded-md pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  aria-label={intl.formatMessage(
                    { id: "team.panel.memberOpen" },
                    { name: member.memberName },
                  )}
                  onClick={() =>
                    select({ teamId: team.teamId, kind: "member", id: member.agentId })
                  }
                >
                  <TeamAvatar name={member.memberName} color={member.profileColor} />
                </button>
              ))}
            </span>
            {summary.blocked ? (
              <span>
                {intl.formatMessage({ id: "team.ui.blockedCount" }, { count: summary.blocked })}
              </span>
            ) : null}
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
      <TeamStageRail model={model} onSelect={select} />
      <TeamRecentMessages model={model} onSelect={select} />
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
          <TeamWorkspaceViews
            key={team.teamId}
            model={model}
            focus={focus}
            connection={connection}
          />
        </div>
      ) : null}
    </section>
  );
}
