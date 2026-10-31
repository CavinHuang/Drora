/**
 * P1b 导出 inferred 来源复验（合同 §7「只含未忘记且有效的当前值；inferred 源不可验证则
 * 省略，显式值不因聊天删除消失」、时序「P->>S: 仅复验 inferred 来源」）：
 * - 来源可验证的 inferred 槽进入导出（学到的偏好不静默缺失）；
 * - 不可验证（源删除/owner 缺席）整键省略并计入 omittedCounts.inferredOmittedUnverifiable
 *   ——计数反映复验结果，不把「未尝试验证」计为「不可验证」；
 * - 显式（settings）槽不受复验影响。
 */
import { describe, expect, it } from "vitest";
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

describe("persona P1b 导出 inferred 来源复验", () => {
  it("来源可验证：inferred 槽进入导出，省略计数为 0", async () => {
    const env = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
    try {
      await seedInferredSlot(env);
      const exported = await env.service.preparePersonaExport();
      expect(exported).toMatchObject({ ok: true });
      if (!exported.ok) return;
      expect(exported.value.preferences).toEqual([
        {
          key: PERSONA_PREFERENCE_KEYS.replyLanguage,
          value: "zh-CN",
          revision: 1,
          provenanceKind: "extraction",
          epistemicStatus: "inferred",
        },
      ]);
      expect(exported.value.omittedCounts).toEqual({ inferredOmittedUnverifiable: 0 });
      // 复验发生了 owner 查询（合同 §7 时序「仅复验 inferred 来源」）。
      expect(env.owner.verifyCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await env.cleanup();
    }
  });

  it("来源不可验证（复验 missing）：inferred 槽省略并计数，显式槽不受影响", async () => {
    // verify 脚本：接收 verified → 工作提交前重验 verified → 导出复验 missing。
    const owner = controlledSourceOwner({
      verifications: ["verified", "verified", "missing"],
    });
    const env = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
      owner,
    });
    try {
      await seedInferredSlot(env);
      const explicit = await env.service.savePreference({
        expectedRevision: 0,
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        mutationId: "style-1",
        value: "direct_answer",
      });
      expect(explicit).toMatchObject({ ok: true });
      const exported = await env.service.preparePersonaExport();
      expect(exported).toMatchObject({ ok: true });
      if (!exported.ok) return;
      expect(exported.value.preferences.map((entry) => entry.key)).toEqual([
        PERSONA_PREFERENCE_KEYS.collaborationStyle,
      ]);
      expect(exported.value.omittedCounts).toEqual({ inferredOmittedUnverifiable: 1 });
    } finally {
      await env.cleanup();
    }
  });

  it("owner 缺席：inferred 槽省略并计数（不可验证＝省略），显式值不因复验缺席消失", async () => {
    const env = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
    try {
      await seedInferredSlot(env);
      const explicit = await env.service.savePreference({
        expectedRevision: 0,
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        mutationId: "style-1",
        value: "direct_answer",
      });
      expect(explicit).toMatchObject({ ok: true });
      // 无 owner 的第二实例读同一库：inferred 不可复验＝省略；显式值照常导出。
      const { PersonaAppServiceImpl } = await import(
        "../../src/app/drora-persona/persona-app-service.js"
      );
      const noOwner = new PersonaAppServiceImpl({ dbPath: env.dbPath, now: () => NOW });
      try {
        const exported = await noOwner.preparePersonaExport();
        expect(exported).toMatchObject({ ok: true });
        if (!exported.ok) return;
        expect(exported.value.preferences.map((entry) => entry.key)).toEqual([
          PERSONA_PREFERENCE_KEYS.collaborationStyle,
        ]);
        expect(exported.value.omittedCounts).toEqual({ inferredOmittedUnverifiable: 1 });
      } finally {
        await noOwner.close();
      }
    } finally {
      await env.cleanup();
    }
  });
});
