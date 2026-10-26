// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import { ConversationStatusPanel } from "../src/v4/ConversationStatusPanel.js";
import { TooltipProvider } from "../src/components/ui/tooltip.js";
import type { TeamCommandOutcome } from "../src/team/commands.js";

// §10 增补（2026-10-26）：状态面板 team 分区行的一键停止——确认门、haltTeam 单一通道、
// 失败行内 role=alert、halted 不出钮。宿主注入 onHaltTeam（SessionPane → haltTeam 命令）。

vi.mock("@/hooks/useConfirmDialog.js", () => ({
  useConfirmDialog: () => () => Promise.resolve(true),
}));

function activeTeam(status: TeamProjectionState["status"] = "active"): TeamProjectionState {
  return {
    teamId: "team_1",
    name: "调研队",
    status,
    members: [
      { agentId: "agent_alice", memberName: "alice", state: "working" },
      { agentId: "agent_bob", memberName: "bob", state: "working" },
    ],
    board: {
      tasks: [
        {
          taskId: "t1",
          title: "t1",
          status: "in_progress",
          attempt: 1,
          dependsOn: [],
          artifactRefs: [],
          createdAt: "",
          updatedAt: "",
        },
        {
          taskId: "t2",
          title: "t2",
          status: "completed",
          attempt: 1,
          dependsOn: [],
          artifactRefs: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
      limit: 100,
    },
    mailboxTail: [],
  } as unknown as TeamProjectionState;
}

function renderPanel({
  team,
  onHaltTeam,
}: {
  team: TeamProjectionState;
  onHaltTeam?: () => Promise<TeamCommandOutcome>;
}): ReturnType<typeof render> {
  return render(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        TooltipProvider,
        null,
        createElement(ConversationStatusPanel, {
          team,
          ...(onHaltTeam === undefined ? {} : { onHaltTeam }),
        }),
      ),
    ),
  );
}

afterEach(cleanup);

describe("状态面板 team 分区一键停止（specs/agents-team.md §10 增补）", () => {
  it("active：停止钮在场——点击（自动确认）→ 调用 onHaltTeam；成功零出显", async () => {
    const onHaltTeam = vi.fn().mockResolvedValue({ ok: true });
    renderPanel({ team: activeTeam(), onHaltTeam });
    fireEvent.click(screen.getByTestId("status-panel-team-halt"));
    await waitFor(() => expect(onHaltTeam).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("status-panel-team-halt-error")).toBeNull();
  });

  it("拒绝（team_not_present）→ 行内 role=alert 出映射文案", async () => {
    const onHaltTeam = vi.fn().mockResolvedValue({
      ok: false,
      ack: { status: "failed", reasonCode: "fault.command.teamRejected.team_not_present" },
    });
    renderPanel({ team: activeTeam(), onHaltTeam });
    fireEvent.click(screen.getByTestId("status-panel-team-halt"));
    const alert = await screen.findByTestId("status-panel-team-halt-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(zhCN["team.stagedEditor.failure.teamNotPresent"] ?? "");
  });

  it("halted：不出停止钮（已停无可停）；onHaltTeam 缺席：同样不渲染", () => {
    const { rerender } = renderPanel({ team: activeTeam("halted"), onHaltTeam: vi.fn() });
    expect(screen.queryByTestId("status-panel-team-halt")).toBeNull();
    rerender(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          TooltipProvider,
          null,
          createElement(ConversationStatusPanel, { team: activeTeam() }),
        ),
      ),
    );
    expect(screen.queryByTestId("status-panel-team-halt")).toBeNull();
  });
});
