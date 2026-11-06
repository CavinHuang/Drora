import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ASSISTANT_MODES, ASSISTANT_STRENGTHS } from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantSnapshot,
  IAssistantTicketService,
  MateThreadRow,
} from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { useMateStore } from "@/store/mateStore.js";
import { mateTicketLampTone } from "./statusTone.js";
import { MateLamp } from "./MateLamp.js";
import { MateSourceBadge } from "./MateSourceBadge.js";
import { MateDecisionCard } from "./MateDecisionCard.js";
import { MateAutoNoticeRow } from "./MateAutoNoticeRow.js";
import {
  deriveMateThreadRows,
  formatMateThreadClock,
  isMateAutoNoticeDecision,
  isMateManageExecutedDecision,
  isMatePendingDecision,
  isMateQueryReply,
  isMateThreadTicketNavigable,
  mateManageActionMessageId,
  mateManageStateMessageId,
  mateManageTargetKindMessageId,
  mateSourceKindMessageId,
  mateTicketGenerationNumber,
  mergeMateThreadRows,
  resolveMateErrorMessageId,
  type MateErrorMessageId,
} from "./view-model.js";
import { firstPreviewLine } from "./MateTicketRow.js";

/**
 * 对话管理台（P10a-2，10 号详设 §2.1/§2.3 v2.1）：MateSidePane 顶部「对话」区。
 *
 * 对话流=台账的消息投影（零新状态所有者）：首屏=快照截断版（deriveMateThreadRows 纯
 * 投影，快照推送即收敛）；「加载更早」走 readMateThread（beforeMs 游标，缺省全流——
 * 与首屏同口径；已取回的旧页是只读历史，存组件局部态不进 store，不建第二状态源）。
 * 四类消息：
 * - 用户消息=trigger verbatim+绝对时刻（桌宠纪律：不做相对时长、纯 DOM 零定时器）；
 * - 决策卡内嵌=复用 MateDecisionCard（Y/N 就在对话现场；主列表收件箱视角同卡共存——
 *   同源同卡不双写）；
 * - 答复气泡=outcome=status_replied（含 chat_replied——视图层两者同 outcome，reason_code
 *   区分是服务侧审计语义）消费 decision.answer；原 MateQueryReply 卡区已撤（不重复渲染）；
 * - 工单摘要行=ticket 终态行（终态+换代标注；快照容量内可点行进详情——详情按快照工单
 *   集渲染，裁剪后的旧行降级为不可点行，不造空详情）。
 * 其余 decision outcome 不出独立消息（would_accept 在观察区、已决卡由工单摘要行/收件箱
 * 承接）；auto 模式的 auto_notice 告知卡内嵌（§2.3 mode 矩阵）。
 *
 * composer：单行输入（一期纯文本无附件）；发送=mateStore.recordTrigger(explicit,
 * target=workspaceKey)——与 /mate 命令拦截、配置区触发完全同链（F1 同款恒传 target）。
 * off 模式：输入/发送禁用+提示（含读零执行；对话面只读——分页读不受限）。
 */
