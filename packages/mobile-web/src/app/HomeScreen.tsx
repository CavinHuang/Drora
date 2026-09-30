// R3 P3c 首页屏（自 App.tsx 抽出，max-lines 治理）：HomeShell + 整理菜单（偏好状态本地所有）。
// R3 P3d 任务搜索（specs/mobile-relay-r3-frontend.md §18）：放大镜入口 + 懒加载 TaskSearchPanel。
// 入口落位说明：HomeShell（D6 冻结）顶栏/分区按钮组无法插桩，放大镜入口以 48px 圆形 FAB
// 固定于右下触控区（不与壳内元素重叠、随列表滚动常驻）；面板经 React.lazy 真分包（Vite
// 动态 import 产出独立 chunk，不进首屏——spec §6 教训；条件渲染只省首帧渲染不省字节，
// 故取 lazy + Suspense）。选中任务复用既有 onTaskOpen prop 打开任务面。
// R3 P5c 实时任务活性由 App 的 useHomeSessionsIndex 归一后传入；本组件只负责窄壳。
import { lazy, Suspense, useCallback, useState } from "react";
import { Search } from "lucide-react";
import { MobileHomeShell, type MobileHomeConnectionState } from "../ui/HomeShell.js";
import { Button } from "../ui/Button.js";
import { useIntl } from "../ui/intl.js";
import {
  OrganizeMenu,
  loadHomeOrganizePreferences,
  storeHomeOrganizePreferences,
  type HomeOrganizePreferences,
} from "../ui/OrganizeMenu.js";
// 类型仅引用（import type 编译期擦除）：不把 TaskSearchPanel 模块拽进首屏 chunk。
import type { TaskSearchPanelTask } from "../ui/TaskSearchPanel.js";
import type { TaskSearchResult } from "./taskSession.js";
import type { ProjectedWorkspace } from "./entry.js";

// P3d 懒加载面：面板打开时才拉取 chunk；运行时取命名导出包成 default 供 React.lazy 消费。
const TaskSearchPanel = lazy(() =>
  import("../ui/TaskSearchPanel.js").then((module) => ({ default: module.TaskSearchPanel })),
);

export interface HomeScreenProps {
  connection: MobileHomeConnectionState;
  workspaces: ProjectedWorkspace[];
  selectedTaskId: string | null;
  isRefreshing: boolean;
  onTaskOpen: (
    task: { sessionId: string; title: string },
    workspace: { workspaceKey: string; path: string },
  ) => void;
  onRefresh: () => void;
  onThemePress: () => void;
  onLanguagePress: () => void;
  onReconnect: () => void;
  /**
   * P3d host 侧任务搜索执行器（taskSession.searchTasks 绑定 relay accessor 与工作区
   * scopes 的装配缝；桥生命周期装配归 P4 真机档）。缺省时面板回落首页投影本地标题
   * 过滤（与 relay bootstrap 同源数据，缺 snippet 能力；取舍见 TaskSearchPanel 文件头）。
   */
  onSearchTasks?: (search: string) => Promise<TaskSearchResult[]>;
}

export function HomeScreen(props: HomeScreenProps) {
  const intl = useIntl();
  const [organizePrefs, setOrganizePrefs] = useState<HomeOrganizePreferences>(
    loadHomeOrganizePreferences,
  );
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // 搜索结果 → 既有任务面链路：workspace 身份 key 按 AGENTS 规则归一
  // （workspaceIdentity?.trim() || workspacePath），path 单独透传供开桥。
  const openSearchTask = useCallback(
    (task: TaskSearchPanelTask) => {
      closeSearch();
      props.onTaskOpen(
        { sessionId: task.taskId, title: task.title },
        {
          workspaceKey: task.workspaceIdentity?.trim() || task.workspacePath,
          path: task.workspacePath,
        },
      );
    },
    [closeSearch, props.onTaskOpen],
  );
  return (
    <div className="relative">
      <MobileHomeShell
        connection={props.connection}
        workspaces={props.workspaces}
        selectedTaskId={props.selectedTaskId}
        isRefreshing={props.isRefreshing}
        organizePreferences={organizePrefs}
        onOrganize={() => setOrganizeMenuOpen((open) => !open)}
        onTaskOpen={(task, workspace) => props.onTaskOpen(task, workspace)}
        onRefresh={props.onRefresh}
        onThemePress={props.onThemePress}
        onLanguagePress={props.onLanguagePress}
        onReconnect={props.onReconnect}
      />
      {organizeMenuOpen ? (
        <div className="absolute right-3 top-14 z-20">
          <OrganizeMenu
            preferences={organizePrefs}
            onChange={(next) => {
              setOrganizePrefs(next);
              storeHomeOrganizePreferences(next);
            }}
            onClose={() => setOrganizeMenuOpen(false)}
          />
        </div>
      ) : null}
      {/* P3d 搜索入口：48px 触控目标；aria-label 用自建键（值 = 官方搜索任务文案）。 */}
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute bottom-4 right-4 z-20 size-12 rounded-full border-card-border bg-card shadow-lg"
        aria-label={intl.formatMessage({ id: "mobileShell.search.title" })}
        aria-haspopup="dialog"
        onClick={() => setSearchOpen(true)}
      >
        <Search aria-hidden="true" className="size-4" />
      </Button>
      {searchOpen ? (
        <Suspense fallback={null}>
          <TaskSearchPanel
            workspaces={props.workspaces}
            onSearchTasks={props.onSearchTasks}
            onTaskOpen={openSearchTask}
            onClose={closeSearch}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
