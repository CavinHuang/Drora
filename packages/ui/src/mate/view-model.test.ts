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
} from "@drora/services";

import {
  MATE_UNTARGETED_WORKSPACE_KEY,
  deriveMateViewModel,
  isMateActiveTicket,
  isMateObserveDecision,
  isMatePendingDecision,
  resolveMateBudgetActive,
  resolveMateErrorMessageId,
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
    trust: { wouldAcceptCount: 2, releaseCount: 1 },
    triggers: [],
    decisions: [],
    tickets: [],
    updatedAtMs: T0,
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
    expect(resolveMateErrorMessageId({ code: ASSISTANT_ERROR_CODES.dispatchRejected })).toBe(
      "mate.error.generic",
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
