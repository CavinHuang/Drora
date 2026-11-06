/**
 * P9 自主节奏层单测（09 号详设 §2 v2 定案；spec §14 P9 行）：
 * - autonomyVerdictSchema 三臂恰现其一/参数一致性 fail-closed（非 routerDecisionSchema
 *   第六臂——两 schema 互不掺和的对偶断言）；
 * - 自主评估循环：off 停跳（含评估读零执行）/总闸关/心跳节流/速览指纹去重 24h/
 *   quiet 零动作/report 过闸落通知区+超额聚合/suggest 独立建卡事务（source_kind=
 *   autonomy+strength=autonomous+decided_by=gate+decision 计数+建卡即写冷却 24h）
 *   +不进候选卡评估循环（router_evaluation 零行）+auto 无消费（无自动建票路径）
 *   +解析失败=quiet（09 §2.2.1 补强断言）；
 * - 否定记忆（闸 4）：忽略 autonomy 卡 → 同对象 48h 不再 suggest；
 * - 快照投影：autonomy 通知区与 watchdog 通知区合并（既有 watchdogNotices 面）+节奏
 *   投影 rhythm? + 首启一次性告知。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_AUTONOMY_DEFAULTS,
  ASSISTANT_AUTONOMY_STRENGTH,
  ASSISTANT_CONFIG_LIMITS,
  ASSISTANT_SOURCE_KINDS,
  ASSISTANT_OUTCOMES,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantRouterPort,
  setAssistantSettingsPort,
  type AssistantSettingsPort,
} from "../src/assistant-tickets/assistantPorts.js";
import {
  ASSISTANT_AUTONOMY_KV_KEYS,
  autonomyVerdictSchema,
  computeAutonomyObjectHash,
  parseAutonomyVerdict,
  readAssistantAutonomyEnabled,
  readAssistantAutonomyIntervalMs,
  readAssistantRhythmView,
} from "../src/assistant-tickets/autonomy.js";
import { ASSISTANT_WATCHDOG_KV_KEYS } from "../src/assistant-tickets/watchdog.js";
import { routerDecisionSchema } from "../src/assistant-tickets/routerDecision.js";
import type { AssistantSnapshot } from "../src/assistant-tickets/assistantTickets.js";

const LOCAL_IDENTITY = "local-user";
const MIN = 60_000;

function clearPorts(): void {
  setAssistantRouterPort(null);
  setAssistantSettingsPort(null);
}

afterEach(() => {
  clearPorts();
  vi.restoreAllMocks();
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

/** kv 直写（测试驱动先例照 assistantP4Host；服务是唯一生产写者）。 */
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

function kvGet(db: ReturnType<typeof openAssistantDatabase>, key: string): string | undefined {
  return (db.raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined)?.value;
}

interface RouterCall {
  readonly card: string;
  readonly countTowardsRotation: boolean;
}

/** router fake：记录调用并按脚本臂返回结构化 JSON（"__fail__"=通道失败臂）。 */
function installRouter(outputs: string[]): { calls: RouterCall[] } {
  const calls: RouterCall[] = [];
  setAssistantRouterPort(async (input) => {
    calls.push({
      card: input.card,
      countTowardsRotation: input.countTowardsRotation !== false,
    });
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return output === "__fail__"
      ? { ok: false as const, reason: "router boom" }
      : { ok: true as const, output };
  });
  return { calls };
}

