/**
 * P10b 管理动作面单测（10 号详设 §3.1；spec §2「P10b 落地注记」）：
 * - schema 对偶断言：manage 第六臂（六臂恰现其一/合法配对/reason 界）；
 * - 可见集拒绝：targetRef 清单外失配拒绝（attach 反编造同款）；
 * - auto 无执行断言：manage verdict 在 auto 模式下不建票不消费（管理≠自动）；
 * - 台账行管理入口（安全修复轮）：recordTrigger(manageIntent) 在 auto 下 explicit
 *   直派被降级 decision_card（reason_code 留痕）出 manage 卡人工 Y；无标记的既有
 *   explicit 直派语义不回归；observe 行为零变化；
 * - approveDecision 诚实拒绝（安全修复轮）：manage suggested 卡经旧放行口=
 *   validationFailed、卡不消费、零建票；dispatch suggested 卡不受影响；
 * - 执行面守卫传参：planManageStopTurn 取帧矩阵（executionId 来自活动执行帧——
 *   node.ts 装配与 UI SessionPane 同语义的判定锁）；
 * - 幂等终态（already_terminal=skipped「已无需执行」）/失败回写（failed+原因，不重试）/
 *   成功回写（executed）；同卡二次放行幂等。
 * 库用 :memory:；端口全部 fake 注入（assistantPorts 模块级 set*，P4 host 先例）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MANAGE_ACTIONS,
  ASSISTANT_MANAGE_LIMITS,
  ASSISTANT_MANAGE_STATES,
  ASSISTANT_MANAGE_TARGET_KINDS,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  type MateWorkInventoryView,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import { parseRouterDecision } from "../src/assistant-tickets/routerDecision.js";
import { planManageStopTurn } from "../src/assistant-tickets/manageActions.js";
import { deriveManageTargets } from "../src/assistant-tickets/routerShell.js";
import {
  setAssistantDispatchPort,
  setAssistantInventoryProvider,
  setAssistantManagePort,
  setAssistantRouterPort,
  type AssistantManageExecutionRequest,
} from "../src/assistant-tickets/assistantPorts.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
  setAssistantDispatchPort(null);
  setAssistantRouterPort(null);
  setAssistantManagePort(null);
  setAssistantInventoryProvider(null);
}

afterEach(() => {
  clearPorts();
});

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

/** 台账可见集 fixture（会话两枚+闲时一枚；MSA15 canned 视图同形）。 */
function inventoryFixture(): MateWorkInventoryView {
  return {
    workspaces: [
      {
        key: "ws-manage",
        rows: [
          {
            kind: "session",
            sessionId: "sess-manage-1",
            title: "用户手开会话一",
            phase: "running",
            sessionEnded: false,
            updatedAtMs: 1_000,
          },
          {
            kind: "session",
            sessionId: "sess-manage-ended",
            title: "已结束会话（不可停）",
            phase: "completedSuccess",
            sessionEnded: true,
            updatedAtMs: 900,
          },
          {
            kind: "offpeak",
            taskId: "task-manage-1",
            title: "闲时索引重建",
            status: "pending",
            updatedAtMs: 800,
          },
        ],
      },
    ],
  };
}

