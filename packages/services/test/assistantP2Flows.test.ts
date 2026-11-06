/**
 * P2 host 内核服务流测试（02 详设 §1.3/§2/§3/§4/§5）：
 * Router 候选卡循环（建议预填/降级 Tier3）、Mode C 附着（Tier2 校验/W3 排队）、
 * 软预算 queued FIFO、带序 commandId/锚、换代（锚失配/session.removed）、
 * teamActivity 第三信号、W1 worktree 计划与终态清理。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantAttachPort,
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantGitWorktreePort,
  setAssistantRouterPort,
  setAssistantSessionsIndexPort,
  setAssistantWorkspaceProbePort,
} from "../src/assistant-tickets/assistantPorts.js";
import type { AssistantSessionSummaryLite } from "../src/assistant-tickets/assistantPorts.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
  setAssistantDispatchPort(null);
  setAssistantAttachPort(null);
  setAssistantFrameSource(null);
  setAssistantRouterPort(null);
  setAssistantSessionsIndexPort(null);
  setAssistantWorkspaceProbePort(null);
  setAssistantGitWorktreePort(null);
}

function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  return { service, db };
}

/** 记录触发并放行到工单（显式触发 → 决策卡 → approve）。 */
async function recordAndApprove(
  service: ReturnType<typeof createAssistantTicketsService>,
  input: {
    text?: string;
    targetWorkspaceIdentity?: string;
    dispatchMode?: "A" | "B";
    attachToSessionId?: string;
  },
) {
  const recorded = await service.recordTrigger({
    text: input.text ?? "修复登录白屏",
    simulated: ASSISTANT_STRENGTHS.explicit,
    ...(input.targetWorkspaceIdentity ? { targetWorkspaceIdentity: input.targetWorkspaceIdentity } : {}),
  });
  expect(recorded.ok).toBe(true);
  if (!recorded.ok) throw new Error("recordTrigger failed");
  const snapshot = await service.getSnapshot();
  const decision = snapshot.decisions.find((d) => d.triggerId === recorded.value.triggerId);
  expect(decision).toBeDefined();
  if (!decision) throw new Error("decision missing");
  return await service.approveDecision({
    decisionId: decision.id,
    ...(input.targetWorkspaceIdentity ? { targetWorkspaceIdentity: input.targetWorkspaceIdentity } : {}),
    ...(input.dispatchMode ? { dispatchMode: input.dispatchMode } : {}),
    ...(input.attachToSessionId ? { attachToSessionId: input.attachToSessionId } : {}),
  });
}

afterEach(() => {
  clearPorts();
});

