import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERSONA_ERROR_CODES,
  PERSONA_POLICY_DEFAULTS,
  type PersonaEditableCore,
} from "@drora/shared";
import { openPersonaStore, type PersonaStorePort } from "../../src/storage/persona/index.js";

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

describe("persona P1a 策略/偏好/导出仓储", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-p1a-"));
    dbPath = join(root, "personas", "persona.sqlite");
    store = await openPersonaStore({ dbPath });
    now = 1_760_000_000_000;
  });

  afterEach(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  async function initialize(): Promise<void> {
    const result = await store.initializeAuthority({
      mutationId: "init-1",
      requestDigest: digest("init"),
      now,
      initialCore: defaultCore(),
      templateVersion: 1,
    });
    expect(result.ok).toBe(true);
  }

  it("未初始化时策略/偏好读侧返回默认与空列表；写路径报 uninitialized", async () => {
    await expect(store.readSnapshot()).resolves.toEqual({ state: "uninitialized" });
    await expect(store.listPreferences()).resolves.toEqual({ ok: true, value: [] });
    await expect(store.readExportSnapshot()).resolves.toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.uninitialized,
    });
    const policy = await store.updatePolicy({
      mutationId: "p1",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    expect(policy).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
  });

  it("策略 CAS：首次创建推进 revision+epoch，同值返回 unchanged 不推进，异 revision 冲突", async () => {
    await initialize();
    const on = await store.updatePolicy({
      mutationId: "policy-on",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    expect(on).toEqual({
      ok: true,
      value: { status: "saved", policyRevision: 1, policyEpoch: 1 },
    });
    const same = await store.updatePolicy({
      mutationId: "policy-same",
      requestDigest: digest("policy-on"),
      now: now + 1,
      expectedPolicyRevision: 1,
      usePreferences: true,
    });
    expect(same).toEqual({ ok: true, value: { status: "unchanged" } });
    const conflict = await store.updatePolicy({
      mutationId: "policy-conflict",
      requestDigest: digest("policy-off"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: false,
    });
    expect(conflict).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const off = await store.updatePolicy({
      mutationId: "policy-off",
      requestDigest: digest("policy-off"),
      now,
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    expect(off).toEqual({
      ok: true,
      value: { status: "saved", policyRevision: 2, policyEpoch: 2 },
    });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    expect(snapshot.policy).toEqual({ usePreferences: false, policyRevision: 2, policyEpoch: 2 });
  });

  it("策略同 ID 同摘要回放先前终态；同 ID 异摘要 mutation_conflict", async () => {
    await initialize();
    const first = await store.updatePolicy({
      mutationId: "policy-replay",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    expect(first).toMatchObject({ ok: true, value: { status: "saved" } });
    const replay = await store.updatePolicy({
      mutationId: "policy-replay",
      requestDigest: digest("policy-on"),
      now: now + 5_000,
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    expect(replay).toEqual({
      ok: true,
      value: { status: "saved", policyRevision: 1, policyEpoch: 1 },
    });
    const conflict = await store.updatePolicy({
      mutationId: "policy-replay",
      requestDigest: digest("different"),
      now,
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    expect(conflict).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.mutationConflict });
  });

  it("偏好保存：CAS 创建与更新推进 revision+generation；同值 unchanged；冲突拒绝", async () => {
    await initialize();
    const created = await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "replyLanguage", "zh-CN"),
      now,
      expectedRevision: 0,
      key: "replyLanguage",
      value: "zh-CN",
    });
    expect(created).toEqual({
      ok: true,
      value: { status: "saved", revision: 1, keyGeneration: 1 },
    });
    const updated = await store.savePreference({
      mutationId: "save-2",
      requestDigest: digest("save", "replyLanguage", "en-US"),
      now: now + 1,
      expectedRevision: 1,
      key: "replyLanguage",
      value: "en-US",
    });
    expect(updated).toEqual({
      ok: true,
      value: { status: "saved", revision: 2, keyGeneration: 2 },
    });
    const unchanged = await store.savePreference({
      mutationId: "save-3",
      requestDigest: digest("save", "replyLanguage", "en-US"),
      now: now + 2,
      expectedRevision: 2,
      key: "replyLanguage",
      value: "en-US",
    });
    expect(unchanged).toEqual({ ok: true, value: { status: "unchanged" } });
    const stale = await store.savePreference({
      mutationId: "save-4",
      requestDigest: digest("save", "replyLanguage", "follow_user"),
      now,
      expectedRevision: 1,
      key: "replyLanguage",
      value: "follow_user",
    });
    expect(stale).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const listed = await store.listPreferences();
    if (!listed.ok) throw new Error("expected ok");
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]).toMatchObject({
      key: "replyLanguage",
      value: "en-US",
      revision: 2,
      keyGeneration: 2,
      provenanceKind: "settings",
      epistemicStatus: "explicit",
      pinned: true,
    });
  });

  it("忘记是逻辑撤销屏障：清正文、generation++、autoSuppressed；对从未设置的键也建立槽", async () => {
    await initialize();
    await store.savePreference({
      mutationId: "save-addr",
      requestDigest: digest("save", "preferredAddress", "阿澈"),
      now,
      expectedRevision: 0,
      key: "preferredAddress",
      value: "阿澈",
    });
    const forgotten = await store.forgetPreference({
      mutationId: "forget-1",
      requestDigest: digest("forget", "preferredAddress"),
      now: now + 1,
      expectedRevision: 1,
      key: "preferredAddress",
    });
    // 结果携带新 revision：忘记并列于保存是解决路径，重设的 CAS 需要可观测预期值（合同 §4.2）。
    expect(forgotten).toEqual({
      ok: true,
      value: { status: "forgotten", revision: 2, keyGeneration: 2 },
    });
    const listed = await store.listPreferences();
    if (!listed.ok) throw new Error("expected ok");
    // 列表返回全部槽：forgotten 槽 value 已清、保留 revision 供重设。
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]).toMatchObject({
      key: "preferredAddress",
      value: "",
      revision: 2,
      keyGeneration: 2,
      status: "forgotten",
    });
    const raw = new DatabaseSync(dbPath);
    try {
      const row = raw
        .prepare("select value, status, auto_suppressed, key_generation from persona_preference where key = 'preferredAddress'")
        .get() as Record<string, unknown> | undefined;
      expect(row).toMatchObject({ value: null, status: "forgotten", auto_suppressed: 1, key_generation: 2 });
    } finally {
      raw.close();
    }
    // 从未设置的键：忘记仍建立屏障槽（合同 §4.2），expectedRevision=0。
    const fresh = await store.forgetPreference({
      mutationId: "forget-2",
      requestDigest: digest("forget", "collaborationStyle"),
      now,
      expectedRevision: 0,
      key: "collaborationStyle",
    });
    expect(fresh).toEqual({
      ok: true,
      value: { status: "forgotten", revision: 1, keyGeneration: 1 },
    });
    // 忘记后旧 revision 的保存被 CAS 拒绝，旧工作不能复活旧值（spec §9）。
    const stale = await store.savePreference({
      mutationId: "save-stale",
      requestDigest: digest("save", "preferredAddress", "阿澈"),
      now,
      expectedRevision: 1,
      key: "preferredAddress",
      value: "阿澈",
    });
    expect(stale).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    // 忘记后用 forget 返回的新 revision 重设成功（显式保存与忘记并列的解决路径，PM10/11）。
    const reset = await store.savePreference({
      mutationId: "save-reset",
      requestDigest: digest("save", "preferredAddress", "小澈"),
      now: now + 2,
      expectedRevision: 2,
      key: "preferredAddress",
      value: "小澈",
    });
    expect(reset).toEqual({
      ok: true,
      value: { status: "saved", revision: 3, keyGeneration: 3 },
    });
    const relisted = await store.listPreferences();
    if (!relisted.ok) throw new Error("expected ok");
    expect(relisted.value.find((slot) => slot.key === "preferredAddress")).toMatchObject({
      value: "小澈",
      revision: 3,
      keyGeneration: 3,
      status: "active",
    });
  });

  it("忘记同 ID 同摘要回放 forgotten 终态；同 ID 异摘要冲突", async () => {
    await initialize();
    const first = await store.forgetPreference({
      mutationId: "forget-replay",
      requestDigest: digest("forget", "replyLanguage"),
      now,
      expectedRevision: 0,
      key: "replyLanguage",
    });
    expect(first).toEqual({
      ok: true,
      value: { status: "forgotten", revision: 1, keyGeneration: 1 },
    });
    const replay = await store.forgetPreference({
      mutationId: "forget-replay",
      requestDigest: digest("forget", "replyLanguage"),
      now: now + 5_000,
      expectedRevision: 1,
      key: "replyLanguage",
    });
    expect(replay).toEqual({
      ok: true,
      value: { status: "forgotten", revision: 1, keyGeneration: 1 },
    });
    const conflict = await store.forgetPreference({
      mutationId: "forget-replay",
      requestDigest: digest("forget", "explanationDetail"),
      now,
      expectedRevision: 0,
      key: "explanationDetail",
    });
    expect(conflict).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.mutationConflict });
  });

  it("导出快照：单事务一致的 core/policy/有效偏好；不含 forgotten 槽", async () => {
    await initialize();
    await store.updatePolicy({
      mutationId: "policy-on",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "replyLanguage", "zh-CN"),
      now,
      expectedRevision: 0,
      key: "replyLanguage",
      value: "zh-CN",
    });
    await store.forgetPreference({
      mutationId: "forget-1",
      requestDigest: digest("forget", "collaborationStyle"),
      now,
      expectedRevision: 0,
      key: "collaborationStyle",
    });
    const snapshot = await store.readExportSnapshot();
    if (!snapshot.ok) throw new Error("expected ok");
    expect(snapshot.value.core.coreRevision).toBe(1);
    expect(snapshot.value.policy).toEqual({
      usePreferences: true,
      policyRevision: 1,
      policyEpoch: 1,
    });
    expect(snapshot.value.preferences.map((p) => p.key)).toEqual(["replyLanguage"]);
    expect(snapshot.value.counts).toEqual({ inferredOmittedUnverifiable: 0 });
  });

  it("capture 快照在一个短事务里携带 policy 与有效偏好（合同 §4.2 cutoff）", async () => {
    await initialize();
    await store.updatePolicy({
      mutationId: "policy-on",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "collaborationStyle", "step_by_step"),
      now,
      expectedRevision: 0,
      key: "collaborationStyle",
      value: "step_by_step",
    });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    expect(snapshot.policy.usePreferences).toBe(true);
    expect(snapshot.preferences).toHaveLength(1);
    expect(snapshot.preferences[0]).toMatchObject({ key: "collaborationStyle", value: "step_by_step" });
  });

  it("库内容与声明 schema 不符按损坏处理：forgotten 槽残留正文拒绝读取", async () => {
    await initialize();
    const raw = new DatabaseSync(dbPath);
    try {
      raw
        .prepare(
          "insert into persona_preference (key, value, revision, key_generation, provenance_kind, epistemic_status, status, pinned, auto_suppressed, time_updated) values ('replyLanguage', 'zh-CN', 1, 1, 'settings', 'explicit', 'forgotten', 0, 1, ?)",
        )
        .run(now);
    } finally {
      raw.close();
    }
    // 列表/快照读全部槽：残留正文按损坏处理（schema_incompatible 只停扩展）。
    await expect(store.listPreferences()).rejects.toMatchObject({
      code: PERSONA_ERROR_CODES.schemaIncompatible,
    });
    // U off 的快照不读偏好槽（零出库），不受该损坏影响。
    const snapshotOff = await store.readSnapshot();
    if (snapshotOff.state !== "initialized") throw new Error("expected initialized");
    expect(snapshotOff.preferences).toEqual([]);
    // 直接读该槽（忘记路径 CAS 会读）暴露同样损坏。
    await expect(
      store.forgetPreference({
        mutationId: "forget-2",
        requestDigest: digest("forget", "replyLanguage"),
        now,
        expectedRevision: 1,
        key: "replyLanguage",
      }),
    ).rejects.toMatchObject({ code: PERSONA_ERROR_CODES.schemaIncompatible });
  });

  it("U off 时偏好槽零出库：快照 preferences 为空数组（合同 §4.2 存储侧落实）", async () => {
    await initialize();
    await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "replyLanguage", "zh-CN"),
      now,
      expectedRevision: 0,
      key: "replyLanguage",
      value: "zh-CN",
    });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    expect(snapshot.policy).toEqual({ ...PERSONA_POLICY_DEFAULTS });
    expect(snapshot.preferences).toEqual([]);
    // U on 后同一事务读出（含 forgotten 屏障槽）。
    await store.updatePolicy({
      mutationId: "policy-on",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    const snapshotOn = await store.readSnapshot();
    if (snapshotOn.state !== "initialized") throw new Error("expected initialized");
    expect(snapshotOn.preferences.map((slot) => slot.key)).toEqual(["replyLanguage"]);
  });
});
