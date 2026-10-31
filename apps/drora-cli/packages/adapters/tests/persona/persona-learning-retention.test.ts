/**
 * P1b 终态工作 7 天保留的领取路径清理（specs/drora-persona-system.md §8、合同 §6「终态
 * 保留最小 ID/原因最多 7 天」）：修复前仅接收路径（容量门）顺带清理，文件头声称的
 * 「领取路径顺带清理」无实现——安静系统不接收新证据时终态行无限滞留。本文件独立于
 * persona-learning-store.test.ts（该文件已到 max-file-lines 上限），只钉领取路径清理。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_ERROR_CODES, PERSONA_LEARNING_BUDGET } from "@drora/shared";
import { openPersonaStore, type PersonaStorePort } from "../../src/storage/persona/index.js";

describe("persona P1b 学习域仓储：领取路径终态保留清理", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-prune-"));
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
      requestDigest: JSON.stringify(["init"]),
      now,
      initialCore: {
        displayName: "Drora",
        selfDescription: "",
        warmth: "balanced",
        directness: "direct",
        humor: "light",
      },
      templateVersion: 1,
    });
    expect(result.ok).toBe(true);
  }

  async function enableLearning(): Promise<void> {
    const result = await store.updatePolicy({
      mutationId: "policy-learn-on",
      requestDigest: JSON.stringify(["policy", "learn-on"]),
      now,
      expectedPolicyRevision: 0,
      usePreferences: true,
      autoLearn: true,
    });
    expect(result).toMatchObject({ ok: true });
  }

  /** 与本库 authority 一致的接收句柄（authorityMismatch 门的前置）。 */
  async function sourceHandle(): Promise<{
    authorityId: string;
    workspaceKey: string;
    sessionId: string;
    productTurnId: string;
    origin: string;
    sourceRevision: string;
    messageBoundary: string;
    branchEvidence: string;
  }> {
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    return {
      authorityId: snapshot.authority.authorityId,
      workspaceKey: "D:/workspace/example",
      sessionId: "session-1",
      productTurnId: "turn-1",
      origin: "drora-cli-local-runtime",
      sourceRevision: "source-rev-1",
      messageBoundary: "messages[3..4]",
      branchEvidence: "commit-boundary:source-rev-1",
    };
  }

  it("U/L 关闭期间：接收（含幂等回放）与领取仍顺带清理 7 天窗口外终态行（清理先于策略门）", async () => {
    await initialize();
    await enableLearning();
    const handle = await sourceHandle();
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: handle,
      policyEpoch: 1,
      keyGenerations: {},
      now,
    });
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
    // 直插两行窗口外终态行与一行窗口内终态行（仅 id/reason 元数据形状）。
    const raw = new DatabaseSync(dbPath);
    try {
      const insert = raw.prepare(
        `insert into persona_learning_work
           (work_id, evidence_id, state, lease_owner, lease_expires_at, fence, attempts,
            policy_epoch, key_generations, fail_reason, time_created, time_updated)
         values (?, ?, 'no_change', null, null, 1, 1, ?, '{}', null, ?, ?)`,
      );
      const staleAt = now - PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs - 1;
      insert.run("w-stale-1", "ev-stale-1", 1, staleAt, staleAt);
      insert.run("w-stale-2", "ev-stale-2", 1, staleAt, staleAt);
      insert.run("w-fresh", "ev-fresh", 1, now, now);
    } finally {
      raw.close();
    }
    // 关 U（同事务级联关 L）：此后接收/领取都按 unsupported 拒绝。
    const off = await store.updatePolicy({
      mutationId: "policy-off",
      requestDigest: JSON.stringify(["policy", "learn-off"]),
      now,
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    expect(off).toMatchObject({ ok: true });
    // 领取：unsupported 但窗口外行被清理（修复前策略门先行，关闭态无任何清理点）。
    const claim = await store.learning.claimLearningWork({
      leaseOwner: "worker-a",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    expect(claim).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.unsupported });
    // 新接收：unsupported 但同样清理。
    const acceptRejected = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-2",
      sourceHandle: handle,
      policyEpoch: 1,
      keyGenerations: {},
      now: now + 2,
    });
    expect(acceptRejected).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.unsupported });
    // 幂等回放不受关闭影响（回放路径在清理点之后照常到达），且该次调用也完成了清理。
    const replay = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: handle,
      policyEpoch: 1,
      keyGenerations: {},
      now: now + 3,
    });
    expect(replay).toMatchObject({ ok: true, value: { status: "already_accepted" } });
    const after = new DatabaseSync(dbPath);
    try {
      const count = (workId: string): { n: number } | undefined =>
        after.prepare("select count(*) as n from persona_learning_work where work_id = ?").get(workId) as
          | { n: number }
          | undefined;
      expect(count("w-stale-1")).toEqual({ n: 0 });
      expect(count("w-stale-2")).toEqual({ n: 0 });
      expect(count("w-fresh")).toEqual({ n: 1 });
    } finally {
      after.close();
    }
  });

  it("工作行按 7 天保留清理后，回放旧 evidenceId 仍 already_accepted（不带 workId），不按库损坏拒绝", async () => {
    await initialize();
    await enableLearning();
    const handle = await sourceHandle();
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-old",
      sourceHandle: handle,
      policyEpoch: 1,
      keyGenerations: {},
      now,
    });
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
    // 把该工作终态化并推到保留窗口外：下次接收调用的 prune 会清掉 work 行；evidence
    // 行保留（来源定位/复验记录，readInferredSlotSources 联读依赖）。
    const raw = new DatabaseSync(dbPath);
    try {
      raw
        .prepare(
          "update persona_learning_work set state = 'no_change', time_updated = ? where evidence_id = 'ev-old'",
        )
        .run(now - PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs - 1);
    } finally {
      raw.close();
    }
    // 修复前：digest 匹配但 work 缺失走 failCorruptRow → schema_incompatible，且
    // evidence 永不清理导致该 evidenceId 后续回放持续失败（不自愈）。
    const replay = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-old",
      sourceHandle: handle,
      policyEpoch: 1,
      keyGenerations: {},
      now: now + 1,
    });
    // toEqual 全量断言：value 里不带 workId（工作行已不存在，如实省略）。
    expect(replay).toEqual({ ok: true, value: { status: "already_accepted" } });
    const after = new DatabaseSync(dbPath);
    try {
      expect(
        after.prepare("select count(*) as n from persona_learning_evidence where evidence_id = 'ev-old'").get(),
      ).toEqual({ n: 1 });
      expect(
        after.prepare("select count(*) as n from persona_learning_work where evidence_id = 'ev-old'").get(),
      ).toEqual({ n: 0 });
    } finally {
      after.close();
    }
  });

  it("领取路径顺带清理 7 天窗口外的终态行，窗口内终态行保留（合同 §6 终态保留上界）", async () => {
    await initialize();
    // U/L 需开启（领取前置）；epoch 直写终态行用。
    await enableLearning();
    const epoch = 1;
    const raw = new DatabaseSync(dbPath);
    try {
      const insert = raw.prepare(
        `insert into persona_learning_work
           (work_id, evidence_id, state, lease_owner, lease_expires_at, fence, attempts,
            policy_epoch, key_generations, fail_reason, time_created, time_updated)
         values (?, ?, 'no_change', null, null, 1, 1, ?, '{}', null, ?, ?)`,
      );
      const staleAt = now - PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs - 1;
      insert.run("w-stale", "ev-stale", epoch, staleAt, staleAt);
      insert.run("w-fresh", "ev-fresh", epoch, now, now);
    } finally {
      raw.close();
    }
    // 安静系统不接收新证据：只有领取路径触达工作表——领取返回 empty 也必须完成清理。
    const claimResult = await store.learning.claimLearningWork({
      leaseOwner: "worker-a",
      leaseDurationMs: 60_000,
      now: now + 1,
    });
    expect(claimResult).toMatchObject({ ok: true, value: { status: "empty" } });
    const after = new DatabaseSync(dbPath);
    try {
      expect(
        after.prepare("select count(*) as n from persona_learning_work where work_id = 'w-stale'").get(),
      ).toEqual({ n: 0 });
      expect(
        after.prepare("select count(*) as n from persona_learning_work where work_id = 'w-fresh'").get(),
      ).toEqual({ n: 1 });
    } finally {
      after.close();
    }
  });
});
