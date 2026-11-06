import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import type {
  AssistantDecisionView,
  AssistantSnapshot,
  AssistantTicketView,
  AssistantTriggerView,
} from "@drora/services";

import {
  MATE_UNTARGETED_WORKSPACE_KEY,
  deriveMateStatusLine,
  deriveMateThreadRows,
  deriveMateViewModel,
  findMateDecisionForTicket,
  findMateTicketIdForDecision,
  formatMateThreadClock,
  isMateActiveTicket,
  isMateAutoNoticeDecision,
  isMateAutoSwitchAvailable,
  isMateObserveDecision,
  isMatePendingDecision,
  isMateQueuedTicket,
  isMateAwaitingVerification,
  isMateThreadTicketNavigable,
  matePermissionTierMessageId,
  mateRouterSuggestionKindMessageId,
  mateStaleBadgeKind,
  mateTicketGenerationNumber,
  mateTriggerOutcomeFeedbackMessageId,
  mateUnconfirmedIncrement,
  mergeMateThreadRows,
  resolveMateBudgetActive,
  resolveMateErrorMessageId,
  resolveMateQuotaLine,
  resolveMateTrustGateProgress,
  resolveMateUsageGenerations,
} from "./view-model.js";

/** 统一钟：让 updatedAtMs 排序断言可读。 */
const T0 = 1_000_000;

function decision(
  overrides: Partial<AssistantDecisionView> & { id: number },
): AssistantDecisionView {
  return {
    triggerId: "TR-1",
    strength: ASSISTANT_STRENGTHS.explicit,
    mode: ASSISTANT_MODES.observe,
    outcome: ASSISTANT_OUTCOMES.decisionCard,
    decidedBy: "gate",
    decidedMs: T0,
    triggerText: "点名原文",
    ...overrides,
  };
}

function ticket(overrides: Partial<AssistantTicketView> & { id: string }): AssistantTicketView {
  return {
    brief: "工单首行\n第二行",
    status: ASSISTANT_TICKET_STATUSES.running,
    permissionTier: "build",
    usage: { inputTokens: 10, outputTokens: 20 },
    outputSummary: null,
    failReason: null,
    targetWorkspaceIdentity: "ws-a",
    sessionId: null,
    updatedAtMs: T0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Omit<AssistantSnapshot, "version">> = {}): AssistantSnapshot {
  return {
    // P2 快照版本=2（决策卡 Router 预填 + 工单写域/代际字段）；UI type-only 消费。
    version: 2,
    mode: ASSISTANT_MODES.observe,
    allowlist: ["user-a"],
    budget: { maxActivePerWorkspace: 1 },
    worktreeDisabled: false,
    trust: { wouldAcceptCount: 2, releaseCount: 1 },
    triggers: [],
    decisions: [],
    tickets: [],
    updatedAtMs: T0,
    ...overrides,
  };
}

/** P10a-2：trigger 视图行 helper（对话流首屏投影用）。 */
function trigger(overrides: Partial<AssistantTriggerView> & { id: string }): AssistantTriggerView {
  return {
    sourceKind: "local",
    strength: ASSISTANT_STRENGTHS.explicit,
    identity: "user-a",
    text: `触发原文 ${overrides.id}`,
    atMs: T0,
    ...overrides,
  };
}

describe("deriveMateViewModel 分组", () => {
  it("按 targetWorkspaceIdentity 分组；null/空串归未指名组且恒排首；组内按更新时间倒序", () => {
    const model = deriveMateViewModel(
      snapshot({
        tickets: [
          ticket({ id: "T-1", targetWorkspaceIdentity: "ws-b", updatedAtMs: T0 + 1 }),
          ticket({ id: "T-2", targetWorkspaceIdentity: "ws-a", updatedAtMs: T0 + 5 }),
          ticket({ id: "T-3", targetWorkspaceIdentity: "ws-a", updatedAtMs: T0 + 2 }),
          ticket({ id: "T-4", targetWorkspaceIdentity: null, updatedAtMs: T0 + 9 }),
          ticket({ id: "T-5", targetWorkspaceIdentity: "", updatedAtMs: T0 + 3 }),
        ],
      }),
      "all",
    );
    expect(model.groups.map((group) => group.key)).toEqual([
      MATE_UNTARGETED_WORKSPACE_KEY,
      "ws-a",
      "ws-b",
    ]);
    // 组内 updatedAtMs 倒序；同 ms 按 id 稳定。
    expect(model.groups[1]!.tickets.map((item) => item.id)).toEqual(["T-2", "T-3"]);
    expect(model.groups[0]!.tickets.map((item) => item.id)).toEqual(["T-4", "T-5"]);
  });

  it("组头实耗合计 = 组内工单 usage 求和（token-only）", () => {
    const model = deriveMateViewModel(
      snapshot({
        tickets: [
          ticket({ id: "T-1", usage: { inputTokens: 100, outputTokens: 5 } }),
          ticket({ id: "T-2", usage: { inputTokens: 23, outputTokens: 7 } }),
        ],
      }),
      "all",
    );
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]!.usageTotal).toEqual({ inputTokens: 123, outputTokens: 12 });
  });

  it("零副作用：输入快照不被改写（冻结对象投影不抛错、原数组顺序不变）", () => {
    const input = snapshot({
      tickets: [ticket({ id: "T-2", updatedAtMs: T0 + 1 }), ticket({ id: "T-1" })],
      decisions: [decision({ id: 1 })],
    });
    const frozen = Object.freeze({
      ...input,
      tickets: Object.freeze([...input.tickets].map((item) => Object.freeze({ ...item }))),
      decisions: Object.freeze([...input.decisions].map((item) => Object.freeze({ ...item }))),
    }) as AssistantSnapshot;
    expect(() => deriveMateViewModel(frozen, "all")).not.toThrow();
    expect(input.tickets.map((item) => item.id)).toEqual(["T-2", "T-1"]);
  });
});

