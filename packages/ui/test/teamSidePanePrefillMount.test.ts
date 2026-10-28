// @vitest-environment jsdom
/**
 * TeamSidePane 挂载链测试（缺口9）：「回对话修改」预填（reviseTeamPlan）与「在主会话中
 * 引用任务」（onQuoteTask）两条交互链此前是死路——挂载点不传 onPrefillComposer
 * （AnimatedSidePanePanel team 分支只传 tab/focused/三个 onOpen*）。本测试渲染真实
 * TeamSidePane（打桩 v4 会话上下文/投影/SessionPane，模式照 subagentSidePane.test.ts），
 * 断言回调在场时两条链都发命令并回调预填；回调缺席时诚实降级（引用按钮不渲染）。
 *
 * 另覆盖缺口10 的 staged 改名入口（team-staged-rename → setTeamMemberName 命令）。
 */
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope, TeamProjectionState } from "@drora/shared/drora-protocol-v4";
import { TeamSidePane } from "@/app-shell/TeamSidePane.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import type { TeamSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { createTeamFixture } from "./fixtures/agents-team.fixture.js";

const harness = vi.hoisted(() => ({
  /** useConversationProjection 的 snapshot（TeamSidePane 只读 snapshot.team）。 */
  conversationSnapshot: undefined as unknown,
  /** sendCommand 收到的命令信封（断言命令与预填同时发生）。 */
  commandEnvelopes: [] as unknown[],
}));

vi.mock("@/v4/SessionPane.js", async () => {
  const React = await import("react");
  return {
    SessionPane: () => React.createElement("div", { "data-testid": "mock-session-pane" }),
  };
});

vi.mock("@/v4/V4ConversationContext.js", async () => {
  const React = await import("react");
  return {
    V4PaneConversationProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useV4Conversation: () => ({
      layer: { acquire: () => ({ release: () => undefined }) },
      sendCommand: async (envelope: unknown) => {
        harness.commandEnvelopes.push(envelope);
        return { status: "accepted" };
      },
    }),
  };
});

vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => ({ snapshot: harness.conversationSnapshot }),
}));

function teamTab(): TeamSidePaneTab {
  return {
    id: "team-tab-1",
    type: "team",
    workspaceKey: "/ws",
    workspacePath: "/ws",
    parentSessionId: "lead-session-1",
  };
}

function stagedTeamFixture(): TeamProjectionState {
  return {
    teamId: "team-staged",
    status: "staged",
    members: [],
    board: { tasks: [], limit: 100 },
    mailboxTail: [],
    stagedDraft: {
      draftMembers: [{ memberName: "alice", profile: "general-purpose" }],
      draftTasks: [{ taskId: "t1", title: "t1 title", dependsOn: [] }],
      awaitingFeedback: false,
    },
  };
}

function renderTeamPane(
  onPrefillComposer?: (prefill: string, targetSessionId?: string | null) => void,
  onOpenMemberSession?: Parameters<typeof TeamSidePane>[0]["onOpenMemberSession"],
) {
  return render(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(TeamSidePane, {
        tab: teamTab(),
        focused: true,
        ...(onPrefillComposer === undefined ? {} : { onPrefillComposer }),
        ...(onOpenMemberSession === undefined ? {} : { onOpenMemberSession }),
      }),
    ),
  );
}

beforeEach(() => {
  harness.conversationSnapshot = undefined;
  harness.commandEnvelopes = [];
  // jsdom 无 ResizeObserver：TeamWorkspaceViews 会挂载 hidden 的协作关系图（TeamRelationGraph
  // 布局 effect 依赖 ResizeObserver），缺桩会抛 ReferenceError。
  window.ResizeObserver =
    window.ResizeObserver ??
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
});
afterEach(cleanup);

