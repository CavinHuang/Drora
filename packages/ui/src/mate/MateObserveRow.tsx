import { memo, useState } from "react";
import type { AssistantDecisionView, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

import { MateLamp } from "./MateLamp.js";
import { MateSourceBadge } from "./MateSourceBadge.js";
import { firstPreviewLine } from "./MateTicketRow.js";
import { resolveMateErrorMessageId } from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

/**
 * 观察行（01 §5 MateObserveRow）：foreground-subtlest 空心灯（五档映射，仅灯不填充）｜
 * would-accept 标签｜原文首行。observe=零执行记录（inferred×observe，spec §6）。
 *
 * 「忽略」按钮（specs §11 能力审查修复批）：dismissObservation 通道的 UI 消费——
 * outcome→ignored 即出观察集（快照推送收敛）；48h 否定记忆是 autonomy 卡专属语义，
 * 观察行维持无记忆。失败反馈照 MateQueryReply 先例（role=alert；传输异常落 generic）。
 */
export const MateObserveRow = memo(function MateObserveRow({
  decision,
  service,
  workspaceKey,
}: {
  decision: AssistantDecisionView;
  /** 服务动作入口（忽略经 mateStore single-flight，与决策卡同纪律）。 */
  service: IAssistantTicketService;
  /** workspace 分域键（mateStore 动作隔离）。 */
  workspaceKey: string;
}) {
  const { intl } = useDroraIntl();
  const dismissObservation = useMateStore((state) => state.dismissObservation);
  const [failure, setFailure] = useState<string | null>(null);
  const dismiss = (): void => {
    setFailure(null);
    dismissObservation(service, workspaceKey, { triggerId: decision.triggerId })
      .then((result) => {
        if (!result.ok) setFailure(resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
  };
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-2.5 py-2"
      data-testid="mate-observe-row"
    >
      <MateLamp tone="observe" />
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.observe.wouldAccept" })}
      </span>
      {/* P3 来源徽标（spec §11 落地注记）：快照可选字段缺席不渲染。 */}
      {decision.sourceKind ? <MateSourceBadge sourceKind={decision.sourceKind} /> : null}
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
        {firstPreviewLine(decision.triggerText)}
      </span>
      <Button size="xs" variant="ghost" onClick={dismiss} data-testid="mate-observe-dismiss">
        {intl.formatMessage({ id: "mate.observe.dismiss" })}
      </Button>
      {failure ? (
        <span role="alert" className="shrink-0 text-ui-xs text-foreground-destructive">
          {intl.formatMessage({ id: failure })}
        </span>
      ) : null}
    </div>
  );
});
