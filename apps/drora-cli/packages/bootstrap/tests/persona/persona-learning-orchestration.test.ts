/**
 * P1b 学习编排 happy path（合同 §6 工作状态机）：接收 → 领取（租约+fencing）→ 预算预留 →
 * 受控抽取 → 候选严格校验 → 源重验 → 单库提交（epoch/generation/pinned/revision/fence 由
 * 库屏障复核）→ applied；同值并源、异值 disputed＋待确认候选、pinned 不被覆盖。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";
import {
  acceptanceRequest,
  controlledExtractor,
  createLearningReadyService,
  draft,
  NOW,
  type LearningReadyService,
} from "./persona-learning-test-support.js";

const SECOND_BOUNDARY = { boundaryMessageId: "msg-a2", userMessageId: "msg-u2" } as const;

describe("persona P1b 学习编排（受控抽取替身）", () => {
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

  it("happy path：候选写入 inferred 槽（extraction/inferred/unpinned），贡献含该值", async () => {
    const accepted = await env.service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    expect(await env.service.processLearningWork()).toBe("claimed");
    expect(await env.service.processLearningWork()).toBe("idle");
    const list = await env.service.listPreferences();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const slot = list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage);
    expect(slot).toMatchObject({
      epistemicStatus: "inferred",
      pinned: false,
      provenanceKind: "extraction",
      status: "active",
      value: "zh-CN",
    });
    const capture = await env.service.captureContribution({
      sessionId: "any",
      signal: new AbortController().signal,
      turnId: "t",
    });
    expect(capture.status).toBe("applied");
    if (capture.status !== "applied") return;
    expect(capture.contribution.content).toContain('"zh-CN"');
    expect(capture.contribution.policyEpoch).toBe(1);
  });

  it("同值不同源：合并来源，槽 revision 不推进（值不变）", async () => {
    const accepted = await env.service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    expect(await env.service.processLearningWork()).toBe("claimed");
    const before = await env.service.listPreferences();
    if (!before.ok) return;
    const revisionBefore = before.value.find(
      (entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage,
    )?.revision;
    // 第二轮（异 turnId/异边界＝异 evidenceId）抽取同值。
    const accepted2 = await env.service.acceptLearningSource(
      acceptanceRequest({ boundary: SECOND_BOUNDARY, turnId: "turn-2" }),
    );
    expect(accepted2).toMatchObject({ kind: "accepted" });
    expect(await env.service.processLearningWork()).toBe("claimed");
    const after = await env.service.listPreferences();
    if (!after.ok) return;
    const slot = after.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage);
    expect(slot?.revision).toBe(revisionBefore);
    expect(slot?.value).toBe("zh-CN");
  });

  it("同库两轮异值：第二轮 disputed，capture 停止注入该键", async () => {
    const accepted = await env.service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    expect(await env.service.processLearningWork()).toBe("claimed");
    // 第二轮：同库第二服务实例注入异值抽取器（dbPath 共享库面）。
    const extractor2 = controlledExtractor({
      drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "en-US")],
    });
    const secondService = new PersonaAppServiceImpl({
      dbPath: env.dbPath,
      learning: { extractor: extractor2, sourceOwner: env.owner },
      now: () => NOW,
    });
    try {
      const accepted2 = await secondService.acceptLearningSource(
        acceptanceRequest({ boundary: SECOND_BOUNDARY, turnId: "turn-2" }),
      );
      expect(accepted2).toMatchObject({ kind: "accepted" });
      expect(await secondService.processLearningWork()).toBe("claimed");
      const list = await secondService.listPreferences();
      if (!list.ok) return;
      const slot = list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage);
      expect(slot?.disputed).toBe(true);
      expect(slot?.value).toBe("zh-CN");
      // capture：disputed 槽下一轮停止注入；贡献退化为纯核心段（无偏好 JSON）。
      const capture = await secondService.captureContribution({
        sessionId: "any",
        signal: new AbortController().signal,
        turnId: "t",
      });
      expect(capture.status).toBe("applied");
      if (capture.status !== "applied") return;
      expect(capture.contribution.content).not.toContain('"zh-CN"');
    } finally {
      await secondService.close();
    }
  });

  it("pinned 不被自动覆盖：异值只进待确认候选，槽保持显式值", async () => {
    const saved = await env.service.savePreference({
      expectedRevision: 0,
      key: PERSONA_PREFERENCE_KEYS.replyLanguage,
      mutationId: "pref-1",
      value: "zh-CN",
    });
    expect(saved).toMatchObject({ ok: true });
    // 抽取器输出异值 en-US；generation 快照在接收时读取（显式保存后 generation=1，匹配）。
    const pinnedService = new PersonaAppServiceImpl({
      dbPath: env.dbPath,
      learning: {
        extractor: controlledExtractor({
          drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "en-US")],
        }),
        sourceOwner: env.owner,
      },
      now: () => NOW,
    });
    try {
      const accepted = await pinnedService.acceptLearningSource(acceptanceRequest());
      expect(accepted).toMatchObject({ kind: "accepted" });
      expect(await pinnedService.processLearningWork()).toBe("claimed");
      const list = await pinnedService.listPreferences();
      if (!list.ok) return;
      const slot = list.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage);
      expect(slot).toMatchObject({ pinned: true, value: "zh-CN" });
      expect(slot?.pendingCandidate).toMatchObject({ proposedValue: "en-US" });
    } finally {
      await pinnedService.close();
    }
  });
});
