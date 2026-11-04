import { memo } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

import type { MateFilter, MateViewCounts } from "./view-model.js";

const MATE_FILTER_ITEMS: ReadonlyArray<{ id: MateFilter; messageId: string }> = [
  { id: "decision", messageId: "mate.filter.decision" },
  { id: "running", messageId: "mate.filter.running" },
  { id: "observe", messageId: "mate.filter.observe" },
  { id: "all", messageId: "mate.filter.all" },
];

/**
 * 面板头：过滤 pills（待决策/进行中/观察中/全部，01 §5 MatePaneHeader）+ 软预算指示。
 * 计数恒为全局计数（view-model counts 与 filter 无关），pills 只切换投影不重算口径。
 * 软预算按「最重 workspace 的活动工单数 / maxActivePerWorkspace」显示（P1 单 workspace
 * 软预算=1；满载时切换 budget.full 文案）。
 */
export const MatePaneHeader = memo(function MatePaneHeader({
  filter,
  counts,
  budgetActive,
  budgetMax,
  onFilterChange,
}: {
  filter: MateFilter;
  counts: MateViewCounts;
  /** 最重 workspace 的活动工单数（dispatched+running；容器折算）。 */
  budgetActive: number;
  budgetMax: number;
  onFilterChange: (filter: MateFilter) => void;
}) {
  const { intl } = useDroraIntl();
  const budgetFull = budgetMax > 0 && budgetActive >= budgetMax;
  const countByFilter: Record<MateFilter, number> = {
    decision: counts.decision,
    running: counts.running,
    observe: counts.observe,
    all: counts.all,
  };
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1" role="group">
        {MATE_FILTER_ITEMS.map((item) => {
          const active = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              data-testid={`mate-filter-${item.id}`}
              onClick={() => onFilterChange(item.id)}
              className={cn(
                // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
                "h-7 rounded-lg px-2 text-ui-sm transition-colors",
                active
                  ? "bg-selected font-medium text-foreground"
                  : "text-foreground-subtle hover:bg-hover hover:text-foreground",
              )}
            >
              {intl.formatMessage({ id: item.messageId })}
              <span className="ml-1.5 font-mono text-ui-xs text-foreground-subtlest">
                {countByFilter[item.id]}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-ui-xs text-foreground-subtlest" data-testid="mate-budget">
        {intl.formatMessage(budgetFull ? { id: "mate.budget.full" } : { id: "mate.budget.count" }, {
          active: budgetActive,
          max: budgetMax,
        })}
      </p>
    </div>
  );
});
