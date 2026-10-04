// R3 P3c 首页屏（自 App.tsx 抽出，max-lines 治理）：HomeShell + 整理菜单（偏好状态本地所有）。
// §33.18 官方活体对齐（.tmp-probe-dom narrow 实测）：官方窄壳首页**无搜索入口**
//（按钮面仅 主题/收起全部/整理/刷新/任务行/组行），既有 48px 搜索 FAB 为自研附加
// ——随对齐移除；任务搜索面（TaskSearchPanel）保留给宽壳「搜索 Ctrl+K」入口
//（WideShell 装配），P3d 的懒加载分包结论不变。
// P5c 实时任务活性由 App 的 useHomeSessionsIndex 归一后传入；本组件只负责窄壳。
import { useState } from "react";
import { MobileHomeShell, type MobileHomeConnectionState } from "../ui/HomeShell.js";
import { useIntl } from "../ui/intl.js";
import {
  OrganizeMenu,
  loadHomeOrganizePreferences,
  storeHomeOrganizePreferences,
  type HomeOrganizePreferences,
} from "../ui/OrganizeMenu.js";
import type { TaskSearchResult } from "./taskSession.js";
import type { ProjectedWorkspace } from "./entry.js";

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
  /** P6 文件域（spec §29.3）：host 文件搜索执行器（accessor.fileService 绑定）。 */
  onSearchFiles?: (
    query: string,
  ) => Promise<{ name: string; path: string; relativePath: string; type: "file" | "directory" }[]>;
  /** 文件结果行点击（插入 composer 引用；装配归调用方）。 */
  onFileSelect?: (entry: { path: string; relativePath: string }) => void;
  /** P6 新建任务（spec §30）：工作区组"+"按钮 → createSession（capability 第四例）。 */
  onWorkspaceNewTask?: (workspace: { workspaceKey: string; path: string; name?: string }) => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const [organizePrefs, setOrganizePrefs] = useState<HomeOrganizePreferences>(
    loadHomeOrganizePreferences,
  );
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  return (
    <div className="relative">
      <MobileHomeShell
        connection={props.connection}
        workspaces={props.workspaces}
        defaultCollapsedWorkspaceKeys={props.workspaces
          .slice(1)
          .map((workspace) => workspace.workspaceKey)}
        selectedTaskId={props.selectedTaskId}
        isRefreshing={props.isRefreshing}
        organizePreferences={organizePrefs}
        onOrganize={() => setOrganizeMenuOpen((open) => !open)}
        onTaskOpen={(task, workspace) => props.onTaskOpen(task, workspace)}
        onRefresh={props.onRefresh}
        onThemePress={props.onThemePress}
        onReconnect={props.onReconnect}
        onWorkspaceNewTask={props.onWorkspaceNewTask}
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
    </div>
  );
}
