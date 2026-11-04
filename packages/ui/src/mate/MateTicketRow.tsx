import { memo } from "react";
import type { AssistantTicketView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { cn } from "@/components/lib/utils.js";

import { MateLamp } from "./MateLamp.js";
import { mateTicketLampTone } from "./statusTone.js";

/** brief/trigger 预览统一取首行（服务侧 120 字截断可能仍含换行，01 §1.2 首行口径）。 */
export function firstPreviewLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

/**
 * 工单行（01 §5 MateTicketRow）：状态灯（五档：运行=warning）｜T-id（mono）｜brief 首行｜
 * 实耗（mono）｜相对时间。P1 无停止按钮（01 §5 树未列；stopMandate 通道已在 store 备好）。
 * 点击仅切换选中（mateStore.selectedTicketId，面板本地视图态）。
 */
export const MateTicketRow = memo(function MateTicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: AssistantTicketView;
  selected: boolean;
  onSelect: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  return (
    <button
      type="button"
      onClick={() => onSelect(ticket.id)}
      data-testid="mate-ticket-row"
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-card-border bg-card-selected"
          : "border-border/60 bg-surface hover:bg-surface-hover",
      )}
    >
      <MateLamp tone={mateTicketLampTone(ticket.status)} />
      <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">{ticket.id}</span>
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
        {firstPreviewLine(ticket.brief)}
      </span>
      <span className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">
        {ticket.usage.inputTokens}/{ticket.usage.outputTokens}
      </span>
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {formatTaskRelativeTime(ticket.updatedAtMs, intl)}
      </span>
    </button>
  );
});
