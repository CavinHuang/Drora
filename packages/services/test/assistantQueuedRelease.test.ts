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