describe("deriveMateViewModel 过滤", () => {
  const full = snapshot({
    decisions: [
      decision({ id: 1, outcome: ASSISTANT_OUTCOMES.decisionCard, decidedBy: "gate" }),
      decision({ id: 2, outcome: ASSISTANT_OUTCOMES.wouldAccept }),
      decision({ id: 3, outcome: ASSISTANT_OUTCOMES.rejected }),
    ],
    tickets: [
      ticket({ id: "T-1", status: ASSISTANT_TICKET_STATUSES.dispatched }),
      ticket({ id: "T-2", status: ASSISTANT_TICKET_STATUSES.running }),
      ticket({ id: "T-3", status: ASSISTANT_TICKET_STATUSES.done }),
      ticket({ id: "T-4", status: ASSISTANT_TICKET_STATUSES.failed }),
    ],
  });

  it("decision/observe 两档下无工单入组（决策卡与观察行由组件按谓词消费）", () => {
    expect(deriveMateViewModel(full, "decision").groups).toEqual([]);
    expect(deriveMateViewModel(full, "observe").groups).toEqual([]);
  });

  it("running 只保留 dispatched/running；all 保留全部工单", () => {
    expect(deriveMateViewModel(full, "running").groups[0]!.tickets.map((item) => item.id)).toEqual([
      "T-1",
      "T-2",
    ]);
    expect(deriveMateViewModel(full, "all").groups[0]!.tickets).toHaveLength(4);
  });

  it("counts 恒为全局口径（与 filter 无关）：待决策=card+gate、进行中=dispatched+running、观察=would_accept、全部=三者之和", () => {
    for (const filter of ["decision", "running", "observe", "all"] as const) {
      expect(deriveMateViewModel(full, filter).counts).toEqual({
        decision: 1,
        running: 2,
        observe: 1,
        all: 6,
      });
    }
  });

  it("trust 原样透传（口径归服务侧）", () => {
    expect(deriveMateViewModel(full, "all").trust).toEqual({
      wouldAcceptCount: 2,
      releaseCount: 1,
    });
  });
});

describe("判定谓词", () => {
  it("待决策 = decision_card 且 decidedBy=gate（放行后 decidedBy=user 脱离待决策集）", () => {
    expect(isMatePendingDecision(decision({ id: 1, decidedBy: "gate" }))).toBe(true);
    expect(isMatePendingDecision(decision({ id: 2, decidedBy: "user" }))).toBe(false);
    expect(isMatePendingDecision(decision({ id: 3, outcome: ASSISTANT_OUTCOMES.rejected }))).toBe(
      false,
    );
  });

  it("观察行 = would_accept（dismiss 后变 ignored 出清）", () => {
    expect(
      isMateObserveDecision(decision({ id: 1, outcome: ASSISTANT_OUTCOMES.wouldAccept })),
    ).toBe(true);
    expect(isMateObserveDecision(decision({ id: 2, outcome: ASSISTANT_OUTCOMES.ignored }))).toBe(
      false,
    );
  });

  it("进行中 = dispatched+running；终态不算", () => {
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.dispatched)).toBe(true);
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.running)).toBe(true);
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.done)).toBe(false);
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.failed)).toBe(false);
  });
});

