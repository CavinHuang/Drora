/**
 * P4 host 侧单测（04 详设 §1/§2/§4 落地注记）：auto 信任门（统计/阈值/setMode 判定/
 * auto explicit 直派/inferred 建议臂自动执行与降级）、配额中心（记账/判定/查询/摘要
 * 投递）、watchdog（到轮节流/stale 标记与清除/排队饥饿通知/配额判定/审计落账）。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
  ASSISTANT_TRUST_GATE_DEFAULTS,
  ASSISTANT_WATCHDOG_DEFAULTS,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { evaluateAdmission } from "../src/assistant-tickets/admissionGate.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantGitWorktreePort,
  setAssistantRouterPort,
  setAssistantSessionsIndexPort,
  setAssistantSettingsPort,
  setAssistantWorkspaceProbePort,
  type AssistantSettingsPort,
} from "../src/assistant-tickets/assistantPorts.js";
import {
  computeTrustStats,
  isTrustGateOpen,
  readTrustGateThresholds,
} from "../src/assistant-tickets/trustGate.js";
import {
  admitAssistantDisturbanceTx,
  formatAssistantQuotaDayKey,
  resolveAssistantDailyQuota,
} from "../src/assistant-tickets/quotaCenter.js";
import {
  computeAssistantWatchdogFindings,
  readAssistantWatchdogIntervalMs,
} from "../src/assistant-tickets/watchdog.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
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

function createService(settingsPort?: AssistantSettingsPort) {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  if (settingsPort) setAssistantSettingsPort(settingsPort);
  return { service, db };
}

/** kv 直写（测试驱动：mode/阈值/间隔等配置键；服务是唯一生产写者，测试直写属 P1 先例）。 */
function kvSet(
  db: ReturnType<typeof openAssistantDatabase>,
  key: string,
  value: string,
): void {
  db.raw
    .prepare(
      "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
    )
    .run(key, value, 0);
}

