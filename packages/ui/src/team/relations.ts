import { TEAM_LEAD_ASSIGNEE } from "@drora/shared/drora-protocol-v4";
import type {
  TeamPanelMailboxEntryView,
  TeamPanelMemberView,
  TeamPanelModel,
  TeamPanelTaskView,
} from "./view-model.js";

export type TeamRelationLayer = "dependencies" | "messages" | "handoffs";
export interface TeamRelationNode {
  id: string;
  label: string;
  level: number;
  missing: boolean;
  task?: TeamPanelTaskView;
  member?: TeamPanelMemberView;
}
export interface TeamRelationEdge {
  id: string;
  from: string;
  to: string;
  satisfied?: boolean;
  message?: TeamPanelMailboxEntryView;
}
export interface TeamRelations {
  nodes: TeamRelationNode[];
  edges: TeamRelationEdge[];
  totalNodes: number;
  totalEdges: number;
}
const NODE_LIMIT = 12;
const MESSAGE_WINDOW = 6;

export function teamTasks(model: TeamPanelModel): readonly TeamPanelTaskView[] {
  return [
    ...model.board.completed,
    ...model.board.inProgress,
    ...model.board.attention,
    ...model.board.pending,
  ];
}

export function buildTeamRelations(
  model: TeamPanelModel,
  layer: TeamRelationLayer,
  focusTaskId?: string,
): TeamRelations {
  if (layer === "handoffs" || (layer === "messages" && model.status === "staged"))
    return { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 };
  if (layer === "messages") {
    const nodes = new Map<string, TeamRelationNode>();
    const actor = (value: string) => {
      const member = model.members.find((m) => m.memberName === value || m.agentId === value);
      const label = member?.memberName ?? value,
        id = `actor:${label}`;
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          label,
          member,
          level: Math.floor(nodes.size / 2),
          missing: !member && value !== TEAM_LEAD_ASSIGNEE,
        });
      return id;
    };
    const edges = model.mailboxTail
      .slice(-MESSAGE_WINDOW)
      .reverse()
      .map((message) => ({
        id: message.messageId,
        from: actor(message.from),
        to: actor(message.to),
        message,
      }));
    return {
      nodes: [...nodes.values()],
      edges,
      totalNodes: nodes.size,
      totalEdges: model.mailboxTail.length,
    };
  }
  const tasks = teamTasks(model),
    byId = new Map(tasks.map((t) => [t.taskId, t]));
  const depths = new Map<string, number>();
  const depth = (id: string, visiting: Set<string>): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    const next = new Set(visiting).add(id);
    const dependencies = byId.get(id)?.dependsOn ?? [];
    const value = Math.min(
      8,
      dependencies.length ? 1 + Math.max(...dependencies.map((d) => depth(d, next))) : 0,
    );
    depths.set(id, value);
    return value;
  };
  const all = new Set(tasks.flatMap((t) => [t.taskId, ...t.dependsOn]));
  let ids = [...all];
  if (ids.length > NODE_LIMIT) {
    const focus =
      byId.get(focusTaskId ?? "") ?? tasks.find((t) => t.status === "in_progress") ?? tasks[0];
    ids = focus
      ? [
          ...new Set([
            focus.taskId,
            ...focus.dependsOn,
            ...tasks.filter((t) => t.dependsOn.includes(focus.taskId)).map((t) => t.taskId),
          ]),
        ].slice(0, NODE_LIMIT)
      : [];
  }
  const included = new Set(ids);
  const nodes = ids
    .map((id) => ({
      id: `task:${id}`,
      label: byId.get(id)?.title ?? id,
      task: byId.get(id),
      level: depth(id, new Set()),
      missing: !byId.has(id),
    }))
    .sort((a, b) => a.level - b.level);
  const allEdges = tasks.flatMap((task) =>
    task.dependsOn.map((dep) => ({
      id: `${dep}→${task.taskId}`,
      from: `task:${dep}`,
      to: `task:${task.taskId}`,
      satisfied: byId.get(dep)?.status === "completed",
    })),
  );
  const edges = allEdges.filter(
    (edge) => included.has(edge.from.slice(5)) && included.has(edge.to.slice(5)),
  );
  return { nodes, edges, totalNodes: all.size, totalEdges: allEdges.length };
}