/** 产出一张带 manage suggested 评估的待决卡（返回 decisionId；走真实评估链）。 */
async function seedManageDecision(
  service: ReturnType<typeof createAssistantTicketsService>,
  input: {
    targetKind?: string;
    targetRef?: string;
    action?: string;
    reason?: string;
    /** auto 链用 inferred（explicit×auto 走直派不经评估循环——04 详设 §2）。 */
    simulated?: (typeof ASSISTANT_STRENGTHS)[keyof typeof ASSISTANT_STRENGTHS];
  } = {},
): Promise<number> {
  const targetKind = input.targetKind ?? ASSISTANT_MANAGE_TARGET_KINDS.session;
  const targetRef = input.targetRef ?? "sess-manage-1";
  const action = input.action ?? ASSISTANT_MANAGE_ACTIONS.stopTurn;
  setAssistantRouterPort(async () => ({
    ok: true,
    output: JSON.stringify({
      manage: { targetKind, targetRef, action, reason: input.reason ?? "会话卡住无进展" },
      evidence: [{ quote: "请把会话停掉" }],
    }),
  }));
  const recorded = await service.recordTrigger({
    text: "请把会话停掉",
    simulated: input.simulated ?? ASSISTANT_STRENGTHS.explicit,
    targetWorkspaceIdentity: "ws-manage",
  });
  expect(recorded.ok).toBe(true);
  if (!recorded.ok) throw new Error("recordTrigger failed");
  // 评估是 fire-and-forget：冲微任务链直到 verdict 落账（P4 host flushAsync 先例）。
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === recorded.value.triggerId,
    );
    if (decision?.routerState === "suggested") return decision.id;
  }
  throw new Error("manage 建议评估未落账（评估链未完成）");
}

