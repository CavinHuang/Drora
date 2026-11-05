import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
  MATE_PET_PROJECTION_LIMITS,
} from "@drora/shared";
import type { AssistantDecisionView, AssistantSnapshot, AssistantTicketView } from "@drora/services";

import {
  deriveMatePetBubble,
  matePetBubbleKey,
  matePetReportSummary,
  projectMatePet,
} from "./petProjection.js";
import { mateSourceKindMessageId } from "./view-model.js";

/** 统一钟：updatedAtMs 排序断言可读。 */
const T0 = 1_000_000;

function decision(overrides: Partial<AssistantDecisionView> & { id: number }): AssistantDecisionView {
  return {
    triggerId: "TR-1",
    strength: ASSISTANT_STRENGTHS.explicit,
    mode: ASSISTANT_MODES.observe,
    outcome: ASSISTANT_OUTCOMES.decisionCard,
    decidedBy: "gate",
    decidedMs: T0,
    triggerText: "点名原文\n第二行",
    sourceKind: "local",
    ...overrides,
  };
}

function ticket(overrides: Partial<AssistantTicketView> & { id: string }): AssistantTicketView {
  return {
    brief: "工单原文\n第二行",
    status: ASSISTANT_TICKET_STATUSES.dispatched,
    permissionTier: ASSISTANT_PERMISSION_TIERS.build,
    usage: { inputTokens: 0, outputTokens: 0 },
    outputSummary: null,
    failReason: null,
    targetWorkspaceIdentity: "ws-a",
    sessionId: "sess-1",
    updatedAtMs: T0,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<AssistantSnapshot> & {
    decisions?: readonly AssistantDecisionView[];
    tickets?: readonly AssistantTicketView[];
  },
): AssistantSnapshot {
  return {
    version: 2,
    mode: ASSISTANT_MODES.observe,
    allowlist: ["u1"],
    budget: { maxActivePerWorkspace: 3 },
    worktreeDisabled: false,
    trust: { wouldAcceptCount: 0, releaseCount: 0 },
    triggers: [],
    decisions: [],
    tickets: [],
    updatedAtMs: T0,
    ...overrides,
  };
}

describe("projectMatePet（快照 → 桌宠有界投影）", () => {
  it("待决策卡映射 decisionId/来源/身份；decidedBy=user 出清", () => {
    const snap = snapshot({
      triggers: [
        {
          id: "TR-1",
          sourceKind: "phone",
          strength: ASSISTANT_STRENGTHS.explicit,
          identity: "local@host",
          text: "手机点名",
          atMs: T0,
        },
      ],
      decisions: [
        decision({ id: 1, triggerId: "TR-1", sourceKind: "phone" }),
        decision({ id: 2, outcome: ASSISTANT_OUTCOMES.decisionCard, decidedBy: "user" }),
        decision({ id: 3, outcome: ASSISTANT_OUTCOMES.wouldAccept }),
      ],
    });
    const projection = projectMatePet(snap);
    expect(projection.pendingDecisions).toHaveLength(1);
    expect(projection.pendingDecisions[0]).toMatchObject({
      decisionId: 1,
      sourceKind: "phone",
      identity: "local@host",
    });
    // 原文首行截断（verbatim 不改写，只裁剪）。
    expect(projection.pendingDecisions[0].text).toBe("点名原文");
  });

  it("进行中含 queued；终态不入；按更新时间倒序且有界", () => {
    const tickets = [
      ticket({ id: "T-old", status: ASSISTANT_TICKET_STATUSES.running, updatedAtMs: T0 + 1 }),
      ticket({ id: "T-new", status: ASSISTANT_TICKET_STATUSES.dispatched, updatedAtMs: T0 + 2 }),
      ticket({ id: "T-done", status: ASSISTANT_TICKET_STATUSES.done, updatedAtMs: T0 + 4 }),
    ];
    const many = Array.from({ length: MATE_PET_PROJECTION_LIMITS.activeMax + 2 }, (_, i) =>
      ticket({ id: `T-x${i}`, status: ASSISTANT_TICKET_STATUSES.running, updatedAtMs: T0 + 10 + i }),
    );
    const projection = projectMatePet(snapshot({ tickets: [...tickets, ...many] }));
    expect(projection.activeTickets).toHaveLength(MATE_PET_PROJECTION_LIMITS.activeMax);
    // 最新的排首；done/failed 不入进行中列表。
    expect(projection.activeTickets[0]?.ticketId).toBe("T-x6");
    expect(projection.activeTickets.some((row) => row.ticketId === "T-done")).toBe(false);
    // 有界截断后老工单按更新时间让位（T-old/T-new 落出上界）。
    expect(projection.activeTickets.some((row) => row.ticketId === "T-old")).toBe(false);
  });

  it("queued 工单入进行中列表并携带 queued 档", () => {
    const projection = projectMatePet(
      snapshot({ tickets: [ticket({ id: "T-q", status: ASSISTANT_TICKET_STATUSES.queued })] }),
    );
    expect(projection.activeTickets).toEqual([
      { ticketId: "T-q", status: "queued", brief: "工单原文", targetWorkspaceIdentity: "ws-a" },
    ]);
  });

  it("最新汇报=更新时间最新的终态工单；done 取 output_summary、failed 回落 fail_reason", () => {
    const snap = snapshot({
      tickets: [
        ticket({
          id: "T-1",
          status: ASSISTANT_TICKET_STATUSES.done,
          outputSummary: "完成：首行摘要\n次行",
          updatedAtMs: T0 + 1,
        }),
        ticket({
          id: "T-2",
          status: ASSISTANT_TICKET_STATUSES.failed,
          failReason: "失败：原因首行",
          updatedAtMs: T0 + 2,
        }),
        ticket({ id: "T-3", status: ASSISTANT_TICKET_STATUSES.running, updatedAtMs: T0 + 3 }),
      ],
    });
    const projection = projectMatePet(snap);
    expect(projection.latestReport?.ticketId).toBe("T-2");
    expect(projection.latestReport?.status).toBe("failed");
    expect(projection.latestReport?.summary).toBe("失败：原因首行");
    expect(matePetReportSummary(snap.tickets[0])).toBe("完成：首行摘要");
  });

  it("空快照 → 全空投影（bubble 恒 null——判定在发布方差分）", () => {
    const projection = projectMatePet(snapshot());
    expect(projection.pendingDecisions).toEqual([]);
    expect(projection.activeTickets).toEqual([]);
    expect(projection.latestReport).toBeNull();
    expect(projection.bubble).toBeNull();
  });
});

describe("deriveMatePetBubble（发布方气泡差分）", () => {
  const report = {
    ticketId: "T-1",
    status: "done" as const,
    summary: "完成",
    targetWorkspaceIdentity: "ws-a",
    updatedAtMs: T0,
  };
  const later = { ...report, updatedAtMs: T0 + 5 };

  it("挂载首帧（含冷启动旧汇报）只登记不弹", () => {
    const first = deriveMatePetBubble(null, report);
    expect(first).toEqual({ show: false, next: { key: matePetBubbleKey(report) } });
    const firstEmpty = deriveMatePetBubble(null, null);
    expect(firstEmpty).toEqual({ show: false, next: { key: null } });
  });

  it("会话期内无汇报→出现汇报：弹泡；同键重复帧不弹", () => {
    const seen = deriveMatePetBubble(null, null).next;
    const arrived = deriveMatePetBubble(seen, report);
    expect(arrived.show).toBe(true);
    // 同键重复帧（usage/状态后续刷新）不弹。
    expect(deriveMatePetBubble(arrived.next, report).show).toBe(false);
  });

  it("同工单新汇报（换代后再终态，键变化）再弹；汇报被裁剪（null）不弹", () => {
    const seen = deriveMatePetBubble(null, report).next;
    expect(deriveMatePetBubble(seen, later).show).toBe(true);
    expect(deriveMatePetBubble(seen, null)).toEqual({ show: false, next: { key: seen.key } });
  });
});

describe("mateSourceKindMessageId（P3 来源徽标封闭映射）", () => {
  it("四来源映射；未知值 null 不渲染", () => {
    expect(mateSourceKindMessageId("local")).toBe("mate.source.local");
    expect(mateSourceKindMessageId("feishu")).toBe("mate.source.feishu");
    expect(mateSourceKindMessageId("phone")).toBe("mate.source.phone");
    expect(mateSourceKindMessageId("github")).toBe("mate.source.github");
    expect(mateSourceKindMessageId("slack")).toBeNull();
  });
});
