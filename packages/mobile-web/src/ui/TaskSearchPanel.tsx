// R3 P3d 命令面板第一档——首页任务搜索半面板（specs/mobile-relay-r3-frontend.md §18）。
// 对齐桌面 CommandCenter 的「最近任务 + 搜索历史」半面板；桌面 cmdk 壳（QuickPickCommand.run
// 走宿主能力闭包、scope 前缀 > # @）不可移植，官方 9 类 category 裁为单 tab（spec §18 有意
// 分歧）。数据面两态：无 query 列最近任务、有 query 走搜索——执行器由本组件装配：host 侧
// taskSession.searchTasks 的注入投影（onSearchTasks，App 装配归 P4）优先，缺省回落首页
// 投影本地标题过滤（与 relay bootstrap/workspace-list 同源数据，缺 snippet 能力，降级面
// 由 searchPalette.test 锚定）。搜索历史纯函数见 searchHistory.ts（ZCode 化键）。
// 受控纯展示基线同 ModelMenu：打开状态归调用方（HomeScreen 懒加载装配），本组件只发意图。
import type { WorkspaceFileEntry } from "@zcode/shared";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";
import { useIntl, type MobileIntl } from "./intl.js";
import { formatTaskRelativeTime } from "./formatRelative.js";
import { FileIconImage } from "./FileChip.js";
import { fileIconNameFor, fileIconSrc } from "./fileIcon.js";
import { compareHomeTasks } from "./OrganizeMenu.js";
import {
  MOBILE_SEARCH_HISTORY_STORAGE_KEY,
  addSearchHistory,
  loadSearchHistory,
  type SearchHistoryEntry,
} from "./searchHistory.js";

/** 搜索结果行（taskSession.TaskSearchResult 的结构同形面 + 首页投影降级行的公共形状）。 */
export interface TaskSearchPanelTask {
  taskId: string;
  title: string;
  snippet: string | null;
  updatedAtMs: number | null;
  /** 归属工作区定位字段（打开任务面回传不丢归属；AGENTS Workspace Identity 规则）。 */
  workspacePath: string;
  workspaceIdentity?: string;
}

/** 首页投影（ProjectedWorkspace/ProjectedTask）满足的最小结构面（结构化赋值，不反向 import app）。 */
export interface TaskSearchSourceTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

export interface TaskSearchSourceWorkspace {
  workspaceKey: string;
  path: string;
  tasks: readonly TaskSearchSourceTask[];
}

export interface TaskSearchPanelProps {
  /**
   * 首页工作区投影（最近任务两态数据源 + host 执行器缺位时的本地过滤面；
   * ProjectedWorkspace 结构化满足）。缺省 = 无本地数据（仍可用 host 执行器）。
   */
  workspaces?: readonly TaskSearchSourceWorkspace[];
  /**
   * host 侧任务搜索执行器（taskSession.searchTasks 绑定 accessor 与工作区 scopes 的
   * 投影；失败已在其内收敛为 []）。缺省 = 首页投影本地标题过滤（装配归 P4，见文件头）。
   */
  onSearchTasks?: (search: string) => Promise<TaskSearchPanelTask[]>;
  /** 选中任务（打开任务面；开合与路由收口在调用方）。 */
  onTaskOpen: (task: TaskSearchPanelTask) => void;
  /**
   * P6 文件域（spec §29.3）：host 文件搜索执行器（accessor.fileService.searchWorkspaceFiles
   * 绑定；失败已在其内收敛为 []）。缺省 = 不查文件域（任务-only 零回归）。
   */
  onSearchFiles?: (query: string) => Promise<WorkspaceFileEntry[]>;
  /** 文件结果行点击（官方 workspaceFileTree.addToChat 语义=插入 composer 引用；装配归调用方）。 */
  onFileSelect?: (entry: WorkspaceFileEntry) => void;
  /** 关闭请求（遮罩点击 / Escape / 关闭按钮；打开状态归调用方）。 */
  onClose: () => void;
  /** 历史存储键（缺省 = ZCode 化单键；注入便于测试隔离）。 */
  historyKey?: string;
  className?: string;
}

/** 本地结果上限（与 host 侧 TASK_SEARCH_LIST_LIMIT 同值；投影可能超出，需本地截断）。 */
export const TASK_SEARCH_RESULT_LIMIT = 20;

/** 无 query 态与有 query 态共用的防抖窗口（host 全文搜索 + 本地过滤同窗）。 */
const TASK_SEARCH_DEBOUNCE_MS = 300;

