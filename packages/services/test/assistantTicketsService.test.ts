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
  setAssistantDispatchPort,
} from "../src/assistant-tickets/assistantTicketsService.js";

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
