// @vitest-environment jsdom
/**
 * staged 审批内联契约（2026-10-22 用户裁定：审批对齐 workflow 模式——会话流内、
 * 用户驱动；废除 PR-2.4c 的「自动打开 TeamPanel」桥 TeamStagedAutoOpenBridge，
 * 该桥曾因 h-full 包装在 App 顶层裸挂载把壳层顶出一屏，见 specs/agents-team.md §10
 * 废除登记）。
 *
 * 本测试锁 TeamConversationSummary 的 staged 分支：
 * 1. staged + 有连接 → 内联渲染 TeamStagedEditor（面板同款审批面），「确认并启动」
 *    经 connection.sendCommand 发 approveTeamPlan（sessionId=parentSessionId）；
 * 2. 「回对话修改」携带 note 发 reviseTeamPlan——§15 第4条（2026-10-23 三发起面扩圈）
 *    后 note 输入仅在注入 onPrefillComposer 的非抑制形态在场，故本用例注入回调并
 *    断言预填随行；缺席形态（输入隐藏+提示走对话）由
 *    src/team/TeamStagedFailureWiring.test.tsx「无回调挂载面」组锁定；
 * 3. staged 无连接（纯历史视图）→ 只读计划摘要，不出审批动作；
 * 4. 非 staged（active）→ 不渲染审批编辑器。
 * 打桩不涉及 v4 服务层：connection.sendCommand 由测试注入（TeamCommandSender 同形）。
 */
import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope } from "@drora/shared/drora-protocol-v4";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TeamConversationSummary } from "@/team/TeamConversationSummary.js";
import { createTeamFixture } from "./fixtures/agents-team.fixture.js";

const harness = vi.hoisted(() => ({
  envelopes: [] as CommandEnvelope[],
}));

const sendCommand = vi.fn(async (envelope: CommandEnvelope) => {
  harness.envelopes.push(envelope);
  return { status: "accepted" as const };
});

const stagedTeam = {
  ...createTeamFixture(),
  status: "staged" as const,
  stagedDraft: {
    draftMembers: [{ memberName: "Frontend", profile: "界面实现" }, { memberName: "Reviewer" }],
    draftTasks: [
      { taskId: "T1", title: "状态契约", dependsOn: [] },
      { taskId: "T2", title: "方案审查", assignee: "Frontend", dependsOn: ["T1"] },
    ],
    awaitingFeedback: false,
  },
};

type TeamPrefillComposer = ComponentProps<typeof TeamConversationSummary>["onPrefillComposer"];

function renderSummary(
  team: typeof stagedTeam,
  withConnection = true,
  onPrefillComposer?: TeamPrefillComposer,
) {
  return render(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(TeamConversationSummary, {
        team,
        target: { workspacePath: "/tmp/ws", parentSessionId: "sess_lead" },
        ...(withConnection ? { connection: { sessionId: "sess_lead", sendCommand } } : {}),
        ...(onPrefillComposer === undefined ? {} : { onPrefillComposer }),
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
  harness.envelopes.length = 0;
  sendCommand.mockClear();
});

describe("TeamConversationSummary staged 审批内联", () => {
  it("staged + 有连接：内联渲染审批编辑器，确认并启动发 approveTeamPlan", async () => {
    renderSummary(stagedTeam);
    expect(screen.getByTestId("team-staged-editor")).toBeTruthy();
    expect(screen.getAllByText("Frontend").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("team-staged-approve"));
    await waitFor(() => expect(harness.envelopes.length).toBe(1));
    expect(harness.envelopes[0]?.type).toBe("approveTeamPlan");
  });

  it("回对话修改携带 note 发 reviseTeamPlan（注入预填回调的非抑制形态）", async () => {
    const onPrefillComposer = vi.fn();
    renderSummary(stagedTeam, true, onPrefillComposer);
    fireEvent.change(screen.getByTestId("team-staged-revise-note"), {
      target: { value: "改成只做前端" },
    });
    fireEvent.focus(screen.getByTestId("team-staged-revise-note"));
    fireEvent.click(screen.getByTestId("team-staged-confirm"));
    await waitFor(() => expect(harness.envelopes.length).toBe(1));
    expect(harness.envelopes[0]?.type).toBe("reviseTeamPlan");
    // note 随信封上 wire（hub v1 不消费，预填面已随行、无静默丢弃）。
    expect(harness.envelopes[0]?.payload).toEqual({ note: "改成只做前端" });
    // §15 第4条：note 同时经预填回调进对话，定向 lead 会话。
    expect(onPrefillComposer).toHaveBeenCalledWith(
      expect.stringContaining("改成只做前端"),
      "sess_lead",
    );
  });

  it("staged 无连接（纯历史视图）：只读摘要，不出审批动作", () => {
    renderSummary(stagedTeam, false);
    expect(screen.queryByTestId("team-staged-editor")).toBeNull();
    expect(screen.queryByTestId("team-staged-approve")).toBeNull();
  });

  it("非 staged（active）：不渲染审批编辑器", () => {
    renderSummary({ ...createTeamFixture(), status: "active" });
    expect(screen.queryByTestId("team-staged-editor")).toBeNull();
    expect(screen.queryByTestId("team-staged-approve")).toBeNull();
  });
});
