import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  CircleCheck,
  FolderOpen,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";

/**
 * R3 移动首页壳（spec specs/mobile-relay-r3-frontend.md §2「移动首页」、D1）。
 *
 * 纯展示组件：工作区/任务数据与全部动作经 props 注入，不接数据面、不路由。
 * 视觉对齐官方 3.14.3 实机 DOM（.tmp-work/official-live-mobile-home.html）：
 * bg-header 顶栏 + 说明卡 + 「当前设备上的工作区和任务」聚合区 + 工作区分组折叠列表 + 任务行。
 * 相对时间复用 lib/taskListItemPresentation 的 formatTaskRelativeTime（taskList.* 官方对齐键）。
 *
 * 触控目标 ≥44px：本壳内独立图标按钮统一放大到 size-11（44px，移动壳显式覆盖桌面按钮
 * 尺寸系统，任务硬性要求）；任务行沿用官方 min-h-12。
 */

export type MobileHomeConnectionState =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected";

const CONNECTION_LABEL_KEYS: Record<MobileHomeConnectionState, string> = {
  connected: "mobileShell.connection.connected",
  connecting: "mobileShell.connection.connecting",
  reconnecting: "mobileShell.connection.reconnecting",
  disconnected: "mobileShell.connection.disconnected",
};

export interface MobileHomeShellTask {
  /** 会话 id（透传给 onTaskOpen，装配方据此路由）。 */
  sessionId: string;
  title: string;
  /** 最近更新时间（epoch ms）；null 时时间位留空。 */
  updatedAtMs: number | null;
  /** 状态 pill：运行中（accent + 旋转 loader）/ 已完成（success + 对勾）。 */
  status: "running" | "completed";
}

export interface MobileHomeShellWorkspace {
  /** workspace 身份 key（workspaceIdentity?.trim() || workspacePath 语义，由装配方归一）。 */
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  /** 本地或远程路径展示（font-mono 行）。 */
  path: string;
  updatedAtMs: number | null;
  tasks: readonly MobileHomeShellTask[];
}

export interface MobileHomeShellProps {
  /** 顶栏连接徽章状态（官方「已连接到当前桌面窗口/未连接/连接中/重新连接中」）。 */
  connection: MobileHomeConnectionState;
  /** 工作区聚合数据（顺序即展示顺序，排序由装配方决定）。 */
  workspaces: readonly MobileHomeShellWorkspace[];
  /** 当前选中任务（官方选中态 bg-selected）。 */
  selectedTaskId?: string | null;
  /** 初始收起的工作区 key 集合；缺省全部展开。 */
  defaultCollapsedWorkspaceKeys?: readonly string[];
  /** 刷新进行中：刷新按钮禁用并切换 loader。 */
  isRefreshing?: boolean;
  onTaskOpen?: (task: MobileHomeShellTask, workspace: MobileHomeShellWorkspace) => void;
  /** 工作区内新建任务（官方卡片右侧 outline + 加号位）。 */
  onWorkspaceNewTask?: (workspace: MobileHomeShellWorkspace) => void;
  /** 「整理任务」操作位（菜单本体由装配方挂载）。 */
  onOrganize?: () => void;
  onRefresh?: () => void;
  /** 顶栏主题按钮操作位（主题菜单本体由装配方挂载）。 */
  onThemePress?: () => void;
  /** 未连接/连接中断时的手动重连动作；提供时在连接徽章旁渲染「重新连接」。 */
  onReconnect?: () => void;
  className?: string;
}

/** 任务行状态 pill（官方 shell：rounded-full border px-1.5 py-0.5 text-ui-xs）。 */
function TaskStatusPill({ status }: { status: MobileHomeShellTask["status"] }) {
  const { intl } = useZCodeIntl();
  const running = status === "running";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-ui-xs leading-none",
        running
          ? "border-brand/40 bg-accent text-foreground"
          : "border-success/40 bg-success text-success-foreground",
      )}
    >
      {running ? (
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
      ) : (
        <CircleCheck aria-hidden="true" className="size-3" />
      )}
      {intl.formatMessage({
        id: running ? "mobileShell.task.status.running" : "mobileShell.task.status.completed",
      })}
    </span>
  );
}