describe("resolveMateErrorMessageId", () => {
  it("封闭错误码映射到 mate.error.*；未知/缺席一律 generic", () => {
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.storeBusy })).toBe(
      "mate.error.store.busy",
    );
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.storeMigration })).toBe(
      "mate.error.store.migration",
    );
    expect(
      resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.yoloRequiresHumanApproval }),
    ).toBe("mate.error.yolo");
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.autoLocked })).toBe(
      "mate.error.auto",
    );
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.validationFailed })).toBe(
      "mate.error.validation",
    );
    // 2026-11-06 二轮审查：dispatchRejected（probe 诚实拒绝，卡未消费可改选/重放）出
    // 专属文案，不再落 generic「操作失败」——与 CONTRACT.md F1「诚实拒绝可改选」一致。
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.dispatchRejected })).toBe(
      "mate.error.dispatchRejected",
    );
    expect(resolveMateErrorMessageId(undefined)).toBe("mate.error.generic");
  });
});

describe("resolveMateBudgetActive", () => {
  it("返回最重 workspace 的活动工单数；终态不计；无工单为 0", () => {
    expect(
      resolveMateBudgetActive(
        snapshot({
          tickets: [
            ticket({
              id: "T-1",
              targetWorkspaceIdentity: "ws-a",
              status: ASSISTANT_TICKET_STATUSES.running,
            }),
            ticket({
              id: "T-2",
              targetWorkspaceIdentity: "ws-a",
              status: ASSISTANT_TICKET_STATUSES.dispatched,
            }),
            ticket({
              id: "T-3",
              targetWorkspaceIdentity: "ws-a",
              status: ASSISTANT_TICKET_STATUSES.done,
            }),
            ticket({
              id: "T-4",
              targetWorkspaceIdentity: "ws-b",
              status: ASSISTANT_TICKET_STATUSES.running,
            }),
          ],
        }),
      ),
    ).toBe(2);
    expect(resolveMateBudgetActive(snapshot())).toBe(0);
  });

  it("null/空串目标归未指名键参与计数（与分组同口径）", () => {
    expect(
      resolveMateBudgetActive(
        snapshot({
          tickets: [
            ticket({
              id: "T-1",
              targetWorkspaceIdentity: null,
              status: ASSISTANT_TICKET_STATUSES.running,
            }),
            ticket({
              id: "T-2",
              targetWorkspaceIdentity: "",
              status: ASSISTANT_TICKET_STATUSES.dispatched,
            }),
          ],
        }),
      ),
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// P2 Surface 批次投影（specs §11.1/§11.3：状态条/queued/代际/证据关联/建议键映射）
// ---------------------------------------------------------------------------

describe("P2 isMateQueuedTicket / mateTicketGenerationNumber", () => {
  it("queued 判定只认 ASSISTANT_TICKET_STATUSES.queued（未知状态仍归 observe 降级）", () => {
    expect(isMateQueuedTicket(ASSISTANT_TICKET_STATUSES.queued)).toBe(true);
    expect(isMateQueuedTicket(ASSISTANT_TICKET_STATUSES.dispatched)).toBe(false);
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.queued)).toBe(false);
  });

  it("当前代序号=归档数+1；未派发（字段缺席）为首代 1", () => {
    expect(mateTicketGenerationNumber(ticket({ id: "T-1" }))).toBe(1);
    expect(mateTicketGenerationNumber(ticket({ id: "T-2", generationCount: 2 }))).toBe(3);
    // 0 显式归档与缺席同语义（换代前）。
    expect(mateTicketGenerationNumber(ticket({ id: "T-3", generationCount: 0 }))).toBe(1);
  });
});

describe("P2 deriveMateStatusLine 状态条投影", () => {
  it("活动数用软预算口径（dispatched+running），queued 单列，pending 取待决策卡", () => {
    const line = deriveMateStatusLine(
      snapshot({
        budget: { maxActivePerWorkspace: 3 },
        tickets: [
          ticket({ id: "T-1", status: ASSISTANT_TICKET_STATUSES.dispatched }),
          ticket({ id: "T-2", status: ASSISTANT_TICKET_STATUSES.queued }),
          ticket({ id: "T-3", status: ASSISTANT_TICKET_STATUSES.done }),
        ],
        decisions: [
          decision({ id: 1, outcome: ASSISTANT_OUTCOMES.decisionCard, decidedBy: "gate" }),
          decision({ id: 2, outcome: ASSISTANT_OUTCOMES.decisionCard, decidedBy: "user" }),
        ],
      }),
    );
    expect(line).toEqual({
      mode: ASSISTANT_MODES.observe,
      active: 1,
      max: 3,
      queued: 1,
      pending: 1,
    });
  });

  it("空快照零计数；mode 原样透传（off/auto 键一次建齐）", () => {
    expect(deriveMateStatusLine(snapshot({ mode: ASSISTANT_MODES.off }))).toEqual({
      mode: ASSISTANT_MODES.off,
      active: 0,
      max: 1,
      queued: 0,
      pending: 0,
    });
  });
});

describe("P2 findMateDecisionForTicket 证据关联", () => {
  it("decisionId 精确匹配 decisions[].id；手动建票（null/undefined）返回 null", () => {
    const snap = snapshot({
      decisions: [decision({ id: 7, triggerText: "触发原文" })],
    });
    expect(findMateDecisionForTicket(snap, ticket({ id: "T-1", decisionId: 7 }))?.triggerText).toBe(
      "触发原文",
    );
    expect(findMateDecisionForTicket(snap, ticket({ id: "T-2", decisionId: null }))).toBeNull();
    expect(findMateDecisionForTicket(snap, ticket({ id: "T-3" }))).toBeNull();
  });

  it("关联卡被快照容量裁剪（decisionsMax LRU）时返回 null（诚实降级不猜触发文本）", () => {
    const snap = snapshot({ decisions: [decision({ id: 1 })] });
    expect(findMateDecisionForTicket(snap, ticket({ id: "T-1", decisionId: 99 }))).toBeNull();
  });
});

describe("P2 建议展示键映射（封闭映射）", () => {
  it("四臂 kind → mate.router.suggested.* 一一对应", () => {
    expect(mateRouterSuggestionKindMessageId("dispatch")).toBe("mate.router.suggested.dispatch");
    expect(mateRouterSuggestionKindMessageId("attach")).toBe("mate.router.suggested.attach");
    expect(mateRouterSuggestionKindMessageId("hold")).toBe("mate.router.suggested.hold");
    expect(mateRouterSuggestionKindMessageId("reject")).toBe("mate.router.suggested.reject");
  });

  it("权限档 → mate.card.tier.*（含 P2 补的 yolo 键）", () => {
    expect(matePermissionTierMessageId("build")).toBe("mate.card.tier.build");
    expect(matePermissionTierMessageId("guarded")).toBe("mate.card.tier.guarded");
    expect(matePermissionTierMessageId("yolo")).toBe("mate.card.tier.yolo");
  });
});

describe("P4 isMateAutoSwitchAvailable 信任门入口", () => {
  it("gateOpen 且非 auto → 可切换；auto 下不渲染（唯一入口）", () => {
    const openTrust = {
      wouldAcceptCount: 12,
      releaseCount: 12,
      releaseRate: 0.5,
      sampleCount: 24,
      gateOpen: true,
      gateThresholds: { minRate: 0.8, minSamples: 15 },
    };
    expect(isMateAutoSwitchAvailable(openTrust, ASSISTANT_MODES.observe)).toBe(true);
    expect(isMateAutoSwitchAvailable(openTrust, ASSISTANT_MODES.off)).toBe(true);
    expect(isMateAutoSwitchAvailable(openTrust, ASSISTANT_MODES.auto)).toBe(false);
  });

  it("未达标（gateOpen=false）或旧 Host 快照（字段缺席）恒不可切换——诚实缺省不在 UI 二次判定", () => {
    const lockedTrust = {
      wouldAcceptCount: 1,
      releaseCount: 1,
      releaseRate: 0.5,
      sampleCount: 2,
      gateOpen: false,
      gateThresholds: { minRate: 0.8, minSamples: 15 },
    };
    const legacyTrust = { wouldAcceptCount: 3, releaseCount: 3 };
    expect(isMateAutoSwitchAvailable(lockedTrust, ASSISTANT_MODES.observe)).toBe(false);
    expect(isMateAutoSwitchAvailable(legacyTrust, ASSISTANT_MODES.observe)).toBe(false);
  });
});

describe("P4 resolveMateTrustGateProgress 进度参数", () => {
  it("门槛字段齐全 → 返回百分比参数；缺字段（旧 Host）→ null 不渲染进度行", () => {
    expect(
      resolveMateTrustGateProgress({
        wouldAcceptCount: 3,
        releaseCount: 9,
        releaseRate: 0.75,
        sampleCount: 12,
        gateOpen: false,
        gateThresholds: { minRate: 0.8, minSamples: 15 },
      }),
    ).toEqual({ rate: 75, samples: 12, minRate: 80, minSamples: 15 });
    expect(resolveMateTrustGateProgress({ wouldAcceptCount: 1, releaseCount: 1 })).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// P4 第二棒投影（04 详设 §3/§4 UI 侧）：配额行/核验滞留/未确认增量/停滞徽标/按代成本
// ---------------------------------------------------------------------------

describe("P4 resolveMateQuotaLine 配额行", () => {
  it("快照带 quota → 投影 used/quota/remaining；缺席（旧 Host）→ null 不渲染", () => {
    const withQuota = snapshot();
    (withQuota as { quota?: unknown }).quota = {
      date: "2026-11-05",
      quota: 5,
      used: { decision: 1, report: 2, bubble: 0 },
      total: 3,
      remaining: 2,
      pendingDigest: [],
    };
    expect(resolveMateQuotaLine(withQuota)).toEqual({ used: 3, quota: 5, remaining: 2 });
    expect(resolveMateQuotaLine(snapshot())).toBeNull();
  });
});

describe("P4 isMateAwaitingVerification / mateUnconfirmedIncrement / mateStaleBadgeKind", () => {
  it("awaiting_output 判定并入活动位口径（isMateActiveTicket 同步）", () => {
    expect(isMateAwaitingVerification(ASSISTANT_TICKET_STATUSES.awaitingOutput)).toBe(true);
    expect(isMateAwaitingVerification(ASSISTANT_TICKET_STATUSES.running)).toBe(false);
    expect(isMateActiveTicket(ASSISTANT_TICKET_STATUSES.awaitingOutput)).toBe(true);
  });

  it("未确认增量：换代且未确认 → {gen, prev}；已确认/未换代 → null", () => {
    const gen2 = ticket({ id: "T-p4", generationCount: 1 });
    expect(mateUnconfirmedIncrement(gen2)).toEqual({ gen: 2, prev: 1 });
    expect(
      mateUnconfirmedIncrement(ticket({ id: "T-p4", generationCount: 1, incrementsConfirmedMs: T0 })),
    ).toBeNull();
    expect(mateUnconfirmedIncrement(ticket({ id: "T-p4", generationCount: 0 }))).toBeNull();
    expect(mateUnconfirmedIncrement(ticket({ id: "T-p4" }))).toBeNull();
  });

  it("stale 徽标：staleSinceMs 有值按封闭类别映射；缺席/未知类别 → null", () => {
    expect(mateStaleBadgeKind(ticket({ id: "T-p4", staleSinceMs: T0, staleKind: "running_stall" }))).toBe(
      "running_stall",
    );
    expect(
      mateStaleBadgeKind(ticket({ id: "T-p4", staleSinceMs: T0, staleKind: "awaiting_unverified" })),
    ).toBe("awaiting_unverified");
    expect(mateStaleBadgeKind(ticket({ id: "T-p4", staleSinceMs: T0, staleKind: "queued_starve" }))).toBeNull();
    expect(mateStaleBadgeKind(ticket({ id: "T-p4" }))).toBeNull();
  });
});

describe("P4 resolveMateUsageGenerations 按代成本", () => {
  it("generation 升序排序返回；字段缺席（旧 Host）→ null 诚实降级", () => {
    const withGenerations = ticket({
      id: "T-p4",
      usageByGeneration: [
        { generation: 2, inputTokens: 64, outputTokens: 256, durationMs: 30_000, current: true },
        { generation: 1, inputTokens: 64, outputTokens: 200, durationMs: 120_000 },
      ],
    });
    const rows = resolveMateUsageGenerations(withGenerations);
    expect(rows?.map((row) => row.generation)).toEqual([1, 2]);
    expect(resolveMateUsageGenerations(ticket({ id: "T-p4" }))).toBeNull();
  });
});

describe("F4 isMateAutoNoticeDecision / findMateTicketIdForDecision（auto 告知卡投影）", () => {
  it("auto_notice×gate → true；user 处置/其他 outcome → false", () => {
    expect(
      isMateAutoNoticeDecision(
        decision({ id: 1, outcome: ASSISTANT_OUTCOMES.autoNotice, decidedBy: "gate" }),
      ),
    ).toBe(true);
    // decided_by 恒 gate（spec §6 落地注记）：user 形态不属于告知卡集（防御）。
    expect(
      isMateAutoNoticeDecision(
        decision({ id: 2, outcome: ASSISTANT_OUTCOMES.autoNotice, decidedBy: "user" }),
      ),
    ).toBe(false);
    expect(
      isMateAutoNoticeDecision(decision({ id: 3, outcome: ASSISTANT_OUTCOMES.decisionCard })),
    ).toBe(false);
  });

  it("工单号回查按 ticket.decisionId 精确匹配；无关联/裁剪 → null 诚实降级", () => {
    const snap = snapshot({
      tickets: [
        ticket({ id: "T-1", decisionId: 7 }),
        ticket({ id: "T-2", decisionId: null }),
      ],
    });
    expect(findMateTicketIdForDecision(snap, 7)).toBe("T-1");
    expect(findMateTicketIdForDecision(snap, 8)).toBeNull();
  });
});

describe("F2 mateTriggerOutcomeFeedbackMessageId（触发反馈封闭映射）", () => {
  it("decision_card/would_accept/ignored 三态各有键；auto_notice 与未知 outcome → null", () => {
    expect(mateTriggerOutcomeFeedbackMessageId(ASSISTANT_OUTCOMES.decisionCard)).toBe(
      "mate.trigger.feedback.decisionCard",
    );
    expect(mateTriggerOutcomeFeedbackMessageId(ASSISTANT_OUTCOMES.wouldAccept)).toBe(
      "mate.trigger.feedback.wouldAccept",
    );
    expect(mateTriggerOutcomeFeedbackMessageId(ASSISTANT_OUTCOMES.ignored)).toBe(
      "mate.trigger.feedback.ignored",
    );
    // auto_notice 呈现面是告知卡（isMateAutoNoticeDecision），配置区不出第二处文案。
    expect(mateTriggerOutcomeFeedbackMessageId(ASSISTANT_OUTCOMES.autoNotice)).toBeNull();
    expect(mateTriggerOutcomeFeedbackMessageId("anything-else")).toBeNull();
  });
});

describe("P10a-2 deriveMateThreadRows（对话流首屏投影）", () => {
  it("三源合并升序；同刻并列组按 trigger→decision→ticket 呈现序；非终态工单不进流", () => {
    const snap = snapshot({
      triggers: [
        trigger({ id: "TR-2", atMs: T0 + 10 }),
        trigger({ id: "TR-1", atMs: T0 }),
      ],
      decisions: [
        // 与 TR-1 同事务同刻：并列组内 trigger 在 decision 前。
        decision({ id: 2, triggerId: "TR-2", decidedMs: T0 + 10 }),
        decision({ id: 1, triggerId: "TR-1", decidedMs: T0 }),
        // 与 trigger 同刻的 done 工单行：kind 序在 decision 后。
      ],
      tickets: [
        ticket({
          id: "T-done",
          status: ASSISTANT_TICKET_STATUSES.done,
          updatedAtMs: T0,
          outputSummary: "完成：首行摘要",
        }),
        ticket({ id: "T-run", status: ASSISTANT_TICKET_STATUSES.running, updatedAtMs: T0 + 99 }),
        ticket({
          id: "T-fail",
          status: ASSISTANT_TICKET_STATUSES.failed,
          updatedAtMs: T0 - 5,
          failReason: "boom",
        }),
      ],
    });
    const rows = deriveMateThreadRows(snap);
    expect(rows.map((row) => row.kind)).toEqual([
      "ticket", // T-fail @T0-5（最早的终态行）
      "trigger", // TR-1 @T0
      "decision", // d1 @T0（同刻并列组：trigger→decision）
      "ticket", // T-done @T0（同刻并列组：ticket 最后）
      "trigger", // TR-2 @T0+10
      "decision", // d2 @T0+10
    ]);
    // 非终态（running）工单不进流——活动态走工单区既有面。
    expect(rows.some((row) => row.kind === "ticket" && row.ticket.ticketId === "T-run")).toBe(
      false,
    );
  });

  it("工单摘要行携带预览口径字段与换代标注（generationCount 透传）", () => {
    const snap = snapshot({
      tickets: [
        ticket({
          id: "T-gen",
          status: ASSISTANT_TICKET_STATUSES.done,
          updatedAtMs: T0,
          generationCount: 2,
          outputSummary: null,
          failReason: null,
        }),
      ],
    });
    const [row] = deriveMateThreadRows(snap);
    expect(row?.kind).toBe("ticket");
    if (row?.kind === "ticket") {
      expect(row.ticket.ticketId).toBe("T-gen");
      expect(row.ticket.brief).toBe("工单首行\n第二行");
      expect(row.ticket.generationCount).toBe(2);
      expect(mateTicketGenerationNumber(row.ticket)).toBe(3);
      expect(row.ticket.targetWorkspaceIdentity).toBe("ws-a");
    }
  });
});

describe("P10a-2 mergeMateThreadRows（旧页合并去重）", () => {
  it("kind+id 去重、升序输出；旧页与首屏并列时保留首个出现（旧页历史不可改写）", () => {
    const older = [
      { kind: "trigger", atMs: T0, trigger: trigger({ id: "TR-1", atMs: T0 }) },
      { kind: "decision", atMs: T0 + 1, decision: decision({ id: 1, decidedMs: T0 + 1 }) },
    ] as const;
    const firstScreen = [
      // 同 id 重复出现（并列组边界安全网场景）——去重后只一行。
      { kind: "trigger", atMs: T0, trigger: trigger({ id: "TR-1", atMs: T0 }) },
      { kind: "trigger", atMs: T0 + 5, trigger: trigger({ id: "TR-2", atMs: T0 + 5 }) },
    ] as const;
    const merged = mergeMateThreadRows(older, firstScreen);
    expect(
      merged.map((row) =>
        row.kind === "trigger" ? row.trigger.id : row.kind === "decision" ? `d${row.decision.id}` : row.ticket.ticketId,
      ),
    ).toEqual(["TR-1", "d1", "TR-2"]);
  });

  it("空组与乱序输入仍收敛为升序", () => {
    const merged = mergeMateThreadRows(
      [],
      [{ kind: "trigger", atMs: T0 + 9, trigger: trigger({ id: "TR-9", atMs: T0 + 9 }) }],
      [{ kind: "trigger", atMs: T0 + 1, trigger: trigger({ id: "TR-1", atMs: T0 + 1 }) }],
    );
    expect(merged.map((row) => (row.kind === "trigger" ? row.trigger.id : null))).toEqual([
      "TR-1",
      "TR-9",
    ]);
  });
});

describe("P10a-2 formatMateThreadClock / isMateThreadTicketNavigable", () => {
  it("绝对时刻：同本地日 HH:MM、跨日 MM-DD HH:MM（不做相对时长、零定时器）", () => {
    const now = new Date(2026, 10, 7, 18, 0).getTime();
    const sameDay = new Date(2026, 10, 7, 9, 5).getTime();
    const prevDay = new Date(2026, 10, 6, 23, 59).getTime();
    expect(formatMateThreadClock(sameDay, now)).toBe("09:05");
    expect(formatMateThreadClock(prevDay, now)).toBe("11-06 23:59");
    // 跨年旧行同取 MM-DD（年份省略是一期登记取舍——对话流翻页史，完整时刻在台账/详情）。
    const prevYear = new Date(2025, 10, 7, 8, 1).getTime();
    expect(formatMateThreadClock(prevYear, now)).toBe("11-07 08:01");
  });

  it("摘要行下钻判定：快照工单集内 true；LRU 裁剪后 false（详情不可达，诚实降级）", () => {
    const snap = snapshot({ tickets: [ticket({ id: "T-in" })] });
    expect(isMateThreadTicketNavigable(snap, "T-in")).toBe(true);
    expect(isMateThreadTicketNavigable(snap, "T-truncated")).toBe(false);
  });
});