/** 插入一条 decision_card×gate 待决策（制造态势变化 → 指纹变化 → 越过闸 2）。 */
function seedPendingDecision(
  db: ReturnType<typeof openAssistantDatabase>,
  triggerId: string,
  atMs: number,
): void {
  db.raw
    .prepare(
      "INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(triggerId, ASSISTANT_SOURCE_KINDS.local, "explicit", LOCAL_IDENTITY, null, "态势变化", atMs);
  db.raw
    .prepare(
      "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(triggerId, "explicit", "observe", ASSISTANT_OUTCOMES.decisionCard, null, "gate", atMs);
}

describe("autonomyVerdictSchema（三臂恰现其一；非 routerDecisionSchema 第六臂）", () => {
  it("quiet 臂：空对象恰现其一", () => {
    const parsed = parseAutonomyVerdict({ quiet: {} });
    expect(parsed).toEqual({ ok: true, verdict: { kind: "quiet" } });
  });

  it("report 臂：text≤800+reason 归一", () => {
    const parsed = parseAutonomyVerdict({
      report: { text: "工单 A 停滞超阈", reason: "不回应会损失交付节奏" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.verdict).toEqual({
        kind: "report",
        text: "工单 A 停滞超阈",
        reason: "不回应会损失交付节奏",
      });
    }
  });

  it("report 臂 text 超 800 拒绝（contracts ASSISTANT_AUTONOMY_DEFAULTS.reportTextMax）", () => {
    const parsed = parseAutonomyVerdict({
      report: { text: "长".repeat(ASSISTANT_AUTONOMY_DEFAULTS.reportTextMax + 1), reason: "r" },
    });
    expect(parsed.ok).toBe(false);
  });

  it("suggest dispatch 臂：目标必带；缺目标=解析失败（参数一致性 fail-closed）", () => {
    const ok = parseAutonomyVerdict({
      suggest: { brief: "整理待办", kind: "dispatch", targetWorkspaceIdentity: "ws-a", reason: "事务性整理" },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.verdict.kind === "suggest") {
      expect(ok.verdict.suggestKind).toBe("dispatch");
      expect(ok.verdict.sessionId).toBeNull();
    }
    const missing = parseAutonomyVerdict({
      suggest: { brief: "整理待办", kind: "dispatch", reason: "r" },
    });
    expect(missing.ok).toBe(false);
  });

  it("suggest attach 臂：sessionId+目标都必带；缺一会失败", () => {
    const ok = parseAutonomyVerdict({
      suggest: { brief: "续办", kind: "attach", sessionId: "sess-1", targetWorkspaceIdentity: "ws-a", reason: "r" },
    });
    expect(ok.ok).toBe(true);
    const noSession = parseAutonomyVerdict({
      suggest: { brief: "续办", kind: "attach", targetWorkspaceIdentity: "ws-a", reason: "r" },
    });
    expect(noSession.ok).toBe(false);
  });

  it("两臂同现/零臂/未知键均拒绝（三臂恰现其一）", () => {
    expect(
      autonomyVerdictSchema.safeParse({ quiet: {}, report: { text: "t", reason: "r" } }).success,
    ).toBe(false);
    expect(autonomyVerdictSchema.safeParse({}).success).toBe(false);
    expect(autonomyVerdictSchema.safeParse({ dispatch: {}, evidence: [] }).success).toBe(false);
  });

  it("与 routerDecisionSchema 互不掺和（对偶断言）", () => {
    // autonomy 形状不命中候选卡 schema（quiet/report/suggest 均非其五臂）。
    expect(routerDecisionSchema.safeParse({ quiet: {} }).success).toBe(false);
    expect(
      routerDecisionSchema.safeParse({
        suggest: { brief: "b", kind: "dispatch", targetWorkspaceIdentity: "w", reason: "r" },
      }).success,
    ).toBe(false);
    // 候选卡形状不命中自主 schema。
    expect(
      parseAutonomyVerdict({
        dispatch: { targetWorkspaceIdentity: "w", permissionTier: "build", briefBase: "verbatim" },
        evidence: [],
      }).ok,
    ).toBe(false);
  });
});

describe("runAssistantAutonomyRound（心跳节流/mode 联动/三臂出口）", () => {
  it("off=整体停跳：router 不调、kv 记账不写（含评估读零执行）", async () => {
    const { service, db } = createService();
    kvSet(db, "mode", "off");
    const { calls } = installRouter([JSON.stringify({ quiet: {} })]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toEqual({ ran: false, atMs: 1_000_000, skipReason: "off" });
    expect(calls).toHaveLength(0);
    expect(kvGet(db, ASSISTANT_AUTONOMY_KV_KEYS.lastRoundMs)).toBeUndefined();
    // 总闸读取自身不受 off 影响（读侧缺省语义独立；observe/auto 下由总闸接管）。
    expect(readAssistantAutonomyEnabled((key) => kvGet(db, key))).toBe(true);
  });

  it("总闸关=observe/auto 下停跳；缺省 enabled=true", async () => {
    const { service, db } = createService();
    kvSet(db, ASSISTANT_AUTONOMY_KV_KEYS.enabled, "false");
    const { calls } = installRouter([JSON.stringify({ quiet: {} })]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toEqual({ ran: false, atMs: 1_000_000, skipReason: "disabled" });
    expect(calls).toHaveLength(0);
    expect(kvGet(db, ASSISTANT_AUTONOMY_KV_KEYS.lastRoundMs)).toBeUndefined();
  });

  it("心跳节流：缺省 30min；interval 内 ran=false，越界即到轮；kv 可调即时生效", async () => {
    const { service, db } = createService();
    installRouter([JSON.stringify({ quiet: {} })]);
    const t0 = 1_000_000;
    expect(await service.runAutonomyRound({ nowMs: t0 })).toMatchObject({ ran: true, arm: "quiet" });
    // 置指纹陈旧：隔离闸 2，本用例只验节流（指纹去重另有专测）。
    kvSet(db, ASSISTANT_AUTONOMY_KV_KEYS.fingerprint, JSON.stringify({ hash: "stale", atMs: 0 }));
    expect(await service.runAutonomyRound({ nowMs: t0 + 29 * MIN })).toMatchObject({
      ran: false,
      skipReason: "throttled",
    });
    expect(await service.runAutonomyRound({ nowMs: t0 + 31 * MIN })).toMatchObject({ ran: true });
    expect(readAssistantAutonomyIntervalMs((key) => kvGet(db, key))).toBe(
      ASSISTANT_AUTONOMY_DEFAULTS.intervalMs,
    );
    kvSet(db, ASSISTANT_AUTONOMY_KV_KEYS.intervalMs, String(45 * MIN));
    expect(readAssistantAutonomyIntervalMs((key) => kvGet(db, key))).toBe(45 * MIN);
    // 越界坏值回落缺省（<30min 不采纳——fail-closed 不猜）。
    kvSet(
      db,
      ASSISTANT_AUTONOMY_KV_KEYS.intervalMs,
      String(ASSISTANT_CONFIG_LIMITS.autonomyIntervalMinutes.min * MIN - 1),
    );
    expect(readAssistantAutonomyIntervalMs((key) => kvGet(db, key))).toBe(
      ASSISTANT_AUTONOMY_DEFAULTS.intervalMs,
    );
  });

  it("速览指纹去重 24h：同态势窗口内第二到轮不调 router（闸 2）；态势变化重评", async () => {
    const { service, db } = createService();
    const { calls } = installRouter([JSON.stringify({ quiet: {} })]);
    const t0 = 1_000_000;
    expect(await service.runAutonomyRound({ nowMs: t0 })).toMatchObject({ ran: true, arm: "quiet" });
    // 越过节流（推进到 interval 外）但指纹未变 → 去重跳过（零 LLM 调用）。
    expect(await service.runAutonomyRound({ nowMs: t0 + 31 * MIN })).toMatchObject({
      ran: false,
      skipReason: "fingerprint",
    });
    expect(calls).toHaveLength(1);
    // 态势变化（新增待决策）→ 指纹变化 → 重评（62min 仍在 24h 去重窗内，hash 已变）。
    seedPendingDecision(db, "T-x", t0);
    expect(await service.runAutonomyRound({ nowMs: t0 + 62 * MIN })).toMatchObject({ ran: true });
    expect(calls).toHaveLength(2);
  });

  it("quiet 零动作：无 trigger/decision/quota 落账；唯一通知=首启告知", async () => {
    const { service, db } = createService();
    installRouter([JSON.stringify({ quiet: {} })]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toEqual({ ran: true, atMs: 1_000_000, arm: "quiet" });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM trigger").get() as { n: number }).n).toBe(0);
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM admission_decision").get() as { n: number }).n,
    ).toBe(0);
    // quiet 本身零打扰配额记账（首启告知走通知区，不进配额闸）。
    expect(kvGet(db, "quota:1970-01-01")).toBeUndefined();
    const snapshot = await service.getSnapshot();
    expect(snapshot.watchdogNotices ?? []).toHaveLength(1);
    expect((snapshot.watchdogNotices ?? [])[0]?.kind).toBe("autonomy_first_notice");
  });

  it("自主评估输入=速览+自主约言段，含互扰标记「本输入为自主评估」且不计轮转", async () => {
    const { service } = createService();
    const { calls } = installRouter([JSON.stringify({ quiet: {} })]);
    await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(calls[0]?.card).toContain("本输入为自主评估");
    expect(calls[0]?.card).toContain("quiet");
    // 09 §2.1：不计入 Router 轮转计数——端口以 countTowardsRotation=false 声明。
    expect(calls[0]?.countTowardsRotation).toBe(false);
  });

  it("report 过闸：落自主通知区（快照 watchdogNotices 合并面）+report 配额计数", async () => {
    const { service, db } = createService();
    installRouter([
      JSON.stringify({ report: { text: "工单 A 已停滞 40 分钟", reason: "不回应会损失交付" } }),
    ]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toMatchObject({ ran: true, arm: "report", noticeAllowed: true });
    const snapshot = await service.getSnapshot();
    const notice = (snapshot.watchdogNotices ?? []).find(
      (entry) => entry.kind === "autonomy_report",
    );
    expect(notice).toMatchObject({ ticketId: "autonomy", summary: "工单 A 已停滞 40 分钟" });
    // report 类配额计数（quota 日键=1970-01-01，nowMs=1_000_000）。
    expect(JSON.parse(kvGet(db, "quota:1970-01-01") ?? "{}")).toMatchObject({ report: 1 });
  });

  it("report 超额聚合：配额 0 → 通知区不落账+摘要入次日 digest", async () => {
    const { service, db } = createService();
    setAssistantSettingsPort({ readDailyQuota: async () => 0 });
    installRouter([JSON.stringify({ report: { text: "聚合这条", reason: "r" } })]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toMatchObject({ ran: true, arm: "report", noticeAllowed: false });
    const snapshot = await service.getSnapshot();
    expect(
      (snapshot.watchdogNotices ?? []).filter((entry) => entry.kind === "autonomy_report"),
    ).toHaveLength(0);
    expect(JSON.parse(kvGet(db, "quota:1970-01-01") ?? "{}")).toMatchObject({
      report: 1,
      digest: ["聚合这条"],
    });
  });

  it("suggest 独立建卡事务：source_kind/strength/decided_by/decision 计数/冷却即写（闸 3）", async () => {
    const { service, db } = createService();
    installRouter([
      JSON.stringify({
        suggest: { brief: "整理待办清单", kind: "dispatch", targetWorkspaceIdentity: "ws-a", reason: "事务性整理" },
      }),
    ]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toMatchObject({ ran: true, arm: "suggest" });
    expect(result.decisionId).toBeGreaterThan(0);
    const trigger = db.raw
      .prepare("SELECT source_kind, simulated_strength, identity, text FROM trigger")
      .get() as { source_kind: string; simulated_strength: string; identity: string; text: string };
    expect(trigger).toEqual({
      source_kind: ASSISTANT_SOURCE_KINDS.autonomy,
      simulated_strength: ASSISTANT_AUTONOMY_STRENGTH,
      identity: LOCAL_IDENTITY,
      text: "整理待办清单",
    });
    const decision = db.raw
      .prepare("SELECT strength, mode, outcome, reason_code, decided_by FROM admission_decision")
      .get() as Record<string, string>;
    expect(decision.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect(decision.decided_by).toBe("gate");
    expect(decision.strength).toBe(ASSISTANT_AUTONOMY_STRENGTH);
    expect(decision.reason_code).toBe("autonomy_suggest");
    // decision 类配额同事务计数（recordTrigger 同款——永不抑制仍计数）。
    expect(JSON.parse(kvGet(db, "quota:1970-01-01") ?? "{}")).toMatchObject({ decision: 1 });
    // 闸 3：建卡即写对象冷却 24h（kv 键=autonomy_muted:<对象hash>）。
    const hash = computeAutonomyObjectHash({
      targetWorkspaceIdentity: "ws-a",
      sessionId: null,
      brief: "整理待办清单",
    });
    expect(Number(kvGet(db, `${ASSISTANT_AUTONOMY_KV_KEYS.mutedPrefix}${hash}`))).toBe(
      1_000_000 + ASSISTANT_AUTONOMY_DEFAULTS.mutedCooldownMs,
    );
    // 闸 4 锚点：对象 hash 登记（autonomy_object:<triggerId>）。
    const triggerId = (db.raw.prepare("SELECT id FROM trigger").get() as { id: string }).id;
    expect(kvGet(db, `${ASSISTANT_AUTONOMY_KV_KEYS.objectHashPrefix}${triggerId}`)).toBe(hash);
    // 快照投影：决策卡可见（人工终审面），来源=autonomy。
    const snapshot = await service.getSnapshot();
    expect(
      snapshot.decisions.filter((d) => d.outcome === ASSISTANT_OUTCOMES.decisionCard),
    ).toHaveLength(1);
    expect(snapshot.decisions[0]?.sourceKind).toBe(ASSISTANT_SOURCE_KINDS.autonomy);
  });

  it("09 §2.2.1 补强断言：不进候选卡评估循环（router_evaluation 零行）+auto 无消费（无自动建票）", async () => {
    const { service, db } = createService();
    // mode=auto（kv 直写测试驱动先例；自主循环只读 mode，不经 setMode 信任门复核）。
    kvSet(db, "mode", "auto");
    installRouter([
      JSON.stringify({
        suggest: { brief: "auto 下的建议", kind: "dispatch", targetWorkspaceIdentity: "ws-a", reason: "r" },
      }),
    ]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toMatchObject({ ran: true, arm: "suggest" });
    // 不进候选卡评估循环：scheduleRouterEvaluation 零调用 → router_evaluation 零行
    // （该表唯一写者是候选卡评估链）。
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM router_evaluation").get() as { n: number }).n,
    ).toBe(0);
    // auto 无任何自动建票路径：decision_card 卡留人工终审，ticket 零行。
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM ticket").get() as { n: number }).n).toBe(0);
    const decision = db.raw
      .prepare("SELECT outcome, decided_by FROM admission_decision")
      .get() as Record<string, string>;
    expect(decision.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect(decision.decided_by).toBe("gate");
  });

  it("对象冷却生效：同对象第二次 suggest 命中闸 3 跳过建卡（mutedSkipped）", async () => {
    const { service, db } = createService();
    installRouter([
      JSON.stringify({
        suggest: { brief: "整理待办清单", kind: "dispatch", targetWorkspaceIdentity: "ws-a", reason: "r" },
      }),
    ]);
    expect(await service.runAutonomyRound({ nowMs: 1_000_000 })).toMatchObject({ arm: "suggest" });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM trigger").get() as { n: number }).n).toBe(1);
    // 第二轮：第一张卡使态势变化（指纹变化 → 重评），同对象 suggest 命中冷却 → 不建卡。
    expect(await service.runAutonomyRound({ nowMs: 1_000_000 + 31 * MIN })).toMatchObject({
      arm: "suggest",
      mutedSkipped: true,
    });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM trigger").get() as { n: number }).n).toBe(1);
    // decision 计数不重复（第一轮 1 次）。
    expect(JSON.parse(kvGet(db, "quota:1970-01-01") ?? "{}")).toMatchObject({ decision: 1 });
  });

  it("否定记忆（闸 4）：忽略 autonomy 卡 → 同对象 48h 不再 suggest", async () => {
    const { service, db } = createService();
    installRouter([
      JSON.stringify({
        suggest: { brief: "整理待办清单", kind: "dispatch", targetWorkspaceIdentity: "ws-a", reason: "r" },
      }),
    ]);
    const first = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(first).toMatchObject({ arm: "suggest" });
    const decisionId = (db.raw.prepare("SELECT id FROM admission_decision").get() as { id: number })
      .id;
    await service.ignoreDecision({ decisionId });
    const hash = computeAutonomyObjectHash({
      targetWorkspaceIdentity: "ws-a",
      sessionId: null,
      brief: "整理待办清单",
    });
    // 冷却被覆盖为 48h（ignoreDecision 用真实时钟——按真实 now 界断言），登记行已清。
    const muted = Number(kvGet(db, `${ASSISTANT_AUTONOMY_KV_KEYS.mutedPrefix}${hash}`));
    const now = Date.now();
    expect(muted).toBeGreaterThan(now + ASSISTANT_AUTONOMY_DEFAULTS.mutedCooldownMs);
    expect(muted).toBeLessThanOrEqual(now + ASSISTANT_AUTONOMY_DEFAULTS.negationCooldownMs + 60_000);
    const triggerId = (db.raw.prepare("SELECT id FROM trigger").get() as { id: string }).id;
    expect(kvGet(db, `${ASSISTANT_AUTONOMY_KV_KEYS.objectHashPrefix}${triggerId}`)).toBeUndefined();
    // 忽略把卡移出待决策（指纹回落到首轮同值）——补一条新待决策制造态势变化越过闸 2。
    seedPendingDecision(db, "T-y", 1_100_000);
    // 第二轮同对象 suggest 命中否定记忆 → mutedSkipped（真实时钟冷却远晚于 1970 注入钟）。
    expect(await service.runAutonomyRound({ nowMs: 1_000_000 + 31 * MIN })).toMatchObject({
      arm: "suggest",
      mutedSkipped: true,
    });
    // 未新建卡（autonomy 来源 trigger 仍只有首轮 1 条；T-y 是本用例的态势变化种子）。
    expect(
      (db.raw
        .prepare("SELECT COUNT(*) AS n FROM trigger WHERE source_kind = ?")
        .get(ASSISTANT_SOURCE_KINDS.autonomy) as { n: number }).n,
    ).toBe(1);
  });

  it("解析失败=quiet：不落卡/不落 router_evaluation（诚实降级+warn）", async () => {
    const { service, db } = createService();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installRouter(["这不是 JSON 输出"]);
    const result = await service.runAutonomyRound({ nowMs: 1_000_000 });
    expect(result).toEqual({ ran: true, atMs: 1_000_000, arm: "parse_failed" });
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM trigger").get() as { n: number }).n).toBe(0);
    expect(
      (db.raw.prepare("SELECT COUNT(*) AS n FROM router_evaluation").get() as { n: number }).n,
    ).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("router 通道失败臂=quiet（不重试模型）；通道缺席=router_absent 跳过", async () => {
    const { service, db } = createService();
    installRouter(["__fail__"]);
    expect(await service.runAutonomyRound({ nowMs: 1_000_000 })).toMatchObject({
      ran: true,
      arm: "quiet",
    });
    // 通道缺席（未注入端口）：指纹置陈旧越过闸 2 + 推进时刻越过节流 → router_absent。
    kvSet(db, ASSISTANT_AUTONOMY_KV_KEYS.fingerprint, JSON.stringify({ hash: "x", atMs: 0 }));
    setAssistantRouterPort(null);
    expect(await service.runAutonomyRound({ nowMs: 1_000_000 + 31 * MIN })).toMatchObject({
      ran: false,
      skipReason: "router_absent",
    });
  });
});

describe("首启告知与节奏投影（闸 5 / 快照 rhythm?）", () => {
  it("首启一次性告知：首个到轮心跳产一条告知通知，之后不重复", async () => {
    const { service, db } = createService();
    installRouter([JSON.stringify({ quiet: {} }), JSON.stringify({ quiet: {} })]);
    const t0 = 1_000_000;
    await service.runAutonomyRound({ nowMs: t0 });
    let snapshot = await service.getSnapshot();
    const firstNotices = (snapshot.watchdogNotices ?? []).filter(
      (entry) => entry.kind === "autonomy_first_notice",
    );
    expect(firstNotices).toHaveLength(1);
    expect(firstNotices[0]?.summary).toContain("自主观察已开启");
    // 指纹置陈旧越过闸 2 + 越过节流 → 第二轮不再产告知（一次性）。
    kvSet(db, ASSISTANT_AUTONOMY_KV_KEYS.fingerprint, JSON.stringify({ hash: "stale", atMs: 0 }));
    await service.runAutonomyRound({ nowMs: t0 + 31 * MIN });
    snapshot = await service.getSnapshot();
    expect(
      (snapshot.watchdogNotices ?? []).filter((entry) => entry.kind === "autonomy_first_notice"),
    ).toHaveLength(1);
    expect(kvGet(db, ASSISTANT_AUTONOMY_KV_KEYS.firstNoticeMs)).toBe(String(t0));
  });

  it("节奏投影：快照 rhythm? 与设置 setter 闭环（bounds fail-closed 返回失败臂）", async () => {
    const { service, db } = createService();
    // 缺省投影：enabled=true / 30min / lastRoundMs=null。
    expect(readAssistantRhythmView((key) => kvGet(db, key))).toEqual({
      enabled: true,
      intervalMinutes: 30,
      lastRoundMs: null,
    });
    // setter 写入（唯一生产写路径）。
    expect((await service.setAutonomyEnabled({ enabled: false })).ok).toBe(true);
    expect((await service.setAutonomyIntervalMinutes({ minutes: 90 })).ok).toBe(true);
    const rhythm = readAssistantRhythmView((key) => kvGet(db, key));
    expect(rhythm).toEqual({ enabled: false, intervalMinutes: 90, lastRoundMs: null });
    const snapshot: AssistantSnapshot = await service.getSnapshot();
    expect(snapshot.rhythm).toEqual(rhythm);
    // 越界 fail-closed（返回失败臂，不猜测收敛）。
    expect((await service.setAutonomyIntervalMinutes({ minutes: 10 })).ok).toBe(false);
    expect((await service.setAutonomyIntervalMinutes({ minutes: 2000 })).ok).toBe(false);
    expect(readAssistantAutonomyEnabled((key) => kvGet(db, key))).toBe(false);
  });
});

describe("通知区合并投影（watchdog 同界面）", () => {
  it("autonomy 通知与 watchdog 通知合并 watchdogNotices（时刻新→旧）；分键单写者", async () => {
    const { service, db } = createService();
    // watchdog 通知区直写（测试驱动；该键唯一生产写者是 watchdog 轮）。
    kvSet(
      db,
      ASSISTANT_WATCHDOG_KV_KEYS.notices,
      JSON.stringify([
        { ticketId: "T-w", kind: "running_stall", summary: "watchdog 停滞", atMs: 500 },
      ]),
    );
    installRouter([JSON.stringify({ report: { text: "自主汇报内容", reason: "r" } })]);
    await service.runAutonomyRound({ nowMs: 1_000 });
    const snapshot = await service.getSnapshot();
    const notices = (snapshot.watchdogNotices ?? []).filter(
      (entry) => entry.kind !== "autonomy_first_notice",
    );
    expect(notices).toHaveLength(2);
    // 新→旧：自主通知（atMs=1000）在前。
    expect(notices[0]?.kind).toBe("autonomy_report");
    expect(notices[1]).toMatchObject({ ticketId: "T-w", kind: "running_stall" });
    // 分键单写者：autonomy 轮不写 watchdog_notices（watchdog 判据出清语义不吞并自主条目
    // ——autonomy.ts 文件头注记），两键各自保全。
    const watchdogRaw = JSON.parse(kvGet(db, ASSISTANT_WATCHDOG_KV_KEYS.notices) ?? "[]");
    const autonomyRaw = JSON.parse(kvGet(db, ASSISTANT_AUTONOMY_KV_KEYS.notices) ?? "[]");
    expect(watchdogRaw.some((entry: { kind: string }) => entry.kind === "running_stall")).toBe(true);
    expect(watchdogRaw.some((entry: { kind: string }) => entry.kind === "autonomy_report")).toBe(false);
    expect(autonomyRaw.some((entry: { kind: string }) => entry.kind === "autonomy_report")).toBe(true);
  });
});
