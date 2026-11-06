import { memo, useState } from "react";
import { ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type { AssistantPermissionTier } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantResult,
  IAssistantTicketService,
} from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import {
  mateManageActionMessageId,
  mateManageTargetKindMessageId,
  matePermissionTierMessageId,
  mateRouterSuggestionKindMessageId,
  resolveMateErrorMessageId,
  type MateErrorMessageId,
} from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

import { MateLamp } from "./MateLamp.js";
import { MateSourceBadge } from "./MateSourceBadge.js";

/**
 * 决策卡（01 §5 MateDecisionCard + 02 §1.3 Router 预填，P2 Surface A）。
 *
 * P1 基线：destructive 灯｜原文 verbatim 引用块（E 改单不改写原文，追加段在放行时
 * 随行）｜预估（权限档）｜徽标｜[放行][忽略][追加说明后放行]。
 *
 * P2 升级（快照 v2 决策卡预填面，specs §11.1）：
 * - routerState=pending → 「大副评估中」行；suggested → 建议区（四臂 kind 徽标+目标/
 *   会话/权限档/briefBase+证据 ≤3 条 verbatim 引用+reason）；failed → 降级行
 *   （routerError 诚实展示，不重试模型——服务侧已按 02 §1.2 降级 Tier3 问人）。
 * - 放行动作携带 Router 预填参：dispatch 建议→显式 targetWorkspaceIdentity+
 *   dispatchMode:'A'；attach 建议→显式 attachToSessionId（服务侧 02 §2 同参校验兜底）；
 *   hold/reject 建议只展示 reason，人工终审不变（observe 全量零执行）。
 * - Mode B 建队=第二放行动作（dispatchMode:'B'，仅 dispatch/attach 建议与无建议时
 *   渲染——hold/reject 建议下不提供建队捷径）。
 * - P10b manage 建议臂（10 号详设 §3.1）：建议区呈现对象/动作/理由/证据；Y 走
 *   approveManageDecision（管理动作批准入口——不建票不派 worker，服务侧事务翻
 *   managed 后异步经既有 harness 服务面执行，结果经快照 manageExecution 回写）；
 *   E 追加说明不渲染（管理动作无 brief 可改）。
 * - 权限档按建议渲染（缺省 build）；**建议 yolo 时不传 tier**（服务接口类型层排除
 *   yolo——放行回落 build 默认，徽标仍诚实显示建议档，spec §2.5 的 yolo 直派通道
 *   在 P2 不存在）。
 * - `queued:true` 返回 → 卡内告知行（固定排队文案）。**该行是放行响应的即时反馈**：
 *   快照推送（decided_by=user）会让本卡整体折叠，持续告知由工单行 queued 灯档承接、
 *   queuedReason 全文在 Surface C 时间线排队站（specs §11.1 落地注记）；approve 返回值
 *   只携带 queued 标志，本卡不伪造 reason。
 *
 * 动作全走 mateStore（service 作参数注入）；失败按 resolveMateErrorMessageId 出
 * role=alert 行，不在 store 落错误状态。本卡不提供目标选择控件（P1 语义保留）：放行
 * 目标=Router 建议预填值，缺省**显式**回落本 pane 的 workspaceKey（F1 修复，2026-11-06
 * ——本地 tab 的 workspaceIdentity 恒 undefined，旧实现只在有建议目标时显式传参，其余
 * 形态依赖服务兜底链 decision.workspace_identity，而旧触发未落 target 时该值 NULL，
 * 全链落空成 validationFailed「缺少派发目标」死卡）；服务侧 decision.workspace_identity
 * 仍兜底（托盘 decide / auto 无目标降级同链自然闭合）。
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
  const approveManageDecision = useMateStore((state) => state.approveManageDecision);
  const ignoreDecision = useMateStore((state) => state.ignoreDecision);
  const [appendix, setAppendix] = useState("");
  const [failure, setFailure] = useState<MateErrorMessageId | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);

  const suggestion = decision.routerSuggestion;
  // P10b（10 号详设 §3.1）：manage 臂——Y 走 approveManageDecision（管理动作批准入口，
  // 不建票不派 worker）；E 追加说明无意义（管理动作无 brief 可改），建队捷径不放
  // （showTeamAction 只认 dispatch/attach）。放行预检失败（可见集失配/通道未装配）
  // 按封闭错误码出 role=alert，卡不消费可重试新卡。
  const isManage = suggestion?.kind === "manage";
  // 权限档预填：建议带 build/guarded 用建议档；yolo 建议不传（服务回落 build——
  // 接口类型 Exclude<...,'yolo'>，P2 无 yolo 派发通道，见组件头注释）。
  const suggestedTier: AssistantPermissionTier | undefined = suggestion?.permissionTier;
  const approveTier =
    suggestedTier && suggestedTier !== ASSISTANT_PERMISSION_TIERS.yolo
      ? suggestedTier
      : ASSISTANT_PERMISSION_TIERS.build;
  const showTeamAction =
    (suggestion === undefined || suggestion.kind === "dispatch" || suggestion.kind === "attach") &&
    decision.routerState !== "failed";

  // 动作结果只回填本卡失败/排队行（成功收敛交由快照推送；store 按代际折叠本卡）。
  // 传输层异常（store 留 warn 日志后原样上抛）与失败臂同路出 role=alert，不留
  // unhandled rejection（PR-1B 二审发现 7）；错误码是封闭集合，异常一律落 generic。
  const run = (pending: Promise<AssistantResult<unknown>>): void => {
    pending
      .then((result) => {
        if (result.ok) {
          setFailure(null);
          // P2 软预算/写域冲突（specs §9）：approve 命中排队时工单以 queued 立项，
          // 本卡告知后随快照推送折叠（工单行承接 queued 灯档与 queuedReason）。
          const value = result.value as { queued?: boolean };
          setQueuedNotice(value.queued === true);
        } else {
          setFailure(resolveMateErrorMessageId(result.error));
        }
      })
      .catch(() => {
        setFailure("mate.error.generic");
      });
  };

  const approve = (extra: { dispatchMode?: "A" | "B"; attachToSessionId?: string }) =>
    run(
      approveDecision(service, workspaceKey, {
        decisionId: decision.id,
        permissionTier: approveTier,
        // 放行目标（F1 修复）：建议目标预填优先（dispatch/attach 建议的 arm.target，
        // 服务侧同参校验兜底）；无建议/建议无目标时显式回落本 pane workspaceKey——
        // 比只靠服务兜底链诚实（旧触发 target 未落库时兜底链全空成死卡）。
        targetWorkspaceIdentity: suggestion?.targetWorkspaceIdentity ?? workspaceKey,
        ...extra,
      }),
    );

  return (
    <div
      className="rounded-lg border border-card-border bg-card p-3"
      data-testid="mate-decision-card"
    >
      <div className="flex items-center gap-2">
        <MateLamp tone="decision" />
        <span className="font-mono text-ui-xs text-foreground-subtlest">#{decision.id}</span>
        {/* P3 来源徽标（spec §11 落地注记）：快照可选字段缺席不渲染。 */}
        {decision.sourceKind ? <MateSourceBadge sourceKind={decision.sourceKind} /> : null}
        <span className="ml-auto flex min-w-0 items-center gap-1">
          <span
            className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
            data-testid="mate-decision-tier"
          >
            {intl.formatMessage({
              id: matePermissionTierMessageId(suggestedTier ?? ASSISTANT_PERMISSION_TIERS.build),
            })}
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
      {decision.routerState === "pending" ? (
        <p
          className="mt-2 text-ui-xs text-foreground-subtle"
          data-testid="mate-decision-router-pending"
        >
          {intl.formatMessage({ id: "mate.router.pending" })}
        </p>
      ) : null}
      {decision.routerState === "failed" ? (
        <div
          className="mt-2 rounded-md bg-surface px-2.5 py-2"
          data-testid="mate-decision-router-failed"
        >
          <p className="text-ui-xs text-warning-surface-foreground">
            {intl.formatMessage({ id: "mate.router.failed" })}
          </p>
          {decision.routerError ? (
            <p className="mt-1 break-words font-mono text-ui-xs text-foreground-subtlest">
              {decision.routerError}
            </p>
          ) : null}
        </div>
      ) : null}
      {suggestion ? (
        <div
          className="mt-2 rounded-md border border-border bg-surface px-2.5 py-2"
          data-testid="mate-decision-router-suggestion"
        >
          <p className="text-ui-sm font-medium text-foreground">
            {intl.formatMessage({ id: mateRouterSuggestionKindMessageId(suggestion.kind) })}
          </p>
          {suggestion.targetWorkspaceIdentity ? (
            <p className="mt-1 break-words text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "mate.router.target" },
                { identity: suggestion.targetWorkspaceIdentity },
              )}
            </p>
          ) : null}
          {suggestion.sessionId ? (
            <p className="mt-1 break-words font-mono text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "mate.router.session" },
                { sessionId: suggestion.sessionId },
              )}
            </p>
          ) : null}
          {suggestion.kind === "dispatch" && suggestion.briefBase ? (
            <p className="mt-1 text-ui-xs text-foreground-subtle">
              {intl.formatMessage({
                id:
                  suggestion.briefBase === "verbatim"
                    ? "mate.router.briefBase.verbatim"
                    : "mate.router.briefBase.appendix",
              })}
            </p>
          ) : null}
          {suggestion.kind === "manage" ? (
            <div className="mt-1 flex flex-col gap-0.5" data-testid="mate-decision-manage-arm">
              {suggestion.manageAction &&
              mateManageActionMessageId(suggestion.manageAction) !== null ? (
                <p className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({
                    id: mateManageActionMessageId(suggestion.manageAction)!,
                  })}
                </p>
              ) : null}
              {suggestion.manageTargetRef ? (
                <p className="break-all font-mono text-ui-xs text-foreground-subtle">
                  {suggestion.manageTargetKind &&
                  mateManageTargetKindMessageId(suggestion.manageTargetKind) !== null
                    ? `${intl.formatMessage({
                        id: mateManageTargetKindMessageId(suggestion.manageTargetKind)!,
                      })} · `
                    : ""}
                  {suggestion.manageTargetRef}
                </p>
              ) : null}
            </div>
          ) : null}
          {suggestion.reason ? (
            <p className="mt-1 break-words text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "mate.router.reason" })}：{suggestion.reason}
            </p>
          ) : null}
          {suggestion.evidence.length > 0 ? (
            <div className="mt-1.5" data-testid="mate-decision-router-evidence">
              <p className="text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "mate.router.evidence" })}
              </p>
              {suggestion.evidence.map((quote, index) => (
                <blockquote
                  key={index}
                  className="mt-1 break-words border-l-2 border-border pl-2 text-ui-xs text-foreground-subtle"
                >
                  {quote}
                </blockquote>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {!suggestion && decision.routerState === undefined ? (
        <p className="mt-1.5 text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "mate.card.estimate" })} ·{" "}
          {intl.formatMessage({ id: matePermissionTierMessageId(approveTier) })}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {isManage ? (
          <Button
            size="xs"
            onClick={() =>
              run(approveManageDecision(service, workspaceKey, { decisionId: decision.id }))
            }
            data-testid="mate-decision-approve-manage"
          >
            {intl.formatMessage({ id: "mate.card.approve" })}
          </Button>
        ) : (
          <Button
            size="xs"
            onClick={() =>
              approve(
                suggestion?.kind === "attach" && suggestion.sessionId
                  ? { attachToSessionId: suggestion.sessionId }
                  : { dispatchMode: "A" },
              )
            }
            data-testid="mate-decision-approve"
          >
            {intl.formatMessage({ id: "mate.card.approve" })}
          </Button>
        )}
        {showTeamAction ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => approve({ dispatchMode: "B" })}
            data-testid="mate-decision-approve-team"
          >
            {intl.formatMessage({ id: "mate.card.approveAsTeam" })}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="outline"
          onClick={() => run(ignoreDecision(service, workspaceKey, { decisionId: decision.id }))}
          data-testid="mate-decision-ignore"
        >
          {intl.formatMessage({ id: "mate.card.ignore" })}
        </Button>
        {isManage ? null : (
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => onToggleExpanded(expanded ? null : decision.id)}
            data-testid="mate-decision-edit"
          >
            {intl.formatMessage({ id: "mate.card.edit" })}
          </Button>
        )}
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
                    permissionTier: approveTier,
                    // F1 同主放行臂：建议目标预填优先，缺省显式回落 workspaceKey。
                    targetWorkspaceIdentity: suggestion?.targetWorkspaceIdentity ?? workspaceKey,
                    ...(suggestion?.kind === "attach" && suggestion.sessionId
                      ? { attachToSessionId: suggestion.sessionId }
                      : {}),
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
      {queuedNotice ? (
        <p
          role="status"
          className="mt-2 text-ui-sm text-foreground-subtle"
          data-testid="mate-decision-queued-notice"
        >
          {intl.formatMessage({ id: "mate.card.queueNotice" })}
        </p>
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
