// R3 移动会话面壳——自包含移植自 packages/ui/src/mobile/MobileTaskShell.tsx（D6 冻结 ui，
// 本包自持）。本期只做壳与导航：顶栏 + 时间线滚动容器 + 底部 composer 槽，
// 时间线/composer 由装配方注入（P2a 基础版注入只读行渲染与 sendText composer）。
import type { Ref, ReactNode } from "react";
import { ArrowLeft, Ellipsis, Palette } from "lucide-react";
import { Button } from "./Button.js";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";

export interface MobileTaskShellProps {
  title?: string;
  onBack?: () => void;
  onMorePress?: () => void;
  /** §32.13 官方任务面顶栏右上主题钮（活拍对齐）。 */
  onThemePress?: () => void;
  /** 时间线内容槽（P2a：只读行渲染；富时间线归 P3）。 */
  timeline?: ReactNode;
  /** 官方任务面在导航栏与消息区之间的工作区标题栏。 */
  workspaceHeader?: ReactNode;
  /** 底部 composer 槽。 */
  composer?: ReactNode;
  /** 时间线滚动容器 ref：stick-to-bottom / 滚动定位由调用方控制。 */
  timelineScrollRef?: Ref<HTMLDivElement>;
  /** 时间线组件自带滚动视口时避免双层滚动。 */
  timelineOwnsScroll?: boolean;
  /** 连接中断提示（如重新连接中文案由装配方注入）。 */
  connectionBanner?: ReactNode;
  className?: string;
}

export function MobileTaskShell({
  title,
  onBack,
  onMorePress,
  onThemePress,
  timeline,
  workspaceHeader,
  composer,
  timelineScrollRef,
  timelineOwnsScroll = false,
  connectionBanner,
  className,
}: MobileTaskShellProps) {
  const { formatMessage } = useIntl();
  const resolvedTitle = title ?? formatMessage({ id: "mobileShell.task.chatTitle" });

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
            aria-label={formatMessage({ id: "mobileShell.task.backHome" })}
            onClick={onBack}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-ui-base font-medium">{resolvedTitle}</span>
        {onThemePress ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={formatMessage({ id: "mobileShell.home.theme" })}
            onClick={onThemePress}
          >
            <Palette aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        {onMorePress ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11"
            aria-label={formatMessage({ id: "mobileShell.task.more" })}
            aria-haspopup="menu"
            onClick={onMorePress}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </header>

      {workspaceHeader}

      {/* P6 骨架对齐（spec §23.10 取证）：官方 [v4-session-pane-workspace-main] = 会话
          主容器（相对定位 flex，包 时间线 + dock；官方横排因含侧板，窄壳纵排同 testid）。 */}
      <div
        data-testid="v4-session-pane-workspace-main"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {connectionBanner ? (
            <div className="shrink-0 border-b border-border bg-surface px-3 py-1.5 text-ui-sm text-foreground-subtle">
              {connectionBanner}
            </div>
          ) : null}
          <div
            ref={timelineOwnsScroll ? undefined : timelineScrollRef}
            className={
              timelineOwnsScroll
                ? "flex min-h-0 min-w-0 flex-1 flex-col"
                : "min-h-0 flex-1 overflow-y-auto overscroll-contain"
            }
          >
            {timeline}
          </div>
        </div>

        {/* 底部 composer 槽；safe-area 内边距避免 iOS 底部手势区遮挡输入面。
            官方 dock 双层 grid（conversation-bottom-dock-transition > -layer 同格叠放，
            滚动渐变动画双 buffer 形态逐字）。 */}
        {composer ? (
          <div className="shrink-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
            <div data-testid="conversation-bottom-dock-transition" className="grid w-full">
              <div
                data-testid="conversation-bottom-dock-transition-layer"
                className="col-start-1 row-start-1 w-full min-w-0"
              >
                {composer}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
