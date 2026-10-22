// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";

import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import type { CommandAck, CommandEnvelope } from "@drora/shared/drora-protocol-v4";
import {
  stagedFailureReasonI18nKey,
  teamCommandOutcomeToStagedFailure,
  TeamStagedEditor,
  TEAM_STAGED_FAILURE_REASON_I18N_KEYS,
} from "./TeamStagedEditor.js";
import type { TeamCommandOutcome } from "./commands.js";
import type { TeamPanelStagedDraftView } from "./view-model.js";

/**
 * staged 审批编辑器呈现规则（2026-10-22 审批面对齐；specs/agents-team.md §10
 * 五条呈现子条 + §15 登记）：
 * 1. 问句表头（规则1）——顶部问句行「启动这支团队？」语义 + 原 stagedSummary 移作
 *    表头计数；组件不 import 任何 workflow 组件（§15 图标决策）；
 * 2. 三动作失败出显（规则4）——outcome→failure 映射纯函数三态、reasonCode→i18n
 *    文案（已知/未知兜底/传输异常）、编辑器 role=alert 渲染、动作发起即清除；
 * 3. 触达（规则5）——三动作按钮与改名铅笔 pointer-coarse ≥44px 类在场。
 */

const DRAFT: TeamPanelStagedDraftView = {
  members: [
    { memberName: "alice", modelSelection: { provider: "bigmodel", model: "glm" } },
    { memberName: "bob" },
  ],
  tasks: [
    { taskId: "task_1", title: "调研定价页", dependsOn: [] },
    { taskId: "task_2", title: "写对比报告", assignee: "alice", dependsOn: ["task_1"] },
  ],
  awaitingFeedback: false,
};

/** 按词典模板拼期望 alert 文案（不硬编码成品句，防词典措辞漂移假阴性）。 */
function failureLine(actionKey: "approve" | "revise" | "abandon", reason: string): string {
  const template = zhCN["team.stagedEditor.failure.line"] ?? "";
  return template
    .replace("{action}", zhCN[`team.stagedEditor.${actionKey}`] ?? "")
    .replace("{reason}", reason);
}

function ackOf(patch: Partial<CommandAck>, envelope: CommandEnvelope): CommandAck {
  return {
    commandId: envelope.commandId,
    status: "accepted",
    revisionAtDecision: 1,
    ...patch,
  } as CommandAck;
}

function makeOutcome(ack: Partial<CommandAck> | undefined, error?: unknown): TeamCommandOutcome {
  if (ack === undefined) return { ok: false, error };
  const envelope = { commandId: "cmd_1" } as CommandEnvelope;
  return { ok: false, ack: ackOf(ack, envelope) };
}

function renderEditor(overrides: Partial<Parameters<typeof TeamStagedEditor>[0]> = {}): void {
  render(
    <DroraIntlProvider initialLocale="zh-CN">
      <TeamStagedEditor
        draft={DRAFT}
        onApprove={vi.fn()}
        onRevise={vi.fn()}
        onAbandon={vi.fn()}
        {...overrides}
      />
    </DroraIntlProvider>,
  );
}

afterEach(cleanup);

describe("teamCommandOutcomeToStagedFailure（TeamCommandOutcome → 失败态，两挂载点共用映射）", () => {
  it("ok outcome（accepted 族）不出失败态", () => {
    expect(teamCommandOutcomeToStagedFailure("approve", { ok: true })).toBeNull();
  });

  it("被拒绝的 ack 携带 reasonCode 交回", () => {
    const failure = teamCommandOutcomeToStagedFailure(
      "approve",
      makeOutcome({ status: "failed", reasonCode: "fault.command.teamRejected.team_not_present" }),
    );
    expect(failure).toEqual({
      action: "approve",
      reasonCode: "fault.command.teamRejected.team_not_present",
    });
  });

  it("传输异常（ack 缺席）不带 reasonCode，走 transport 文案位", () => {
    const failure = teamCommandOutcomeToStagedFailure(
      "revise",
      makeOutcome(undefined, new Error("connection lost")),
    );
    expect(failure).toEqual({ action: "revise" });
    expect(failure?.reasonCode).toBeUndefined();
  });
});

describe("stagedFailureReasonI18nKey（reasonCode → 文案键，未知走兜底）", () => {
  it("无 reasonCode（传输异常）→ transport 键", () => {
    expect(stagedFailureReasonI18nKey({ action: "abandon" })).toBe(
      "team.stagedEditor.failure.transport",
    );
  });

  it("已知 hub 拒绝码映射到专用文案键", () => {
    expect(
      stagedFailureReasonI18nKey({
        action: "approve",
        reasonCode: "fault.command.teamRejected.member_spawn_failed",
      }),
    ).toBe("team.stagedEditor.failure.memberSpawnFailed");
    expect(
      stagedFailureReasonI18nKey({
        action: "revise",
        reasonCode: "fault.command.teamRejected.draft_unknown_assignee",
      }),
    ).toBe("team.stagedEditor.failure.draftInvalid");
  });

  it("未知 reasonCode → fallback 兜底键（hub 新增错误码不要求同步 UI）", () => {
    expect(
      stagedFailureReasonI18nKey({
        action: "approve",
        reasonCode: "fault.command.teamRejected.brand_new_code",
      }),
    ).toBe("team.stagedEditor.failure.fallback");
  });
});

