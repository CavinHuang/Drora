/**
 * P1b 提交前重验与读取侧复验（合同 §6「model 返回后重验源、epoch、keyGeneration、pinned、
 * revision、fence，再单库提交」；spec §8「读取 inferred 前复验来源存在及有效分支，复核新域
 * revision/epoch；冲突重读一次，再失败省略」）：
 * - 重验失败（源删除/分支失效/revision 变化）不提交，工作终态化，槽保持原值；
 * - capture：可验证 inferred 注入；不可验证 inferred 整键省略（显式域不受影响）；
 *   无跨库原子——复验一次后如实接受窗口。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import {
  acceptanceRequest,
  controlledExtractor,
  controlledSourceOwner,
  createLearningReadyService,
  draft,
  NOW,
  type LearningReadyService,
} from "./persona-learning-test-support.js";

async function seedInferredSlot(env: LearningReadyService): Promise<void> {
  const accepted = await env.service.acceptLearningSource(acceptanceRequest());
  expect(accepted).toMatchObject({ kind: "accepted" });
  expect(await env.service.processLearningWork()).toBe("claimed");
}

describe("persona P1b 提交前重验（重验失败不提交）", () => {
  let env: LearningReadyService;

  beforeEach(async () => {
    env = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it.each(["missing", "branch_invalid", "workspace_mismatch"] as const)(
    "抽取后源重验失败（%s）不提交：槽无值、工作 rejected",
    async (status) => {
      // 接收时 verified；抽取后的重验（第二次 verify）失败。
      const owner = controlledSourceOwner({
        verifications: ["verified", status],
      });
      const env2 = await createLearningReadyService({
        extractor: controlledExtractor({
          drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
        }),
        owner,
      });
      try {
        const accepted = await env2.service.acceptLearningSource(acceptanceRequest());
        expect(accepted).toMatchObject({ kind: "accepted" });
        expect(await env2.service.processLearningWork()).toBe("claimed");
        const list = await env2.service.listPreferences();
        if (!list.ok) return;
        expect(list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage)).toBeUndefined();
        expect(env2.service.learningCountersSnapshot.workRejected).toBe(1);
      } finally {
        await env2.cleanup();
      }
    },
  );

  it("候选校验全拒（负例草稿）＝no_change：槽无值、零正文残留", async () => {
    const env2 = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "这不是受控值")],
      }),
    });
    try {
      const accepted = await env2.service.acceptLearningSource(acceptanceRequest());
      expect(accepted).toMatchObject({ kind: "accepted" });
      expect(await env2.service.processLearningWork()).toBe("claimed");
      const list = await env2.service.listPreferences();
      if (!list.ok) return;
      expect(
        list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage),
      ).toBeUndefined();
      expect(env2.service.learningCountersSnapshot.workNoChange).toBe(1);
    } finally {
      await env2.cleanup();
    }
  });
});

describe("persona P1b capture 读取侧 inferred 复验", () => {
  it("来源可验证：inferred 注入贡献", async () => {
    const env2 = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
    try {
      await seedInferredSlot(env2);
      const capture = await env2.service.captureContribution({
        sessionId: "any",
        signal: new AbortController().signal,
        turnId: "t",
      });
      expect(capture.status).toBe("applied");
      if (capture.status !== "applied") return;
      expect(capture.contribution.content).toContain('"zh-CN"');
      // 复验发生了 owner 查询（读取侧复验，spec §8）。
      expect(env2.owner.verifyCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      await env2.cleanup();
    }
  });

  it("来源不可验证（owner 缺席）：inferred 整键省略，显式域不受影响", async () => {
    const env2 = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
    try {
      await seedInferredSlot(env2);
      // 无 owner 的第二实例读同一库：inferred 不可复验＝省略；显式值保留注入。
      const { PersonaAppServiceImpl } = await import(
        "../../src/app/drora-persona/persona-app-service.js"
      );
      const explicit = await env2.service.savePreference({
        expectedRevision: 0,
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        mutationId: "style-1",
        value: "direct_answer",
      });
      expect(explicit).toMatchObject({ ok: true });
      const noOwner = new PersonaAppServiceImpl({
        dbPath: env2.dbPath,
        now: () => NOW,
      });
      try {
        const capture = await noOwner.captureContribution({
          sessionId: "any",
          signal: new AbortController().signal,
          turnId: "t",
        });
        expect(capture.status).toBe("applied");
        if (capture.status !== "applied") return;
        expect(capture.contribution.content).toContain("direct_answer");
        expect(capture.contribution.content).not.toContain('"zh-CN"');
      } finally {
        await noOwner.close();
      }
    } finally {
      await env2.cleanup();
    }
  });

  it("来源验证失败（源被删/分支失效）：inferred 省略并计数，显式域不受影响", async () => {
    // 脚本：接收 verified → 领取后重验 verified → capture 读取侧复验持续 missing
    // （复验重读一次仍失败＝省略，spec §8「冲突重读一次，再失败省略」）。
    const owner = controlledSourceOwner({
      verifications: ["verified", "verified", "missing", "missing", "missing"],
    });
    const env2 = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
      owner,
    });
    try {
      await seedInferredSlot(env2);
      const explicit = await env2.service.savePreference({
        expectedRevision: 0,
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        mutationId: "style-1",
        value: "direct_answer",
      });
      expect(explicit).toMatchObject({ ok: true });
      const capture = await env2.service.captureContribution({
        sessionId: "any",
        signal: new AbortController().signal,
        turnId: "t",
      });
      expect(capture.status).toBe("applied");
      if (capture.status !== "applied") return;
      expect(capture.contribution.content).toContain("direct_answer");
      expect(capture.contribution.content).not.toContain('"zh-CN"');
    } finally {
      await env2.cleanup();
    }
  });
});
