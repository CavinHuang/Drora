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

export interface DroraWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