export const MateThreadSection = memo(function MateThreadSection({
  snapshot,
  service,
  workspaceKey,
  expandedDecisionId,
  onToggleExpanded,
  onSelectTicket,
}: {
  snapshot: AssistantSnapshot;
  service: IAssistantTicketService;
  /** 本 workspace 分域键（AGENTS 身份键；recordTrigger target 与 store 动作同域）。 */
  workspaceKey: string;
  /** 本 workspace 当前展开追加说明的决策卡 id（mateStore 分域局部态，与收件箱卡共用）。 */
  expandedDecisionId: number | null;
  onToggleExpanded: (decisionId: number | null) => void;
  /** 摘要行点击 → selectTicket（Surface C 详情下钻，复用既有选中域）。 */
  onSelectTicket: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const recordTrigger = useMateStore((state) => state.recordTrigger);
  const [draft, setDraft] = useState("");
  const [sendFailure, setSendFailure] = useState<MateErrorMessageId | null>(null);
  // 分页过程态（组件局部——只读历史的已取回页与游标用尽标记，非业务状态）。
  const [olderPages, setOlderPages] = useState<readonly MateThreadRow[]>([]);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderFailure, setOlderFailure] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const firstScreen = useMemo(() => deriveMateThreadRows(snapshot), [snapshot]);
  const rows = useMemo(
    () => mergeMateThreadRows(olderPages, firstScreen),
    [olderPages, firstScreen],
  );
  const off = snapshot.mode === ASSISTANT_MODES.off;
  // 渲染时刻一次成型的绝对时刻基准（零定时器：不随时间刷新，不建 ticker）。
  const nowMs = Date.now();

  // 新消息落底（对话语义：最新在底部）——末行签名变化时滚到底；「加载更早」前插旧行
  // 不改末行签名，不触发跳动。
  const lastRowSignature =
    rows.length > 0 ? `${rows[rows.length - 1]!.kind}:${rows[rows.length - 1]!.atMs}` : "";
  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    list.scrollTo({ top: list.scrollHeight });
  }, [lastRowSignature]);

  const loadOlder = (): void => {
    if (olderLoading || olderExhausted) return;
    const oldest = rows[0]?.atMs;
    if (oldest === undefined) return;
    setOlderLoading(true);
    setOlderFailure(false);
    service
      .readMateThread({ beforeMs: oldest })
      .then((result) => {
        if (result.ok) {
          setOlderPages((previous) => mergeMateThreadRows(previous, result.value.rows));
          // nextBeforeMs=null=主查询未满页（无更早行）；空页同理——按钮收起（不重试猜史）。
          setOlderExhausted(result.value.nextBeforeMs === null || result.value.rows.length === 0);
        } else {
          setOlderFailure(true);
        }
      })
      .catch(() => setOlderFailure(true))
      .finally(() => setOlderLoading(false));
  };

  // 发送=explicit 触发进准入门（与 /mate 拦截、配置区触发同链；verbatim 只去首尾空白）。
  // 失败按 resolveMateErrorMessageId 出 role=alert（照 MateQueryReply 前身/配置区先例），
  // 成功清空草稿——用户气泡由快照推送收敛（无本地乐观副本，快照是唯一事实源）。
  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0 || off) return;
    recordTrigger(service, workspaceKey, {
      text,
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: workspaceKey,
    })
      .then((result) => {
        if (result.ok) {
          setDraft("");
          setSendFailure(null);
        } else {
          setSendFailure(resolveMateErrorMessageId(result.error));
        }
      })
      .catch(() => setSendFailure("mate.error.generic"));
  };

  return (
    <section
      className="flex flex-col gap-1.5 border-b border-border/50 px-3 py-2"
      data-testid="mate-thread"
    >
      <header className="flex items-center gap-2 px-0.5">
        <span className="text-ui-xs font-medium text-foreground-subtle">
          {intl.formatMessage({ id: "mate.thread.title" })}
        </span>
      </header>
      <div
        ref={listRef}
        className="flex max-h-60 flex-col gap-2 overflow-y-auto px-0.5"
        data-testid="mate-thread-list"
      >
        {rows.length === 0 ? (
          <p
            className="px-0.5 py-1 text-ui-xs text-foreground-subtlest"
            data-testid="mate-thread-empty"
          >
            {intl.formatMessage({ id: "mate.thread.empty" })}
          </p>
        ) : (
          <>
            {!olderExhausted ? (
              <Button
                size="xs"
                variant="ghost"
                className="self-start"
                disabled={olderLoading}
                onClick={loadOlder}
                data-testid="mate-thread-load-earlier"
              >
                {intl.formatMessage({ id: "mate.thread.loadEarlier" })}
              </Button>
            ) : null}
            {rows.map((row) => (
              <MateThreadRowView
                key={`${row.kind}:${threadRowKey(row)}`}
                row={row}
                snapshot={snapshot}
                service={service}
                workspaceKey={workspaceKey}
                expandedDecisionId={expandedDecisionId}
                onToggleExpanded={onToggleExpanded}
                onSelectTicket={onSelectTicket}
                nowMs={nowMs}
              />
            ))}
          </>
        )}
        {olderFailure ? (
          <p
            role="alert"
            className="text-ui-xs text-foreground-destructive"
            data-testid="mate-thread-load-error"
          >
            {intl.formatMessage({ id: "mate.thread.loadFailed" })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {off ? (
          <p
            className="text-ui-xs text-foreground-subtlest"
            data-testid="mate-thread-composer-off-hint"
          >
            {intl.formatMessage({ id: "mate.thread.composer.off" })}
          </p>
        ) : null}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // 中文输入法组词中的 Enter 不发送（isComposing）；单行输入 Enter=发送。
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            disabled={off}
            aria-label={intl.formatMessage({ id: "mate.thread.composer.placeholder" })}
            placeholder={intl.formatMessage({ id: "mate.thread.composer.placeholder" })}
            className="min-w-0 flex-1 rounded-md border border-input-border bg-input px-2 py-1 text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none disabled:opacity-60"
            data-testid="mate-thread-composer-input"
          />
          <Button
            size="xs"
            disabled={off || draft.trim().length === 0}
            onClick={send}
            data-testid="mate-thread-composer-send"
          >
            {intl.formatMessage({ id: "mate.thread.composer.send" })}
          </Button>
        </div>
        {sendFailure !== null ? (
          <p role="alert" className="text-ui-xs text-foreground-destructive">
            {intl.formatMessage({ id: sendFailure })}
          </p>
        ) : null}
      </div>
    </section>
  );
});

/** 行 key 稳定 id（trigger.id / decision.id / ticketId；与去重键同源）。 */
function threadRowKey(row: MateThreadRow): string {
  switch (row.kind) {
    case "trigger":
      return row.trigger.id;
    case "decision":
      return String(row.decision.id);
    case "ticket":
      return row.ticket.ticketId;
  }
}

/** 单行分发：trigger=用户气泡 / decision 按 outcome 分流 / ticket=终态摘要行。 */
const MateThreadRowView = memo(function MateThreadRowView({
  row,
  snapshot,
  service,
  workspaceKey,
  expandedDecisionId,
  onToggleExpanded,
  onSelectTicket,
  nowMs,
}: {
  row: MateThreadRow;
  snapshot: AssistantSnapshot;
  service: IAssistantTicketService;
  workspaceKey: string;
  expandedDecisionId: number | null;
  onToggleExpanded: (decisionId: number | null) => void;
  onSelectTicket: (ticketId: string) => void;
  nowMs: number;
}) {
  switch (row.kind) {
    case "trigger":
      return (
        <div className="flex flex-col items-end gap-0.5" data-testid="mate-thread-user">
          <div className="max-w-[85%] rounded-lg bg-input px-2.5 py-1.5 text-ui-sm text-foreground">
            <p className="whitespace-pre-wrap break-words">{row.trigger.text}</p>
          </div>
          <div className="flex items-center gap-1">
            {mateSourceKindMessageId(row.trigger.sourceKind ?? "") !== null ? (
              <MateSourceBadge sourceKind={row.trigger.sourceKind ?? ""} />
            ) : null}
            <time
              dateTime={new Date(row.atMs).toISOString()}
              className="text-ui-xs text-foreground-subtlest"
            >
              {formatMateThreadClock(row.atMs, nowMs)}
            </time>
          </div>
        </div>
      );
    case "decision":
      return (
        <MateThreadDecisionRow
          decision={row.decision}
          snapshot={snapshot}
          service={service}
          workspaceKey={workspaceKey}
          expandedDecisionId={expandedDecisionId}
          onToggleExpanded={onToggleExpanded}
        />
      );
    case "ticket":
      return (
        <MateThreadTicketLine
          row={row}
          snapshot={snapshot}
          onSelectTicket={onSelectTicket}
        />
      );
  }
});

/**
 * decision 行分流（10 号详设 §2.1/§2.3）：待决策卡内嵌（Y/N 在对话现场）/status_replied
 * 答复气泡/auto_notice 告知卡内嵌；其余 outcome 不出独立消息（观察行/已决卡的呈现归
 * 观察区与收件箱既有面，工单后果由摘要行承接）。
 */
const MateThreadDecisionRow = memo(function MateThreadDecisionRow({
  decision,
  snapshot,
  service,
  workspaceKey,
  expandedDecisionId,
  onToggleExpanded,
}: {
  decision: AssistantDecisionView;
  snapshot: AssistantSnapshot;
  service: IAssistantTicketService;
  workspaceKey: string;
  expandedDecisionId: number | null;
  onToggleExpanded: (decisionId: number | null) => void;
}) {
  if (isMatePendingDecision(decision)) {
    return (
      <div className="w-full" data-testid="mate-thread-decision">
        <MateDecisionCard
          decision={decision}
          service={service}
          workspaceKey={workspaceKey}
          expanded={expandedDecisionId === decision.id}
          onToggleExpanded={onToggleExpanded}
        />
      </div>
    );
  }
  if (isMateQueryReply(decision)) {
    return <MateThreadReplyBubble decision={decision} service={service} workspaceKey={workspaceKey} />;
  }
  if (isMateAutoNoticeDecision(decision)) {
    return (
      <div className="w-full" data-testid="mate-thread-auto-notice">
        <MateAutoNoticeRow decision={decision} snapshot={snapshot} />
      </div>
    );
  }
  // P10b（10 号详设 §3.1）：manage 放行终态=管理结果消息（executed/skipped=已无需
  // 执行/failed+原因；执行细节在 host 侧 manageActions——对话流只消费决策投影）。
  if (isMateManageExecutedDecision(decision)) {
    return <MateThreadManageResult decision={decision} />;
  }
  return null;
});

/**
 * 管理结果消息（outcome=managed）：对象+动作摘要行 + 执行结果状态（executed/skipped/
 * failed/executing）+ note verbatim（失败原因/幂等标注）。无动作按钮（执行已发生或已
 * 拒绝；失败重新触发=用户重新发起管理意图走新卡，不在本消息上重试）。
 */
const MateThreadManageResult = memo(function MateThreadManageResult({
  decision,
}: {
  decision: AssistantDecisionView;
}) {
  const { intl } = useDroraIntl();
  const suggestion = decision.routerSuggestion;
  const actionLabel =
    suggestion?.manageAction && mateManageActionMessageId(suggestion.manageAction) !== null
      ? intl.formatMessage({ id: mateManageActionMessageId(suggestion.manageAction)! })
      : null;
  const targetLabel =
    suggestion?.manageTargetRef &&
    suggestion.manageTargetKind &&
    mateManageTargetKindMessageId(suggestion.manageTargetKind) !== null
      ? `${intl.formatMessage({
          id: mateManageTargetKindMessageId(suggestion.manageTargetKind)!,
        })} ${suggestion.manageTargetRef}`
      : (suggestion?.manageTargetRef ?? null);
  const execution = decision.manageExecution;
  return (
    <div
      className="flex w-full flex-col items-start gap-0.5"
      data-testid="mate-thread-manage-result"
    >
      <span className="text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.thread.manage.result" })}
      </span>
      <div className="max-w-[85%] rounded-lg border border-border bg-surface px-2.5 py-1.5">
        {actionLabel ?? targetLabel ? (
          <p className="break-all text-ui-sm text-foreground">
            {actionLabel ?? ""}
            {actionLabel && targetLabel ? " · " : ""}
            {targetLabel ?? ""}
          </p>
        ) : null}
        {execution ? (
          <p className="mt-0.5 break-words text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: mateManageStateMessageId(execution.state) })}
            {execution.note ? `：${execution.note}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
});

/**
 * 答复气泡（status_replied，含 chat_replied）：answer verbatim+账本来源提示+知道了
 * （dismissQueryReply——outcome 翻 ignored 出清，台账 dismiss 语义保持；原卡区呈现撤除后
 * 对话流是 status_replied 的唯一呈现面）。无任何工单动作（不可放行）。
 */
const MateThreadReplyBubble = memo(function MateThreadReplyBubble({
  decision,
  service,
  workspaceKey,
}: {
  decision: AssistantDecisionView;
  service: IAssistantTicketService;
  workspaceKey: string;
}) {
  const { intl } = useDroraIntl();
  const dismissQueryReply = useMateStore((state) => state.dismissQueryReply);
  // dismiss 失败反馈（照原 MateQueryReply 卡先例）：传输异常/失败臂落 role=alert——静默
  // 失败会让气泡不消失且无解释。
  const [failure, setFailure] = useState<MateErrorMessageId | null>(null);
  const dismiss = (): void => {
    dismissQueryReply(service, workspaceKey, { decisionId: decision.id })
      .then((result) => setFailure(result.ok ? null : resolveMateErrorMessageId(result.error)))
      .catch(() => setFailure("mate.error.generic"));
  };
  return (
    <div
      className="flex w-full flex-col items-start gap-0.5"
      data-testid="mate-thread-reply"
    >
      <span className="text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.query.reply.title" })}
      </span>
      <div className="max-w-[85%] rounded-lg border border-border bg-surface px-2.5 py-1.5">
        <p className="whitespace-pre-wrap break-words text-ui-sm text-foreground">
          {decision.answer ?? ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="ghost" onClick={dismiss}>
          {intl.formatMessage({ id: "mate.query.reply.dismiss" })}
        </Button>
        <span className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "mate.query.reply.hint" })}
        </span>
      </div>
      {failure !== null ? (
        <p role="alert" className="text-ui-xs text-foreground-destructive">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});

/**
 * 工单终态摘要行：灯+终态+brief+结论首行（output_summary/fail_reason）+换代标注。
 * 快照容量内的工单可点进详情（复用 Surface C 选中域）；被快照 LRU 裁剪的旧工单行
 * 仍在流（台账事实）但降级为不可点——详情视图按快照工单集渲染，不造空详情。
 */
const MateThreadTicketLine = memo(function MateThreadTicketLine({
  row,
  snapshot,
  onSelectTicket,
}: {
  row: Extract<MateThreadRow, { kind: "ticket" }>;
  snapshot: AssistantSnapshot;
  onSelectTicket: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const ticket = row.ticket;
  const failed = ticket.status === "failed";
  const summaryFirstLine = firstPreviewLine(ticket.outputSummary ?? ticket.failReason ?? "");
  const generation = mateTicketGenerationNumber(ticket);
  const body = (
    <>
      <MateLamp tone={mateTicketLampTone(ticket.status)} />
      <span className="shrink-0 text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: failed ? "mate.report.failed" : "mate.report.done" })}
      </span>
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{ticket.brief}</span>
      {summaryFirstLine.length > 0 ? (
        <span className="min-w-0 max-w-[40%] truncate text-ui-xs text-foreground-subtlest">
          {summaryFirstLine}
        </span>
      ) : null}
      {generation > 1 ? (
        <span
          className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
          data-testid="mate-thread-ticket-generation"
        >
          {intl.formatMessage({ id: "mate.ticket.generation" }, { gen: generation })}
        </span>
      ) : null}
    </>
  );
  if (!isMateThreadTicketNavigable(snapshot, ticket.ticketId)) {
    return (
      <div
        className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 opacity-60"
        data-testid="mate-thread-ticket-row"
        aria-disabled="true"
      >
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelectTicket(ticket.ticketId)}
      data-testid="mate-thread-ticket-row"
      className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
    >
      {body}
    </button>
  );
});
