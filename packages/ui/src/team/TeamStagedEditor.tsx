import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamCommandOutcome } from "./commands.js";
import type { TeamPanelStagedDraftView } from "./view-model.js";

/**
 * staged 审批编辑器（PR-2.4b；specs/agents-team.md §10「staged 审批视图」、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1）。
 *
 * 两阶段成队：staged 态的 TeamPanel 即本编辑器——成员行（名称/角色/路由）与任务行
 * （标题/负责人/依赖）v1 **只读展示**（行内编辑属后续卡；缺口10 起成员名称的「改名」
 * 经 setTeamMemberName 命令接线——staged 草案原子更新同一 teamId，任务 assignee 随
 * 名字重定向）；三个动作：
 * - 「确认并启动」→ onApprove（宿主发 approveTeamPlan，**唯一创建成员入口**，批准前零成员零会话）；
 * - 「回对话修改」→ onRevise(note?)（宿主发 reviseTeamPlan；note 为面板内可选输入，
 *   修改方向也可留空后在对话里说明——宿主负责预填会话输入框：TeamSidePane 的
 *   onPrefillComposer 回调，文案构造见 team/revise-prefill.ts）；
 * - 「放弃」→ onAbandon（宿主发 abandonTeamPlan；二次确认在本组件内完成，
 *   归档后禁止模型自动重建）。
 *
 * presentational：命令发送一律由宿主接 team/commands.ts，本组件只上抛意图。
 * DESIGN.md：text-ui-* 刻度、技术值（路由/任务 id）等宽、成员/任务行无大面积色块。
 *
 * M2.5 i18n：全部文案走 locales `team.stagedEditor.*` 词典（原 zh 内联常量
 * TEAM_STAGED_EDITOR_COPY 已整体迁出，zh 值逐字搬运；design 01 §4）；
 * 依赖 id 列表的连接符也随语言（dependsOnSeparator），路由/依赖 id 本体保持等宽拼接。
 *
 * 2026-10-22 审批面呈现对齐（spec §10 呈现规则五子条，同日 01-design §3.1 同步）：
 * - 问句表头：顶部问句行（「启动这支团队？」语义）+「N 名成员 · N 项任务」计数
 *   （原 stagedSummary 文案移作表头计数）；会话流卡头已有团队名与状态徽标，表头
 *   不重复。表头为 team 自有实现——**不 import** WorkflowCardChrome /
 *   WorkflowPermissionBlock（workflow 图标硬编码于 WorkflowCardChrome.tsx:24/:176，
 *   借用即把 workflow 徽记带进 team 语境；对齐的是问句/信息层级语汇，不是徽记资产）。
 * - 三动作失败出显：approveTeamPlan/reviseTeamPlan/abandonTeamPlan 的
 *   TeamCommandOutcome 此前失败只进 logger、无 UI 消费面——本组件内联 role=alert
 *   失败提示（按 ack.reasonCode 出 i18n 文案，未知 reasonCode 走兜底文案），
 *   借形不借管线：不接权限请求管线，命令单一通道不变（hub/wire 零结构改动）。
 * - 触达：编辑器内全部可交互控件（三动作按钮、改名铅笔/输入/确认/取消、备注输入）
 *   pointer-coarse ≥44px（DESIGN.md:661-662「keep touch targets at 44px
 *   (`size-11`/`min-h-11`)」；写法照 TeamConversationSummary.tsx:73 现有先例）。
 */

/** 三动作种类（失败提示的来源动作标识；spec §10 呈现规则4）。 */
export type TeamStagedActionKind = "approve" | "revise" | "abandon";

/**
 * 最近一次三动作失败（宿主消费 TeamCommandOutcome 后交回；null/缺席 = 无失败提示）。
 * `reasonCode` 取 ack.reasonCode——hub 拒绝 = `fault.command.teamRejected.<TeamPortErrorCode>`
 * （bootstrap drora-protocol-v4/commands/handlers/team.ts，错误码集合见 core
 * src/team/errors.ts）、hub 缺席 = fault.command.teamHubUnavailable；传输异常
 * （sendCommand 抛错、ack 缺席）时 reasonCode 缺席 → 走 transport 文案。
 */
