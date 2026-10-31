import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_ERROR_CODES, type PersonaEditableCore } from "@drora/shared";
import {
  openPersonaStore,
  type PersonaLearningSourceHandle,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
import { mergeSlotSource } from "../../src/storage/persona/persona-learning-rows.js";

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

let handleAuthorityId = "authority-1";

function sourceHandle(sessionId: string): PersonaLearningSourceHandle {
  return {
    authorityId: handleAuthorityId,
    workspaceKey: "D:/workspace/example",
    sessionId,
    productTurnId: `turn-${sessionId}`,
    origin: "local-desktop",
    sourceRevision: `source-rev-${sessionId}`,
    messageBoundary: "messages[3..4]",
    branchEvidence: `commit-boundary:${sessionId}`,
  };
}

/**
 * P1b 学习提交路径（specs/drora-persona-system.md §8；数据合同 §6「model 返回后重验
 * 源、epoch、keyGeneration、pinned、revision、fence，再单库提交」的存储级验证）。
 * 语义归因（项目限定/临时/引用/假设/助手建议/裸「好」的判别）属无文件工具的抽取端口；
 * 本文件在仓储边界钉住：只有挂在接受工作中的候选、通过全部屏障后才可能产生写入。
 */
describe("persona P1b 学习提交：inferred 写入与来源合并", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;
  let raw: DatabaseSync;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-commit-"));
    dbPath = join(root, "personas", "persona.sqlite");
    store = await openPersonaStore({ dbPath });
    now = 1_760_000_000_000;
    raw = new DatabaseSync(dbPath);
  });

  afterEach(async () => {
    raw.close();
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
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    handleAuthorityId = snapshot.authority.authorityId;
  }

  /** U+L 同事务开启（首次策略写 → policyEpoch=1）。 */
  async function enableLearning(): Promise<number> {
    const result = await store.updatePolicy({
      mutationId: "policy-learn-on",
      requestDigest: digest("policy", "learn-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
      autoLearn: true,
    });
    expect(result).toMatchObject({ ok: true, value: { status: "saved", policyEpoch: 1 } });
    return 1;
  }

  /** 接收＋领取一步到位，返回提交所需的 workId/fence。 */
  async function acceptAndClaim(
    evidenceId: string,
    epoch: number,
    keyGenerations: Record<string, number> = {},
  ): Promise<{ workId: string; fence: number }> {
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId,
      sourceHandle: sourceHandle(evidenceId),
      policyEpoch: epoch,
      keyGenerations,
      now,
    });
    if (!accepted.ok || accepted.value.status !== "accepted") throw new Error("accepted");
    const claimed = await store.learning.claimLearningWork({
      leaseOwner: "worker",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    if (!claimed.ok || claimed.value.status !== "claimed") throw new Error("claimed");
    if (claimed.value.claim.evidenceId !== evidenceId) throw new Error("unexpected claim order");
    return { workId: claimed.value.claim.workId, fence: claimed.value.claim.fence };
  }

  async function readSlot(key: string) {
    const listed = await store.listPreferences();
    if (!listed.ok) throw new Error("list failed");
    return listed.value.find((slot) => slot.key === key);
  }

  function sourceRows(key: string): Array<{ ordinal: number; evidence_id: string }> {
    return raw
      .prepare(
        "select ordinal, evidence_id from persona_learning_source where key = ? order by ordinal",
      )
      .all(key) as Array<{ ordinal: number; evidence_id: string }>;
  }

  it("无槽首写 inferred：extraction/inferred/unpinned、revision+1、generation 不变；工作 applied", async () => {
    await initialize();
    const epoch = await enableLearning();
    const { workId, fence } = await acceptAndClaim("ev-1", epoch);
    const commit = await store.learning.commitLearningWork({
      workId,
      fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: ["messages[3]:0..32"] }],
      now: now + 2,
    });
    expect(commit).toMatchObject({
      ok: true,
      value: {
        status: "applied",
        outcomes: [{ key: "replyLanguage", outcome: "slot_written" }],
      },
    });
    const slot = await readSlot("replyLanguage");
    expect(slot).toMatchObject({
      value: "zh-CN",
      revision: 1,
      keyGeneration: 0,
      provenanceKind: "extraction",
      epistemicStatus: "inferred",
      pinned: false,
      disputed: false,
      autoSuppressed: false,
      pendingCandidate: undefined,
      status: "active",
    });
  });

  it("同值合并有效来源（≤4，先到先保留）；同 evidence 幂等；异 evidence 不同值走 disputed", async () => {
    await initialize();
    const epoch = await enableLearning();
    // 首写。
    const first = await acceptAndClaim("ev-1", epoch);
    await store.learning.commitLearningWork({
      workId: first.workId,
      fence: first.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 2,
    });
    // 同值异源：并 source_merged（首写来源占 ordinal 0）。
    const second = await acceptAndClaim("ev-2", epoch);
    const merged = await store.learning.commitLearningWork({
      workId: second.workId,
      fence: second.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 3,
    });
    expect(merged).toMatchObject({
      value: { status: "applied", outcomes: [{ outcome: "source_merged" }] },
    });
    // 第三个同值来源继续并入。
    const third = await acceptAndClaim("ev-3", epoch);
    const mergedAgain = await store.learning.commitLearningWork({
      workId: third.workId,
      fence: third.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 4,
    });
    expect(mergedAgain).toMatchObject({
      value: { status: "applied", outcomes: [{ outcome: "source_merged" }] },
    });
    // 异值：disputed + 待确认候选（槽值不动、generation 不动）。
    const fourth = await acceptAndClaim("ev-4", epoch);
    const disputed = await store.learning.commitLearningWork({
      workId: fourth.workId,
      fence: fourth.fence,
      candidates: [{ key: "replyLanguage", value: "en-US", evidenceRefs: ["messages[5]:8..40"] }],
      now: now + 5,
    });
    expect(disputed).toMatchObject({
      value: { status: "applied", outcomes: [{ outcome: "candidate_pending" }] },
    });
    const slot = await readSlot("replyLanguage");
    expect(slot).toMatchObject({
      value: "zh-CN",
      revision: 1,
      keyGeneration: 0,
      disputed: true,
    });
    expect(slot?.pendingCandidate).toMatchObject({
      proposedValue: "en-US",
      evidenceId: "ev-4",
      expectedGeneration: 0,
    });
    // 待确认候选引用存 ≤4×≤512cp；被取代候选整行删除（每键最多一项）。
    const candidateRows = raw
      .prepare("select key, proposed_value, evidence_refs from persona_learning_candidate")
      .all() as Array<{ key: string; proposed_value: string; evidence_refs: string }>;
    expect(candidateRows).toEqual([
      { key: "replyLanguage", proposed_value: "en-US", evidence_refs: '["messages[5]:8..40"]' },
    ]);
    expect(sourceRows("replyLanguage")).toEqual([
      { ordinal: 0, evidence_id: "ev-1" },
      { ordinal: 1, evidence_id: "ev-2" },
      { ordinal: 2, evidence_id: "ev-3" },
    ]);
  });

  it("合并来源去重与上限（mergeSlotSource 直测：known/full 分支）", () => {
    // 同 (key, evidence) 重复合并不产生新行（known）；满 4 条后拒绝新增（full）。
    // 该分支在端口流里因「work 与 evidence 一一对应」而不可达，作为防御性行为直测。
    for (let index = 0; index < 4; index += 1) {
      expect(
        mergeSlotSource(raw, {
          key: "explanationDetail",
          evidenceId: `ev-${index}`,
          sourceSummary: "{}",
          now,
        }),
      ).toBe("merged");
    }
    expect(
      mergeSlotSource(raw, {
        key: "explanationDetail",
        evidenceId: "ev-0",
        sourceSummary: "{}",
        now,
      }),
    ).toBe("known");
    expect(
      mergeSlotSource(raw, {
        key: "explanationDetail",
        evidenceId: "ev-4",
        sourceSummary: "{}",
        now,
      }),
    ).toBe("full");
    expect(
      (raw
        .prepare("select count(*) as n from persona_learning_source where key = ?")
        .get("explanationDetail") as { n: number }).n,
    ).toBe(4);
  });

  it("来源合并到 4 条后不再新增（值已成立）；disputed 槽的同值来源不解除争议", async () => {
    await initialize();
    const epoch = await enableLearning();
    const first = await acceptAndClaim("ev-1", epoch);
    await store.learning.commitLearningWork({
      workId: first.workId,
      fence: first.fence,
      candidates: [{ key: "collaborationStyle", value: "direct_answer", evidenceRefs: [] }],
      now: now + 2,
    });
    for (const id of ["ev-2", "ev-3", "ev-4"]) {
      const claim = await acceptAndClaim(id, epoch);
      await store.learning.commitLearningWork({
        workId: claim.workId,
        fence: claim.fence,
        candidates: [{ key: "collaborationStyle", value: "direct_answer", evidenceRefs: [] }],
        now: now + 3,
      });
    }
    expect(sourceRows("collaborationStyle")).toHaveLength(4);
    // 第 5 个同值来源：到上限不再新增。
    const fifth = await acceptAndClaim("ev-5", epoch);
    const full = await store.learning.commitLearningWork({
      workId: fifth.workId,
      fence: fifth.fence,
      candidates: [{ key: "collaborationStyle", value: "direct_answer", evidenceRefs: [] }],
      now: now + 4,
    });
    expect(full).toMatchObject({
      value: { status: "no_change", outcomes: [{ outcome: "no_op_same_value" }] },
    });
    expect(sourceRows("collaborationStyle")).toHaveLength(4);
    // disputed 槽同值并源：争议未由用户解决前不消失。
    const dispute = await acceptAndClaim("ev-6", epoch);
    await store.learning.commitLearningWork({
      workId: dispute.workId,
      fence: dispute.fence,
      candidates: [{ key: "collaborationStyle", value: "step_by_step", evidenceRefs: [] }],
      now: now + 5,
    });
    const confirm = await acceptAndClaim("ev-7", epoch);
    await store.learning.commitLearningWork({
      workId: confirm.workId,
      fence: confirm.fence,
      candidates: [{ key: "collaborationStyle", value: "direct_answer", evidenceRefs: [] }],
      now: now + 6,
    });
    expect(await readSlot("collaborationStyle")).toMatchObject({
      value: "direct_answer",
      disputed: true,
    });
  });
});

