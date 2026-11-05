import { memo, useState } from "react";
import { ArrowLeftIcon, HourglassIcon } from "lucide-react";
import type {
  AssistantResult,
  AssistantSnapshot,
  AssistantTicketView,
  IAssistantTicketService,
} from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";

import { MateLamp } from "./MateLamp.js";
import { mateTicketLampTone } from "./statusTone.js";
import {
  findMateDecisionForTicket,
  isMateAwaitingVerification,
  mateTicketGenerationNumber,
  mateRouterSuggestionKindMessageId,
  mateStaleBadgeKind,
  mateUnconfirmedIncrement,
  resolveMateErrorMessageId,
  resolveMateUsageGenerations,
} from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

/**
 * 工单详情二级视图（02 详设 §7 Surface C：返回按钮+四页签 时间线/汇报/证据/成本；
 * P4 第二棒按 04 详设 §3 完整版升级）。
 *
 * 全部内容是快照投影（specs §11「所有面是 TicketService 快照的投影」），事实裁剪诚实
 * 标注（与 spec §11.3 落地注记一致）：
 * - 时间线=代际站：queued 站（queuedReason）→ 派发站（dispatchMode+sessionId）→ 锚站
 *   （anchorCommandId 或「尚未投递」）→ 工件核验站（awaitingSinceMs 有值：滞留起始+
 *   「人工确认交付」按钮）→ 当前代站（第 generationCount+1 代，强强调）。
 *   轨/站用 mate scope token（--color-mate-trace 族，DESIGN.md 已登记；不挪用 workflow
 *   家族）；站状态语义仍用共享状态色（灯=mateTicketLampTone）。
 * - 汇报页=output_summary/fail_reason；awaiting 滞留提示+确认按钮；无汇报显示「尚无汇报」。
 * - 证据页（P4 全量只读）：决策卡关联（trigger verbatim+Router 建议 reason/evidence）+
 *   **briefFull 全量 verbatim**（快照可选字段，缺席=预览 120 字诚实降级）+**工件链接**
 *   （writeDomain：worktree=path+branch；paths/workspace=「无 git 工件」）；无关联（手动
 *   建票或卡被快照容量裁剪）→ brief 原文诚实降级（不猜触发文本）。
 * - 成本页（P4 按代分解）：usageByGeneration 分代行（每代 input/output/时长，当代=迄今，
 *   Σ=合计）；字段缺席（旧 Host）沿用 P2 合计+说明诚实降级（不伪造逐代数据，specs §8）。
 *
 * 页签选择是纯视图态（本组件 useState，不入 mateStore——store 三件局部态契约不变）。
 */
type MateDetailTab = "timeline" | "report" | "evidence" | "cost";

const MATE_DETAIL_TABS: ReadonlyArray<{ id: MateDetailTab; messageId: string; testid: string }> = [
  { id: "timeline", messageId: "mate.detail.tab.timeline", testid: "mate-detail-tab-timeline" },
  { id: "report", messageId: "mate.detail.tab.report", testid: "mate-detail-tab-report" },
  { id: "evidence", messageId: "mate.detail.tab.evidence", testid: "mate-detail-tab-evidence" },
  { id: "cost", messageId: "mate.detail.tab.cost", testid: "mate-detail-tab-cost" },
];

