import type { TeamPanelModel } from "./view-model.js";

/**
 * TeamPanel 只读视图（PR-2.4a；specs/agents-team.md §10、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3-§4）。
 *
 * 展示组件：数据由宿主从 v4 投影派生（mapTeamProjectionToViewModel），命令动作
 * 经回调注入（staged 编辑器与命令接线为 PR-2.4b）。DESIGN.md 纪律：text-ui-* 刻度、
 * 语义色 + 文字并行（不以色独行）、成员颜色仅头像点、无大面积品牌填充。
 */

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

export function TeamPanel({ model }: { model: TeamPanelModel }): JSX.Element {
  const { status, members, board } = model;
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

      {model.stagedDraft === undefined ? null : (
        <div className="text-ui-caption rounded border border-border-subtle p-2">
          {`团队计划草案：${model.stagedDraft.memberCount} 成员 / ${model.stagedDraft.taskCount} 任务，等待审批`}
          {model.stagedDraft.awaitingFeedback ? "（已请求修改）" : ""}
        </div>
      )}

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

function BoardColumn({ title, tasks }: { title: string; tasks: TeamPanelModel["board"]["pending"] }) {
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
