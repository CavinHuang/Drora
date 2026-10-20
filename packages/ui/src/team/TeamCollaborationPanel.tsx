import { useMemo, useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { TEAM_LEAD_ASSIGNEE } from "@drora/shared/drora-protocol-v4";
import { buildTeamRelations, teamTasks, type TeamRelationLayer } from "./relations.js";
import { TeamRelationGraph } from "./TeamRelationGraph.js";
import type { TeamPanelMemberView, TeamPanelModel, TeamPanelTaskView } from "./view-model.js";

export function TeamCollaborationPanel({
  model,
  onMemberClick,
  onTaskClick,
}: {
  model: TeamPanelModel;
  onMemberClick?: (member: TeamPanelMemberView) => void;
  onTaskClick?: (task: TeamPanelTaskView) => void;
}) {
  const { intl } = useDroraIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const [layer, setLayer] = useState<TeamRelationLayer>("messages"),
    [selection, setSelection] = useState(""),
    [focusTask, setFocusTask] = useState("");
  const graph = useMemo(
    () => buildTeamRelations(model, layer, focusTask),
    [model, layer, focusTask],
  );
  const selected =
    graph.edges.find((e) => e.id === selection) ??
    (graph.nodes.some((n) => n.id === selection) ? undefined : graph.edges[0]);
  const node = graph.nodes.find((n) => n.id === selection);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const actor = (id: string) => {
    const n = nodeById.get(id);
    return n?.label === TEAM_LEAD_ASSIGNEE ? t("team.ui.lead") : (n?.label ?? id);
  };
  const selectedTask = selected ? nodeById.get(selected.to)?.task : undefined;
  const owner =
    node?.member ??
    (node?.task ? model.members.find((m) => m.memberName === node.task?.assignee) : undefined) ??
    (selected ? nodeById.get(selected.from)?.member : undefined) ??
    model.members.find((m) => m.memberName === selectedTask?.assignee);
  const message = selected?.message;
  const delivery = (value: boolean | undefined) =>
    t(
      value === true
        ? "team.ui.delivered"
        : value === false
          ? "team.ui.queued"
          : "team.ui.deliveryUnknown",
    );
  const emptyKey =
    layer === "handoffs"
      ? "team.ui.noHandoffs"
      : layer === "dependencies"
        ? "team.ui.noDependencies"
        : "team.ui.noMessages";
  return (
    <section
      className="min-w-0"
      data-testid="team-collaboration"
      aria-label={t("team.ui.collaboration")}
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("team.ui.relations")}>
        {(["dependencies", "messages", "handoffs"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={layer === value ? "secondary" : "ghost"}
            aria-pressed={layer === value}
            className="pointer-coarse:min-h-11"
            onClick={() => {
              setLayer(value);
              setSelection("");
            }}
            data-testid={`team-layer-${value}`}
          >
            {t(`team.ui.${value}`)}
          </Button>
        ))}
      </div>
      {layer === "dependencies" && graph.totalNodes > 12 ? (
        <label className="mt-3 flex flex-col gap-1 text-ui-sm">
          {t("team.ui.focus")}
          <select
            className="h-8 min-w-0 rounded-lg border border-input-border bg-input px-2 text-ui-sm"
            value={focusTask}
            onChange={(event) => {
              setFocusTask(event.target.value);
              setSelection("");
            }}
          >
            <option value="">{t("team.ui.current")}</option>
            {teamTasks(model).map((task) => (
              <option key={task.taskId} value={task.taskId}>
                {task.taskId} · {task.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {graph.nodes.length === 0 ? (
        <div
          className="py-10 text-center text-ui-sm text-foreground-subtle"
          data-testid="team-relations-empty"
        >
          <p>{t(emptyKey)}</p>
          {layer === "handoffs" ? <p className="mt-2">{t("team.ui.handoffHint")}</p> : null}
        </div>
      ) : (
        <>
          <p className="mt-3 text-ui-sm text-foreground-subtle">
            {t("team.ui.scope", { shown: graph.edges.length, total: graph.totalEdges })}
            {graph.nodes.length < graph.totalNodes
              ? ` · ${t("team.ui.nodeScope", { shown: graph.nodes.length, total: graph.totalNodes })}`
              : ""}
          </p>
          <TeamRelationGraph
            graph={graph}
            selected={selected?.id ?? node?.id ?? ""}
            onSelect={setSelection}
          />
          <div
            className="my-3 border-l-2 border-icon-blue pl-3 text-ui-sm"
            aria-live="polite"
            data-testid="team-relation-evidence"
          >
            <p>{selected ? `${actor(selected.from)} → ${actor(selected.to)}` : node?.label}</p>
            {node?.missing ? (
              <p className="mt-2 text-foreground-subtle">{t("team.ui.missing")}</p>
            ) : null}
            {message ? (
              <>
                <p className="mt-2 break-words">
                  {message.summary ?? t("team.panel.mailboxNoSummary")}
                </p>
                <p className="mt-1 text-foreground-subtle">{delivery(message.delivered)}</p>
                <p className="mt-2 break-all font-mono text-ui-sm text-foreground-subtle">
                  {[message.at, message.sourceTaskId, message.sourceAttemptId]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            ) : selected ? (
              <p className="mt-2 text-foreground-subtle">
                {t(selected.satisfied ? "team.ui.depReady" : "team.ui.depWaiting")}
              </p>
            ) : node?.task ? (
              <p className="mt-2 text-foreground-subtle">
                {t(`team.task.status.${node.task.status}`)} ·{" "}
                {t("team.ui.attempt", { id: node.task.attempt })}
              </p>
            ) : null}
            {owner && onMemberClick ? (
              <Button
                className="mt-3 pointer-coarse:min-h-11"
                variant="outline"
                size="sm"
                onClick={() => onMemberClick(owner)}
              >
                {t("team.ui.memberOpen")}
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            ) : null}
            {(node?.task ?? selectedTask) && onTaskClick ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 ml-1 pointer-coarse:min-h-11"
                onClick={() => onTaskClick((node?.task ?? selectedTask)!)}
              >
                {t("team.ui.currentTask")}
                <ArrowUpRightIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <h3 className="mb-2 text-ui-sm text-foreground-subtle">{t("team.ui.relations")}</h3>
          <ul className="flex flex-col gap-1">
            {graph.edges.map((edge) => (
              <li key={edge.id}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-2 py-2 text-left text-ui-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === edge.id ? "bg-selected" : "hover:bg-hover"}`}
                  aria-pressed={selected?.id === edge.id}
                  onClick={() => setSelection(edge.id)}
                  data-testid="team-relation-row"
                >
                  <span className="block break-words">
                    {actor(edge.from)} → {actor(edge.to)}
                  </span>
                  <span className="mt-1 block break-words text-foreground-subtle">
                    {edge.message
                      ? `${delivery(edge.message.delivered)} · ${edge.message.summary ?? t("team.panel.mailboxNoSummary")}`
                      : t(edge.satisfied ? "team.ui.depReady" : "team.ui.depWaiting")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
