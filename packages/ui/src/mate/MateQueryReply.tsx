import { memo } from "react";
import type { AssistantDecisionView, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { useMateStore } from "@/store/mateStore.js";
import { resolveMateErrorMessageId } from "./view-model.js";

/**
 * 查询直答卡（P7，08 号详设 §3.4）：Router query_status 臂 → host 确定性应答器直答
 * ——只读卡（问题原文首行+答复+dismiss），**无任何工单动作**（不建票不可放行；
 * dismiss 后 outcome=ignored 出清，同观察行语义）。
 */
export const MateQueryReply = memo(function MateQueryReply({
  service,
  workspaceKey,
  decision,
}: {
  service: IAssistantTicketService;
  workspaceKey: string;
  decision: AssistantDecisionView;
}) {
  const { intl } = useDroraIntl();
  const dismissQueryReply = useMateStore((state) => state.dismissQueryReply);
  const dismiss = (): void => {
    void dismissQueryReply(service, workspaceKey, { decisionId: decision.id }).then((result) => {
      if (!result.ok) {
        void resolveMateErrorMessageId(result.error);
      }
    });
  };
  const question = decision.triggerText.split("\n", 1)[0] ?? "";
  return (
    <div
      className="rounded-lg border border-input-border bg-input/40 px-2.5 py-2"
      data-testid="mate-query-reply-row"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "mate.query.reply.title" })}
        </span>
        <Button size="xs" variant="ghost" onClick={dismiss}>
          {intl.formatMessage({ id: "mate.query.reply.dismiss" })}
        </Button>
      </div>
      <p className="mt-1 line-clamp-2 text-ui-sm font-medium text-foreground">{question}</p>
      <p
        className="mt-1 whitespace-pre-wrap text-ui-sm text-foreground"
        data-testid="mate-query-reply-answer"
      >
        {decision.answer}
      </p>
      <p className="mt-1 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.query.reply.hint" })}
      </p>
    </div>
  );
});
