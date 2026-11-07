/**
 * Drora Mate 工单服务单测（01 详设 §6：gate 矩阵 / Mandate 三途径+不变式 / repo 事务迁移 /
 * 派发幂等 / 状态归账折叠 / usage 累进）。库用 :memory: 等价路径（每用例独立实例）。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODES,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantDispatchPort,
  setAssistantFrameSource,
} from "../src/assistant-tickets/assistantPorts.js";
import { parseTicketFrameEvents } from "../src/assistant-tickets/ticketLedger.js";

const LOCAL_IDENTITY = "local-user";

function createService(overrides?: {
  allowlist?: string[];
  mode?: (typeof ASSISTANT_MODES)[keyof typeof ASSISTANT_MODES];
}) {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  if (overrides?.mode) {
    // 测试直接写 kv（setMode 的 auto 恒拒，绕开走 repo 不现实）——通过 setAllowlist/setMode 合法路径。
  }
  if (overrides?.allowlist) {
    // 同步设置名单：用公开 API（异步），测试体内 await。
  }
  return { service, db };
}

describe("帧接线（01 §3：订阅生命周期+归账映射）", () => {
  // 帧时刻用真实时基：台账单调纪律以工单 updated_ms（Date.now() 域）为基准，小 sentAt 会被正确丢弃。
  const t0 = Date.now();
  /** 组装一帧合法形态的 conversation wire candidate（上游 safeParse 后的形状）。 */
  function frame(sessionId: string, payload: unknown, sentAt = 1_000): unknown {
    return {
      topic: `conversation/${sessionId}`,
      subscriptionId: "sub-1",
      fromSeq: 1,
      toSeq: 2,
      sentAt,
      payload,
    };
  }

  it("派发成功→自动挂订阅；帧行事件归账状态机（userInput→running，assistantText complete→done+output_summary）并自动退订", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "接线验收",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];

    const watched: Array<{ sessionId: string; identity: string | undefined }> = [];
    const disposed: string[] = [];
    const sinks = new Map<string, (candidate: unknown) => void>();
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId.slice(0, 6)}` },
    }));
    setAssistantFrameSource({
      subscribe(sessionId, identity, _hostPath, onFrame) {
        watched.push({ sessionId, identity });
        sinks.set(sessionId, onFrame);
        return { dispose: () => disposed.push(sessionId) };
      },
    });
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      const sessionId = approved.value.sessionId;
      // 订阅目标与派发目标同形（identity 贯穿）。
      expect(watched).toEqual([{ sessionId, identity: "ws-a" }]);

      const sink = sinks.get(sessionId);
      expect(sink).toBeDefined();
      if (!sink) return;

      // userInput 行 → running。
      sink(
        frame(
          sessionId,
          {
            kind: "deltas",
            deltas: [{ op: "row.appended", row: { id: 1, kind: "userInput", text: "接线验收" } }],
          },
          t0 + 100,
        ),
      );
      let after = await service.getSnapshot();
      expect(after.tickets.find((t) => t.id === approved.value.ticketId)?.status).toBe(
        ASSISTANT_TICKET_STATUSES.running,
      );

      // assistantText complete → done + output_summary 首行截断；终态自动退订。
      sink(
        frame(
          sessionId,
          {
            kind: "deltas",
            deltas: [
              {
                op: "row.appended",
                row: { id: 2, kind: "assistantText", state: "complete", text: "修好了\n细节如下" },
              },
            ],
          },
          t0 + 200,
        ),
      );
      after = await service.getSnapshot();
      const ticket = after.tickets.find((t) => t.id === approved.value.ticketId);
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.done);
      expect(ticket?.outputSummary).toBe("修好了");
      expect(disposed).toEqual([sessionId]);
    } finally {
      setAssistantDispatchPort(null);
      setAssistantFrameSource(null);
    }
  });

  it("state.updated usage→usage_snapshot 差值记账（不改状态）；assistantText failed→failed+mandate 撤销", async () => {
    const { service, db } = createService();
    const recorded = await service.recordTrigger({
      text: "usage 验收",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId.slice(0, 6)}` },
    }));
    const sinks = new Map<string, (candidate: unknown) => void>();
    setAssistantFrameSource({
      subscribe(sessionId, _identity, _hostPath, onFrame) {
        sinks.set(sessionId, onFrame);
        return { dispose: () => sinks.delete(sessionId) };
      },
    });
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      if (!approved.ok) return;
      const sessionId = approved.value.sessionId;
      const sink = sinks.get(sessionId);
      if (!sink) return;

      // 轮内 usage：输入 100/输出 50/cache 10/7 → 累进；状态不变（无行事件）。
      // cacheWriteTokens 断言=2026-11-05 全链审查修复 P2-3 回归：旧实现误读平铺层，
      // 生产 wire 嵌套形态下该字段恒记 0（快照视图只投影 input/output，故直查台账行）。
      sink(
        frame(
          sessionId,
          {
            kind: "deltas",
            deltas: [
              {
                op: "state.updated",
                patch: {
                  usage: {
                    cumulative: {
                      inputTokens: 100,
                      outputTokens: 50,
                      cacheReadTokens: 10,
                      cacheWriteTokens: 7,
                    },
                  },
                },
              },
            ],
          },
          t0 + 300,
        ),
      );
      let after = await service.getSnapshot();
      let ticket = after.tickets.find((t) => t.id === approved.value.ticketId);
      expect(ticket?.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
      const usageAccum = JSON.parse(
        (
          db.raw
            .prepare("SELECT usage_accum FROM ticket WHERE id = ?")
            .get(approved.value.ticketId) as { usage_accum: string }
        ).usage_accum,
      ) as Record<string, number>;
      expect(usageAccum.cacheReadTokens).toBe(10);
      expect(usageAccum.cacheWriteTokens).toBe(7);

      // assistantText failed → failed + 退订。
      sink(
        frame(
          sessionId,
          {
            kind: "deltas",
            deltas: [
              {
                op: "row.upserted",
                row: { id: 3, kind: "assistantText", state: "failed", text: "" },
              },
            ],
          },
          t0 + 400,
        ),
      );
      after = await service.getSnapshot();
      ticket = after.tickets.find((t) => t.id === approved.value.ticketId);
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
      expect(ticket?.failReason).toBe("assistant_row_failed");
    } finally {
      setAssistantDispatchPort(null);
      setAssistantFrameSource(null);
    }
  });

  // 2026-11-05 全链审查修复 P2-5 回归：派发端口 IO 在途时用户 stop → 工单已 failed；
  // 迟到的派发 ACK 不得把终态复活为 running（旧实现无条件回写+重挂订阅，且 stop 释放
  // 的 queued 名额形成超放）。守卫=commitDispatchSuccess 事务内终态检查。
  it("stop 在派发 ACK 在途 → 终态守卫拦下回写（不复活 running/不挂订阅）", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "stop 竞态验收",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const decision = (await service.getSnapshot()).decisions[0];
    let releaseAck: (() => void) | null = null;
    setAssistantDispatchPort(
      (request) =>
        new Promise((resolve) => {
          releaseAck = () =>
            resolve({ ok: true, value: { ticketId: request.ticketId, sessionId: "sess-late" } });
        }),
    );
    const subscribed: string[] = [];
    setAssistantFrameSource({
      subscribe(sessionId: string) {
        subscribed.push(sessionId);
        return { dispose: () => undefined };
      },
    });
    try {
      const approving = service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      await new Promise((resolve) => setTimeout(resolve, 30)); // 让派发挂起在端口上
      // 建票事务先于派发完成（postApproval 顺序），挂起期间票已在库。
      const ticketId = (await service.getSnapshot()).tickets[0]?.id;
      expect(ticketId).toBeDefined();
      const stopped = await service.stopMandate({ ticketId: ticketId as string });
      expect(stopped.ok).toBe(true);
      releaseAck?.(); // 迟到的 ACK
      const approved = await approving;
      expect(approved.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const ticket = (await service.getSnapshot()).tickets[0];
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
      expect(ticket?.failReason).toBe("stopped_by_user");
      expect(subscribed).toEqual([]); // 守卫拦下 → 不挂新会话订阅
    } finally {
      setAssistantDispatchPort(null);
      setAssistantFrameSource(null);
    }
  });

  it("stopMandate→退订该会话", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "stop 验收",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId.slice(0, 6)}` },
    }));
    const disposed: string[] = [];
    setAssistantFrameSource({
      subscribe(sessionId, _identity, _hostPath, _onFrame) {
        return { dispose: () => disposed.push(sessionId) };
      },
    });
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      if (!approved.ok) return;
      const stopped = await service.stopMandate({ ticketId: approved.value.ticketId });
      expect(stopped.ok).toBe(true);
      expect(disposed).toEqual([approved.value.sessionId]);
    } finally {
      setAssistantDispatchPort(null);
      setAssistantFrameSource(null);
    }
  });

  // 修复（2026-11-07 dev 实机）：turnHeader 终态帧归账——轮在产出 assistantText 之前
  // 失败时 CLI 只发 turnHeader failed/completedInterrupted，旧解析静默丢弃 → 工单永久
  // 卡 running（实机 T-aef40cf3）。
  it("parseTicketFrameEvents：turnHeader failed/completedInterrupted（无 assistantText）→turn_failed/turn_cancelled", () => {
    const headerFrame = (state: string) => ({
      topic: "conversation/s1",
      sentAt: 1234,
      payload: {
        kind: "deltas",
        deltas: [{ op: "row.upserted", row: { kind: "turnHeader", state, sourceCommandId: "cmd-1" } }],
      },
    });
    expect(parseTicketFrameEvents(headerFrame("failed"), "s1")).toEqual([
      { ticketId: "", atMs: 1234, kind: "turn_failed", failReason: "turn_header_failed" },
    ]);
    expect(parseTicketFrameEvents(headerFrame("completedInterrupted"), "s1")).toEqual([
      { ticketId: "", atMs: 1234, kind: "turn_cancelled", failReason: "turn_header_interrupted" },
    ]);
    // running/completedSuccess 不译（completedSuccess 由 assistantText complete 承载 summary）。
    expect(parseTicketFrameEvents(headerFrame("running"), "s1")).toEqual([]);
    expect(parseTicketFrameEvents(headerFrame("completedSuccess"), "s1")).toEqual([]);
  });

  it("parseTicketFrameEvents：同帧 assistantText 终态在先→turnHeader 不双发（同轮单事件）", () => {
    const frame = {
      topic: "conversation/s1",
      sentAt: 1234,
      payload: {
        kind: "deltas",
        deltas: [
          { op: "row.appended", row: { kind: "assistantText", state: "failed" } },
          { op: "row.upserted", row: { kind: "turnHeader", state: "failed", sourceCommandId: "cmd-1" } },
        ],
      },
    };
    expect(parseTicketFrameEvents(frame, "s1")).toEqual([
      { ticketId: "", atMs: 1234, kind: "turn_failed", failReason: "assistant_row_failed" },
    ]);
  });

  it("parseTicketFrameEvents：topic 不匹配/帧形态异常→空数组（不抛错）", () => {
    expect(parseTicketFrameEvents(null, "s1")).toEqual([]);
    expect(
      parseTicketFrameEvents(
        { topic: "conversation/other", payload: { kind: "deltas", deltas: [] } },
        "s1",
      ),
    ).toEqual([]);
    expect(
      parseTicketFrameEvents({ topic: "conversation/s1", payload: { kind: "garbage" } }, "s1"),
    ).toEqual([]);
    expect(
      parseTicketFrameEvents(
        {
          topic: "conversation/s1",
          payload: { kind: "deltas", deltas: [null, 42, { op: "row.appended" }] },
        },
        "s1",
      ),
    ).toEqual([]);
  });

  // 全链审查遗留 16 修复回归：engine sessionWatches 此前无服务级出口（全量释放
  // 依赖 droraAgentService 同批 dispose 的级联假设）——dispose() 拆全部帧订阅。
  it("dispose()→服务级订阅收口：全部在挂帧订阅一次拆除", async () => {
    const { service } = createService();
    // 三个不同 workspace：同 workspace 空声明=整域互斥（spec §9/W2），第二三单会
    // 进 queued 而不派发——收口用例要的是三张并行活动票，各占一域。
    const recorded = await Promise.all(
      ["a", "b", "c"].map((key) =>
        service.recordTrigger({
          text: `收口验收 ${key}`,
          simulated: ASSISTANT_STRENGTHS.explicit,
          targetWorkspaceIdentity: `ws-${key}`,
        }),
      ),
    );
    expect(recorded.every((r) => r.ok)).toBe(true);
    const decisions = (await service.getSnapshot()).decisions;
    let dispatchCount = 0;
    setAssistantDispatchPort(async (request) => {
      dispatchCount += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${dispatchCount}` } };
    });
    const disposed: string[] = [];
    setAssistantFrameSource({
      subscribe(sessionId: string) {
        return { dispose: () => disposed.push(sessionId) };
      },
    });
    try {
      // 三张票逐一放行（commandId 尾序号 1/2/3 → 三条不同会话订阅）。
      for (const [index, decision] of decisions.entries()) {
        const approved = await service.approveDecision({
          decisionId: decision.id,
          targetWorkspaceIdentity: `ws-${["a", "b", "c"][index]}`,
        });
        expect(approved.ok).toBe(true);
      }
      expect(disposed).toEqual([]); // 全部在挂
      service.dispose();
      expect(disposed.sort()).toEqual(["sess-1", "sess-2", "sess-3"]);
    } finally {
      setAssistantDispatchPort(null);
      setAssistantFrameSource(null);
    }
  });
});