export interface TeamStagedCommandFailure {
  action: TeamStagedActionKind;
  reasonCode?: string;
}

/**
 * 已知拒绝 reasonCode → 失败文案键（spec §10 呈现规则4「按 ack.reasonCode 出 i18n
 * 文案，未知 reasonCode 有兜底文案」）。字面量生产方在 bootstrap handlers/team.ts
 * （V4TeamRejectedError / V4TeamHubUnavailableError）；本表是 UI 侧的呈现归并
 * （同族校验错误共用一句），不构成契约的生产/消费对，新增错误码不要求同步本表
 * ——未知值统一落 `team.stagedEditor.failure.fallback` 兜底。
 */
export const TEAM_STAGED_FAILURE_REASON_I18N_KEYS: Readonly<Record<string, string>> = {
  "fault.command.teamRejected.team_not_present": "team.stagedEditor.failure.teamNotPresent",
  "fault.command.teamRejected.team_lead_only": "team.stagedEditor.failure.teamLeadOnly",
  "fault.command.teamRejected.member_spawn_failed": "team.stagedEditor.failure.memberSpawnFailed",
  "fault.command.teamRejected.draft_duplicate_member": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.draft_unknown_assignee": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.draft_duplicate_task": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.unknown_dependency": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.dependency_cycle": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamHubUnavailable": "team.stagedEditor.failure.hubUnavailable",
};

/** 失败原因文案键：无 reasonCode（传输异常）→ transport；已知 → 映射；未知 → 兜底。 */
export function stagedFailureReasonI18nKey(failure: TeamStagedCommandFailure): string {
  if (failure.reasonCode === undefined) return "team.stagedEditor.failure.transport";
  return (
    TEAM_STAGED_FAILURE_REASON_I18N_KEYS[failure.reasonCode] ?? "team.stagedEditor.failure.fallback"
  );
}

/**
 * TeamCommandOutcome → 失败态（两挂载点共用的单一映射出处；ok = accepted|duplicate|noop
 * 不出提示，拒绝携带 ack.reasonCode，传输异常 ack 缺席则 reasonCode 缺席）。
 */
export function teamCommandOutcomeToStagedFailure(
  action: TeamStagedActionKind,
  outcome: TeamCommandOutcome,
): TeamStagedCommandFailure | null {
  if (outcome.ok) return null;
  const reasonCode = outcome.ack?.reasonCode;
  return { action, ...(reasonCode === undefined ? {} : { reasonCode }) };
}

export interface TeamStagedEditorProps {
  draft: TeamPanelStagedDraftView;
  /** 「确认并启动」上抛；宿主发 approveTeamPlan。 */
  onApprove: () => void;
  /** 「回对话修改」上抛；note 为面板内可选输入（trim 后为空则不携带）。 */
  onRevise: (note?: string) => void;
  /** 「放弃」上抛（本组件已完成二次确认）；宿主发 abandonTeamPlan。 */
  onAbandon: () => void;
  /**
   * 成员「改名」上抛（缺口10）：宿主发 setTeamMemberName（staged 草案原子更新，
   * assignee 重定向在 handler 侧完成）。缺席 = 成员行只读（无改名入口）。
   */
  onRenameMember?: (memberName: string, newName: string) => void;
  /**
   * 最近一次三动作失败（spec §10 呈现规则4；宿主消费 TeamCommandOutcome 后交回，
   * 映射用 teamCommandOutcomeToStagedFailure）。null/缺席 = 无失败提示；任一动作
   * 再次发起时由宿主置空清除（两挂载点在动作回调开头 set null）。
   */
  failure?: TeamStagedCommandFailure | null;
}

