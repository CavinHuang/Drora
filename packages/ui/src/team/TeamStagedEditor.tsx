import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import type { TeamPanelStagedDraftView } from "./view-model.js";

/**
 * staged 审批编辑器（PR-2.4b；specs/agents-team.md §10「staged 审批视图」、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1）。
 *
 * 两阶段成队：staged 态的 TeamPanel 即本编辑器——成员行（名称/角色/路由）与任务行
 * （标题/负责人/依赖）v1 **只读展示**（行内编辑属后续卡）；三个动作：
 * - 「确认并启动」→ onApprove（宿主发 approveTeamPlan，**唯一创建成员入口**，批准前零成员零会话）；
 * - 「回对话修改」→ onRevise(note?)（宿主发 reviseTeamPlan；note 为面板内可选输入，
 *   修改方向也可留空后在对话里说明——宿主负责预填会话输入框）；
 * - 「放弃」→ onAbandon（宿主发 abandonTeamPlan；二次确认在本组件内完成，
 *   归档后禁止模型自动重建）。
 *
 * presentational：命令发送一律由宿主接 team/commands.ts，本组件只上抛意图。
 * DESIGN.md：text-ui-* 刻度、技术值（路由/任务 id）等宽、成员/任务行无大面积色块。
 */

/** 面板文案（zh 内联常量；M2.5 i18n 键抽取时整体迁移到 locales 词典）。 */
export const TEAM_STAGED_EDITOR_COPY = {
  title: "团队计划草案",
  stagedSummary: (members: number, tasks: number): string =>
    `${String(members)} 名成员 · ${String(tasks)} 项任务，确认后才会创建成员`,
  awaitingFeedback: "已请求修改：请在对话里说明调整方向，模型会更新这份草案",
  membersHeading: "成员",
  tasksHeading: "任务",
  roleNone: "角色未指定",
  routingLabel: "路由",
  routingNone: "路由未指定",
  assigneeNone: "待指派",
  dependsOnLabel: "依赖",
  dependsOnNone: "无依赖",
  noteLabel: "修改方向（可选）",
  notePlaceholder: "要调整什么？可留空，回到对话里说明",
  approve: "确认并启动",
  revise: "回对话修改",
  abandon: "放弃",
  abandonConfirmTitle: "放弃这份团队草案？",
  abandonConfirmBody: "草案将归档且不可恢复，模型也不会自动重建；再次成队需要重新 /team。",
  abandonConfirmLabel: "确认放弃",
} as const;

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
  const requestConfirmation = useConfirmDialog();
  const [note, setNote] = useState("");

  const handleRevise = () => {
    const trimmed = note.trim();
    onRevise(trimmed === "" ? undefined : trimmed);
  };

  const handleAbandon = async () => {
    const confirmed = await requestConfirmation({
      title: TEAM_STAGED_EDITOR_COPY.abandonConfirmTitle,
      description: TEAM_STAGED_EDITOR_COPY.abandonConfirmBody,
      confirmLabel: TEAM_STAGED_EDITOR_COPY.abandonConfirmLabel,
      confirmVariant: "destructive",
    });
    if (confirmed) onAbandon();
  };

  return (
    <section
      aria-label={TEAM_STAGED_EDITOR_COPY.title}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-2"
      data-testid="team-staged-editor"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-ui-base font-medium">{TEAM_STAGED_EDITOR_COPY.title}</h2>
        <span className="text-ui-caption text-foreground-subtle">
          {TEAM_STAGED_EDITOR_COPY.stagedSummary(draft.members.length, draft.tasks.length)}
        </span>
      </div>

      {draft.awaitingFeedback ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {TEAM_STAGED_EDITOR_COPY.awaitingFeedback}
        </p>
      ) : null}

      <DraftMemberRows members={draft.members} />
      <DraftTaskRows tasks={draft.tasks} />

      <div className="flex flex-col gap-1">
        <label htmlFor="team-staged-revise-note" className="text-ui-caption text-foreground-subtle">
          {TEAM_STAGED_EDITOR_COPY.noteLabel}
        </label>
        <Input
          id="team-staged-revise-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={TEAM_STAGED_EDITOR_COPY.notePlaceholder}
          className="text-ui-sm"
          data-testid="team-staged-revise-note"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onApprove} data-testid="team-staged-approve">
          {TEAM_STAGED_EDITOR_COPY.approve}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleRevise}
          data-testid="team-staged-revise"
        >
          {TEAM_STAGED_EDITOR_COPY.revise}
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
          {TEAM_STAGED_EDITOR_COPY.abandon}
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
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${TEAM_STAGED_EDITOR_COPY.membersHeading} (${String(members.length)})`}
      </h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.memberName}
            className="flex flex-wrap items-baseline gap-x-2 rounded bg-neutral-2 px-1.5 py-1"
          >
            <span className="text-ui-sm font-medium">{member.memberName}</span>
            <span className="text-ui-caption text-foreground-subtle">
              {member.profile ?? TEAM_STAGED_EDITOR_COPY.roleNone}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {member.modelSelection === undefined
                ? TEAM_STAGED_EDITOR_COPY.routingNone
                : `${TEAM_STAGED_EDITOR_COPY.routingLabel} ${member.modelSelection.provider}/${member.modelSelection.model}${member.modelSelection.thought === undefined ? "" : ` · ${member.modelSelection.thought}`}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DraftTaskRows({ tasks }: { tasks: TeamPanelStagedDraftView["tasks"] }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${TEAM_STAGED_EDITOR_COPY.tasksHeading} (${String(tasks.length)})`}
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
              {task.assignee ?? TEAM_STAGED_EDITOR_COPY.assigneeNone}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {task.dependsOn.length === 0
                ? TEAM_STAGED_EDITOR_COPY.dependsOnNone
                : `${TEAM_STAGED_EDITOR_COPY.dependsOnLabel} ${task.dependsOn.join("、")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
