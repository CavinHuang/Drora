import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPersonaStore } from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  PERSONA_EXPORT_FORMAT,
  PERSONA_EXPORT_FORMAT_VERSION,
  PERSONA_EXPORT_LIMITATIONS,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_STORAGE_KEYS,
  PERSONA_TEMPLATE_VERSION,
  type PersonaEditableCore,
} from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";

const NOW = 1_700_000_000_000;

function defaultCore(): PersonaEditableCore {
  return {
    displayName: "Drora",
    selfDescription: "",
    warmth: "balanced",
    directness: "direct",
    humor: "light",
  };
}

function digest(...parts: Array<unknown>): string {
  return JSON.stringify(parts);
}

describe("PersonaAppService（P1a 策略/偏好/导出）", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-p1a-service-"));
    dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createService(): PersonaAppServiceImpl {
    return new PersonaAppServiceImpl({ dbPath, now: () => NOW });
  }

  async function initialize(service: PersonaAppServiceImpl): Promise<void> {
    const result = await service.initializePersona({ mutationId: "init-1" });
    expect(result.ok).toBe(true);
  }

  it("savePreference 校验：未知键/未知值/超界称呼拒绝，不落库", async () => {
    const service = createService();
    try {
      await initialize(service);
      const badKey = await service.savePreference({
        key: "mood" as typeof PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "happy",
        expectedRevision: 0,
        mutationId: "s1",
      });
      expect(badKey).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const badValue = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "fr-FR",
        expectedRevision: 0,
        mutationId: "s2",
      });
      expect(badValue).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const longAddress = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        value: "阿".repeat(41),
        expectedRevision: 0,
        mutationId: "s3",
      });
      expect(longAddress).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const controlAddress = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        value: "阿\u0000澈",
        expectedRevision: 0,
        mutationId: "s4",
      });
      expect(controlAddress).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      const listed = await service.listPreferences();
      expect(listed).toEqual({ ok: true, value: [] });
    } finally {
      await service.close();
    }
  });

  it("preferredAddress 保存前 NFC/trim 规范化；同值重存返回 unchanged", async () => {
    const service = createService();
    try {
      await initialize(service);
      const saved = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        value: "  Dro\u0301ra  ",
        expectedRevision: 0,
        mutationId: "addr-1",
      });
      expect(saved).toEqual({
        ok: true,
        value: { status: "saved", revision: 1, keyGeneration: 1 },
      });
      const listed = await service.listPreferences();
      if (!listed.ok) throw new Error("expected ok");
      expect(listed.value[0]?.value).toBe("Dr\u00f3ra");
      const same = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.preferredAddress,
        value: "  Dr\u00f3ra  ",
        expectedRevision: 1,
        mutationId: "addr-2",
      });
      expect(same).toEqual({ ok: true, value: { status: "unchanged" } });
    } finally {
      await service.close();
    }
  });

  it("CAS 冲突拒绝并保留他键；forget 屏障后旧 revision 不能复活旧值", async () => {
    const service = createService();
    try {
      await initialize(service);
      await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "rl-1",
      });
      // 过期 expectedRevision：确定性拒绝，不写 receipt（同 ID 重试同摘要会被拒绝路径清 ID）。
      const stale = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "en-US",
        expectedRevision: 0,
        mutationId: "rl-2",
      });
      expect(stale).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
      // 他键不受影响（每键一个槽、一个 revision）。
      const other = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        value: "step_by_step",
        expectedRevision: 0,
        mutationId: "cs-1",
      });
      expect(other).toMatchObject({ ok: true, value: { status: "saved" } });
      const forgotten = await service.forgetPreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        expectedRevision: 1,
        mutationId: "rl-forget",
      });
      // 第一层仓储（P1b 批次评审修复）让 forget 结果携带新 revision 供「忘记后重设」CAS
      // 观测；本期望随之对齐（shared PersonaForgetResult：status/revision/keyGeneration）。
      expect(forgotten).toEqual({
        ok: true,
        value: { status: "forgotten", keyGeneration: 2, revision: 2 },
      });
      const revive = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "zh-CN",
        expectedRevision: 1,
        mutationId: "rl-3",
      });
      expect(revive).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
      await expect(service.listPreferences()).resolves.toEqual({
        ok: true,
        value: expect.arrayContaining([
          expect.objectContaining({ key: PERSONA_PREFERENCE_KEYS.collaborationStyle }),
        ]),
      });
    } finally {
      await service.close();
    }
  });

  it("策略经服务切换；capture 的 U 门：off 只注入核心段，on 注入偏好段并带 epoch 观测", async () => {
    const service = createService();
    try {
      await initialize(service);
      // U off（默认）：核心贡献不含偏好段。
      const offCapture = await service.captureContribution({
        sessionId: "s",
        turnId: "t1",
        signal: new AbortController().signal,
      });
      if (offCapture.status !== "applied") throw new Error("expected applied");
      expect(offCapture.contribution.content).not.toContain("communication preferences");
      expect(offCapture.contribution.policyEpoch).toBeUndefined();
      await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "rl-1",
      });
      const policy = await service.setPersonalPolicy({
        expectedPolicyRevision: 0,
        usePreferences: true,
        mutationId: "u-on",
      });
      expect(policy).toEqual({
        ok: true,
        value: { status: "saved", policyRevision: 1, policyEpoch: 1 },
      });
      const onCapture = await service.captureContribution({
        sessionId: "s",
        turnId: "t2",
        signal: new AbortController().signal,
      });
      if (onCapture.status !== "applied") throw new Error("expected applied");
      expect(onCapture.contribution.content).toContain("communication preferences");
      expect(onCapture.contribution.content).toContain("zh-CN");
      expect(onCapture.contribution.policyEpoch).toBe(1);
      // 确定性：同快照同输出。
      const again = await service.captureContribution({
        sessionId: "s",
        turnId: "t3",
        signal: new AbortController().signal,
      });
      if (again.status !== "applied") throw new Error("expected applied");
      expect(again.contribution.content).toBe(onCapture.contribution.content);
      // U off 后新轮不再注入（已冻结轮不追溯改写；这是下一新轮的判定）。
      await service.setPersonalPolicy({
        expectedPolicyRevision: 1,
        usePreferences: false,
        mutationId: "u-off",
      });
      const after = await service.captureContribution({
        sessionId: "s",
        turnId: "t4",
        signal: new AbortController().signal,
      });
      if (after.status !== "applied") throw new Error("expected applied");
      expect(after.contribution.content).not.toContain("communication preferences");
      expect(after.contribution.policyEpoch).toBeUndefined();
    } finally {
      await service.close();
    }
  });

  it("导出：无资料 uninitialized 且不初始化；有资料时 envelope 完整且不含禁止字段", async () => {
    const service = createService();
    try {
      const missing = await service.preparePersonaExport();
      expect(missing).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
      const overview = await service.getPersonaOverview();
      // 导出不得暗建资料：导出被拒后仍是无资料状态（PM17）。
      expect(overview).toEqual({ ok: true, value: { state: "uninitialized" } });
      await initialize(service);
      await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.explanationDetail,
        value: "concise",
        expectedRevision: 0,
        mutationId: "ed-1",
      });
      const exported = await service.preparePersonaExport();
      if (!exported.ok) throw new Error("expected ok");
      expect(exported.value.format).toBe(PERSONA_EXPORT_FORMAT);
      expect(exported.value.formatVersion).toBe(PERSONA_EXPORT_FORMAT_VERSION);
      expect(exported.value.capturedAt).toBe(new Date(NOW).toISOString());
      expect(exported.value.coreRevision).toBe(1);
      expect(exported.value.templateVersion).toBe(PERSONA_TEMPLATE_VERSION);
      expect(exported.value.core).toEqual(defaultCore());
      expect(exported.value.preferences).toEqual([
        {
          key: PERSONA_PREFERENCE_KEYS.explanationDetail,
          value: "concise",
          revision: 1,
          provenanceKind: "settings",
          epistemicStatus: "explicit",
        },
      ]);
      expect(exported.value.omittedCounts).toEqual({ inferredOmittedUnverifiable: 0 });
      expect(exported.value.limitations).toEqual(PERSONA_EXPORT_LIMITATIONS);
      // 禁止字段不得出现在序列化产物（合同 §7）。
      const serialized = JSON.stringify(exported.value);
      expect(serialized).not.toContain("authorityId");
      expect(serialized).not.toContain("personaId");
      expect(serialized).not.toContain("pinned");
      expect(serialized).not.toContain("autoSuppressed");
      expect(serialized).not.toContain("keyGeneration");
    } finally {
      await service.close();
    }
  });

  it("PM52：恢复产品默认只动五字段，不删偏好、不改策略", async () => {
    const service = createService();
    try {
      await initialize(service);
      await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.replyLanguage,
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "rl-1",
      });
      await service.setPersonalPolicy({
        expectedPolicyRevision: 0,
        usePreferences: true,
        mutationId: "u-on",
      });
      const reset = await service.resetPersonaCore({
        expectedRevision: 1,
        mutationId: "reset-1",
      });
      expect(reset.ok).toBe(true);
      await expect(service.listPreferences()).resolves.toEqual({
        ok: true,
        value: [expect.objectContaining({ key: PERSONA_PREFERENCE_KEYS.replyLanguage })],
      });
      const capture = await service.captureContribution({
        sessionId: "s",
        turnId: "t1",
        signal: new AbortController().signal,
      });
      expect(capture.status).toBe("applied");
    } finally {
      await service.close();
    }
  });

  it("导出请求摘要与真实存储一致：service 与 store 分层正确（digest 稳定）", async () => {
    const service = createService();
    try {
      await initialize(service);
      // 同 ID 同摘要跨服务实例重放（重试场景）：新实例打开同一库，回放先前结果。
      const first = await service.savePreference({
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        value: "explain_tradeoffs",
        expectedRevision: 0,
        mutationId: "cs-replay",
      });
      expect(first).toMatchObject({ ok: true, value: { status: "saved" } });
      await service.close();
      const reopened = createService();
      try {
        // 超时重试复用同一请求内容（含 expectedRevision），同 ID 同摘要回放先前结果。
        const replay = await reopened.savePreference({
          key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
          value: "explain_tradeoffs",
          expectedRevision: 0,
          mutationId: "cs-replay",
        });
        expect(replay).toEqual({
          ok: true,
          value: { status: "saved", revision: 1, keyGeneration: 1 },
        });
      } finally {
        await reopened.close();
      }
    } finally {
      // 内层已 close；外层幂等。
      await service.close().catch(() => {});
    }
  });

  it("store 层 fixture 引用（保持与 adapters 契约一致）", async () => {
    // 直接以生产 openPersonaStore 打开（服务缺省工厂），确认两层默认装配一致。
    const store = await openPersonaStore({ dbPath });
    try {
      const result = await store.updatePolicy({
        mutationId: "p1",
        requestDigest: digest("policy"),
        now: NOW,
        expectedPolicyRevision: 0,
        usePreferences: false,
      });
      // 首次策略提交在未初始化时仍是 uninitialized（读侧允许、写侧拒绝）。
      expect(result).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
    } finally {
      await store.close();
    }
  });
});
