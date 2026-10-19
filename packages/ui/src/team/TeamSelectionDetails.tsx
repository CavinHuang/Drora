import { ArrowLeftIcon, ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { teamActor, teamMemberFor, waitingDependencies } from "./presentation.js";
import { teamTasks } from "./relations.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelMemberView, TeamPanelModel, TeamPanelTaskView } from "./view-model.js";

export function TeamSelectionDetails({
  model,
  focus,
  onSelect,
  onBack,
  onMemberClick,
  onQuoteTask,
}: {
  model: TeamPanelModel;
  focus: TeamUiFocus;
  onSelect: (focus: TeamUiFocus) => void;
  onBack: () => void;
  onMemberClick?: (member: TeamPanelMemberView) => void;
  onQuoteTask?: (task: TeamPanelTaskView) => void;
}) {
  const { intl } = useDroraIntl(),
    lead = intl.formatMessage({ id: "team.ui.lead" });
  const tasks = teamTasks(model);
  const task = focus.kind === "task" ? tasks.find((task) => task.taskId === focus.id) : undefined;
  const member = focus.kind === "member" ? teamMemberFor(model, focus.id) : undefined;
  const message =
    focus.kind === "message"
      ? model.mailboxTail.find((message) => message.messageId === focus.id)
      : undefined;
  const selectTask = (id: string) => onSelect({ teamId: model.teamId, kind: "task", id });
  return (
    <section className="min-w-0" data-testid="team-selection-details">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onBack}
        className="mb-3 pointer-coarse:min-h-11"
        data-testid="team-details-back"
      >
        <ArrowLeftIcon className="size-3.5" />
        {intl.formatMessage({ id: "team.ui.backOverview" })}
      </Button>
      {!task && !member && !message ? (
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.ui.missing" })}
        </p>
      ) : null}
      {task ? (
        <>
          <p className="font-mono text-ui-sm text-foreground-subtle">{task.taskId}</p>
          <h3 className="mt-1 break-words text-ui-lg font-medium">{task.title}</h3>
          <p className="mt-2 text-ui-sm">
            {intl.formatMessage({ id: `team.task.status.${task.status}` })} ·{" "}
            {intl.formatMessage({ id: "team.ui.attempt" }, { id: task.attempt })}
          </p>
          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "team.ui.owner" })}
            </h4>
            {task.assignee && teamMemberFor(model, task.assignee) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 pointer-coarse:min-h-11"
                onClick={() =>
                  onSelect({ teamId: model.teamId, kind: "member", id: task.assignee! })
                }
              >
                {teamActor(model, task.assignee, lead)}
              </Button>
            ) : (
              <p className="mt-2 break-words text-ui-caption">
                {task.assignee
                  ? teamActor(model, task.assignee, lead)
                  : intl.formatMessage({ id: "team.ui.unassigned" })}
              </p>
            )}
          </div>
          {task.spec ? (
            <div className="mt-4 border-t border-border pt-3 text-ui-caption">
              <h4 className="mb-2 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "team.ui.goal" })}
              </h4>
              <p className="break-words whitespace-pre-wrap">{task.spec.goal}</p>
              <ul className="mt-2 list-inside list-disc">
                {task.spec.acceptance.map((criterion, index) => (
                  <li key={index} className="break-words">
                    {criterion}
                  </li>
                ))}
              </ul>
              {task.spec.outputFormat ? (
                <p className="mt-2 break-words text-foreground-subtle">{task.spec.outputFormat}</p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "team.ui.dependencies" })}
            </h4>
            {!task.dependsOn.length ? (
              <p className="mt-2 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "team.ui.noDependencies" })}
              </p>
            ) : null}
            {task.dependsOn.map((id) => (
              <button
                key={id}
                type="button"
                className="mt-1 block w-full rounded-md px-1 py-2 text-left text-ui-sm hover:bg-hover pointer-coarse:min-h-11"
                data-testid="team-task-dependency"
                onClick={() => selectTask(id)}
              >
                <span
                  className={
                    waitingDependencies(model, task).includes(id)
                      ? "text-foreground-subtle"
                      : "text-success"
                  }
                >
                  {waitingDependencies(model, task).includes(id) ? "○" : "✓"}
                </span>{" "}
                {id} ·{" "}
                {tasks.find((candidate) => candidate.taskId === id)?.title ??
                  intl.formatMessage({ id: "team.ui.missing" })}
              </button>
            ))}
          </div>
          {task.artifactRefs.length ? (
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "team.ui.artifacts" })}
              </h4>
              {task.artifactRefs.map((ref) => (
                <p key={ref} className="mt-2 break-all font-mono text-ui-sm">
                  {ref}
                </p>
              ))}
            </div>
          ) : null}
          {onQuoteTask ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4 pointer-coarse:min-h-11"
              onClick={() => onQuoteTask(task)}
            >
              {intl.formatMessage({ id: "team.ui.quoteTask" })}
            </Button>
          ) : null}
        </>
      ) : null}
      {member ? (
        <>
          <h3 className="break-words text-ui-lg font-medium">{member.memberName}</h3>
          <p className="mt-1 break-words text-ui-sm text-foreground-subtle">
            {member.profile} · {intl.formatMessage({ id: `team.member.state.${member.state}` })}
          </p>
          <h4 className="mt-4 border-t border-border pt-3 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "team.ui.taskList" })}
          </h4>
          {tasks
            .filter((task) => task.assignee === member.memberName)
            .map((task) => (
              <button
                type="button"
                key={task.taskId}
                className="mt-2 block w-full rounded-md px-1 py-2 text-left text-ui-caption hover:bg-hover pointer-coarse:min-h-11"
                onClick={() => selectTask(task.taskId)}
              >
                {task.taskId} · {task.title}
              </button>
            ))}
          {onMemberClick ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 pointer-coarse:min-h-11"
              data-testid="team-transcript-open"
              onClick={() => onMemberClick(member)}
            >
              {intl.formatMessage({ id: "team.ui.memberOpen" })}
              <ArrowUpRightIcon className="size-3" />
            </Button>
          ) : null}
        </>
      ) : null}
      {message ? (
        <>
          <h3 className="break-words text-ui-lg font-medium">
            {teamActor(model, message.from, lead)} → {teamActor(model, message.to, lead)}
          </h3>
          <p className="mt-2 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({
              id:
                message.delivered === true
                  ? "team.ui.delivered"
                  : message.delivered === false
                    ? "team.ui.queued"
                    : "team.ui.deliveryUnknown",
            })}
          </p>
          <p className="mt-4 break-words whitespace-pre-wrap rounded-lg bg-surface p-3 text-ui-caption">
            {message.summary ?? intl.formatMessage({ id: "team.panel.mailboxNoSummary" })}
          </p>
          <p className="mt-3 break-all font-mono text-ui-sm text-foreground-subtle">
            {[message.at, message.sourceAttemptId].filter(Boolean).join(" · ")}
          </p>
          {message.sourceTaskId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 pointer-coarse:min-h-11"
              data-testid="team-message-task"
              onClick={() => selectTask(message.sourceTaskId!)}
            >
              {message.sourceTaskId}
              <ArrowUpRightIcon className="size-3" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4 pointer-coarse:min-h-11"
            onClick={() => onSelect({ teamId: model.teamId, kind: "process" })}
          >
            {intl.formatMessage({ id: "team.ui.savedProcess" })}
          </Button>
        </>
      ) : null}
    </section>
  );
}