describe("TeamSidePane onPrefillComposer mount chains (缺口9)", () => {
  it("staged「回对话修改」：发 reviseTeamPlan 命令的同时把追问文案预填给挂载点回调（随行 lead 会话作目标）", () => {
    harness.conversationSnapshot = { team: stagedTeamFixture() };
    const prefillCalls: { prefill: string; targetSessionId?: string | null }[] = [];
    renderTeamPane((prefill, targetSessionId) => prefillCalls.push({ prefill, targetSessionId }));

    fireEvent.focus(screen.getByTestId("team-staged-revise-note"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    // 缺口9 消费门：目标会话随行（lead 会话），挂载点据此走 targetSessionId 定向插入。
    expect(prefillCalls).toEqual([{ prefill: "要调整什么？", targetSessionId: "lead-session-1" }]);
    expect(
      harness.commandEnvelopes.map((envelope) => (envelope as CommandEnvelope).type),
    ).toContain("reviseTeamPlan");
  });

  it("staged「回对话修改」带修改方向输入：note 随命令上 wire，也随行进预填文案", () => {
    harness.conversationSnapshot = { team: stagedTeamFixture() };
    const prefillCalls: { prefill: string; targetSessionId?: string | null }[] = [];
    renderTeamPane((prefill, targetSessionId) => prefillCalls.push({ prefill, targetSessionId }));

    fireEvent.change(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "成员名改成 alicia" },
    });
    fireEvent.focus(screen.getByTestId("team-staged-revise-note"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    expect(prefillCalls).toEqual([
      {
        prefill: "要调整什么？\n成员名改成 alicia",
        targetSessionId: "lead-session-1",
      },
    ]);
    const revise = harness.commandEnvelopes.find(
      (envelope) => (envelope as CommandEnvelope).type === "reviseTeamPlan",
    ) as CommandEnvelope;
    expect(revise.payload).toEqual({ note: "成员名改成 alicia" });
  });

  it("active 任务详情「在主会话中引用」：点击后以任务 id/标题格式化预填文案（同一目标会话）", () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    const prefillCalls: { prefill: string; targetSessionId?: string | null }[] = [];
    renderTeamPane((prefill, targetSessionId) => prefillCalls.push({ prefill, targetSessionId }));

    const taskRow = screen
      .getAllByTestId("team-overview-task")
      .find((node) => node.textContent?.includes("团队任务板"));
    expect(taskRow).toBeTruthy();
    fireEvent.click(taskRow!);
    fireEvent.click(screen.getByText("在主会话中引用"));
    expect(prefillCalls).toEqual([
      {
        prefill: "请检查任务 T3：团队任务板 的进度与依赖。",
        targetSessionId: "lead-session-1",
      },
    ]);
  });

  it("回调缺席 = 诚实降级：引用任务按钮不渲染（不出现点击无效的入口）", () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    renderTeamPane();

    const taskRow = screen
      .getAllByTestId("team-overview-task")
      .find((node) => node.textContent?.includes("团队任务板"));
    fireEvent.click(taskRow!);
    expect(screen.getByTestId("team-selection-details")).toBeTruthy();
    expect(screen.queryByText("在主会话中引用")).toBeNull();
  });
});

describe("TeamSidePane staged rename entry (缺口10)", () => {
  it("成员行改名：输入新名保存后上抛 setTeamMemberName 命令（memberName/newName）", () => {
    harness.conversationSnapshot = { team: stagedTeamFixture() };
    renderTeamPane();

    fireEvent.click(screen.getByTestId("team-staged-rename"));
    const input = screen.getByTestId("team-staged-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alicia" } });
    fireEvent.click(screen.getByTestId("team-staged-rename-apply"));

    const rename = harness.commandEnvelopes.find(
      (envelope) => (envelope as CommandEnvelope).type === "setTeamMemberName",
    ) as CommandEnvelope;
    expect(rename.payload).toEqual({ memberName: "alice", newName: "alicia" });
  });

  it("新名为空或未变化时保存按钮禁用（本地门；重名/长度由 wire schema 与 hub 草案校验）", () => {
    harness.conversationSnapshot = { team: stagedTeamFixture() };
    renderTeamPane();

    fireEvent.click(screen.getByTestId("team-staged-rename"));
    const input = screen.getByTestId("team-staged-rename-input") as HTMLInputElement;
    const apply = screen.getByTestId("team-staged-rename-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true); // 未变化
    fireEvent.change(input, { target: { value: "   " } });
    expect(apply.disabled).toBe(true); // 空白
    expect(harness.commandEnvelopes).toEqual([]);
  });
});

