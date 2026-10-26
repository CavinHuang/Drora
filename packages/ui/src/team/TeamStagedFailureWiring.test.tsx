// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import type { CommandAck, CommandEnvelope } from "@drora/shared/drora-protocol-v4";
import { TeamSidePane } from "@/app-shell/TeamSidePane.js";
import { TeamApprovalDock } from "./TeamApprovalDock.js";
import { TeamConversationSummary } from "./TeamConversationSummary.js";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";

/**
 * 三动作失败出显的两挂载点接线（specs/agents-team.md §10 呈现规则4 + §15 第2条）：
 * - 会话流卡（TeamConversationSummary staged 分支）与侧栏（TeamSidePane → TeamPanel →
 *   TeamStagedEditor）都把 approveTeamPlan/reviseTeamPlan/abandonTeamPlan 的
 *   TeamCommandOutcome 消费成编辑器内联 role=alert；
 * - 任一动作再次发起时清除；
 * - 借形不借管线：sendCommand stub 断言命令信封仍走单一通道（type/sessionId 不变），
 *   hub/wire 零结构改动。
 */

const STAGED_TEAM: TeamProjectionState = {
  teamId: "team_1",
  name: "竞品调研队",
  status: "staged",
  members: [],
  board: { tasks: [], limit: 100 },
  mailboxTail: [],
  stagedDraft: {
    draftMembers: [{ memberName: "alice" }],
    draftTasks: [{ taskId: "task_1", title: "调研定价页", dependsOn: [] }],
    awaitingFeedback: false,
  },
};

const NOT_PRESENT = "fault.command.teamRejected.team_not_present";

/** abandon 收敛后的投影（§19 契约 1）：archived 且 stagedDraft 键缺席——生产链由
 * bootstrap product-projection-team-archived.test.ts 锁定，此处是 UI 端收敛断言的入参。 */
const ARCHIVED_TEAM: TeamProjectionState = {
  teamId: "team_1",
  name: "竞品调研队",
  status: "archived",
  members: [],
  board: { tasks: [], limit: 100 },
  mailboxTail: [],
};

/** v4 会话上下文与投影的最小 stub：TeamSidePane 的数据选择器只有一条（父会话投影）。 */
const mocks = vi.hoisted(() => {
  const sendCommand = vi.fn<(envelope: CommandEnvelope) => Promise<CommandAck>>();
  const team = { current: undefined as TeamProjectionState | undefined };
  // layer/snapshot 引用稳定化：mock 每次渲染返回新字面量会让依赖它的 effect 反复重跑。
  const layer = { acquire: () => ({ release() {} }) };
  return { sendCommand, team, layer };
});

// vi.mock 必须在模块顶层（hoist 后先于被测模块求值执行）。
vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({
    layer: mocks.layer,
    sendCommand: mocks.sendCommand,
  }),
  V4PaneConversationProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => {
    const snapshot = mocks.team.current === undefined ? undefined : { team: mocks.team.current };
    return { snapshot };
  },
}));
// abandon 有二次确认门（TeamStagedEditor.handleAbandon → useConfirmDialog），确认宿主
// ConfirmDialogHost 不在测试树内——mock 为自动确认，让用例直达「确认 → ACK → 投影
// 收敛」链（§19 契约 1 UI 端）；其余用例不走 abandon，不受影响。
vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => () => Promise.resolve(true),
}));

/** 可编程 sendCommand stub：按调用次序返回预设 ACK，并捕获信封断言单一通道。 */
function makeSendCommand(acks: Array<Partial<CommandAck>>): {
  sendCommand: (envelope: CommandEnvelope) => Promise<CommandAck>;
  envelopes: CommandEnvelope[];
} {
  const envelopes: CommandEnvelope[] = [];
  let call = 0;
  const sendCommand = (envelope: CommandEnvelope): Promise<CommandAck> => {
    envelopes.push(envelope);
    const patch = acks[Math.min(call, acks.length - 1)] ?? {};
    call += 1;
    return Promise.resolve({
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: 1,
      ...patch,
    } as CommandAck);
  };
  return { sendCommand, envelopes };
}

afterEach(cleanup);