export function MobileHomeShell({
  connection,
  workspaces,
  selectedTaskId = null,
  defaultCollapsedWorkspaceKeys,
  isRefreshing = false,
  onTaskOpen,
  onWorkspaceNewTask,
  onOrganize,
  onRefresh,
  onThemePress,
  onReconnect,
  className,
}: MobileHomeShellProps) {
  const { intl } = useZCodeIntl();
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
    () => new Set(defaultCollapsedWorkspaceKeys ?? []),
  );

  const taskTotal = useMemo(
    () => workspaces.reduce((sum, workspace) => sum + workspace.tasks.length, 0),
    [workspaces],
  );
  const allCollapsed = workspaces.length > 0 && collapsedKeys.size >= workspaces.length;

  const toggleWorkspace = (workspaceKey: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceKey)) {
        next.delete(workspaceKey);
      } else {
        next.add(workspaceKey);
      }
      return next;
    });
  };

  const toggleAllWorkspaces = () => {
    setCollapsedKeys(() =>
      allCollapsed
        ? new Set<string>()
        : new Set(workspaces.map((workspace) => workspace.workspaceKey)),
    );
  };

  return (
    <div
      className={cn(
        "flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      {/* 顶栏：标题 + 连接徽章 + 主题按钮（官方 bg-header px-4 py-3 结构）。 */}
      <header className="shrink-0 border-b border-border bg-header px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-ui-lg font-medium">
              {intl.formatMessage({ id: "mobileShell.home.title" })}
            </div>
            <div className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: CONNECTION_LABEL_KEYS[connection] })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {connection !== "connected" && onReconnect ? (
              <Button variant="ghost" size="sm" className="min-h-11 px-2" onClick={onReconnect}>
                {intl.formatMessage({ id: "mobileShell.home.reconnect" })}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              // 移动壳触控目标 ≥44px：显式放大图标按钮（覆盖 icon-sm 默认 size-6）。
              size="icon-sm"
              className="size-11"
              aria-label={intl.formatMessage({ id: "mobileShell.home.theme" })}
              onClick={onThemePress}
            >
              <Palette aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* 单列滚动主体（官方 px-3 py-3）。 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="rounded-lg border border-card-border bg-card p-3 text-ui-base/relaxed text-foreground-subtle">
          {intl.formatMessage({ id: "mobileShell.home.notice" })}
        </div>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-ui-base font-medium">
              {intl.formatMessage({ id: "mobileShell.home.sectionTitle" })}
            </h1>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage(
                { id: "mobileShell.home.summary" },
                { workspaceCount: String(workspaces.length), taskCount: String(taskTotal) },
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-11"
              aria-label={intl.formatMessage({
                id: allCollapsed ? "mobileShell.home.expandAll" : "mobileShell.home.collapseAll",
              })}
              disabled={workspaces.length === 0}
              onClick={toggleAllWorkspaces}
            >
              {allCollapsed ? (
                <ChevronsDown aria-hidden="true" className="size-3.5" />
              ) : (
                <ChevronsUp aria-hidden="true" className="size-3.5" />
              )}
            </Button>
            {onOrganize ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11"
                aria-label={intl.formatMessage({ id: "mobileShell.home.organize" })}
                aria-haspopup="menu"
                onClick={onOrganize}
              >
                <Settings2 aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            {onRefresh ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11"
                aria-label={intl.formatMessage({ id: "mobileShell.home.refresh" })}
                disabled={isRefreshing}
                onClick={onRefresh}
              >
                {isRefreshing ? (
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            ) : null}
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="mt-6 flex min-h-32 items-center justify-center rounded-lg border border-card-border bg-card p-4 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "mobileShell.home.workspaceEmpty" })}
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {workspaces.map((workspace) => {
              const collapsed = collapsedKeys.has(workspace.workspaceKey);
              return (
                <li
                  key={workspace.workspaceKey}
                  className="overflow-hidden rounded-lg border border-card-border bg-card"
                >
                  <div className="flex min-w-0 items-center gap-2 px-3 py-3">
                    <button
                      type="button"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={!collapsed}
                      onClick={() => toggleWorkspace(workspace.workspaceKey)}
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
                            {intl.formatMessage({
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
                            ? intl.formatMessage(
                                { id: "mobileShell.workspace.updatedAt" },
                                {
                                  time: formatTaskRelativeTime(workspace.updatedAtMs, intl),
                                },
                              )
                            : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-ui-base text-foreground-subtle">
                        {intl.formatMessage(
                          { id: "mobileShell.workspace.taskCount" },
                          { count: String(workspace.tasks.length) },
                        )}
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "size-4 transition-transform",
                            collapsed ? "-rotate-90" : "",
                          )}
                        />
                      </span>
                    </button>
                    {onWorkspaceNewTask ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        aria-label={intl.formatMessage({ id: "mobileShell.workspace.newTask" })}
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
                          {intl.formatMessage({ id: "mobileShell.workspace.tasksEmpty" })}
                        </li>
                      ) : (
                        workspace.tasks.map((task) => {
                          const selected = task.sessionId === selectedTaskId;
                          return (
                            <li key={task.sessionId}>
                              <button
                                type="button"
                                className={cn(
                                  "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
                                  selected
                                    ? "bg-selected text-foreground"
                                    : "hover:bg-surface-hover",
                                )}
                                onClick={onTaskOpen ? () => onTaskOpen(task, workspace) : undefined}
                              >
                                <span className="relative flex size-4 shrink-0 items-center justify-center" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-ui-base text-foreground">
                                    {task.title}
                                  </span>
                                  <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
                                    <span className="truncate">
                                      {task.updatedAtMs !== null
                                        ? formatTaskRelativeTime(task.updatedAtMs, intl)
                                        : null}
                                    </span>
                                  </span>
                                </span>
                                <TaskStatusPill status={task.status} />
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
