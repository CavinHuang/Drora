// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import type { CommandAck, CommandEnvelope } from "@drora/shared/drora-protocol-v4";
import { TeamSidePane } from "@/app-shell/TeamSidePane.js";
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
    await waitFor(() => expect(screen.queryByTestId("team-staged-command-error")).toBeNull());
  });

  it("revise 被拒 → alert 出现且 revamp note 仍随信封携带（note 闭环不受影响）", async () => {
    const { sendCommand, envelopes } = makeSendCommand([
      { status: "failed", reasonCode: "fault.command.teamRejected.team_lead_only" },
    ]);
    render(
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamConversationSummary
          team={STAGED_TEAM}
          target={{ workspacePath: "/repo", parentSessionId: "lead_1" }}
          connection={{ sessionId: "lead_1", sendCommand }}
        />
      </DroraIntlProvider>,
    );

    fireEvent.input(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "把任务拆细一点" },
    });
    fireEvent.click(screen.getByTestId("team-staged-revise"));
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
      await waitFor(() => expect(screen.queryByTestId("team-staged-command-error")).toBeNull(), {
        timeout: 5000,
      });
    },
  );
});
