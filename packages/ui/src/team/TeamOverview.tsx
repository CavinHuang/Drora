import { ChevronRightIcon, LayoutListIcon, PanelsTopLeftIcon } from "lucide-react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { TeamAvatar } from "./TeamAvatar.js";
import { teamActor, teamFacts, waitingDependencies } from "./presentation.js";
import { teamTasks } from "./relations.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelModel } from "./view-model.js";

export function TeamOverview({
  model,
  onSelect,
  onBoard,
}: {
  model: TeamPanelModel;
  onSelect: (focus: TeamUiFocus) => void;
  onBoard: () => void;
}) {
  const { intl } = useDroraIntl(),
    facts = teamFacts(model);
  const lead = intl.formatMessage({ id: "team.ui.lead" });
  const tasks = teamTasks(model);
  return (
    <div data-testid="team-overview">
      <div className="mb-2 flex items-center justify-between text-ui-sm text-foreground-subtle">
        <h3>{intl.formatMessage({ id: "team.panel.membersAria" })}</h3>
        <span>{model.members.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {model.members.map((member) => {
          const current = tasks.find((task) => task.taskId === member.currentTaskId);
          const blocked = tasks.some(
            (task) =>
              task.assignee === member.memberName &&
              task.status === "pending" &&
              waitingDependencies(model, task).length,
          );
          const state =
            member.state === "terminal" && blocked
              ? intl.formatMessage({ id: "team.ui.waitingDependency" })
              : intl.formatMessage({ id: `team.member.state.${member.state}` });
          return (
            <li key={member.agentId}>
              <button
                type="button"
                data-testid="team-overview-member"
                onClick={() =>
                  onSelect({ teamId: model.teamId, kind: "member", id: member.agentId })
                }
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
              >
                <TeamAvatar name={member.memberName} color={member.profileColor} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-ui-caption">{member.memberName}</span>
                  <span className="mt-0.5 block break-words text-ui-sm text-foreground-subtle">
                    {current?.title ?? member.profile}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-ui-sm ${member.state === "working" ? "text-warning" : "text-foreground-subtle"}`}
                >
                  {state}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-ui-sm text-foreground-subtle">
        <h3>
          {intl.formatMessage({ id: "team.ui.taskList" })} · {facts.completed}/{facts.total}
        </h3>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-hover pointer-coarse:min-h-11"
          data-testid="team-board-toggle"
          onClick={onBoard}
        >
          <PanelsTopLeftIcon className="size-3" />
          {intl.formatMessage({ id: "team.ui.board" })}
        </button>
      </div>
      {!tasks.length ? (
        <p className="py-4 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.ui.noTasks" })}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col gap-1">
        {[
          ...model.board.inProgress,
          ...model.board.attention,
          ...model.board.pending,
          ...model.board.completed,
        ].map((task) => {
          const blocked = task.status === "pending" && waitingDependencies(model, task).length > 0;
          const state = blocked
            ? intl.formatMessage({ id: "team.ui.waitingDependency" })
            : intl.formatMessage({ id: `team.task.status.${task.status}` });
          return (
            <li key={task.taskId}>
              <button
                type="button"
                data-testid="team-overview-task"
                onClick={() => onSelect({ teamId: model.teamId, kind: "task", id: task.taskId })}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
              >
                <LayoutListIcon
                  className={`size-3.5 shrink-0 ${task.status === "completed" ? "text-success" : task.status === "failed" ? "text-destructive" : task.status === "in_progress" || task.status === "claimed" ? "text-warning" : "text-foreground-subtlest"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-ui-caption">{task.title}</span>
                  <span className="mt-1 block break-words text-ui-sm text-foreground-subtle">
                    {task.taskId} ·{" "}
                    {task.assignee
                      ? teamActor(model, task.assignee, lead)
                      : intl.formatMessage({ id: "team.ui.unassigned" })}{" "}
                    · {state}
                  </span>
                </span>
                <ChevronRightIcon className="size-3 shrink-0 text-foreground-subtlest" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