describe("Router 候选卡循环（02 §1.3）", () => {
  it("Router 建议预填：dispatch 臂写进决策卡（snapshot.routerSuggestion）", async () => {
    const { service } = createService();
    setAssistantRouterPort(async ({ card }) => {
      expect(card).toContain("修复登录白屏");
      expect(card).toContain("只路由，不执行");
      return {
        ok: true,
        output: `评估：${JSON.stringify({
          dispatch: {
            targetWorkspaceIdentity: "ws-a",
            permissionTier: "build",
            briefBase: "verbatim",
            appendix: "建议先查路由表",
          },
          evidence: [{ quote: "修复登录白屏" }],
        })}`,
      };
    });
    const recorded = await service.recordTrigger({
      text: "修复登录白屏",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(recorded.ok).toBe(true);
    // fire-and-forget 评估：事件驱动回填（无轮询等待——await 快照即让出事件循环）。
    let suggestion;
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await service.getSnapshot();
      suggestion = snapshot.decisions[0]?.routerSuggestion;
      if (suggestion) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(suggestion).toEqual({
      kind: "dispatch",
      targetWorkspaceIdentity: "ws-a",
      permissionTier: "build",
      briefBase: "verbatim",
      appendix: "建议先查路由表",
      evidence: ["修复登录白屏"],
    });
    const finalState = (await service.getSnapshot()).decisions[0]?.routerState;
    expect(finalState).toBe("suggested");
  });

  it("Router 输出不命中 schema → routerState=failed（Tier3 问人，不重试模型）", async () => {
    const { service } = createService();
    setAssistantRouterPort(async () => ({ ok: true, output: "我觉得应该 dispatch，但没给 JSON" }));
    await service.recordTrigger({ text: "x", simulated: ASSISTANT_STRENGTHS.explicit });
    let error: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      error = (await service.getSnapshot()).decisions[0]?.routerError;
      if (error) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(error).toBeDefined();
    expect((await service.getSnapshot()).decisions[0]?.routerState).toBe("failed");
  });

  it("Router 通道失败 → state=failed；通道未装配 → 无建议（P1 行为）", async () => {
    const { service } = createService();
    setAssistantRouterPort(async () => ({ ok: false, reason: "router 会话创建失败" }));
    await service.recordTrigger({ text: "x", simulated: ASSISTANT_STRENGTHS.explicit });
    for (let i = 0; i < 20; i += 1) {
      if ((await service.getSnapshot()).decisions[0]?.routerState) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await service.getSnapshot()).decisions[0]?.routerState).toBe("failed");
    clearPorts();
    const second = createService();
    await second.service.recordTrigger({ text: "y", simulated: ASSISTANT_STRENGTHS.explicit });
    expect((await second.service.getSnapshot()).decisions[0]?.routerState).toBeUndefined();
  });
});

describe("Tier2 候选集→Router 带证据选择（02 §2；P2 审查修复接线）", () => {
  it("listSessions 硬过滤产出候选进候选卡；Router attach 建议携带真实 sessionId（闭环）", async () => {
    const { service } = createService();
    let receivedCard = "";
    setAssistantRouterPort(async ({ card }) => {
      receivedCard = card;
      return {
        ok: true,
        output: JSON.stringify({
          attach: { sessionId: "sess-live", targetWorkspaceIdentity: "ws-a" },
          evidence: [{ quote: "继续上次" }],
        }),
      };
    });
    setAssistantSessionsIndexPort({
      async listSessions(identity) {
        expect(identity).toBe("ws-a");
        return {
          ok: true,
          sessions: [
            {
              sessionId: "sess-live",
              title: "重构导出",
              phase: "completedInterrupted",
              sessionEnded: false,
              updatedAtMs: Date.now() - 3_600_000,
            },
            {
              sessionId: "sess-busy",
              title: "正在跑",
              phase: "running",
              sessionEnded: false,
              updatedAtMs: Date.now(),
            },
            {
              sessionId: "sess-old",
              title: "去年会话",
              phase: "completedSuccess",
              sessionEnded: false,
              updatedAtMs: Date.now() - 30 * 24 * 3_600_000,
            },
          ] as AssistantSessionSummaryLite[],
        };
      },
      async probeSession() {
        return { kind: "ok" } as const;
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    await service.recordTrigger({
      text: "继续上次的重构",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    let suggestion;
    for (let i = 0; i < 20; i += 1) {
      suggestion = (await service.getSnapshot()).decisions[0]?.routerSuggestion;
      if (suggestion) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // 候选卡携带硬过滤后的候选（busy/过期不入选）——Router 的 attach 臂自此有真实来源，
    // 不再只能靠原文臆测 sessionId（此前候选集生成缺失，真实链路 Mode C 不可达）。
    expect(receivedCard).toContain("【附着候选】目标 workspace 的可附着会话");
    expect(receivedCard).toContain("sess-live");
    expect(receivedCard).not.toContain("sess-busy");
    expect(receivedCard).not.toContain("sess-old");
    expect(suggestion?.kind).toBe("attach");
    expect(suggestion?.sessionId).toBe("sess-live");
    expect((await service.getSnapshot()).decisions[0]?.routerState).toBe("suggested");
  }, 20_000);

  it("候选通道失败/无目标 workspace → 空候选（候选卡不出候选段，诚实降级 Tier3）", async () => {
    const { service } = createService();
    let receivedCard = "";
    setAssistantRouterPort(async ({ card }) => {
      receivedCard = card;
      return { ok: true, output: '{"hold":{"reason":"无候选"},"evidence":[]}' };
    });
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: false as const, reason: "会话索引不可用" };
      },
      async probeSession() {
        return { kind: "ok" } as const;
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    await service.recordTrigger({ text: "帮个忙", simulated: ASSISTANT_STRENGTHS.explicit });
    for (let i = 0; i < 20; i += 1) {
      if ((await service.getSnapshot()).decisions[0]?.routerState) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(receivedCard).not.toContain("【附着候选】目标 workspace 的可附着会话");
    expect(receivedCard).toContain("禁止编造 sessionId");
    expect((await service.getSnapshot()).decisions[0]?.routerState).toBe("suggested");
  }, 20_000);
});

describe("带序 commandId 与锚（02 §3）", () => {
  it("首次派发 commandId=<ticketId>-1；成功后锚回写（snapshot.anchorCommandId）", async () => {
    const { service } = createService();
    const commandIds: string[] = [];
    setAssistantDispatchPort(async (request) => {
      commandIds.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-a" } };
    });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(commandIds).toHaveLength(1);
    expect(commandIds[0]).toBe(`${approved.value.ticketId}-1`);
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(ticket?.anchorCommandId).toBe(commandIds[0]);
    expect(ticket?.dispatchMode).toBe("A");
  });
});

describe("Mode C 附着（02 §2）", () => {
  it("attachToSessionId → attach 端口投既有会话；incarnation cause=attached；dispatchMode=C", async () => {
    const { service } = createService();
    const attached: Array<{ sessionId: string; commandId: string }> = [];
    setAssistantAttachPort(async (request) => {
      attached.push({ sessionId: request.sessionId, commandId: request.commandId });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: request.sessionId } };
    });
    // 派发桥校验（Tier2）：probeSession ok 才可投。
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
      },
      async probeSession(_identity, sessionId) {
        return sessionId === "sess-user" ? ({ kind: "ok" } as const) : ({ kind: "missing", deleted: false } as const);
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    const approved = await recordAndApprove(service, {
      targetWorkspaceIdentity: "ws-a",
      attachToSessionId: "sess-user",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.sessionId).toBe("sess-user");
    expect(attached).toHaveLength(1);
    expect(attached[0].commandId).toBe(`${approved.value.ticketId}-1`);
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(ticket?.dispatchMode).toBe("C");
  });

  it("附着目标校验失败（不存在）→ attachTargetInvalid；决策卡/工单零消费可改选", async () => {
    const { service } = createService();
    setAssistantAttachPort(async () => {
      throw new Error("校验失败不应到达附着端口");
    });
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
      },
      async probeSession() {
        return { kind: "missing", deleted: true } as const;
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    const recorded = await service.recordTrigger({
      text: "继续上次",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === recorded.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
      attachToSessionId: "sess-gone",
    });
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe(ASSISTANT_ERROR_CODES.attachTargetInvalid);
    // 预检在放行事务之前：决策卡保持未决（decided_by=gate），无工单产生——人工可改选
    // "开新会话"（02 §2 Tier3 选项恒在）。
    const after = (await service.getSnapshot()).decisions.find((d) => d.id === decision.id);
    expect(after?.decidedBy).toBe("gate");
    expect(after?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect((await service.getSnapshot()).tickets).toHaveLength(0);
  });
});

describe("workspace 探测预检（spec §8「拒绝猜测，问人」；P2 审查修复三口径收口）", () => {
  it("探测端口在位而目标探测失败 → 放行拒绝且决策卡不消费（可改选后重放）", async () => {
    const { service } = createService();
    setAssistantWorkspaceProbePort(async () => ({
      ok: false as const,
      reason: "目标非本地绝对路径（P2 W1 本地限定）",
    }));
    setAssistantDispatchPort(async () => {
      throw new Error("预检失败不应到达派发");
    });
    const recorded = await service.recordTrigger({
      text: "帮我改这个目录",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "remote:ws-x",
    });
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === recorded.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "remote:ws-x",
    });
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe(ASSISTANT_ERROR_CODES.dispatchRejected);
    expect(approved.error.reason).toContain("决策卡未消费");
    // 决策卡保持未决（decided_by=gate），无工单产生——spec §8「问人」承接（改选目标可重放）。
    const after = (await service.getSnapshot()).decisions.find((d) => d.id === decision.id);
    expect(after?.decidedBy).toBe("gate");
    expect(after?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect((await service.getSnapshot()).tickets).toHaveLength(0);
  }, 20_000);

  it("探测端口缺席（P1 形态）→ 不预检，按 workspace 域派发（未隔离明示）", async () => {
    const { service } = createService();
    const dispatched: Array<{ hostPath?: string }> = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push({ hostPath: request.hostPath });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-noprobe" } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(approved.ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.hostPath).toBeUndefined(); // 无探测即无 W1 落位（装配层回退）
  }, 20_000);
});

describe("W1 worktree（02 §4）", () => {
  it("git 根 + probe 可用 → worktree 域落列 + hostPath 传入派发端口；终态清理", async () => {
    const { service } = createService();
    const addCalls: Array<{ path: string; branch: string }> = [];
    const removeCalls: string[] = [];
    setAssistantWorkspaceProbePort(async (identity) => ({
      ok: true,
      workspacePath: identity,
      isGitRoot: true,
    }));
    setAssistantGitWorktreePort({
      async addWorktree({ path, branch }) {
        addCalls.push({ path, branch });
        return { ok: true };
      },
      async removeWorktree({ path }) {
        removeCalls.push(path);
        return { ok: true };
      },
    });
    const dispatched: Array<{ hostPath?: string }> = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push({ hostPath: request.hostPath });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-w1" } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/repo" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(ticket?.writeDomain?.kind).toBe("worktree");
    if (ticket?.writeDomain?.kind === "worktree") {
      expect(ticket.writeDomain.branch).toBe(`mate/${approved.value.ticketId}`);
      expect(removeCalls).toHaveLength(0);
      // 终态 → worktree remove（分支保留）。
      service.applyTicketTurnEvent({
        ticketId: approved.value.ticketId,
        atMs: Date.now() + 5_000,
        kind: "turn_completed",
        outputSummary: "完成",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(removeCalls).toHaveLength(1);
      expect(removeCalls[0]).toBe(ticket.writeDomain.path);
    }
    expect(addCalls).toHaveLength(1);
    expect(dispatched[0]?.hostPath).toBe(addCalls[0].path);
  }, 20_000);

  it("worktree add 失败 → 派发失败留痕（不假装隔离）", async () => {
    const { service } = createService();
    setAssistantWorkspaceProbePort(async (identity) => ({
      ok: true,
      workspacePath: identity,
      isGitRoot: true,
    }));
    setAssistantGitWorktreePort({
      async addWorktree() {
        return { ok: false, reason: "branch already exists" };
      },
      async removeWorktree() {
        return { ok: true };
      },
    });
    setAssistantDispatchPort(async () => {
      throw new Error("不应到达派发");
    });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/repo" });
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.reason).toContain("worktree add 失败");
    const ticket = (await service.getSnapshot()).tickets[0];
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
    expect(ticket?.failReason).toContain("branch already exists");
  }, 20_000);
});

describe("Mode B 建队与 teamActivity 第三信号（02 §5）", () => {
  it("dispatchMode=B → 端口收到 B + /team 指示；team completed→done、cancelled→failed", async () => {
    const { service } = createService();
    const briefs: string[] = [];
    const modes: string[] = [];
    setAssistantDispatchPort(async (request) => {
      briefs.push(request.brief);
      modes.push(request.dispatchMode);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-team" } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approved = await recordAndApprove(service, {
      targetWorkspaceIdentity: "ws-a",
      dispatchMode: "B",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(modes).toEqual(["B"]);
    expect(briefs[0]).toContain("/team");
    expect(briefs[0]).toContain("不得跳过审批门");
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(ticket?.dispatchMode).toBe("B");
    // 第三信号：teamActivity 归账（sessions-index 桥路径，按 sessionId 反查）。
    // staged 非终态 → 返回 false，状态推进 running。
    expect(
      service.applyTeamActivityForSession({ sessionId: "sess-team", teamStatus: "staged", atMs: Date.now() + 1_000 }),
    ).toBe(false);
    let after = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(after?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(
      service.applyTeamActivityForSession({ sessionId: "sess-team", teamStatus: "completed", atMs: Date.now() + 2_000 }),
    ).toBe(true);
    after = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(after?.status).toBe(ASSISTANT_TICKET_STATUSES.done);
  }, 20_000);

  it("team cancelled → failed + reason=team_cancelled（诚实留痕）", async () => {
    const { service } = createService();
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: "sess-team-2" },
    }));
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approved = await recordAndApprove(service, {
      targetWorkspaceIdentity: "ws-a",
      dispatchMode: "B",
    });
    if (!approved.ok) throw new Error("approve failed");
    expect(
      service.applyTicketTeamEvent({ ticketId: approved.value.ticketId, teamStatus: "cancelled", atMs: Date.now() + 1_000 }),
    ).toBe(true);
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === approved.value.ticketId);
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
    expect(ticket?.failReason).toBe("team_cancelled");
  }, 20_000);
});

describe("P7 查询直答（08 §3.3；观察模式 query_status 全链）", () => {
  it("查询类候选卡 → Router query_status 臂 → 直答：无工单产生/decision 翻 status_replied/answer 投影/dismiss 出清", async () => {
    const { service } = createService();
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-q" } };
    });
    const seenCards: string[] = [];
    setAssistantRouterPort(async (input: { card: string }) => {
      seenCards.push(input.card);
      return {
        ok: true,
        output: JSON.stringify({
          query_status: {
            scope: { kind: "status", workspaceIdentity: "ws-a" },
            reason: "进度查询，无需执行",
          },
          evidence: [{ quote: "进度怎样" }],
        }),
      };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const recorded = await service.recordTrigger({
      text: "ws-a 进度怎样",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // 无工单产生（查询不派发）；decision 翻 status_replied 并携带 answer。
    expect(dispatched).toBe(0);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
    const decision = snapshot.decisions[0];
    expect(decision?.outcome).toBe("status_replied");
    expect(decision?.answer).toContain("ws-a");
    // dismiss 出清（答复卡离开呈现集）。
    const dismissed = await service.dismissQueryReply({ decisionId: decision?.id ?? 0 });
    expect(dismissed.ok).toBe(true);
    const after = await service.getSnapshot();
    expect(after.decisions[0]?.outcome).toBe("ignored");
  }, 20_000);

  it("候选卡附【台账速览】段（P7 批 2 方案乙：Router 零进程感知账本；空台账缺席）", async () => {
    const { service } = createService();
    const seenCards: string[] = [];
    setAssistantRouterPort(async (input: { card: string }) => {
      seenCards.push(input.card);
      return { ok: false, reason: "router off" };
    });
    // 空台账 → 速览段缺席（诚实缺省）。
    await service.recordTrigger({
      text: "空台账触发",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    // 空台账 → 速览段缺席（断言锚=段体行「活动 0 / 待决策 0」；约言概念词用【】不误伤）。
    expect(seenCards.at(-1)).not.toContain("活动 0 / 待决策");
    // 造一台活动工单（放行直派）→ 下一张候选卡携带速览段。
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: "sess-d" },
    }));
    const recorded = await service.recordTrigger({
      text: "修复登录白屏",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    const decision = (await service.getSnapshot()).decisions.at(-1);
    await service.approveDecision({ decisionId: decision?.id ?? 0, targetWorkspaceIdentity: "ws-a" });
    await service.recordTrigger({
      text: "再看看",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(seenCards.at(-1)).toContain("【台账速览】");
    expect(seenCards.at(-1)).toContain("活动 1 / 待决策");
  }, 20_000);
});

describe("换代（spec §8；02 §3）", () => {
  it("follow-up 锚校验失配（会话删除）→ 换代重派（浓缩段）+ follow-up 投新代", async () => {
    const { service } = createService();
    let sessionExists = true;
    const commandIds: string[] = [];
    const briefs: string[] = [];
    setAssistantDispatchPort(async (request) => {
      commandIds.push(request.commandId);
      briefs.push(request.brief);
      // 第 1 次派发=初代（sess-gen1）；第 2 次=换代重派（sess-gen2）。
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-gen${commandIds.length}` } };
    });
    // P1-2 回归（2026-11-05 全链审查修复）：跟踪订阅/退订——换代必须在事务改写
    // incarnation 之前退订旧会话（旧实现事务后读行 sessionId=null → unwatch 恒 no-op）。
    const frameSubscribed: string[] = [];
    const frameDisposed: string[] = [];
    setAssistantFrameSource({
      subscribe(sessionId: string) {
        frameSubscribed.push(sessionId);
        return { dispose: () => frameDisposed.push(sessionId) };
      },
    });
    // follow-up 换代后的直投走 attach 端口（Mode C 通道）——第三段 commandId 记在附着面。
    setAssistantAttachPort(async (request) => {
      commandIds.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: request.sessionId } };
    });
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
      },
      async probeSession(_identity, sessionId) {
        return sessionId === "sess-gen1" && !sessionExists
          ? ({ kind: "missing", deleted: true } as const)
          : ({ kind: "ok" } as const);
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    if (!approved.ok) throw new Error("approve failed");
    // 锚回写依赖派发成功（commandId-1）；anchorCommandId 存在才可 follow-up。
    expect((await service.getSnapshot()).tickets[0]?.anchorCommandId).toBe(`${approved.value.ticketId}-1`);
    sessionExists = false; // fork/rewind/删除
    const followUp = await service.followUp({ ticketId: approved.value.ticketId, text: "继续，补上测试" });
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    // 换代重派（commandId-2 携浓缩段）+ follow-up 直投新代（commandId-3）。
    expect(commandIds).toEqual([
      `${approved.value.ticketId}-1`,
      `${approved.value.ticketId}-2`,
      `${approved.value.ticketId}-3`,
    ]);
    expect(briefs[1]).toContain("大副换代重派");
    expect(briefs[1]).toContain("未确认增量");
    expect(followUp.value.sessionId).toBe("sess-gen2");
    const ticket = (await service.getSnapshot()).tickets[0];
    expect(ticket?.generationCount).toBe(1);
    expect(ticket?.anchorCommandId).toBe(`${approved.value.ticketId}-3`);
    // 初代订阅→换代退订旧会话→新代订阅（第三次=attach 直投对 sess-gen2 的重挂自替）。
    // 关键回归信号：sess-gen1 的退订发生在换代路径（旧实现恒 no-op，frameDisposed 为空）。
    expect(frameSubscribed).toEqual(["sess-gen1", "sess-gen2", "sess-gen2"]);
    expect(frameDisposed).toEqual(["sess-gen1", "sess-gen2"]);
  }, 20_000);

  it("session.removed（触发源②）→ notifySessionRemoved → 换代重派", async () => {
    const { service } = createService();
    const commandIds: string[] = [];
    setAssistantDispatchPort(async (request) => {
      commandIds.push(request.commandId);
      return {
        ok: true,
        value: { ticketId: request.ticketId, sessionId: `sess-${commandIds.length}` },
      };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    if (!approved.ok) throw new Error("approve failed");
    service.notifySessionRemoved("sess-1");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(commandIds).toHaveLength(2);
    const ticket = (await service.getSnapshot()).tickets[0];
    expect(ticket?.generationCount).toBe(1);
    expect(ticket?.sessionId).toBe("sess-2");
  }, 20_000);

  // P2 审查修复回归：锚对账「不可用」≠失配——不触发换代重派（spec §8 触发源封闭）。
  it("锚对账不可用（reconcile 失败/快照缺席）→ followUp 如实报错，不换代不猜测", async () => {
    const { service } = createService();
    const commandIds: string[] = [];
    setAssistantDispatchPort(async (request) => {
      commandIds.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${commandIds.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
      },
      async probeSession() {
        // reconcile 不可用且快照投影未就绪的真实形态（node.ts 端口回退分支同款）。
        return { kind: "unavailable", reason: "reconcile 不可用且快照无该会话（缺席≠删除，不猜测）" } as const;
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    const approved = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    if (!approved.ok) throw new Error("approve failed");
    expect((await service.getSnapshot()).tickets[0]?.anchorCommandId).toBe(`${approved.value.ticketId}-1`);
    const followUp = await service.followUp({ ticketId: approved.value.ticketId, text: "继续" });
    expect(followUp.ok).toBe(false);
    if (followUp.ok) return;
    expect(followUp.error.code).toBe(ASSISTANT_ERROR_CODES.anchorMismatch);
    expect(followUp.error.reason).toContain("锚对账不可用");
    expect(followUp.error.reason).toContain("不换代");
    // 工单原代保留：无换代归档、无重派（commandId 只有一次初派）。
    expect(commandIds).toHaveLength(1);
    const ticket = (await service.getSnapshot()).tickets[0];
    expect(ticket?.generationCount).toBe(0);
    expect(ticket?.sessionId).toBe("sess-1");
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
  }, 20_000);
});

describe("assistantActivity 聚合（02 §6）", () => {
  it("computeMateActivityByWorkspace：活动工单/待决策卡按 workspace 折叠", async () => {
    const { computeMateActivityByWorkspace } = await import(
      "../src/assistant-tickets/mateActivity.js"
    );
    const { service } = createService();
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId.slice(0, 5)}` },
    }));
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    // 再造一张未决决策卡（不放行）。
    await service.recordTrigger({
      text: "另一件事",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    const snapshot = await service.getSnapshot();
    const { byWorkspaceIdentity } = computeMateActivityByWorkspace(snapshot);
    const activity = byWorkspaceIdentity.get("ws-a");
    expect(activity).toEqual({
      activeCount: 1,
      pendingDecisions: 1,
      updatedAtMs: snapshot.updatedAtMs,
    });
    expect(byWorkspaceIdentity.size).toBe(1);
  }, 20_000);
});
