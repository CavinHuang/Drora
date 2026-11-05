/**
 * P4 第二棒单测（04 详设 §3 落地注记）：汇报卡完整版服务面——工件只读核验矩阵
 * （通过→done / 无提交→滞留 / 端口缺席→P1 形态降级 done / git 失败→滞留待人工）、
 * awaiting 判据喂 watchdog（§1 判据表第 2 行激活）、人工确认出口
 * （confirmTicketOutput/confirmTicketIncrements）、按代成本投影（computeUsageByGeneration
 * 窗口归代/Σ不丢账/超界合并）、快照投影字段（briefFull/awaitingSinceMs/增量确认列）、
 * awaiting 占活动位（queuedRelease.activeCountFor）。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_ERROR_CODES, ASSISTANT_STRENGTHS, ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import type { AssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantArtifactVerifyPort,
  setAssistantAttachPort,
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantGitWorktreePort,
  setAssistantRouterPort,
  setAssistantSessionsIndexPort,
  setAssistantSettingsPort,
  setAssistantWorkspaceProbePort,
} from "../src/assistant-tickets/assistantPorts.js";
import { computeUsageByGeneration } from "../src/assistant-tickets/assistantSnapshot.js";
import { collectAwaitingCandidates } from "../src/assistant-tickets/reportCompletion.js";
import { createQueuedRelease } from "../src/assistant-tickets/queuedRelease.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
  setAssistantArtifactVerifyPort(null);
  setAssistantAttachPort(null);
  setAssistantDispatchPort(null);
  setAssistantFrameSource(null);
  setAssistantGitWorktreePort(null);
  setAssistantRouterPort(null);
  setAssistantSessionsIndexPort(null);
  setAssistantSettingsPort(null);
  setAssistantWorkspaceProbePort(null);
}

afterEach(() => {
  clearPorts();
});

function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  return { service, db };
}

/** 核验编排是事务提交后的异步钩子；等待宏任务让 settle 落库。 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * 建一张 running 的 W1 worktree 工单：走真实放行链路建票（Mode A），随后 write_domain
 * 直写 worktree（真实 W1 域由装配层 git 端口规划；测试直写属 P1 先例）。
 */
async function seedRunningWorktreeTicket(
  service: ReturnType<typeof createAssistantTicketsService>,
  db: AssistantDatabase,
): Promise<string> {
  setAssistantDispatchPort(async (request) => ({
    ok: true as const,
    value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
  }));
  // isGitRoot:false——真实 W1 规划需要 git 端口（本套件不注入，缺席=计划失败会拒放行）；
  // 工单的 worktree 写域由下一步直写（测试驱动，P1 先例），探测面只为核验基准解析路径。
  setAssistantWorkspaceProbePort(async () => ({
    ok: true as const,
    workspacePath: "/tmp/ws",
    isGitRoot: false,
  }));
  const recorded = await service.recordTrigger({
    text: "核验用例：修一下构建",
    simulated: ASSISTANT_STRENGTHS.explicit,
    targetWorkspaceIdentity: "ws-a",
  });
  if (!recorded.ok) throw new Error("recordTrigger failed");
  const snapshot = await service.getSnapshot();
  const decision = snapshot.decisions.find((d) => d.triggerId === recorded.value.triggerId);
  if (!decision) throw new Error("decision missing");
  const approved = await service.approveDecision({ decisionId: decision.id });
  if (!approved.ok) throw new Error("approve failed");
  const ticketId = approved.value.ticketId;
  db.transaction((raw) => {
    raw
      .prepare("UPDATE ticket SET status = ?, write_domain = ?, updated_ms = ? WHERE id = ?")
      .run(
        ASSISTANT_TICKET_STATUSES.running,
        JSON.stringify({
          kind: "worktree",
          path: `/tmp/ws/.drora/mate/${ticketId}`,
          branch: `mate/${ticketId}`,
        }),
        Date.now(),
        ticketId,
      );
  });
  return ticketId;
}

