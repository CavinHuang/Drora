// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TeamApprovalDock } from "../src/team/TeamApprovalDock.js";

// §10 呈现规则修订（2026-10-23）：桌面端 staged 审批迁入 timeline bottom dock——
// dock 渲染编辑器三动作并经 team/commands.ts 单一通道发送；staged 无草案时不渲染。
// §19 契约 6（2026-10-23）：role=status/aria-live 播报 + 三动作在途纪律；改名入口
// 一体适用（§10「审批面挂载两处、呈现规则一体适用」）。

afterEach(cleanup);

function stagedTeam(): TeamProjectionState {
  return {
    teamId: "team_probe",
    status: "staged",
    members: [
      {
        agentId: "pending_alice",
        memberName: "alice",
        profile: "researcher",
        state: "spawning",
      },
    ],
    board: { tasks: [], limit: 100 },
    mailboxTail: [],
    stagedDraft: {
      draftMembers: [{ memberName: "alice", profile: "researcher" }],
      draftTasks: [{ taskId: "t1", title: "t1", dependsOn: [] }],
      awaitingFeedback: false,
    },
  } as unknown as TeamProjectionState;
}

describe("TeamApprovalDock", () => {
  it("renders the dock chrome with the staged editor and sends approve via the command channel", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      ok: true,
      ack: { type: "ack", commandId: "c1", revisionAtDecision: 1 },
    });
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, {
          team: stagedTeam(),
          sessionId: "lead_s1",
          sendCommand,
        }),
      ),
    );

    expect(screen.getByTestId("team-approval-dock")).toBeDefined();
    expect(screen.getByText("团队计划待确认")).toBeDefined();
    expect(screen.getByTestId("team-staged-editor")).toBeDefined();
    expect(screen.getByTestId("team-staged-approve")).toBeDefined();

    fireEvent.click(screen.getByTestId("team-staged-approve"));
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(sendCommand.mock.calls[0]?.[0])).toContain("approveTeamPlan");
    });
  });

  it("renders nothing when the staged draft view is unavailable", () => {
    const team = stagedTeam();
    delete (team as Partial<TeamProjectionState>).stagedDraft;
    const { container } = render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, { team, sessionId: "lead_s1", sendCommand: vi.fn() }),
      ),
    );
    expect(container.querySelector('[data-testid="team-approval-dock"]')).toBeNull();
  });

  it("exposes role=status aria-live on the dock container (§19 契约 6 可达性半边)", () => {
    const sendCommand = vi.fn().mockResolvedValue({
      commandId: "c1",
      status: "accepted",
      revisionAtDecision: 1,
    });
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, {
          team: stagedTeam(),
          sessionId: "lead_s1",
          sendCommand,
        }),
      ),
    );
    const dock = screen.getByTestId("team-approval-dock");
    expect(dock.getAttribute("role")).toBe("status");
    expect(dock.getAttribute("aria-live")).toBe("polite");
  });

  it("approve 在途：按钮全禁用 + 等待文案；结算后恢复（§19 契约 6）", async () => {
    let resolveAck: (ack: {
      commandId: string;
      status: string;
      revisionAtDecision: number;
    }) => void = () => {};
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    );
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, {
          team: stagedTeam(),
          sessionId: "lead_s1",
          sendCommand,
        }),
      ),
    );
    const approve = () => screen.getByTestId("team-staged-approve") as HTMLButtonElement;
    fireEvent.click(approve());
    expect(sendCommand).toHaveBeenCalledTimes(1);
    // 在途（§18 附裁后）：选项行全禁用 + 确认钮禁用并出等待文案。
    await vi.waitFor(() => {
      expect(approve().disabled).toBe(true);
    });
    expect((screen.getByTestId("team-staged-revise") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("team-staged-abandon") as HTMLButtonElement).disabled).toBe(true);
    const confirm = () => screen.getByTestId("team-staged-confirm") as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    expect(confirm().textContent).toContain("正在启动成员");
    // 结算（accepted）：在途清空，按钮恢复。
    resolveAck({ commandId: "c1", status: "accepted", revisionAtDecision: 1 });
    await vi.waitFor(() => {
      expect(approve().disabled).toBe(false);
    });
    expect(confirm().disabled).toBe(false);
    expect(confirm().textContent).toContain("确认");
    expect(screen.queryByTestId("team-staged-command-error")).toBeNull();
  });

  it("成员权限选择（§10 增补三）：选择 yolo 后批准信封携带 permissionMode=yolo", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      commandId: "c9",
      status: "accepted",
      revisionAtDecision: 1,
    });
    const team = stagedTeam();
    (team as { permissionMode?: string }).permissionMode = "build";
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, { team, sessionId: "lead_s1", sendCommand }),
      ),
    );
    const chip = screen.getByTestId("team-staged-member-mode");
    fireEvent.keyDown(chip, { key: "Enter" });
    const item = await screen.findByTestId("team-staged-member-mode-yolo");
    fireEvent.click(item);
    fireEvent.click(screen.getByTestId("team-staged-approve"));
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(sendCommand.mock.calls[0]?.[0])).toContain('"permissionMode":"yolo"');
    });
  });

  it("dock 成员行提供改名入口（§10 呈现规则一体适用；改名走 setTeamMemberName 单一通道）", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      commandId: "c1",
      status: "accepted",
      revisionAtDecision: 1,
    });
    render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(TeamApprovalDock, {
          team: stagedTeam(),
          sessionId: "lead_s1",
          sendCommand,
        }),
      ),
    );
    fireEvent.click(screen.getByTestId("team-staged-rename"));
    const input = screen.getByTestId("team-staged-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alice2" } });
    fireEvent.click(screen.getByTestId("team-staged-rename-apply"));
    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
      const envelope = JSON.stringify(sendCommand.mock.calls[0]?.[0]);
      expect(envelope).toContain("setTeamMemberName");
      expect(envelope).toContain("alice2");
    });
  });
});
