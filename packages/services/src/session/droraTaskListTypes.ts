import type { WorkspacePurpose, DroraTaskMeta } from "@drora/shared";

export type DroraTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type DroraTaskListSortBy = "created" | "updated";

export interface DroraTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface DroraTaskListQuery {
  kind: DroraTaskListKind;
  workspaceScopes: DroraTaskListWorkspaceScope[];
  sortBy: DroraTaskListSortBy;
  search?: string;
  limit?: number;
}

export type DroraTaskListItem = DroraTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface DroraTaskListResult {
  items: DroraTaskListItem[];
  total: number;
  hasMore: boolean;
}

export type DroraTaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface DroraTaskGroup {
  id: string;
  title: string;
  color: DroraTaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface DroraGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type DroraGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: DroraGroupedTaskRef };

export type DroraGroupedTaskViewNode =
  | {
      type: "group";
      group: DroraTaskGroup;
      tasks: DroraTaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: DroraTaskListItem;
      sortOrder?: number;
    };

export interface DroraGroupedTaskView {
  nodes: DroraGroupedTaskViewNode[];
}

export interface DroraGroupedTaskViewQuery {
  workspaceScopes: DroraTaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface DroraGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type DroraGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface DroraGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: DroraTaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: DroraGroupedTaskViewStructureMember[];
  topLevelOrders: DroraGroupedTaskViewStructureTopOrder[];
}

export interface DroraGroupedTaskViewOrderInput {
  workspaceScopes: DroraTaskListWorkspaceScope[];
  topLevelNodes: DroraGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: DroraGroupedTaskRef[];
  }>;
}

export interface DroraWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
