import { memo, useState } from "react";
import { ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantResult,
  IAssistantTicketService,
} from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { resolveMateErrorMessageId, type MateErrorMessageId } from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

import { MateLamp } from "./MateLamp.js";

/**
 * 决策卡（01 §5 MateDecisionCard）：destructive 灯｜原文 verbatim 引用块（E 改单不改写
 * 原文，追加段在放行时随行）｜预估（权限档）｜权限档徽标｜「P1 未隔离」徽标（悬停出
 * 非容器级声明）｜[放行][忽略][追加说明后放行]。P1 仅按钮，无 Y/N/E 键盘流（01 §5
 * 诚实简化，键盘流随 P2 Surface A）。
 *
 * 动作全走 mateStore（service 作参数注入）；失败按 resolveMateErrorMessageId 出
 * role=alert 行，不在 store 落错误状态。目标 workspace 不由本卡选择：P1 触发已携带
 * 本 workspace identity（服务侧 approve 用 decision.workspace_identity 兜底），
 * 多目标选择随 P2 Mode A 目标解析统一（00 master plan §3.5）。
 *
 * 预估行的诚实降级（01 §5 写「预估（模型/tier）」）：AssistantDecisionView 契约
 * （assistantTickets.ts）无 model 字段——P1 模型随 P2 assistant preset 注入，本卡只
 * 渲染 tier；徽标与放行动作共用 ASSISTANT_PERMISSION_TIERS.build 单一出处，P2 加
 * 档位选择时同源替换。
 */
export const MateDecisionCard = memo(function MateDecisionCard({
  decision,
  service,
  workspaceKey,
  expanded,
  onToggleExpanded,
}: {
  decision: AssistantDecisionView;
  service: IAssistantTicketService;
  /** 本 workspace 分域键（store 动作的收尾只折叠本 workspace 的卡）。 */
  workspaceKey: string;
  /** 本卡是否展开追加说明输入区（mateStore 按 workspace 分域的 expandedDecisionId 驱动）。 */
  expanded: boolean;
  onToggleExpanded: (decisionId: number | null) => void;
}) {
  const { intl } = useDroraIntl();
  const approveDecision = useMateStore((state) => state.approveDecision);
  const ignoreDecision = useMateStore((state) => state.ignoreDecision);
  const [appendix, setAppendix] = useState("");
  const [failure, setFailure] = useState<MateErrorMessageId | null>(null);

  // 动作结果只回填本卡失败行（成功交由快照推送驱动 UI 收敛；store 按代际折叠本卡）。
  // 传输层异常（store 留 warn 日志后原样上抛）与失败臂同路出 role=alert，不留
  // unhandled rejection（PR-1B 二审发现 7）；错误码是封闭集合，异常一律落 generic。
  const run = (pending: Promise<AssistantResult<unknown>>): void => {
    pending
      .then((result) => {
        setFailure(result.ok ? null : resolveMateErrorMessageId(result.error));
      })
      .catch(() => {
        setFailure("mate.error.generic");
      });
  };

  return (
    <div
      className="rounded-lg border border-card-border bg-card p-3"
      data-testid="mate-decision-card"
    >
      <div className="flex items-center gap-2">
        <MateLamp tone="decision" />
        <span className="font-mono text-ui-xs text-foreground-subtlest">#{decision.id}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1">
          <span
            className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
            data-testid="mate-decision-tier"
          >
            {intl.formatMessage({ id: "mate.card.tier.build" })}
          </span>
          <span
            className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            title={intl.formatMessage({ id: "mate.card.p1.unisolated.hint" })}
            data-testid="mate-decision-unisolated"
          >
            {intl.formatMessage({ id: "mate.card.p1.unisolated" })}
          </span>
        </span>
      </div>
      <p className="mt-2 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.card.origin" })}
      </p>
      <blockquote
        className="mt-1 whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-surface px-2.5 py-2 text-ui-sm text-foreground"
        data-testid="mate-decision-origin"
      >
        {decision.triggerText}
      </blockquote>
      <p className="mt-1.5 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.card.estimate" })} ·{" "}
        {intl.formatMessage({ id: "mate.card.tier.build" })}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button
          size="xs"
          onClick={() =>
            run(
              approveDecision(service, workspaceKey, {
                decisionId: decision.id,
                permissionTier: ASSISTANT_PERMISSION_TIERS.build,
              }),
            )
          }
          data-testid="mate-decision-approve"
        >
          {intl.formatMessage({ id: "mate.card.approve" })}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => run(ignoreDecision(service, workspaceKey, { decisionId: decision.id }))}
          data-testid="mate-decision-ignore"
        >
          {intl.formatMessage({ id: "mate.card.ignore" })}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => onToggleExpanded(expanded ? null : decision.id)}
          data-testid="mate-decision-edit"
        >
          {intl.formatMessage({ id: "mate.card.edit" })}
        </Button>
      </div>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <label
            htmlFor={`mate-decision-appendix-${decision.id}`}
            className="text-ui-xs text-foreground-subtlest"
          >
            {intl.formatMessage({ id: "mate.card.edit" })}
          </label>
          <textarea
            id={`mate-decision-appendix-${decision.id}`}
            value={appendix}
            onChange={(event) => setAppendix(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-input-border bg-input px-2 py-1.5 text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
            data-testid="mate-decision-appendix"
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              disabled={appendix.trim().length === 0}
              onClick={() =>
                run(
                  approveDecision(service, workspaceKey, {
                    decisionId: decision.id,
                    briefAppendix: appendix,
                    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
                  }),
                )
              }
              data-testid="mate-decision-approve-appendix"
            >
              {intl.formatMessage({ id: "mate.card.approve" })}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onToggleExpanded(null)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
          </div>
        </div>
      ) : null}
      {failure !== null ? (
        <p
          role="alert"
          className="mt-2 text-ui-sm text-destructive"
          data-testid="mate-decision-error"
        >
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});