describe("TeamStagedEditor 问句表头（spec §10 呈现规则1）", () => {
  it("顶部为问句行 + 「N 名成员 · N 项任务」计数（原 stagedSummary 移作表头计数）", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: zhCN["team.stagedEditor.question"] })).toBeTruthy();
    expect(screen.getByText("2 名成员 · 2 项任务")).toBeTruthy();
  });

  it("无 failure 时不渲染失败 alert", () => {
    renderEditor();
    expect(screen.queryByTestId("team-staged-command-error")).toBeNull();
  });
});

describe("TeamStagedEditor 三动作失败出显（spec §10 呈现规则4）", () => {
  it("已知 reasonCode 渲染 role=alert（动作标签 + 映射原因）", () => {
    renderEditor({
      failure: {
        action: "approve",
        reasonCode: "fault.command.teamRejected.member_spawn_failed",
      },
    });
    const alert = screen.getByTestId("team-staged-command-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe(
      failureLine("approve", zhCN["team.stagedEditor.failure.memberSpawnFailed"] ?? ""),
    );
  });

  it("未知 reasonCode 渲染兜底文案", () => {
    renderEditor({
      failure: {
        action: "revise",
        reasonCode: "fault.command.teamRejected.brand_new_code",
      },
    });
    expect(screen.getByTestId("team-staged-command-error").textContent).toBe(
      failureLine("revise", zhCN["team.stagedEditor.failure.fallback"] ?? ""),
    );
  });

  it("传输异常（无 reasonCode）渲染 transport 文案", () => {
    renderEditor({ failure: { action: "abandon" } });
    expect(screen.getByTestId("team-staged-command-error").textContent).toBe(
      failureLine("abandon", zhCN["team.stagedEditor.failure.transport"] ?? ""),
    );
  });
});

describe("失败提示的清除时机（spec §10 呈现规则4：下次任一动作发起时清除）", () => {
  /** 模拟挂载点行为的最小宿主：动作回调开头置空 failure（两挂载点的接线形态）。 */
  function Harness({
    initialFailure,
    onApprove,
    onRevise,
  }: {
    initialFailure: Parameters<typeof TeamStagedEditor>[0]["failure"];
    onApprove: () => void;
    onRevise: () => void;
  }): ReactNode {
    const [failure, setFailure] = useState(initialFailure);
    return (
      <DroraIntlProvider initialLocale="zh-CN">
        <TeamStagedEditor
          draft={DRAFT}
          failure={failure}
          onApprove={() => {
            setFailure(null);
            onApprove();
          }}
          onRevise={() => {
            setFailure(null);
            onRevise();
          }}
          onAbandon={vi.fn()}
        />
      </DroraIntlProvider>
    );
  }

  it("approve 发起即清除既有提示并上抛动作", () => {
    const onApprove = vi.fn();
    render(
      <Harness
        initialFailure={{
          action: "revise",
          reasonCode: "fault.command.teamRejected.team_not_present",
        }}
        onApprove={onApprove}
        onRevise={vi.fn()}
      />,
    );
    expect(screen.getByTestId("team-staged-command-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-staged-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("team-staged-command-error")).toBeNull();
  });

  it("revise 发起同样清除（任一动作都触发清除，不只同动作）", () => {
    const onRevise = vi.fn();
    render(
      <Harness
        initialFailure={{
          action: "approve",
          reasonCode: "fault.command.teamRejected.team_not_present",
        }}
        onApprove={vi.fn()}
        onRevise={onRevise}
      />,
    );
    expect(screen.getByTestId("team-staged-command-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-staged-revise"));
    expect(onRevise).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("team-staged-command-error")).toBeNull();
  });
});

describe("触达（spec §10 呈现规则5：pointer-coarse ≥44px）", () => {
  it("三动作按钮与备注输入带 pointer-coarse 44px 类", () => {
    renderEditor();
    for (const testId of ["team-staged-approve", "team-staged-revise", "team-staged-abandon"]) {
      const control = screen.getByTestId(testId);
      expect(control.className, testId).toContain("pointer-coarse:min-h-11");
      expect(control.className, testId).toContain("pointer-coarse:min-w-11");
    }
    const note = screen.getByTestId("team-staged-revise-note");
    expect(note.className).toContain("pointer-coarse:min-h-11");
  });

  it("改名铅笔带 pointer-coarse 44px 类（输入/确认/取消在编辑态同样）", () => {
    renderEditor({ onRenameMember: vi.fn() });
    // DRAFT 两个成员各有一枚铅笔，取第一枚（alice）验证。
    const pencil = screen.getAllByTestId("team-staged-rename")[0]!;
    expect(pencil.className).toContain("pointer-coarse:min-h-11");
    expect(pencil.className).toContain("pointer-coarse:min-w-11");

    fireEvent.click(pencil);
    expect(screen.getByTestId("team-staged-rename-input").className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByTestId("team-staged-rename-apply").className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByTestId("team-staged-rename-cancel").className).toContain(
      "pointer-coarse:min-h-11",
    );
  });
});

describe("reasonCode 映射表守卫", () => {
  it("已知键全部指向 team.stagedEditor.failure.* 文案且在 zh 词典非空", () => {
    for (const key of Object.values(TEAM_STAGED_FAILURE_REASON_I18N_KEYS)) {
      expect(key.startsWith("team.stagedEditor.failure."), key).toBe(true);
      expect(zhCN[key], key).toBeTruthy();
    }
  });
});
