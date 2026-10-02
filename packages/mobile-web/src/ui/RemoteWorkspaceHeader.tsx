// 原版任务页第二顶栏的纯展示投影；任务标题与工作区路径由 App 提供。
// P6 深度还原（specs/mobile-relay-r3-frontend.md §23.8 对比取证）：官方窄壳远控
// header 形态 = button[workspace-path]（图标+可点）> h1[workspace-title]（可见任务
// 标题）+ [v4-session-title]（sr-only 会话级标题）+ div > button[workspace-more-button]
// （⋯ 纯图标；菜单展开态未取证 → onMoreMenu 装配缝可选，缺省不渲染按钮，不臆造菜单项）。
// §23.15：官方头部右区另有 button[side-pane-toggle]（PanelRight 图标；官方侧板内容=
// aside[chat-summary-panel]，并行 StatusPanel 工作方向）——onToggleSidePane 装配缝可选，
// 缺省不渲染按钮；open 态归上层（aria-expanded 投影）。
import type { ReactNode } from "react";
import { Ellipsis, Folder, PanelRight } from "lucide-react";
import { useIntl } from "./intl.js";

export interface RemoteWorkspaceHeaderProps {
  title: string;
  workspacePath: string;
  /**
   * §32.25 工作区 chip 分支段（官方还原页活体：chip 名 = 「demo · main」——
   * 工作区名 · 当前分支；分支源 = attachment git summary.branchName，缺省仅工作区名）。
   */
  branchName?: string | null;
  /** 路径按钮点击（官方为 button 形态；缺省渲染为不可点 span 对位）。 */
  onPathClick?: () => void;
  /** §32.11 任务信息弹层（folder 锚点；内容由 App 装配）。 */
  infoSlot?: ReactNode;
  /** 官方 ⋯ 更多按钮（菜单内容归上层装配；缺省不渲染按钮）。 */
  onMoreMenu?: () => void;
  /** ⋯ 弹层内容（与触发按钮同锚点渲染；App 持开合态，§32.3）。 */
  moreMenuSlot?: ReactNode;
  /** 官方侧板开关（内容=chat-summary-panel 归 StatusPanel 装配；缺省不渲染按钮）。 */
  onToggleSidePane?: () => void;
  /** 侧板开合态投影（aria-expanded；缺省 false）。 */
  sidePaneOpen?: boolean;
  /** 官方「提交或推送」入口（GitActionMenu 自含壳元素，App 装配；缺省不渲染）。 */
  gitAction?: ReactNode;
}

export function RemoteWorkspaceHeader({
  title,
  workspacePath,
  branchName,
  onPathClick,
  onMoreMenu,
  moreMenuSlot,
  infoSlot,
  onToggleSidePane,
  sidePaneOpen,
  gitAction,
}: RemoteWorkspaceHeaderProps) {
  const { formatMessage } = useIntl();
  const workspaceName =
    workspacePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? workspacePath;
  // §32.25 官方 chip 名 = 工作区名 · 分支（活体「demo · main」）；分支缺省退化为纯工作区名。
  const workspaceChipLabel = branchName ? `${workspaceName} · ${branchName}` : workspaceName;
  return (
    <header
      data-testid="workspace-header"
      data-workspace-header-variant="task"
      className="relative flex h-12 w-full shrink-0 items-center border-b border-border/50 px-2"
    >
      <div className="flex min-w-0 items-center gap-2 overflow-hidden max-md:gap-1">
        <div className="relative flex shrink-0 items-center">
          {onPathClick ? (
            <button
              type="button"
              data-testid="workspace-path"
              aria-label={workspaceChipLabel}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover"
              title={workspacePath}
              onClick={onPathClick}
            >
              <Folder aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <span
              data-testid="workspace-path"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle"
              title={workspacePath}
              aria-label={workspaceChipLabel}
            >
              <Folder aria-hidden="true" className="size-4" />
            </span>
          )}
        </div>
        {/* §32.11 任务信息弹层：锚 header 层（folder 容器 overflow-hidden 会裁剪弹层）。 */}
        {infoSlot ?? null}
        <h1
          data-testid="workspace-title"
          className="min-w-12 max-w-[42vw] truncate text-ui-base font-semibold text-foreground"
          title={title}
        >
          {title}
        </h1>
        {/* 官方 sr-only 会话级标题（可访问性双标题形态）。 */}
        <span data-testid="v4-session-title" className="sr-only">
          {title}
        </span>
        {onMoreMenu ? (
          <div className="relative flex min-w-0 shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="workspace-more-button"
              aria-label={title}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover"
              onClick={onMoreMenu}
            >
              <Ellipsis aria-hidden="true" className="size-4" />
            </button>
            {/* 菜单锚定在触发按钮容器（官方弹层同锚点）；内容由 App 装配。 */}
            {moreMenuSlot ?? null}
          </div>
        ) : null}
        {onToggleSidePane ? (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              data-testid="side-pane-toggle"
              aria-label={formatMessage({ id: "mobileShell.task.sidePaneExpand" })}
              aria-expanded={sidePaneOpen ?? false}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover"
              onClick={onToggleSidePane}
            >
              <PanelRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : null}
        {/* P6 GitPane 一期姊妹件（spec §27.1）：官方「提交或推送」入口（GitActionMenu
            自含触发器+对话框；Provider 壳归 RemoteGitActionMenu 封装）。 */}
        {gitAction ?? null}
      </div>
    </header>
  );
}
