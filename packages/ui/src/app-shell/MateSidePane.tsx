import { memo, useCallback, useMemo } from "react";
import { AnchorIcon, LoaderCircleIcon } from "lucide-react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { MateSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useAssistantTickets } from "@/hooks/useAssistantTickets.js";
import { useMateStore } from "@/store/mateStore.js";
import {
  MateAutoNoticeRow,
  MateConfigSection,
  MateDecisionCard,
  MateDigestCard,
  MateObserveRow,
  MatePaneHeader,
  MateReportCard,
  MateStatusStrip,
  MateTicketDetail,
  MateTicketRow,
  MateTrustBar,
  MateWorkspaceGroup,
  deriveMateStatusLine,
  deriveMateViewModel,
  isMateActiveTicket,
  isMateAutoNoticeDecision,
  isMateAwaitingVerification,
  isMateObserveDecision,
  isMatePendingDecision,
  isMateQueuedTicket,
  resolveMateBudgetActive,
  resolveMateQuotaLine,
} from "@/mate/index.js";
import { EMPTY_MATE_WORKSPACE_STATE } from "@/store/mateStore.js";

/**
 * 「大副」tab 的内容根（tab.type === "mate"，workspace 级全局 tab，01 §5 MateSidePane）。
 *
 * 数据只有一条：IAssistantTicketService 的快照推送（useAssistantTickets 判空降级；
 * 契约边界见 packages/ui/src/mate/CONTRACT.md）。tab 不携带 Mate 数据——面板每次挂载
 * getSnapshot 拉一次 + onDidChange 跟随，冷恢复/断线 resync 后自动收敛（同 team 的
 * 「tab 不带数据」纪律）；服务缺席（远程 workspace / 旧 Host）渲染诚实不可用态，不
 * 自动关 tab（无 GC 的东西）。
 *
 * 组成：MateStatusStrip（大副会话状态条：mode/活动/排队/待决策，02 §1.4）→
 * MatePaneHeader（过滤 pills+软预算）→ MateTrustBar → 滚动区（决策卡｜workspace
 * 分组的工单行/汇报卡｜观察行）→ MateConfigSection（模式/名单/W1 worktree 开关/双测试触发按钮）。
 * Surface C：工单行/汇报卡选中后整面板切 MateTicketDetail 二级视图（返回按钮回列表，
 * 选中态=mateStore.selectedTicketId 分域复用）。
 * 过滤/选中/展开三件局部态在 mateStore（zustand），快照本体不进 store。
 */

const MateUnavailableState = memo(function MateUnavailableState({
  loading,
  error,
}: {
  loading: boolean;
  error: string | null;
}) {
  const { intl } = useDroraIntl();
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 text-center"
      data-testid="mate-pane-unavailable"
      aria-busy={loading}
    >
      {loading ? (
        <LoaderCircleIcon aria-hidden className="size-8 animate-spin text-foreground-subtlest" />
      ) : (
        <AnchorIcon aria-hidden className="size-8 text-foreground-subtlest" />
      )}
      {error !== null ? (
        <p role="alert" className="mt-3 text-ui-sm text-destructive" data-testid="mate-pane-error">
          {intl.formatMessage({ id: "mate.error.read" })}
        </p>
      ) : null}
      {!loading ? (
        <>
          <p className="mt-3 text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "mate.unavailable.title" })}
          </p>
          <p className="mt-1 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "mate.unavailable.body" })}
          </p>
        </>
      ) : null}
    </div>
  );
});

