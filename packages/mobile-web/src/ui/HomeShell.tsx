// R3 移动首页壳——自包含移植自 packages/ui/src/mobile/MobileHomeShell.tsx（D6 冻结 ui，
// 本包自持；结构与视觉对齐注释逐条保留，取证文件见 ui 原文件头）。
// 纯展示组件：工作区/任务数据与全部动作经 props 注入，不接数据面、不路由。
// R3 P3c 整理任务（specs/mobile-relay-r3-frontend.md §16 第 1 条）：新增
// organizePreferences/onOrganize props；organizeBy=workspace 沿工作区分组（组内按 sortBy
// 重排），=timeline 全任务平铺按任务粒度时间分桶（官方 :185584 `Trn(k.timelineTasks,
// { sortBy, now, locale })` 同构）；计数条 taskCount 随模式取对应集合。排序/分桶纯函数与
// 任务行/时间线列表渲染原语见 OrganizeMenu.tsx（本轮唯一允许的新源码文件，分工见其文件头）。
// 折叠/触控/选中态交互保持不变。
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  FolderOpen,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";
import { formatTaskRelativeTime } from "./formatRelative.js";
import {
  DEFAULT_HOME_ORGANIZE_PREFERENCES,
  HomeTaskRow,
  HomeTimelineTaskList,
  bucketHomeTasksByTime,
  compareHomeTasks,
  type HomeOrganizePreferences,
} from "./OrganizeMenu.js";

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
  /** 创建时间（P3c 整理排序/分桶用；relay tasks 有 createdAt，投影侧缺省为 null）。 */
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed";
}

export interface MobileHomeShellWorkspace {
  /** workspace 身份 key（workspaceIdentity?.trim() || workspacePath 语义，由装配方归一）。 */
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  path: string;
  updatedAtMs: number | null;
  tasks: readonly MobileHomeShellTask[];
}

export interface MobileHomeShellProps {
  connection: MobileHomeConnectionState;
  workspaces: readonly MobileHomeShellWorkspace[];
  selectedTaskId?: string | null;
  defaultCollapsedWorkspaceKeys?: readonly string[];
  isRefreshing?: boolean;
  onTaskOpen?: (task: MobileHomeShellTask, workspace: MobileHomeShellWorkspace) => void;
  onWorkspaceNewTask?: (workspace: MobileHomeShellWorkspace) => void;
  /** 首页任务整理偏好（P3c；缺省 = 官方默认 workspace/updated）。 */
  organizePreferences?: HomeOrganizePreferences;
  /** 整理菜单触发（必填：菜单开合与 OrganizeMenu 装配由调用方处理）。 */
  onOrganize: () => void;
  onRefresh?: () => void;
  onThemePress?: () => void;
  onLanguagePress?: () => void;
  onReconnect?: () => void;
  className?: string;
}

