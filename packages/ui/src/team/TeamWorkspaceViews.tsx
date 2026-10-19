import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelModel, TeamPanelMemberView, TeamPanelTaskView } from "./view-model.js";
import { TeamOverview } from "./TeamOverview.js";
import { TeamSelectionDetails } from "./TeamSelectionDetails.js";
import { TeamProcessPanel } from "./TeamProcessPanel.js";
import { TeamCollaborationPanel } from "./TeamCollaborationPanel.js";

type View = "overview" | "process" | "collaboration";
export function TeamWorkspaceViews({
  model,
  focus,
  connection,
  onMemberClick,
  onQuoteTask,
  board,
}: {
  model: TeamPanelModel;
  focus?: TeamUiFocus;
  connection?: TeamHistoryConnection;
  onMemberClick?: (member: TeamPanelMemberView) => void;
  onQuoteTask?: (task: TeamPanelTaskView) => void;
  board?: (select: (focus: TeamUiFocus) => void) => ReactNode;
}) {
  const { intl } = useDroraIntl();
  const [view, setView] = useState<View>("overview");
  const [selection, setSelection] = useState<TeamUiFocus>();
  const [showBoard, setShowBoard] = useState(false);
  const [visitedProcess, setVisitedProcess] = useState(false);
  function select(next: TeamUiFocus) {
    if (next.teamId !== model.teamId) return;
    if (next.kind === "overview" || next.kind === "process" || next.kind === "collaboration") {
      setView(next.kind);
      setSelection(undefined);
      if (next.kind === "process") setVisitedProcess(true);
    } else setSelection(next);
  }
  useEffect(() => {
    // 中文依据：导航只携带局部定位，不能把上一个 team 的选择带到当前团队。
    if (focus?.teamId !== model.teamId) return;
    select(focus);
  }, [focus, model.teamId]);
  return (
    <div className="min-w-0" data-testid="team-workspace-views">
      <nav
        className="mb-3 flex gap-1 border-b border-border pb-2"
        aria-label={intl.formatMessage({ id: "team.ui.title" })}
      >
        {(["overview", "process", "collaboration"] as const).map((value) => (
          <Button
            type="button"
            key={value}
            variant={view === value ? "secondary" : "ghost"}
            aria-pressed={view === value}
            className="pointer-coarse:min-h-11"
            data-testid={`team-view-${value}`}
            onClick={() => select({ teamId: model.teamId, kind: value })}
          >
            {intl.formatMessage({ id: `team.ui.${value}` })}
          </Button>
        ))}
      </nav>
      <div hidden={selection !== undefined}>
        <div hidden={view !== "overview"}>
          {showBoard && board ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-2 pointer-coarse:min-h-11"
                onClick={() => setShowBoard(false)}
              >
                {intl.formatMessage({ id: "team.ui.taskList" })}
              </Button>
              {board(select)}
            </>
          ) : (
            <TeamOverview model={model} onSelect={select} onBoard={() => setShowBoard(true)} />
          )}
        </div>
        {visitedProcess ? (
          <div hidden={view !== "process"}>
            <TeamProcessPanel model={model} connection={connection} onSelect={select} />
          </div>
        ) : null}
        <div hidden={view !== "collaboration"}>
          <TeamCollaborationPanel
            model={model}
            onMemberClick={(member) =>
              select({ teamId: model.teamId, kind: "member", id: member.agentId })
            }
            onTaskClick={(task) => select({ teamId: model.teamId, kind: "task", id: task.taskId })}
          />
        </div>
      </div>
      {selection ? (
        <TeamSelectionDetails
          model={model}
          focus={selection}
          onSelect={select}
          onBack={() => setSelection(undefined)}
          onMemberClick={onMemberClick}
          onQuoteTask={onQuoteTask}
        />
      ) : null}
    </div>
  );
}