export const MateSidePane = memo(function MateSidePane({
  tab,
  onOpenMateSession,
}: {
  tab: MateSidePaneTab;
  /** 预留（PR-1B 审查发现 6 注记）：P1 无焦点态行为——与 AnimatedSidePanePanel 的统一
   * focused 下发对齐（TeamSidePane 同位）；P2 Surface C 下钻二级视图（时间线/汇报）启用。 */
  focused?: boolean;
  /** 「打开会话」跳转通道：挂载点（WorkspaceShellLayout）经 handleSelectTaskInChat 同位落点；
   * 缺席（手机远控）时汇报卡不渲染跳转按钮。P1 派发目标恒为本 pane 的 workspace。 */
  onOpenMateSession?: (request: {
    sessionId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }) => void;
}) {
  const { intl } = useDroraIntl();
  const { snapshot, service, loading, error } = useAssistantTickets();
  // 三件局部态按 workspace 分域（键=tab.workspaceKey；mate tab 每 workspace 一个且
  // side pane 对全部 tab 常挂载，单例会跨区串扰——PR-1B 二审发现 6）。
  const workspaceKey = tab.workspaceKey;
  const workspaceState = useMateStore(
    (state) => state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE,
  );
  const setFilter = useMateStore((state) => state.setFilter);
  const selectTicket = useMateStore((state) => state.selectTicket);
  const expandDecision = useMateStore((state) => state.expandDecision);
  const { filter, selectedTicketId, expandedDecisionId } = workspaceState;

  const viewModel = useMemo(
    () => (snapshot === null ? null : deriveMateViewModel(snapshot, filter)),
    [snapshot, filter],
  );
  const pendingDecisions = useMemo(
    () => snapshot?.decisions.filter(isMatePendingDecision) ?? [],
    [snapshot],
  );
  const observeDecisions = useMemo(
    () => snapshot?.decisions.filter(isMateObserveDecision) ?? [],
    [snapshot],
  );
  // F4（spec §6 auto「执行（出告知卡）」的 UI 兑现）：auto_notice 告知卡此前只在工单行
  // 体现，决策卡区无呈现面。只读行卡，随决策档（decision/all）展示。
  const autoNoticeDecisions = useMemo(
    () => snapshot?.decisions.filter(isMateAutoNoticeDecision) ?? [],
    [snapshot],
  );
  const showDecisions = filter === "decision" || filter === "all";
  const showObserves = filter === "observe" || filter === "all";

  // 软预算按「最重 workspace 的活动工单数」显示（P1 软预算 per-workspace=1，01 §1.1）；
  // 投影收敛在 view-model 纯函数（resolveMateBudgetActive），组件不内联统计。
  const budgetActive = useMemo(
    () => (snapshot === null ? 0 : resolveMateBudgetActive(snapshot)),
    [snapshot],
  );
  // 大副会话状态条（02 详设 §1.4）：mode/活动/排队/待决策单行投影（同源同口径函数）；
  // P4 第二棒补配额行（resolveMateQuotaLine，snapshot.quota 缺席=不渲染）。
  const statusLine = useMemo(
    () => (snapshot === null ? null : deriveMateStatusLine(snapshot)),
    [snapshot],
  );
  const quotaLine = useMemo(
    () => (snapshot === null ? null : resolveMateQuotaLine(snapshot)),
    [snapshot],
  );
  // Surface C 下钻：selectedTicketId 非空且工单仍在快照时渲染详情二级视图（工单被
  // 快照容量裁剪/终态清理后回落列表——诚实降级，不渲染空壳）。
  const selectedTicket = useMemo(
    () =>
      snapshot?.tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [snapshot, selectedTicketId],
  );

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      onOpenMateSession?.({
        sessionId,
        workspacePath: tab.workspacePath,
        ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
        ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      });
    },
    [onOpenMateSession, tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  if (service === null || snapshot === null || viewModel === null || statusLine === null) {
    return <MateUnavailableState loading={loading && service !== null} error={error} />;
  }

  // Surface C 二级视图：选中工单存在即整面板切换为详情（返回=清 selectedTicketId 回
  // 列表；状态条保留在顶——它是会话级摘要，不随下钻消失）。
  if (selectedTicket !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="mate-side-pane">
        <MateStatusStrip status={statusLine} quota={quotaLine} />
        <MateTicketDetail
          snap={snapshot}
          ticket={selectedTicket}
          service={service}
          workspaceKey={workspaceKey}
          onBack={() => selectTicket(workspaceKey, null)}
          {...(onOpenMateSession ? { onOpenSession: handleOpenSession } : {})}
        />
      </div>
    );
  }

  const isEmpty =
    (!showDecisions || (pendingDecisions.length === 0 && autoNoticeDecisions.length === 0)) &&
    (!showObserves || observeDecisions.length === 0) &&
    viewModel.groups.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mate-side-pane">
      <MateStatusStrip status={statusLine} quota={quotaLine} />
      <MatePaneHeader
        filter={filter}
        counts={viewModel.counts}
        budgetActive={budgetActive}
        budgetMax={snapshot.budget.maxActivePerWorkspace}
        onFilterChange={(next) => setFilter(workspaceKey, next)}
      />
      <MateTrustBar
        trust={viewModel.trust}
        mode={snapshot.mode}
        service={service}
        workspaceKey={workspaceKey}
        allowlist={snapshot.allowlist}
        budgetMax={snapshot.budget.maxActivePerWorkspace}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isEmpty ? (
          <div
            className="flex h-full flex-col items-center justify-center px-6 text-center"
            data-testid="mate-pane-empty"
          >
            <AnchorIcon aria-hidden className="size-8 text-foreground-subtlest" />
            <p className="mt-3 text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "mate.empty.title" })}
            </p>
            <p className="mt-1 text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "mate.empty.body" })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* P4 第二棒（04 详设 §4）：配额中心摘要卡（watchdog 通知+未投递摘要分节；
                两节皆空整卡不渲染——组件内判定，容器不复制该口径）。 */}
            <MateDigestCard snapshot={snapshot} service={service} workspaceKey={workspaceKey} />
            {showDecisions && pendingDecisions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {pendingDecisions.map((decision) => (
                  <MateDecisionCard
                    key={decision.id}
                    decision={decision}
                    service={service}
                    workspaceKey={workspaceKey}
                    expanded={expandedDecisionId === decision.id}
                    onToggleExpanded={(id) => expandDecision(workspaceKey, id)}
                  />
                ))}
              </div>
            ) : null}
            {/* F4：auto 告知卡区（spec §6「执行（出告知卡）」）。只读行卡随决策档展示；
                工单号按 ticket.decisionId 反查，全量快照透传（裁剪降级在行卡内判定）。 */}
            {showDecisions && autoNoticeDecisions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {autoNoticeDecisions.map((decision) => (
                  <MateAutoNoticeRow key={decision.id} decision={decision} snapshot={snapshot} />
                ))}
              </div>
            ) : null}
            {viewModel.groups.map((group) => (
              <MateWorkspaceGroup key={group.key} group={group}>
                {group.tickets.map((ticket) =>
                  // queued 是工单行形态（排队灯档+queuedReason 进详情），不进汇报卡——
                  // P2 软预算排队（specs §9）是活动前的等待态，汇报语义只属于终态。
                  // P4 第二棒：awaiting_output 进汇报卡（核验滞留面=汇报语义的滞留态，
                  // 04 详设 §3），dispatched/running/queued 仍为工单行。
                  isMateAwaitingVerification(ticket.status) ? (
                    <MateReportCard
                      key={ticket.id}
                      ticket={ticket}
                      service={service}
                      workspaceKey={workspaceKey}
                      onOpenDetail={(ticketId) => selectTicket(workspaceKey, ticketId)}
                      {...(onOpenMateSession ? { onOpenSession: handleOpenSession } : {})}
                    />
                  ) : isMateActiveTicket(ticket.status) || isMateQueuedTicket(ticket.status) ? (
                    <MateTicketRow
                      key={ticket.id}
                      ticket={ticket}
                      selected={selectedTicketId === ticket.id}
                      onSelect={(ticketId) => selectTicket(workspaceKey, ticketId)}
                    />
                  ) : (
                    <MateReportCard
                      key={ticket.id}
                      ticket={ticket}
                      service={service}
                      workspaceKey={workspaceKey}
                      onOpenDetail={(ticketId) => selectTicket(workspaceKey, ticketId)}
                      {...(onOpenMateSession ? { onOpenSession: handleOpenSession } : {})}
                    />
                  ),
                )}
              </MateWorkspaceGroup>
            ))}
            {showObserves && observeDecisions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {observeDecisions.map((decision) => (
                  <MateObserveRow key={decision.id} decision={decision} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {/* F1：触发目标=workspaceKey（AGENTS 身份键），MateConfigSection 不再区分
          workspaceIdentity 形态——本地 tab 的 workspaceIdentity 恒 undefined，
          旧的条件透传正是放行链断点。 */}
      <MateConfigSection
        service={service}
        workspaceKey={workspaceKey}
        mode={snapshot.mode}
        allowlist={snapshot.allowlist}
        worktreeDisabled={snapshot.worktreeDisabled}
        dailyQuota={snapshot.quota?.quota}
      />
    </div>
  );
});