/**
 * 首页投影 → 搜索结果行（纯函数，node:test 直测）：全工作区平铺 → query 非空时按标题
 * 大小写不敏感包含过滤 → 复用官方任务比较器按 updated 降序（OrganizeMenu.compareHomeTasks
 * 同源，含并列 taskId 兜底）→ 截到 limit。定位字段随行携带：workspaceKey 按
 * workspaceIdentity?.trim() || workspacePath 归一，仅在与 path 不同（即远程身份）时携带。
 */
export function collectHomeSearchTasks(
  workspaces: readonly TaskSearchSourceWorkspace[],
  query: string,
  limit: number = TASK_SEARCH_RESULT_LIMIT,
): TaskSearchPanelTask[] {
  const needle = query.trim().toLocaleLowerCase();
  const flat = workspaces.flatMap((workspace) =>
    workspace.tasks.map((task) => ({ workspace, task })),
  );
  flat.sort((a, b) => compareHomeTasks(a.task, b.task, "updated"));
  const rows: TaskSearchPanelTask[] = [];
  for (const { workspace, task } of flat) {
    if (needle !== "" && !task.title.toLocaleLowerCase().includes(needle)) {
      continue;
    }
    rows.push({
      taskId: task.sessionId,
      title: task.title || task.sessionId,
      snippet: null,
      updatedAtMs: task.updatedAtMs,
      workspacePath: workspace.path,
      ...(workspace.workspaceKey !== workspace.path
        ? { workspaceIdentity: workspace.workspaceKey }
        : {}),
    });
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

/** 任务行（48px 触控目标，与 HomeTaskRow 同布局语言：标题 + 片段截断 + 相对时间）。 */
function SearchTaskRow({
  task,
  intl,
  onTaskOpen,
}: {
  task: TaskSearchPanelTask;
  intl: MobileIntl;
  onTaskOpen: (task: TaskSearchPanelTask) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
        onClick={() => onTaskOpen(task)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base text-foreground">{task.title}</span>
          {task.snippet ? (
            <span className="mt-0.5 block truncate text-ui-xs text-foreground-subtle">
              {task.snippet}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
          {task.updatedAtMs !== null ? formatTaskRelativeTime(task.updatedAtMs, intl) : null}
        </span>
      </button>
    </li>
  );
}

/**
 * 首页任务搜索半面板：顶部下拉卡片（输入行 + 滚动内容区），遮罩点击 / Escape / 关闭按钮
 * 三路 onClose。内容区两态——无 query：搜索历史 chips（点击回填即搜）+ 最近任务；
 * 有 query：结果列表或空态文案。搜索提交（Enter / chip）入历史（去重去旧见 searchHistory）。
 * 查询防抖 300ms + 请求序号守卫（仅最新查询回灌，乱序响应丢弃）。
 */
export function TaskSearchPanel({
  workspaces = [],
  onSearchTasks,
  onSearchFiles,
  onFileSelect,
  onTaskOpen,
  onClose,
  historyKey = MOBILE_SEARCH_HISTORY_STORAGE_KEY,
  className,
}: TaskSearchPanelProps) {
  const intl = useIntl();
  const { formatMessage } = intl;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSearchPanelTask[]>([]);
  // P6 文件域（spec §29.3）：与任务域并行的第二查询（序号守卫同源）。
  const [fileResults, setFileResults] = useState<WorkspaceFileEntry[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => loadSearchHistory(historyKey));
  // 提交序号：Enter/chip 与输入值未变时也强制重查（防抖 effect 依赖哨兵）。
  const [submitNonce, setSubmitNonce] = useState(0);
  const requestSeqRef = useRef(0);

  // 执行器装配（文件头取舍说明）：空 query → 最近任务（本地投影，spec §18 第一态）；
  // 非 query → host 执行器优先，缺位回落本地标题过滤。
  const runSearch = useCallback(
    async (raw: string): Promise<TaskSearchPanelTask[]> => {
      const trimmed = raw.trim();
      if (trimmed === "") {
        return collectHomeSearchTasks(workspaces, "");
      }
      if (onSearchTasks) {
        return onSearchTasks(trimmed);
      }
      return collectHomeSearchTasks(workspaces, trimmed);
    },
    [workspaces, onSearchTasks],
  );

  useEffect(() => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    const timer = setTimeout(() => {
      void runSearch(query)
        .then((rows) => {
          if (requestSeqRef.current === seq) setResults(rows);
        })
        .catch(() => {
          if (requestSeqRef.current === seq) setResults([]);
        });
      // 文件域并行第二查询（有执行器且有 query 才查；空 query 不查文件）。
      if (onSearchFiles && query.trim() !== "") {
        void onSearchFiles(query.trim())
          .then((files) => {
            if (requestSeqRef.current === seq) setFileResults(files);
          })
          .catch(() => {
            if (requestSeqRef.current === seq) setFileResults([]);
          });
      } else if (requestSeqRef.current === seq) {
        setFileResults([]);
      }
    }, TASK_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, submitNonce, runSearch, onSearchFiles]);

  useEffect(() => {
    setHistory(loadSearchHistory(historyKey));
  }, [historyKey]);

  const commitSearch = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setHistory(addSearchHistory(historyKey, trimmed));
    setQuery(trimmed);
    setSubmitNonce((nonce) => nonce + 1);
  };

  const hasQuery = query.trim() !== "";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={formatMessage({ id: "mobileShell.search.title" })}
      className={cn("fixed inset-0 z-30", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {/* 遮罩：点击空白关闭（半面板同语义；Escape 由根 onKeyDown 收口）。 */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* 半面板：官方 bg-popover token 本包 styles.css 缺失，用同族面板色 bg-card（D6 自包含）。 */}
      <div className="absolute inset-x-0 top-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-b-2xl border-b border-card-border bg-card shadow-lg">
        <form
          className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            commitSearch(query);
          }}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={formatMessage({ id: "mobileShell.search.placeholder" })}
            aria-label={formatMessage({ id: "mobileShell.search.placeholder" })}
            // 可编辑控件走 16px 防 iOS 聚焦缩放 token（DESIGN.md text-mobile-input-safe 预留面）。
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-input-border bg-input px-3 py-2 text-mobile-input-safe text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={formatMessage({ id: "mobileShell.search.close" })}
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {hasQuery && fileResults.length > 0 ? (
            <section>
              <div className="px-1.5 pb-1 pt-1 text-ui-xs font-medium text-foreground-subtlest">
                {formatMessage({ id: "workspaceFileTree.title" })}
              </div>
              <ul className="pb-2">
                {fileResults.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                      onClick={() => {
                        onFileSelect?.(entry);
                        onClose();
                      }}
                    >
                      {/* 官方文件行 = Nh chip 形：16px 类型图标 + 文件名 + 相对路径（§32.17）。 */}
                      <FileIconImage
                        src={fileIconSrc(
                          fileIconNameFor(
                            entry.path,
                            entry.type === "directory" ? "directory" : "file",
                          ),
                        )}
                        size={16}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui-base text-foreground">
                          {entry.name}
                        </span>
                        <span className="mt-0.5 block truncate text-ui-xs text-foreground-subtle">
                          {entry.relativePath}
                        </span>
                      </span>
                      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                        {entry.type === "directory" ? "dir" : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!hasQuery && history.length > 0 ? (
            <section>
              <div className="px-1.5 pb-1 pt-1 text-ui-xs font-medium text-foreground-subtlest">
                {formatMessage({ id: "mobileShell.search.history" })}
              </div>
              <div className="flex flex-wrap gap-1.5 px-1.5 pb-2">
                {history.map((entry) => (
                  <button
                    key={entry.query}
                    type="button"
                    className="min-h-9 rounded-full border border-border bg-surface px-3 text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover"
                    onClick={() => commitSearch(entry.query)}
                  >
                    {entry.query}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {results.length > 0 ? (
            <section>
              {!hasQuery ? (
                <div className="px-1.5 pb-1 pt-1 text-ui-xs font-medium text-foreground-subtlest">
                  {formatMessage({ id: "taskList.recentSection" })}
                </div>
              ) : null}
              <ul>
                {results.map((task) => (
                  <SearchTaskRow
                    key={task.taskId}
                    task={task}
                    intl={intl}
                    onTaskOpen={onTaskOpen}
                  />
                ))}
              </ul>
            </section>
          ) : (
            // 空态：有 query 无命中 → search.empty；无 query 无任务 → 首页同款 noTasks。
            <div className="flex min-h-32 items-center justify-center px-4 text-center text-ui-base text-foreground-subtle">
              {formatMessage({ id: hasQuery ? "mobileShell.search.empty" : "taskList.noTasks" })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
