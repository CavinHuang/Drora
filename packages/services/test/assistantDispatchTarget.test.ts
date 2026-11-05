/**
 * F1 回归（2026-11-06 运行链可用性审查）：无 identity workspace 的派发目标全链可达。
 *
 * 断链背景：本地 tab 的 workspaceIdentity 恒 undefined（node.ts prepareProjectExecution
 * 显式 undefined），旧 UI 仅在 tab.workspaceIdentity 真值时携带 targetWorkspaceIdentity
 * → trigger.workspace_identity=NULL → approveDecision 兜底链
 * （input.target ?? suggestedTarget ?? decision.workspace_identity ?? ""）全落空
 * → validationFailed「缺少派发目标 workspace」，默认桌面场景放行必失败。
 *
 * 修复契约（AGENTS 身份键规则）：派发目标=workspaceKey（workspaceIdentity?.trim()||
 * workspacePath）。本地 tab 的 workspaceKey=本地绝对路径——恰是 workspaceProbe 端口的
 * 合法形态（node.ts setAssistantWorkspaceProbePort 接受本地绝对目录并返回 workspacePath）；
 * 修复后 recordTrigger 落 trigger.workspace_identity=workspaceKey，approve 兜底链第三跳
 * 命中，托盘 decide（无 tab 上下文、不带 target）与 auto 无目标降级自然闭合。
 *
 * 本文件是纯服务层测试（不用 UI fixture——fixture 曾自带 workspaceIdentity 兜底，掩盖过
 * 本断链）：锁两条路径——①显式传（改选目标重放）②兜底链命中（approve 不带显式 target）。
 */
// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  ASSISTANT_TICKET_STATUSES,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantDispatchPort,
  setAssistantWorkspaceProbePort,
} from "../src/assistant-tickets/assistantPorts.js";

const LOCAL_IDENTITY = "local-user";

function createService() {
  const db = openAssistantDatabase(":memory:");
  return createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
}

/** os.tmpdir 下真实临时目录（workspaceProbe 端口的合法形态：本地绝对路径且是目录）。 */
function createTempWorkspaceDir(): string {
  return mkdtempSync(join(tmpdir(), "mate-f1-target-"));
}

describe("无 identity workspace 的派发目标链（F1 回归）", () => {
  it("本地形态（target=绝对路径）：recordTrigger 带 target → 决策卡 → approve 不带显式 target（兜底链命中）→ dispatch port 收到 target", async () => {
    const service = createService();
    const target = createTempWorkspaceDir();
    const probeReceived: string[] = [];
    // workspaceProbe fake：校验收到的探测目标即本路径（装配层行为的等价 fake；
    // 非 git 根 → W1 落声明域，无需 git worktree 端口）。
    setAssistantWorkspaceProbePort(async (identity) => {
      probeReceived.push(identity);
      expect(identity).toBe(target);
      return { ok: true, workspacePath: identity, isGitRoot: false };
    });
    const dispatchTargets: string[] = [];
    setAssistantDispatchPort(async (request) => {
      dispatchTargets.push(request.targetWorkspaceIdentity);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-f1-1" } };
    });
    try {
      // recordTrigger 不带任何 UI 特判：target=workspaceKey（本地 tab=本地绝对路径）。
      const recorded = await service.recordTrigger({
        text: "修登录白屏",
        simulated: ASSISTANT_STRENGTHS.explicit,
        targetWorkspaceIdentity: target,
      });
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) return;
      expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);

      const snapshot1 = await service.getSnapshot();
      // trigger.workspace_identity 已落（决策卡 approve 兜底链第三跳的事实源）。
      const trigger = snapshot1.triggers.find((t) => t.id === recorded.value.triggerId);
      expect(trigger?.targetWorkspaceIdentity).toBe(target);

      const decision = snapshot1.decisions.find((d) => d.triggerId === recorded.value.triggerId);
      expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
      if (!decision) return;

      // 托盘 decide / 决策卡无 Router 建议放行的同参形态：不带显式 target——
      // 服务兜底链 input.target ?? suggestedTarget ?? decision.workspace_identity 必须
      // 第三跳命中，不再 validationFailed「缺少派发目标 workspace」。
      const approved = await service.approveDecision({ decisionId: decision.id });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(dispatchTargets).toEqual([target]);

      const snapshot2 = await service.getSnapshot();
      const ticket = snapshot2.tickets.find((t) => t.id === approved.value.ticketId);
      expect(ticket?.status).toBe(ASSISTANT_TICKET_STATUSES.running);
      expect(ticket?.targetWorkspaceIdentity).toBe(target);
    } finally {
      setAssistantWorkspaceProbePort(null);
      setAssistantDispatchPort(null);
    }
  });

  it("远程形态（target=非绝对路径 identity）→ probe 诚实拒绝：approve 失败、卡不消费可改选重放", async () => {
    const service = createService();
    const remoteIdentity = "remote-host:ws-identity";
    const fallbackTarget = createTempWorkspaceDir();
    const probeReceived: string[] = [];
    setAssistantWorkspaceProbePort(async (identity) => {
      probeReceived.push(identity);
      // 装配层 node.ts setAssistantWorkspaceProbePort 同款拒绝：非本地绝对路径 → 拒绝。
      if (!isAbsolute(identity.trim())) {
        return { ok: false, reason: "目标非本地绝对路径（P2 W1 本地限定）" };
      }
      return { ok: true, workspacePath: identity.trim(), isGitRoot: false };
    });
    const dispatchTargets: string[] = [];
    setAssistantDispatchPort(async (request) => {
      dispatchTargets.push(request.targetWorkspaceIdentity);
      return { ok: true, value: { ticketId: request.ticketId, sessionId: "sess-f1-2" } };
    });
    try {
      // 远程 tab 的 workspaceKey=远程 identity（非绝对路径）——UI 修复后同样原样透传。
      const recorded = await service.recordTrigger({
        text: "查 CI 失败原因",
        simulated: ASSISTANT_STRENGTHS.explicit,
        targetWorkspaceIdentity: remoteIdentity,
      });
      expect(recorded.ok).toBe(true);
      if (!recorded.ok) return;
      expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);

      const snapshot1 = await service.getSnapshot();
      const decision = snapshot1.decisions.find((d) => d.triggerId === recorded.value.triggerId);
      if (!decision) return;

      // 兜底链命中远程 identity → probe 诚实拒绝（spec §8「拒绝猜测，问人」）：
      // 放行失败、不建票、卡不消费（decidedBy 仍 gate），人工可改选目标后重放。
      const rejected = await service.approveDecision({ decisionId: decision.id });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.error.code).toBe(ASSISTANT_ERROR_CODES.dispatchRejected);
        expect(rejected.error.reason).toContain("workspace 探测失败，决策卡未消费");
      }
      expect(dispatchTargets).toHaveLength(0);

      const snapshot2 = await service.getSnapshot();
      expect(snapshot2.tickets).toHaveLength(0);
      const stillPending = snapshot2.decisions.find((d) => d.id === decision.id);
      expect(stillPending?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
      expect(stillPending?.decidedBy).toBe("gate");

      // 改选目标（显式传本地绝对路径）重放 → 同一卡放行成功（显式传路径锁定）。
      const replayed = await service.approveDecision({
        decisionId: decision.id,
        targetWorkspaceIdentity: fallbackTarget,
      });
      expect(replayed.ok).toBe(true);
      expect(dispatchTargets).toEqual([fallbackTarget]);
    } finally {
      setAssistantWorkspaceProbePort(null);
      setAssistantDispatchPort(null);
    }
  });
});
