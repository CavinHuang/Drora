import { describe, expect, it } from "vitest";
import { createTeamFixture } from "./fixtures/agents-team.fixture.js";
import { mapTeamProjectionToViewModel } from "../src/team/view-model.js";
import { buildTeamRelations } from "../src/team/relations.js";
import { teamFacts, waitingDependencies } from "../src/team/presentation.js";

describe("team relationship evidence", () => {
  it("keeps failed work in progress totals and does not unlock waiting reviewers", () => {
    const team = createTeamFixture();
    team.board.tasks[2]!.status = "failed";
    const model = mapTeamProjectionToViewModel(team);
    expect(teamFacts(model)).toMatchObject({ total: 5, completed: 2, blocked: 1 });
    expect(waitingDependencies(model, model.board.pending[0]!)).toEqual(["T3", "T4"]);
  });
  it("preserves delivery and attempt provenance and resolves agent ids inside this team", () => {
    const model = mapTeamProjectionToViewModel(createTeamFixture());
    expect(model.name).toBe("界面协作团队");
    expect(model.mailboxTail[1]).toMatchObject({
      delivered: false,
      sourceTaskId: "T3",
      sourceAttemptId: "attempt-a2",
      at: "2026-10-19T08:22:00Z",
    });
    const graph = buildTeamRelations(model, "messages");
    expect(graph.edges[0]).toMatchObject({
      id: "m2",
      from: "actor:Frontend",
      to: "actor:Reviewer",
      message: { delivered: false },
    });
    expect(graph.nodes.find((n) => n.id === "actor:Backend")?.member?.agentId).toBe("b");
  });
  it("keeps unmet and failed dependencies separate from delivered messages", () => {
    const team = createTeamFixture();
    team.board.tasks[2]!.status = "failed";
    const graph = buildTeamRelations(mapTeamProjectionToViewModel(team), "dependencies");
    expect(graph.edges.find((e) => e.from === "task:T3" && e.to === "task:T5")?.satisfied).toBe(
      false,
    );
    expect(graph.edges.find((e) => e.from === "task:T2" && e.to === "task:T3")?.satisfied).toBe(
      true,
    );
    expect(buildTeamRelations(mapTeamProjectionToViewModel(team), "handoffs").edges).toEqual([]);
  });
  it("retains missing references and bounds cyclic / large graphs", () => {
    const team = createTeamFixture();
    team.board.tasks[0]!.dependsOn = ["missing", "T2"];
    const graph = buildTeamRelations(mapTeamProjectionToViewModel(team), "dependencies");
    expect(graph.nodes.find((n) => n.id === "task:missing")?.missing).toBe(true);
    expect(graph.nodes.every((n) => Number.isFinite(n.level))).toBe(true);
    const original = team.board.tasks[0]!;
    team.board.tasks = Array.from({ length: 30 }, (_, i) => ({
      ...original,
      taskId: `big-${i}`,
      dependsOn: i ? [`big-${i - 1}`] : [],
    }));
    const bounded = buildTeamRelations(
      mapTeamProjectionToViewModel(team),
      "dependencies",
      "big-15",
    );
    expect(bounded.nodes.length).toBeLessThanOrEqual(12);
    expect(bounded.totalNodes).toBe(30);
    expect(bounded.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(["task:big-14", "task:big-15", "task:big-16"]),
    );
  });
  it("does not present historical communication for a draft", () => {
    const team = createTeamFixture();
    team.status = "staged";
    expect(buildTeamRelations(mapTeamProjectionToViewModel(team), "messages").edges).toEqual([]);
  });
});