describe("persona P1b 学习提交：屏障（pinned/generation/抑制/策略/结构）", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;
  let raw: DatabaseSync;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-commit-barrier-"));
    dbPath = join(root, "personas", "persona.sqlite");
    store = await openPersonaStore({ dbPath });
    now = 1_760_000_000_000;
    raw = new DatabaseSync(dbPath);
  });

  afterEach(async () => {
    raw.close();
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
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    handleAuthorityId = snapshot.authority.authorityId;
  }

  async function enableLearning(): Promise<number> {
    const result = await store.updatePolicy({
      mutationId: "policy-learn-on",
      requestDigest: digest("policy", "learn-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
      autoLearn: true,
    });
    expect(result).toMatchObject({ ok: true, value: { status: "saved", policyEpoch: 1 } });
    return 1;
  }

  async function acceptAndClaim(
    evidenceId: string,
    epoch: number,
    keyGenerations: Record<string, number> = {},
  ): Promise<{ workId: string; fence: number }> {
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId,
      sourceHandle: sourceHandle(evidenceId),
      policyEpoch: epoch,
      keyGenerations,
      now,
    });
    if (!accepted.ok || accepted.value.status !== "accepted") throw new Error("accepted");
    const claimed = await store.learning.claimLearningWork({
      leaseOwner: "worker",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    if (!claimed.ok || claimed.value.status !== "claimed") throw new Error("claimed");
    return { workId: claimed.value.claim.workId, fence: claimed.value.claim.fence };
  }

  it("pinned 不被自动覆盖：异值只进待确认建议（槽不动、不 disputed）；同值无事可写", async () => {
    await initialize();
    const epoch = await enableLearning();
    // 显式保存（settings/explicit/pinned）。
    const saved = await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "preferredAddress"),
      now,
      expectedRevision: 0,
      key: "preferredAddress",
      value: "老李",
    });
    expect(saved).toMatchObject({ ok: true, value: { status: "saved" } });
    const generation = 1;
    const claim = await acceptAndClaim("ev-1", epoch, { preferredAddress: generation });
    const commit = await store.learning.commitLearningWork({
      workId: claim.workId,
      fence: claim.fence,
      candidates: [{ key: "preferredAddress", value: "李工", evidenceRefs: [] }],
      now: now + 2,
    });
    expect(commit).toMatchObject({
      value: { status: "applied", outcomes: [{ outcome: "candidate_pending" }] },
    });
    const listed = await store.listPreferences();
    if (!listed.ok) throw new Error("list failed");
    const slot = listed.value.find((entry) => entry.key === "preferredAddress");
    expect(slot).toMatchObject({
      value: "老李",
      pinned: true,
      disputed: false,
      provenanceKind: "settings",
    });
    expect(slot?.pendingCandidate).toMatchObject({ proposedValue: "李工" });
    // 同值（与 pinned 槽一致）候选：无效果、不建候选。
    const claim2 = await acceptAndClaim("ev-2", epoch, { preferredAddress: generation });
    const noop = await store.learning.commitLearningWork({
      workId: claim2.workId,
      fence: claim2.fence,
      candidates: [{ key: "preferredAddress", value: "老李", evidenceRefs: [] }],
      now: now + 3,
    });
    expect(noop).toMatchObject({
      value: { status: "no_change", outcomes: [{ outcome: "no_op_same_value" }] },
    });
  });

  it("generation 屏障：接收后显式保存推进 generation → 提交丢弃该候选且不留正文", async () => {
    await initialize();
    const epoch = await enableLearning();
    // 槽已存在（settings/explicit/pinned、generation 1），工作接收时快照 generation=0。
    await store.savePreference({
      mutationId: "save-1",
      requestDigest: digest("save", "replyLanguage"),
      now,
      expectedRevision: 0,
      key: "replyLanguage",
      value: "zh-CN",
    });
    const claim = await acceptAndClaim("ev-1", epoch);
    // 接收后用户再次显式保存（generation 1→2；槽仍 active/pinned）。
    const resaved = await store.savePreference({
      mutationId: "save-2",
      requestDigest: digest("save", "replyLanguage", "en-US"),
      now: now + 2,
      expectedRevision: 1,
      key: "replyLanguage",
      value: "en-US",
    });
    expect(resaved).toMatchObject({ ok: true, value: { status: "saved", keyGeneration: 2 } });
    const commit = await store.learning.commitLearningWork({
      workId: claim.workId,
      fence: claim.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 3,
    });
    // 快照 generation 0 ≠ 当前 2：候选陈旧丢弃（generation 屏障先于 pinned 分支）。
    expect(commit).toMatchObject({
      value: { status: "no_change", outcomes: [{ outcome: "dropped_stale_generation" }] },
    });
    // 用户值未被覆盖，无候选正文残留。
    const listed = await store.listPreferences();
    if (!listed.ok) throw new Error("list failed");
    expect(listed.value.find((slot) => slot.key === "replyLanguage")).toMatchObject({
      status: "active",
      value: "en-US",
      pinned: true,
      pendingCandidate: undefined,
    });
    expect(
      (raw.prepare("select count(*) as n from persona_learning_candidate").get() as { n: number }).n,
    ).toBe(0);
  });

  it("抑制键不学习：忘记后的新机会提交被 dropped_suppressed；P1b 前显式保存不受影响", async () => {
    await initialize();
    const epoch = await enableLearning();
    // 忘记从未设置的键也建立屏障槽（generation 1、suppressed）。
    const forgotten = await store.forgetPreference({
      mutationId: "forget-1",
      requestDigest: digest("forget", "explanationDetail"),
      now,
      expectedRevision: 0,
      key: "explanationDetail",
    });
    expect(forgotten).toMatchObject({ ok: true, value: { keyGeneration: 1 } });
    const claim = await acceptAndClaim("ev-1", epoch, { explanationDetail: 1 });
    const commit = await store.learning.commitLearningWork({
      workId: claim.workId,
      fence: claim.fence,
      candidates: [{ key: "explanationDetail", value: "detailed", evidenceRefs: [] }],
      now: now + 2,
    });
    expect(commit).toMatchObject({
      value: { status: "no_change", outcomes: [{ outcome: "dropped_suppressed" }] },
    });
  });

  it("策略屏障：接收后 U/L 关闭 → 级联先终态化工作，在飞提交被拒且不可复活", async () => {
    await initialize();
    const epoch = await enableLearning();
    const claim = await acceptAndClaim("ev-1", epoch);
    // 接收后 L 关闭：同一事务内运行中的工作已被终态化（rejected/policy_off）。
    const off = await store.updatePolicy({
      mutationId: "policy-learn-off",
      requestDigest: digest("policy", "learn-off"),
      now: now + 2,
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: false,
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved", policyEpoch: 2 } });
    const commit = await store.learning.commitLearningWork({
      workId: claim.workId,
      fence: claim.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 3,
    });
    expect(commit).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const workRow = raw
      .prepare("select state, fail_reason from persona_learning_work where work_id = ?")
      .get(claim.workId) as { state: string; fail_reason: string };
    // 级联（撤租约终态化）先于在飞提交生效；提交屏障只对仍 running 的工作以
    // policy_barrier 兜底（epoch 推进路径，防直接 DB 时序差）。
    expect(workRow).toEqual({ state: "rejected", fail_reason: "policy_off" });
    // 重开后旧工作不可复活（已终态化）。
    const on = await store.updatePolicy({
      mutationId: "policy-learn-on-2",
      requestDigest: digest("policy", "learn-on-2"),
      now: now + 4,
      expectedPolicyRevision: 2,
      usePreferences: true,
      autoLearn: true,
    });
    expect(on).toMatchObject({ ok: true, value: { status: "saved" } });
    expect(
      await store.learning.commitLearningWork({
        workId: claim.workId,
        fence: claim.fence,
        candidates: [],
        now: now + 5,
      }),
    ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
  });

  it("候选结构非法逐条丢弃不留正文（未知键/空值/引用超限）；候选 >4 整单 validation_failed", async () => {
    await initialize();
    const epoch = await enableLearning();
    const claim = await acceptAndClaim("ev-1", epoch);
    const commit = await store.learning.commitLearningWork({
      workId: claim.workId,
      fence: claim.fence,
      candidates: [
        { key: "notAKey" as never, value: "x", evidenceRefs: [] },
        { key: "replyLanguage", value: "", evidenceRefs: [] },
        { key: "replyLanguage", value: "zh-CN", evidenceRefs: ["a", "b", "c", "d", "e"] },
        {
          key: "replyLanguage",
          value: "zh-CN",
          evidenceRefs: [[...Array(513)].map(() => "字").join("")],
        },
      ],
      now: now + 2,
    });
    expect(commit).toMatchObject({
      value: {
        status: "no_change",
        outcomes: [
          { outcome: "dropped_invalid" },
          { outcome: "dropped_invalid" },
          { outcome: "dropped_invalid" },
          { outcome: "dropped_invalid" },
        ],
      },
    });
    expect(
      (raw.prepare("select count(*) as n from persona_learning_candidate").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (raw.prepare("select count(*) as n from persona_preference").get() as { n: number }).n,
    ).toBe(0);
    const tooMany = await acceptAndClaim("ev-2", epoch);
    expect(
      await store.learning.commitLearningWork({
        workId: tooMany.workId,
        fence: tooMany.fence,
        candidates: [1, 2, 3, 4, 5].map((index) => ({
          key: "replyLanguage",
          value: `v-${index}`,
          evidenceRefs: [],
        })),
        now: now + 3,
      }),
    ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
  });
});


