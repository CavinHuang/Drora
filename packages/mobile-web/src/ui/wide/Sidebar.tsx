// R3 P5b 宽壳侧栏（specs/mobile-relay-r3-frontend.md §19/P5b）：结构/视觉参照
// packages/ui/src/WorkspaceSidebar.tsx（D6 冻结，只读参照不 import）——顶品牌区 /
// 新建任务 / 搜索入口 / 插件市场占位（disabled，P5c）/ 项目树（分组+任务数，点击工作区
// = 展开折叠、点击任务 = onTaskOpen）/ 底部用户页脚占位（P5c 接用量）。
// 纯展示：数据与动作经 props 注入；折叠态归 WideShell 所有（持久化见 wideShellModel）。
// 连接状态/主题/语言入口收在页脚（窄壳 HomeShell 顶栏职责的宽壳对位，避免宽壳丢功能）。
import { useMemo, useState } from "react";
import {
  Blocks,
  ChevronDown,
  CircleUserRound,
  FolderOpen,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "../Button.js";
import { cn } from "../cn.js";
import { useIntl, type MobileIntl } from "../intl.js";
import { formatTaskRelativeTime } from "../formatRelative.js";
import type { MobileHomeConnectionState } from "../HomeShell.js";
import {
  buildSidebarProjectTree,
  type SidebarWorkspaceGroup,
  type WideShellWorkspace,
  type WideTaskOpenRequest,
  type WideWorkspaceRef,
} from "./wideShellModel.js";

const CONNECTION_LABEL_KEYS: Record<MobileHomeConnectionState, string> = {
  connected: "mobileShell.connection.connected",
  connecting: "mobileShell.connection.connecting",
  reconnecting: "mobileShell.connection.reconnecting",
  disconnected: "mobileShell.connection.disconnected",
};

export interface WideSidebarProps {
  connection: MobileHomeConnectionState;
  workspaces: readonly WideShellWorkspace[];
  selectedTaskId?: string | null;
  /** 刷新进行中（项目区刷新按钮禁用 + 旋转指示，窄壳 HomeShell 同语义）。 */
  isRefreshing?: boolean;
  /** 折叠态（所有者 = WideShell，持久化 Drora 化键）。 */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onTaskOpen?: (task: WideTaskOpenRequest, workspace: WideWorkspaceRef) => void;
  /** 新建任务（P5c 接 draft 链路；缺省按钮禁用，不做假动作）。 */
  onNewTask?: () => void;
  /** 搜索入口（TaskSearchPanel 开合归 WideShell）。 */
  onOpenSearch: () => void;
  onRefresh?: () => void;
  onThemePress?: () => void;
  onLanguagePress?: () => void;
  onReconnect?: () => void;
  className?: string;
}

/** 项目树工作区组（组头点击 = 展开折叠；组内任务行点击 = 打开任务面）。 */
function SidebarWorkspaceSection({
  group,
  intl,
  selectedTaskId,
  collapsed,
  onToggle,
  onTaskOpen,
}: {
  group: SidebarWorkspaceGroup;
  intl: MobileIntl;
  selectedTaskId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onTaskOpen?: (task: WideTaskOpenRequest, workspace: WideWorkspaceRef) => void;
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
      </button>
      {collapsed ? null : (
        <ul className="ml-4 border-l border-border pl-1">
          {group.tasks.length === 0 ? (
            <li className="px-2 py-1.5 text-ui-xs text-foreground-subtlest">
              {formatMessage({ id: "mobileShell.workspace.tasksEmpty" })}
            </li>
          ) : (
            group.tasks.map((task) => {
              const selected = task.sessionId === selectedTaskId;
              return (
                <li key={task.sessionId}>
                  <button
                    type="button"
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

export function Sidebar({
  connection,
  workspaces,
  selectedTaskId = null,
  isRefreshing = false,
  collapsed,
  onCollapsedChange,
  onTaskOpen,
  onNewTask,
  onOpenSearch,
  onRefresh,
  onThemePress,
  onLanguagePress,
  onReconnect,
  className,
}: WideSidebarProps) {
  const intl = useIntl();
  const { formatMessage, locale } = intl;
  const languageTag = locale === "zh-CN" ? "EN" : "中";
  const groups = useMemo(() => buildSidebarProjectTree(workspaces), [workspaces]);
  // 工作组展开态为侧栏本地交互态（与窄壳 MobileHomeShell 同语义：默认全展开，不持久化）。
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleGroup = (workspaceKey: string) => {
    setCollapsedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceKey)) next.delete(workspaceKey);
      else next.add(workspaceKey);
      return next;
    });
  };

  if (collapsed) {
    // 折叠轨（官方 WorkspaceSidebarCollapsedRail 对位）：仅图标入口，树/页脚收起。
    return (
      <nav
        aria-label={formatMessage({ id: "mobileShell.wide.sidebar" })}
        className={cn(
          "flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-header py-2",
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label={formatMessage({ id: "mobileShell.wide.expandSidebar" })}
          onClick={() => onCollapsedChange(false)}
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label={formatMessage({ id: "mobileShell.wide.newTask" })}
          disabled={!onNewTask}
          onClick={onNewTask}
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label={formatMessage({ id: "mobileShell.wide.search" })}
          onClick={onOpenSearch}
        >
          <Search aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label={formatMessage({ id: "mobileShell.wide.plugins" })}
          disabled
        >
          <Blocks aria-hidden="true" className="size-4" />
        </Button>
      </nav>
    );
  }

  return (
    <nav
      aria-label={formatMessage({ id: "mobileShell.wide.sidebar" })}
      className={cn(
        "flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-header",
        className,
      )}
    >
      {/* 顶品牌区 + 折叠开关。 */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <span className="min-w-0 flex-1 truncate text-ui-base font-medium">
          {formatMessage({ id: "mobileShell.wide.brand" })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8"
          aria-label={formatMessage({ id: "mobileShell.wide.collapseSidebar" })}
          onClick={() => onCollapsedChange(true)}
        >
          <PanelLeftClose aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* 新建任务 / 搜索 / 插件市场占位（官方同序；插件商店接线归 P5c）。 */}
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-2">
        <Button
          variant="outline"
          className="min-h-9 w-full justify-start gap-2 border-transparent bg-primary px-3 text-primary-foreground hover:opacity-90"
          disabled={!onNewTask}
          title={onNewTask ? undefined : formatMessage({ id: "mobileShell.wide.actionPending" })}
          onClick={onNewTask}
        >
          <Plus aria-hidden="true" className="size-4" />
          {formatMessage({ id: "mobileShell.wide.newTask" })}
        </Button>
        <Button
          variant="ghost"
          className="min-h-9 w-full justify-start gap-2 px-3 text-foreground hover:bg-surface-hover"
          onClick={onOpenSearch}
        >
          <Search aria-hidden="true" className="size-4" />
          {formatMessage({ id: "mobileShell.wide.search" })}
        </Button>
        <Button
          variant="ghost"
          className="min-h-9 w-full justify-start gap-2 px-3 text-foreground-subtle"
          disabled
          title={formatMessage({ id: "mobileShell.wide.actionPending" })}
        >
          <Blocks aria-hidden="true" className="size-4" />
          {formatMessage({ id: "mobileShell.wide.plugins" })}
        </Button>
      </div>

      {/* 项目树：分组 + 任务数（P5c 接 sessions-index 实时数）。 */}
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-1">
        <span className="text-ui-xs font-medium text-foreground-subtlest">
          {formatMessage({ id: "mobileShell.wide.projectsSection" })}
        </span>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <div className="px-2 py-2 text-ui-sm text-foreground-subtlest">
            {formatMessage({ id: "mobileShell.home.workspaceEmpty" })}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {groups.map((group) => (
              <SidebarWorkspaceSection
                key={group.workspaceKey}
                group={group}
                intl={intl}
                selectedTaskId={selectedTaskId}
                collapsed={collapsedGroupKeys.has(group.workspaceKey)}
                onToggle={() => toggleGroup(group.workspaceKey)}
                onTaskOpen={onTaskOpen}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 底部页脚：用户占位（P5c 接用量/账户）+ 连接状态与主题/语言（窄壳顶栏职责对位）。 */}
      <div className="shrink-0 border-t border-border px-2 py-2">
        <div className="flex min-h-8 items-center gap-2 rounded-md px-2 text-foreground-subtle">
          <CircleUserRound aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-ui-sm">
            {formatMessage({ id: "mobileShell.wide.userFooter" })}
          </span>
        </div>
        <div className="mt-1 flex min-h-8 items-center gap-1 px-2">
          <button
            type="button"
            className={cn(
              "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-ui-xs text-foreground-subtle",
              connection !== "connected" && onReconnect
                ? "hover:bg-surface-hover"
                : "cursor-default",
            )}
            disabled={connection === "connected" || !onReconnect}
            onClick={onReconnect}
          >
            {formatMessage({ id: CONNECTION_LABEL_KEYS[connection] })}
          </button>
          {onLanguagePress ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8"
              aria-label={formatMessage({ id: "mobileShell.home.language" })}
              onClick={onLanguagePress}
            >
              <span aria-hidden="true" className="text-ui-xs font-medium">
                {languageTag}
              </span>
            </Button>
          ) : null}
          {onThemePress ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8"
              aria-label={formatMessage({ id: "mobileShell.home.theme" })}
              onClick={onThemePress}
            >
              <Palette aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
