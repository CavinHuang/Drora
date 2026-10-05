// R3 P6 文件树面第一档（specs/mobile-relay-r3-frontend.md §23，用户解除"有意分歧"裁定）。
// 纯展示受控组件：树数据经 props 装配缝由上层传入（本组件不持数据源、不发命令）；
// 还原仓尚无 Host 文件服务面（listDir/readDir），协议面（fileService 经桥）归 P7 立项，
// App 缺省不传 entries = 面渲染空态，不伪造可点击数据行（spec §23 渲染不可达面禁令）。
// 官方形态取证（upstream index chunk）：搜索框 placeholder=searchPlaceholder +
// aria-label=searchLabel + onChange 受控；清空/刷新/返回任务为头部动作；
// gitStatus 徽标官方仅 ignored 一值在本面 id 集（modified/untracked 官方键不在此面，不臆造）。
// 文案：zh 11 键官方逐字 + title 官方 locale chunk 缺值按面语义补译（见 zh-CN.ts 注释）。
// D6 自包含：不 import @zcode/ui；文案经上层 IntlProvider 的 useIntl 取键。
import { useIntl } from "./intl.js";
import { cn } from "./cn.js";
import { FileIconImage } from "./FileChip.js";
import { fileNameToIconName, fileIconSrc } from "./fileIcon.js";

/** 文件树条目（上层 Host 文件服务投影；P7 协议面定义前先用本地形状）。 */
export interface WorkspaceFileTreeEntry {
  /** 相对工作区根的路径（展示名取末段）。 */
  path: string;
  name: string;
  kind: "file" | "directory";
  /** 缩进层级（0 = 根下第一层）。 */
  depth: number;
  /** 官方本面仅 ignored 徽标有键；其余 git 状态不渲染标记。 */
  gitIgnored?: boolean;
}

export interface WorkspaceFileTreeProps {
  entries: WorkspaceFileTreeEntry[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onRefresh?: () => void;
  onBackToTasks?: () => void;
  onAddToChat?: (entry: WorkspaceFileTreeEntry) => void;
  onOpenWith?: (entry: WorkspaceFileTreeEntry) => void;
  onOpenInBrowser?: (entry: WorkspaceFileTreeEntry) => void;
  /** read = 目录读取失败；open = 条目打开失败（官方两态分键）。 */
  error?: "read" | "open" | null;
  className?: string;
}

export function WorkspaceFileTree({
  entries,
  searchQuery,
  onSearchQueryChange,
  onRefresh,
  onBackToTasks,
  onAddToChat,
  onOpenWith,
  onOpenInBrowser,
  error,
  className,
}: WorkspaceFileTreeProps) {
  const { formatMessage } = useIntl();
  const hasQuery = searchQuery.trim().length > 0;

  return (
    <section
      className={cn("flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-card", className)}
      aria-label={formatMessage({ id: "workspaceFileTree.title" })}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onBackToTasks ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onBackToTasks}
          >
            {formatMessage({ id: "workspaceFileTree.backToTasks" })}
          </button>
        ) : null}
        <span className="text-ui-sm font-medium text-foreground">
          {formatMessage({ id: "workspaceFileTree.title" })}
        </span>
        {onRefresh ? (
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onRefresh}
          >
            {formatMessage({ id: "workspaceFileTree.refresh" })}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2 px-3">
        <input
          type="search"
          value={searchQuery}
          placeholder={formatMessage({ id: "workspaceFileTree.searchPlaceholder" })}
          aria-label={formatMessage({ id: "workspaceFileTree.searchLabel" })}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-ui-sm text-foreground placeholder:text-muted-foreground"
        />
        {hasQuery ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onSearchQueryChange("")}
          >
            {formatMessage({ id: "workspaceFileTree.clearSearch" })}
          </button>
        ) : null}
      </div>
      {error === "read" ? (
        <p className="px-3 text-ui-sm text-destructive">
          {formatMessage({ id: "workspaceFileTree.readFailed" })}
        </p>
      ) : null}
      {entries.length === 0 && error !== "read" ? (
        <p className="px-3 pb-3 text-ui-sm text-muted-foreground">
          {hasQuery
            ? formatMessage({ id: "workspaceFileTree.clearSearch" })
            : formatMessage({ id: "workspaceFileTree.title" })}
        </p>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        {entries.map((entry) => (
          <li
            key={entry.path}
            className="flex items-center gap-2 px-3 py-1 text-ui-sm text-foreground hover:bg-muted"
            style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
          >
            {/* 官方树行（Qon，§32.17）：文件行 16px 类型图标（shrink-0 size-4）；
                目录行不渲染类型图标（官方仅展开 chevron——本组件无展开态，不臆造）。 */}
            {entry.kind === "file" ? (
              <FileIconImage
                src={fileIconSrc(fileNameToIconName(entry.path))}
                size={16}
                className="shrink-0 size-4"
              />
            ) : null}
            <span className="truncate" title={entry.path}>
              {entry.name}
            </span>
            {entry.gitIgnored ? (
              <span className="rounded bg-muted px-1 text-ui-xs text-muted-foreground">
                {formatMessage({ id: "workspaceFileTree.gitStatus.ignored" })}
              </span>
            ) : null}
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {onAddToChat ? (
                <button
                  type="button"
                  className="rounded px-1 text-ui-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onAddToChat(entry)}
                >
                  {formatMessage({ id: "workspaceFileTree.addToChat" })}
                </button>
              ) : null}
              {onOpenInBrowser ? (
                <button
                  type="button"
                  className="rounded px-1 text-ui-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenInBrowser(entry)}
                >
                  {formatMessage({ id: "workspaceFileTree.openInBrowser" })}
                </button>
              ) : null}
              {onOpenWith ? (
                <button
                  type="button"
                  className="rounded px-1 text-ui-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenWith(entry)}
                >
                  {formatMessage({ id: "workspaceFileTree.openWith" })}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {error === "open" ? (
        <p className="px-3 pb-2 text-ui-sm text-destructive">
          {formatMessage({ id: "workspaceFileTree.openFailed" })}
        </p>
      ) : null}
    </section>
  );
}
