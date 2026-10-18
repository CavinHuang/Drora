import { useState } from "react";
import type { CommandPayloadMap } from "@drora/shared/drora-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import type { TeamUiStatus } from "./contract.js";
import { TeamStagedEditor } from "./TeamStagedEditor.js";
import type { TeamPanelModel } from "./view-model.js";

/**
 * TeamPanel（PR-2.4a 只读视图 + PR-2.4b 动作区；specs/agents-team.md §10、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3-§4）。
 *
 * 展示组件：数据由宿主从 v4 投影派生（mapTeamProjectionToViewModel），动作区按状态机
 * 出显（teamPanelActionVisibility），命令意图经 onCommand 上抛——宿主接 team/commands.ts
 * 发送（approveTeamPlan / reviseTeamPlan / abandonTeamPlan / haltTeam / resumeTeam）。
 * DESIGN.md 纪律：text-ui-* 刻度、语义色 + 文字并行（不以色独行）、成员颜色仅头像点、
 * 无大面积品牌填充、按钮键盘可达。
 */

/** 面板文案（zh 内联常量；M2.5 i18n 键抽取时整体迁移到 locales 词典）。 */
export const TEAM_PANEL_COPY = {
  halt: "停止团队",
  haltHint: "中断全员并冻结调度；团队保留，可带理由恢复",
  haltConfirmTitle: "停止这个团队？",
  haltConfirmBody:
    "将取消 lead 当前回合、中断全部成员并冻结任务调度；团队不会被删除，之后可显式恢复。",
  haltConfirmLabel: "确认停止",
  resume: "恢复团队",
  resumeReasonLabel: "恢复理由（必填）",
  resumeReasonPlaceholder: "为什么现在恢复？理由会记录进团队日志",
  resumeHint: "团队已停止；显式带理由恢复后才会继续调度。",
  escalationTitle: "团队已升级，需要你介入",
  escalationBody: "团队遇到需要人工决策的情况，已暂停等待处理：可带理由恢复，或停止团队。",
} as const;

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
  /**
   * 动作区命令意图上抛；宿主接 team/commands.ts 发送。缺席 = 只读渲染（无动作区，
   * staged 草案退化为摘要行）。
   */
  onCommand?: (command: TeamPanelCommand) => void;
}