describe("TeamSidePane stop member entries (缺口10)", () => {
  beforeEach(() => {
    // 二次确认走 confirmDialogStore；测试直接注入「用户已确认」。
    useConfirmDialogStore.setState({ requestConfirmation: async () => true });
  });

  function openMemberDetails(name: string) {
    const memberRow = screen
      .getAllByTestId("team-overview-member")
      .find((node) => node.textContent?.includes(name));
    expect(memberRow).toBeTruthy();
    fireEvent.click(memberRow!);
  }

  it("成员详情「移除成员」：确认后上抛 stopTeamMember 命令（memberName）", async () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    renderTeamPane();

    openMemberDetails("Frontend");
    fireEvent.click(screen.getByTestId("team-member-stop-details"));

    await waitFor(() => {
      expect(
        harness.commandEnvelopes.some(
          (envelope) => (envelope as CommandEnvelope).type === "stopTeamMember",
        ),
      ).toBe(true);
    });
    const stop = harness.commandEnvelopes.find(
      (envelope) => (envelope as CommandEnvelope).type === "stopTeamMember",
    ) as CommandEnvelope;
    expect(stop.payload).toEqual({ memberName: "Frontend" });
  });

  it("下钻头部「移除成员」：与成员详情同一命令与确认文案", async () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    renderTeamPane();

    openMemberDetails("Frontend");
    fireEvent.click(screen.getByTestId("team-transcript-open")); // 「查看成员」→ 下钻
    fireEvent.click(screen.getByTestId("team-member-stop"));

    await waitFor(() => {
      expect(
        harness.commandEnvelopes.some(
          (envelope) => (envelope as CommandEnvelope).type === "stopTeamMember",
        ),
      ).toBe(true);
    });
    const stop = harness.commandEnvelopes.find(
      (envelope) => (envelope as CommandEnvelope).type === "stopTeamMember",
    ) as CommandEnvelope;
    expect(stop.payload).toEqual({ memberName: "Frontend" });
  });

  it("确认被取消时不上抛命令（破坏性动作必须显式确认）", async () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    useConfirmDialogStore.setState({ requestConfirmation: async () => false });
    renderTeamPane();

    openMemberDetails("Frontend");
    fireEvent.click(screen.getByTestId("team-member-stop-details"));
    await Promise.resolve();
    await waitFor(() => {
      expect(screen.getByTestId("team-member-stop-details")).toBeTruthy();
    });
    expect(
      harness.commandEnvelopes.some(
        (envelope) => (envelope as CommandEnvelope).type === "stopTeamMember",
      ),
    ).toBe(false);
  });
});

describe("成员下钻独立 tab（specs/agents-team.md §10 增补四）", () => {
  // 与本文件既有用例同一导航：overview 成员行 → 详情「查看成员」（team-transcript-open
  // 走 handleMemberDrill 同一通道）。
  it("通道在场：查看成员 → onOpenMemberSession 收到 scoped 请求（lead 会话 + 已知 childSessionId），不进本地钻", async () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    const calls: { memberName: string; parentSessionId: string; childSessionId?: string }[] = [];
    renderTeamPane(undefined, (member) => {
      calls.push({
        memberName: member.memberName,
        parentSessionId: member.parentSessionId,
        ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
      });
    });
    const memberRow = screen
      .getAllByTestId("team-overview-member")
      .find((node) => node.textContent?.includes("Frontend"));
    expect(memberRow).toBeTruthy();
    fireEvent.click(memberRow!);
    fireEvent.click(screen.getByTestId("team-transcript-open"));
    expect(calls).toEqual([
      { memberName: "Frontend", parentSessionId: "lead-session-1", childSessionId: "child-a" },
    ]);
    expect(screen.queryByTestId("team-member-back")).toBeNull();
  });

  it("通道缺席（手机远控回退）：查看成员进入本地钻（back 按钮在场）", async () => {
    harness.conversationSnapshot = { team: createTeamFixture() };
    renderTeamPane();
    const memberRow = screen
      .getAllByTestId("team-overview-member")
      .find((node) => node.textContent?.includes("Frontend"));
    expect(memberRow).toBeTruthy();
    fireEvent.click(memberRow!);
    fireEvent.click(screen.getByTestId("team-transcript-open"));
    expect(screen.getByTestId("team-member-back")).toBeTruthy();
  });
});