/** 记录 N 条人工放行（explicit×observe → 决策卡 → approve）与 N 条 would-accept。 */
async function seedTrustSamples(
  service: ReturnType<typeof createAssistantTicketsService>,
  input: { releases: number; wouldAccepts: number },
): Promise<void> {
  setAssistantDispatchPort(async (request) => ({
    ok: true,
    value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
  }));
  setAssistantWorkspaceProbePort(async () => ({
    ok: true as const,
    workspacePath: "/tmp/ws",
    isGitRoot: false,
  }));
  for (let i = 0; i < input.releases; i += 1) {
    const recorded = await service.recordTrigger({
      text: `点名任务 ${i}`,
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions.find((d) => d.triggerId === recorded.value.triggerId);
    expect(decision).toBeDefined();
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({ decisionId: decision.id });
    expect(approved.ok).toBe(true);
  }
  for (let i = 0; i < input.wouldAccepts; i += 1) {
    const recorded = await service.recordTrigger({
      text: `未指名任务 ${i}`,
      simulated: ASSISTANT_STRENGTHS.inferred,
    });
    expect(recorded.ok).toBe(true);
  }
}

describe("信任门统计与阈值（trustGate 纯函数）", () => {
  it("releaseRate=放行/(would+放行)；分母 0 恒 0（不猜测）", () => {
    expect(computeTrustStats({ wouldAcceptCount: 3, releaseCount: 12 })).toEqual({
      wouldAcceptCount: 3,
      releaseCount: 12,
      releaseRate: 0.8,
      sampleCount: 15,
    });
    expect(computeTrustStats({ wouldAcceptCount: 0, releaseCount: 0 }).releaseRate).toBe(0);
  });

  it("阈值缺省=contracts 默认；kv 覆盖生效；坏值逐键回落", () => {
    expect(readTrustGateThresholds(() => undefined)).toEqual({
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    });
    expect(
      readTrustGateThresholds((key) =>
        key === "trust_gate_min_rate" ? "0.9" : key === "trust_gate_min_samples" ? "5" : undefined,
      ),
    ).toEqual({ minRate: 0.9, minSamples: 5 });
    expect(
      readTrustGateThresholds((key) =>
        key === "trust_gate_min_rate" ? "abc" : key === "trust_gate_min_samples" ? "-1" : undefined,
      ),
    ).toEqual({
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    });
  });

  it("开放判定：rate 与样本双门槛（04 详设 §2）", () => {
    const thresholds = { minRate: 0.8, minSamples: 15 };
    expect(
      isTrustGateOpen({ releaseRate: 0.8, sampleCount: 15 }, thresholds),
    ).toBe(true);
    expect(isTrustGateOpen({ releaseRate: 0.79, sampleCount: 15 }, thresholds)).toBe(false);
    expect(isTrustGateOpen({ releaseRate: 0.9, sampleCount: 14 }, thresholds)).toBe(false);
  });

  it("gate 矩阵 auto 行：explicit→auto_notice；inferred→decision_card（评估后裁）", () => {
    expect(
      evaluateAdmission(
        { strength: ASSISTANT_STRENGTHS.explicit, identity: LOCAL_IDENTITY },
        { mode: ASSISTANT_MODES.auto, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.autoNotice);
    expect(
      evaluateAdmission(
        { strength: ASSISTANT_STRENGTHS.inferred, identity: LOCAL_IDENTITY },
        { mode: ASSISTANT_MODES.auto, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });
});

describe("setMode 信任门判定", () => {
  it("未达标 → autoLocked（放行率够但样本不足）", async () => {
    const { service } = createService();
    await seedTrustSamples(service, { releases: 2, wouldAccepts: 0 });
    const result = await service.setMode(ASSISTANT_MODES.auto);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ASSISTANT_ERROR_CODES.autoLocked);
  });

  it("达标（12 放行/3 would-accept=0.8×15）→ 解锁；快照 trust 投影 gateOpen=true", async () => {
    const { service } = createService();
    await seedTrustSamples(service, { releases: 12, wouldAccepts: 3 });
    const result = await service.setMode(ASSISTANT_MODES.auto);
    expect(result.ok).toBe(true);
    const snapshot = await service.getSnapshot();
    expect(snapshot.mode).toBe(ASSISTANT_MODES.auto);
    expect(snapshot.trust.gateOpen).toBe(true);
    expect(snapshot.trust.releaseRate).toBeCloseTo(0.8);
    expect(snapshot.trust.sampleCount).toBe(15);
    expect(snapshot.trust.gateThresholds).toEqual({
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    });
  });
});

describe("auto explicit 直派（04 详设 §2）", () => {
  it("带目标：直接建票派发（auto_notice 告知卡；不经 Router；不进放行率）", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    const dispatched: string[] = [];
    let routerCalled = false;
    setAssistantRouterPort(async () => {
      routerCalled = true;
      return { ok: true, output: "{}" };
    });
    setAssistantDispatchPort(async (request) => {
      dispatched.push(request.ticketId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-auto" } };
    });
    const recorded = await service.recordTrigger({
      text: "点名自动任务",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.autoNotice);
    expect(routerCalled).toBe(false);
    expect(dispatched).toHaveLength(1);
    const snapshot = await service.getSnapshot();
    // 派发成功即 running（commitDispatchSuccess 既有口径，dispatchEngine.ts:358）。
    expect(snapshot.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
    expect(snapshot.decisions[0]?.outcome).toBe(ASSISTANT_OUTCOMES.autoNotice);
    expect(snapshot.decisions[0]?.decidedBy).toBe("gate");
    // 告知卡不进放行率（releaseCount 口径=decision_card+user）。
    expect(snapshot.trust.releaseCount).toBe(0);
  });

  it("无目标 → 降级 decision_card（问人），Router 候选卡循环照常", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    setAssistantRouterPort(async () => ({ ok: false, reason: "router off" }));
    const recorded = await service.recordTrigger({
      text: "没说目标的自动点名",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
    const decision = snapshot.decisions[0];
    const row = db.raw
      .prepare("SELECT reason_code FROM admission_decision WHERE id = ?")
      .get(decision?.id) as { reason_code: string | null };
    expect(row.reason_code).toBe("auto_missing_target");
  });

  it("目标探测失败 → 决策卡不消费（可改选重放），不建票", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    setAssistantWorkspaceProbePort(async () => ({
      ok: false as const,
      reason: "目录不存在",
    }));
    const recorded = await service.recordTrigger({
      text: "探测失败的自动点名",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-missing",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const decision = (await service.getSnapshot()).decisions[0];
    const row = db.raw
      .prepare("SELECT reason_code FROM admission_decision WHERE id = ?")
      .get(decision?.id) as { reason_code: string | null };
    expect(row.reason_code).toBe("auto_target_probe_failed");
    expect((await service.getSnapshot()).tickets).toHaveLength(0);
  });

  it("Source 入口（ingestSourceEvent）auto explicit 同样直派（无绑定事件 channel_ref=NULL）", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    const dispatched: Array<{ ticketId: string; commandId: string }> = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push({ ticketId: request.ticketId, commandId: request.commandId });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-src" } };
    });
    const ingested = await service.ingestSourceEvent({
      kind: "feishu",
      identity: LOCAL_IDENTITY,
      text: "飞书点名自动任务",
      mention: true,
      atMs: Date.now(),
      workspaceIdentity: "ws-a",
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;
    expect(ingested.value.outcome).toBe(ASSISTANT_OUTCOMES.autoNotice);
    expect(dispatched).toHaveLength(1);
    // 通道绑定续到 auto 建票（同绑定 follow-up 直通 Tier1 连续性不变）。
    const channel = db.raw
      .prepare("SELECT channel_ref FROM ticket WHERE id = ?")
      .get(dispatched[0].ticketId) as { channel_ref: string | null };
    expect(channel.channel_ref).toBeNull(); // 本事件未携带 channelRef → NULL（与人工放行同规则）
  });
});

describe("auto inferred：Router 建议臂自动执行（evidence 强约束）", () => {
  async function flushAsync(times = 10): Promise<void> {
    for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("dispatch 臂 + evidence≥1 + mode 仍 auto → 自动建票派发，outcome 翻 auto_notice", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    const dispatched: string[] = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push(request.ticketId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-inf" } };
    });
    setAssistantRouterPort(async () => ({
      ok: true,
      output: JSON.stringify({
        dispatch: {
          targetWorkspaceIdentity: "ws-b",
          permissionTier: "build",
          briefBase: "verbatim",
        },
        evidence: [{ quote: "未指名的自动任务" }],
      }),
    }));
    const recorded = await service.recordTrigger({
      text: "未指名的自动任务",
      simulated: ASSISTANT_STRENGTHS.inferred,
    });
    expect(recorded.ok).toBe(true);
    await flushAsync();
    expect(dispatched).toHaveLength(1);
    const snapshot = await service.getSnapshot();
    expect(snapshot.decisions[0]?.outcome).toBe(ASSISTANT_OUTCOMES.autoNotice);
    expect(snapshot.tickets[0]?.targetWorkspaceIdentity).toBe("ws-b");
    // auto 执行不进放行率统计（decided_by 恒 gate）。
    expect(snapshot.trust.releaseCount).toBe(0);
  });

  it("hold 臂 / 空 evidence / 评估失败 → 留在 decision_card 问人，不建票", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    setAssistantRouterPort(async () => ({
      ok: true,
      output: JSON.stringify({ hold: { reason: "信息不足" }, evidence: [{ quote: "x" }] }),
    }));
    await service.recordTrigger({ text: "hold 案例", simulated: ASSISTANT_STRENGTHS.inferred });
    await flushAsync();
    expect(dispatched).toBe(0);
    expect((await service.getSnapshot()).decisions[0]?.outcome).toBe(
      ASSISTANT_OUTCOMES.decisionCard,
    );
  });

  it("建议落账后模式已切回 observe → 不自动执行（执行时点复核）", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    // 挂起 Router 响应：等模式切回 observe 后再放行建议。
    let releaseRouter: ((result: { ok: true; output: string }) => void) | null = null;
    setAssistantRouterPort(
      () =>
        new Promise((resolve) => {
          releaseRouter = resolve;
        }),
    );
    await service.recordTrigger({ text: "模式翻转案例", simulated: ASSISTANT_STRENGTHS.inferred });
    // 等评估进入 pending 后切回 observe，再放建议。
    await flushAsync();
    kvSet(db, "mode", ASSISTANT_MODES.observe);
    releaseRouter?.({
      ok: true,
      output: JSON.stringify({
        dispatch: {
          targetWorkspaceIdentity: "ws-c",
          permissionTier: "build",
          briefBase: "verbatim",
        },
        evidence: [{ quote: "模式翻转案例" }],
      }),
    });
    await flushAsync();
    expect(dispatched).toBe(0);
    expect((await service.getSnapshot()).decisions[0]?.outcome).toBe(
      ASSISTANT_OUTCOMES.decisionCard,
    );
  });
});

describe("配额中心（04 详设 §4）", () => {
  it("gate 落卡即计数（04 §4 修复批注记）：recordTrigger 决策卡 → used.decision+1；would-accept 不计数", async () => {
    // 修复依据（spec §2.3 修复批注记）：此前 decision 生产方为零，used.decision 恒 0，
    // 「三端同源计数」中「决策类永不抑制、仍计数」未兑现。
    const { service } = createService({ readDailyQuota: async () => 5 });
    const recorded = await service.recordTrigger({
      text: "点名任务（落卡计数）",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok && recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const afterCard = await service.getDisturbanceQuota();
    expect(afterCard.ok && afterCard.value.used.decision).toBe(1);
    // would-accept（inferred 未指名）不是推送事件，不计数。
    const observed = await service.recordTrigger({
      text: "未指名任务",
      simulated: ASSISTANT_STRENGTHS.inferred,
    });
    expect(observed.ok && observed.value.outcome).toBe(ASSISTANT_OUTCOMES.wouldAccept);
    const afterObserve = await service.getDisturbanceQuota();
    expect(afterObserve.ok && afterObserve.value.used.decision).toBe(1);
    expect(afterObserve.ok && afterObserve.value.total).toBe(1);
  });

  it("三类事件同源计数；decision 永不抑制；超配额 report 聚合次日摘要", async () => {
    const { service } = createService({
      readDailyQuota: async () => 2,
    });
    const now = Date.now();
    const first = await service.admitDisturbance({
      kind: "report",
      summary: "汇报一号",
      atMs: now,
    });
    expect(first.ok && first.value.allowed).toBe(true);
    const decision = await service.admitDisturbance({
      kind: "decision",
      summary: "决策卡推送（计数但不抑制）",
      atMs: now,
    });
    expect(decision.ok && decision.value.allowed).toBe(true);
    const third = await service.admitDisturbance({ kind: "bubble", summary: "气泡", atMs: now });
    // total=3 > quota=2 → bubble 聚合。
    expect(third.ok && third.value.allowed).toBe(false);
    expect(third.ok && third.value.aggregated).toBe(true);
    const status = await service.getDisturbanceQuota();
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.quota).toBe(2);
    expect(status.value.used).toEqual({ decision: 1, report: 1, bubble: 1 });
    expect(status.value.total).toBe(3);
    expect(status.value.remaining).toBe(0);
  });

  it("配额值坏值/缺席回落缺省 5（诚实缺省）", async () => {
    expect(resolveAssistantDailyQuota(undefined)).toBe(5);
    expect(resolveAssistantDailyQuota(-3)).toBe(5);
    expect(resolveAssistantDailyQuota(0)).toBe(0);
    const { service } = createService({ readDailyQuota: async () => Number.NaN });
    const verdict = await service.admitDisturbance({ kind: "report", summary: "x" });
    expect(verdict.ok && verdict.value.quota).toBe(5);
  });

  it("跨日摘要：昨日超额聚合 → 今日 pendingDigest 可见；投递回执结清", async () => {
    const { service, db } = createService({ readDailyQuota: async () => 0 });
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    // 昨日两条 report（quota=0 → 全部聚合）。
    await service.admitDisturbance({ kind: "report", summary: "昨日甲", atMs: now - dayMs });
    await service.admitDisturbance({ kind: "report", summary: "昨日乙", atMs: now - dayMs });
    const before = await service.getDisturbanceQuota();
    expect(before.ok && before.value.pendingDigest).toEqual([
      { date: formatAssistantQuotaDayKey(now - dayMs), items: ["昨日甲", "昨日乙"] },
    ]);
    // 今日聚合不提前结清（次日才投递）。
    await service.admitDisturbance({ kind: "report", summary: "今日丙", atMs: now });
    expect((before.ok ? before.value.pendingDigest : []).length).toBe(1);
    await service.markDailyDigestDelivered();
    const after = await service.getDisturbanceQuota();
    expect(after.ok && after.value.pendingDigest).toEqual([]);
    // 回执只结清今日之前：当日记录原样保留。
    const today = db.raw
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(`quota:${formatAssistantQuotaDayKey(now)}`) as { value: string };
    expect(today.value).toContain("今日丙");
  });

  it("快照投影携带配额与用量（quota 视图同源）", async () => {
    const { service } = createService({ readDailyQuota: async () => 3 });
    await service.admitDisturbance({ kind: "bubble", summary: "投影用例" });
    const snapshot = await service.getSnapshot();
    expect(snapshot.quota?.quota).toBe(3);
    expect(snapshot.quota?.used.bubble).toBe(1);
  });

  it("admitAssistantDisturbanceTx 摘要有界截断（长度与条数）", () => {
    const db = openAssistantDatabase(":memory:");
    const now = Date.now();
    const long = "很".repeat(500);
    for (let i = 0; i < 25; i += 1) {
      const verdict = db.transaction((raw) =>
        admitAssistantDisturbanceTx(raw, { kind: "report", summary: `${long}-${i}`, atMs: now, quota: 1 }),
      );
      // quota=1：首条放行，其余全部聚合（total=i+1 > 1 即聚合）。
      expect(verdict.aggregated).toBe(i > 0);
    }
    const record = db.transaction((raw) =>
      // 直接读当日记录（readAssistantQuotaDay 经 quotaCenter 导出）。
      (
        raw.prepare("SELECT value FROM kv WHERE key = ?").get(`quota:${formatAssistantQuotaDayKey(now)}`) as {
          value: string;
        }
      )
    );
    const parsed = JSON.parse(record.value) as { digest: string[] };
    expect(parsed.digest.length).toBeLessThanOrEqual(20);
    for (const item of parsed.digest) expect(item.length).toBeLessThanOrEqual(200);
  });
});

describe("watchdog（04 详设 §1）", () => {
  async function seedRunningTicket(
    service: ReturnType<typeof createAssistantTicketsService>,
  ): Promise<string> {
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
    }));
    setAssistantWorkspaceProbePort(async () => ({
      ok: true as const,
      workspacePath: "/tmp/ws",
      isGitRoot: false,
    }));
    const recorded = await service.recordTrigger({
      text: "停滞观察工单",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) throw new Error("recordTrigger failed");
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions.find((d) => d.triggerId === recorded.value.triggerId);
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({ decisionId: decision.id });
    expect(approved.ok).toBe(true);
    const ticketId = approved.ok ? approved.value.ticketId : "";
    // turn_started → running（ledger 单调纪律：atMs 需 ≥ updated_ms）。
    service.applyTicketTurnEvent({
      ticketId,
      atMs: Date.now(),
      kind: "turn_started",
    });
    return ticketId;
  }

  it("running 停滞 >30min → stale 标记+配额内通知；永不自动终止/换代", async () => {
    const { service, db } = createService({ readDailyQuota: async () => 5 });
    const ticketId = await seedRunningTicket(service);
    const now = Date.now();
    db.raw
      .prepare("UPDATE ticket SET updated_ms = ? WHERE id = ?")
      .run(now - (ASSISTANT_WATCHDOG_DEFAULTS.runningStallMs + 60_000), ticketId);
    const round = await service.runWatchdogRound({ nowMs: now });
    expect(round.ran).toBe(true);
    expect(round.markedStaleTicketIds).toEqual([ticketId]);
    expect(round.notifiedCount).toBe(1);
    const snapshot = await service.getSnapshot();
    const ticket = snapshot.tickets.find((t) => t.id === ticketId);
    // 只标记：状态机不被 watchdog 改写（永不自动终止/换代，spec §10）。
    expect(ticket?.status).toBe("running");
    expect(ticket?.staleSinceMs).toBe(now);
    expect(ticket?.staleKind).toBe("running_stall");
    expect(snapshot.watchdogNotices?.[0]?.ticketId).toBe(ticketId);
    // 信任门审计投影同轮落账。
    const statsRow = db.raw
      .prepare("SELECT value FROM kv WHERE key = 'trust_gate_stats'")
      .get() as { value: string };
    expect(JSON.parse(statsRow.value)).toHaveProperty("releaseRate");
  });

  it("到轮节流：interval 内二轮 ran=false；kv 调小后下一 tick 即执行", async () => {
    const { service, db } = createService({ readDailyQuota: async () => 5 });
    const now = Date.now();
    const first = await service.runWatchdogRound({ nowMs: now });
    expect(first.ran).toBe(true);
    const second = await service.runWatchdogRound({ nowMs: now + 60_000 });
    expect(second.ran).toBe(false);
    kvSet(db, "watchdog_interval_ms", "1000");
    const third = await service.runWatchdogRound({ nowMs: now + 120_000 });
    expect(third.ran).toBe(true);
  });

  it("轮询间隔坏值回落缺省 15 分钟", () => {
    expect(readAssistantWatchdogIntervalMs(() => undefined)).toBe(
      ASSISTANT_WATCHDOG_DEFAULTS.intervalMs,
    );
    expect(readAssistantWatchdogIntervalMs(() => "0")).toBe(
      ASSISTANT_WATCHDOG_DEFAULTS.intervalMs,
    );
    expect(readAssistantWatchdogIntervalMs(() => "60000")).toBe(60_000);
  });

  it("判据解除（turn 推进 updated_ms）→ 同轮清除 stale 与通知", async () => {
    const { service, db } = createService({ readDailyQuota: async () => 5 });
    const ticketId = await seedRunningTicket(service);
    const now = Date.now();
    db.raw
      .prepare("UPDATE ticket SET updated_ms = ? WHERE id = ?")
      .run(now - (ASSISTANT_WATCHDOG_DEFAULTS.runningStallMs + 60_000), ticketId);
    await service.runWatchdogRound({ nowMs: now });
    // 新 turn 推进 updated_ms（事件驱动；禁超时兜底的互补面）。
    const staleRow = db.raw.prepare("SELECT stale_ms FROM ticket WHERE id = ?").get(ticketId) as {
      stale_ms: number | null;
    };
    expect(staleRow.stale_ms).not.toBeNull();
    service.applyTicketTurnEvent({ ticketId, atMs: now + 1, kind: "usage_snapshot" });
    kvSet(db, "watchdog_interval_ms", "1");
    const round2 = await service.runWatchdogRound({ nowMs: now + 2_000 });
    expect(round2.clearedStaleCount).toBe(1);
    const ticket = (await service.getSnapshot()).tickets.find((t) => t.id === ticketId);
    expect(ticket?.staleSinceMs).toBeNull();
    expect((await service.getSnapshot()).watchdogNotices ?? []).toHaveLength(0);
  });

  it("持续停滞跨轮单通知：同 finding 不重复计数/入列；解除后再命中重新过闸", async () => {
    // 修复依据（spec §10 修复批注记）：此前每轮无条件 admit+push，持续停滞工单
    // 15min/轮 × 配额 5/日 约 75 分钟耗尽当日 report 预算并把通知区挤满同工单条目。
    const { service, db } = createService({ readDailyQuota: async () => 5 });
    const ticketId = await seedRunningTicket(service);
    const now = Date.now();
    db.raw
      .prepare("UPDATE ticket SET updated_ms = ? WHERE id = ?")
      .run(now - (ASSISTANT_WATCHDOG_DEFAULTS.runningStallMs + 60_000), ticketId);
    const first = await service.runWatchdogRound({ nowMs: now });
    expect(first.notifiedCount).toBe(1);
    kvSet(db, "watchdog_interval_ms", "1");
    // 第二轮：同一持续命中的 finding 已有未解除通知 → 不再过配额闸、不再入列。
    const second = await service.runWatchdogRound({ nowMs: now + 60_000 });
    expect(second.notifiedCount).toBe(0);
    expect(second.aggregatedCount).toBe(0);
    const notices = (await service.getSnapshot()).watchdogNotices ?? [];
    expect(notices).toHaveLength(1);
    // 通知区仍是首轮条目（atMs 未刷新）——没有重报新条目。
    expect(notices[0]?.atMs).toBe(now);
    // 当日 report 用量恒 1（仅首轮过闸一次），跨轮不重复计数。
    const quota = await service.getDisturbanceQuota();
    expect(quota.ok && quota.value.used.report).toBe(1);
    // 判据解除（新事件推进 updated_ms）→ 通知随轮出清。
    service.applyTicketTurnEvent({ ticketId, atMs: now + 61_000, kind: "usage_snapshot" });
    const clear = await service.runWatchdogRound({ nowMs: now + 62_000 });
    expect(clear.clearedStaleCount).toBe(1);
    expect((await service.getSnapshot()).watchdogNotices ?? []).toHaveLength(0);
    // 再次停滞 → 新回合重新过闸（配额内放行，通知区单条）。
    db.raw
      .prepare("UPDATE ticket SET updated_ms = ? WHERE id = ?")
      .run(now + 62_000 - (ASSISTANT_WATCHDOG_DEFAULTS.runningStallMs + 60_000), ticketId);
    const third = await service.runWatchdogRound({ nowMs: now + 63_000 });
    expect(third.notifiedCount).toBe(1);
    const afterNotices = (await service.getSnapshot()).watchdogNotices ?? [];
    expect(afterNotices).toHaveLength(1);
    expect(afterNotices[0]?.atMs).toBe(now + 63_000);
  });

  it("排队饥饿 >24h → 仅通知不置 stale；超额时聚合摘要不进通知区", async () => {
    const { service, db } = createService({ readDailyQuota: async () => 0 });
    // quota=0：watchdog 通知全部聚合（非决策类），通知区保持空。
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
    }));
    setAssistantWorkspaceProbePort(async () => ({
      ok: true as const,
      workspacePath: "/tmp/ws",
      isGitRoot: false,
    }));
    kvSet(db, "budget_max_active_per_workspace", "1");
    // 第一张占满预算，第二张进 queued。
    await seedRunningTicket(service);
    const recorded = await service.recordTrigger({
      text: "排队饥饿工单",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    // 放行第二张（预算 1 已满 → queued）。
    const snapshotBefore = await service.getSnapshot();
    const decision = snapshotBefore.decisions.find((d) => d.triggerId === recorded.value.triggerId);
    expect(decision).toBeDefined();
    if (!decision) return;
    const approved = await service.approveDecision({ decisionId: decision.id });
    expect(approved.ok).toBe(true);
    const snapshot = await service.getSnapshot();
    const queuedTicket = snapshot.tickets.find((t) => t.status === "queued");
    expect(queuedTicket).toBeDefined();
    if (!queuedTicket) return;
    const now = Date.now();
    db.raw
      .prepare("UPDATE ticket SET updated_ms = ? WHERE id = ?")
      .run(now - (ASSISTANT_WATCHDOG_DEFAULTS.queuedStarveMs + 60_000), queuedTicket.id);
    const round = await service.runWatchdogRound({ nowMs: now });
    expect(round.ran).toBe(true);
    expect(round.markedStaleTicketIds).toHaveLength(0);
    expect(round.aggregatedCount).toBe(1);
    const row = db.raw
      .prepare("SELECT stale_ms, status FROM ticket WHERE id = ?")
      .get(queuedTicket.id) as { stale_ms: number | null; status: string };
    // 排队饥饿只告知：不置 stale、不改状态。
    expect(row.stale_ms).toBeNull();
    expect(row.status).toBe("queued");
    expect((await service.getSnapshot()).watchdogNotices ?? []).toHaveLength(0);
  });

  it("判据纯函数：awaitingCandidates 接缝缺席=不激活；喂入且超阈→建议人工核验", () => {
    const now = Date.now();
    // awaiting 滞留从核验起点计时（§3 工件核验事实源），与 updated_ms 无关——
    // running 停滞判据看 updated_ms，awaiting 判据看 sinceMs（两判据互不吞并）。
    const rows = [
      {
        id: "T-a",
        status: "running",
        updatedMs: now - 5 * 60_000,
        staleMs: null,
        staleKind: null,
      },
      {
        id: "T-done",
        status: "done",
        updatedMs: now - 5 * 60_000,
        staleMs: null,
        staleKind: null,
      },
    ];
    // 接缝缺席：awaiting 判据不激活（updated 5min 前也无 running 停滞）。
    expect(computeAssistantWatchdogFindings(rows, { nowMs: now })).toEqual([]);
    // 终态工单（T-done）不做 awaiting 滞留；非终态命中。
    expect(
      computeAssistantWatchdogFindings(rows, {
        nowMs: now,
        awaitingCandidates: [
          { ticketId: "T-a", sinceMs: now - 90 * 60_000 },
          { ticketId: "T-done", sinceMs: now - 90 * 60_000 },
        ],
      }).map((finding) => finding.ticketId),
    ).toEqual(["T-a"]);
    const findings = computeAssistantWatchdogFindings(rows, {
      nowMs: now,
      awaitingCandidates: [{ ticketId: "T-a", sinceMs: now - 90 * 60_000 }],
    });
    expect(findings.map((f) => f.kind)).toEqual(["awaiting_unverified"]);
    expect(findings[0].markStale).toBe(true);
  });
});

describe("schema v5/v6（stale 与核验滞留列只加不破）", () => {
  it("新建库带 stale_ms/stale_kind/awaiting_since_ms/increments_confirmed_ms 列且 schema_version=6", () => {
    const db = openAssistantDatabase(":memory:");
    const columns = (db.raw.prepare("PRAGMA table_info(ticket)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toContain("stale_ms");
    expect(columns).toContain("stale_kind");
    // P4 第二棒（04 详设 §3）：核验滞留与增量确认列（v6 只加不破）。
    expect(columns).toContain("awaiting_since_ms");
    expect(columns).toContain("increments_confirmed_ms");
    const version = db.raw.prepare("SELECT value FROM kv WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(Number(version.value)).toBe(6);
  });
});