export function TeamPanel({ model, onCommand }: TeamPanelProps): JSX.Element {
  const { status, members, board } = model;
  const visibility = teamPanelActionVisibility(status);
  const doneCount = board.completed.length;
  const total = board.pending.length + board.inProgress.length + doneCount;
  return (
    <section aria-label={`Agents Team ${model.teamId}`} className="flex h-full flex-col gap-2 p-2">
      <header className="flex items-center gap-2">
        <span className="text-ui-sm font-medium">{`团队 · ${model.teamId}`}</span>
        <span className="text-ui-caption rounded bg-neutral-3 px-1.5 py-0.5 text-neutral-foreground">
          {STATUS_LABEL[status]}
        </span>
        {model.permissionMode === undefined ? null : (
          <span className="text-ui-caption rounded bg-neutral-3 px-1.5 py-0.5 text-neutral-foreground">
            {`权限 ${model.permissionMode}`}
          </span>
        )}
        <span className="text-ui-caption text-foreground-subtle">
          {`${members.length} 成员 · ${doneCount}/${total} 任务`}
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
          {`团队计划草案：${model.stagedDraft.members.length} 成员 / ${model.stagedDraft.tasks.length} 任务，等待审批`}
          {model.stagedDraft.awaitingFeedback ? "（已请求修改）" : ""}
        </div>
      )}

      {/*
       * 干预动作区（design §3.3，按状态机出显）。escalated 的 resume/halt 收进升级卡，
       * 不再重复出独立区。
       */}
      {onCommand !== undefined && visibility.halt && !visibility.escalationCard ? (
        <div className="flex flex-wrap items-center gap-2">
          <HaltTeamButton onHalt={() => onCommand({ type: "haltTeam", payload: {} })} />
          <span className="text-ui-caption text-foreground-subtle">{TEAM_PANEL_COPY.haltHint}</span>
        </div>
      ) : null}

      {onCommand !== undefined && visibility.resume && !visibility.escalationCard ? (
        <ResumeTeamSection
          onResume={(reason) => onCommand({ type: "resumeTeam", payload: { reason } })}
        />
      ) : null}

      {onCommand !== undefined && visibility.escalationCard ? (
        <section
          aria-label={TEAM_PANEL_COPY.escalationTitle}
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2"
          data-testid="team-escalation-card"
        >
          <div className="flex flex-col gap-0.5">
            <h2 className="text-ui-base font-medium text-warning">
              {TEAM_PANEL_COPY.escalationTitle}
            </h2>
            <p className="text-ui-sm text-foreground-subtle">{TEAM_PANEL_COPY.escalationBody}</p>
          </div>
          <ResumeTeamSection
            onResume={(reason) => onCommand({ type: "resumeTeam", payload: { reason } })}
          />
          <div>
            <HaltTeamButton onHalt={() => onCommand({ type: "haltTeam", payload: {} })} />
          </div>
        </section>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
        <BoardColumn title="待办" tasks={board.pending} />
        <BoardColumn title="进行中" tasks={board.inProgress} />
        <BoardColumn title="已完成" tasks={board.completed} />
      </div>

      <ul className="flex flex-col gap-1" aria-label="团队成员">
        {members.map((member) => (
          <li key={member.agentId} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`size-2 rounded-full ${member.profileColor ?? "bg-neutral-foreground/40"}`}
            />
            <span className="text-ui-sm">{member.memberName}</span>
            <span className="text-ui-caption text-foreground-subtle">
              {MEMBER_STATE_LABEL[member.state]}
              {member.currentTaskId === undefined ? "" : ` · ${member.currentTaskId}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 停止团队入口（active 独立区 / escalated 升级卡共用）；二次确认列明影响面（design §3.3）。 */
function HaltTeamButton({ onHalt }: { onHalt: () => void }): JSX.Element {
  const requestConfirmation = useConfirmDialog();
  const handleHalt = async () => {
    const confirmed = await requestConfirmation({
      title: TEAM_PANEL_COPY.haltConfirmTitle,
      description: TEAM_PANEL_COPY.haltConfirmBody,
      confirmLabel: TEAM_PANEL_COPY.haltConfirmLabel,
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
      {TEAM_PANEL_COPY.halt}
    </Button>
  );
}

/** 显式恢复（halted / escalated；hub 语义：理由必填，空理由被拒——core/src/team/hub.ts resume）。 */
function ResumeTeamSection({ onResume }: { onResume: (reason: string) => void }): JSX.Element {
  const [reason, setReason] = useState("");
  const ready = reason.trim() !== "";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="team-resume-reason" className="text-ui-caption text-foreground-subtle">
        {TEAM_PANEL_COPY.resumeReasonLabel}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="team-resume-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={TEAM_PANEL_COPY.resumeReasonPlaceholder}
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
          {TEAM_PANEL_COPY.resume}
        </Button>
      </div>
      <p className="text-ui-caption text-foreground-subtle">{TEAM_PANEL_COPY.resumeHint}</p>
    </div>
  );
}

const STATUS_LABEL: Record<TeamPanelModel["status"], string> = {
  staged: "待审批",
  active: "进行中",
  idle: "空闲",
  completed: "已完成",
  halted: "已停止",
  escalated: "需介入",
  cancelled: "已取消",
  archived: "已归档",
};

const MEMBER_STATE_LABEL: Record<TeamPanelModel["members"][number]["state"], string> = {
  spawning: "启动中",
  working: "工作中",
  terminal: "空闲",
  removed: "已移除",
};

function BoardColumn({
  title,
  tasks,
}: {
  title: string;
  tasks: TeamPanelModel["board"]["pending"];
}) {
  return (
    <div className="flex min-h-0 flex-col gap-1 rounded border border-border-subtle p-1.5">
      <h3 className="text-ui-caption text-foreground-subtle">{`${title} (${String(tasks.length)})`}</h3>
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {tasks.map((task) => (
          <li key={task.taskId} className="text-ui-sm rounded bg-neutral-2 p-1.5">
            <span>{task.title}</span>
            {task.assignee === undefined ? null : (
              <span className="text-ui-caption text-foreground-subtle">{` · ${task.assignee}`}</span>
            )}
            {task.attempt > 1 ? (
              <span className="text-ui-caption text-foreground-subtle">{` · 第 ${String(task.attempt)} 次`}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
