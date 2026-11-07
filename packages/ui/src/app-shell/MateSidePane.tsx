import { memo, useCallback, useMemo } from "react";
import { cn } from "@/components/lib/utils.js";
import { AnchorIcon, LoaderCircleIcon } from "lucide-react";
import { ASSISTANT_MODES, ASSISTANT_STRENGTHS } from "@drora/shared";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { MateSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useAssistantTickets } from "@/hooks/useAssistantTickets.js";
import { useMateStore } from "@/store/mateStore.js";
import type { MateWorkManageTarget } from "@/mate/MateWorkOverview.js";
import {
  MateAutoNoticeRow,
  MateConfigSection,
  MateDecisionCard,
  MateDigestCard,
  MateObserveRow,
  MatePaneHeader,
  MateReportCard,
  MateStatusStrip,
  MateThreadSection,
  MateTicketDetail,
  MateTicketRow,
  MateTrustBar,
  MateWorkOverview,
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
 * MateThreadSection（对话管理台，P10a-2/10 号详设 §2.1：四类消息投影+composer 同链触发
 * +readMateThread 分页；status_replied 答复气泡唯一呈现面）→ MateWorkOverview（全域工作
 * 总览卡，P8b/09 §1.7：三态区分，旧 Host 缺席=卡不渲染）→ MatePaneHeader（过滤
 * pills+软预算）→ MateTrustBar → 滚动区（决策卡｜workspace 分组的工单行/汇报卡｜观察行）
 * → MateConfigSection（模式/名单/W1 worktree 开关/双测试触发按钮）。
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
  const toggleWorkWorkspace = useMateStore((state) => state.toggleWorkWorkspace);
  const setSecondaryView = useMateStore((state) => state.setSecondaryView);
  const { filter, selectedTicketId, expandedDecisionId, expandedWorkKeys, secondaryView } =
    workspaceState;

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

  // P8b（09 详设 §1.7）：总览卡会话行 → onOpenMateSession 既有导航（不发明新导航面）。
  // 组键=AGENTS 身份键：本 pane 自己的组带完整 tab 坐标（identity/remoteSessionId 同
  // handleOpenSession）；跨组只有组键——本地项目组键即路径（直接激活/补开 tab，与
  // automations 运行历史同一条跨项目本地导航路径），远程 identity 键的落位路径不在此
  // pane 的契约内，按组键作路径传（沿用既有导航面的诚实兜底，不加第二路由）。
  const handleOpenWorkSession = useCallback(
    (sessionId: string, groupKey: string) => {
      if (!onOpenMateSession) return;
      const ownKey = tab.workspaceIdentity?.trim() || tab.workspacePath;
      if (groupKey === ownKey) {
        onOpenMateSession({
          sessionId,
          workspacePath: tab.workspacePath,
          ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
          ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
        });
        return;
      }
      onOpenMateSession({ sessionId, workspacePath: groupKey });
    },
    [onOpenMateSession, tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  // P10b（10 号详设 §3.3）：台账行管理入口的触发动作（store 订阅在此，处理器在服务
  // 判空守卫之后定义——见 handleManageTarget）。管理意图文本含对象 id（Router 可见集
  // 匹配 targetRef 的依据），与 composer//mate 拦截完全同链；不建第二条执行路径。
  const recordTrigger = useMateStore((state) => state.recordTrigger);

  if (service === null || snapshot === null || viewModel === null || statusLine === null) {
    return <MateUnavailableState loading={loading && service !== null} error={error} />;
  }

  // P10b（10 号详设 §3.3）：管理意图 trigger（explicit+target=对象所属 workspace 键
  // +manageIntent 标记）。manageIntent 使 auto 模式下也不走 explicit 直派（服务侧
  // 降级 decision_card，管理动作永不 auto 放行——§0 红线；安全审查修复：此前 auto×
  // explicit+target 会同事务建票把管理意图原文派给 worker），后续仍走决策卡 manage
  // 臂+人工 Y（同一准入门）。off 模式入口禁用（off=零执行）。
  const manageDisabled = snapshot.mode === ASSISTANT_MODES.off;
  const handleManageTarget = (target: MateWorkManageTarget): void => {
    const text =
      target.kind === "session"
        ? `请把会话 ${target.ref}「${target.title}」的当前回合停掉`
        : `请取消闲时任务 ${target.ref}「${target.title}」`;
    void recordTrigger(service, workspaceKey, {
      text,
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: target.workspaceKey,
      manageIntent: true,
    });
  };

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
    (!showDecisions ||
      (pendingDecisions.length === 0 && autoNoticeDecisions.length === 0)) &&
    (!showObserves || observeDecisions.length === 0) &&
    viewModel.groups.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mate-side-pane">
      <MateStatusStrip status={statusLine} quota={quotaLine} />
      {/* 布局重构（2026-11-07，同日 UX 修复二轮）：页签真互斥——对话也是页签（默认
          激活，占满剩余空间=真正可用的主视图；首版「对话常驻顶部+次级页签对半分」把
          设置挤到下半可视区外，工单开关 locator 不可见——真机与资产同证）。页签条钉
          顶，选中谁谁占满，各自内部滚动。 */}
      {/* 页签条（固定一行）：对话（默认）｜收件箱（待决策/告知/工单/汇报/观察）｜台账
          （全域工作+信任）｜设置。badge=待决策数（有未决时提醒，无需切回去看）。 */}
      <div
        className="flex shrink-0 items-center gap-1 border-y border-border/50 px-2 py-1"
        data-testid="mate-secondary-tabs"
      >
        {(
          [
            { view: "conversation", labelId: "mate.tab.conversation", badge: 0 },
            { view: "inbox", labelId: "mate.tab.inbox", badge: pendingDecisions.length },
            { view: "inventory", labelId: "mate.tab.inventory", badge: 0 },
            { view: "settings", labelId: "mate.tab.settings", badge: 0 },
          ] as const
        ).map((item) => {
          const active = secondaryView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setSecondaryView(workspaceKey, item.view)}
              aria-pressed={active}
              data-testid={"mate-secondary-tab-" + item.view}
              className={cn(
                "rounded-md px-2 py-0.5 text-ui-xs transition-colors",
                active
                  ? "bg-selected font-medium text-foreground"
                  : "text-foreground-subtle hover:bg-hover hover:text-foreground",
              )}
            >
              {intl.formatMessage({ id: item.labelId })}
              {item.badge > 0 ? (
                <span
                  className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-destructive-foreground"
                  data-testid={"mate-secondary-tab-" + item.view + "-badge"}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* 次级视图容器：互斥渲染，各自 min-h-0 flex-1 + 内部滚动（不再多根滚动条）。 */}
      {secondaryView === "conversation" ? (
        <MateThreadSection
          snapshot={snapshot}
          service={service}
          workspaceKey={workspaceKey}
          expandedDecisionId={expandedDecisionId}
          onToggleExpanded={(id) => expandDecision(workspaceKey, id)}
          onSelectTicket={(ticketId) => selectTicket(workspaceKey, ticketId)}
          className="min-h-0 flex-1"
        />
      ) : null}
      {secondaryView === "inbox" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="mate-inbox-list">
          {/* 过滤头常驻（2026-11-07 UX 修复）：空态也保留切档入口——只有观察行而
              默认档=待决策时，空态若连过滤头一起隐藏，用户将无法切到「观察中」（四资
              产实跑同证）。空态只替换内容区，不吞头。 */}
          <div className="flex flex-col gap-4">
            <MatePaneHeader
              filter={filter}
              counts={viewModel.counts}
              budgetActive={budgetActive}
              budgetMax={snapshot.budget.maxActivePerWorkspace}
              onFilterChange={(next) => setFilter(workspaceKey, next)}
            />
          </div>
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
            <div className="mt-4 flex flex-col gap-4">
              {/* P4 第二棒（04 详设 §4）：配额中心摘要卡（两节皆空整卡不渲染）。 */}
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
                    <MateObserveRow
                      key={decision.id}
                      decision={decision}
                      service={service}
                      workspaceKey={workspaceKey}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {secondaryView === "inventory" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="mate-inventory-view">
          <MateTrustBar
            trust={viewModel.trust}
            mode={snapshot.mode}
            service={service}
            workspaceKey={workspaceKey}
            allowlist={snapshot.allowlist}
            budgetMax={snapshot.budget.maxActivePerWorkspace}
          />
          {/* P8b（09 详设 §1.7）：全域工作总览卡——台账页签主体。 */}
          <MateWorkOverview
            inventory={snapshot.inventory}
            inventoryReady={snapshot.inventoryReady === true}
            expandedKeys={expandedWorkKeys}
            onToggleWorkspace={(groupKey) => toggleWorkWorkspace(workspaceKey, groupKey)}
            onSelectTicket={(ticketId) => selectTicket(workspaceKey, ticketId)}
            {...(onOpenMateSession ? { onOpenSession: handleOpenWorkSession } : {})}
            onManageTarget={handleManageTarget}
            manageDisabled={manageDisabled}
          />
        </div>
      ) : null}
      {secondaryView === "settings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="mate-settings-view">
          {/* F1：触发目标=workspaceKey（AGENTS 身份键），MateConfigSection 不再区分
              workspaceIdentity 形态。旧版 shrink-0 常驻巨块退役——设置进页签，
              视口还给对话与卡区。 */}
          <MateConfigSection
            service={service}
            workspaceKey={workspaceKey}
            mode={snapshot.mode}
            allowlist={snapshot.allowlist}
            worktreeDisabled={snapshot.worktreeDisabled}
            dailyQuota={snapshot.quota?.quota}
            budgetMaxActivePerWorkspace={snapshot.budget?.maxActivePerWorkspace}
            modelPreference={snapshot.modelPreference ?? null}
            trustGateThresholds={snapshot.trustGateThresholds}
            watchdogIntervalMinutes={snapshot.watchdogIntervalMinutes}
            rhythm={snapshot.rhythm}
            sourcesConfig={snapshot.sourcesConfig}
            identityMap={snapshot.identityMap}
          />
        </div>
      ) : null}
    </div>
  );
});
