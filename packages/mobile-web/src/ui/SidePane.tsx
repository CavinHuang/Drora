// R3 P6 sidePane 侧板面（specs/mobile-relay-r3-frontend.md §23）。
// 纯展示受控组件：标签页清单/最近关闭经 props 装配缝由上层传入（本组件不持数据源、
// 不发命令——Host 侧板服务面归 P7 立项，缺省空态零回归）。
// 官方形态取证（upstream locale chunk，25/25 全有值）：标签管理面 = 打开的标签页 +
// 最近关闭的标签页两分区 + 搜索框（searchTabs）+ 新增/关闭单页/关闭其他/关闭全部动作 +
// 打开标签描述 + 加载态（openFileLoading）+ 空态（noTabsFound）+ 收起/切换面板 +
// 类型徽标（review 审查 / selectionChat 辅助对话 / subagent 子智能体 / subagentDirectory
// 子智能体目录 / workflow 四键：工作流子代理/产物/目录/实例/脚本步骤）+ time.justNow。
// 文案：zh 25 键官方逐字（{title} 插值）；en 语义补译（见 intl 注释）。
// D6 自包含：不 import @zcode/ui；文案经上层 IntlProvider 的 useIntl 取键。
import * as React from "react";
import { useIntl } from "./intl.js";
import { cn } from "./cn.js";

/** 侧板标签条目（上层侧板服务投影；P7 协议面前先本地形状）。 */
export interface SidePaneTab {
  id: string;
  title: string;
  /** 官方类型徽标键族（review/selectionChat/subagent/subagentDirectory/workflow*）。 */
  kind?: "review" | "selectionChat" | "subagent" | "subagentDirectory" | "workflow";
  /** workflow 族细分（官方四键：Actor/Artifact/Directory/Run/Script）。 */
  workflowDetail?: "actor" | "artifact" | "directory" | "run" | "script";
  loading?: boolean;
}

export interface SidePaneProps {
  tabs: SidePaneTab[];
  recentlyClosed?: SidePaneTab[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onAddTab?: () => void;
  onCloseTab?: (tab: SidePaneTab) => void;
  onCloseOtherTabs?: () => void;
  onCloseAllTabs?: () => void;
  onOpenTab?: (tab: SidePaneTab) => void;
  onCollapse?: () => void;
  onTogglePanel?: () => void;
  className?: string;
}

/** 官方类型徽标：kind → locale 键（workflow 细分走 workflow* 五键）。 */
function badgeKey(tab: SidePaneTab): string | null {
  if (tab.kind === "workflow") {
    switch (tab.workflowDetail) {
      case "actor":
        return "sidePane.workflowActor";
      case "artifact":
        return "sidePane.workflowArtifact";
      case "directory":
        return "sidePane.workflowDirectory";
      case "run":
        return "sidePane.workflowRun";
      case "script":
        return "sidePane.workflowScript";
      default:
        return "sidePane.workflowRun";
    }
  }
  if (tab.kind === "review") return "sidePane.review";
  if (tab.kind === "selectionChat") return "sidePane.selectionChat";
  if (tab.kind === "subagent") return "sidePane.subagent";
  if (tab.kind === "subagentDirectory") return "sidePane.subagentDirectory";
  return null;
}

export function SidePane({
  tabs,
  recentlyClosed = [],
  searchQuery,
  onSearchQueryChange,
  onAddTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onOpenTab,
  onCollapse,
  onTogglePanel,
  className,
}: SidePaneProps) {
  const { formatMessage } = useIntl();
  const hasQuery = searchQuery.trim().length > 0;
  // 官方两分区：打开的标签页 / 最近关闭的标签页；搜索仅过滤打开分区。
  const visibleTabs = hasQuery
    ? tabs.filter((tab) => tab.title.includes(searchQuery.trim()))
    : tabs;

  const renderRow = (tab: SidePaneTab, closed: boolean) => {
    const badge = badgeKey(tab);
    return (
      <li
        key={`${closed ? "closed" : "open"}:${tab.id}`}
        className="flex items-center gap-2 px-3 py-1.5 text-ui-sm hover:bg-muted"
      >
        {closed && onOpenTab ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
            onClick={() => onOpenTab(tab)}
          >
            {tab.title}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-foreground">{tab.title}</span>
        )}
        {tab.loading ? (
          <span className="shrink-0 text-ui-xs text-muted-foreground">
            {formatMessage({ id: "sidePane.openFileLoading" })}
          </span>
        ) : null}
        {badge ? (
          <span className="shrink-0 rounded bg-muted px-1 text-ui-xs text-muted-foreground">
            {formatMessage({ id: badge })}
          </span>
        ) : null}
        {!closed && onCloseTab ? (
          <button
            type="button"
            aria-label={formatMessage({ id: "sidePane.closeTab" }, { title: tab.title })}
            className="shrink-0 rounded px-1 text-ui-xs text-muted-foreground hover:text-foreground"
            onClick={() => onCloseTab(tab)}
          >
            {formatMessage({ id: "sidePane.closeCurrentTab" })}
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <aside
      className={cn("flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-card", className)}
      aria-label={formatMessage({ id: "sidePane.tabOverview" })}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-ui-sm font-medium text-foreground">
          {formatMessage({ id: "sidePane.openTabs" })}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {onTogglePanel ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onTogglePanel}
            >
              {formatMessage({ id: "sidePane.togglePanel" })}
            </button>
          ) : null}
          {onCollapse ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCollapse}
            >
              {formatMessage({ id: "sidePane.collapse" })}
            </button>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-2 px-3">
        <input
          type="search"
          value={searchQuery}
          placeholder={formatMessage({ id: "sidePane.searchTabs" })}
          aria-label={formatMessage({ id: "sidePane.tabOverview" })}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-ui-sm text-foreground placeholder:text-muted-foreground"
        />
        {onAddTab ? (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-ui-xs text-foreground hover:bg-muted"
            onClick={onAddTab}
          >
            {formatMessage({ id: "sidePane.addTab" })}
          </button>
        ) : null}
      </div>
      {onCloseOtherTabs || onCloseAllTabs ? (
        <div className="flex items-center gap-2 px-3">
          {onCloseOtherTabs ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCloseOtherTabs}
            >
              {formatMessage({ id: "sidePane.closeOtherTabs" })}
            </button>
          ) : null}
          {onCloseAllTabs ? (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCloseAllTabs}
            >
              {formatMessage({ id: "sidePane.closeAllTabs" })}
            </button>
          ) : null}
        </div>
      ) : null}
      {visibleTabs.length === 0 ? (
        <p className="px-3 pb-2 text-ui-sm text-muted-foreground">
          {hasQuery
            ? formatMessage({ id: "sidePane.noTabsFound" })
            : formatMessage({ id: "sidePane.openTabDescription" })}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visibleTabs.map((tab) => renderRow(tab, false))}
        </ul>
      )}
      {recentlyClosed.length > 0 ? (
        <>
          <p className="border-t border-border px-3 pt-2 text-ui-xs text-muted-foreground">
            {formatMessage({ id: "sidePane.recentlyClosedTabs" })}
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
            {recentlyClosed.map((tab) => renderRow(tab, true))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
