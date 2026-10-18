import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamPanelStagedDraftView } from "./view-model.js";

/**
 * staged 审批编辑器（PR-2.4b；specs/agents-team.md §10「staged 审批视图」、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1）。
 *
 * 两阶段成队：staged 态的 TeamPanel 即本编辑器——成员行（名称/角色/路由）与任务行
 * （标题/负责人/依赖）v1 **只读展示**（行内编辑属后续卡）；三个动作：
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
 */

export interface TeamStagedEditorProps {
  draft: TeamPanelStagedDraftView;
  /** 「确认并启动」上抛；宿主发 approveTeamPlan。 */
  onApprove: () => void;
  /** 「回对话修改」上抛；note 为面板内可选输入（trim 后为空则不携带）。 */
  onRevise: (note?: string) => void;
  /** 「放弃」上抛（本组件已完成二次确认）；宿主发 abandonTeamPlan。 */
  onAbandon: () => void;
}

export function TeamStagedEditor({
  draft,
  onApprove,
  onRevise,
  onAbandon,
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
      <div className="flex items-baseline gap-2">
        <h2 className="text-ui-base font-medium">
          {intl.formatMessage({ id: "team.stagedEditor.title" })}
        </h2>
        <span className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage(
            { id: "team.stagedEditor.stagedSummary" },
            { members: draft.members.length, tasks: draft.tasks.length },
          )}
        </span>
      </div>

      {draft.awaitingFeedback ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.stagedEditor.awaitingFeedback" })}
        </p>
      ) : null}

      <DraftMemberRows members={draft.members} />
      <DraftTaskRows tasks={draft.tasks} />

      <div className="flex flex-col gap-1">
        <label htmlFor="team-staged-revise-note" className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage({ id: "team.stagedEditor.noteLabel" })}
        </label>
        <Input
          id="team-staged-revise-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={intl.formatMessage({ id: "team.stagedEditor.notePlaceholder" })}
          className="text-ui-sm"
          data-testid="team-staged-revise-note"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onApprove} data-testid="team-staged-approve">
          {intl.formatMessage({ id: "team.stagedEditor.approve" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleRevise}
          data-testid="team-staged-revise"
        >
          {intl.formatMessage({ id: "team.stagedEditor.revise" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive"
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
}: {
  members: TeamPanelStagedDraftView["members"];
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
          </li>
        ))}
      </ul>
    </div>
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