export const MateTicketDetail = memo(function MateTicketDetail({
  snap,
  ticket,
  service,
  workspaceKey,
  onBack,
  onOpenSession,
}: {
  snap: AssistantSnapshot;
  ticket: AssistantTicketView;
  /** 服务动作入口（核验滞留的「人工确认交付」经 mateStore single-flight；04 详设 §3）。 */
  service: IAssistantTicketService;
  /** workspace 分域键（mateStore 动作隔离）。 */
  workspaceKey: string;
  onBack: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const [tab, setTab] = useState<MateDetailTab>("timeline");
  const confirmOutput = useMateStore((state) => state.confirmTicketOutput);
  const confirmIncrements = useMateStore((state) => state.confirmTicketIncrements);
  // 人工确认失败臂（role=alert；成功由快照推送收敛——awaiting 站/横幅随状态出清）。
  const [failure, setFailure] = useState<string | null>(null);
  const generation = mateTicketGenerationNumber(ticket);
  const linkedDecision = findMateDecisionForTicket(snap, ticket);
  const suggestion = linkedDecision?.routerSuggestion;
  const increment = mateUnconfirmedIncrement(ticket);
  const staleKind = mateStaleBadgeKind(ticket);
  const usageGenerations = resolveMateUsageGenerations(ticket);
  const runConfirm = (pending: Promise<AssistantResult<unknown>>): void => {
    setFailure(null);
    pending
      .then((result) => {
        if (!result.ok) setFailure(resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
  };
  const runIncrementConfirm = (): void => {
    setFailure(null);
    confirmIncrements(service, workspaceKey, { ticketId: ticket.id })
      .then((result) => {
        if (!result.ok) setFailure(resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mate-ticket-detail">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={onBack}
          data-testid="mate-detail-back"
          aria-label={intl.formatMessage({ id: "mate.detail.back" })}
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          <span className="ml-1">{intl.formatMessage({ id: "mate.detail.back" })}</span>
        </Button>
        <span className="truncate text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.detail.title" })}
        </span>
        <MateLamp tone={mateTicketLampTone(ticket.status)} />
        {staleKind ? (
          <span
            className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            data-testid="mate-detail-stale"
          >
            {intl.formatMessage({ id: `mate.watchdog.kind.${staleKind}` })}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtle">
          {ticket.id}
        </span>
      </div>
      <div
        className="flex shrink-0 items-center gap-1 border-b border-border/50 px-3 py-1.5"
        role="tablist"
      >
        {MATE_DETAIL_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-testid={item.testid}
            onClick={() => setTab(item.id)}
            className={cn(
              // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
              "h-7 rounded-lg px-2 text-ui-sm transition-colors",
              tab === item.id
                ? "bg-selected font-medium text-foreground"
                : "text-foreground-subtle hover:bg-hover hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: item.messageId })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === "timeline" ? (
          <MateTimelineStations ticket={ticket} generation={generation} />
        ) : null}
        {tab === "report" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-report">
            {increment ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-md bg-surface px-2 py-1.5"
                data-testid="mate-detail-increment"
              >
                <span className="min-w-0 flex-1 break-words text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "mate.report.increment" }, increment)}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={runIncrementConfirm}
                  data-testid="mate-detail-increment-confirm"
                >
                  {intl.formatMessage({ id: "mate.report.increment.confirm" })}
                </Button>
              </div>
            ) : null}
            {isMateAwaitingVerification(ticket.status) ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-md bg-surface px-2 py-1.5"
                data-testid="mate-detail-awaiting"
              >
                <HourglassIcon aria-hidden className="size-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1 break-words text-ui-xs text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "mate.report.awaiting.since" },
                    { since: formatTaskRelativeTime(ticket.awaitingSinceMs ?? ticket.updatedAtMs, intl) },
                  )}
                </span>
                <Button
                  size="xs"
                  onClick={() =>
                    runConfirm(
                      confirmOutput(service, workspaceKey, { ticketId: ticket.id }),
                    )
                  }
                  data-testid="mate-detail-confirm-output"
                >
                  {intl.formatMessage({ id: "mate.report.confirmOutput" })}
                </Button>
              </div>
            ) : null}
            {ticket.outputSummary ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.report.output" })}
                </p>
                <p className="whitespace-pre-wrap break-words text-ui-sm text-foreground">
                  {ticket.outputSummary}
                </p>
              </>
            ) : null}
            {ticket.failReason ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.report.failedReason" })}
                </p>
                <p className="whitespace-pre-wrap break-words text-ui-sm text-destructive">
                  {ticket.failReason}
                </p>
              </>
            ) : null}
            {!ticket.outputSummary && !ticket.failReason ? (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "mate.detail.report.none" })}
              </p>
            ) : null}
            {onOpenSession && ticket.sessionId ? (
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => {
                  if (ticket.sessionId) onOpenSession(ticket.sessionId);
                }}
                data-testid="mate-detail-report-open-session"
              >
                {intl.formatMessage({ id: "mate.report.openSession" })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {tab === "evidence" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-evidence">
            {linkedDecision ? (
              <>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.evidence.trigger" })}
                </p>
                <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-surface px-2.5 py-2 text-ui-sm text-foreground">
                  {linkedDecision.triggerText}
                </blockquote>
                {suggestion ? (
                  <>
                    <p className="mt-1 text-ui-sm font-medium text-foreground">
                      {intl.formatMessage({
                        id: mateRouterSuggestionKindMessageId(suggestion.kind),
                      })}
                    </p>
                    {suggestion.reason ? (
                      <p className="break-words text-ui-xs text-foreground-subtle">
                        {intl.formatMessage({ id: "mate.router.reason" })}：{suggestion.reason}
                      </p>
                    ) : null}
                    {suggestion.evidence.map((quote, index) => (
                      <blockquote
                        key={index}
                        className="break-words border-l-2 border-border pl-2 text-ui-xs text-foreground-subtle"
                      >
                        {quote}
                      </blockquote>
                    ))}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-ui-xs text-foreground-subtle" role="status">
                  {intl.formatMessage({ id: "mate.detail.evidence.none" })}
                </p>
                <p className="text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.evidence.brief" })}
                </p>
                <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-surface px-2.5 py-2 text-ui-sm text-foreground">
                  {ticket.brief}
                </blockquote>
              </>
            )}
            {/* P4 第二棒（04 详设 §3 证据页签全量只读）：briefFull verbatim + 工件链接。
                briefFull 缺席（旧 Host）不渲染本节——不伪造「全量」。 */}
            {ticket.briefFull ? (
              <>
                <p className="mt-1 text-ui-xs text-foreground-subtlest">
                  {intl.formatMessage({ id: "mate.detail.evidence.briefFull" })}
                </p>
                <blockquote
                  className="whitespace-pre-wrap break-words rounded-md bg-surface px-2.5 py-2 text-ui-sm text-foreground"
                  data-testid="mate-detail-evidence-brief-full"
                >
                  {ticket.briefFull}
                </blockquote>
              </>
            ) : null}
            <p className="mt-1 text-ui-xs text-foreground-subtlest">
              {intl.formatMessage({ id: "mate.detail.evidence.artifacts" })}
            </p>
            {ticket.writeDomain ? (
              <p
                className="break-words font-mono text-ui-xs text-foreground-subtle"
                data-testid="mate-detail-evidence-artifacts"
              >
                {ticket.writeDomain.kind === "worktree"
                  ? intl.formatMessage(
                      { id: "mate.detail.evidence.artifacts.worktree" },
                      { path: ticket.writeDomain.path, branch: ticket.writeDomain.branch },
                    )
                  : ticket.writeDomain.kind === "paths"
                    ? intl.formatMessage(
                        { id: "mate.detail.evidence.artifacts.paths" },
                        { paths: ticket.writeDomain.paths.join(", ") },
                      )
                    : intl.formatMessage({ id: "mate.detail.evidence.artifacts.none" })}
              </p>
            ) : (
              <p className="text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "mate.detail.evidence.artifacts.none" })}
              </p>
            )}
          </div>
        ) : null}
        {tab === "cost" ? (
          <div className="flex flex-col gap-2" data-testid="mate-detail-cost">
            <p className="font-mono text-ui-sm text-foreground">
              {intl.formatMessage(
                { id: "mate.report.cost" },
                { input: ticket.usage.inputTokens, output: ticket.usage.outputTokens },
              )}
            </p>
            {/* P4 第二棒（04 详设 §3 按代成本）：usageByGeneration 分代行（Σ=合计，服务
                投影不变式）；字段缺席（旧 Host）沿用 P2 说明诚实降级，不伪造逐代数据。 */}
            {usageGenerations ? (
              <ul
                className="flex flex-col gap-1.5"
                data-testid="mate-detail-cost-generations"
              >
                {usageGenerations.map((row) => (
                  <li
                    key={row.generation}
                    className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5"
                  >
                    <span
                      className={cn(
                        "shrink-0 text-ui-xs",
                        row.current
                          ? "font-medium text-foreground"
                          : "text-foreground-subtle",
                      )}
                      data-testid="mate-detail-cost-generation-label"
                    >
                      {intl.formatMessage({ id: "mate.detail.cost.generation" }, { gen: row.generation })}
                    </span>
                    <span className="font-mono text-ui-xs text-foreground-subtle">
                      {intl.formatMessage(
                        { id: "mate.report.cost" },
                        { input: row.inputTokens, output: row.outputTokens },
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtlest">
                      {intl.formatMessage(
                        {
                          id: row.current
                            ? "mate.detail.cost.duration.current"
                            : "mate.detail.cost.duration",
                        },
                        { duration: formatDuration(row.durationMs, intl) },
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-xs text-foreground-subtle" role="note">
                {intl.formatMessage({ id: "mate.detail.cost.perGeneration" })}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {failure !== null ? (
        <p role="alert" className="px-3 pb-2 text-ui-sm text-destructive" data-testid="mate-detail-error">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});

/**
 * 分代时长展示（04 详设 §3「每代 inputTokens/输出/时长」）：秒级 <60s、分钟级 <1h、
 * 其余小时（粗粒度即可——时长是成本辅助维度，不参与任何判定语义）。
 */
function formatDuration(durationMs: number, intl: ReturnType<typeof useDroraIntl>["intl"]): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return intl.formatMessage({ id: "mate.detail.cost.duration.seconds" }, { count: seconds });
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return intl.formatMessage({ id: "mate.detail.cost.duration.minutes" }, { count: minutes });
  }
  return intl.formatMessage(
    { id: "mate.detail.cost.duration.hours" },
    { count: Math.round(minutes / 60) },
  );
}

/**
 * 代际站时间线（mate scope token，DESIGN.md「Mate ticket timeline colors」）：轨段分两档
 * ——通向当前代站的活跃段=--color-mate-trace，其余空闲段=--color-mate-rule
 * （sub-hairline repeated furniture，弱于 --color-border；P2 审查修复：rule token 四主题
 * 已定义且登记 DESIGN.md 却零消费，按登记语义补齐）；当前代站圆点与描边=
 * --color-mate-trace-strong；站内文案层不编码状态色（状态语义只在头部灯）。
 */
function MateTimelineStations({
  ticket,
  generation,
}: {
  ticket: AssistantTicketView;
  generation: number;
}) {
  const { intl } = useDroraIntl();
  const stations: Array<{ key: string; label: string; detail?: string; current?: boolean }> = [];
  if (ticket.queuedReason) {
    stations.push({
      key: "queued",
      label: intl.formatMessage({ id: "mate.detail.timeline.queued" }),
      detail: ticket.queuedReason,
    });
  }
  if (ticket.channelRef) {
    // P3 Thread 直通绑定（spec §5/§11 落地注记）：展示不透明串接值本身——串接格式是
    // host 侧 sources/channelRef.ts 单出处，UI 不复制第二解析；同通道追加消息直投
    // 本工单会话（Tier1，不过 gate/Router）。
    stations.push({
      key: "channel",
      label: intl.formatMessage({ id: "mate.detail.timeline.channel" }),
      detail: ticket.channelRef,
    });
  }
  if (ticket.dispatchMode) {
    stations.push({
      key: "dispatch",
      label: intl.formatMessage(
        { id: "mate.detail.timeline.dispatch" },
        { mode: ticket.dispatchMode },
      ),
      ...(ticket.sessionId
        ? {
            detail: intl.formatMessage(
              { id: "mate.router.session" },
              { sessionId: ticket.sessionId },
            ),
          }
        : {}),
    });
  }
  stations.push({
    key: "anchor",
    label: intl.formatMessage({ id: "mate.detail.timeline.anchor" }),
    detail: ticket.anchorCommandId
      ? ticket.anchorCommandId
      : intl.formatMessage({ id: "mate.detail.timeline.anchorNone" }),
  });
  // P4 第二棒（04 详设 §3 工件核验站）：awaiting_output 滞留=「产出待核验」站，展示
  // 滞留起始（相对时间口径与工单行一致）；判据解除（done/新 turn）后字段出清即站消失。
  if (ticket.awaitingSinceMs !== null && ticket.awaitingSinceMs !== undefined) {
    stations.push({
      key: "awaiting",
      label: intl.formatMessage({ id: "mate.detail.timeline.awaiting" }),
      detail: intl.formatMessage(
        { id: "mate.detail.timeline.awaiting.since" },
        { since: formatTaskRelativeTime(ticket.awaitingSinceMs, intl) },
      ),
    });
  }
  stations.push({
    key: "current",
    label: intl.formatMessage({ id: "mate.detail.timeline.current" }, { gen: generation }),
    current: true,
  });

  return (
    <ol className="flex flex-col" data-testid="mate-detail-timeline">
      {stations.map((station, index) => {
        const isLast = index === stations.length - 1;
        return (
          <li
            key={station.key}
            className="relative flex gap-3 pb-4"
            data-testid={`mate-timeline-station-${station.key}`}
          >
            {!isLast ? (
              <span
                aria-hidden
                className="absolute left-[5px] top-4 bottom-0 w-px"
                style={{
                  // 轨段两档（DESIGN.md）：通向当前代站=trace 活跃段，其余=rule 空闲段。
                  backgroundColor: stations[index + 1]?.current
                    ? "var(--color-mate-trace)"
                    : "var(--color-mate-rule)",
                }}
              />
            ) : null}
            <span
              aria-hidden
              className="relative mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor: station.current
                  ? "var(--color-mate-trace-strong)"
                  : "var(--color-background)",
                border: `1.5px solid ${station.current ? "var(--color-mate-trace-strong)" : "var(--color-mate-trace)"}`,
              }}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-ui-sm",
                  station.current ? "font-medium text-foreground" : "text-foreground-subtle",
                )}
              >
                {station.label}
              </p>
              {station.detail ? (
                <p className="mt-0.5 break-words font-mono text-ui-xs text-foreground-subtlest">
                  {station.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
