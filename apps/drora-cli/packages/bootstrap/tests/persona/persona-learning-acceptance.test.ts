/**
 * P1b 学习接收门矩阵（specs/drora-persona-system.md §5「E && Q && U && L && 预算 && 成功源
 * 证据」；合同 §3 acceptLearningSource 内部方法、§6「缺证据即跳过」）：任一门缺失＝零接收
 * （不入库、可计跳过原因）；evidenceId 由服务对稳定源身份构造（同源同 ID/异源异 ID/重复
 * 接收幂等）。编排/校验/通知语义见同目录其他文件。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERSONA_LEARNING_BUDGET,
  PERSONA_STORAGE_KEYS,
} from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";
import {
  acceptanceRequest,
  controlledSourceOwner,
  createLearningReadyService,
  NOW,
  type LearningReadyService,
} from "./persona-learning-test-support.js";

describe("persona P1b 学习接收门矩阵（任一缺失＝零接收）", () => {
  let env: LearningReadyService;

  beforeEach(async () => {
    env = await createLearningReadyService();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("E off 一票拒绝：不入库，后续同源接收为 accepted（证明此前零存储）", async () => {
    const skipped = await env.service.acceptLearningSource(
      acceptanceRequest({ personaPermission: false }),
    );
    expect(skipped).toEqual({ kind: "skipped", reason: "permission_not_granted" });
    expect(env.service.learningCountersSnapshot.acceptSkipped.permission_not_granted).toBe(1);
    const after = await env.service.acceptLearningSource(acceptanceRequest());
    expect(after).toMatchObject({ kind: "accepted" });
  });

  it("来源结构非法（空 workspaceKey / 空边界）＝invalid_source 不入库", async () => {
    const badWorkspace = await env.service.acceptLearningSource(
      acceptanceRequest({ workspaceKey: "   " }),
    );
    expect(badWorkspace).toEqual({ kind: "skipped", reason: "invalid_source" });
    const badBoundary = await env.service.acceptLearningSource(
      acceptanceRequest({ boundary: { boundaryMessageId: "", userMessageId: "u1" } }),
    );
    expect(badBoundary).toEqual({ kind: "skipped", reason: "invalid_source" });
  });

  it("owner 无法证明成功持久边界＝source_unverified 不入库（缺证据即跳过）", async () => {
    const owner = controlledSourceOwner({ verifications: ["missing"] });
    const env2 = await createLearningReadyService({ owner });
    try {
      const outcome = await env2.service.acceptLearningSource(acceptanceRequest());
      expect(outcome).toEqual({ kind: "skipped", reason: "source_unverified" });
      expect(owner.verifyCalls).toHaveLength(1);
    } finally {
      await env2.cleanup();
    }
  });

  it("owner 窗口不可用＝source_unverified 不入库", async () => {
    const noWindow = controlledSourceOwner({ messages: undefined });
    const envNoWindow = await createLearningReadyService({ owner: noWindow });
    try {
      const outcome = await envNoWindow.service.acceptLearningSource(acceptanceRequest());
      expect(outcome).toEqual({ kind: "skipped", reason: "source_unverified" });
    } finally {
      await envNoWindow.cleanup();
    }
  });

  it.each([
    { name: "L off", patch: { autoLearn: false, usePreferences: true } },
    { name: "U off（同事务级联关 L）", patch: { usePreferences: false } },
  ])("$name ＝policy_disabled 不入库", async ({ patch }) => {
    const env2 = await createLearningReadyService();
    try {
      const policy = await env2.service.setPersonalPolicy({
        ...patch,
        expectedPolicyRevision: 1,
        mutationId: `policy-${patch.name}`,
      });
      expect(policy).toMatchObject({ ok: true });
      const outcome = await env2.service.acceptLearningSource(acceptanceRequest());
      expect(outcome).toEqual({ kind: "skipped", reason: "policy_disabled" });
    } finally {
      await env2.cleanup();
    }
  });

  it("预算耗尽＝budget_exhausted 不入库（日尝试上界，DB 台账判定）", async () => {
    const second = await env.openSecondStore();
    try {
      for (let attempt = 0; attempt < PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax; attempt += 1) {
        const reserved = await second.learning.reserveLearningBudget({
          estimatedInputTokens: 10,
          maxOutputTokens: 10,
          now: NOW,
        });
        expect(reserved.ok).toBe(true);
      }
      const outcome = await env.service.acceptLearningSource(acceptanceRequest());
      expect(outcome).toEqual({ kind: "skipped", reason: "budget_exhausted" });
    } finally {
      await second.close();
    }
  });

  it("未初始化＝uninitialized 不入库", async () => {
    const freshRoot = await mkdtemp(join(tmpdir(), "drora-persona-p1b-uninit-"));
    try {
      const fresh = new PersonaAppServiceImpl({
        dbPath: join(freshRoot, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database),
        learning: { sourceOwner: controlledSourceOwner() },
        now: () => NOW,
      });
      try {
        const outcome = await fresh.acceptLearningSource(acceptanceRequest());
        expect(outcome).toEqual({ kind: "skipped", reason: "uninitialized" });
      } finally {
        await fresh.close();
      }
    } finally {
      await rm(freshRoot, { recursive: true, force: true });
    }
  });

  it("evidenceId 稳定：同源身份重复接收 already_accepted，异轮异 ID", async () => {
    const first = await env.service.acceptLearningSource(acceptanceRequest());
    expect(first).toMatchObject({ kind: "accepted" });
    const duplicate = await env.service.acceptLearningSource(acceptanceRequest());
    expect(duplicate).toEqual({ kind: "already_accepted", evidenceId: first.evidenceId });
    expect(env.service.learningCountersSnapshot.acceptAlreadyAccepted).toBe(1);
    const otherTurn = await env.service.acceptLearningSource(
      acceptanceRequest({ turnId: "turn-2" }),
    );
    expect(otherTurn).toMatchObject({ kind: "accepted" });
    expect(otherTurn.kind === "accepted" ? otherTurn.evidenceId : "").not.toBe(
      first.kind === "accepted" || first.kind === "already_accepted" ? first.evidenceId : "",
    );
  });
});
