import { memo } from "react";
import type { AssistantDecisionView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

import { MateLamp } from "./MateLamp.js";
import { firstPreviewLine } from "./MateTicketRow.js";

/**
 * 观察行（01 §5 MateObserveRow）：foreground-subtlest 空心灯（五档映射，仅灯不填充）｜
 * would-accept 标签｜原文首行。observe=零执行记录（inferred×observe，spec §6）；
 * P1 无行内处置按钮（01 §5 树未列；dismissObservation 通道在 store 备好，快照上界
 * 50 条由服务侧保证）。
 */
export const MateObserveRow = memo(function MateObserveRow({
  decision,
}: {
  decision: AssistantDecisionView;
}) {
  const { intl } = useDroraIntl();
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-2"
      data-testid="mate-observe-row"
    >
      <MateLamp tone="observe" />
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.observe.wouldAccept" })}
      </span>
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
        {firstPreviewLine(decision.triggerText)}
      </span>
    </div>
  );
});
