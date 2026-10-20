import { createRoot } from "react-dom/client";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  deriveSessionTeamActivity,
  TEAM_HISTORY_QUERY,
  type CommandAck,
  type CommandEnvelope,
  type TeamHistoryEntry,
} from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "../../src/i18n/IntlProvider.js";
import { TeamPanel } from "../../src/team/TeamPanel.js";
import { TeamConversationSummary } from "../../src/team/TeamConversationSummary.js";
import { TeamSessionLine } from "../../src/team/TeamSessionLine.js";
import {
  TeamNavigationProvider,
  useTeamFocus,
  type TeamOpenTarget,
} from "../../src/team/TeamNavigation.js";
import { mapTeamProjectionToViewModel } from "../../src/team/view-model.js";
import { createTeamFixture } from "./agents-team.fixture.js";
import "../../src/styles.css";
const RemoteTeamFixture = lazy(() =>
  import("./agents-team-remote-browser.fixture.js").then((module) => ({
    default: module.RemoteTeamFixture,
  })),
);

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
  const [mounted, setMounted] = useState(true);
  const [historyMode, setHistoryMode] = useState<"ok" | "error" | "deferred">("ok");
  const pending = useRef<(() => void) | null>(null);
  const [queries, setQueries] = useState(0);
  // Synthetic ACK：只测 React 查询/导航，不代表真实 Host。真实 journal 分页另有 core 测试。
  const sendCommand = useCallback(
    async (envelope: CommandEnvelope): Promise<CommandAck> => {
      setQueries((value) => value + 1);
      if (envelope.type !== TEAM_HISTORY_QUERY)
        throw new Error("Unexpected mutation in read-only UI test");
      const query = envelope.payload as { teamId: string; beforeSeq?: number; throughSeq?: number };
      const events: TeamHistoryEntry[] = Array.from({ length: 45 }, (_, index) => ({
        seq: index + 1,
        at: "2026-10-19T08:00:00Z",
        kind: "resumed",
        reason: `saved-${query.teamId}-${index + 1}`,
      }));
      events[43] = {
        seq: 44,
        at: "2026-10-19T08:22:00Z",
        kind: "message_appended",
        messageId: "m2",
        from: "Frontend",
        to: "Reviewer",
        sourceTaskId: "T3",
        sourceAttemptId: "attempt-a2",
        message: `saved-message-${query.teamId}`,
        delivered: false,
      };
      const candidates = events.filter(
        (event) =>
          event.seq <= (query.throughSeq ?? 45) && event.seq < (query.beforeSeq ?? Infinity),
      );
      const page = candidates.slice(-20);
      const result: CommandAck =
        historyMode === "error"
          ? { commandId: envelope.commandId, status: "failed", revisionAtDecision: 0 }
          : {
              commandId: envelope.commandId,
              status: "accepted",
              revisionAtDecision: 0,
              result: {
                type: TEAM_HISTORY_QUERY,
                teamId: query.teamId,
                events: page,
                throughSeq: query.throughSeq ?? 45,
                skippedEntries: 0,
                savedAt: "2026-10-19T08:22:00Z",
                ...(candidates.length > page.length ? { nextBeforeSeq: page[0]!.seq } : {}),
              },
            };
      if (historyMode === "deferred" && query.teamId === "team-ui")
        await new Promise<void>((resolve) => {
          pending.current = resolve;
        });
      return result;
    },
    [historyMode],
  );
  const connection = useMemo(
    () => ({ sessionId: target.parentSessionId, sendCommand }),
    [sendCommand],
  );
  const model = useMemo(() => mapTeamProjectionToViewModel(team), [team]);
  return (
    <DroraIntlProvider key={locale} initialLocale={locale}>
      <TeamNavigationProvider onOpen={navigationEnabled ? setNavigation : undefined}>
        <div className="bg-background text-foreground">
          <div className="fixture-controls flex flex-wrap gap-2 p-3 text-ui-base">
            <button
              data-testid="fixture-reopen"
              onClick={() => {
                setMounted((value) => !value);
                setMember(null);
              }}
            >
              Mount / unmount panel
            </button>
            <button data-testid="fixture-history-error" onClick={() => setHistoryMode("error")}>
              History error
            </button>
            <button data-testid="fixture-history-ok" onClick={() => setHistoryMode("ok")}>
              History ok
            </button>
            <button
              data-testid="fixture-history-deferred"
              onClick={() => setHistoryMode("deferred")}
            >
              Delay old history
            </button>
            <button data-testid="fixture-history-release" onClick={() => pending.current?.()}>
              Release old history
            </button>
            <button
              data-testid="fixture-next-team"
              onClick={() => {
                setTeam({ ...createTeamFixture(), teamId: "team-ui-next" });
                setMember(null);
              }}
            >
              Next team
            </button>
            <button data-testid="fixture-readonly" onClick={() => setNavigationEnabled(false)}>
              Readonly details
            </button>
            <button
              data-testid="fixture-active"
              onClick={() => {
                setTeam(createTeamFixture());
                setHistoryMode("ok");
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
              <TeamConversationSummary
                key={team.teamId}
                team={team}
                target={target}
                connection={connection}
              />
              <pre
                className="break-all whitespace-pre-wrap text-ui-sm"
                data-testid="fixture-navigation"
              >
                {JSON.stringify(navigation)}
              </pre>
              <output data-testid="fixture-history-queries">{queries}</output>
            </main>
            <aside className="min-w-0 bg-panel">
              <div hidden={member !== null}>
                {mounted ? (
                  <FixturePanel
                    model={model}
                    connection={connection}
                    onMemberClick={(m) => setMember(m.memberName)}
                  />
                ) : null}
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
        </div>
      </TeamNavigationProvider>
    </DroraIntlProvider>
  );
}
function FixturePanel(props: Parameters<typeof TeamPanel>[0]) {
  const focus = useTeamFocus(target);
  return <TeamPanel {...props} focus={focus} />;
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("remote") ? (
    <Suspense>
      <RemoteTeamFixture />
    </Suspense>
  ) : (
    <Fixture />
  ),
);
