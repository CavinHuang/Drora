// R3 P6 快选框面第一档（specs/mobile-relay-r3-frontend.md §23）。
// 纯展示受控组件：命令清单/查找结果经 props 装配缝由上层传入（本组件不持数据源、
// 不发命令——quickPick 命令执行面经 Host 桥的接通归 P7 立项）。
// 官方形态取证（upstream index chunk）：Dialog 受控壳 {open, onOpenChange, title,
// description}，title/description = quickPick.title/.description 双键；双模式
// command（命令面板）/ find（在任务中查找）；find 含范围切换（quickPick.find.scope.tooltip
// 「切换搜索范围消息/文件」）+ 上一/下一个结果导航；command 含 返回/前进（quickPick.command.*）；
// 错误行 quickPick.commandFailed「命令执行失败：{error}」插值。
// 壳形态对齐本包 TaskSearchPanel 先例（role="dialog" 半面板 + Escape/遮罩关闭；
// 官方 bg-popover token 本包 styles.css 缺失 → bg-card，D6 自包含）。
// 文案：zh 10 键官方逐字（含 {error} 插值）；en 按官方语义补译（见 intl 注释）。
// D6 自包含：不 import @zcode/ui；文案经上层 IntlProvider 的 useIntl 取键。
import * as React from "react";
import { useIntl } from "./intl.js";
import { cn } from "./cn.js";

export type QuickPickMode = "command" | "find";
export type QuickPickFindScope = "messages" | "files";

export interface QuickPickItem {
  id: string;
  label: string;
  detail?: string;
}

export interface QuickPickDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: QuickPickMode;
  query: string;
  onQueryChange: (query: string) => void;
  items: QuickPickItem[];
  onExecute?: (item: QuickPickItem) => void;
  /** command 模式错误行文案（官方 {error} 插值由上层填实）。 */
  error?: string | null;
  onGoBack?: () => void;
  onGoForward?: () => void;
  findScope?: QuickPickFindScope;
  onFindScopeChange?: (scope: QuickPickFindScope) => void;
  onFindNext?: () => void;
  onFindPrevious?: () => void;
  className?: string;
}

export function QuickPickDialog({
  open,
  onOpenChange,
  mode,
  query,
  onQueryChange,
  items,
  onExecute,
  error,
  onGoBack,
  onGoForward,
  findScope = "messages",
  onFindScopeChange,
  onFindNext,
  onFindPrevious,
  className,
}: QuickPickDialogProps) {
  const { formatMessage } = useIntl();
  if (!open) return null;

  const isFind = mode === "find";
  const title = formatMessage({ id: isFind ? "quickPick.find.title" : "quickPick.title" });
  const description = formatMessage({
    id: isFind ? "quickPick.find.description" : "quickPick.description",
  });
  // 范围切换：官方两值（消息/文件）逐字对齐官方 scope 文案语义。
  const scopeLabel = findScope === "messages" ? "消息" : "文件";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn("fixed inset-0 z-30", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onOpenChange(false);
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="absolute inset-x-0 top-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-b-2xl border-b border-card-border bg-card shadow-lg">
        <div className="shrink-0 border-b border-border px-3 py-2">
          <p className="text-ui-sm font-medium text-foreground">{title}</p>
          <p className="text-ui-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          {isFind ? (
            <>
              {onFindScopeChange ? (
                <button
                  type="button"
                  aria-label={formatMessage({ id: "quickPick.find.scope.tooltip" })}
                  className="rounded-md border border-border px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    onFindScopeChange(findScope === "messages" ? "files" : "messages")
                  }
                >
                  {scopeLabel}
                </button>
              ) : null}
              {onFindPrevious ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onFindPrevious}
                >
                  {formatMessage({ id: "quickPick.find.previous" })}
                </button>
              ) : null}
              {onFindNext ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onFindNext}
                >
                  {formatMessage({ id: "quickPick.find.next" })}
                </button>
              ) : null}
            </>
          ) : (
            <>
              {onGoBack ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onGoBack}
                >
                  {formatMessage({ id: "quickPick.command.goBack" })}
                </button>
              ) : null}
              {onGoForward ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ui-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onGoForward}
                >
                  {formatMessage({ id: "quickPick.command.goForward" })}
                </button>
              ) : null}
            </>
          )}
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label={title}
            // 可编辑控件走 16px 防 iOS 聚焦缩放 token（DESIGN.md text-mobile-input-safe 预留面）。
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-input-border bg-input px-3 py-2 text-mobile-input-safe text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
          />
        </div>
        {error ? (
          <p className="shrink-0 px-3 py-2 text-ui-sm text-destructive">
            {formatMessage({ id: "quickPick.commandFailed" }, { error })}
          </p>
        ) : null}
        <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
                onClick={onExecute ? () => onExecute(item) : undefined}
              >
                <span className="text-ui-sm text-foreground">{item.label}</span>
                {item.detail ? (
                  <span className="text-ui-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
