// R3 P5b 宽壳侧栏（specs/mobile-relay-r3-frontend.md §19/P5b）。§33.18 官方活体对齐
// （CDP 探针 .tmp-probe-dom wide-1280 实测）：顶行=历史后退/前进(desktop-top-nav-back)
// +新建任务 28px 钮（无品牌文字行）；项目行右侧=list-filter「筛选和排序」+archive「归档」
// （无刷新钮）；树首节=「已置顶」（跨工作区 pinned 平铺：running 行=圆点、其余=pin 图标）；
// 底部=login-trigger「连接使用」(user)+task-settings「设置」(settings)——连接状态/主题/
// 语言入口官方宽壳不存在，随本次对齐移除（窄壳仍保留）。插件市场可点（官方 enabled）。
import { useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Blocks,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  ListFilter,
  MessageCirclePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Settings,
  TreeDeciduous,
  User,
  X,
} from "lucide-react";
import { Button } from "../Button.js";
import { cn } from "../cn.js";
import { useIntl, type MobileIntl } from "../intl.js";
import { formatTaskRelativeTime } from "../formatRelative.js";
import type { MobileHomeConnectionState } from "../HomeShell.js";
import {
  SidebarOrganizeMenu,
  type SidebarOrganizeMode,
  type SidebarSortMode,
} from "./SidebarOrganizeMenu.js";
import { SidebarRemoveWorkspaceDialog } from "./SidebarRemoveWorkspaceDialog.js";
import {
  buildSidebarProjectTree,
  type SidebarWorkspaceGroup,
  type WideShellWorkspace,
  type WideTaskOpenRequest,
  type WideWorkspaceRef,
} from "./wideShellModel.js";

