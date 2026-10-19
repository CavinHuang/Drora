import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { deriveSessionTeamActivity } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { TeamPanel } from "../../src/team/TeamPanel.js";
import { TeamConversationSummary } from "../../src/team/TeamConversationSummary.js";
import { TeamSessionLine } from "../../src/team/TeamSessionLine.js";
import { TeamNavigationProvider, type TeamOpenTarget } from "../../src/team/TeamNavigation.js";
import { mapTeamProjectionToViewModel } from "../../src/team/view-model.js";
import { createTeamFixture } from "./agents-team.fixture.js";
import "../../src/styles.css";

const target: TeamOpenTarget = {
  workspacePath: "/same-path",
  workspaceIdentity: "host-a/workspace-id",
  remoteSessionId: "remote-attachment",
  parentSessionId: "lead-session",
};
function Fixture() {
  const [team, setTeam] = useState(createTeamFixture),
    [locale, setLocale] = useState<"zh-CN" | "en-US">("zh-CN");
  const [navigation, setNavigation] = useState<TeamOpenTarget | null>(null),
    [member, setMember] = useState<string | null>(null);
  const [navigationEnabled, setNavigationEnabled] = useState(true);
  const model = useMemo(() => mapTeamProjectionToViewModel(team), [team]);
  return (
    <DroraIntlProvider key={locale} initialLocale={locale}>
      <TeamNavigationProvider onOpen={navigationEnabled ? setNavigation : undefined}>
        <div className="flex flex-wrap gap-2 p-3 text-ui-base">
          <button data-testid="fixture-readonly" onClick={() => setNavigationEnabled(false)}>
            Readonly details
          </button>
          <button
            data-testid="fixture-active"
            onClick={() => {
              setTeam(createTeamFixture());
              setMember(null);
            }}
          >
            Active
          </button>
          <button
            data-testid="fixture-idle"
            onClick={() =>
              setTeam((current) => ({
                ...current,
                status: "idle",
                board: {
                  ...current.board,
                  tasks: current.board.tasks.map((task) => ({ ...task, status: "completed" })),
                },
              }))
            }
          >
            Idle
          </button>
          <button
            data-testid="fixture-failed"
            onClick={() =>
              setTeam((current) => ({
                ...current,
                board: {
                  ...current.board,
                  tasks: current.board.tasks.map((task) =>
                    task.taskId === "T3" ? { ...task, status: "failed" } : task,
                  ),
                },
              }))
            }
          >
            Fail T3
          </button>
          <button
            data-testid="fixture-staged"
            onClick={() => {
              const original = createTeamFixture();
              setTeam({
                ...original,
                status: "staged",
                members: [],
                board: { limit: 100, tasks: [] },
                mailboxTail: [],
                stagedDraft: {
                  draftMembers: original.members.map((m) => ({
                    memberName: m.memberName,
                    profile: m.profile,
                  })),
                  draftTasks: original.board.tasks.map((t) => ({
                    taskId: t.taskId,
                    title: t.title,
                    assignee: t.assignee,
                    dependsOn: t.dependsOn,
                  })),
                  awaitingFeedback: false,
                },
              });
            }}
          >
            Staged
          </button>
          <button
            data-testid="fixture-locale"
            onClick={() => setLocale((value) => (value === "zh-CN" ? "en-US" : "zh-CN"))}
          >
            Language
          </button>
        </div>
        <div className="fixture-layout">
          <aside className="min-w-0 bg-sidebar p-3">
            <p className="text-ui-base">实现团队协作界面</p>
            <TeamSessionLine activity={deriveSessionTeamActivity(team)} target={target} />
          </aside>
          <main className="min-w-0 p-4">
            <p className="text-ui-base">Lead conversation</p>
            <TeamConversationSummary key={team.teamId} team={team} target={target} />
            <pre
              className="break-all whitespace-pre-wrap text-ui-sm"
              data-testid="fixture-navigation"
            >
              {JSON.stringify(navigation)}
            </pre>
          </main>
          <aside className="min-w-0 bg-panel">
            <div hidden={member !== null}>
              <TeamPanel model={model} onMemberClick={(m) => setMember(m.memberName)} />
            </div>
            {member ? (
              <section data-testid="fixture-member" className="p-3 text-ui-base">
                <button data-testid="fixture-member-back" onClick={() => setMember(null)}>
                  Back
                </button>
                <p>{member}</p>
              </section>
            ) : null}
          </aside>
        </div>
      </TeamNavigationProvider>
    </DroraIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
