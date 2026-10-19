/* eslint-disable max-lines -- TeamPanel 是 team 的唯一显示面（状态头/动作区/任务板/成员卡/消息尾窗
 * 共享同一投影模型与命令上抛链，拆文件会割裂单一派生通道；与 KnowledgeReviewView 同先例）。 */
import { useState } from "react";
import { MessageSquareTextIcon } from "lucide-react";
import { TEAM_LEAD_ASSIGNEE, type CommandPayloadMap } from "@drora/shared/drora-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamUiStatus, TeamUiFocus } from "./contract.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import { TeamStagedEditor } from "./TeamStagedEditor.js";
import type { TeamPanelMemberView, TeamPanelModel, TeamPanelTaskView } from "./view-model.js";
import { TeamWorkspaceViews } from "./TeamWorkspaceViews.js";
import { TeamStatusBadge } from "./TeamStatusBadge.js";
import { TeamAvatar } from "./TeamAvatar.js";

/**
 * TeamPanel（PR-2.4a 只读视图 + PR-2.4b 动作区；specs/agents-team.md §10、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3-§4）。
 *
 * 展示组件：数据由宿主从 v4 投影派生（mapTeamProjectionToViewModel），动作区按状态机
 * 出显（teamPanelActionVisibility），命令意图经 onCommand 上抛——宿主接 team/commands.ts
 * 发送（approveTeamPlan / reviseTeamPlan / abandonTeamPlan / haltTeam / resumeTeam）。
 * DESIGN.md 纪律：text-ui-* 刻度、语义色 + 文字并行（不以色独行）、成员颜色仅头像点、
 * 无大面积品牌填充、按钮键盘可达。
 *
 * M2.5 i18n：全部文案走 locales `team.panel.*` / `team.board.*` / `team.member.state.*`
 * 词典（原 zh 内联常量 TEAM_PANEL_COPY 已整体迁出；design 01 §4「全部文案走 locales
 * zh-CN/en-US 双语全量（含状态标签/动态摘要/无障碍文案）」）；状态徽标复用
 * TEAM_STATUS_I18N_KEYS（team.status.*，单一出处）。技术值拼接（任务 id/负责人名）保留
 * 组件内模板——DESIGN.md「技术值等宽」，不是可翻译文案。
 */

/**
 * 动作区覆盖的五条用户面命令（八命令中其余三条——sendTeamMessage / stopTeamMember /
 * setTeamMemberName——属成员下钻与成员卡，不在面板动作区）。payload 形状取
 * CommandPayloadMap（shared TEAM_COMMAND_PAYLOAD_SCHEMAS 单一出处，spec §6.4），
 * 本文件不复制任何载荷；宿主按 cmd.type 分发到 team/commands.ts 同名函数。
 */
export type TeamPanelCommandType = Extract<
  keyof CommandPayloadMap,
  "approveTeamPlan" | "reviseTeamPlan" | "abandonTeamPlan" | "haltTeam" | "resumeTeam"
>;

export type TeamPanelCommand = {
  [K in TeamPanelCommandType]: { type: K; payload: CommandPayloadMap[K] };
}[TeamPanelCommandType];

export interface TeamPanelActionVisibility {
  /** staged：渲染 TeamStagedEditor（三动作载体）。 */
  stagedEditor: boolean;
  approve: boolean;
  revise: boolean;
  abandon: boolean;
  /** 停止团队（active 独立入口；escalated 在升级卡内）。 */
  halt: boolean;
  /** 显式恢复（halted 独立区；escalated 在升级卡内），理由必填。 */
  resume: boolean;
  /** escalated 升级卡（内含 resume + halt 两个出口）。 */
  escalationCard: boolean;
}

const ACTIONS_NONE: TeamPanelActionVisibility = {
  stagedEditor: false,
  approve: false,
  revise: false,
  abandon: false,
  halt: false,
  resume: false,
  escalationCard: false,
};

/**
 * 按钮可见性矩阵（纯函数，按 team 状态机；测试直接断言本函数）。
 *
 * 与内核迁移表对齐（apps/drora-cli/packages/core/src/team/hub.ts）：
 * - staged：仅三动作（approve/revise/abandon）——hub.halt 在 staged 拒绝；
 * - active：仅停止团队（halt）；
 * - halted：仅显式恢复（resume，理由必填）；
 * - escalated：升级卡 = resume + halt（hub.resume 接受 halted|escalated，
 *   hub.halt 除 staged/归档外均可）；
 * - idle/completed/cancelled/archived：v1 无动作区（收队/归档入口属后续卡）。
 */