export interface WideSidebarProps {
  /** §33.18 起官方宽壳侧栏无连接态显示；字段保留为装配方兼容，组件不消费。 */
  connection?: MobileHomeConnectionState;
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
  // —— P6 深面装配缝（spec §23）：全部可选、缺省不渲染入口（零回归）——
  /** 视图 organize 状态（所有者=上层 WideShell；本组件只渲染选择面）。 */
  organize?: SidebarOrganizeMode;
  /** 传入即渲染「筛选和排序」入口（官方 taskViewOptions 语义）。 */
  onOrganizeChange?: (mode: SidebarOrganizeMode) => void;
  sort?: SidebarSortMode;
  onSortChange?: (mode: SidebarSortMode) => void;
  /** 传入即渲染组行移除按钮（确认对话本组件持有 open 态，业务动作回调上层）。 */
  onWorkspaceRemove?: (workspaceKey: string) => void;
  /** 官方 addProject「添加项目」入口（缺省不渲染）。 */
  onAddProject?: () => void;
  /** 官方 showFileTree「查看文件」入口（缺省不渲染；P6 fileTree 面挂点）。 */
  onShowFileTree?: () => void;
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

export function Sidebar({
  workspaces,
  selectedTaskId = null,
  collapsed,
  onCollapsedChange,
  onTaskOpen,
  onNewTask,
  onOpenSearch,
  onReconnect,
  organize = "project",
  onOrganizeChange,
  sort,
  onSortChange,
  onWorkspaceRemove,
  onAddProject,
  onShowFileTree,
  className,
}: WideSidebarProps) {
  const intl = useIntl();
  const { formatMessage } = intl;
  const groups = useMemo(() => buildSidebarProjectTree(workspaces), [workspaces]);
  // §33.18 官方「已置顶」节：跨工作区 pinned 平铺（树首节，组列表之前）。
  const pinnedTasks = useMemo(
    () =>
      workspaces.flatMap((workspace) =>
        workspace.tasks
          .filter((task) => task.pinned === true)
          .map((task) => ({ ...task, workspace })),
      ),
    [workspaces],
  );
  // 工作组展开态为侧栏本地交互态（与窄壳 MobileHomeShell 同语义：默认全展开，不持久化）。
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // P6 深面本地交互态：视图菜单开合（organize/sort 状态所有者=上层 props）+ 移除确认目标。
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [removeTargetKey, setRemoveTargetKey] = useState<string | null>(null);
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
          aria-label={formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
          onClick={() => onCollapsedChange(false)}
        >
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label={formatMessage({ id: "workspaceSidebar.newConversation" })}
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
      {/* §33.18 官方顶行：历史后退/前进 + 新建任务（desktop-top-nav-back 语义），
          无品牌文字行；折叠钮挂行尾（官方 grip 钮 hover 显现，常驻对齐为可见图标钮）。 */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          data-testid="desktop-top-nav-back"
          aria-label={formatMessage({ id: "mobileShell.wide.navBack" })}
          onClick={() => window.history.back()}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          data-testid="desktop-top-nav-forward"
          aria-label={formatMessage({ id: "mobileShell.wide.navForward" })}
          onClick={() => window.history.forward()}
        >
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={formatMessage({ id: "taskList.newThread" })}
          disabled={!onNewTask}
          onClick={onNewTask}
        >
          <MessageCirclePlus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-7"
          aria-label={formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
          onClick={() => onCollapsedChange(true)}
        >
          <PanelLeftClose aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* §32.42 官方宽壳左栏顶部菜单行（Bin @bundle + commandCenter.open 行取证，截图对照）：
          h-8 圆角行 = 图标 + 文字 + 右侧快捷键徽标（非大按钮）；点击建任务/开搜索。 */}
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-2">
        <div
          role="group"
          aria-disabled={!onNewTask}
          className={`group inline-flex h-8 w-full shrink-0 cursor-pointer items-center justify-stretch gap-2 overflow-hidden rounded-lg pl-2.5 pr-2.5 hover:bg-surface-hover hover:text-foreground active:translate-y-0 ${
            onNewTask ? "" : "cursor-not-allowed text-foreground-subtlest hover:bg-transparent hover:text-foreground-subtlest"
          }`}
          title={onNewTask ? undefined : formatMessage({ id: "mobileShell.wide.actionPending" })}
          onClick={() => onNewTask?.()}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 text-ui-base">
            <MessageCirclePlus aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{formatMessage({ id: "taskList.newThread" })}</span>
            <span className="ml-auto shrink-0 text-ui-xs font-normal text-foreground-subtlest">
              Ctrl N
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground"
          onClick={onOpenSearch}
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">
            {formatMessage({ id: "commandCenter.open" })}
          </span>
          <span className="ml-auto shrink-0 text-ui-xs font-normal text-foreground-subtlest">
            Ctrl K
          </span>
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

      {/* 项目树：§33.18 官方行尾=list-filter「筛选和排序」+archive「归档」（无刷新钮；
          组织菜单沿用既有 onOrganizeChange 面，归档通道远控未达=无动作占位）。 */}
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-1">
        <span className="text-ui-xs font-medium text-foreground-subtlest">
          {formatMessage({ id: "workspaceSidebar.projectsSection" })}
        </span>
        <div className="flex items-center gap-0.5">
          {onShowFileTree ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              aria-label={formatMessage({ id: "workspaceSidebar.showFileTree" })}
              onClick={onShowFileTree}
            >
              <TreeDeciduous aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
          {onAddProject ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              aria-label={formatMessage({ id: "workspaceSidebar.addProject" })}
              onClick={onAddProject}
            >
              <FolderPlus aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
          {onOrganizeChange ? (
            <div className="relative">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7"
                aria-label={formatMessage({ id: "workspaceSidebar.taskViewOptions" })}
                aria-expanded={organizeMenuOpen}
                onClick={() => setOrganizeMenuOpen((open) => !open)}
              >
                <ListFilter aria-hidden="true" className="size-3.5" />
              </Button>
              {organizeMenuOpen ? (
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                  <SidebarOrganizeMenu
                    organize={organize}
                    onOrganizeChange={(mode) => {
                      onOrganizeChange(mode);
                      setOrganizeMenuOpen(false);
                    }}
                    sort={sort}
                    onSortChange={onSortChange}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={formatMessage({ id: "workspaceSidebar.archive" })}
            title={formatMessage({ id: "workspaceSidebar.archive" })}
          >
            <Archive aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* §33.18 官方树首节「已置顶」：跨工作区 pinned 平铺（行=running 圆点 / pin 图标
            +标题+相对时间，32px 行高），其后才是项目组列表。 */}
        {pinnedTasks.length > 0 ? (
          <div className="mb-1">
            <div className="px-2 py-1 text-ui-xs font-medium text-foreground-subtlest">
              {formatMessage({ id: "mobileShell.home.pinnedSection" })}
            </div>
            <ul>
              {pinnedTasks.map((task) => (
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
                      onTaskOpen?.(
                        { sessionId: task.sessionId, title: task.title },
                        task.workspace,
                      )
                    }
                  >
                    {task.status === "running" ? (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-success"
                      />
                    ) : (
                      <Pin
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-foreground-subtle"
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
              ))}
            </ul>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="px-2 py-2 text-ui-sm text-foreground-subtlest">
            {formatMessage({ id: "workspaceSidebar.noProjects" })}
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
                onRemove={onWorkspaceRemove ? setRemoveTargetKey : undefined}
              />
            ))}
          </ul>
        )}
      </div>

      {/* §33.18 官方底部：login-trigger「连接使用」(user) + task-settings「设置」(settings)。
          连接状态文字/语言/主题入口官方宽壳不存在——随对齐移除（窄壳顶栏仍保留）。 */}
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-2">
        <Button
          variant="ghost"
          className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 text-foreground-subtle"
          data-testid="login-trigger"
          aria-label={formatMessage({ id: "mobileShell.wide.login" })}
          onClick={onReconnect}
        >
          <User aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{formatMessage({ id: "mobileShell.wide.login" })}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8"
          data-testid="task-settings-button"
          aria-label={formatMessage({ id: "mobileShell.wide.settings" })}
          title={formatMessage({ id: "mobileShell.wide.settings" })}
        >
          <Settings aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {/* P6 深面：工作区移除确认（官方 dialog API 形态；组行 X 图标按钮触发）。 */}
      {onWorkspaceRemove ? (
        <>
          <SidebarRemoveWorkspaceDialog
            open={removeTargetKey !== null}
            onConfirm={() => {
              if (removeTargetKey !== null) onWorkspaceRemove(removeTargetKey);
              setRemoveTargetKey(null);
            }}
            onCancel={() => setRemoveTargetKey(null)}
          />
        </>
      ) : null}
    </nav>
  );
}
