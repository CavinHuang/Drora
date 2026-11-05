import { memo } from "react";
import type { AssistantTicketView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { cn } from "@/components/lib/utils.js";

import { MateLamp } from "./MateLamp.js";
import {
  mateTicketGenerationNumber,
  isMateQueuedTicket,
  mateStaleBadgeKind,
} from "./view-model.js";
import { mateTicketLampTone } from "./statusTone.js";

/** brief/trigger 预览统一取首行（服务侧 120 字截断可能仍含换行，01 §1.2 首行口径）。 */
export function firstPreviewLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

const MATE_MODE_HINT_MESSAGE_ID: Record<"A" | "B" | "C", string> = {
  A: "mate.ticket.mode.a.hint",
  B: "mate.ticket.mode.b.hint",
  C: "mate.ticket.mode.c.hint",
};

/**
 * 工单行（01 §5 MateTicketRow + P2 徽标批）：状态灯（六档：运行=warning、排队=warning
 * 空心）｜T-id（mono）｜brief 首行｜[模式/代际/写域徽标]｜实耗（mono）｜相对时间。
 *
 * P2 徽标（specs §9/§8/§11.3，全部 title 提示不占第二行——side pane 宽度与手机单列
 * 约束下徽标必须可折叠）：
 * - queued：排队灯档+固定「排队」徽标（queuedReason 全文进详情页时间线，行内不截断）；
 * - dispatchMode：A/B/C mono 字母（hover 出模式全称）；
 * - generationCount>0：第 N 代（N=归档数+1，mateTicketGenerationNumber 单一口径）；
 * - writeDomain：worktree/paths/workspace 三形态 title 提示（worktreeDisabled 时服务侧
 *   即发 paths/workspace 域，行内只按快照事实渲染，无独立开关读取）。
 * - P4 第二棒：stale 停滞徽标（watchdog 判据投影，04 详设 §1——「停滞」短徽标+title
 *   全称，与 queued 徽标同 warning-surface 色系不发明新色）。
 * 点击仅切换选中（mateStore.selectedTicketId，P2 下钻 Surface C 详情视图）。
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
  const queued = isMateQueuedTicket(ticket.status);
  // P4 第二棒（04 详设 §1）：watchdog 停滞标记徽标（staleSinceMs 唯一事实源；
  // 判据解除同轮清除后徽标自然消失——行内不落本地状态）。
  const staleKind = mateStaleBadgeKind(ticket);
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
      <span className="flex shrink-0 items-center gap-1">
        {queued ? (
          <span
            className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            data-testid="mate-ticket-queued"
          >
            {intl.formatMessage({ id: "mate.ticket.queued" })}
          </span>
        ) : null}
        {staleKind ? (
          <span
            className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            title={intl.formatMessage({ id: `mate.watchdog.kind.${staleKind}` })}
            data-testid="mate-ticket-stale"
          >
            {intl.formatMessage({ id: "mate.ticket.stale" })}
          </span>
        ) : null}
        {ticket.dispatchMode ? (
          <span
            className="font-mono text-ui-xs text-foreground-subtle"
            title={intl.formatMessage({ id: MATE_MODE_HINT_MESSAGE_ID[ticket.dispatchMode] })}
            data-testid="mate-ticket-mode"
          >
            {ticket.dispatchMode}
          </span>
        ) : null}
        {(ticket.generationCount ?? 0) > 0 ? (
          <span
            className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
            title={intl.formatMessage(
              { id: "mate.ticket.generation" },
              { gen: mateTicketGenerationNumber(ticket) },
            )}
            data-testid="mate-ticket-generation"
          >
            {intl.formatMessage(
              { id: "mate.ticket.generation" },
              { gen: mateTicketGenerationNumber(ticket) },
            )}
          </span>
        ) : null}
        {ticket.writeDomain ? (
          <span
            aria-hidden
            className="text-ui-xs text-foreground-subtlest"
            title={mateWriteDomainHint(ticket.writeDomain, intl)}
            data-testid="mate-ticket-domain"
          >
            {ticket.writeDomain.kind === "worktree"
              ? "⌥"
              : ticket.writeDomain.kind === "paths"
                ? "▤"
                : "∞"}
          </span>
        ) : null}
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

/** 写域 title 提示（specs §9 三形态明示；workspace 形态复用「非容器级」诚实声明）。 */
function mateWriteDomainHint(
  domain: NonNullable<AssistantTicketView["writeDomain"]>,
  intl: ReturnType<typeof useDroraIntl>["intl"],
): string {
  switch (domain.kind) {
    case "worktree":
      return intl.formatMessage(
        { id: "mate.ticket.worktree.hint" },
        { path: domain.path, branch: domain.branch },
      );
    case "paths":
      return intl.formatMessage(
        { id: "mate.ticket.paths.hint" },
        { paths: domain.paths.join(", ") },
      );
    case "workspace":
      return intl.formatMessage({ id: "mate.ticket.workspace.hint" });
  }
}