export function TeamStagedEditor({
  draft,
  onApprove,
  onRevise,
  onAbandon,
  onRenameMember,
  failure,
}: TeamStagedEditorProps): JSX.Element {
  const { intl } = useDroraIntl();
  const requestConfirmation = useConfirmDialog();
  const [note, setNote] = useState("");

  const handleRevise = () => {
    const trimmed = note.trim();
    onRevise(trimmed === "" ? undefined : trimmed);
  };

  const handleAbandon = async () => {
    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmTitle" }),
      description: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmBody" }),
      confirmLabel: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmLabel" }),
      confirmVariant: "destructive",
    });
    if (confirmed) onAbandon();
  };

  return (
    <section
      aria-label={intl.formatMessage({ id: "team.stagedEditor.title" })}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-2"
      data-testid="team-staged-editor"
    >
      {/*
       * 问句表头（spec §10 呈现规则1；对齐 WorkflowPermissionBlock 的「问句在最上」语汇，
       * WorkflowPermissionBlock.tsx:240——但不借 workflow 徽记，见文件头注）：问句行承载
       * 决策提问，计数行 = 原 stagedSummary 文案移作表头计数（「N 名成员 · N 项任务」）。
       * 会话流卡头已有团队名与状态徽标，此处不重复。
       */}
      <header className="flex flex-col gap-0.5">
        <h2 className="text-ui-base font-medium">
          {intl.formatMessage({ id: "team.stagedEditor.question" })}
        </h2>
        <span className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage(
            { id: "team.stagedEditor.stagedSummary" },
            { members: draft.members.length, tasks: draft.tasks.length },
          )}
        </span>
      </header>

      {draft.awaitingFeedback ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.stagedEditor.awaitingFeedback" })}
        </p>
      ) : null}

      <DraftMemberRows
        members={draft.members}
        {...(onRenameMember === undefined ? {} : { onRenameMember })}
      />
      <DraftTaskRows tasks={draft.tasks} />

      <div className="flex flex-col gap-1">
        <label htmlFor="team-staged-revise-note" className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage({ id: "team.stagedEditor.noteLabel" })}
        </label>
        {/* pointer-coarse ≥44px：备注输入也是编辑器内可交互控件（spec §10 呈现规则5）。 */}
        <Input
          id="team-staged-revise-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={intl.formatMessage({ id: "team.stagedEditor.notePlaceholder" })}
          className="text-ui-sm pointer-coarse:min-h-11"
          data-testid="team-staged-revise-note"
        />
      </div>

      {/*
       * 三动作失败出显（spec §10 呈现规则4）：role=alert 内联提示，文案 = 动作标签
       * （复用按钮文案键）+ 按 ack.reasonCode 映射的原因（未知走兜底，见
       * stagedFailureReasonI18nKey）。宿主在任一动作再次发起时置空清除。
       */}
      {failure === undefined || failure === null ? null : (
        <p
          role="alert"
          className="text-ui-sm text-destructive"
          data-testid="team-staged-command-error"
        >
          {intl.formatMessage(
            { id: "team.stagedEditor.failure.line" },
            {
              action: intl.formatMessage({ id: `team.stagedEditor.${failure.action}` }),
              reason: intl.formatMessage({ id: stagedFailureReasonI18nKey(failure) }),
            },
          )}
        </p>
      )}

      {/* pointer-coarse ≥44px：三动作按钮（DESIGN.md:661-662；写法照 TeamConversationSummary.tsx:73）。 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onApprove}
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          data-testid="team-staged-approve"
        >
          {intl.formatMessage({ id: "team.stagedEditor.approve" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleRevise}
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          data-testid="team-staged-revise"
        >
          {intl.formatMessage({ id: "team.stagedEditor.revise" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={() => {
            void handleAbandon();
          }}
          data-testid="team-staged-abandon"
        >
          {intl.formatMessage({ id: "team.stagedEditor.abandon" })}
        </Button>
      </div>
    </section>
  );
}

function DraftMemberRows({
  members,
  onRenameMember,
}: {
  members: TeamPanelStagedDraftView["members"];
  onRenameMember?: (memberName: string, newName: string) => void;
}): JSX.Element {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${intl.formatMessage({ id: "team.stagedEditor.membersHeading" })} (${String(members.length)})`}
      </h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.memberName}
            className="flex flex-wrap items-baseline gap-x-2 rounded bg-neutral-2 px-1.5 py-1"
          >
            <span className="text-ui-sm font-medium">{member.memberName}</span>
            <span className="text-ui-caption text-foreground-subtle">
              {member.profile ?? intl.formatMessage({ id: "team.stagedEditor.roleNone" })}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {member.modelSelection === undefined
                ? intl.formatMessage({ id: "team.stagedEditor.routingNone" })
                : `${intl.formatMessage({ id: "team.stagedEditor.routingLabel" })} ${member.modelSelection.provider}/${member.modelSelection.model}${member.modelSelection.thought === undefined ? "" : ` · ${member.modelSelection.thought}`}`}
            </span>
            {onRenameMember === undefined ? null : (
              <DraftMemberRename memberName={member.memberName} onRename={onRenameMember} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 成员行「改名」入口（缺口10）：staged 草案期的成员改名经 setTeamMemberName 命令
 * （宿主接 team/commands.ts；重名/空白由 wire schema 与 hub 草案校验单一出处拒绝，
 * 本组件只做非空与「有变化」的本地门）。改名只改草案名——批准前零成员零会话，
 * 任务 assignee 的重定向在 handler 重建草案时完成。
 */
function DraftMemberRename({
  memberName,
  onRename,
}: {
  memberName: string;
  onRename: (memberName: string, newName: string) => void;
}): JSX.Element {
  const { intl } = useDroraIntl();
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(memberName);
  const trimmed = nextName.trim();
  const ready = trimmed !== "" && trimmed !== memberName;
  const apply = () => {
    if (!ready) return;
    onRename(memberName, trimmed);
    setEditing(false);
  };
  return editing ? (
    // pointer-coarse ≥44px：改名输入/确认/取消（spec §10 呈现规则5；desktop 保持原 h-7 紧凑密度）。
    <span className="ml-auto flex items-center gap-1">
      <Input
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            setNextName(memberName);
            setEditing(false);
          }
        }}
        aria-label={intl.formatMessage(
          { id: "team.stagedEditor.renameLabel" },
          { name: memberName },
        )}
        data-testid="team-staged-rename-input"
        className="h-7 w-32 text-ui-sm pointer-coarse:min-h-11"
      />
      <Button
        type="button"
        size="sm"
        disabled={!ready}
        onClick={apply}
        data-testid="team-staged-rename-apply"
        className="h-7 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {intl.formatMessage({ id: "team.stagedEditor.renameApply" })}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setNextName(memberName);
          setEditing(false);
        }}
        data-testid="team-staged-rename-cancel"
        className="h-7 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {intl.formatMessage({ id: "team.stagedEditor.renameCancel" })}
      </Button>
    </span>
  ) : (
    // pointer-coarse ≥44px：改名铅笔（desktop 保持 size-6，coarse 指针抬到 44px）。
    <button
      type="button"
      onClick={() => {
        setNextName(memberName);
        setEditing(true);
      }}
      aria-label={intl.formatMessage({ id: "team.stagedEditor.renameLabel" }, { name: memberName })}
      data-testid="team-staged-rename"
      className="ml-auto flex size-6 shrink-0 items-center justify-center self-center rounded-md text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      <PencilIcon className="size-3" />
    </button>
  );
}

function DraftTaskRows({ tasks }: { tasks: TeamPanelStagedDraftView["tasks"] }): JSX.Element {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${intl.formatMessage({ id: "team.stagedEditor.tasksHeading" })} (${String(tasks.length)})`}
      </h3>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.taskId}
            className="flex flex-wrap items-baseline gap-x-2 rounded bg-neutral-2 px-1.5 py-1"
          >
            <span className="text-ui-sm font-medium">{task.title}</span>
            <span className="text-ui-caption font-mono text-foreground-subtle">{task.taskId}</span>
            <span className="text-ui-caption text-foreground-subtle">
              {task.assignee ?? intl.formatMessage({ id: "team.stagedEditor.assigneeNone" })}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {task.dependsOn.length === 0
                ? intl.formatMessage({ id: "team.stagedEditor.dependsOnNone" })
                : `${intl.formatMessage({ id: "team.stagedEditor.dependsOnLabel" })} ${task.dependsOn.join(
                    intl.formatMessage({ id: "team.stagedEditor.dependsOnSeparator" }),
                  )}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