export function MobileHomeShell({
  connection,
  workspaces,
  selectedTaskId = null,
  defaultCollapsedWorkspaceKeys,
  isRefreshing = false,
  onTaskOpen,
  onWorkspaceNewTask,
  organizePreferences = DEFAULT_HOME_ORGANIZE_PREFERENCES,
  onOrganize,
  onRefresh,
  onThemePress,
  onLanguagePress,
  onReconnect,
  className,
}: MobileHomeShellProps) {
  const intl = useIntl();
  const { formatMessage, locale } = intl;
  const languageTag = locale === "zh-CN" ? "EN" : "中";
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
    () => new Set(defaultCollapsedWorkspaceKeys ?? []),
  );

  // —— P3c 整理任务：workspace 模式沿既有分组（组内按 sortBy 重排，不改动 props 序列，
  // 拷贝后排序）；timeline 模式全任务平铺（展开 task 字段并携带所属 workspace，供
  // 排序/分桶/打开回传）按任务粒度时间分桶（官方同款 Trn 输入 = 排序后任务序列）。
  // 计数条 taskCount 按模式取对应集合（workspace=各组之和 / timeline=平铺数）。
  const { organizeBy, sortBy } = organizePreferences;
  const workspaceGroups = useMemo(() => {
    if (organizeBy !== "workspace") return workspaces;
    return workspaces.map((workspace) => ({
      ...workspace,
      tasks: [...workspace.tasks].sort((a, b) => compareHomeTasks(a, b, sortBy)),
    }));
  }, [workspaces, organizeBy, sortBy]);
  const timelineEntries = useMemo(
    () =>
      workspaces.flatMap((workspace) => workspace.tasks.map((task) => ({ ...task, workspace }))),
    [workspaces],
  );
  const timelineBuckets = useMemo(
    () =>
      organizeBy === "timeline"
        ? bucketHomeTasksByTime(
            [...timelineEntries].sort((a, b) => compareHomeTasks(a, b, sortBy)),
            { sortBy, now: Date.now(), locale },
          )
        : [],
    [timelineEntries, organizeBy, sortBy, locale],
  );
  const taskTotal = useMemo(
    () =>
      organizeBy === "workspace"
        ? workspaceGroups.reduce((sum, workspace) => sum + workspace.tasks.length, 0)
        : timelineEntries.length,
    [organizeBy, workspaceGroups, timelineEntries],
  );
  const allCollapsed = workspaceGroups.length > 0 && collapsedKeys.size >= workspaceGroups.length;

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
              {formatMessage({ id: "mobileShell.home.title" })}
            </div>
            <div className="mt-1 text-ui-base text-foreground-subtle">
              {formatMessage({ id: CONNECTION_LABEL_KEYS[connection] })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {connection !== "connected" && onReconnect ? (
              <Button variant="ghost" size="sm" className="min-h-11 px-2" onClick={onReconnect}>
                {formatMessage({ id: "mobileShell.home.reconnect" })}
              </Button>
            ) : null}
            {onLanguagePress ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11"
                aria-label={formatMessage({ id: "mobileShell.home.language" })}
                onClick={onLanguagePress}
              >
                <span aria-hidden="true" className="text-ui-xs font-medium">
                  {languageTag}
                </span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              // 移动壳触控目标 ≥44px：显式放大图标按钮（覆盖 icon-sm 默认 size-6）。
              size="icon-sm"
              className="size-11"
              aria-label={formatMessage({ id: "mobileShell.home.theme" })}
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
          {formatMessage({ id: "mobileShell.home.notice" })}
        </div>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-ui-base font-medium">
              {formatMessage({ id: "mobileShell.home.sectionTitle" })}
            </h1>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {formatMessage(
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
              aria-label={formatMessage({
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
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-11"
              aria-label={formatMessage({ id: "mobileShell.home.organize" })}
              aria-haspopup="menu"
              onClick={onOrganize}
            >
              <Settings2 aria-hidden="true" className="size-3.5" />
            </Button>
            {onRefresh ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-11"
                aria-label={formatMessage({ id: "mobileShell.home.refresh" })}
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
            {formatMessage({ id: "mobileShell.home.workspaceEmpty" })}
          </div>
        ) : organizeBy === "workspace" ? (
          <ul className="mt-3 space-y-2">
            {workspaceGroups.map((workspace) => {
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
            })}
          </ul>
        ) : timelineBuckets.length === 0 ? (
          // timeline 模式空态：有工作区但全无任务（无工作区已被上方 workspaceEmpty 覆盖）。
          <div className="mt-6 flex min-h-32 items-center justify-center rounded-lg border border-card-border bg-card p-4 text-ui-base text-foreground-subtle">
            {formatMessage({ id: "taskList.noTasks" })}
          </div>
        ) : (
          // timeline 模式（P3c）：平铺任务按任务粒度八桶分节（渲染面见 OrganizeMenu.tsx）。
          <HomeTimelineTaskList
            buckets={timelineBuckets}
            selectedTaskId={selectedTaskId}
            onTaskOpen={onTaskOpen}
          />
        )}
      </div>
    </div>
  );
}
