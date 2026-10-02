// §32.38 官方置顶区还原（specs/mobile-relay-r3-frontend.md §32.38，bundle @3986483）：
// 官方移动首页在 pinnedTasks.length>0 时渲染独立置顶区——h2「已置顶」
// （taskList.pinnedSection）+ 平铺行（aria=打开任务{title}；槽位=Pin+未读叠加徽标；
// 正文=标题+工作区名·相对时间；尾部=状态 pill）。从 HomeShell 抽出控制行数门禁。
import { Pin } from "lucide-react";
import { formatTaskRelativeTime } from "./formatRelative.js";
import { OrganizeTaskStatusPill, compareHomeTasks } from "./OrganizeMenu.js";
import { useIntl, type MobileIntl } from "./intl.js";

/** 置顶区任务（含所属工作区上下文；排序与组内同比较器）。 */
export interface PinnedSectionTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed" | "idle";
  unreadAtMs?: number | null;
  workspace: { workspaceKey: string; name: string };
}

export function sortPinnedSectionTasks<Task extends PinnedSectionTask>(
  entries: readonly Task[],
  sortBy: "created" | "updated",
): Task[] {
  return [...entries].sort((a, b) => compareHomeTasks(a, b, sortBy));
}

export function PinnedTaskSection({
  tasks,
  onTaskOpen,
}: {
  tasks: readonly PinnedSectionTask[];
  onTaskOpen?: (task: PinnedSectionTask) => void;
}) {
  const { formatMessage } = useIntl();
  const intl: MobileIntl = useIntl();
  if (tasks.length === 0) return null;
  return (
    <section className="mt-3">
      <h2 className="px-1 py-1 text-ui-base font-medium text-foreground-subtlest">
        {formatMessage({ id: "mobileShell.home.pinnedSection" })}
      </h2>
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li key={`${task.workspace.workspaceKey}\0${task.sessionId}`}>
            <button
              type="button"
              className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-left transition-colors hover:bg-surface-hover"
              aria-label={formatMessage({ id: "mobileShell.home.openTask" }, { title: task.title })}
              onClick={onTaskOpen ? () => onTaskOpen(task) : undefined}
            >
              <span className="relative flex size-4 shrink-0 items-center justify-center text-foreground-subtle">
                <Pin aria-hidden="true" className="size-4" />
                {task.unreadAtMs != null ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-base text-foreground">{task.title}</span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
                  <span className="truncate">{task.workspace.name}</span>
                  <span className="shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <span className="truncate">
                    {task.updatedAtMs !== null ? formatTaskRelativeTime(task.updatedAtMs, intl) : null}
                  </span>
                </span>
              </span>
              <OrganizeTaskStatusPill status={task.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
