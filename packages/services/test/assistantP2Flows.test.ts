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

describe("软预算 queued FIFO（spec §9）", () => {
  it("预算=1：第二单排队；首单终态→FIFO 释放并派发", async () => {
    const { service, db } = createService();
    db.transaction((raw) => {
      raw
        .prepare("INSERT INTO kv(key, value, updated_ms) VALUES ('budget_max_active_per_workspace','1',0) ON CONFLICT(key) DO UPDATE SET value='1'")
        .run();
    });
    const sessions: string[] = [];
    setAssistantDispatchPort(async (request) => {
      sessions.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${sessions.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const first = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(first.ok).toBe(true);
    const second = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.queued).toBe(true);
    let ticket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.queued);
    expect(ticket?.queuedReason).toContain("软预算");
    // 首单终态（turn_completed）→ onTicketTerminal → FIFO 释放。
    const firstTicket = (await service.getSnapshot()).tickets.find(
      (t) => t.status === ASSISTANT_TICKET_STATUSES.running,
    );
    if (!firstTicket) throw new Error("first running ticket missing");
    service.applyTicketTurnEvent({
      ticketId: firstTicket.id,
      atMs: Date.now() + 5_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    // FIFO 释放是终态钩子后的异步链（queued→dispatched→端口→回写 running）。
    await new Promise((resolve) => setTimeout(resolve, 30));
    ticket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(sessions).toHaveLength(2);
  }, 20_000);

  it("写域冲突（W2 空声明彼此互斥）：同 workspace 第二单排队而非并行", async () => {
    const { service } = createService();
    // 非 git 目录 → W2 声明域（空集）；空集彼此冲突 → 第二单排队。
    setAssistantWorkspaceProbePort(async () => ({
      ok: true,
      workspacePath: "D:/plain-dir",
      isGitRoot: false,
    }));
    const sessions: string[] = [];
    setAssistantDispatchPort(async (request) => {
      sessions.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${sessions.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const first = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    let firstTicket = (await service.getSnapshot()).tickets.find((t) => t.id === first.value.ticketId);
    expect(firstTicket?.writeDomain?.kind).toBe("paths");
    const second = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondTicket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(secondTicket?.status).toBe(ASSISTANT_TICKET_STATUSES.queued);
    expect(secondTicket?.queuedReason).toContain("写域重叠");
    expect(sessions).toHaveLength(1);
  }, 20_000);

  // ---- P2 审查修复回归：queued FIFO 释放按落库 dispatch_intent 重放派发形态 ----
  // （此前释放路径读派发成功才写入的 dispatch_mode 列——queued 行恒 NULL → 队头一律
  // Mode A/build 直派原文，Mode B 的 /team 指示与 Mode C 的附着目标在排队后丢失。）

  it("Mode B 排队释放：重套 /team 建队指示并恢复放行权限档（不退化为 Mode A/build）", async () => {
    const { service, db } = createService();
    db.transaction((raw) => {
      raw
        .prepare("INSERT INTO kv(key, value, updated_ms) VALUES ('budget_max_active_per_workspace','1',0) ON CONFLICT(key) DO UPDATE SET value='1'")
        .run();
    });
    const requests: Array<{
      commandId: string;
      dispatchMode: string;
      permissionTier: string;
      brief: string;
    }> = [];
    setAssistantDispatchPort(async (request) => {
      requests.push({
        commandId: request.commandId,
        dispatchMode: request.dispatchMode,
        permissionTier: request.permissionTier,
        brief: request.brief,
      });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${requests.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const first = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(first.ok).toBe(true);
    // 第二单按「建队 + guarded 档」放行 → 软预算满 → queued（意图落库 dispatch_intent）。
    const recorded = await service.recordTrigger({
      text: "多角色并行重构",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === recorded.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const second = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
      dispatchMode: "B",
      permissionTier: "guarded",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.queued).toBe(true);
    let queuedTicket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(queuedTicket?.status).toBe(ASSISTANT_TICKET_STATUSES.queued);
    // 首单终态 → FIFO 释放 → 按落库意图 Mode B/guarded 派发，brief 重套 /team 指示。
    const firstTicket = (await service.getSnapshot()).tickets.find(
      (t) => t.status === ASSISTANT_TICKET_STATUSES.running,
    );
    if (!firstTicket) throw new Error("first running ticket missing");
    service.applyTicketTurnEvent({
      ticketId: firstTicket.id,
      atMs: Date.now() + 5_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.dispatchMode).toBe("B");
    expect(requests[1]?.permissionTier).toBe("guarded");
    expect(requests[1]?.commandId).toBe(`${second.value.ticketId}-1`);
    expect(requests[1]?.brief).toContain("/team");
    expect(requests[1]?.brief).toContain("不得跳过审批门");
    // brief 列恒存原文（verbatim，指示不落库）；释放重套不写回原文列。
    queuedTicket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(queuedTicket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(queuedTicket?.dispatchMode).toBe("B");
    expect((await service.getSnapshot()).tickets.find((t) => t.id === firstTicket.id)?.brief).not.toContain("/team");
  }, 20_000);

  it("Mode C 排队释放：附着原目标会话（不退化为开新会话）", async () => {
    const { service, db } = createService();
    db.transaction((raw) => {
      raw
        .prepare("INSERT INTO kv(key, value, updated_ms) VALUES ('budget_max_active_per_workspace','1',0) ON CONFLICT(key) DO UPDATE SET value='1'")
        .run();
    });
    const dispatched: string[] = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${dispatched.length}` } };
    });
    const attached: Array<{ sessionId: string; commandId: string }> = [];
    setAssistantAttachPort(async (request) => {
      attached.push({ sessionId: request.sessionId, commandId: request.commandId });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: request.sessionId } };
    });
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
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const first = await recordAndApprove(service, { targetWorkspaceIdentity: "ws-a" });
    expect(first.ok).toBe(true);
    const recorded = await service.recordTrigger({
      text: "继续上次会话",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === recorded.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const second = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
      attachToSessionId: "sess-user",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.queued).toBe(true);
    expect(attached).toHaveLength(0); // 预算满即排队，未触达附着端口
    // 首单终态 → FIFO 释放 → 按落库意图走 attachDispatch 附着原目标。
    const firstTicket = (await service.getSnapshot()).tickets.find(
      (t) => t.status === ASSISTANT_TICKET_STATUSES.running,
    );
    if (!firstTicket) throw new Error("first running ticket missing");
    service.applyTicketTurnEvent({
      ticketId: firstTicket.id,
      atMs: Date.now() + 5_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(dispatched).toHaveLength(1); // 未开新会话
    expect(attached).toHaveLength(1);
    expect(attached[0]?.sessionId).toBe("sess-user");
    expect(attached[0]?.commandId).toBe(`${second.value.ticketId}-1`);
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === second.value.ticketId);
    expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(ticket?.dispatchMode).toBe("C");
    expect(ticket?.sessionId).toBe("sess-user");
  }, 20_000);

  it("释放复检写域冲突：队头与仍在活动的工单重叠则保持 queued（不与对手并存）", async () => {
    const { service, db } = createService();
    // 预算 3：排队原因是写域重叠而非预算——释放时预算已空仍须复检冲突。
    db.transaction((raw) => {
      raw
        .prepare("INSERT INTO kv(key, value, updated_ms) VALUES ('budget_max_active_per_workspace','3',0) ON CONFLICT(key) DO UPDATE SET value='3'")
        .run();
    });
    setAssistantWorkspaceProbePort(async () => ({
      ok: true,
      workspacePath: "D:/plain-dir",
      isGitRoot: false,
    }));
    const sessions: string[] = [];
    setAssistantDispatchPort(async (request) => {
      sessions.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${sessions.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    // 直改落列模拟「声明域」（W2 决策卡可编辑入口 P2 裁剪；P2 规划器对非 git 目录恒产
    // 空集=待声明整域彼此互斥，两个并行的已声明工单只能以落列后形态构造）。
    const declareDomain = (ticketId: string, path: string): void => {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET write_domain = ? WHERE id = ?")
          .run(JSON.stringify({ kind: "paths", paths: [path] }), ticketId);
      });
    };
    const x = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    declareDomain(x.value.ticketId, "D:/plain-dir/src");
    const z = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    // Z 与 X 空集互斥会经闸排队；直改为「已声明不相交域」的 running 形态（声明后合法并行）。
    db.transaction((raw) => {
      raw
        .prepare("UPDATE ticket SET status = 'running', write_domain = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "paths", paths: ["D:/plain-dir/docs"] }), z.value.ticketId);
    });
    // B 放行：预算未满（2<3），但空声明集与 X（src）重叠 → queued（写域重叠）。
    const b = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const bTicket = (await service.getSnapshot()).tickets.find((t) => t.id === b.value.ticketId);
    expect(bTicket?.status).toBe(ASSISTANT_TICKET_STATUSES.queued);
    expect(bTicket?.queuedReason).toContain("写域重叠");
    // 无关工单 Z 终态 → 触发 releaseNextQueued：预算已空（活动仅 X），但队头 B 与 X 仍重叠。
    service.applyTicketTurnEvent({
      ticketId: z.value.ticketId,
      atMs: Date.now() + 5_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sessions).toHaveLength(1); // 释放被冲突复检拦下，B 未派发（Z 经闸排队未过端口）
    const after = (await service.getSnapshot()).tickets.find((t) => t.id === b.value.ticketId);
    expect(after?.status).toBe(ASSISTANT_TICKET_STATUSES.queued);
    // 对照：X 也终态后（重叠对手消失），B 才按 FIFO 释放。
    service.applyTicketTurnEvent({
      ticketId: x.value.ticketId,
      atMs: Date.now() + 6_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sessions).toHaveLength(2);
    const released = (await service.getSnapshot()).tickets.find((t) => t.id === b.value.ticketId);
    expect(released?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
  }, 20_000);

  it("队头声明域与活动工单不相交时正常释放（冲突复检不误伤 FIFO）", async () => {
    const { service, db } = createService();
    db.transaction((raw) => {
      raw
        .prepare("INSERT INTO kv(key, value, updated_ms) VALUES ('budget_max_active_per_workspace','3',0) ON CONFLICT(key) DO UPDATE SET value='3'")
        .run();
    });
    setAssistantWorkspaceProbePort(async () => ({
      ok: true,
      workspacePath: "D:/plain-dir",
      isGitRoot: false,
    }));
    const sessions: string[] = [];
    setAssistantDispatchPort(async (request) => {
      sessions.push(request.commandId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${sessions.length}` } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const declareDomain = (ticketId: string, path: string): void => {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET write_domain = ? WHERE id = ?")
          .run(JSON.stringify({ kind: "paths", paths: [path] }), ticketId);
      });
    };
    const x = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    declareDomain(x.value.ticketId, "D:/plain-dir/src");
    const z = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    db.transaction((raw) => {
      raw
        .prepare("UPDATE ticket SET status = 'running', write_domain = ? WHERE id = ?")
        .run(JSON.stringify({ kind: "paths", paths: ["D:/plain-dir/docs"] }), z.value.ticketId);
    });
    // B 放行 → 与 X（src）空集互斥 → queued；随后落声明域 assets（与 src/docs 均不相交），
    // 模拟声明编辑后的排队形态。
    const b = await recordAndApprove(service, { targetWorkspaceIdentity: "D:/plain-dir" });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect((await service.getSnapshot()).tickets.find((t) => t.id === b.value.ticketId)?.status).toBe(
      ASSISTANT_TICKET_STATUSES.queued,
    );
    declareDomain(b.value.ticketId, "D:/plain-dir/assets");
    service.applyTicketTurnEvent({
      ticketId: z.value.ticketId,
      atMs: Date.now() + 5_000,
      kind: "turn_completed",
      outputSummary: "完成",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Z 经闸排队未过端口（X 声明域在先）；B 声明域与 X（src）不相交 → 复检放行。
    expect(sessions).toHaveLength(2);
    const released = (await service.getSnapshot()).tickets.find((t) => t.id === b.value.ticketId);
    expect(released?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(released?.queuedReason ?? null).toBeNull();
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
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
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