export function teamPanelActionVisibility(status: TeamUiStatus): TeamPanelActionVisibility {
  switch (status) {
    case "staged":
      return { ...ACTIONS_NONE, stagedEditor: true, approve: true, revise: true, abandon: true };
    case "active":
      return { ...ACTIONS_NONE, halt: true };
    case "halted":
      return { ...ACTIONS_NONE, resume: true };
    case "escalated":
      return { ...ACTIONS_NONE, halt: true, resume: true, escalationCard: true };
    default:
      return ACTIONS_NONE;
  }
}

export interface TeamPanelProps {
  model: TeamPanelModel;
  focus?: TeamUiFocus;
  connection?: TeamHistoryConnection;
  onQuoteTask?: (task: TeamPanelTaskView) => void;
  /**
   * 动作区命令意图上抛；宿主接 team/commands.ts 发送。缺席 = 只读渲染（无动作区，
   * staged 草案退化为摘要行）。
   */
  onCommand?: (command: TeamPanelCommand) => void;
  /**
   * 成员卡点击（下钻入口，PR-2.4c 接线）：宿主接 TeamMemberSidePane 的 setActiveMember。
   * 缺席 = 成员行只读（不可点）。发消息本体在下钻的 composer——成员卡的发消息按钮
   * （onMessageMember）也走同一次下钻，不在面板内另造输入面（design 01 §3.2「成员下钻」）。
   */
  onMemberClick?: (member: TeamPanelMemberView) => void;
  /**
   * 成员卡「发消息」入口（PR-2.4c）：与 onMemberClick 同一下钻语义，仅多一枚可点目标，
   * 让「给成员发消息」在设计上有明确落点（specs/agents-team.md §10「点击下钻 …可发消息」）。
   */
  onMessageMember?: (member: TeamPanelMemberView) => void;
}

export function TeamPanel(props: TeamPanelProps): JSX.Element {
  return <TeamPanelContent key={props.model.teamId} {...props} />;
}