describe("会话流卡挂载点（TeamConversationSummary staged 分支）", () => {
  it("approve 被拒 → 内联 alert 出现；再次发起（成功族 ACK）→ 清除", async () => {
    // 首 call 返回 failed（拒出 alert），后续 call 返回 accepted（成功族，验证清除）。
    const { sendCommand, envelopes } = makeSendCommand([
      { status: "failed", reasonCode: NOT_PRESENT },
      { status: "accepted" },
    ]);

    function Harness(): ReactNode {
      // key 换队重挂载的容器形态照实挂载；connection 是唯一命令通道。
      return (
        <DroraIntlProvider initialLocale="zh-CN">
          <TeamConversationSummary
            team={STAGED_TEAM}
            target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
            connection={{ sessionId: "lead_1", sendCommand }}
          />
        </DroraIntlProvider>
      );
    }
    render(<Harness />);

    const approve = screen.getByTestId("team-staged-approve");
    fireEvent.click(approve);
    const alert = await screen.findByTestId("team-staged-command-error");
    expect(alert.getAttribute("role")).toBe("alert");
    const template = zhCN["team.stagedEditor.failure.line"] ?? "";
    expect(alert.textContent).toBe(
      template
        .replace("{action}", zhCN["team.stagedEditor.approve"] ?? "")
        .replace("{reason}", zhCN["team.stagedEditor.failure.teamNotPresent"] ?? ""),
    );

    // 命令单一通道不变：信封类型/会话与接线前一致（借形不借管线）。
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.type).toBe("approveTeamPlan");
    expect(envelopes[0]?.sessionId).toBe("lead_1");

    // 下次任一动作发起时清除：第二击用 revise（abandon 有二次确认门，确认宿主不在
    // 测试树内；「任一动作都清除」已由 approve→revise 异动作组合覆盖）。
    fireEvent.click(screen.getByTestId("team-staged-revise"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await waitFor(() => expect(screen.queryByTestId("team-staged-command-error")).toBeNull());
  });

  it("revise 被拒 → alert 出现且 revamp note 仍随信封携带（note 闭环不受影响）", async () => {
    const { sendCommand, envelopes } = makeSendCommand([
      { status: "failed", reasonCode: "fault.command.teamRejected.team_lead_only" },
    ]);
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        {/* 2026-10-23 三发起面预填通道（spec §15 第4条）：note 输入只在预填回调在场的
            挂载面出显——本用例锁「接线面」的 note 随信封行为，回调为预填断言 stub。 */}
        <TeamConversationSummary
          team={STAGED_TEAM}
          target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
          connection={{ sessionId: "lead_1", sendCommand }}
          onPrefillComposer={() => {}}
        />
      </DroraIntlProvider>,
    );

    fireEvent.input(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "把任务拆细一点" },
    });
    fireEvent.click(screen.getByTestId("team-staged-revise"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await screen.findByTestId("team-staged-command-error");
    expect(envelopes[0]?.type).toBe("reviseTeamPlan");
    expect(envelopes[0]?.payload).toEqual({ note: "把任务拆细一点" });
  });
});

describe("侧栏挂载点（TeamSidePane → TeamPanel）", () => {
  it(
    "侧栏 approve 被拒 → TeamPanel 内的编辑器出 alert；再次发起清除",
    // 静态 import 的 TeamSidePane 依赖树在整目录并发时加载偏慢，给足用例预算。
    { timeout: 20000 },
    async () => {
      mocks.team.current = STAGED_TEAM;
      mocks.sendCommand
        .mockResolvedValueOnce({
          commandId: "cmd_1",
          status: "failed",
          reasonCode: "fault.command.teamHubUnavailable",
          revisionAtDecision: 1,
        } as CommandAck)
        .mockResolvedValue({
          commandId: "cmd_2",
          status: "accepted",
          revisionAtDecision: 1,
        } as CommandAck);

      render(
        <DroraIntlProvider initialLocale="zh-CN">
          <TeamSidePane
            tab={{
              id: "tab_1",
              type: "team",
              workspaceKey: "k",
              workspacePath: "/repo",
              parentSessionId: "lead_1",
            }}
            focused
          />
        </DroraIntlProvider>,
      );

      fireEvent.click(screen.getByTestId("team-staged-approve"));
      // 整目录并发跑时 jsdom 负载高，默认 1s 等待窗口在边缘抖动——放宽到 5s。
      const alert = await screen.findByTestId("team-staged-command-error", undefined, {
        timeout: 5000,
      });
      expect(alert.getAttribute("role")).toBe("alert");
      const template = zhCN["team.stagedEditor.failure.line"] ?? "";
      expect(alert.textContent).toBe(
        template
          .replace("{action}", zhCN["team.stagedEditor.approve"] ?? "")
          .replace("{reason}", zhCN["team.stagedEditor.failure.hubUnavailable"] ?? ""),
      );

      fireEvent.click(screen.getByTestId("team-staged-revise"));
      fireEvent.click(screen.getByTestId("team-staged-confirm"));
      await waitFor(() => expect(screen.queryByTestId("team-staged-command-error")).toBeNull(), {
        timeout: 5000,
      });
    },
  );
});

