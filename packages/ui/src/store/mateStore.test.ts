import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantResult, IAssistantTicketService } from "@drora/services";

import { useMateStore } from "./mateStore.js";

/**
 * mateStore 单测：fake service 注入（service 作方法参数，store 不持有引用）、
 * single-flight（同 key 并发合并）、代际丢弃（迟到 ack 不折叠新动作接管的状态）。
 */

type FakeService = IAssistantTicketService & {
  approveDecision: ReturnType<typeof vi.fn>;
  ignoreDecision: ReturnType<typeof vi.fn>;
  recordTrigger: ReturnType<typeof vi.fn>;
};

function createFakeService(): FakeService {
  const ok = { ok: true, value: { ok: true } } as const satisfies AssistantResult<{ ok: true }>;
  return {
    recordTrigger: vi.fn(async () => ({
      ok: true as const,
      value: { triggerId: "TR-1", outcome: "decision_card" },
    })),
    approveDecision: vi.fn(async () => ({
      ok: true as const,
      value: { ticketId: "T-1", sessionId: "sess-1" },
    })),
    ignoreDecision: vi.fn(async () => ok),
    dismissObservation: vi.fn(async () => ok),
    stopMandate: vi.fn(async () => ok),
    revokeMandate: vi.fn(async () => ok),
    setMode: vi.fn(async () => ok),
    setAllowlist: vi.fn(async () => ok),
    getConfig: vi.fn(),
    getSnapshot: vi.fn(),
    onDidChange: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as FakeService;
}

/** 手动决议的 deferred：控制 ack 到达次序（代际丢弃测试的关键）。 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const approveOk = {
  ok: true as const,
  value: { ticketId: "T-1", sessionId: "sess-1" },
} as const satisfies AssistantResult<{ ticketId: string; sessionId: string }>;

describe("mateStore 局部态（按 workspace 分域）", () => {
  beforeEach(() => {
    useMateStore.setState({ byWorkspace: {} });
  });

  it("setFilter/selectTicket/expandDecision 三件局部态可独立更新", () => {
    const store = useMateStore.getState();
    store.setFilter("ws-a", "all");
    store.selectTicket("ws-a", "T-9");
    store.expandDecision("ws-a", 7);
    // 全形状锁定（MateLocalUiState 四字段）：P8b 台账组展开态 expandedWorkKeys 不被
    // 三件局部态写入触及（保持初值空数组——质量门禁补救轮补齐 P8b 漏改的断言形状）。
    expect(useMateStore.getState().byWorkspace["ws-a"]).toEqual({
      filter: "all",
      selectedTicketId: "T-9",
      expandedDecisionId: 7,
      expandedWorkKeys: [],
    });
  });

  it("跨 workspace 不串扰（PR-1B 二审发现 6）：A 区展开 7 号卡不影响 B 区，B 区切过滤不带动 A 区", () => {
    const store = useMateStore.getState();
    store.expandDecision("ws-a", 7);
    store.setFilter("ws-a", "decision");
    store.expandDecision("ws-b", 9);
    store.setFilter("ws-b", "observe");
    store.selectTicket("ws-b", "T-2");
    expect(useMateStore.getState().byWorkspace["ws-a"]).toEqual({
      filter: "decision",
      selectedTicketId: null,
      expandedDecisionId: 7,
      expandedWorkKeys: [],
    });
    expect(useMateStore.getState().byWorkspace["ws-b"]).toEqual({
      filter: "observe",
      selectedTicketId: "T-2",
      expandedDecisionId: 9,
      expandedWorkKeys: [],
    });
  });

  it("toggleWorkWorkspace 幂等 toggle 且按 workspace 隔离（P8b 总览卡组展开态）", () => {
    const store = useMateStore.getState();
    store.toggleWorkWorkspace("ws-a", "proj-1");
    store.toggleWorkWorkspace("ws-a", "proj-2");
    // 同组二次 toggle=收起（幂等 toggle，非追加）。
    store.toggleWorkWorkspace("ws-a", "proj-1");
    expect(useMateStore.getState().byWorkspace["ws-a"]?.expandedWorkKeys).toEqual(["proj-2"]);
    // B 区同组键独立，不随 A 区联动。
    store.toggleWorkWorkspace("ws-b", "proj-2");
    expect(useMateStore.getState().byWorkspace["ws-b"]?.expandedWorkKeys).toEqual(["proj-2"]);
    expect(useMateStore.getState().byWorkspace["ws-a"]?.expandedWorkKeys).toEqual(["proj-2"]);
  });
});

describe("mateStore 动作（service 作参数注入）", () => {
  beforeEach(() => {
    useMateStore.setState({ byWorkspace: {} });
  });

  it("动作透传到传入的 service；换一个 service 实例同样工作（store 不持有服务引用）", async () => {
    const first = createFakeService();
    const second = createFakeService();
    await expect(
      useMateStore.getState().approveDecision(first, "ws-a", { decisionId: 1 }),
    ).resolves.toEqual(approveOk);
    await expect(
      useMateStore.getState().approveDecision(second, "ws-b", { decisionId: 1 }),
    ).resolves.toEqual(approveOk);
    expect(first.approveDecision).toHaveBeenCalledTimes(1);
    expect(second.approveDecision).toHaveBeenCalledTimes(1);
  });

  it("single-flight：同 key（动作+目标内容）并发合并为一次 RPC，共享同一 Promise", async () => {
    const service = createFakeService();
    const store = useMateStore.getState();
    const first = store.approveDecision(service, "ws-a", { decisionId: 7 });
    const second = store.approveDecision(service, "ws-a", { decisionId: 7 });
    expect(second).toBe(first);
    const third = store.approveDecision(service, "ws-a", {
      decisionId: 7,
      briefAppendix: "追加段",
    });
    expect(third).not.toBe(first); // E 改单后入参不同 → 不误并
    await Promise.all([first, second, third]);
    expect(service.approveDecision).toHaveBeenCalledTimes(2);
    // 在途清空后再次调用 → 新 RPC（不在旧 Promise 上复用）。
    await store.approveDecision(service, "ws-a", { decisionId: 7 });
    expect(service.approveDecision).toHaveBeenCalledTimes(3);
  });

  it("single-flight key 含 workspace：不同 workspace 的同号决策卡不误并（rowid 每库自增）", async () => {
    const serviceA = createFakeService();
    const serviceB = createFakeService();
    const store = useMateStore.getState();
    await Promise.all([
      store.approveDecision(serviceA, "ws-a", { decisionId: 7 }),
      store.approveDecision(serviceB, "ws-b", { decisionId: 7 }),
    ]);
    expect(serviceA.approveDecision).toHaveBeenCalledTimes(1);
    expect(serviceB.approveDecision).toHaveBeenCalledTimes(1);
  });

  it("不同动作/不同目标互不合并", async () => {
    const service = createFakeService();
    const store = useMateStore.getState();
    await Promise.all([
      store.approveDecision(service, "ws-a", { decisionId: 1 }),
      store.approveDecision(service, "ws-a", { decisionId: 2 }),
      store.ignoreDecision(service, "ws-a", { decisionId: 1 }),
      store.stopMandate(service, "ws-a", "T-1"),
      store.setMode(service, "ws-a", "observe"),
      store.setAllowlist(service, "ws-a", ["user-a"]),
      store.recordTrigger(service, "ws-a", { text: "点名", simulated: "explicit" }),
    ]);
    expect(service.approveDecision).toHaveBeenCalledTimes(2);
    expect(service.ignoreDecision).toHaveBeenCalledTimes(1);
    expect(service.stopMandate).toHaveBeenCalledTimes(1);
    expect(service.setMode).toHaveBeenCalledTimes(1);
    expect(service.setAllowlist).toHaveBeenCalledTimes(1);
    expect(service.recordTrigger).toHaveBeenCalledWith({
      text: "点名",
      simulated: "explicit",
    });
  });

  it("传输层异常原样上抛且清空在途（下次调用不受污染）", async () => {
    const service = createFakeService();
    service.approveDecision.mockRejectedValueOnce(new Error("transport down"));
    const store = useMateStore.getState();
    await expect(store.approveDecision(service, "ws-a", { decisionId: 1 })).rejects.toThrow(
      "transport down",
    );
    await expect(store.approveDecision(service, "ws-a", { decisionId: 1 })).resolves.toEqual(
      approveOk,
    );
    expect(service.approveDecision).toHaveBeenCalledTimes(2);
  });
});

describe("mateStore 代际丢弃（动作收尾只认最新动作）", () => {
  beforeEach(() => {
    useMateStore.setState({ byWorkspace: {} });
  });

  it("基线：动作成功且自己仍是最新动作 → 折叠已处置的卡", async () => {
    const service = createFakeService();
    const store = useMateStore.getState();
    store.expandDecision("ws-a", 7);
    await store.approveDecision(service, "ws-a", { decisionId: 7 });
    expect(useMateStore.getState().byWorkspace["ws-a"]?.expandedDecisionId).toBeNull();
  });

  it("Y 后立刻 N：N 先结算折叠，Y 的迟到 ack 不得改写（代际丢弃）", async () => {
    const service = createFakeService();
    const store = useMateStore.getState();
    // 1. 展开卡 7；Y（慢 ack，gen1）先发起。
    store.expandDecision("ws-a", 7);
    const deferred = createDeferred<AssistantResult<{ ticketId: string; sessionId: string }>>();
    service.approveDecision.mockImplementationOnce(() => deferred.promise);
    const slowApprove = store.approveDecision(service, "ws-a", { decisionId: 7 });
    // 2. N（快 ack，gen2）后发起并结算 → 折叠卡 7。
    await store.ignoreDecision(service, "ws-a", { decisionId: 7 });
    expect(useMateStore.getState().byWorkspace["ws-a"]?.expandedDecisionId).toBeNull();
    // 3. 用户重新展开卡 7（视图态，不产生新动作代际）。
    store.expandDecision("ws-a", 7);
    // 4. Y 的迟到 ack 到达：gen1 已被 gen2 取代 → 收尾被丢弃，展开态保持。
    deferred.resolve(approveOk);
    await slowApprove;
    expect(useMateStore.getState().byWorkspace["ws-a"]?.expandedDecisionId).toBe(7);
  });
});
