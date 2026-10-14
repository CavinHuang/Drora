// 宽壳侧栏纯渲染行（spec §33.18.24）：状态由 Sidebar 持有，点击意图经 props 回传。
import { ChevronDown, FolderOpen, Pin, X } from "lucide-react";
import { cn } from "../cn.js";
import { formatTaskRelativeTime } from "../formatRelative.js";
import type { MobileIntl } from "../intl.js";
import type {
  SidebarWorkspaceGroup,
  WideShellWorkspace,
  WideTaskOpenRequest,
  WideWorkspaceRef,
} from "./wideShellModel.js";

/** 项目树工作区组（组头点击 = 展开折叠；组内任务行点击 = 打开任务面）。 */
export function SidebarWorkspaceSection({
  group,
  intl,
  selectedTaskId,
  collapsed,
  onToggle,
  onTaskOpen,
  onRemove,
}: {
  group: SidebarWorkspaceGroup;
  intl: MobileIntl;
  selectedTaskId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onTaskOpen?: (task: WideTaskOpenRequest, workspace: WideWorkspaceRef) => void;
  onRemove?: (workspaceKey: string) => void;
}) {
  const { formatMessage } = intl;
  return (
    <li>
      <button
        type="button"
        className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors hover:bg-surface-hover"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-foreground-subtle transition-transform",
            collapsed && "-rotate-90",
          )}
        />
        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle" />
        <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{group.name}</span>
        {group.runningCount > 0 ? (
          <span
            aria-label={formatMessage({ id: "mobileShell.task.status.running" })}
            className="size-1.5 shrink-0 rounded-full bg-success"
          />
        ) : null}
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">{group.taskCount}</span>
        {onRemove ? (
          <span
            role="button"
            tabIndex={0}
            data-testid={`sidebar-remove-${group.workspaceKey}`}
            aria-label={formatMessage({ id: "workspaceSidebar.remove" })}
            className="shrink-0 rounded p-0.5 text-foreground-subtlest hover:bg-surface-hover hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(group.workspaceKey);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                onRemove(group.workspaceKey);
              }
            }}
          >
            <X aria-hidden="true" className="size-3.5" />
          </span>
        ) : null}
      </button>
      {collapsed ? null : (
        <ul className="ml-4 border-l border-border pl-1">
          {group.tasks.length === 0 ? (
            <li className="px-2 py-1.5 text-ui-xs text-foreground-subtlest">
              {formatMessage({ id: "workspaceSidebar.noConversations" })}
            </li>
          ) : (
            group.tasks.map((task) => {
              const selected = task.sessionId === selectedTaskId;
              return (
                <li key={task.sessionId}>
                  <button
                    type="button"
                    // §33.18 官方活体：侧栏任务行同 narrow 行契约（task-item-{id} /
                    // 打开任务 {title}，wide 探针实测）。
                    data-testid={`task-item-${task.sessionId}`}
                    aria-label={formatMessage(
                      { id: "mobileShell.home.openTask" },
                      { title: task.title || task.sessionId },
                    )}
                    className={cn(
                      "flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-hover",
                      selected && "bg-selected",
                    )}
                    onClick={() => onTaskOpen?.(task, group)}
                  >
                    {task.status === "running" ? (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-success"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-transparent"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
                      {task.title || task.sessionId}
                    </span>
                    <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                      {task.updatedAtMs !== null
                        ? formatTaskRelativeTime(task.updatedAtMs, intl)
                        : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </li>
  );
}

type WidePinnedTask = WideShellWorkspace["tasks"][number] & { workspace: WideShellWorkspace };

/** 官方树首节「已置顶」：跨工作区平铺，先于项目组列表。 */
export function SidebarPinnedSection({
  tasks,
  intl,
  selectedTaskId,
  onTaskOpen,
}: {
  tasks: readonly WidePinnedTask[];
  intl: MobileIntl;
  selectedTaskId: string | null;
  onTaskOpen?: (task: WideTaskOpenRequest, workspace: WideWorkspaceRef) => void;
}) {
  if (tasks.length === 0) return null;
  const { formatMessage } = intl;
  return (
    <div className="mb-1">
      <div className="px-2 py-1 text-ui-xs font-medium text-foreground-subtlest">
        {formatMessage({ id: "mobileShell.home.pinnedSection" })}
      </div>
      <ul>
        {tasks.map((task) => (
          <li key={task.sessionId}>
            <button
              type="button"
              data-testid={`task-item-${task.sessionId}`}
              aria-label={formatMessage(
                { id: "mobileShell.home.openTask" },
                { title: task.title || task.sessionId },
              )}
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg py-1 pl-2.5 pr-1 text-left transition-colors hover:bg-surface-hover",
                task.sessionId === selectedTaskId && "bg-selected",
              )}
              onClick={() =>
                onTaskOpen?.({ sessionId: task.sessionId, title: task.title }, task.workspace)
              }
            >
              {task.status === "running" ? (
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
              ) : (
                <Pin aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
                {task.title || task.sessionId}
              </span>
              <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                {task.updatedAtMs !== null ? formatTaskRelativeTime(task.updatedAtMs, intl) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
