import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERSONA_ERROR_CODES,
  PERSONA_PREFERENCE_KEYS,
  type PersonaEditableCore,
} from "@drora/shared";
import { openPersonaStore, type PersonaStorePort } from "../../src/storage/persona/index.js";

/**
 * allowLearningForKey 仓储语义（合同 §3 allowLearningForKey、§4.2、§8；spec §9）：
 * - CAS 前置是该键当前 generation（槽缺席按 0），失效凭据不能绕过；
 * - 只解除抑制：status/value/disputed/pinned 原样，generation++、revision++；
 * - 「不恢复旧源/旧值」：已清正文不回来，合并来源不清；旧工作提交被 generation 屏障拒绝；
 * - 无抑制可解除（槽缺席/未抑制）返回 unchanged 不推进（合同 §2 unchanged 语义）；
 * - receipt 幂等：同 mutationId 同摘要回放，同摘要异 ID 各自独立。
 * 抑制由 forget 设置（autoSuppressed=1、status=forgotten、value 清空）；本文件先忘记再解除，
 * 复用同一 owner 的真实事务路径，不造行。
 */

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

describe("persona allowLearningForKey 仓储", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-allow-learning-"));
    dbPath = join(root, "personas", "persona.sqlite");
    store = await openPersonaStore({ dbPath });
    now = 1_760_000_000_000;
    const init = await store.initializeAuthority({
      mutationId: "init-1",
      requestDigest: digest("init"),
      now,
      initialCore: defaultCore(),
      templateVersion: 1,
    });
    expect(init.ok).toBe(true);
    // 先建立显式值再忘记：抑制槽 = forgotten + autoSuppressed + generation 屏障。
    const save = await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", PERSONA_PREFERENCE_KEYS.preferredAddress, "阿明"),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      value: "阿明",
      expectedRevision: 0,
    });
    expect(save).toMatchObject({ ok: true, value: { status: "saved", revision: 1, keyGeneration: 1 } });
    const forget = await store.forgetPreference({
      mutationId: "forget-1",
      requestDigest: digest("forget", PERSONA_PREFERENCE_KEYS.preferredAddress),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedRevision: 1,
    });
    expect(forget).toMatchObject({ ok: true, value: { status: "forgotten", revision: 2, keyGeneration: 2 } });
  });

  afterEach(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  it("解除抑制：generation++/revision++、autoSuppressed 清除；status=forgotten 与空 value 原样", async () => {
    const allowed = await store.allowLearningForKey({
      mutationId: "allow-1",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 2),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedGeneration: 2,
    });
    expect(allowed).toEqual({
      ok: true,
      value: { status: "saved", revision: 3, keyGeneration: 3 },
    });
    const slots = await store.listPreferences();
    expect(slots.ok).toBe(true);
    if (!slots.ok) return;
    const slot = slots.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.preferredAddress);
    expect(slot).toMatchObject({
      status: "forgotten",
      value: "",
      autoSuppressed: false,
      disputed: false,
      revision: 3,
      keyGeneration: 3,
    });
  });

  it("CAS：expectedGeneration 与当前不符拒绝（revision_conflict），不写凭据", async () => {
    const conflict = await store.allowLearningForKey({
      mutationId: "allow-stale",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 1),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedGeneration: 1,
    });
    expect(conflict).toEqual({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const slots = await store.listPreferences();
    if (!slots.ok) return;
    const slot = slots.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.preferredAddress);
    expect(slot).toMatchObject({ autoSuppressed: true, revision: 2, keyGeneration: 2 });
  });

  it("未抑制/槽缺席返回 unchanged 不推进；从未设置键也如此", async () => {
    const unsuppressed = await store.savePreference({
      mutationId: "save-2",
      requestDigest: digest("save", PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN"),
      now,
      key: PERSONA_PREFERENCE_KEYS.replyLanguage,
      value: "zh-CN",
      expectedRevision: 0,
    });
    expect(unsuppressed).toMatchObject({ ok: true, value: { status: "saved" } });
    const unchangedActive = await store.allowLearningForKey({
      mutationId: "allow-active",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.replyLanguage, 1),
      now,
      key: PERSONA_PREFERENCE_KEYS.replyLanguage,
      expectedGeneration: 1,
    });
    expect(unchangedActive).toEqual({ ok: true, value: { status: "unchanged" } });
    const unchangedAbsent = await store.allowLearningForKey({
      mutationId: "allow-absent",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.collaborationStyle, 0),
      now,
      key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
      expectedGeneration: 0,
    });
    expect(unchangedAbsent).toEqual({ ok: true, value: { status: "unchanged" } });
    const slots = await store.listPreferences();
    if (!slots.ok) return;
    const active = slots.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.replyLanguage);
    expect(active).toMatchObject({ revision: 1, keyGeneration: 1, autoSuppressed: false });
  });

  it("receipt 幂等：同 mutationId 同摘要回放 saved；异摘要 mutation_conflict；unchanged 同样回放", async () => {
    const replayed = await store.allowLearningForKey({
      mutationId: "allow-1",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 2),
      now: now + 5,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedGeneration: 2,
    });
    expect(replayed).toEqual({
      ok: true,
      value: { status: "saved", revision: 3, keyGeneration: 3 },
    });
    const slots = await store.listPreferences();
    if (!slots.ok) return;
    const slot = slots.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.preferredAddress);
    // 回放不重复推进：仍是第一次的 revision/generation。
    expect(slot).toMatchObject({ revision: 3, keyGeneration: 3 });

    const sameIdDifferentDigest = await store.allowLearningForKey({
      mutationId: "allow-1",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 9),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedGeneration: 3,
    });
    expect(sameIdDifferentDigest).toEqual({
      ok: false,
      code: PERSONA_ERROR_CODES.mutationConflict,
    });

    const unchanged = await store.allowLearningForKey({
      mutationId: "allow-absent",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.collaborationStyle, 0),
      now,
      key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
      expectedGeneration: 0,
    });
    expect(unchanged).toEqual({ ok: true, value: { status: "unchanged" } });
    const replayedUnchanged = await store.allowLearningForKey({
      mutationId: "allow-absent",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.collaborationStyle, 0),
      now: now + 5,
      key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
      expectedGeneration: 0,
    });
    expect(replayedUnchanged).toEqual({ ok: true, value: { status: "unchanged" } });
  });

  it("解除后该键重新开放自动学习首写；旧 generation 快照的工作被屏障拒绝（同库屏障复核）", async () => {
    // 学习接收的存储侧前置：U && L 必须开启（acceptLearningEvidence unsupported 否）。
    const policyOn = await store.updatePolicy({
      mutationId: "policy-on",
      requestDigest: digest("policy-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
      autoLearn: true,
    });
    expect(policyOn).toMatchObject({ ok: true, value: { status: "saved" } });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") return;
    const authorityId = snapshot.authority.authorityId;

    const allowed = await store.allowLearningForKey({
      mutationId: "allow-1",
      requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 2),
      now,
      key: PERSONA_PREFERENCE_KEYS.preferredAddress,
      expectedGeneration: 2,
    });
    expect(allowed).toMatchObject({ ok: true, value: { status: "saved", keyGeneration: 3 } });

    // 旧快照（接收时 generation=2）的候选提交：generation 屏障拒绝（dropped_stale_generation）。
    const evidenceOld = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-old",
      sourceHandle: {
        authorityId,
        workspaceKey: "/ws",
        sessionId: "sess-1",
        productTurnId: "turn-1",
        origin: "drora-cli-local-runtime",
        sourceRevision: "rev-1",
        messageBoundary: "{}",
        branchEvidence: "branch-1",
      },
      policyEpoch: 1,
      keyGenerations: { [PERSONA_PREFERENCE_KEYS.preferredAddress]: 2 },
      now,
    });
    expect(evidenceOld).toMatchObject({ ok: true });
    const claimOld = await store.learning.claimLearningWork({
      leaseOwner: "worker-a",
      leaseDurationMs: 60_000,
      now,
    });
    expect(claimOld).toMatchObject({ ok: true, value: { status: "claimed" } });
    if (!claimOld.ok || claimOld.value.status !== "claimed") return;
    const commitOld = await store.learning.commitLearningWork({
      workId: claimOld.value.claim.workId,
      fence: claimOld.value.claim.fence,
      candidates: [
        {
          key: PERSONA_PREFERENCE_KEYS.preferredAddress,
          value: "老王",
          evidenceRefs: ["0:0:2:老王"],
        },
      ],
      now,
    });
    // 提交本身成功（工作终态 no_change——全部候选被屏障逐条丢弃，槽不写）。
    expect(commitOld).toMatchObject({ ok: true, value: { status: "no_change" } });
    if (!commitOld.ok) return;
    expect(commitOld.value.outcomes).toEqual([
      { key: PERSONA_PREFERENCE_KEYS.preferredAddress, outcome: "dropped_stale_generation" },
    ]);

    // 新机会（新快照 generation=3）可以首写 inferred 值（槽保持 forgotten → 首写转 active）。
    const evidenceNew = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-new",
      sourceHandle: {
        authorityId,
        workspaceKey: "/ws",
        sessionId: "sess-2",
        productTurnId: "turn-2",
        origin: "drora-cli-local-runtime",
        sourceRevision: "rev-2",
        messageBoundary: "{}",
        branchEvidence: "branch-2",
      },
      policyEpoch: 1,
      keyGenerations: { [PERSONA_PREFERENCE_KEYS.preferredAddress]: 3 },
      now: now + 1,
    });
    expect(evidenceNew).toMatchObject({ ok: true });
    const claimNew = await store.learning.claimLearningWork({
      leaseOwner: "worker-a",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    if (!claimNew.ok || claimNew.value.status !== "claimed") return;
    const commitNew = await store.learning.commitLearningWork({
      workId: claimNew.value.claim.workId,
      fence: claimNew.value.claim.fence,
      candidates: [
        {
          key: PERSONA_PREFERENCE_KEYS.preferredAddress,
          value: "小张",
          evidenceRefs: ["1:0:2:小张"],
        },
      ],
      now: now + 1,
    });
    expect(commitNew).toMatchObject({
      ok: true,
      value: { status: "applied", outcomes: [{ outcome: "slot_written" }] },
    });
    const slots = await store.listPreferences();
    if (!slots.ok) return;
    const slot = slots.value.find((entry) => entry.key === PERSONA_PREFERENCE_KEYS.preferredAddress);
    // 新值写入：inferred/active；旧值「老王」与旧来源不复活。
    expect(slot).toMatchObject({
      status: "active",
      value: "小张",
      provenanceKind: "extraction",
      epistemicStatus: "inferred",
      autoSuppressed: false,
    });
  });

  it("未初始化：写路径报 uninitialized", async () => {
    const freshRoot = await mkdtemp(join(tmpdir(), "drora-persona-allow-fresh-"));
    try {
      const fresh = await openPersonaStore({
        dbPath: join(freshRoot, "personas", "persona.sqlite"),
      });
      try {
        const result = await fresh.allowLearningForKey({
          mutationId: "allow-x",
          requestDigest: digest("allow", PERSONA_PREFERENCE_KEYS.preferredAddress, 0),
          now,
          key: PERSONA_PREFERENCE_KEYS.preferredAddress,
          expectedGeneration: 0,
        });
        expect(result).toEqual({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
      } finally {
        await fresh.close();
      }
    } finally {
      await rm(freshRoot, { recursive: true, force: true });
    }
  });
});
