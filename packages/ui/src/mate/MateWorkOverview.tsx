import { memo } from "react";
import { ChevronRightIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import type {
  MateWorkInventoryRow,
  MateWorkInventoryView,
  MateWorkInventoryWorkspace,
} from "@drora/shared";
import { MATE_WORK_INVENTORY_ROW_KINDS } from "@drora/shared";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { cn } from "@/components/lib/utils.js";

import { MateLamp } from "./MateLamp.js";
import { mateTicketLampTone } from "./statusTone.js";

/** P10b 台账行管理入口的目标描述（10 号详设 §3.3——入口多样、准入门唯一：产 trigger）。 */
export interface MateWorkManageTarget {
  readonly kind: "session" | "offpeak_task";
  readonly ref: string;
  readonly title: string;
  /** 行所属台账分组键（AGENTS 身份键——管理触发的 target workspace）。 */
  readonly workspaceKey: string;
}

/**
 * 全域工作总览卡（P8b，09 详设 §1.7；面板顶部状态条下）。
 *
 * 数据=snapshot.inventory（host 三源投影，只读；本组件不建第二读路径）+ 快照
 * inventoryReady 就绪信号，**三态区分**（缺席不是空态，不猜）：
 * - inventoryReady 缺席（旧 Host/旧装配，无台账能力）→ 卡不渲染（null）；
 * - inventoryReady 且 inventory 缺席 → 「投影就绪中」（冷启动首拉未 ready/某源缺席
 *   ——workInventoryBootstrap provider null 的合法语义，与无工作区分）；
 * - inventory.workspaces 空 → 「无工作」空态（真实空集，诚实表达）；
 * - 有行 → 每项目一行（kind 徽标计数/最近活动相对时刻/停滞警示点/managed 标记）+
 *   点击展开行列表（工单行=状态灯+标题+相对时刻，点击 selectTicket 下钻详情；
 *   会话行=标题+phase+managed 徽标，点击 onOpenMateSession 既有导航；闲时行=禁用+
 *   提示——本 pane 无任务中心导航面，不发明新导航）。
 *
 * managed 标记语义（09 §1.4）：sessionId ∈ 活动工单 incarnation.sessionId 集——该
 * 会话是大副工单的当代执行体（host 侧已算好，UI 只呈现不判定）。DESIGN.md token
 * 体系（text-ui-* 系列、border-input、bg-surface），照配置区现有形态，不为状态发明新色。
 *
 * P10b（10 号详设 §3.3）：会话行/闲时行管理入口「经大副停掉/取消」——点击只产管理
 * 意图 trigger（文本含对象 id），与对话面/Source 文本走**同一准入门**（recordTrigger →
 * 决策卡 → manage 臂 → 人工 Y），不建第二条执行路径；闲时行导航主体保持禁用（无任务
 * 中心导航面），管理入口可发起。off 模式入口禁用（零执行）。
 */
export const MateWorkOverview = memo(function MateWorkOverview({
  inventory,
  inventoryReady,
  expandedKeys,
  onToggleWorkspace,
  onSelectTicket,
  onOpenSession,
  onManageTarget,
  manageDisabled,
}: {
  /** 全域台账视图（snapshot.inventory；缺席+未就绪=旧 Host）。 */
  inventory?: MateWorkInventoryView;
  /** 台账能力就绪信号（snapshot.inventoryReady === true；缺席=旧 Host → 卡不渲染）。 */
  inventoryReady?: boolean;
  /** 展开 workspace 组键集（mateStore 分域局部态）。 */
  expandedKeys: readonly string[];
  onToggleWorkspace: (groupKey: string) => void;
  /** 工单行点击 → selectTicket（Surface C 详情下钻，复用既有选中域）。 */
  onSelectTicket: (ticketId: string) => void;
  /**
   * 会话行点击 → onOpenMateSession 既有导航（挂载点注入；缺席=导航不可达，
   * 会话行降级为禁用——诚实降级，不发明新导航面）。
   */
  onOpenSession?: (sessionId: string, groupKey: string) => void;
  /**
   * P10b（10 号详设 §3.3）：台账行管理入口——会话行/闲时行「经大副停掉/取消」。只产
   * 管理意图 trigger（文本含对象），走同一准入门（recordTrigger→决策卡→manage 臂→
   * 人工 Y），**不建第二条执行路径**。缺席=管理入口不渲染（诚实降级）。
   */
  onManageTarget?: (target: MateWorkManageTarget) => void;
  /** off 模式：管理入口禁用（off=零执行，含触发零放行）。 */
  manageDisabled?: boolean;
}) {
  const { intl } = useDroraIntl();
  // 三态 1：旧 Host（无台账能力）——卡不渲染。
  if (!inventoryReady) return null;
  return (
    <section
      className="flex flex-col gap-1.5 border-b border-border/50 px-3 py-2"
      data-testid="mate-work-overview"
    >
      <header className="flex items-center justify-between gap-2 px-0.5">
        <span className="text-ui-xs font-medium text-foreground-subtle" data-testid="mate-work-overview-title">
          {intl.formatMessage({ id: "mate.work.title" })}
        </span>
      </header>
      {/* 三态 2：投影就绪中（冷启动/某源缺席——与「无工作」区分，09 §1.3 步 4）。 */}
      {!inventory ? (
        <div
          className="flex items-center gap-2 px-0.5 py-1 text-ui-xs text-foreground-subtlest"
          data-testid="mate-work-overview-pending"
        >
          <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
          {intl.formatMessage({ id: "mate.work.pending" })}
        </div>
      ) : inventory.workspaces.length === 0 ? (
        // 三态 3：无工作（真实空集）。
        <p className="px-0.5 py-1 text-ui-xs text-foreground-subtlest" data-testid="mate-work-overview-empty">
          {intl.formatMessage({ id: "mate.work.empty" })}
        </p>
      ) : (
        inventory.workspaces.map((workspace) => (
          <MateWorkWorkspaceRow
            key={workspace.key}
            workspace={workspace}
            expanded={expandedKeys.includes(workspace.key)}
            onToggle={() => onToggleWorkspace(workspace.key)}
            onSelectTicket={onSelectTicket}
            onOpenSession={onOpenSession}
            {...(onManageTarget ? { onManageTarget } : {})}
            {...(manageDisabled !== undefined ? { manageDisabled } : {})}
          />
        ))
      )}
    </section>
  );
});

/** 项目组折叠行（kind 徽标计数/最近活动/停滞警示点/managed 标记）+ 展开行列表。 */
const MateWorkWorkspaceRow = memo(function MateWorkWorkspaceRow({
  workspace,
  expanded,
  onToggle,
  onSelectTicket,
  onOpenSession,
  onManageTarget,
  manageDisabled,
}: {
  workspace: MateWorkInventoryWorkspace;
  expanded: boolean;
  onToggle: () => void;
  onSelectTicket: (ticketId: string) => void;
  onOpenSession?: (sessionId: string, groupKey: string) => void;
  onManageTarget?: (target: MateWorkManageTarget) => void;
  manageDisabled?: boolean;
}) {
  const { intl } = useDroraIntl();
  const summary = deriveWorkspaceRowSummary(workspace);
  const latest = summary.latestMs > 0 ? formatTaskRelativeTime(summary.latestMs, intl) : null;
  return (
    <div className="flex flex-col gap-1" data-testid="mate-work-overview-group">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="mate-work-overview-group-toggle"
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-hover"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 shrink-0 text-foreground-subtlest transition-transform", expanded && "rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-foreground-subtle">
          {workspace.key}
        </span>
        {/* 停滞警示点（任一工单行 staleSinceMs 有值；颜色伴随可读计数满足 never-by-color-alone）。 */}
        {summary.staleCount > 0 ? (
          <span
            className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
            title={intl.formatMessage({ id: "mate.work.stale.hint" }, { count: summary.staleCount })}
            data-testid="mate-work-overview-stall"
          >
            {intl.formatMessage({ id: "mate.work.stale" }, { count: summary.staleCount })}
          </span>
        ) : null}
        {/* managed 标记（组内存在大副当代执行体会话；title 全称，行内短标）。 */}
        {summary.managedCount > 0 ? (
          <span
            className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
            title={intl.formatMessage({ id: "mate.work.managed.hint" })}
            data-testid="mate-work-overview-managed"
          >
            {intl.formatMessage({ id: "mate.work.managed" }, { count: summary.managedCount })}
          </span>
        ) : null}
        {latest ? (
          <span className="shrink-0 text-ui-xs text-foreground-subtlest" data-testid="mate-work-overview-last-activity">
            {latest}
          </span>
        ) : null}
      </button>
      <div className="flex flex-wrap items-center gap-1 pl-5" data-testid="mate-work-overview-kind-badges">
        {summary.ticketCount > 0 ? (
          <KindBadge label={intl.formatMessage({ id: "mate.work.kind.ticket" }, { count: summary.ticketCount })} kind="ticket" />
        ) : null}
        {summary.sessionCount > 0 ? (
          <KindBadge
            label={
              summary.teamsCount > 0
                ? intl.formatMessage(
                    { id: "mate.work.kind.session.teams" },
                    { count: summary.sessionCount, teams: summary.teamsCount },
                  )
                : intl.formatMessage({ id: "mate.work.kind.session" }, { count: summary.sessionCount })
            }
            kind="session"
          />
        ) : null}
        {summary.offpeakCount > 0 ? (
          <KindBadge label={intl.formatMessage({ id: "mate.work.kind.offpeak" }, { count: summary.offpeakCount })} kind="offpeak" />
        ) : null}
      </div>
      {expanded ? (
        <div className="flex flex-col gap-1 pl-5" data-testid="mate-work-overview-rows">
          {workspace.rows.map((row) =>
            row.kind === MATE_WORK_INVENTORY_ROW_KINDS.ticket ? (
              <MateWorkTicketLine key={`ticket:${row.ticketId}`} row={row} onSelectTicket={onSelectTicket} />
            ) : row.kind === MATE_WORK_INVENTORY_ROW_KINDS.session ? (
              <MateWorkSessionLine
                key={`session:${row.sessionId}`}
                row={row}
                groupKey={workspace.key}
                onOpenSession={onOpenSession}
                {...(onManageTarget ? { onManageTarget } : {})}
                {...(manageDisabled !== undefined ? { manageDisabled } : {})}
              />
            ) : (
              <MateWorkOffpeakLine
                key={`offpeak:${row.taskId}`}
                row={row}
                groupKey={workspace.key}
                {...(onManageTarget ? { onManageTarget } : {})}
                {...(manageDisabled !== undefined ? { manageDisabled } : {})}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
});

/**
 * P10b 管理入口按钮（10 号详设 §3.3）：会话行=「经大副停掉」/闲时行=「经大副取消」
 * ——点击只产管理意图 trigger（含对象 id 的文本），经同一准入门进 manage 决策卡；
 * 执行仍须人工 Y（本入口零执行）。off 模式禁用（零执行）；onManageTarget 缺席不渲染。
 */
const MateWorkManageButton = memo(function MateWorkManageButton({
  kind,
  target,
  onManageTarget,
  disabled,
}: {
  kind: "session" | "offpeak_task";
  target: MateWorkManageTarget;
  onManageTarget: (target: MateWorkManageTarget) => void;
  disabled: boolean;
}) {
  const { intl } = useDroraIntl();
  const labelId = kind === "session" ? "mate.manage.row.stop" : "mate.manage.row.cancel";
  const hintId = disabled ? "mate.manage.row.offHint" : labelId;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onManageTarget(target);
      }}
      disabled={disabled}
      title={intl.formatMessage({ id: hintId })}
      data-testid={`mate-work-overview-${kind === "session" ? "session" : "offpeak"}-manage`}
      className="shrink-0 rounded-md p-1 text-foreground-subtlest transition-colors hover:bg-surface-hover hover:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={intl.formatMessage({ id: labelId })}
    >
      <SquareIcon aria-hidden className="size-3.5" />
    </button>
  );
});

function KindBadge({ label, kind }: { label: string; kind: "ticket" | "session" | "offpeak" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1.5 py-0.5 text-ui-xs",
        kind === "ticket" ? "bg-tag text-foreground-subtle" : "bg-surface text-foreground-subtle",
      )}
      data-testid={`mate-work-overview-kind-${kind}`}
    >
      {label}
    </span>
  );
}

/** 台账工单行（复用既有工单行形态：状态灯+标题+相对时刻；点击=selectTicket 下钻）。 */
const MateWorkTicketLine = memo(function MateWorkTicketLine({
  row,
  onSelectTicket,
}: {
  row: Extract<MateWorkInventoryRow, { kind: typeof MATE_WORK_INVENTORY_ROW_KINDS.ticket }>;
  onSelectTicket: (ticketId: string) => void;
}) {
  const { intl } = useDroraIntl();
  return (
    <button
      type="button"
      onClick={() => onSelectTicket(row.ticketId)}
      data-testid="mate-work-overview-ticket-row"
      className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
    >
      <MateLamp tone={mateTicketLampTone(row.status)} />
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{row.title}</span>
      {row.staleSinceMs != null ? (
        <span
          className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
          data-testid="mate-work-overview-ticket-stale"
        >
          {intl.formatMessage({ id: "mate.ticket.stale" })}
        </span>
      ) : null}
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {formatTaskRelativeTime(row.updatedAtMs, intl)}
      </span>
    </button>
  );
});

/**
 * 台账会话/teams 行（标题+phase+managed 徽标；点击=onOpenMateSession 既有导航）。
 * P10b（10 号详设 §3.3）：行尾管理入口「经大副停掉」——主行与入口按钮并列（不嵌套
 * button），入口只产管理意图 trigger（同一准入门），行导航语义不变。
 */
const MateWorkSessionLine = memo(function MateWorkSessionLine({
  row,
  groupKey,
  onOpenSession,
  onManageTarget,
  manageDisabled,
}: {
  row: Extract<MateWorkInventoryRow, { kind: typeof MATE_WORK_INVENTORY_ROW_KINDS.session }>;
  groupKey: string;
  onOpenSession?: (sessionId: string, groupKey: string) => void;
  onManageTarget?: (target: MateWorkManageTarget) => void;
  manageDisabled?: boolean;
}) {
  const { intl } = useDroraIntl();
  // 导航门槛与既有汇报卡同形（onOpenSession 注入即可点；已结束会话照常可开——
  // MateReportCard「打开会话」先例，不另设 sessionEnded 门）。
  const navigable = typeof onOpenSession === "function";
  const body = (
    <>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full border border-foreground-subtlest"
      />
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{row.title}</span>
      {row.managed ? (
        <span
          className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
          title={intl.formatMessage({ id: "mate.work.managed.hint" })}
          data-testid="mate-work-overview-session-managed"
        >
          {intl.formatMessage({ id: "mate.work.session.managed" })}
        </span>
      ) : null}
      {row.teamStatus ? (
        <span
          className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
          data-testid="mate-work-overview-session-team"
        >
          {row.teamStatus}
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">{row.phase}</span>
      <span className="shrink-0 text-ui-xs text-foreground-subtlest">
        {formatTaskRelativeTime(row.updatedAtMs, intl)}
      </span>
    </>
  );
  const manageEntry =
    onManageTarget && !row.sessionEnded ? (
      <MateWorkManageButton
        kind="session"
        target={{ kind: "session", ref: row.sessionId, title: row.title, workspaceKey: groupKey }}
        onManageTarget={onManageTarget}
        disabled={manageDisabled === true}
      />
    ) : null;
  if (!navigable) {
    return (
      <div className="flex w-full items-center gap-1">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 opacity-60"
          data-testid="mate-work-overview-session-row"
          aria-disabled="true"
        >
          {body}
        </div>
        {manageEntry}
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-1">
      <button
        type="button"
        onClick={() => onOpenSession?.(row.sessionId, groupKey)}
        data-testid="mate-work-overview-session-row"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        {body}
      </button>
      {manageEntry}
    </div>
  );
});

/**
 * 台账闲时任务行（本 pane 无任务中心导航面——行主体保持禁用+title 提示，不发明新
 * 导航面；09 §1.7 行点击语义里 offpeak 的落点在导航可达时才启用）。P10b（10 号详设
 * §3.3）：禁用态解除为「可发起管理动作」——行尾「经大副取消」入口可点（产管理意图
 * trigger 走同一准入门），导航主体仍禁用。
 */
const MateWorkOffpeakLine = memo(function MateWorkOffpeakLine({
  row,
  groupKey,
  onManageTarget,
  manageDisabled,
}: {
  row: Extract<MateWorkInventoryRow, { kind: typeof MATE_WORK_INVENTORY_ROW_KINDS.offpeak }>;
  groupKey: string;
  onManageTarget?: (target: MateWorkManageTarget) => void;
  manageDisabled?: boolean;
}) {
  const { intl } = useDroraIntl();
  return (
    <div className="flex w-full items-center gap-1">
      <button
        type="button"
        disabled
        title={intl.formatMessage({ id: "mate.work.offpeak.disabled" })}
        data-testid="mate-work-overview-offpeak-row"
        aria-disabled="true"
        className="flex min-w-0 flex-1 cursor-not-allowed items-center gap-2 rounded-lg border border-border/60 bg-surface px-2 py-1.5 text-left opacity-60"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full border border-foreground-subtlest"
        />
        <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{row.title}</span>
        {row.status ? (
          <span className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">{row.status}</span>
        ) : null}
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
          {formatTaskRelativeTime(row.updatedAtMs, intl)}
        </span>
      </button>
      {onManageTarget ? (
        <MateWorkManageButton
          kind="offpeak_task"
          target={{ kind: "offpeak_task", ref: row.taskId, title: row.title, workspaceKey: groupKey }}
          onManageTarget={onManageTarget}
          disabled={manageDisabled === true}
        />
      ) : null}
    </div>
  );
});

/** 项目行折叠摘要（纯投影：kind 计数/teams/停滞/managed/最近活动；组件不内联统计口径）。 */
function deriveWorkspaceRowSummary(workspace: MateWorkInventoryWorkspace): {
  ticketCount: number;
  sessionCount: number;
  teamsCount: number;
  offpeakCount: number;
  staleCount: number;
  managedCount: number;
  latestMs: number;
} {
  let ticketCount = 0;
  let sessionCount = 0;
  let teamsCount = 0;
  let offpeakCount = 0;
  let staleCount = 0;
  let managedCount = 0;
  let latestMs = 0;
  for (const row of workspace.rows) {
    if (row.updatedAtMs > latestMs) latestMs = row.updatedAtMs;
    if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.ticket) {
      ticketCount += 1;
      if (row.staleSinceMs != null) staleCount += 1;
    } else if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.session) {
      sessionCount += 1;
      if (row.teamStatus) teamsCount += 1;
      if (row.managed) managedCount += 1;
    } else {
      offpeakCount += 1;
    }
  }
  return { ticketCount, sessionCount, teamsCount, offpeakCount, staleCount, managedCount, latestMs };
}
