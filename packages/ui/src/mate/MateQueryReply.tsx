import { memo, useState } from "react";
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
  const format = (id: string) => intl.formatMessage({ id });
  const dismissQueryReply = useMateStore((state) => state.dismissQueryReply);
  // dismiss 失败反馈（审查修复 F5，照 MateConfigSection run() 先例）：store 对传输异常
  // 原样上抛，此处 catch 落 generic——静默失败会让卡不消失且无解释。
  const [failure, setFailure] = useState<string | null>(null);
  const dismiss = (): void => {
    dismissQueryReply(service, workspaceKey, { decisionId: decision.id })
      .then((result) => {
        setFailure(result.ok ? null : resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
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
      {failure ? (
        <p role="alert" className="text-ui-xs text-foreground-destructive">
          {format(failure)}
        </p>
      ) : null}
    </div>
  );
});
