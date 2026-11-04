import { memo, useCallback, useMemo } from "react";
import { AnchorIcon, LoaderCircleIcon } from "lucide-react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { MateSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useAssistantTickets } from "@/hooks/useAssistantTickets.js";
import { useMateStore } from "@/store/mateStore.js";
import {
  MateConfigSection,
  MateDecisionCard,
  MateObserveRow,
  MatePaneHeader,
  MateReportCard,
  MateTicketRow,
  MateTrustBar,
  MateWorkspaceGroup,
  deriveMateViewModel,
  isMateActiveTicket,
  isMateObserveDecision,
  isMatePendingDecision,
  resolveMateBudgetActive,
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
 * 组成：MatePaneHeader（过滤 pills+软预算）→ MateTrustBar → 滚动区（决策卡｜workspace
 * 分组的工单行/汇报卡｜观察行）→ MateConfigSection（模式/名单/双测试触发按钮）。
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
  const showDecisions = filter === "decision" || filter === "all";
  const showObserves = filter === "observe" || filter === "all";

  // 软预算按「最重 workspace 的活动工单数」显示（P1 软预算 per-workspace=1，01 §1.1）；
  // 投影收敛在 view-model 纯函数（resolveMateBudgetActive），组件不内联统计。
  const budgetActive = useMemo(
    () => (snapshot === null ? 0 : resolveMateBudgetActive(snapshot)),
    [snapshot],
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

  if (service === null || snapshot === null || viewModel === null) {
    return <MateUnavailableState loading={loading && service !== null} error={error} />;
  }

  const isEmpty =
    (!showDecisions || pendingDecisions.length === 0) &&
    (!showObserves || observeDecisions.length === 0) &&
    viewModel.groups.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mate-side-pane">
      <MatePaneHeader
        filter={filter}
        counts={viewModel.counts}
        budgetActive={budgetActive}
        budgetMax={snapshot.budget.maxActivePerWorkspace}
        onFilterChange={(next) => setFilter(workspaceKey, next)}
      />
      <MateTrustBar trust={viewModel.trust} />
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
            {viewModel.groups.map((group) => (
              <MateWorkspaceGroup key={group.key} group={group}>
                {group.tickets.map((ticket) =>
                  isMateActiveTicket(ticket.status) ? (
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
      <MateConfigSection
        service={service}
        workspaceKey={workspaceKey}
        mode={snapshot.mode}
        allowlist={snapshot.allowlist}
        {...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {})}
      />
    </div>
  );
});
