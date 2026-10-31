import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersonaEditableCore } from "@drora/shared";
import {
  openPersonaStore,
  type PersonaLearningSourceHandle,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";

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
 * P1b 策略级联与负例零写入（specs/drora-persona-system.md §5/§8；数据合同 §4.2/§6）：
 * U=false 同事务关 L＋撤租约＋清候选正文、L=false 撤租约清未提交工作、learningGeneration
 * 屏障；固定禁止学习负例在仓储边界的有效写入为 0（语义归因属抽取端口，见文件内说明）。
 */
describe("persona P1b 学习提交：U/L 策略级联（合同 §4.2）", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;
  let raw: DatabaseSync;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-policy-"));
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

  async function pendingWork(epoch: number, evidenceId: string, at = now): Promise<void> {
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId,
      sourceHandle: sourceHandle(evidenceId),
      policyEpoch: epoch,
      keyGenerations: {},
      now: at,
    });
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
  }

  it("U=false 同事务：L=false、learningGeneration+1、非终态工作终态化（rejected/policy_off）、候选清空", async () => {
    await initialize();
    const epoch = await enableLearning();
    await pendingWork(epoch, "ev-1");
    // 先制造一项待确认候选正文。
    const claim = await store.learning.claimLearningWork({
      leaseOwner: "worker",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    if (!claim.ok || claim.value.status !== "claimed") throw new Error("claimed");
    // 先写入 inferred 槽（ev-1 的候选），再造一个异值候选？
    // 简化：直接提交同批候选（applied），再制造 pending 候选后关 U。
    const applied = await store.learning.commitLearningWork({
      workId: claim.value.claim.workId,
      fence: claim.value.claim.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 2,
    });
    expect(applied).toMatchObject({ ok: true, value: { status: "applied" } });
    // 第二项工作进入待确认候选（disputed 路径）。
    const epoch2 = 1;
    const claim2 = await (async () => {
      const accepted = await store.learning.acceptLearningEvidence({
        evidenceId: "ev-2",
        sourceHandle: sourceHandle("ev-2"),
        policyEpoch: epoch2,
        keyGenerations: { replyLanguage: 0 },
        now: now + 3,
      });
      expect(accepted).toMatchObject({ ok: true });
      const claimed = await store.learning.claimLearningWork({
        leaseOwner: "worker",
        leaseDurationMs: 60_000,
        now: now + 4,
      });
      expect(claimed).toMatchObject({ ok: true, value: { status: "claimed" } });
      return claimed;
    })();
    await store.learning.commitLearningWork({
      workId: claim2.value!.claim.workId,
      fence: claim2.value!.claim.fence,
      candidates: [{ key: "replyLanguage", value: "en-US", evidenceRefs: [] }],
      now: now + 5,
    });
    expect(
      (raw.prepare("select count(*) as n from persona_learning_candidate").get() as { n: number }).n,
    ).toBe(1);
    // 再接收一项未领取的工作：U=false 级联的对象（撤租约/终态化非终态工作）。
    await pendingWork(epoch, "ev-3", now + 5);
    // 关闭 U（不显式传 autoLearn——patch 缺省也必须强制 L=false，合同 §4.2）。
    const off = await store.updatePolicy({
      mutationId: "policy-u-off",
      requestDigest: digest("policy", "u-off"),
      now: now + 6,
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved" } });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("initialized");
    expect(snapshot.policy).toMatchObject({
      usePreferences: false,
      autoLearn: false,
      learningGeneration: 1,
    });
    // 候选正文清空；非终态工作终态化（rejected/policy_off）；已 applied 的工作保留终态。
    expect(
      (raw.prepare("select count(*) as n from persona_learning_candidate").get() as { n: number }).n,
    ).toBe(0);
    const workRows = raw
      .prepare(
        "select state, fail_reason from persona_learning_work order by time_created",
      )
      .all() as Array<{ state: string; fail_reason: string }>;
    expect(workRows).toEqual([
      { state: "applied", fail_reason: null },
      { state: "applied", fail_reason: null },
      { state: "rejected", fail_reason: "policy_off" },
    ]);
  });

  it("重新开启 U 不恢复 L；L 单独关闭保留已存有效值供 U 读取", async () => {
    await initialize();
    const epoch = await enableLearning();
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: sourceHandle("ev-1"),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
    const claim = await store.learning.claimLearningWork({
      leaseOwner: "worker",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    if (!claim.ok || claim.value.status !== "claimed") throw new Error("claimed");
    await store.learning.commitLearningWork({
      workId: claim.value.claim.workId,
      fence: claim.value.claim.fence,
      candidates: [{ key: "replyLanguage", value: "zh-CN", evidenceRefs: [] }],
      now: now + 2,
    });
    // L 单独关闭：清未提交工作，但已存 inferred 值仍可被 U 读取。
    const lOff = await store.updatePolicy({
      mutationId: "policy-l-off",
      requestDigest: digest("policy", "l-off"),
      now: now + 3,
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: false,
    });
    expect(lOff).toMatchObject({ ok: true, value: { status: "saved" } });
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("initialized");
    expect(snapshot.policy).toMatchObject({ usePreferences: true, autoLearn: false });
    expect(snapshot.preferences).toEqual([
      expect.objectContaining({ key: "replyLanguage", value: "zh-CN", status: "active" }),
    ]);
    // 重新开启 U（L 保持关闭——不随 U 恢复）：inferred 值仍可读，学习仍关闭。
    const uOn = await store.updatePolicy({
      mutationId: "policy-u-on",
      requestDigest: digest("policy", "u-on"),
      now: now + 4,
      expectedPolicyRevision: 2,
      usePreferences: true,
    });
    expect(uOn).toMatchObject({ ok: true, value: { status: "unchanged" } });
    expect(
      (raw
        .prepare("select auto_learn, learning_generation from persona_policy")
        .get() as { auto_learn: number; learning_generation: number }),
    ).toEqual({ auto_learn: 0, learning_generation: 1 });
    // L=false→false unchanged 不再递增 learningGeneration；L true→false 才递增。
    const lOn = await store.updatePolicy({
      mutationId: "policy-l-on",
      requestDigest: digest("policy", "l-on"),
      now: now + 5,
      expectedPolicyRevision: 2,
      usePreferences: true,
      autoLearn: true,
    });
    expect(lOn).toMatchObject({ ok: true, value: { status: "saved" } });
    const lOffAgain = await store.updatePolicy({
      mutationId: "policy-l-off-2",
      requestDigest: digest("policy", "l-off-2"),
      now: now + 6,
      expectedPolicyRevision: 3,
      usePreferences: true,
      autoLearn: false,
    });
    expect(lOffAgain).toMatchObject({ ok: true, value: { status: "saved" } });
    expect(
      (raw
        .prepare("select learning_generation from persona_policy")
        .get() as { learning_generation: number }),
    ).toEqual({ learning_generation: 2 });
  });
});

describe("persona P1b 学习提交：负例有效写入为 0（固定禁止学习负例）", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;
  let raw: DatabaseSync;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-negative-"));
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

  /**
   * 合同 §8「固定禁止学习负例有效写入为 0」。六类语义负例（项目限定/临时要求/引用他人/
   * 假设否定/助手建议/裸「好」）的判别属于无文件工具的模型抽取端口（切片 F 后续层，
   * 用受控替身测试）；仓储层的合同是：没有通过全部屏障的候选就不存在任何写入。
   * 这里以「合规抽取端口对负例输入产出零候选」为前提，验证零候选提交的零写入闭环。
   */
  const NEGATIVE_EXTRACTATION_OUTPUTS: ReadonlyArray<{ name: string; candidates: [] }> = [
    { name: "项目限定（不晋升全局）", candidates: [] },
    { name: "临时要求（不晋升全局）", candidates: [] },
    { name: "引用他人", candidates: [] },
    { name: "假设/否定", candidates: [] },
    { name: "助手建议", candidates: [] },
    { name: "裸「好」（无具体值与全局范围）", candidates: [] },
  ];

  it("六类负例：抽取产出零候选 → 提交 no_change，偏好/候选/来源零写入", async () => {
    const init = await store.initializeAuthority({
      mutationId: "init-1",
      requestDigest: digest("init"),
      now,
      initialCore: defaultCore(),
      templateVersion: 1,
    });
    expect(init.ok).toBe(true);
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    handleAuthorityId = snapshot.authority.authorityId;
    const policy = await store.updatePolicy({
      mutationId: "policy-learn-on",
      requestDigest: digest("policy", "learn-on"),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
      autoLearn: true,
    });
    expect(policy).toMatchObject({ ok: true });
    const epoch = 1;
    for (const [index, negative] of NEGATIVE_EXTRACTATION_OUTPUTS.entries()) {
      const evidenceId = `neg-${index}`;
      const accepted = await store.learning.acceptLearningEvidence({
        evidenceId,
        sourceHandle: sourceHandle(evidenceId),
        policyEpoch: epoch,
        keyGenerations: {},
        now,
      });
      expect(accepted, negative.name).toMatchObject({ ok: true, value: { status: "accepted" } });
      const claimed = await store.learning.claimLearningWork({
        leaseOwner: "worker",
        leaseDurationMs: 60_000,
        now: now + 1,
      });
      expect(claimed, negative.name).toMatchObject({ ok: true, value: { status: "claimed" } });
      if (!claimed.ok || claimed.value.status !== "claimed") throw new Error("claimed");
      const commit = await store.learning.commitLearningWork({
        workId: claimed.value.claim.workId,
        fence: claimed.value.claim.fence,
        candidates: negative.candidates,
        now: now + 2,
      });
      expect(commit, negative.name).toMatchObject({
        ok: true,
        value: { status: "no_change", outcomes: [] },
      });
    }
    // 全程零写入：偏好槽、待确认候选、合并来源全部为空。
    expect(
      (raw.prepare("select count(*) as n from persona_preference").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (raw.prepare("select count(*) as n from persona_learning_candidate").get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (raw.prepare("select count(*) as n from persona_learning_source").get() as { n: number }).n,
    ).toBe(0);
    const workRows = raw
      .prepare("select state from persona_learning_work order by work_id")
      .all() as Array<{ state: string }>;
    expect(workRows).toHaveLength(NEGATIVE_EXTRACTATION_OUTPUTS.length);
    for (const row of workRows) expect(row.state).toBe("no_change");
  });
});
