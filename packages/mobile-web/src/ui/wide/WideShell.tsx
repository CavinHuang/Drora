// R3 P5b 宽视口全壳（specs/mobile-relay-r3-frontend.md §19/P5b）：官方断点
// `(max-width: 767px)` 取反驱动——≥768px 渲染侧栏（264px，可折叠持久化）+ 主区两栏；
// <768px 返回 null（回落既有单列壳，零回归）。主区两态：已选任务 = app 层装配的
// TaskShell 宽容器（taskSurface 槽）；无任务 = GreetingEmptyState。搜索面板懒加载
// （React.lazy 真分包，spec §6 教训；与 HomeScreen 同款装配）。
// 状态所有者：折叠态/搜索开合 = WideShell 本地（折叠持久化 Drora 化键）；任务数据 =
// App 既有 state（本组件纯展示转发，不另立数据面）。
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { GreetingEmptyState } from "./GreetingEmptyState.js";
import { useWideViewport } from "./useWideViewport.js";
import { loadSidebarCollapsed, storeSidebarCollapsed } from "./wideShellModel.js";
import type { MobileHomeConnectionState } from "../HomeShell.js";
// 类型仅引用（import type 编译期擦除）：不把 TaskSearchPanel 模块拽进首屏 chunk。
import type { TaskSearchPanelTask } from "../TaskSearchPanel.js";
import type {
  WideShellWorkspace,
  WideTaskOpenRequest,
  WideWorkspaceRef,
} from "./wideShellModel.js";

// P5b 懒加载面：面板打开时才拉取 chunk；运行时取命名导出包成 default 供 React.lazy 消费。
const TaskSearchPanel = lazy(() =>
  import("../TaskSearchPanel.js").then((module) => ({ default: module.TaskSearchPanel })),
);

export interface WideShellProps {
  connection: MobileHomeConnectionState;
  /** 工作区投影（entry.projectHomeData 产物结构化满足 WideShellWorkspace）。 */
  workspaces: readonly WideShellWorkspace[];
  selectedTaskId?: string | null;
  isRefreshing?: boolean;
  /** 已选任务面（app 层装配的 MobileTaskShell 宽容器）；null = 主区问候空态。 */
  taskSurface?: ReactNode | null;
  onTaskOpen?: (task: WideTaskOpenRequest, workspace: WideWorkspaceRef) => void;
  /** 新建任务（P5c 接 draft 链路；缺省按钮禁用，不做假动作）。 */
  onNewTask?: () => void;
  /** §32.13 宽壳草稿卡首输发送（有值 = 空态渲染 composer+chips 草稿卡）。 */
  onDraftSend?: (text: string) => void;
  /** 草稿发送中。 */
  draftSending?: boolean;
  onRefresh?: () => void;
  onThemePress?: () => void;
  onLanguagePress?: () => void;
  onReconnect?: () => void;
  /**
   * host 侧任务搜索执行器（taskSession.searchTasks 绑定缝，装配归 P4 真机档）。
   * 缺省 = TaskSearchPanel 首页投影本地标题过滤（与窄壳同降级面）。
   */
  onSearchTasks?: (search: string) => Promise<TaskSearchPanelTask[]>;
  /** P6 文件域（spec §29.5）：host 文件搜索执行器（accessor.fileService 绑定）。 */
  onSearchFiles?: (query: string) => Promise<
    { name: string; path: string; relativePath: string; type: "file" | "directory" }[]
  >;
  /** 文件结果行点击（插入 composer 引用；装配归调用方）。 */
  onFileSelect?: (entry: { path: string; relativePath: string }) => void;
  className?: string;
}

export function WideShell({
  connection,
  workspaces,
  selectedTaskId = null,
  isRefreshing = false,
  taskSurface = null,
  onTaskOpen,
  onNewTask,
  onDraftSend,
  draftSending,
  onRefresh,
  onThemePress,
  onLanguagePress,
  onReconnect,
  onSearchTasks,
    onSearchFiles,
    onFileSelect,
  className,
}: WideShellProps) {
  // 断点自持：窄视口返回 null（App 侧同样经 useWideViewport 分支，此处为组件自守）。
  const wide = useWideViewport();
  const [collapsed, setCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const changeCollapsed = useCallback((next: boolean) => {
    setCollapsed(next);
    storeSidebarCollapsed(next);
  }, []);
  if (!wide) return null;
  // 问候空态工作区名：P5b 取首个工作区投影（移动远控通常单工作区；多工作区归属细化归 P5c）。
  const workspaceName = workspaces[0]?.name ?? null;
  return (
    <div
      className={
        className ?? "flex h-dvh min-h-dvh w-full overflow-hidden bg-background text-foreground"
      }
    >
      <Sidebar
        connection={connection}
        workspaces={workspaces}
        selectedTaskId={selectedTaskId}
        isRefreshing={isRefreshing}
        collapsed={collapsed}
        onCollapsedChange={changeCollapsed}
        onTaskOpen={onTaskOpen}
        onNewTask={onNewTask}
        onOpenSearch={() => setSearchOpen(true)}
        onRefresh={onRefresh}
        onThemePress={onThemePress}
        onLanguagePress={onLanguagePress}
        onReconnect={onReconnect}
      />
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {taskSurface ?? (
          <GreetingEmptyState
            workspaceName={workspaceName}
            onNewTask={onNewTask}
            onDraftSend={onDraftSend}
            draftSending={draftSending}
          />
        )}
      </main>
      {searchOpen ? (
        <Suspense fallback={null}>
          <TaskSearchPanel
            workspaces={workspaces}
            onSearchTasks={onSearchTasks}
            onSearchFiles={onSearchFiles}
            onFileSelect={onFileSelect}
            onTaskOpen={(task: TaskSearchPanelTask) => {
              closeSearch();
              // 搜索结果 → 既有任务面链路：workspace 身份 key 按 AGENTS 规则归一透传。
              onTaskOpen?.(
                { sessionId: task.taskId, title: task.title },
                {
                  workspaceKey: task.workspaceIdentity?.trim() || task.workspacePath,
                  path: task.workspacePath,
                },
              );
            }}
            onClose={closeSearch}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
