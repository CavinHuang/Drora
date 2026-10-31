import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPersonaStore } from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  PERSONA_LEARNING_BUDGET,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_STORAGE_KEYS,
  PERSONA_TEMPLATE_VERSION,
} from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";

/**
 * P1b 学习管理面（合同 §3 allowLearningForKey＋读侧概览；spec §5/§8/§10）：
 * - allowLearningForKey 服务校验（mutationId/key/generation）与 store 屏障语义的组合；
 * - getPersonaLearningOverview 与 store 只读方法逐键对齐：policy 取自 readSnapshot、
 *   budget 取自 readLearningBudgetUsage、sources 取自 readInferredSlotSources（无正文、
 *   无复验内部定位）、counters 为本进程学习计数；未初始化如实返回 uninitialized 臂。
 * 用真实 openPersonaStore（临时库）——wire strict 与仓储行形状的冲突只能在真实形状上暴露。
 */

const NOW = 1_760_000_000_000;

function digest(...parts: Array<unknown>): string {
  return JSON.stringify(parts);
}

describe("PersonaAppService P1b 学习管理（allowLearningForKey / getPersonaLearningOverview）", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-mgmt-"));
    dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createService(): PersonaAppServiceImpl {
    return new PersonaAppServiceImpl({ dbPath, now: () => NOW });
  }

  async function initializeSuppressed(service: PersonaAppServiceImpl): Promise<void> {
    const init = await service.initializePersona({ mutationId: "init-1" });
    expect(init.ok).toBe(true);
    const save = await service.savePreference({
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      value: "阿明",
      expectedRevision: 0,
      mutationId: "save-1",
    });
    expect(save).toMatchObject({ ok: true, value: { status: "saved" } });
    const forget = await service.forgetPreference({
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedRevision: 1,
      mutationId: "forget-1",
    });
    expect(forget).toMatchObject({
      ok: true,
      value: { status: "forgotten", revision: 2, keyGeneration: 2 },
    });
  }

  it("allowLearningForKey：解除抑制返回 saved（generation++），listPreferences 如实反映", async () => {
    const service = createService();
    try {
      await initializeSuppressed(service);
      const allowed = await service.allowLearningForKey({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        expectedGeneration: 2,
        mutationId: "allow-1",
      });
      expect(allowed).toEqual({
        ok: true,
        value: { status: "saved", revision: 3, keyGeneration: 3 },
      });
      const slots = await service.listPreferences();
      expect(slots.ok).toBe(true);
      if (!slots.ok) return;
      const slot = slots.value.find(
        (entry) => entry.key === PERSONA_PREFERENCE_KEYS.preferredAddress,
      );
      expect(slot).toMatchObject({ autoSuppressed: false, status: "forgotten", value: "" });
    } finally {
      await service.close();
    }
  });

  it("allowLearningForKey 校验：未知键/坏 mutationId/负 generation 拒绝；CAS 冲突透传", async () => {
    const service = createService();
    try {
      await initializeSuppressed(service);
      const badKey = await service.allowLearningForKey({
        key: "mood" as typeof PERSONA_PREFERENCE_KEYS.replyLanguage,
        expectedGeneration: 2,
        mutationId: "allow-bad-key",
      });
      expect(badKey).toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const badMutation = await service.allowLearningForKey({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        expectedGeneration: 2,
        mutationId: "   ",
      });
      expect(badMutation).toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const badGeneration = await service.allowLearningForKey({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        expectedGeneration: -1,
        mutationId: "allow-bad-gen",
      });
      expect(badGeneration).toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const conflict = await service.allowLearningForKey({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        expectedGeneration: 1,
        mutationId: "allow-stale",
      });
      expect(conflict).toEqual({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    } finally {
      await service.close();
    }
  });

  it("getPersonaLearningOverview：initialized 臂与 store 行逐键对齐（policy/budget/sources/counters）", async () => {
    const service = createService();
    try {
      await initializeSuppressed(service);
      const policy = await service.setPersonalPolicy({
        expectedPolicyRevision: 0,
        usePreferences: true,
        mutationId: "policy-1",
      });
      expect(policy).toMatchObject({ ok: true, value: { status: "saved" } });

      const overview = await service.getPersonaLearningOverview();
      expect(overview.ok).toBe(true);
      if (!overview.ok) return;
      expect(overview.value.state).toBe("initialized");
      if (overview.value.state !== "initialized") return;
      // policy 行与 store readSnapshot 同源：U on、L off（patch 缺省保持）。
      expect(overview.value.policy).toEqual({
        usePreferences: true,
        autoLearn: false,
        policyRevision: 1,
        policyEpoch: 1,
        learningGeneration: 0,
      });
      // 预算台账：当日零记账（day 与服务 UTC 日一致，计数为 0），上界常量来自 shared 单一出处。
      expect(overview.value.budget).toEqual({
        day: new Date(NOW).toISOString().slice(0, 10),
        attemptsUsed: 0,
        inputTokensUsed: 0,
        outputTokensUsed: 0,
      });
      expect(PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax).toBe(10);
      // 无接收来源：sources 为空数组；counters 是本进程计数（未接收全零）。
      expect(overview.value.sources).toEqual([]);
      expect(overview.value.counters.received).toBe(0);
    } finally {
      await service.close();
    }
  });

  it("getPersonaLearningOverview：未初始化如实返回 uninitialized；不建库外的任何身份", async () => {
    const service = createService();
    try {
      const overview = await service.getPersonaLearningOverview();
      expect(overview).toEqual({ ok: true, value: { state: "uninitialized" } });
    } finally {
      await service.close();
    }
  });

  it("概览 sources 来自 readInferredSlotSources：inferred 首写后出现定位行（无正文）", async () => {
    const service = createService();
    try {
      await initializeSuppressed(service);
      // 解除抑制后走学习首写：store.learning 直写（本测试只关心概览映射，不驱动完整编排）。
      const allowed = await service.allowLearningForKey({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        expectedGeneration: 2,
        mutationId: "allow-1",
      });
      expect(allowed).toMatchObject({ ok: true });
      const store = await openPersonaStore({ dbPath });
      try {
        const policyOn = await store.updatePolicy({
          mutationId: "policy-on",
          requestDigest: digest("policy-on"),
          now: NOW,
          expectedPolicyRevision: 0,
          usePreferences: true,
          autoLearn: true,
        });
        expect(policyOn).toMatchObject({ ok: true });
        const snapshot = await store.readSnapshot();
        if (snapshot.state !== "initialized") return;
        const accept = await store.learning.acceptLearningEvidence({
          evidenceId: "ev-overview",
          sourceHandle: {
            authorityId: snapshot.authority.authorityId,
            workspaceKey: "/ws",
            sessionId: "sess-9",
            productTurnId: "turn-9",
            origin: "drora-cli-local-runtime",
            sourceRevision: "rev-9",
            messageBoundary: "{}",
            branchEvidence: "branch-9",
          },
          policyEpoch: 1,
          keyGenerations: { [PERSONA_PREFERENCE_KEYS.preferredAddress]: 3 },
          now: NOW,
        });
        expect(accept).toMatchObject({ ok: true });
        const claim = await store.learning.claimLearningWork({
          leaseOwner: "worker-a",
          leaseDurationMs: 60_000,
          now: NOW,
        });
        if (!claim.ok || claim.value.status !== "claimed") return;
        const commit = await store.learning.commitLearningWork({
          workId: claim.value.claim.workId,
          fence: claim.value.claim.fence,
          candidates: [
            {
              key: PERSONA_PREFERENCE_KEYS.preferredAddress,
              value: "小张",
              evidenceRefs: ["0:0:2:小张"],
            },
          ],
          now: NOW,
        });
        expect(commit).toMatchObject({ ok: true, value: { status: "applied" } });
      } finally {
        await store.close();
      }

      const overview = await service.getPersonaLearningOverview();
      expect(overview.ok).toBe(true);
      if (!overview.ok || overview.value.state !== "initialized") return;
      // 定位四元组与 store 行一致；无 messageBoundary/sourceRevision 等复验内部定位，无正文。
      expect(overview.value.sources).toEqual([
        {
          key: PERSONA_PREFERENCE_KEYS.preferredAddress,
          evidenceId: "ev-overview",
          workspaceKey: "/ws",
          sessionId: "sess-9",
        },
      ]);
    } finally {
      await service.close();
    }
  });

  it("产品模板版本常量钉住（初始化路径不变；防概览改动漂移核心域）", async () => {
    const service = createService();
    try {
      const init = await service.initializePersona({ mutationId: "init-1" });
      expect(init).toMatchObject({
        ok: true,
        value: { status: "created", templateVersion: PERSONA_TEMPLATE_VERSION },
      });
    } finally {
      await service.close();
    }
  });
});