describe("abandon 成功收敛（specs/agents-team.md §19 契约 1 UI 端）", () => {
  it("会话流卡：abandon 确认后 ACK accepted，投影收敛 archived → 审批面消失且零失败出显", async () => {
    const { sendCommand, envelopes } = makeSendCommand([{ status: "accepted" }]);
    const harness = (team: TeamProjectionState): ReactNode => (
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamConversationSummary
          team={team}
          target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
          connection={{ sessionId: "lead_1", sendCommand }}
        />
      </DroraIntlProvider>
    );
    const { rerender } = render(harness(STAGED_TEAM));
    expect(screen.getByTestId("team-staged-editor")).toBeDefined();

    // 确认宿主已 mock 为自动确认 → abandon 信封照走单一通道。
    fireEvent.click(screen.getByTestId("team-staged-abandon"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await waitFor(() => expect(envelopes).toHaveLength(1));
    expect(envelopes[0]?.type).toBe("abandonTeamPlan");
    expect(envelopes[0]?.sessionId).toBe("lead_1");

    // ACK accepted 后生产链把投影翻 archived（hub notifyChange → TeamStateChanged →
    // delta，投影半边由 bootstrap product-projection-team-archived.test.ts 锁定）；
    // UI 端收敛断言：archived 投影下 dock 同源的 staged 分支不再渲染，且不残留
    // 误导性失败出显。
    rerender(harness(ARCHIVED_TEAM));
    expect(screen.queryByTestId("team-staged-editor")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("team-staged-command-error")).toBeNull());
  });

  it(
    "侧栏：abandon ACK 后投影收敛 archived → TeamPanel 审批面消失",
    // 静态 import 的 TeamSidePane 依赖树在整目录并发时加载偏慢，给足用例预算（同上）。
    { timeout: 20000 },
    async () => {
      mocks.team.current = STAGED_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand.mockResolvedValue({
        commandId: "cmd_abandon",
        status: "accepted",
        revisionAtDecision: 1,
      } as CommandAck);

      // 每次渲染构造新元素（新 tab 引用）：TeamSidePane props 相等时 React 会 bailout，
      // mock 投影翻键将不被消费——新引用强制重跑 hook，模拟 delta 推进后的重渲染。
      const renderPane = (): ReactNode => (
        <DroraIntlProvider initialLocale="zh-CN">
          <TeamSidePane
            tab={{
              id: "tab_1",
              type: "team",
              workspaceKey: "k",
              workspacePath: "/repo",
              parentSessionId: "lead_1",
            }}
            focused
          />
        </DroraIntlProvider>
      );
      const { rerender } = render(renderPane());
      await screen.findByTestId("team-staged-editor", undefined, { timeout: 5000 });

      fireEvent.click(screen.getByTestId("team-staged-abandon"));
      fireEvent.click(screen.getByTestId("team-staged-confirm"));
      // ACK accepted → delta 把投影翻 archived：mock 投影翻键后审批面不再渲染。
      mocks.team.current = ARCHIVED_TEAM;
      rerender(renderPane());
      await waitFor(() => expect(screen.queryByTestId("team-staged-editor")).toBeNull(), {
        timeout: 5000,
      });
      expect(screen.queryByTestId("team-staged-command-error")).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// §19 契约 5 扩圈（2026-10-23）：五命令失败出显 + composer 草稿保留。
// halt/resume/stop 的 TeamCommandOutcome 被拒出显于面板动作区顶部 role=alert；
// sendTeamMessage 经 composer 消费 outcome——ok 才清草稿，被拒/传输异常草稿保留原文。
// ---------------------------------------------------------------------------

/** active 态投影：halt/resume 动作区与成员卡（下钻 composer）的入参。 */
const ACTIVE_TEAM: TeamProjectionState = {
  teamId: "team_1",
  name: "竞品调研队",
  status: "active",
  members: [
    { agentId: "agent_alice", memberName: "alice", profileColor: "#4a90d9", state: "working" },
  ],
  board: { tasks: [], limit: 100 },
  mailboxTail: [],
};

/** halted 态投影：resume 动作区（理由必填）的入参（§19 契约 5 面板四命令之 resume）。 */
const HALTED_TEAM: TeamProjectionState = {
  teamId: "team_1",
  name: "竞品调研队",
  status: "halted",
  members: [
    { agentId: "agent_alice", memberName: "alice", profileColor: "#4a90d9", state: "working" },
  ],
  board: { tasks: [], limit: 100 },
  mailboxTail: [],
};

function renderSidePane(): ReactNode {
  return (
    <DroraIntlProvider initialLocale="zh-CN">
      <TeamSidePane
        tab={{
          id: "tab_1",
          type: "team",
          workspaceKey: "k",
          workspacePath: "/repo",
          parentSessionId: "lead_1",
        }}
        focused
      />
    </DroraIntlProvider>
  );
}

describe("§19 契约 5：面板命令失败出显（halt/resume/stop）", () => {
  it(
    "halt 被拒（未知码）→ 面板动作区 role=alert 出兜底文案；再次发起（accepted）清除",
    { timeout: 20000 },
    async () => {
      mocks.team.current = ACTIVE_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand
        .mockResolvedValueOnce({
          commandId: "cmd_h1",
          status: "failed",
          reasonCode: "fault.command.teamRejected.some_future_code",
          revisionAtDecision: 1,
        } as CommandAck)
        .mockResolvedValue({
          commandId: "cmd_h2",
          status: "accepted",
          revisionAtDecision: 1,
        } as CommandAck);

      render(renderSidePane());
      fireEvent.click(await screen.findByTestId("team-halt", undefined, { timeout: 5000 }));
      const alert = await screen.findByTestId("team-panel-command-error", undefined, {
        timeout: 5000,
      });
      expect(alert.getAttribute("role")).toBe("alert");
      const template = zhCN["team.panel.commandFailure.line"] ?? "";
      expect(alert.textContent).toBe(
        template
          .replace("{action}", zhCN["team.panel.action.halt"] ?? "")
          .replace("{reason}", zhCN["team.panel.commandFailure.fallback"] ?? ""),
      );

      // 再次发起：ACK accepted → 清除（挂载点在任一面板命令发起时置空）。
      fireEvent.click(screen.getByTestId("team-halt"));
      await waitFor(() => expect(screen.queryByTestId("team-panel-command-error")).toBeNull(), {
        timeout: 5000,
      });
    },
  );

  it(
    "下钻头部移除成员被拒 → 同一面板 alert 出显（stop 也在消费面内）",
    { timeout: 20000 },
    async () => {
      mocks.team.current = ACTIVE_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand.mockResolvedValue({
        commandId: "cmd_s1",
        status: "failed",
        reasonCode: "fault.command.teamRejected.team_not_present",
        revisionAtDecision: 1,
      } as CommandAck);

      render(renderSidePane());
      // 成员列表在 TeamOverview 的任务板 toggle 之后 → 先开板再点成员卡下钻
      // （成员无 childSessionId → not-started 占位 + composer）。
      fireEvent.click(await screen.findByTestId("team-board-toggle", undefined, { timeout: 5000 }));
      fireEvent.click(await screen.findByTestId("team-member-card", undefined, { timeout: 5000 }));
      // 下钻头部「移除成员」→ 确认宿主已 mock 自动确认 → stopTeamMember 被拒。
      fireEvent.click(screen.getByTestId("team-member-stop"));
      const alert = await screen.findByTestId("team-panel-command-error", undefined, {
        timeout: 5000,
      });
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.textContent).toContain(zhCN["team.panel.action.stop"] ?? "");
    },
  );

  it(
    "resume 被拒（已知码 team_not_present）→ 面板动作区 role=alert 出映射文案",
    { timeout: 20000 },
    async () => {
      mocks.team.current = HALTED_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand.mockResolvedValue({
        commandId: "cmd_r1",
        status: "failed",
        reasonCode: "fault.command.teamRejected.team_not_present",
        revisionAtDecision: 1,
      } as CommandAck);

      render(renderSidePane());
      // halted 态动作区只有 resume（理由必填，空理由被 UI 门禁用）。
      const reason = await screen.findByTestId("team-resume-reason", undefined, { timeout: 5000 });
      fireEvent.input(reason, { target: { value: "恢复推进" } });
      fireEvent.click(screen.getByTestId("team-resume"));
      const alert = await screen.findByTestId("team-panel-command-error", undefined, {
        timeout: 5000,
      });
      expect(alert.getAttribute("role")).toBe("alert");
      const template = zhCN["team.panel.commandFailure.line"] ?? "";
      expect(alert.textContent).toBe(
        template
          .replace("{action}", zhCN["team.panel.action.resume"] ?? "")
          .replace("{reason}", zhCN["team.stagedEditor.failure.teamNotPresent"] ?? ""),
      );
    },
  );
});

describe("§19 契约 5：改名失败并入 staged 编辑器失败行（rename）", () => {
  it(
    "改名被拒（name_redirect）→ 编辑器 role=alert 出「改名 + 映射文案」；信封仍走单一通道",
    { timeout: 20000 },
    async () => {
      mocks.team.current = STAGED_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand.mockResolvedValue({
        commandId: "cmd_n1",
        status: "failed",
        reasonCode: "fault.command.teamRejected.name_redirect",
        revisionAtDecision: 1,
      } as CommandAck);

      render(renderSidePane());
      // staged 编辑器成员行铅笔 → 输入新名 → 确认（ready = 非空且异于原名）。
      fireEvent.click(
        await screen.findByTestId("team-staged-editor", undefined, { timeout: 5000 }),
      );
      fireEvent.click(screen.getAllByTestId("team-staged-rename")[0]!);
      fireEvent.input(screen.getByTestId("team-staged-rename-input"), {
        target: { value: "alice2" },
      });
      fireEvent.click(screen.getByTestId("team-staged-rename-apply"));

      const alert = await screen.findByTestId("team-staged-command-error", undefined, {
        timeout: 5000,
      });
      expect(alert.getAttribute("role")).toBe("alert");
      const template = zhCN["team.stagedEditor.failure.line"] ?? "";
      expect(alert.textContent).toBe(
        template
          .replace("{action}", zhCN["team.stagedEditor.rename"] ?? "")
          .replace("{reason}", zhCN["team.commandFailure.nameRedirect"] ?? ""),
      );
      // 信封仍走单一通道（setTeamMemberName，payload 完整）。
      expect(mocks.sendCommand.mock.calls[0]?.[0]?.type).toBe("setTeamMemberName");
      expect(mocks.sendCommand.mock.calls[0]?.[0]?.sessionId).toBe("lead_1");
    },
  );
});

describe("§19 契约 5：composer 草稿永不丢（sendTeamMessage outcome 消费）", () => {
  it("被拒（team_halted）→ role=alert 出映射文案 + 输入保留原文", { timeout: 20000 }, async () => {
    mocks.team.current = ACTIVE_TEAM;
    mocks.sendCommand.mockReset();
    mocks.sendCommand.mockResolvedValue({
      commandId: "cmd_m1",
      status: "failed",
      reasonCode: "fault.command.teamRejected.team_halted",
      revisionAtDecision: 1,
    } as CommandAck);

    render(renderSidePane());
    fireEvent.click(await screen.findByTestId("team-board-toggle", undefined, { timeout: 5000 }));
    fireEvent.click(await screen.findByTestId("team-member-card", undefined, { timeout: 5000 }));
    const input = (await screen.findByTestId("team-member-message-input", undefined, {
      timeout: 5000,
    })) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "帮我看看定价页结论" } });
    fireEvent.click(screen.getByTestId("team-member-message-send"));

    const alert = await screen.findByTestId("team-member-message-error", undefined, {
      timeout: 5000,
    });
    expect(alert.getAttribute("role")).toBe("alert");
    const template = zhCN["team.memberPane.sendFailed.line"] ?? "";
    expect(alert.textContent).toBe(
      template.replace("{reason}", zhCN["team.commandFailure.teamHalted"] ?? ""),
    );
    // 草稿永不丢（§19 契约 5 不变量）：输入保留原文。
    expect((screen.getByTestId("team-member-message-input") as HTMLInputElement).value).toBe(
      "帮我看看定价页结论",
    );
  });

  it(
    "成功（accepted）→ 草稿清空、无失败出显；传输异常（sendCommand 抛错）→ transport 文案 + 草稿保留",
    { timeout: 20000 },
    async () => {
      mocks.team.current = ACTIVE_TEAM;
      mocks.sendCommand.mockReset();
      mocks.sendCommand
        .mockResolvedValueOnce({
          commandId: "cmd_m2",
          status: "accepted",
          revisionAtDecision: 1,
        } as CommandAck)
        .mockRejectedValueOnce(new Error("transport down"));

      render(renderSidePane());
      fireEvent.click(await screen.findByTestId("team-board-toggle", undefined, { timeout: 5000 }));
      fireEvent.click(await screen.findByTestId("team-member-card", undefined, { timeout: 5000 }));
      const input = (await screen.findByTestId("team-member-message-input", undefined, {
        timeout: 5000,
      })) as HTMLInputElement;

      // 成功：清空。
      fireEvent.input(input, { target: { value: "第一条" } });
      fireEvent.click(screen.getByTestId("team-member-message-send"));
      await waitFor(
        () =>
          expect((screen.getByTestId("team-member-message-input") as HTMLInputElement).value).toBe(
            "",
          ),
        { timeout: 5000 },
      );
      expect(screen.queryByTestId("team-member-message-error")).toBeNull();

      // 传输异常：transport 文案 + 草稿保留。
      fireEvent.input(input, { target: { value: "第二条" } });
      fireEvent.click(screen.getByTestId("team-member-message-send"));
      const alert = await screen.findByTestId("team-member-message-error", undefined, {
        timeout: 5000,
      });
      expect(alert.textContent).toContain(zhCN["team.memberPane.sendFailed.transport"] ?? "");
      expect((screen.getByTestId("team-member-message-input") as HTMLInputElement).value).toBe(
        "第二条",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// 三发起面 revise note 预填通道（spec §15 第4条 2026-10-23 扩圈）：dock 与摘要卡照
// 侧栏先例（TeamSidePane handlePanelCommand）经 TeamStagedEditorConnected 注入
// onPrefillComposer——revise 携 note 时预填回调收到「追问文案 + note」且定向 lead
// 会话（v1 边界：hub 不消费 wire note，修改方向经对话到达 lead）；无回调挂载面
// （挂载点未注入回调，如远端 timeline 摘要卡）隐藏 note 输入并出「走对话」提示，
// 禁止 note 静默丢弃。
// ---------------------------------------------------------------------------

/** 预填回调实参捕获器：断言追问+note 文案与 targetSessionId 定向。 */
function makePrefillCapture(): {
  onPrefillComposer: (prefill: string, targetSessionId?: string | null) => void;
  calls: Array<{ prefill: string; targetSessionId?: string | null }>;
} {
  const calls: Array<{ prefill: string; targetSessionId?: string | null }> = [];
  return {
    calls,
    onPrefillComposer: (prefill, targetSessionId) => {
      calls.push({ prefill, targetSessionId });
    },
  };
}

describe("三发起面预填通道（spec §15 第4条）：预填接线面", () => {
  it("dock 挂载：revise 携 note → 预填回调收到追问+note 且目标 lead 会话；信封仍走单一通道", async () => {
    const { sendCommand, envelopes } = makeSendCommand([{ status: "accepted" }]);
    const prefill = makePrefillCapture();
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamApprovalDock
          team={STAGED_TEAM}
          sessionId="lead_1"
          sendCommand={sendCommand}
          onPrefillComposer={prefill.onPrefillComposer}
        />
      </DroraIntlProvider>,
    );

    fireEvent.input(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "砍掉 bob" },
    });
    fireEvent.click(screen.getByTestId("team-staged-revise"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await waitFor(() => expect(envelopes).toHaveLength(1));
    // 命令单一通道不变（信封携带 note，hub v1 边界内照常上 wire）。
    expect(envelopes[0]?.type).toBe("reviseTeamPlan");
    expect(envelopes[0]?.sessionId).toBe("lead_1");
    expect(envelopes[0]?.payload).toEqual({ note: "砍掉 bob" });
    // 预填通道（note 的真正落地面）：追问文案 + 换行 + note，定向 lead 会话。
    expect(prefill.calls).toHaveLength(1);
    expect(prefill.calls[0]?.targetSessionId).toBe("lead_1");
    expect(prefill.calls[0]?.prefill).toBe(`${zhCN["team.revise.prefillPrompt"] ?? ""}\n砍掉 bob`);
  });

  it("摘要卡挂载（非抑制内联形态）：revise 携 note → 同一预填通道定向 lead 会话", async () => {
    const { sendCommand, envelopes } = makeSendCommand([{ status: "accepted" }]);
    const prefill = makePrefillCapture();
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamConversationSummary
          team={STAGED_TEAM}
          target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
          connection={{ sessionId: "lead_1", sendCommand }}
          onPrefillComposer={prefill.onPrefillComposer}
        />
      </DroraIntlProvider>,
    );

    fireEvent.input(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "把 alice 的路由换成 deepseek" },
    });
    fireEvent.click(screen.getByTestId("team-staged-revise"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await waitFor(() => expect(envelopes).toHaveLength(1));
    expect(envelopes[0]?.type).toBe("reviseTeamPlan");
    expect(envelopes[0]?.payload).toEqual({ note: "把 alice 的路由换成 deepseek" });
    expect(prefill.calls).toHaveLength(1);
    expect(prefill.calls[0]?.targetSessionId).toBe("lead_1");
    expect(prefill.calls[0]?.prefill).toBe(
      `${zhCN["team.revise.prefillPrompt"] ?? ""}\n把 alice 的路由换成 deepseek`,
    );
  });
});

describe("三发起面预填通道（spec §15 第4条）：无回调挂载面", () => {
  it("未注入 onPrefillComposer（远端 timeline 摘要卡形态）→ note 输入隐藏 + 出「走对话」提示", () => {
    const { sendCommand } = makeSendCommand([{ status: "accepted" }]);
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamConversationSummary
          team={STAGED_TEAM}
          target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
          connection={{ sessionId: "lead_1", sendCommand }}
        />
      </DroraIntlProvider>,
    );

    // 编辑器仍在（三动作可用、approve/abandon 不受影响），但 note 输入不出显——
    // 输入了也只会随命令上 wire 而 hub v1 不消费（静默丢弃），故隐藏并提示走对话。
    expect(screen.getByTestId("team-staged-editor")).toBeDefined();
    expect(screen.queryByTestId("team-staged-revise-note")).toBeNull();
    expect(screen.getByTestId("team-staged-note-suppressed").textContent).toBe(
      zhCN["team.stagedEditor.noteSuppressedHint"] ?? "",
    );
  });

  it("dock 未注入回调同形（TeamStagedEditorConnected 单一裁决）：note 输入隐藏 + 提示在册", () => {
    const { sendCommand } = makeSendCommand([{ status: "accepted" }]);
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamApprovalDock team={STAGED_TEAM} sessionId="lead_1" sendCommand={sendCommand} />
      </DroraIntlProvider>,
    );
    expect(screen.queryByTestId("team-staged-revise-note")).toBeNull();
    expect(screen.getByTestId("team-staged-note-suppressed")).toBeDefined();
  });
});
