import { describe, expect, it } from "vitest";

import { teamProcessActivitySignal } from "./TeamProcessPanel.js";
import type { TeamPanelMailboxEntryView, TeamPanelModel } from "./view-model.js";

/**
 * refreshKey 活性信号纯函数单测（specs/agents-team.md §21 A5 测试②，2026-10-24）：
 * 信号此前漏两类真实活动边缘——(a) 送达翻转只改 mailboxTail[].delivered（messageId/
 * 计数/updatedAt 全不变），(b) 无板活动的 halt/resume 只迁移投影 status。两类边缘
 * 各自必须抬升信号，否则过程页停在打开时刻的一页（§19 契约 6 活性缝）。
 * 不引 DOM 渲染器（照 TeamPanel-actions.test.ts 先例），直接断言纯函数。
 */

function mailboxEntry(params: Partial<TeamPanelMailboxEntryView>): TeamPanelMailboxEntryView {
  return {
    messageId: "msg_1",
    from: "lead",
    to: "alice",
    ...params,
  };
}

function model(params: Partial<TeamPanelModel> = {}): TeamPanelModel {
  return {
    teamId: "team_1",
    status: "active",
    members: [
      { agentId: "agent_a", memberName: "alice", state: "working" },
      { agentId: "agent_b", memberName: "bob", state: "terminal" },
    ],
    board: {
      attention: [],
      pending: [
        {
          taskId: "task_1",
          title: "抓取定价页",
          status: "pending",
          attempt: 1,
          dependsOn: [],
          dependsDepth: 0,
          artifactRefs: [],
        },
      ],
      inProgress: [],
      completed: [],
      limit: 20,
    },
    mailboxTail: [mailboxEntry({ summary: "催办", delivered: false })],
    ...params,
  };
}

describe("teamProcessActivitySignal（§21 A5）", () => {
  it("同模型产出同信号（纯函数基线，无隐藏状态）", () => {
    expect(teamProcessActivitySignal(model())).toBe(teamProcessActivitySignal(model()));
  });

  it("边缘 (a) 送达翻转：末条 delivered false→true 抬升信号（其余字段全不变）", () => {
    const before = model({ mailboxTail: [mailboxEntry({ delivered: false })] });
    const after = model({ mailboxTail: [mailboxEntry({ delivered: true })] });
    // messageId/计数/working 数/updatedAt 全相同——抬升只能来自 delivered 段。
    expect(teamProcessActivitySignal(after)).not.toBe(teamProcessActivitySignal(before));
  });

  it("边缘 (a) 补充：delivered 缺席 ≠ 显式 false（三值占位不互撞）", () => {
    const absent = model({ mailboxTail: [mailboxEntry({})] });
    const queued = model({ mailboxTail: [mailboxEntry({ delivered: false })] });
    expect(teamProcessActivitySignal(absent)).not.toBe(teamProcessActivitySignal(queued));
  });

  it("边缘 (b) 无板活动：仅投影 status 迁移（active→halted）抬升信号", () => {
    // halt/resume 不动板计数与任务 updatedAt——信号差异只能来自 status 段。
    const running = model({ status: "active" });
    const halted = model({ status: "halted" });
    expect(teamProcessActivitySignal(halted)).not.toBe(teamProcessActivitySignal(running));
  });

  it("基线既有段仍有效：尾窗新增消息（messageId 变化）抬升信号", () => {
    const one = model({ mailboxTail: [mailboxEntry({ messageId: "msg_1", delivered: true })] });
    const two = model({
      mailboxTail: [
        mailboxEntry({ messageId: "msg_1", delivered: true }),
        mailboxEntry({ messageId: "msg_2", to: "bob", delivered: false }),
      ],
    });
    expect(teamProcessActivitySignal(two)).not.toBe(teamProcessActivitySignal(one));
  });
});
