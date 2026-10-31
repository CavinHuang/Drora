/**
 * P1b paused 抽取适配器语义（合同 §6「配置不可用暂停，不换模型绕过用户选择」）：生产缺省
 * （未提供 extractor）＝零模型调用、零预算预留，工作按 retry_wait 等待并在尝试上限内被库
 * 终态化（24 小时/2 次尝试由仓储执行）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_LEARNING_BUDGET, PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import {
  acceptanceRequest,
  controlledExtractor,
  createLearningReadyService,
  draft,
  NOW,
  type LearningReadyService,
} from "./persona-learning-test-support.js";

describe("persona P1b paused 抽取适配器（生产默认）", () => {
  let env: LearningReadyService;

  beforeEach(async () => {
    // 未提供 extractor：服务缺省绑定 paused 适配器。
    env = await createLearningReadyService();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("paused：零预算预留、零抽取调用，工作 retry_wait；尝试耗尽后库终态化 rejected", async () => {
    const accepted = await env.service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    expect(await env.service.processLearningWork()).toBe("claimed");
    // 第一次处理：paused → retry_wait，不预留预算。
    const second = await env.openSecondStore();
    try {
      const budget = await second.learning.readLearningBudgetUsage(NOW);
      expect(budget.ok).toBe(true);
      if (budget.ok) {
        expect(budget.value.attemptsUsed).toBe(0);
        expect(budget.value.inputTokensUsed).toBe(0);
        expect(budget.value.outputTokensUsed).toBe(0);
      }
    } finally {
      await second.close();
    }
    expect(env.service.learningCountersSnapshot.workRetryWait).toBe(1);
    // 重领（过期/可领）→ 第二次尝试：库把尝试耗尽的工作终态化 rejected（≤2 次）。
    expect(await env.service.processLearningWork()).toBe("claimed");
    expect(env.service.learningCountersSnapshot.workRejected).toBe(1);
    // 显式域不受影响：inferred 槽不存在（零模型输出）。
    const list = await env.service.listPreferences();
    if (!list.ok) return;
    expect(
      list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage),
    ).toBeUndefined();
  });

  it("对照：configured 抽取器按预留→核销记账预算（尝试计入）", async () => {
    const env2 = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
    try {
      const accepted = await env2.service.acceptLearningSource(acceptanceRequest());
      expect(accepted).toMatchObject({ kind: "accepted" });
      expect(await env2.service.processLearningWork()).toBe("claimed");
      const second = await env2.openSecondStore();
      try {
        const budget = await second.learning.readLearningBudgetUsage(NOW);
        expect(budget.ok).toBe(true);
        if (budget.ok) {
          // 尝试计入（不退）；token 按实际用量退差：输入预留 est(17cp→5)，实际 12 > 预留
          // 不退差＝5；输出预留 400（日 4,000÷10 次均分），实际 7 → 退 393 余 7。
          expect(budget.value.attemptsUsed).toBe(1);
          expect(budget.value.inputTokensUsed).toBe(5);
          expect(budget.value.outputTokensUsed).toBe(7);
        }
      } finally {
        await second.close();
      }
    } finally {
      await env2.cleanup();
    }
  });

  it("预算耗尽的工作不换模型复活：retry_wait 后被日上界持续拦截", async () => {
    const accepted = await env.service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    // 在工作运行前用第二连接耗尽日尝试预算（小额定值只消耗尝试数）。
    const second = await env.openSecondStore();
    try {
      for (
        let attempt = 0;
        attempt < PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax;
        attempt += 1
      ) {
        const reserved = await second.learning.reserveLearningBudget({
          estimatedInputTokens: 1,
          maxOutputTokens: 1,
          now: NOW,
        });
        expect(reserved.ok).toBe(true);
      }
    } finally {
      await second.close();
    }
    // 配置了抽取器也拿不到预算：工作 retry_wait（不预留不调用），不因预算重试复活提交。
    const { PersonaAppServiceImpl } = await import(
      "../../src/app/drora-persona/persona-app-service.js"
    );
    const service2 = new PersonaAppServiceImpl({
      dbPath: env.dbPath,
      learning: {
        extractor: controlledExtractor({
          drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
        }),
        sourceOwner: env.owner,
      },
      now: () => NOW,
    });
    try {
      expect(await service2.processLearningWork()).toBe("claimed");
      const list = await service2.listPreferences();
      if (!list.ok) return;
      expect(
        list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage),
      ).toBeUndefined();
    } finally {
      await service2.close();
    }
  });
});
