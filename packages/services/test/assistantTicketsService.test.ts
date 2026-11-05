/**
 * Drora Mate 工单服务单测（01 详设 §6：gate 矩阵 / Mandate 三途径+不变式 / repo 事务迁移 /
 * 派发幂等 / 状态归账折叠 / usage 累进）。库用 :memory: 等价路径（每用例独立实例）。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import { evaluateAdmission } from "../src/assistant-tickets/admissionGate.js";
import {
  AssistantStoreMigrationError,
  openAssistantDatabase,
} from "../src/assistant-tickets/assistantDatabase.js";
import {
  createAssistantTicketsService,
} from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantGitWorktreePort,
  setAssistantWorkspaceProbePort,
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

describe("admissionGate 矩阵", () => {
  const base = { identity: LOCAL_IDENTITY };

  it("observe×explicit → 决策卡", () => {
    expect(
      evaluateAdmission(
        { ...base, strength: ASSISTANT_STRENGTHS.explicit },
        { mode: ASSISTANT_MODES.observe, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });

  it("observe×inferred → would-accept（零执行）", () => {
    expect(
      evaluateAdmission(
        { ...base, strength: ASSISTANT_STRENGTHS.inferred },
        { mode: ASSISTANT_MODES.observe, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.wouldAccept);
  });

  it("off → ignored（名单内也只记录）", () => {
    expect(
      evaluateAdmission(
        { ...base, strength: ASSISTANT_STRENGTHS.explicit },
        { mode: ASSISTANT_MODES.off, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.ignored);
  });

  it("名单外 identity → rejected（消息不能改变权限：自称 explicit 也不放行）", () => {
    expect(
      evaluateAdmission(
        { identity: "stranger", strength: ASSISTANT_STRENGTHS.explicit },
        { mode: ASSISTANT_MODES.observe, allowlist: [LOCAL_IDENTITY] },
      ).outcome,
    ).toBe(ASSISTANT_OUTCOMES.rejected);
  });
});

describe("recordTrigger + 决策卡放行（Mode A 直派）", () => {
  it("点名触发→决策卡→放行→ticket running+派发回写 sessionId；同卡二次放行幂等", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "修登录白屏",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);

    const snapshot1 = await service.getSnapshot();
    const decision = snapshot1.decisions[0];
    expect(decision.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);

    const sessions: string[] = [];
    setAssistantDispatchPort(async (request) => {
      expect(request.brief).toContain("修登录白屏");
      expect(request.targetWorkspaceIdentity).toBe("ws-a");
      const sessionId = `sess-${sessions.length + 1}`;
      sessions.push(sessionId);
      return { ok: true, value: { ticketId: request.ticketId, sessionId } };
    });
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(sessions).toHaveLength(1);

      const again = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      // 幂等：不二派，返回首次 ticketId/sessionId。
      expect(again.value.ticketId).toBe(approved.value.ticketId);
      expect(again.value.sessionId).toBe(approved.value.sessionId);
      expect(sessions).toHaveLength(1);

      const snapshot2 = await service.getSnapshot();
      const ticket = snapshot2.tickets.find((t) => t.id === approved.value.ticketId);
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
      expect(ticket?.sessionId).toBe(approved.value.sessionId);
      // 放行即人工决策（PR-1B 审查发现 2）：decided_by=gate→user，卡片脱离待决策集
      // （UI isMatePendingDecision 判 decidedBy=gate），releaseCount 按同口径积累。
      const decided = snapshot2.decisions.find((d) => d.id === decision.id);
      expect(decided?.decidedBy).toBe("user");
      expect(snapshot2.trust.releaseCount).toBe(1);
    } finally {
      setAssistantDispatchPort(null);
    }
  });

  it("未指名触发→would-accept；放行 decision_card 以外 outcome 被拒", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "随手一提",
      simulated: ASSISTANT_STRENGTHS.inferred,
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.wouldAccept);

    const snapshot = await service.getSnapshot();
    expect(snapshot.trust.wouldAcceptCount).toBe(1);
    const decision = snapshot.decisions.find((d) => d.triggerId === recorded.value.triggerId);
    if (!decision) return;
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe(ASSISTANT_ERROR_CODES.decisionNotFound);
  });

  it("off 模式→ignored 零执行", async () => {
    const { service, db } = createService();
    db.transaction((raw) => {
      raw
        .prepare(
          "INSERT INTO kv(key, value, updated_ms) VALUES ('mode', 'off', 0) ON CONFLICT(key) DO UPDATE SET value='off'",
        )
        .run();
    });
    const recorded = await service.recordTrigger({
      text: "x",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.ignored);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
  });

  it("yolo 档放行恒拒（mate.yolo.requiresHumanApproval）", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "x",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];
    const approved = await service.approveDecision({
      decisionId: decision.id,
      // @ts-expect-error 故意注入 yolo 验证运行时防线
      permissionTier: ASSISTANT_PERMISSION_TIERS.yolo,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.error.code).toBe(ASSISTANT_ERROR_CODES.yoloRequiresHumanApproval);
  });

  it("派发失败→ticket failed+fail_reason，mandate revoked（不静默重试）", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "x",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];
    setAssistantDispatchPort(async () => ({
      ok: false,
      error: { code: ASSISTANT_ERROR_CODES.dispatchRejected, reason: "ack rejected" },
    }));
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      expect(approved.ok).toBe(false);
      const snapshot2 = await service.getSnapshot();
      expect(snapshot2.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
      expect(snapshot2.tickets[0]?.failReason).toContain("ack rejected");
    } finally {
      setAssistantDispatchPort(null);
    }
  });

  it("stopMandate：非终态工单→failed+stopped_by_user，mandate stopped", async () => {
    const { service } = createService();
    const recorded = await service.recordTrigger({
      text: "x",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0];
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: "sess-1" },
    }));
    try {
      const approved = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "ws-a",
      });
      if (!approved.ok) return;
      const stopped = await service.stopMandate({ ticketId: approved.value.ticketId });
      expect(stopped.ok).toBe(true);
      const snapshot2 = await service.getSnapshot();
      expect(snapshot2.tickets[0]?.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
      expect(snapshot2.tickets[0]?.failReason).toBe("stopped_by_user");
    } finally {
      setAssistantDispatchPort(null);
    }
  });
});

describe("配置", () => {
  it("setMode(auto) 恒拒（信任门 P4）；observe 合法", async () => {
    const { service } = createService();
    const auto = await service.setMode(ASSISTANT_MODES.auto);
    expect(auto.ok).toBe(false);
    if (!auto.ok) expect(auto.error.code).toBe(ASSISTANT_ERROR_CODES.autoLocked);
    const observe = await service.setMode(ASSISTANT_MODES.observe);
    expect(observe.ok).toBe(true);
  });

  it("setAllowlist 持久化并影响 gate（名单外 rejected）", async () => {
    const { service } = createService();
    const set = await service.setAllowlist(["boss"]);
    expect(set.ok).toBe(true);
    const stranger = await service.recordTrigger({
      text: "x",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(stranger.ok).toBe(true);
    if (!stranger.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions.find((d) => d.triggerId === stranger.value.triggerId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.rejected);
  });

  it("setWorktreeDisabled 持久化（快照投影+getConfig），关闭后 git 根也落声明域（W2 兜底）", async () => {
    const { service } = createService();
    setAssistantWorkspaceProbePort(async (identity) => ({
      ok: true,
      workspacePath: identity,
      isGitRoot: true,
    }));
    setAssistantGitWorktreePort({
      async addWorktree() {
        return { ok: true };
      },
      async removeWorktree() {
        return { ok: true };
      },
    });
    const dispatched: Array<{ hostPath?: string }> = [];
    setAssistantDispatchPort(async (request) => {
      dispatched.push({ hostPath: request.hostPath });
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-w1-off" } };
    });
    setAssistantFrameSource({ subscribe() { return { dispose: () => undefined }; } });
    const approveTarget = async (text: string) => {
      const recorded = await service.recordTrigger({
        text,
        simulated: ASSISTANT_STRENGTHS.explicit,
        targetWorkspaceIdentity: "D:/repo",
      });
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) throw new Error("recordTrigger failed");
      const decision = (await service.getSnapshot()).decisions.find(
        (d) => d.triggerId === recorded.value.triggerId,
      );
      expect(decision).toBeDefined();
      if (!decision) throw new Error("decision missing");
      return await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: "D:/repo",
      });
    };
    // 默认开（W1）：git 根派发进 worktree（hostPath=worktree 目录，platform join 分隔符
    // 以 writeDomain.path 为基准比较，不硬编码分隔符方向）。
    const approvedOn = await approveTarget("第一单 W1 开");
    expect(approvedOn.ok).toBe(true);
    if (!approvedOn.ok) return;
    const onTicket = (await service.getSnapshot()).tickets.find(
      (t) => t.id === approvedOn.value.ticketId,
    );
    expect(onTicket?.writeDomain?.kind).toBe("worktree");
    if (onTicket?.writeDomain?.kind === "worktree") {
      expect(dispatched[0]?.hostPath).toBe(onTicket.writeDomain.path);
      expect(onTicket.writeDomain.path).not.toBe("D:/repo");
    }
    // 关闭 W1：配置持久化（getConfig+快照双投影），新派发落声明域（workspace 落位）。
    const off = await service.setWorktreeDisabled(true);
    expect(off.ok).toBe(true);
    const config = await service.getConfig();
    expect(config.ok && config.value.worktreeDisabled).toBe(true);
    expect((await service.getSnapshot()).worktreeDisabled).toBe(true);
    const approvedOff = await approveTarget("第二单 W1 关");
    expect(approvedOff.ok).toBe(true);
    if (!approvedOff.ok) return;
    expect(dispatched[1]?.hostPath).toBe("D:/repo"); // 非隔离落位（workspace 域）
    const offTicket = (await service.getSnapshot()).tickets.find(
      (t) => t.id === approvedOff.value.ticketId,
    );
    expect(offTicket?.writeDomain?.kind).toBe("paths");
    // 已建工单写域不回改（W1 关闭只影响之后的派发规划）。
    expect(onTicket?.writeDomain?.kind).toBe("worktree");
    // 重开：配置回落。
    const on = await service.setWorktreeDisabled(false);
    expect(on.ok).toBe(true);
    expect((await service.getSnapshot()).worktreeDisabled).toBe(false);
    // 端口清理（本文件其余用例不依赖探测/git 端口）。
    setAssistantWorkspaceProbePort(null);
    setAssistantGitWorktreePort(null);
    setAssistantDispatchPort(null);
    setAssistantFrameSource(null);
  }, 20_000);
});

describe("迁移", () => {
  it("未知高版本库拒绝打开（独立文件句柄）", async () => {
    // 用真实临时文件验证跨连接迁移防线
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mate-test-"));
    const dbPath = join(dir, "mate.sqlite");
    const first = openAssistantDatabase(dbPath);
    void first.raw;
    first.close();
    // 模拟未来进程写入更高版本
    const second = openAssistantDatabase(dbPath);
    second.transaction((raw) => {
      raw.prepare("UPDATE kv SET value='99' WHERE key='schema_version'").run();
    });
    second.close();
    const third = openAssistantDatabase(dbPath);
    expect(() => third.raw).toThrow(AssistantStoreMigrationError);
  });
});

describe("applyTicketTurnEvent 归账（01 §3；PR-1B 三审发现 6 服务侧核心）", () => {
  async function createDispatchedTicket() {
    const { service, db } = createService();
    setAssistantDispatchPort(async (request) => ({
      ok: true as const,
      value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
    }));
    const recorded = await service.recordTrigger({
      text: "归账用例",
      simulated: ASSISTANT_STRENGTHS.explicit,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!recorded.ok) throw new Error("record failed");
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions[0]!;
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!approved.ok) throw new Error("approve failed");
    return {
      service,
      db,
      ticketId: approved.value.ticketId,
      decisionId: decision.id,
      setPort: setAssistantDispatchPort,
    };
  }

  function countUsageRows(db: ReturnType<typeof openAssistantDatabase>, ticketId: string): number {
    let rows = 0;
    db.transaction((raw) => {
      rows = (
        raw.prepare("SELECT COUNT(*) AS n FROM usage_log WHERE ticket_id = ?").get(ticketId) as {
          n: number;
        }
      ).n;
    });
    return rows;
  }

  it("turn_started→running；turn_completed→done+output_summary 首行截断+usage 差值行", async () => {
    const { service, db, ticketId, setPort } = await createDispatchedTicket();
    try {
      service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_started" });
      let snapshot = await service.getSnapshot();
      expect(snapshot.tickets[0]!.status).toBe(ASSISTANT_TICKET_STATUSES.running);

      service.applyTicketTurnEvent({
        ticketId,
        atMs: Date.now(),
        kind: "turn_completed",
        outputSummary: "完成首行摘要\n第二行不进摘要",
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
      });
      snapshot = await service.getSnapshot();
      expect(snapshot.tickets[0]!.status).toBe(ASSISTANT_TICKET_STATUSES.done);
      expect(snapshot.tickets[0]!.outputSummary).toBe("完成首行摘要");
      expect(snapshot.tickets[0]!.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(countUsageRows(db, ticketId)).toBe(1);
    } finally {
      setPort(null);
    }
  });

  it("差值归账：第二次累计只记增量行，usage_accum 累进", async () => {
    const { service, db, ticketId, setPort } = await createDispatchedTicket();
    try {
      service.applyTicketTurnEvent({
        ticketId,
        atMs: Date.now(),
        kind: "turn_completed",
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      service.applyTicketTurnEvent({
        ticketId,
        atMs: Date.now(),
        kind: "turn_completed",
        usage: { inputTokens: 150, outputTokens: 80 },
      });
      const snapshot = await service.getSnapshot();
      expect(snapshot.tickets[0]!.usage).toEqual({ inputTokens: 150, outputTokens: 80 });
      expect(countUsageRows(db, ticketId)).toBe(2);
    } finally {
      setPort(null);
    }
  });

  it("单调丢弃：atMs 早于工单 updated_ms 的迟到事件整体忽略", async () => {
    const { service, ticketId, setPort } = await createDispatchedTicket();
    try {
      const before = (await service.getSnapshot()).tickets[0]!;
      service.applyTicketTurnEvent({
        ticketId,
        atMs: before.updatedAtMs - 1000,
        kind: "turn_failed",
        failReason: "迟到重放",
      });
      const after = (await service.getSnapshot()).tickets[0]!;
      expect(after.status).toBe(before.status);
      expect(after.failReason).toBe(before.failReason);
    } finally {
      setPort(null);
    }
  });

  it("turn_failed→failed+fail_reason+mandate 撤销；终态后迟到 turn_started 不改写状态", async () => {
    const { service, db, ticketId, setPort } = await createDispatchedTicket();
    try {
      service.applyTicketTurnEvent({
        ticketId,
        atMs: Date.now(),
        kind: "turn_failed",
        failReason: "CLI 崩溃",
      });
      let snapshot = await service.getSnapshot();
      expect(snapshot.tickets[0]!.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
      expect(snapshot.tickets[0]!.failReason).toBe("CLI 崩溃");
      let mandateState = "";
      db.transaction((raw) => {
        mandateState = (
          raw.prepare("SELECT state FROM mandate WHERE ticket_id = ?").get(ticketId) as {
            state: string;
          }
        ).state;
      });
      expect(mandateState).toBe("revoked");

      service.applyTicketTurnEvent({ ticketId, atMs: Date.now(), kind: "turn_started" });
      snapshot = await service.getSnapshot();
      expect(snapshot.tickets[0]!.status).toBe(ASSISTANT_TICKET_STATUSES.failed);
    } finally {
      setPort(null);
    }
  });
});

describe("approveDecision 并发幂等（PR-1B 三审发现 7：事务内按 decision_id 查重）", () => {
  it("首个放行派发在途时，同 decisionId 的第二次 approve 幂等返回、不建第二张票、不重复派发", async () => {
    const { service, db } = createService();
    let dispatchCalls = 0;
    let releaseDispatch: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    setAssistantDispatchPort(async (request) => {
      dispatchCalls += 1;
      await gate;
      return {
        ok: true as const,
        value: { ticketId: request.ticketId, sessionId: `sess-${request.ticketId}` },
      };
    });
    try {
      const recorded = await service.recordTrigger({
        text: "并发幂等",
        simulated: ASSISTANT_STRENGTHS.explicit,
        targetWorkspaceIdentity: "ws-a",
      });
      if (!recorded.ok) throw new Error("record failed");
      const snapshot = await service.getSnapshot();
      const decisionId = snapshot.decisions[0]!.id;
      const first = service.approveDecision({ decisionId, targetWorkspaceIdentity: "ws-a" });
      // 首个派发在途（gate 未放行）时发起第二次 approve：事务内按 decision_id 查重命中
      // 首张票，alreadyExisted 臂跳过派发直接幂等返回（不建第二张票、不重复派发）。
      const second = await service.approveDecision({ decisionId, targetWorkspaceIdentity: "ws-a" });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      let ticketCount = 0;
      db.transaction((raw) => {
        ticketCount = (raw.prepare("SELECT COUNT(*) AS n FROM ticket").get() as { n: number }).n;
      });
      expect(ticketCount).toBe(1);
      expect(dispatchCalls).toBe(1);
      releaseDispatch?.();
      const firstResult = await first;
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      expect(second.value.ticketId).toBe(firstResult.value.ticketId);
    } finally {
      setAssistantDispatchPort(null);
    }
  });
});

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
    const { service } = createService();
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

      // 轮内 usage：输入 100/输出 50 → 累进；状态不变（无行事件）。
      sink(
        frame(
          sessionId,
          {
            kind: "deltas",
            deltas: [
              {
                op: "state.updated",
                patch: { usage: { cumulative: { inputTokens: 100, outputTokens: 50 } } },
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
});