describe("工件只读核验矩阵（04 详设 §3）", () => {
  it("分支有新提交 → 核验通过 → awaiting_output 短暂滞留后落 done（awaiting 列清除）", async () => {
    const { service, db } = createService();
    setAssistantArtifactVerifyPort({ hasBranchCommits: async () => ({ ok: true as const, hasCommits: true }) });
    const ticketId = await seedRunningWorktreeTicket(service, db);

    service.applyTicketTurnEvent({
      ticketId,
      atMs: Date.now(),
      kind: "turn_completed",
      outputSummary: "构建已修好",
    });
    const heldSnapshot = await service.getSnapshot();
    expect(heldSnapshot.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.awaitingOutput);
    expect(heldSnapshot.tickets[0]?.awaitingSinceMs).not.toBeNull();

    await flushAsync();
    const settled = await service.getSnapshot();
    expect(settled.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.done);
    expect(settled.tickets[0]?.awaitingSinceMs).toBeNull();
    // 核验落 done 时输出摘要保留（turn ended 的汇报语义不因核验丢失）。
    expect(settled.tickets[0]?.outputSummary).toContain("构建已修好");
  });

  it("分支无新提交（核验失败）→ 滞留 awaiting_output 喂 watchdog（>60min → stale+通知）", async () => {
    const { service, db } = createService();
    setAssistantArtifactVerifyPort({ hasBranchCommits: async () => ({ ok: true as const, hasCommits: false }) });
    const ticketId = await seedRunningWorktreeTicket(service, db);

    service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_completed" });
    await flushAsync();
    const held = await service.getSnapshot();
    expect(held.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.awaitingOutput);

    // awaiting 判据事实源（服务 runWatchdogRound 每轮喂入的同一查询）。
    const beforeThreshold = collectAwaitingCandidates(db.raw, Date.now());
    expect(beforeThreshold).toEqual([{ ticketId, sinceMs: expect.any(Number) }]);

    // 判据表阈值 60min：滞留未超阈 → 无 finding；超阈 → stale 标记+配额内通知。
    const sinceMs = held.tickets[0]?.awaitingSinceMs ?? 0;
    const early = await service.runWatchdogRound({ nowMs: sinceMs + 5 * 60 * 1000 });
    expect(early.markedStaleTicketIds).toEqual([]);
    const round = await service.runWatchdogRound({
      nowMs: sinceMs + 61 * 60 * 1000,
    });
    expect(round.markedStaleTicketIds).toContain(ticketId);
    expect(round.notifiedCount).toBeGreaterThanOrEqual(1);
    const afterWatchdog = await service.getSnapshot();
    expect(afterWatchdog.tickets[0]?.staleKind).toBe("awaiting_unverified");
    expect(afterWatchdog.watchdogNotices?.length).toBeGreaterThanOrEqual(1);
  });

  it("核验端口缺席 → P1 形态诚实降级：turn ended 直接 done（不滞留）", async () => {
    // setAssistantArtifactVerifyPort 未注入（clearPorts 后即缺席=无核验面）。
    const standalone = createService();
    const ticketId = await seedRunningWorktreeTicket(standalone.service, standalone.db);
    standalone.service.applyTicketTurnEvent({
      ticketId,
      atMs: Date.now(),
      kind: "turn_completed",
    });
    await flushAsync();
    const settled = await standalone.service.getSnapshot();
    expect(settled.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.done);
  });

  it("git 命令失败（不可校验≠核验失败）→ 滞留等待人工，不猜测落 done", async () => {
    setAssistantArtifactVerifyPort({
      hasBranchCommits: async () => ({ ok: false as const, reason: "git merge-base failed" }),
    });
    const standalone = createService();
    const ticketId = await seedRunningWorktreeTicket(standalone.service, standalone.db);
    standalone.service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_completed" });
    await flushAsync();
    const held = await standalone.service.getSnapshot();
    expect(held.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.awaitingOutput);
  });
});

