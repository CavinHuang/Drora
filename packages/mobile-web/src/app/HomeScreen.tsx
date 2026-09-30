// R3 P3c 首页屏（自 App.tsx 抽出，max-lines 治理）：HomeShell + 整理菜单（偏好状态本地所有）。
// R3 P3d 任务搜索（specs/mobile-relay-r3-frontend.md §18）：放大镜入口 + 懒加载 TaskSearchPanel。
// 入口落位说明：HomeShell（D6 冻结）顶栏/分区按钮组无法插桩，放大镜入口以 48px 圆形 FAB
// 固定于右下触控区（不与壳内元素重叠、随列表滚动常驻）；面板经 React.lazy 真分包（Vite
// 动态 import 产出独立 chunk，不进首屏——spec §6 教训；条件渲染只省首帧渲染不省字节，
// 故取 lazy + Suspense）。选中任务复用既有 onTaskOpen prop 打开任务面。
// R3 P5c sessions-index 实时任务活性（spec §19/P5c 第 1 条）：首页挂载期间按工作区开
// 专用桥（openSessionsIndexBridge 装配缝，App 绑定 RelayClient；缺省不接实时面零回归）
// → store 订阅 → 摘要按 phase 映射合并进任务行（投影为主，只并活性字段；draft 剔除）。
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";
import { MobileHomeShell, type MobileHomeConnectionState, type MobileHomeShellWorkspace } from "../ui/HomeShell.js";
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
import {
  mergeHomeWorkspaceLiveness,
  type LivenessMergedWorkspace,
} from "./sessionsIndexStore.js";
import type { HomeSessionsIndexBridge, TaskSearchResult } from "./taskSession.js";
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
  /**
   * P5c sessions-index 实时桥装配缝（taskSession.openHomeSessionsIndexBridge 绑定
   * RelayClient；App 持有 client）。按工作区调用，一次一桥；缺省 = 不接实时面，
   * 首页回落投影数据（零回归）。
   */
  openSessionsIndexBridge?: (
    workspacePath: string,
    workspaceIdentity?: string,
  ) => Promise<HomeSessionsIndexBridge>;
}

/**
 * P5c ui 边界收口：任务行活性 status（三值）→ MobileHomeShellTask.status（闭于
 * running|completed，src/ui 只读）。error 收口为 completed（非运行中呈现：失败的行
 * 不该保留 spinner；error 的独立呈现归 ui 联合扩宽，见文件头 spec §19 说明）。
 */
function toShellWorkspace(workspace: LivenessMergedWorkspace): MobileHomeShellWorkspace {
  return {
    workspaceKey: workspace.workspaceKey,
    name: workspace.name,
    kind: workspace.kind,
    path: workspace.path,
    updatedAtMs: workspace.updatedAtMs,
    tasks: workspace.tasks.map((task) => ({
      sessionId: task.sessionId,
      title: task.title,
      createdAtMs: task.createdAtMs,
      updatedAtMs: task.updatedAtMs,
      status: task.status === "running" ? ("running" as const) : ("completed" as const),
    })),
  };
}

