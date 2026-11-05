import { memo } from "react";
import type { AssistantDecisionView, AssistantSnapshot } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

import { MateLamp } from "./MateLamp.js";
import { MateSourceBadge } from "./MateSourceBadge.js";
import { firstPreviewLine } from "./MateTicketRow.js";
import { findMateTicketIdForDecision } from "./view-model.js";

/**
 * auto 告知卡（F4，spec §6 auto 执行语义「执行（出告知卡）」的 UI 兑现——此前
 * outcome=auto_notice 只在工单行体现，无告知面）。只读行卡，形态复用 MateObserveRow
 * （不新增重组件、无处置动作）：observe 空心灯（信息性呈现，不发明新灯档）｜
 * 「已按 auto 规则自动执行」标签｜原文首行｜工单号（按 ticket.decisionId 反查；
 * 工单被快照容量裁剪后不渲染工单号——诚实降级，不猜）。decided_by 恒 gate，
 * 不计入放行率（spec §6 落地注记），故无放行/忽略按钮。
 */
export const MateAutoNoticeRow = memo(function MateAutoNoticeRow({
  decision,
  snapshot,
}: {
  decision: AssistantDecisionView;
  snapshot: AssistantSnapshot;
}) {
  const { intl } = useDroraIntl();
  const ticketId = findMateTicketIdForDecision(snapshot, decision.id);
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-2"
      data-testid="mate-auto-notice-row"
    >
      <MateLamp tone="observe" />
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.autoNotice.label" })}
      </span>
      {/* 来源徽标（MateObserveRow 同位）：快照可选字段缺席不渲染。 */}
      {decision.sourceKind ? <MateSourceBadge sourceKind={decision.sourceKind} /> : null}
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
        {firstPreviewLine(decision.triggerText)}
      </span>
      {ticketId !== null ? (
        <span
          className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
          data-testid="mate-auto-notice-ticket"
        >
          {intl.formatMessage({ id: "mate.autoNotice.ticket" }, { ticketId })}
        </span>
      ) : null}
    </div>
  );
});
