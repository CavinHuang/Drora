// §32.38 从 HomeShell 抽出的工作区组卡（行数门禁）；渲染面自 §23 起未变。
import { ChevronDown, FolderOpen, Plus } from "lucide-react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";
import { formatTaskRelativeTime } from "./formatRelative.js";
import { HomeTaskRow } from "./OrganizeMenu.js";

/** 组卡任务行（OrganizeMenu 的 OrganizeTaskRowTask 同形；避免跨文件类型环）。 */
export interface WorkspaceGroupCardTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed" | "idle";
  pinned?: boolean;
  archived?: boolean;
  unreadAtMs?: number | null;
}

/** 组卡所需的工作区形状（HomeShell 的 MobileHomeShellWorkspace 结构化满足）。 */
export interface WorkspaceGroupCardWorkspace {
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  path: string;
  updatedAtMs: number | null;
  tasks: readonly WorkspaceGroupCardTask[];
}

export function WorkspaceGroupCard({
  workspace,
  collapsed,
  selectedTaskId,
  onToggle,
  onTaskOpen,
  onWorkspaceNewTask,
}: {
  workspace: WorkspaceGroupCardWorkspace;
  collapsed: boolean;
  selectedTaskId: string | null;
  onToggle: () => void;
  onTaskOpen?: (
    task: WorkspaceGroupCardWorkspace["tasks"][number],
    workspace: WorkspaceGroupCardWorkspace,
  ) => void;
  onWorkspaceNewTask?: (workspace: WorkspaceGroupCardWorkspace) => void;
}) {
  const { formatMessage } = useIntl();
  const intl = useIntl();
  return (
    <li className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex min-w-0 items-center gap-2 px-3 py-3">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground-subtle">
            <FolderOpen aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-ui-base font-medium text-foreground">
                {workspace.name}
              </span>
              <span className="shrink-0 rounded-full border border-border bg-surface px-1.5 py-0.5 text-ui-xs leading-none text-foreground-subtle">
                {formatMessage({
                  id:
                    workspace.kind === "local"
                      ? "mobileShell.workspace.kind.local"
                      : "mobileShell.workspace.kind.remote",
                })}
              </span>
            </span>
            <span className="mt-1 block truncate font-mono text-ui-base text-foreground-subtlest">
              {workspace.path}
            </span>
            <span className="mt-1 block text-ui-base text-foreground-subtle">
              {workspace.updatedAtMs !== null
                ? formatMessage(
                    { id: "mobileShell.workspace.updatedAt" },
                    { time: formatTaskRelativeTime(workspace.updatedAtMs, intl) },
                  )
                : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-ui-base text-foreground-subtle">
            {formatMessage(
              { id: "mobileShell.workspace.taskCount" },
              { count: String(workspace.tasks.length) },
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 transition-transform", collapsed ? "-rotate-90" : "")}
            />
          </span>
        </button>
        {onWorkspaceNewTask ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-label={formatMessage({ id: "mobileShell.workspace.newTask" })}
            onClick={() => onWorkspaceNewTask(workspace)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {collapsed ? null : (
        <ul className="border-t border-card-border px-2 py-2">
          {workspace.tasks.length === 0 ? (
            <li className="px-2.5 py-2 text-ui-sm text-foreground-subtlest">
              {formatMessage({ id: "mobileShell.workspace.tasksEmpty" })}
            </li>
          ) : (
            workspace.tasks.map((task) => (
              <HomeTaskRow
                key={task.sessionId}
                task={task}
                workspace={workspace}
                selected={task.sessionId === selectedTaskId}
                onTaskOpen={onTaskOpen}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}
