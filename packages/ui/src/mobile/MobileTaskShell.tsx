import type { Ref, ReactNode } from "react";
import { ArrowLeft, Ellipsis, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * R3 移动会话面壳（spec specs/mobile-relay-r3-frontend.md §2「移动会话面」、D1）。
 *
 * 本期只做壳与导航：顶栏（返回首页/任务标题/更多菜单位/侧板展开位）+
 * 时间线滚动容器 + 底部 composer 槽。时间线条目与 composer 本体由装配方以
 * `timeline` / `composer` 槽注入——复用现有 v4 组件（v4/ConversationTimeline.tsx、
 * v4/ConversationComposer.tsx）的可行性留待装配任务评估，本壳不做实现。
 * stick-to-bottom 由调用方经 `timelineScrollRef` 控制滚动容器。
 *
 * 视觉对齐官方 3.14.3 实机 DOM（.tmp-work/official-live-mobile-chat.html 的
 * data-mobile-page="chat" 顶栏：h-11 bg-header + arrow-left + 标题 + 右侧操作位）。
 * 触控目标 ≥44px：顶栏图标按钮统一 size-11（44px，移动壳显式覆盖桌面按钮尺寸系统）。
 */

export interface MobileTaskShellProps {
  /** 顶栏标题；缺省用官方「任务会话」。 */
  title?: string;
  /** 返回首页动作；未提供时隐藏返回位。 */
  onBack?: () => void;
  /** 「更多」菜单操作位（菜单本体由装配方挂载）；未提供时隐藏该位。 */
  onMorePress?: () => void;
  /** 侧板展开/收起动作；未提供时隐藏该位。 */
  onSidePaneToggle?: () => void;
  /** 侧板当前是否展开（控制展开位图标）。 */
  sidePaneOpen?: boolean;
  /** 时间线内容槽（注入官方富时间线的装配方实现）。 */
  timeline?: ReactNode;
  /** 底部 composer 槽（注入完整 composer 的装配方实现）。 */
  composer?: ReactNode;
  /** 时间线滚动容器 ref：stick-to-bottom / 滚动定位由调用方控制。 */
  timelineScrollRef?: Ref<HTMLDivElement>;
  /** 连接中断提示（如 mobileShell.task.reconnectingBanner 的文案由装配方注入）。 */
  connectionBanner?: ReactNode;
  className?: string;
}

export function MobileTaskShell({
  title,
  onBack,
  onMorePress,
  onSidePaneToggle,
  sidePaneOpen = false,
  timeline,
  composer,
  timelineScrollRef,
  connectionBanner,
  className,
}: MobileTaskShellProps) {
  const { intl } = useZCodeIntl();
  const resolvedTitle = title ?? intl.formatMessage({ id: "mobileShell.task.chatTitle" });

  return (
    <div
      className={cn(
        "flex h-dvh min-h-dvh w-full flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      {/* 顶栏（官方 h-11 bg-header px-2 结构）。 */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-header px-2">
        {onBack ? (
          <Button
            variant="ghost"
            // 移动壳触控目标 ≥44px：显式放大图标按钮（覆盖 icon-sm 默认 size-6）。
            size="icon-sm"
            className="size-11"
            aria-label={intl.formatMessage({ id: "mobileShell.task.backHome" })}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-ui-base font-medium">{resolvedTitle}</span>
        {onSidePaneToggle ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={intl.formatMessage({
              id: sidePaneOpen
                ? "mobileShell.task.sidePaneCollapse"
                : "mobileShell.task.sidePaneExpand",
            })}
            aria-expanded={sidePaneOpen}
            onClick={onSidePaneToggle}
          >
            {sidePaneOpen ? (
              <PanelRightClose aria-hidden="true" className="size-4" />
            ) : (
              <PanelRightOpen aria-hidden="true" className="size-4" />
            )}
          </Button>
        ) : null}
        {onMorePress ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={intl.formatMessage({ id: "mobileShell.task.more" })}
            aria-haspopup="menu"
            onClick={onMorePress}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </header>

      {/* 时间线滚动容器：children 槽 + stick-to-bottom 交由调用方（经 timelineScrollRef）。 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {connectionBanner ? (
          <div className="shrink-0 border-b border-border bg-surface px-3 py-1.5 text-ui-sm text-foreground-subtle">
            {connectionBanner}
          </div>
        ) : null}
        <div ref={timelineScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {timeline}
        </div>
      </div>

      {/* 底部 composer 槽；safe-area 内边距避免 iOS 底部手势区遮挡输入面。 */}
      {composer ? (
        <div className="shrink-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
          {composer}
        </div>
      ) : null}
    </div>
  );
}