async function flushAsync(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("routerDecision manage 第六臂（schema 对偶）", () => {
  it("session+stop_turn 合法臂解析归一；evidence 透传", () => {
    const parsed = parseRouterDecision({
      manage: {
        targetKind: "session",
        targetRef: "sess-1",
        action: "stop_turn",
        reason: "卡住无进展",
      },
      evidence: [{ quote: "请把会话停掉" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.decision.kind).toBe("manage");
    if (parsed.decision.kind !== "manage") return;
    expect(parsed.decision.arm).toEqual({
      targetKind: "session",
      targetRef: "sess-1",
      action: "stop_turn",
      reason: "卡住无进展",
    });
    expect(parsed.decision.evidence).toEqual(["请把会话停掉"]);
  });

  it("offpeak_task+cancel 合法；交叉配对（session+cancel / offpeak+stop_turn）失配拒绝", () => {
    expect(
      parseRouterDecision({
        manage: { targetKind: "offpeak_task", targetRef: "task-1", action: "cancel", reason: "r" },
        evidence: [],
      }).ok,
    ).toBe(true);
    expect(
      parseRouterDecision({
        manage: { targetKind: "session", targetRef: "sess-1", action: "cancel", reason: "r" },
        evidence: [],
      }).ok,
    ).toBe(false);
    expect(
      parseRouterDecision({
        manage: { targetKind: "offpeak_task", targetRef: "task-1", action: "stop_turn", reason: "r" },
        evidence: [],
      }).ok,
    ).toBe(false);
  });

  it("六臂恰现其一：manage+dispatch 并现拒绝；无臂拒绝", () => {
    expect(
      parseRouterDecision({
        manage: { targetKind: "session", targetRef: "s", action: "stop_turn", reason: "r" },
        dispatch: { targetWorkspaceIdentity: "ws", permissionTier: "build", briefBase: "verbatim" },
      }).ok,
    ).toBe(false);
    expect(parseRouterDecision({ evidence: [] }).ok).toBe(false);
  });

  it("reason 超 200 界拒绝（ASSISTANT_MANAGE_LIMITS 单出处）", () => {
    expect(
      parseRouterDecision({
        manage: {
          targetKind: "session",
          targetRef: "s",
          action: "stop_turn",
          reason: "长".repeat(ASSISTANT_MANAGE_LIMITS.reasonMax + 1),
        },
      }).ok,
    ).toBe(false);
  });
});

describe("deriveManageTargets 台账可见集推导", () => {
  it("会话/闲时行入清单（携 workspaceKey）；已结束会话不入；每 kind 界 targetsMaxPerKind", () => {
    const manySessions = Array.from({ length: 8 }, (_, i) => ({
      kind: "session" as const,
      sessionId: `sess-${i}`,
      title: `s${i}`,
      phase: "idle",
      sessionEnded: false,
      updatedAtMs: 1_000 - i,
    }));
    const view: MateWorkInventoryView = {
      workspaces: [
        { key: "ws-a", rows: [...manySessions, {
          kind: "session",
          sessionId: "sess-ended",
          title: "ended",
          phase: "error",
          sessionEnded: true,
          updatedAtMs: 2_000,
        }] },
        { key: "ws-b", rows: [{
          kind: "offpeak",
          taskId: "task-1",
          title: "t",
          updatedAtMs: 500,
        }] },
      ],
    };
    const targets = deriveManageTargets(view);
    const sessions = targets.filter((t) => t.targetKind === "session");
    const offpeak = targets.filter((t) => t.targetKind === "offpeak_task");
    expect(sessions.length).toBe(ASSISTANT_MANAGE_LIMITS.targetsMaxPerKind);
    expect(sessions.every((t) => t.workspaceKey === "ws-a")).toBe(true);
    expect(sessions.some((t) => t.targetRef === "sess-ended")).toBe(false);
    expect(offpeak).toEqual([
      { targetKind: "offpeak_task", targetRef: "task-1", title: "t", workspaceKey: "ws-b" },
    ]);
  });

  it("inventory 缺席 → 空集（候选卡不出段；约言禁 manage）", () => {
    expect(deriveManageTargets(null)).toEqual([]);
  });
});

describe("planManageStopTurn 取帧（执行面守卫传参）", () => {
  it("canStop=false → 无可停执行（幂等成功语义）", () => {
    expect(planManageStopTurn({ canStop: false, activeWorks: [] })).toEqual({
      kind: "none",
      detail: expect.any(String),
    });
  });

  it("canStop=true 且活动帧带 foregroundExecutionId → stop 携守卫参数（executionId 取帧）", () => {
    const plan = planManageStopTurn({
      canStop: true,
      stopState: "stopping-none",
      activeWorks: [
        { foregroundExecutionId: undefined },
        { foregroundExecutionId: "exec-42" },
        { foregroundExecutionId: "exec-43" },
      ],
    });
    expect(plan).toEqual({ kind: "stop", expectedForegroundExecutionId: "exec-42" });
  });

  it("canStop=true 但帧上无执行身份 → stop 不带守卫参数（镜像 SessionPane，不加特权判定）", () => {
    expect(planManageStopTurn({ canStop: true, activeWorks: [{}] })).toEqual({ kind: "stop" });
    expect(planManageStopTurn({ canStop: true })).toEqual({ kind: "stop" });
  });
});

describe("approveManageDecision 放行链", () => {
  function createService() {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    setAssistantInventoryProvider(() => inventoryFixture());
    return { service, db };
  }

  it("成功链：预检过 → 事务翻 managed+executing → 异步执行 executed 回写；快照投影 manageExecution", async () => {
    const { service } = createService();
    const requests: AssistantManageExecutionRequest[] = [];
    setAssistantManagePort(async (request) => {
      requests.push(request);
      return { ok: true, outcome: "executed", detail: "已发 stop（expectedForegroundExecutionId=exec-9）" };
    });
    const decisionId = await seedManageDecision(service);
    const approved = await service.approveManageDecision({ decisionId });
    expect(approved.ok).toBe(true);
    await flushAsync();
    expect(requests).toEqual([
      {
        targetKind: "session",
        targetRef: "sess-manage-1",
        action: "stop_turn",
        workspaceKey: "ws-manage",
      },
    ]);
    const decision = (await service.getSnapshot()).decisions.find((d) => d.id === decisionId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.managed);
    expect(decision?.manageExecution?.state).toBe(ASSISTANT_MANAGE_STATES.executed);
    expect(decision?.manageExecution?.note).toContain("exec-9");
    // 管理放行不进放行率统计（releaseCount 口径=decision_card+user 不受污染）。
    expect((await service.getSnapshot()).trust.releaseCount).toBe(0);
  });

  it("可见集拒绝：targetRef 清单外 → manageTargetInvalid，卡不消费", async () => {
    const { service } = createService();
    setAssistantManagePort(async () => ({ ok: true, outcome: "executed" }));
    const decisionId = await seedManageDecision(service, { targetRef: "sess-fabricated" });
    const rejected = await service.approveManageDecision({ decisionId });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe(ASSISTANT_ERROR_CODES.manageTargetInvalid);
    const decision = (await service.getSnapshot()).decisions.find((d) => d.id === decisionId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect(decision?.manageExecution).toBeUndefined();
  });

  it("台账 provider 缺席 → manageUnavailable（不猜测目标）", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    setAssistantManagePort(async () => ({ ok: true, outcome: "executed" }));
    const decisionId = await seedManageDecision(service);
    const rejected = await service.approveManageDecision({ decisionId });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe(ASSISTANT_ERROR_CODES.manageUnavailable);
  });

  it("执行通道未装配 → manageUnavailable，卡不消费", async () => {
    const { service } = createService();
    const decisionId = await seedManageDecision(service);
    const rejected = await service.approveManageDecision({ decisionId });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe(ASSISTANT_ERROR_CODES.manageUnavailable);
  });

  it("幂等终态：端口 already_terminal → skipped「已无需执行」", async () => {
    const { service } = createService();
    setAssistantManagePort(async () => ({
      ok: true,
      outcome: "already_terminal",
      detail: "会话当前无可停执行（已停或空闲），已无需执行",
    }));
    const decisionId = await seedManageDecision(service);
    expect((await service.approveManageDecision({ decisionId })).ok).toBe(true);
    await flushAsync();
    const decision = (await service.getSnapshot()).decisions.find((d) => d.id === decisionId);
    expect(decision?.manageExecution?.state).toBe(ASSISTANT_MANAGE_STATES.skipped);
    expect(decision?.manageExecution?.note).toContain("已无需执行");
  });

  it("失败回写：端口拒绝 → failed+原因落卡；不自动重试（端口恰被调用一次）", async () => {
    const { service } = createService();
    let calls = 0;
    setAssistantManagePort(async () => {
      calls += 1;
      return { ok: false, reason: "stop 被守卫拒绝：expectedForegroundExecutionId 失配" };
    });
    const decisionId = await seedManageDecision(service);
    expect((await service.approveManageDecision({ decisionId })).ok).toBe(true);
    await flushAsync(20);
    expect(calls).toBe(1);
    const decision = (await service.getSnapshot()).decisions.find((d) => d.id === decisionId);
    expect(decision?.manageExecution?.state).toBe(ASSISTANT_MANAGE_STATES.failed);
    expect(decision?.manageExecution?.note).toContain("失配");
    // 失败后同卡二次放行=幂等返回（不重试不重执行；重新触发=新卡新决策）。
    expect((await service.approveManageDecision({ decisionId })).ok).toBe(true);
    await flushAsync(20);
    expect(calls).toBe(1);
  });

  it("offpeak cancel 合法配对走端口；非 manage 决策卡拒绝", async () => {
    const { service } = createService();
    const requests: AssistantManageExecutionRequest[] = [];
    setAssistantManagePort(async (request) => {
      requests.push(request);
      return { ok: true, outcome: "executed", detail: "已取消闲时任务" };
    });
    const decisionId = await seedManageDecision(service, {
      targetKind: ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask,
      targetRef: "task-manage-1",
      action: ASSISTANT_MANAGE_ACTIONS.cancel,
    });
    expect((await service.approveManageDecision({ decisionId })).ok).toBe(true);
    await flushAsync();
    expect(requests[0]?.action).toBe("cancel");
    expect(requests[0]?.targetRef).toBe("task-manage-1");
    // 非 manage 卡（无建议评估——撤掉 router port，照 observe 无建议形态）拒绝本入口。
    setAssistantRouterPort(null);
    const plain = await service.recordTrigger({
      text: "普通任务触发",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-manage",
    });
    expect(plain.ok).toBe(true);
    const plainDecision = (await service.getSnapshot()).decisions.find(
      (d) => plain.ok && d.triggerId === plain.value.triggerId,
    );
    const rejected = plainDecision
      ? await service.approveManageDecision({ decisionId: plainDecision.id })
      : null;
    expect(rejected?.ok).toBe(false);
  });
});

describe("auto 模式永不自动执行 manage（10 号详设 §0/§3.1）", () => {
  it("auto 下 manage 建议落账 suggested 但不建票不消费（autoDispatch 显式排除）", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    setAssistantInventoryProvider(() => inventoryFixture());
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    setAssistantManagePort(async () => {
      throw new Error("manage 端口在 auto 链不应被调用");
    });
    await seedManageDecision(service, { simulated: ASSISTANT_STRENGTHS.inferred });
    await flushAsync(20);
    expect(dispatched).toBe(0);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
    const decision = snapshot.decisions[0];
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect(decision?.routerSuggestion?.kind).toBe("manage");
    expect(decision?.manageExecution).toBeUndefined();
  });

  it("auto 下台账行管理入口（recordTrigger manageIntent）：explicit 直派被降级 decision_card，评估循环出 manage 卡，人工 Y 才执行（零 worker 派发）", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    setAssistantInventoryProvider(() => inventoryFixture());
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    const manageRequests: AssistantManageExecutionRequest[] = [];
    setAssistantManagePort(async (request) => {
      manageRequests.push(request);
      return { ok: true, outcome: "executed", detail: "已发 stop" };
    });
    // 台账行入口同款触发（MateSidePane.handleManageTarget 生成的文本+explicit+target
    // +manageIntent——安全审查修复断言点：auto×explicit 原会 auto_notice→同事务建票→
    // 派 worker（brief=管理意图原文），修复后必须降级 decision_card 走 manage 卡）。
    const entryText = "请把会话 sess-manage-1「用户手开会话一」的当前回合停掉";
    setAssistantRouterPort(async () => ({
      ok: true,
      output: JSON.stringify({
        manage: {
          targetKind: ASSISTANT_MANAGE_TARGET_KINDS.session,
          targetRef: "sess-manage-1",
          action: ASSISTANT_MANAGE_ACTIONS.stopTurn,
          reason: "会话卡住无进展",
        },
        evidence: [{ quote: entryText }],
      }),
    }));
    const recorded = await service.recordTrigger({
      text: entryText,
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-manage",
      manageIntent: true,
    });
    expect(recorded.ok).toBe(true);
    // 直派计划被管理入口守卫降级：outcome=decision_card（非 auto_notice）。
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    let decisionId: number | undefined;
    for (let i = 0; i < 20; i += 1) {
      const decision = (await service.getSnapshot()).decisions.find(
        (d) => recorded.ok && d.triggerId === recorded.value.triggerId,
      );
      if (decision?.routerState === "suggested") {
        decisionId = decision.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(decisionId).toBeDefined();
    // reason_code 诚实留痕（快照不投影，直查 admission_decision）。
    const decisionRow = db.raw
      .prepare("SELECT reason_code FROM admission_decision WHERE id = ?")
      .get(decisionId) as { reason_code: string | null };
    expect(decisionRow.reason_code).toBe("manage_requires_manual_approval");
    await flushAsync(20);
    // 零 worker 派发：无 ticket、dispatch 端口零调用、manage 卡留人工。
    expect(dispatched).toBe(0);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
    const decision = snapshot.decisions.find((d) => d.id === decisionId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect(decision?.routerSuggestion?.kind).toBe("manage");
    // 人工 Y（唯一放行口）：approveManageDecision → manage 执行端口。
    expect((await service.approveManageDecision({ decisionId: decisionId! })).ok).toBe(true);
    await flushAsync();
    expect(manageRequests).toEqual([
      {
        targetKind: "session",
        targetRef: "sess-manage-1",
        action: "stop_turn",
        workspaceKey: "ws-manage",
      },
    ]);
    expect(dispatched).toBe(0);
  });

  it("对照：auto 下同参数无 manageIntent 仍走 explicit 直派（既有矩阵语义不回归）", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    kvSet(db, "mode", ASSISTANT_MODES.auto);
    let dispatched = 0;
    setAssistantDispatchPort(async (request) => {
      dispatched += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    const recorded = await service.recordTrigger({
      text: "请把会话 sess-manage-1「用户手开会话一」的当前回合停掉",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-manage",
    });
    expect(recorded.ok).toBe(true);
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.autoNotice);
    await flushAsync(20);
    expect(dispatched).toBe(1);
    expect((await service.getSnapshot()).tickets).toHaveLength(1);
  });

  it("observe 模式 manageIntent：explicit 照旧 decision_card（守卫幂等，observe 行为零变化）", async () => {
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: openAssistantDatabase(":memory:"),
    });
    const recorded = await service.recordTrigger({
      text: "请取消闲时任务 task-manage-1「闲时索引重建」",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-manage",
      manageIntent: true,
    });
    expect(recorded.ok).toBe(true);
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });
});

describe("approveDecision 对 manage 建议卡诚实拒绝（10 号详设 §3.1/§3.3 准入门唯一）", () => {
  function createService() {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: LOCAL_IDENTITY,
      database: db,
    });
    setAssistantInventoryProvider(() => inventoryFixture());
    return { service, db };
  }

  it("manage suggested 卡经 approveDecision → validationFailed、卡不消费、零建票、两端口零调用；拒绝后正确入口仍可达", async () => {
    const { service } = createService();
    let manageCalls = 0;
    let dispatchCalls = 0;
    setAssistantManagePort(async () => {
      manageCalls += 1;
      return { ok: true, outcome: "executed", detail: "已发 stop" };
    });
    setAssistantDispatchPort(async (request) => {
      dispatchCalls += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "x" } };
    });
    const decisionId = await seedManageDecision(service);
    // 旧放行口（桌宠速览 approve→approveDecision 的真实落点）对 manage verdict 拒绝。
    const rejected = await service.approveDecision({ decisionId });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe(ASSISTANT_ERROR_CODES.validationFailed);
    expect(rejected.error.reason).toContain("approveManageDecision");
    // 卡不消费、零建票、零执行通道调用。
    const decision = (await service.getSnapshot()).decisions.find((d) => d.id === decisionId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    expect((await service.getSnapshot()).tickets).toHaveLength(0);
    expect(manageCalls).toBe(0);
    expect(dispatchCalls).toBe(0);
    // 拒绝是诚实失败不是消费：正确入口（approveManageDecision 人工 Y）仍可放行。
    expect((await service.approveManageDecision({ decisionId })).ok).toBe(true);
    await flushAsync();
    expect(manageCalls).toBe(1);
    expect(dispatchCalls).toBe(0);
  });

  it("对照：dispatch suggested 卡仍可 approveDecision 建票派发（拒绝只针对 manage verdict）", async () => {
    const { service } = createService();
    setAssistantRouterPort(async () => ({
      ok: true,
      output: JSON.stringify({
        dispatch: {
          targetWorkspaceIdentity: "ws-manage",
          permissionTier: "build",
          briefBase: "verbatim",
        },
        evidence: [{ quote: "修复登录白屏" }],
      }),
    }));
    let dispatchCalls = 0;
    setAssistantDispatchPort(async (request) => {
      dispatchCalls += 1;
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-d" } };
    });
    const recorded = await service.recordTrigger({
      text: "修复登录白屏",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-manage",
    });
    expect(recorded.ok).toBe(true);
    let decisionId: number | undefined;
    for (let i = 0; i < 20; i += 1) {
      const decision = (await service.getSnapshot()).decisions.find(
        (d) => recorded.ok && d.triggerId === recorded.value.triggerId,
      );
      if (decision?.routerState === "suggested") {
        decisionId = decision.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(decisionId).toBeDefined();
    const approved = await service.approveDecision({ decisionId: decisionId! });
    expect(approved.ok).toBe(true);
    expect(dispatchCalls).toBe(1);
    expect((await service.getSnapshot()).tickets).toHaveLength(1);
  });
});