describe("人工确认出口（confirmTicketOutput / confirmTicketIncrements）", () => {
  it("awaiting 工单人工确认 → done（终态后续同路径）；非 awaiting 拒绝（不猜改写）", async () => {
    setAssistantArtifactVerifyPort({ hasBranchCommits: async () => ({ ok: true as const, hasCommits: false }) });
    const standalone = createService();
    const ticketId = await seedRunningWorktreeTicket(standalone.service, standalone.db);
    standalone.service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_completed" });
    await flushAsync();

    const confirmed = await standalone.service.confirmTicketOutput({ ticketId });
    expect(confirmed.ok).toBe(true);
    const settled = await standalone.service.getSnapshot();
    expect(settled.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.done);
    expect(settled.tickets[0]?.awaitingSinceMs).toBeNull();

    const again = await standalone.service.confirmTicketOutput({ ticketId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe(ASSISTANT_ERROR_CODES.ticketNotFound);
  });

  it("增量确认置列且幂等（首确认时刻不回写）；快照投影 incrementsConfirmedMs", async () => {
    const standalone = createService();
    const ticketId = await seedRunningWorktreeTicket(standalone.service, standalone.db);
    standalone.db.transaction((raw) => {
      raw
        .prepare("UPDATE ticket SET incarnation_generations = ? WHERE id = ?")
        .run(
          JSON.stringify([
            { sessionId: "sess-old", fromMs: Date.now() - 60_000, toMs: Date.now(), cause: "superseded" },
          ]),
          ticketId,
        );
    });
    const first = await standalone.service.confirmTicketIncrements({ ticketId });
    expect(first.ok).toBe(true);
    const after = await standalone.service.getSnapshot();
    const confirmedMs = after.tickets[0]?.incrementsConfirmedMs;
    expect(confirmedMs).not.toBeNull();
    const second = await standalone.service.confirmTicketIncrements({ ticketId });
    expect(second.ok).toBe(true);
    const reread = await standalone.service.getSnapshot();
    expect(reread.tickets[0]?.incrementsConfirmedMs).toBe(confirmedMs);
  });
});

describe("computeUsageByGeneration 落窗归代（04 详设 §3）", () => {
  const base = 1_000_000_000;

  it("归档代窗口+当代窗口按 at_ms 归代；早于首窗的行归第 1 代；Σ=合计不丢账", () => {
    const rows = [
      { inputTokens: 10, outputTokens: 5, atMs: base - 100 }, // 早于首窗 → 第 1 代
      { inputTokens: 100, outputTokens: 50, atMs: base + 10 }, // 归档代 [base, base+1000)
      { inputTokens: 20, outputTokens: 10, atMs: base + 500 }, // 归档代
      { inputTokens: 30, outputTokens: 15, atMs: base + 2000 }, // 当代 [base+1000, ∞)
    ];
    const result = computeUsageByGeneration({
      usageRows: rows,
      generations: [{ fromMs: base, toMs: base + 1000 }],
      currentFromMs: base + 1000,
      nowMs: base + 5000,
    });
    expect(result).toEqual([
      { generation: 1, inputTokens: 130, outputTokens: 65, durationMs: 1000 },
      { generation: 2, inputTokens: 30, outputTokens: 15, durationMs: 4000, current: true },
    ]);
    const totalIn = rows.reduce((sum, row) => sum + row.inputTokens, 0);
    const sumIn = result.reduce((sum, row) => sum + row.inputTokens, 0);
    expect(sumIn).toBe(totalIn);
  });

  it("无归档代（单代工单）全部归当代；条数超界最旧合并进首窗（Σ 不变）", () => {
    const single = computeUsageByGeneration({
      usageRows: [{ inputTokens: 7, outputTokens: 3, atMs: base + 100 }],
      generations: [],
      currentFromMs: base,
      nowMs: base + 60_000,
    });
    expect(single).toEqual([
      { generation: 1, inputTokens: 7, outputTokens: 3, durationMs: 60_000, current: true },
    ]);
    const generations = Array.from({ length: 25 }, (_, index) => ({
      fromMs: base + index * 1000,
      toMs: base + (index + 1) * 1000,
    }));
    const rows = generations.map((window_) => ({
      inputTokens: 1,
      outputTokens: 1,
      atMs: window_.fromMs + 10,
    }));
    rows.push({ inputTokens: 2, outputTokens: 2, atMs: base + 30_000 });
    const merged = computeUsageByGeneration({
      usageRows: rows,
      generations,
      currentFromMs: base + 25_000,
      nowMs: base + 30_000,
    });
    expect(merged.length).toBeLessThanOrEqual(20);
    expect(merged.reduce((sum, row) => sum + row.inputTokens, 0)).toBe(rows.length * 1 + 1);
  });
});

describe("快照投影字段与活动位（04 详设 §3）", () => {
  it("快照带 briefFull/usageByGeneration/awaitingSinceMs 投影；awaiting 占活动位", async () => {
    const { service, db } = createService();
    setAssistantArtifactVerifyPort({ hasBranchCommits: async () => ({ ok: true as const, hasCommits: false }) });
    setAssistantWorkspaceProbePort(async () => ({
      ok: true as const,
      workspacePath: "/tmp/ws",
      isGitRoot: true,
    }));
    const ticketId = await seedRunningWorktreeTicket(service, db);
    // usage 差值行（会话累计 100/40 → 差值 100/40）落 usage_log，分代投影可归当代。
    service.applyTicketTurnEvent({
      ticketId,
      atMs: Date.now(),
      kind: "usage_snapshot",
      usage: { inputTokens: 100, outputTokens: 40 },
    });
    service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_completed" });
    await flushAsync();

    const snap = await service.getSnapshot();
    const view = snap.tickets[0]!;
    expect(view.status).toBe(ASSISTANT_TICKET_STATUSES.awaitingOutput);
    expect(view.briefFull).toBe("核验用例：修一下构建");
    expect(view.usageByGeneration?.length).toBeGreaterThanOrEqual(1);
    expect(view.awaitingSinceMs).not.toBeNull();

    // awaiting 占软预算活动位（queuedRelease.activeCountFor 与 UI isMateActiveTicket 同口径）。
    const queued = createQueuedRelease({
      db,
      readConfig: () => ({ budgetMaxActivePerWorkspace: 3, worktreeDisabled: false }),
      publish: () => {},
      dispatchNewTicket: async () => ({ ok: false as const, error: { code: "mate.dispatch.rejected" as never } }),
      attachDispatch: async () => ({ ok: false as const, error: { code: "mate.dispatch.rejected" as never } }),
    });
    expect(queued.activeCountFor("ws-a")).toBe(1);
    await service.confirmTicketOutput({ ticketId });
    expect(queued.activeCountFor("ws-a")).toBe(0);
  });
});