function TeamPanelContent({
  model,
  onCommand,
  onMemberClick,
  onMessageMember,
  focus,
  connection,
  onQuoteTask,
}: TeamPanelProps): JSX.Element {
  const { intl } = useDroraIntl();
  const { status, members, board } = model;
  const visibility = teamPanelActionVisibility(status);
  const doneCount = board.completed.length;
  // 2026-10-18 审查修复：failed/cancelled 计入分母——不是已完成，也不从进度里凭空消失。
  const total = board.attention.length + board.pending.length + board.inProgress.length + doneCount;
  return (
    <section
      aria-label={intl.formatMessage({ id: "team.panel.aria" }, { teamId: model.teamId })}
      className="@container/team flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-ui-base font-medium">
          {model.name ?? intl.formatMessage({ id: "team.ui.title" })}
        </span>
        <TeamStatusBadge status={status} />
        {model.permissionMode === undefined ? null : (
          <span className="text-ui-xs rounded-sm bg-neutral-3 px-1.5 py-0.5 text-neutral-foreground">
            {intl.formatMessage({ id: "team.panel.permission" }, { mode: model.permissionMode })}
          </span>
        )}
        <span className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage(
            { id: "team.panel.memberProgress" },
            { members: members.length, done: doneCount, total },
          )}
        </span>
      </header>

      {/*
       * staged 审批态：面板即草案编辑器（design §3.1）。宿主未接命令时退化为
       * 只读摘要行（保持 PR-2.4a 的只读行为）。
       */}
      {model.stagedDraft === undefined ? null : onCommand !== undefined &&
        visibility.stagedEditor ? (
        <TeamStagedEditor
          draft={model.stagedDraft}
          onApprove={() => onCommand({ type: "approveTeamPlan", payload: {} })}
          onRevise={(note) =>
            onCommand({
              type: "reviseTeamPlan",
              payload: note === undefined ? {} : { note },
            })
          }
          onAbandon={() => onCommand({ type: "abandonTeamPlan", payload: {} })}
        />
      ) : (
        <div className="text-ui-caption rounded border border-border-subtle p-2">
          {intl.formatMessage(
            { id: "team.panel.stagedReadonlySummary" },
            {
              members: model.stagedDraft.members.length,
              tasks: model.stagedDraft.tasks.length,
            },
          )}
          {model.stagedDraft.awaitingFeedback
            ? intl.formatMessage({ id: "team.panel.stagedReadonlyFeedback" })
            : ""}
        </div>
      )}

      {/*
       * 干预动作区（design §3.3，按状态机出显）。escalated 的 resume/halt 收进升级卡，
       * 不再重复出独立区。
       */}
      {onCommand !== undefined && visibility.halt && !visibility.escalationCard ? (
        <div className="flex flex-wrap items-center gap-2">
          <HaltTeamButton onHalt={() => onCommand({ type: "haltTeam", payload: {} })} />
          <span className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "team.panel.haltHint" })}
          </span>
        </div>
      ) : null}

      {onCommand !== undefined && visibility.resume && !visibility.escalationCard ? (
        <ResumeTeamSection
          onResume={(reason) => onCommand({ type: "resumeTeam", payload: { reason } })}
        />
      ) : null}

      {onCommand !== undefined && visibility.escalationCard ? (
        <section
          aria-label={intl.formatMessage({ id: "team.panel.escalationTitle" })}
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2"
          data-testid="team-escalation-card"
        >
          <div className="flex flex-col gap-0.5">
            <h2 className="text-ui-base font-medium text-warning">
              {intl.formatMessage({ id: "team.panel.escalationTitle" })}
            </h2>
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "team.panel.escalationBody" })}
            </p>
          </div>
          <ResumeTeamSection
            onResume={(reason) => onCommand({ type: "resumeTeam", payload: { reason } })}
          />
          <div>
            <HaltTeamButton onHalt={() => onCommand({ type: "haltTeam", payload: {} })} />
          </div>
        </section>
      ) : null}

      {status === "staged" ? null : (
        <>
          <TeamWorkspaceViews
            model={model}
            focus={focus}
            connection={connection}
            onMemberClick={onMemberClick}
            onQuoteTask={onQuoteTask}
            board={(select) => (
              <div>
                <div className="grid min-h-0 grid-cols-1 gap-2 @lg/team:grid-cols-3">
                  <BoardColumn
                    title={intl.formatMessage({ id: "team.board.pending" })}
                    tasks={board.pending}
                    attention={board.attention}
                    onSelect={(task) =>
                      select({ teamId: model.teamId, kind: "task", id: task.taskId })
                    }
                  />
                  <BoardColumn
                    title={intl.formatMessage({ id: "team.board.inProgress" })}
                    tasks={board.inProgress}
                    onSelect={(task) =>
                      select({ teamId: model.teamId, kind: "task", id: task.taskId })
                    }
                  />
                  <BoardColumn
                    title={intl.formatMessage({ id: "team.board.completed" })}
                    tasks={board.completed}
                    onSelect={(task) =>
                      select({ teamId: model.teamId, kind: "task", id: task.taskId })
                    }
                  />
                </div>

                {/*
                 * 成员卡列表（design 01 §3.2）：PR-2.4c 起可下钻——卡片本体点击与「发消息」按钮
                 * 都上抛成员，宿主接同一个 setActiveMember（发消息的输入面在下钻 composer，
                 * 走 lead 邮箱投递；面板内不另造第二条输入路径）。回调缺席 = 只读行（PR-2.4a 行为）。
                 */}
                <ul
                  className="flex flex-col gap-1"
                  aria-label={intl.formatMessage({ id: "team.panel.membersAria" })}
                >
                  {members.map((member) => {
                    const stateLabel = intl.formatMessage({
                      id: MEMBER_STATE_I18N_KEYS[member.state],
                    });
                    return (
                      <li key={member.agentId} className="flex items-center gap-1">
                        {onMemberClick === undefined ? (
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <MemberCardBody member={member} stateLabel={stateLabel} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onMemberClick(member)}
                            aria-label={intl.formatMessage(
                              { id: "team.panel.memberOpen" },
                              { name: member.memberName },
                            )}
                            data-testid="team-member-card"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MemberCardBody member={member} stateLabel={stateLabel} />
                          </button>
                        )}
                        {onMessageMember === undefined ? null : (
                          <button
                            type="button"
                            onClick={() => onMessageMember(member)}
                            aria-label={intl.formatMessage(
                              { id: "team.panel.memberMessage" },
                              { name: member.memberName },
                            )}
                            data-testid="team-member-message"
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MessageSquareTextIcon className="size-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {/*
                 * 消息尾窗（design 01 §3.3.1：成员间消息摘要，最近 N 条，发件人色点 + 一行摘要；
                 * 完整消息在成员下钻）。2026-10-18 审查修复：view-model 此前已映射尾窗但面板
                 * 未渲染——agents 之间的协作关系缺了一个展示面。空尾窗不出区块。
                 */}
                {model.mailboxTail.length === 0 ? null : (
                  <section
                    aria-label={intl.formatMessage({ id: "team.panel.mailboxTitle" })}
                    className="flex shrink-0 flex-col gap-1"
                    data-testid="team-mailbox-tail"
                  >
                    <h3 className="text-ui-caption text-foreground-subtle">
                      {intl.formatMessage({ id: "team.panel.mailboxTitle" })}
                    </h3>
                    <ul className="flex flex-col gap-0.5">
                      {model.mailboxTail.map((entry) => (
                        <li key={entry.messageId} className="flex min-w-0 items-center gap-1.5">
                          <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${entry.fromColor ?? "bg-neutral-foreground/40"}`}
                          />
                          <span className="shrink-0 text-ui-caption text-foreground-subtle">
                            {`${displayActorName(intl, entry.from)} → ${displayActorName(intl, entry.to)}`}
                          </span>
                          <span className="truncate text-ui-caption text-foreground-subtlest">
                            {entry.summary === undefined
                              ? intl.formatMessage({ id: "team.panel.mailboxNoSummary" })
                              : entry.summary}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          />
        </>
      )}
    </section>
  );
}

/** 尾窗/任务卡的成员名显示：lead 键渲染为本地化标签（其余名字按原样，技术值不翻译）。 */
function displayActorName(intl: ReturnType<typeof useDroraIntl>["intl"], name: string): string {
  return name === TEAM_LEAD_ASSIGNEE ? intl.formatMessage({ id: "team.panel.leadAssignee" }) : name;
}

/** 成员卡的静态内容（头像点 + 名称 + 状态）；可点与只读两种行共用，避免两份标记分叉。 */
function MemberCardBody({
  member,
  stateLabel,
}: {
  member: TeamPanelMemberView;
  stateLabel: string;
}): JSX.Element {
  return (
    <>
      <TeamAvatar name={member.memberName} color={member.profileColor} />
      <span className="min-w-0 break-words text-ui-sm">
        {member.memberName}
        {member.profile ? (
          <span className="ml-1 text-foreground-subtle">{member.profile}</span>
        ) : null}
      </span>
      <span className="truncate text-ui-caption text-foreground-subtle">
        {stateLabel}
        {member.currentTaskId === undefined ? "" : ` · ${member.currentTaskId}`}
      </span>
    </>
  );
}

/** 停止团队入口（active 独立区 / escalated 升级卡共用）；二次确认列明影响面（design §3.3）。 */
function HaltTeamButton({ onHalt }: { onHalt: () => void }): JSX.Element {
  const { intl } = useDroraIntl();
  const requestConfirmation = useConfirmDialog();
  const handleHalt = async () => {
    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "team.panel.haltConfirmTitle" }),
      description: intl.formatMessage({ id: "team.panel.haltConfirmBody" }),
      confirmLabel: intl.formatMessage({ id: "team.panel.haltConfirmLabel" }),
      confirmVariant: "destructive",
    });
    if (confirmed) onHalt();
  };
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void handleHalt();
      }}
      data-testid="team-halt"
    >
      {intl.formatMessage({ id: "team.panel.halt" })}
    </Button>
  );
}

/** 显式恢复（halted / escalated；hub 语义：理由必填，空理由被拒——core/src/team/hub.ts resume）。 */
function ResumeTeamSection({ onResume }: { onResume: (reason: string) => void }): JSX.Element {
  const { intl } = useDroraIntl();
  const [reason, setReason] = useState("");
  const ready = reason.trim() !== "";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="team-resume-reason" className="text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "team.panel.resumeReasonLabel" })}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="team-resume-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={intl.formatMessage({ id: "team.panel.resumeReasonPlaceholder" })}
          className="text-ui-sm"
          data-testid="team-resume-reason"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!ready}
          onClick={() => onResume(reason.trim())}
          data-testid="team-resume"
        >
          {intl.formatMessage({ id: "team.panel.resume" })}
        </Button>
      </div>
      <p className="text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "team.panel.resumeHint" })}
      </p>
    </div>
  );
}

/**
 * 成员状态文字的 i18n 键（locales `team.member.state.*`；与 TEAM_STATUS_I18N_KEYS 同款
 * 单一出处形态，M2.5 起 STATUS_LABEL/MEMBER_STATE_LABEL 的 zh 内联表整体迁词典）。
 */
const MEMBER_STATE_I18N_KEYS: Record<TeamPanelModel["members"][number]["state"], string> = {
  spawning: "team.member.state.spawning",
  working: "team.member.state.working",
  terminal: "team.member.state.terminal",
  removed: "team.member.state.removed",
};

/**
 * 任务列（design 01 §3.3.2 的完整兑现，2026-10-18 审查修复）：
 * - failed/cancelled 以 attention 卡渲染在本列头部（failed = error 态：语义色 + 状态文字
 *   并行；cancelled = 中性弱化 + 状态文字），不混入普通待办，更不落入已完成；
 * - 任务卡显示负责人头像点（assigneeColor，与成员卡同色即同人；lead 用本地化标签）；
 * - 依赖以缩进表达（dependsDepth → pl-3/pl-6/pl-9，上限 3 级）；
 * - artifactRefs 以等宽小签摘录（DESIGN「技术值等宽」；打开通道属后续卡，不假装可点）。
 */
function BoardColumn({
  title,
  tasks,
  attention,
  onSelect,
}: {
  title: string;
  tasks: TeamPanelModel["board"]["pending"];
  attention?: readonly TeamPanelTaskView[];
  onSelect?: (task: TeamPanelTaskView) => void;
}) {
  const { intl } = useDroraIntl();
  const attentionTasks = attention ?? [];
  const totalCount = tasks.length + attentionTasks.length;
  return (
    <div className="flex min-h-0 flex-col gap-1 rounded-xl border border-border-subtle p-1.5">
      <h3 className="text-ui-caption text-foreground-subtle">{`${title} (${String(totalCount)})`}</h3>
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {attentionTasks.map((task) => (
          <TaskCard key={task.taskId} task={task} attention onSelect={onSelect} />
        ))}
        {tasks.map((task) => (
          <TaskCard key={task.taskId} task={task} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

/** 单张任务卡；attention 态按 failed（error）/cancelled（弱化）区分。 */
function TaskCard({
  task,
  attention = false,
  onSelect,
}: {
  task: TeamPanelTaskView;
  attention?: boolean;
  onSelect?: (task: TeamPanelTaskView) => void;
}) {
  const { intl } = useDroraIntl();
  const attentionTone =
    task.status === "failed"
      ? "border-destructive/40 bg-destructive/10"
      : "border-border-subtle bg-neutral-2 opacity-70";
  const indent = ["", "pl-3", "pl-6", "pl-9"][Math.min(task.dependsDepth, 3)] ?? "";
  return (
    <li
      className={`text-ui-base rounded-lg border p-1.5 ${attention ? attentionTone : "border-transparent bg-neutral-2"} ${indent}`}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-1.5">
        {task.assignee === undefined ? null : (
          <span
            aria-hidden
            className={`size-2 shrink-0 rounded-full ${task.assigneeColor ?? "bg-neutral-foreground/40"}`}
          />
        )}
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left break-words hover:bg-hover pointer-coarse:min-h-11"
          onClick={() => onSelect?.(task)}
        >
          {task.title}
        </button>
        {task.assignee === undefined ? null : (
          <span className="min-w-0 break-all text-ui-sm text-foreground-subtle">
            {` · ${displayActorName(intl, task.assignee)}`}
          </span>
        )}
        {attention && task.status === "failed" ? (
          <span className="shrink-0 text-ui-caption text-destructive">
            {intl.formatMessage({ id: "team.task.status.failed" })}
          </span>
        ) : null}
        {attention && task.status === "cancelled" ? (
          <span className="shrink-0 text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "team.task.status.cancelled" })}
          </span>
        ) : null}
        {task.attempt > 1 ? (
          <span className="shrink-0 text-ui-caption text-foreground-subtle">
            {` · ${intl.formatMessage({ id: "team.panel.taskAttempt" }, { attempt: task.attempt })}`}
          </span>
        ) : null}
      </div>
      {task.artifactRefs.length === 0 ? null : (
        <div className="mt-0.5 flex flex-wrap gap-1" data-testid="team-task-artifacts">
          {task.artifactRefs.map((ref) => (
            <span
              key={ref}
              title={ref}
              className="truncate rounded-md bg-neutral-3 px-1 py-px font-mono text-ui-sm text-foreground-subtle"
            >
              {ref}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
