import { useId, useLayoutEffect, useRef, useState } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { TEAM_LEAD_ASSIGNEE } from "@drora/shared/drora-protocol-v4";
import type { TeamRelationEdge, TeamRelationNode, TeamRelations } from "./relations.js";
import { TeamAvatar } from "./TeamAvatar.js";

export function TeamRelationGraph({
  graph,
  selected,
  onSelect,
}: {
  graph: TeamRelations;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { intl } = useDroraIntl(),
    marker = useId().replaceAll(":", "");
  const root = useRef<HTMLDivElement>(null),
    buttons = useRef(new Map<string, HTMLButtonElement>());
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    paths: { edge: TeamRelationEdge; d: string }[];
  }>({ width: 1, height: 1, paths: [] });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width) return;
      const paths = graph.edges.flatMap((edge) => {
        const a = buttons.current.get(edge.from)?.getBoundingClientRect(),
          b = buttons.current.get(edge.to)?.getBoundingClientRect();
        if (!a || !b) return [];
        const ax = a.left - bounds.left + a.width / 2,
          ay = a.top - bounds.top + a.height;
        const bx = b.left - bounds.left + b.width / 2,
          by = b.top - bounds.top;
        const d =
          Math.abs(a.top - b.top) < 8
            ? `M${ax} ${ay} C${ax} ${ay + 18},${bx} ${ay + 18},${bx} ${b.bottom - bounds.top}`
            : `M${ax} ${ay} C${ax} ${(ay + by) / 2},${bx} ${(ay + by) / 2},${bx} ${by}`;
        return [{ edge, d }];
      });
      setGeometry({ width: bounds.width, height: bounds.height, paths });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const button of buttons.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [graph]);
  const levels = [...new Set(graph.nodes.map((n) => n.level))].sort((a, b) => a - b);
  const selectedEdge = graph.edges.find((e) => e.id === selected);
  const active = (edge: TeamRelationEdge) =>
    edge.id === selected || edge.from === selected || edge.to === selected;
  const paths = [...geometry.paths].sort((a, b) => Number(active(a.edge)) - Number(active(b.edge)));
  function nodeMeta(node: TeamRelationNode) {
    return node.task
      ? `${node.task.assignee ?? intl.formatMessage({ id: "team.ui.unassigned" })} · ${node.task.taskId}`
      : node.missing
        ? intl.formatMessage({ id: "team.ui.missing" })
        : node.member?.profile;
  }
  return (
    <div
      ref={root}
      className="relative flex min-w-0 flex-col gap-10 py-5"
      role="group"
      aria-label={intl.formatMessage({ id: "team.ui.graph" })}
      data-testid="team-relation-graph"
    >
      <svg
        aria-hidden
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="pointer-events-none absolute inset-0 overflow-visible"
      >
        <defs>
          <marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7" fill="var(--color-workflow-trace-strong)" />
          </marker>
        </defs>
        {paths.map(({ edge, d }) => (
          <path
            key={edge.id}
            d={d}
            fill="none"
            stroke={active(edge) ? "var(--color-icon-blue)" : "var(--color-workflow-trace)"}
            strokeWidth={active(edge) ? 1.75 : 1.25}
            strokeDasharray={edge.message ? "4 4" : undefined}
            markerEnd={`url(#${marker})`}
          />
        ))}
      </svg>
      {levels.map((level) => (
        <div key={level} className="relative flex flex-wrap justify-center gap-3">
          {graph.nodes
            .filter((n) => n.level === level)
            .map((node) => (
              <button
                type="button"
                key={node.id}
                ref={(el) => {
                  if (el) buttons.current.set(node.id, el);
                  else buttons.current.delete(node.id);
                }}
                onClick={() => onSelect(node.id)}
                aria-pressed={selected === node.id}
                aria-label={intl.formatMessage({ id: "team.ui.graphSelect" }, { name: node.label })}
                className={`flex min-w-0 basis-5/12 flex-col items-center gap-1 rounded-xl border bg-card p-2 text-ui-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === node.id || selectedEdge?.from === node.id || selectedEdge?.to === node.id ? "border-icon-blue" : "border-card-border"}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 break-all">
                  {node.member ? (
                    <TeamAvatar name={node.member.memberName} color={node.member.profileColor} />
                  ) : null}
                  {node.task ? (
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 rounded-full ${node.task.status === "completed" ? "bg-success" : node.task.status === "failed" ? "bg-destructive" : node.task.status === "in_progress" || node.task.status === "claimed" ? "bg-warning" : "bg-workflow-trace"}`}
                    />
                  ) : null}
                  <span>
                    {node.label === TEAM_LEAD_ASSIGNEE
                      ? intl.formatMessage({ id: "team.ui.lead" })
                      : node.label}
                  </span>
                </span>
                <span className="break-all text-ui-sm text-foreground-subtle">
                  {nodeMeta(node)}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
