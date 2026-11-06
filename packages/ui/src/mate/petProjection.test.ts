import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
  MATE_PET_PROJECTION_LIMITS,
  matePetProjectionSchema,
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
    expect(projection.pendingDecisions[0]?.text).toBe("点名原文");
  });

  it("建议档透传：build/guarded 随行下发；yolo 不透传；无建议缺席（spec §11 tray 同参）", () => {
    const snap = snapshot({
      decisions: [
        decision({
          id: 1,
          routerSuggestion: {
            kind: "dispatch",
            permissionTier: ASSISTANT_PERMISSION_TIERS.guarded,
            evidence: [],
          },
        }),
        decision({
          id: 2,
          routerSuggestion: {
            kind: "attach",
            permissionTier: ASSISTANT_PERMISSION_TIERS.build,
            evidence: [],
          },
        }),
        decision({
          id: 3,
          routerSuggestion: {
            kind: "dispatch",
            permissionTier: ASSISTANT_PERMISSION_TIERS.yolo,
            evidence: [],
          },
        }),
        decision({ id: 4 }),
      ],
    });
    const rows = projectMatePet(snap).pendingDecisions;
    expect(rows.find((row) => row.decisionId === 1)?.suggestedTier).toBe(
      ASSISTANT_PERMISSION_TIERS.guarded,
    );
    expect(rows.find((row) => row.decisionId === 2)?.suggestedTier).toBe(
      ASSISTANT_PERMISSION_TIERS.build,
    );
    // yolo 建议不透传（速览放行禁止 yolo，缺席=decide 执行体回落 build）。
    expect(rows.find((row) => row.decisionId === 3)?.suggestedTier).toBeUndefined();
    // 无建议（Router 未回/降级）无字段——schema optional，不发明档位。
    expect(rows.find((row) => row.decisionId === 4)?.suggestedTier).toBeUndefined();
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
      {
        ticketId: "T-q",
        status: "queued",
        brief: "工单原文",
        targetWorkspaceIdentity: "ws-a",
        // 07 号详设 §1：活动行恒带最近活动时刻；dispatchMode 缺省（P1 旧行）不带 mode。
        updatedAtMs: T0,
      },
    ]);
  });

  it("活动行透传 updatedAtMs 与模式徽标（仅 B/C；A/缺省不带——07 号详设 §1）", () => {
    const projection = projectMatePet(
      snapshot({
        tickets: [
          ticket({ id: "T-b", status: ASSISTANT_TICKET_STATUSES.running, dispatchMode: "B", updatedAtMs: T0 + 3 }),
          ticket({ id: "T-a", status: ASSISTANT_TICKET_STATUSES.running, dispatchMode: "A", updatedAtMs: T0 + 2 }),
          ticket({ id: "T-none", status: ASSISTANT_TICKET_STATUSES.running, updatedAtMs: T0 + 1 }),
        ],
      }),
    );
    const byId = new Map(projection.activeTickets.map((row) => [row.ticketId, row]));
    expect(byId.get("T-b")).toMatchObject({ mode: "B", updatedAtMs: T0 + 3 });
    expect(byId.get("T-a")).toMatchObject({ updatedAtMs: T0 + 2 });
    expect(byId.get("T-a")?.mode).toBeUndefined();
    expect(byId.get("T-none")?.mode).toBeUndefined();
  });

  it("recentTickets=终态最近 recentMax 条倒序；failed 带 fail_reason 摘要、无摘要省略（07 号详设）", () => {
    const doneTickets = Array.from({ length: MATE_PET_PROJECTION_LIMITS.recentMax + 2 }, (_, i) =>
      ticket({
        id: `T-d${i}`,
        status: ASSISTANT_TICKET_STATUSES.done,
        outputSummary: `完成摘要 ${i}`,
        updatedAtMs: T0 + i,
      }),
    );
    const projection = projectMatePet(
      snapshot({
        tickets: [
          ...doneTickets,
          ticket({
            id: "T-fail",
            status: ASSISTANT_TICKET_STATUSES.failed,
            failReason: "assistant_row_failed",
            updatedAtMs: T0 + 100,
          }),
          // 无摘要 done（outputSummary/failReason 均 null）——审修复 F1：置于界内
          // （T0+50，晚于全部 T-d*）使「summary 省略」分支可证伪（界内行正向断言）。
          ticket({ id: "T-silent", status: ASSISTANT_TICKET_STATUSES.done, updatedAtMs: T0 + 50 }),
        ],
      }),
    );
    const recent = projection.recentTickets ?? [];
    expect(recent).toHaveLength(MATE_PET_PROJECTION_LIMITS.recentMax);
    // 最新终态（failed）排首并携带 fail_reason 摘要；done 无 output_summary 且非
    // failed → summary 省略（T-silent=界内无摘要 done，正向断言见下）。
    expect(recent[0]).toMatchObject({
      ticketId: "T-fail",
      status: "failed",
      summary: "assistant_row_failed",
      updatedAtMs: T0 + 100,
    });
    // 次序=T-fail(T0+100) > T-silent(T0+50) > T-d5（recentMax+1 条 done 中最新）> …。
    expect(recent[1]?.ticketId).toBe("T-silent");
    expect(recent[2]?.ticketId).toBe(`T-d${MATE_PET_PROJECTION_LIMITS.recentMax + 1}`);
    // 无摘要 done 界内省略 summary（审修复 F1 正向断言：恒带空串/伪造文案即红）。
    expect(recent.find((row) => row.ticketId === "T-silent")?.summary).toBeUndefined();
    expect(recent.every((row) => row.ticketId === "T-silent" || row.summary !== undefined)).toBe(true);
    // 首条与 latestReport 同源（同一最新终态工单）。
    expect(projection.latestReport?.ticketId).toBe("T-fail");
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
    expect(matePetReportSummary(snap.tickets[0]!)).toBe("完成：首行摘要");
  });

  it("旧发布方帧（无 recentTickets/行级新字段）过投影 schema——Main/宠物窗 safeParse 兼容锁定（07 §1）", () => {
    const legacyFrame = {
      pendingDecisions: [],
      activeTickets: [
        { ticketId: "T-1", status: "running", brief: "旧帧行", targetWorkspaceIdentity: "ws-a" },
      ],
      latestReport: null,
      bubble: null,
    };
    const parsed = matePetProjectionSchema.safeParse(legacyFrame);
    expect(parsed.success).toBe(true);
  });

  it("空快照 → 全空投影（bubble 恒 null——判定在发布方差分）", () => {
    const projection = projectMatePet(snapshot({}));
    expect(projection.pendingDecisions).toEqual([]);
    expect(projection.activeTickets).toEqual([]);
    expect(projection.recentTickets).toEqual([]);
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