export function HomeScreen(props: HomeScreenProps) {
  const intl = useIntl();
  const [organizePrefs, setOrganizePrefs] = useState<HomeOrganizePreferences>(
    loadHomeOrganizePreferences,
  );
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // —— P5c sessions-index 实时活性（spec §19/P5c 第 1 条）——
  // 桥生命周期随首页挂载：每工作区一桥一 store（openSessionsIndexBridge 装配缝）；
  // 投影工作区集变化只增量开/关（key 集签名稳定，刷新同集不重开桥）。
  const bridgesRef = useRef(
    new Map<string, { bridge: HomeSessionsIndexBridge; unsubscribe: () => void }>(),
  );
  const pendingKeysRef = useRef(new Set<string>());
  const wantedKeysRef = useRef<ReadonlySet<string>>(new Set());
  const workspacesRef = useRef(props.workspaces);
  workspacesRef.current = props.workspaces;
  // 开桥执行器走 ref（App 侧内联闭包每次渲染换身份，不能进 effect deps，否则桥全量
  // 重开形成开/关循环）；effect 生命周期只锚定工作区 key 集签名。
  const openBridgeRef = useRef(props.openSessionsIndexBridge);
  openBridgeRef.current = props.openSessionsIndexBridge;
  const [summariesByKey, setSummariesByKey] = useState<ReadonlyMap<string, readonly SessionSummary[]>>(
    () => new Map(),
  );
  // 工作区集签名：只有 key 集变化才重跑开桥 effect（workspace-list 刷新替换数组不触发）。
  const workspaceKeysSig = useMemo(
    () => props.workspaces.map((workspace) => workspace.workspaceKey).join("\u0000"),
    [props.workspaces],
  );

  useEffect(() => {
    const openBridge = openBridgeRef.current;
    if (!openBridge) return;
    const bridges = bridgesRef.current;
    const pending = pendingKeysRef.current;
    let disposed = false;
    const wanted = new Set(workspacesRef.current.map((workspace) => workspace.workspaceKey));
    wantedKeysRef.current = wanted;
    const dropSummaries = (key: string) => {
      setSummariesByKey((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    };
    // 关闭已从投影移除的工作区桥（key 集签名变化才会到这里）；Map 迭代中删除当前项安全。
    for (const [key, entry] of bridges) {
      if (wanted.has(key)) continue;
      bridges.delete(key);
      entry.unsubscribe();
      void entry.bridge.close().catch(() => {});
      dropSummaries(key);
    }
    for (const workspace of workspacesRef.current) {
      const key = workspace.workspaceKey;
      if (bridges.has(key) || pending.has(key)) continue;
      pending.add(key);
      // identity 归一：workspaceKey 与 path 不同 = 远程 identity（AGENTS 规则）。
      const identity = key !== workspace.path ? key : undefined;
      void openBridge(workspace.path, identity)
        .then(async (bridge) => {
          // 发起订阅（open 只挂帧面）：existing-only 稳定拒绝返回 null → 首页降级为
          // 投影数据（无活性、不重试、不拉起 runtime），store 守卫继续丢弃所有帧。
          await bridge.start();
          if (disposed || !wantedKeysRef.current.has(key)) {
            // 卸载/换代竞态：立即收口，不登记（openBridge 失败已在 catch 清占位）。
            void bridge.close().catch(() => {});
            return;
          }
          const publish = () => {
            const summaries = bridge.store.getSessionSummaries();
            setSummariesByKey((prev) =>
              prev.get(key) === summaries ? prev : new Map(prev).set(key, summaries),
            );
          };
          const unsubscribe = bridge.store.subscribe(publish);
          bridges.set(key, { bridge, unsubscribe });
          // initial snapshot 可能先于本回调到达（start 已完成订阅），先同步一次。
          publish();
        })
        .catch(() => {
          // 开桥失败（结构性）：清占位即可，首页回落投影数据，不打断渲染。
          pending.delete(key);
        });
    }
    return () => {
      disposed = true;
      for (const [, entry] of bridges) {
        entry.unsubscribe();
        void entry.bridge.close().catch(() => {});
      }
      bridges.clear();
      pending.clear();
      setSummariesByKey(new Map());
    };
    // deps 用「装配缝是否存在」而非函数身份（App 内联闭包每次渲染换身份，进 deps 会
    // 触发桥全量重开循环）；执行器本体经 openBridgeRef 读取。
  }, [workspaceKeysSig, props.openSessionsIndexBridge !== undefined]);

  // 活性合并（数据源以 bootstrap/list 投影为主，sessions-index 只并活性字段）。
  const mergedWorkspaces = useMemo(
    () =>
      props.workspaces.map((workspace) =>
        mergeHomeWorkspaceLiveness(workspace, summariesByKey.get(workspace.workspaceKey) ?? []),
      ),
    [props.workspaces, summariesByKey],
  );
  // ui 任务行 status 面闭于 running|completed（src/ui 只读）：error 三值在本边界收口。
  const shellWorkspaces = useMemo(() => mergedWorkspaces.map(toShellWorkspace), [mergedWorkspaces]);

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
        workspaces={shellWorkspaces}
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
