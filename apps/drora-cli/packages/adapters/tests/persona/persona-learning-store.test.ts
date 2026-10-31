import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERSONA_ERROR_CODES,
  PERSONA_LEARNING_BUDGET,
  type PersonaEditableCore,
} from "@drora/shared";
import { ensureSqliteSchemaMigrationTable, sqliteMigrations } from "@drora/shared/sqlite-migrations";
import {
  openPersonaStore,
  type PersonaLearningSourceHandle,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
import { PERSONA_MIGRATIONS } from "../../src/storage/persona/migrations.js";

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

function sourceHandle(overrides?: Partial<PersonaLearningSourceHandle>): PersonaLearningSourceHandle {
  return {
    authorityId: handleAuthorityId,
    workspaceKey: "D:/workspace/example",
    sessionId: "session-1",
    productTurnId: "turn-1",
    origin: "local-desktop",
    sourceRevision: "source-rev-1",
    messageBoundary: "messages[3..4]",
    branchEvidence: "commit-boundary:source-rev-1",
    ...overrides,
  };
}

/**
 * P1b 学习域仓储（证据接收/工作队列/预算台账）——specs/drora-persona-system.md §8、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §6 逐条语义的存储级验证。
 * 语义分类（负例归因等）属抽取端口/服务层；本文件只钉仓储屏障。
 */
describe("persona P1b 学习域仓储：接收幂等与上限", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-"));
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
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    handleAuthorityId = snapshot.authority.authorityId;
  }

  /** U 与 L 同事务开启（首次策略写 → policyEpoch=1）；返回当前 epoch 供接收快照。 */
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

  async function accept(evidenceId: string, epoch: number, at = now) {
    return store.learning.acceptLearningEvidence({
      evidenceId,
      sourceHandle: sourceHandle(),
      policyEpoch: epoch,
      keyGenerations: {},
      now: at,
    });
  }

  it("接收创建 evidence+accepted 工作；同 ID 同内容 already_accepted 回放同一 workId", async () => {
    await initialize();
    const epoch = await enableLearning();
    const first = await accept("ev-1", epoch);
    expect(first).toMatchObject({ ok: true, value: { status: "accepted" } });
    if (!first.ok || first.value.status !== "accepted") throw new Error("expected accepted");
    const replay = await accept("ev-1", epoch, now + 1_000);
    expect(replay).toEqual({
      ok: true,
      value: { status: "already_accepted", workId: first.value.workId },
    });
    const raw = new DatabaseSync(dbPath);
    try {
      expect(
        raw.prepare("select count(*) as n from persona_learning_evidence").get(),
      ).toEqual({ n: 1 });
      expect(
        raw
          .prepare(
            "select state, fence, attempts, policy_epoch from persona_learning_work",
          )
          .get(),
      ).toEqual({ state: "accepted", fence: 0, attempts: 0, policy_epoch: epoch });
    } finally {
      raw.close();
    }
  });

  it("同 ID 异内容拒绝（mutation_conflict），不产生新工作", async () => {
    await initialize();
    const epoch = await enableLearning();
    const first = await accept("ev-1", epoch);
    expect(first).toMatchObject({ ok: true });
    const conflict = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: sourceHandle({ productTurnId: "turn-2" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    expect(conflict).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.mutationConflict });
    // 异 authority 的输入不迁入本地个人域（合同 §6）：先于幂等回放拒绝。
    const foreign = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-foreign",
      sourceHandle: sourceHandle({ authorityId: "00000000-0000-4000-8000-00000000000f" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    expect(foreign).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.authorityMismatch });
    const raw = new DatabaseSync(dbPath);
    try {
      expect(raw.prepare("select count(*) as n from persona_learning_work").get()).toEqual({
        n: 1,
      });
    } finally {
      raw.close();
    }
  });

  it("U/L 任一关闭拒绝新接收（unsupported）；幂等回放不受策略影响", async () => {
    await initialize();
    // 默认策略（行缺席＝U=false/L=false）拒绝新接收。
    expect(await accept("ev-0", 0)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.unsupported,
    });
    const epoch = await enableLearning();
    const accepted = await accept("ev-1", epoch);
    expect(accepted).toMatchObject({ ok: true });
    // 关闭 L 后：新接收拒绝；同 ID 回放仍返回 already_accepted（幂等与策略无关）。
    const off = await store.updatePolicy({
      mutationId: "policy-learn-off",
      requestDigest: digest("policy", "learn-off"),
      now,
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: false,
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved" } });
    expect(await accept("ev-2", 2)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.unsupported,
    });
    expect(await accept("ev-1", epoch, now + 1)).toMatchObject({
      ok: true,
      value: { status: "already_accepted" },
    });
  });

  it("未初始化拒绝接收；非法 sourceHandle/keyGenerations 按 validation_failed 拒绝", async () => {
    expect(await accept("ev-x", 0)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.uninitialized,
    });
    await initialize();
    const epoch = await enableLearning();
    const missingField = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-bad",
      sourceHandle: sourceHandle({ origin: "" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    expect(missingField).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.validationFailed,
    });
    const missingTurn = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-bad",
      sourceHandle: sourceHandle({ productTurnId: undefined, sourceCommandId: undefined }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    expect(missingTurn).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.validationFailed,
    });
    const unknownKey = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-bad",
      sourceHandle: sourceHandle(),
      policyEpoch: epoch,
      keyGenerations: { notAKey: 1 },
      now,
    });
    expect(unknownKey).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.validationFailed,
    });
  });

  it("非终态工作满 128 拒绝接收（storage_capacity）且不留半行；终态 7 天清理后恢复接收", async () => {
    await initialize();
    const epoch = await enableLearning();
    const raw = new DatabaseSync(dbPath);
    try {
      const insert = raw.prepare(
        `insert into persona_learning_work
           (work_id, evidence_id, state, lease_owner, lease_expires_at, fence, attempts,
            policy_epoch, key_generations, fail_reason, time_created, time_updated)
         values (?, ?, 'accepted', null, null, 0, 0, ?, '{}', null, ?, ?)`,
      );
      for (let index = 0; index < PERSONA_LEARNING_BUDGET.nonTerminalWorksMaxPerAuthority; index += 1) {
        insert.run(`w-${index}`, `ev-${index}`, epoch, now, now);
      }
    } finally {
      raw.close();
    }
    const rejected = await accept("ev-new", epoch);
    expect(rejected).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.storageCapacity });
    const afterReject = new DatabaseSync(dbPath);
    try {
      // 单事务回滚：evidence 行不留半行（合同 §6「满时拒绝接收」）。
      expect(
        afterReject
          .prepare("select count(*) as n from persona_learning_evidence where evidence_id = 'ev-new'")
          .get(),
      ).toEqual({ n: 0 });
      // 终态化并把时间推到 7 天窗口外后，容量路径清理，恢复接收。
      afterReject
        .prepare(
          "update persona_learning_work set state = 'no_change', time_updated = ?",
        )
        .run(now - PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs - 1);
    } finally {
      afterReject.close();
    }
    const recovered = await accept("ev-new", epoch);
    expect(recovered).toMatchObject({ ok: true, value: { status: "accepted" } });
  });
});

describe("persona P1b 学习域仓储：领取/租约/fencing/状态机", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-queue-"));
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
    expect(result).toMatchObject({ ok: true });
    return 1;
  }

  async function acceptTwo(epoch: number): Promise<[string, string]> {
    const first = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: sourceHandle({ sessionId: "session-1" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    const second = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-2",
      sourceHandle: sourceHandle({ sessionId: "session-1" }),
      policyEpoch: epoch,
      keyGenerations: { replyLanguage: 0 },
      now: now + 1,
    });
    if (!first.ok || !second.ok) throw new Error("expected accepted");
    if (first.value.status !== "accepted" || second.value.status !== "accepted") {
      throw new Error("expected fresh accepted");
    }
    return [first.value.workId, second.value.workId];
  }

  async function claim(at: number, owner = "worker-a") {
    return store.learning.claimLearningWork({
      leaseOwner: owner,
      leaseDurationMs: 60_000,
      now: at,
    });
  }

  it("FIFO 领取：按接收序领取，fence/attempts 从 1 递增，携带源 handle 与屏障快照", async () => {
    await initialize();
    const epoch = await enableLearning();
    await acceptTwo(epoch);
    const claimResult = await claim(now + 2);
    expect(claimResult).toMatchObject({ ok: true, value: { status: "claimed" } });
    if (!claimResult.ok || claimResult.value.status !== "claimed") throw new Error("claimed");
    const claimed = claimResult.value.claim;
    expect(claimed.fence).toBe(1);
    expect(claimed.attempts).toBe(1);
    expect(claimed.policyEpoch).toBe(epoch);
    expect(claimed.keyGenerations).toEqual({});
    expect(claimed.sourceHandle.sessionId).toBe("session-1");
    expect(claimed.leaseExpiresAt).toBe(now + 2 + 60_000);
    expect(claimed.workId.length).toBeGreaterThan(0);
  });

  it("存活租约互斥（每 authority 并发 1）；U/L 关闭时领取拒绝", async () => {
    await initialize();
    const epoch = await enableLearning();
    await acceptTwo(epoch);
    const first = await claim(now + 2);
    expect(first).toMatchObject({ ok: true });
    const busy = await claim(now + 3, "worker-b");
    expect(busy).toEqual({ ok: true, value: { status: "lease_active" } });
    const off = await store.updatePolicy({
      mutationId: "policy-learn-off",
      requestDigest: digest("policy", "learn-off"),
      now: now + 4,
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: false,
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved" } });
    expect(await claim(now + 5)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.unsupported,
    });
  });

  it("租约过期可重领：fence 单调递增；旧 fence 的提交与 settle 以 revision_conflict 拒且不改状态", async () => {
    await initialize();
    const epoch = await enableLearning();
    const [workId] = await acceptTwo(epoch);
    const first = await claim(now + 2);
    if (!first.ok || first.value.status !== "claimed") throw new Error("claimed");
    const staleFence = first.value.claim.fence;
    // 租约过期后另一 worker 重领：fence 2。
    const reclaimed = await claim(now + 2 + 60_001, "worker-b");
    expect(reclaimed).toMatchObject({ ok: true, value: { status: "claimed" } });
    if (!reclaimed.ok || reclaimed.value.status !== "claimed") throw new Error("reclaimed");
    expect(reclaimed.value.claim.fence).toBe(staleFence + 1);
    expect(reclaimed.value.claim.attempts).toBe(2);
    // 旧持有者携 stale fence 的提交/settle 全部拒绝，且工作状态不被改动。
    const staleCommit = await store.learning.commitLearningWork({
      workId,
      fence: staleFence,
      candidates: [],
      now: now + 2 + 60_002,
    });
    expect(staleCommit).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const staleSettle = await store.learning.settleLearningWork({
      workId,
      fence: staleFence,
      outcome: "applied",
      now: now + 2 + 60_002,
    });
    expect(staleSettle).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    const raw = new DatabaseSync(dbPath);
    try {
      expect(raw.prepare("select state, fence from persona_learning_work").get()).toEqual({
        state: "running",
        fence: staleFence + 1,
      });
    } finally {
      raw.close();
    }
  });

  it("settle 状态机：终态带最小原因；retry_wait 释放租约可再领取", async () => {
    await initialize();
    const epoch = await enableLearning();
    const [workId, workId2] = await acceptTwo(epoch);
    const claimResult = await claim(now + 2);
    if (!claimResult.ok || claimResult.value.status !== "claimed") throw new Error("claimed");
    const fence = claimResult.value.claim.fence;
    const settled = await store.learning.settleLearningWork({
      workId,
      fence,
      outcome: "no_change",
      now: now + 3,
    });
    expect(settled).toEqual({ ok: true, value: { state: "no_change" } });
    // 终态后再次提交/settle 均拒绝。
    expect(
      await store.learning.commitLearningWork({ workId, fence, candidates: [], now: now + 4 }),
    ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    // retry_wait 清租约；同一 worker 立即重领第二项不受第一项租约影响。
    const claim2 = await claim(now + 4, "worker-b");
    if (!claim2.ok || claim2.value.status !== "claimed") throw new Error("claimed-2");
    const retry = await store.learning.settleLearningWork({
      workId: workId2,
      fence: claim2.value.claim.fence,
      outcome: "retry_wait",
      now: now + 5,
    });
    expect(retry).toEqual({ ok: true, value: { state: "retry_wait" } });
    const reclaim = await claim(now + 6, "worker-a");
    if (!reclaim.ok || reclaim.value.status !== "claimed") throw new Error("reclaimed");
    expect(reclaim.value.claim.workId).toBe(workId2);
    expect(reclaim.value.claim.attempts).toBe(2);
  });

  it("尝试耗尽：第二次 retry_wait 直接终态化 rejected(attempts_exhausted)，不再领取", async () => {
    await initialize();
    const epoch = await enableLearning();
    const [workId] = await acceptTwo(epoch);
    // 第一次尝试：失败入 retry_wait。
    const first = await claim(now + 2);
    if (!first.ok || first.value.status !== "claimed") throw new Error("claimed-1");
    await store.learning.settleLearningWork({
      workId,
      fence: first.value.claim.fence,
      outcome: "retry_wait",
      now: now + 3,
    });
    // 第二次尝试：再入 retry_wait 时尝试已耗尽（最多 2 次），终态化。
    const second = await claim(now + 4);
    if (!second.ok || second.value.status !== "claimed") throw new Error("claimed-2");
    expect(second.value.claim.attempts).toBe(2);
    const exhausted = await store.learning.settleLearningWork({
      workId,
      fence: second.value.claim.fence,
      outcome: "retry_wait",
      now: now + 5,
    });
    expect(exhausted).toEqual({ ok: true, value: { state: "rejected" } });
    const raw = new DatabaseSync(dbPath);
    try {
      expect(
        raw.prepare("select fail_reason from persona_learning_work where work_id = ?").get(workId),
      ).toEqual({ fail_reason: "attempts_exhausted" });
    } finally {
      raw.close();
    }
    // 队列里只剩第二项工作。
    const next = await claim(now + 6);
    if (!next.ok || next.value.status !== "claimed") throw new Error("claimed-3");
    expect(next.value.claim.workId).not.toBe(workId);
  });

  it("24 小时超龄工作在领取路径终态化（work_expired）", async () => {
    await initialize();
    const epoch = await enableLearning();
    const first = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-1",
      sourceHandle: sourceHandle({ sessionId: "session-1" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now,
    });
    // 第二项晚 1 小时接收：到检查点仍新鲜，验证领取跳过超龄项而不是全队列清空。
    const second = await store.learning.acceptLearningEvidence({
      evidenceId: "ev-2",
      sourceHandle: sourceHandle({ sessionId: "session-1" }),
      policyEpoch: epoch,
      keyGenerations: {},
      now: now + 3_600_000,
    });
    if (!first.ok || !second.ok) throw new Error("expected accepted");
    if (first.value.status !== "accepted" || second.value.status !== "accepted") {
      throw new Error("expected fresh accepted");
    }
    const expiredWorkId = first.value.workId;
    const later = now + PERSONA_LEARNING_BUDGET.workMaxAgeMs + 1;
    const claimResult = await claim(later);
    // 超龄工作被终态化，领取跳到下一项（ev-2 未超龄）。
    if (!claimResult.ok || claimResult.value.status !== "claimed") throw new Error("claimed");
    expect(claimResult.value.claim.workId).not.toBe(expiredWorkId);
    const raw = new DatabaseSync(dbPath);
    try {
      expect(
        raw.prepare("select state, fail_reason from persona_learning_work where work_id = ?").get(expiredWorkId),
      ).toEqual({ state: "rejected", fail_reason: "work_expired" });
    } finally {
      raw.close();
    }
  });
});

describe("persona P1b 学习域仓储：预算台账", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-budget-"));
    dbPath = join(root, "personas", "persona.sqlite");
    store = await openPersonaStore({ dbPath });
    now = Date.UTC(2026, 9, 31, 12, 0, 0);
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
    const snapshot = await store.readSnapshot();
    if (snapshot.state !== "initialized") throw new Error("expected initialized");
    handleAuthorityId = snapshot.authority.authorityId;
  }

  function reserve(at: number, inputTokens = 100, outputTokens = 50) {
    return store.learning.reserveLearningBudget({
      estimatedInputTokens: inputTokens,
      maxOutputTokens: outputTokens,
      now: at,
    });
  }

  it("调用前预留硬上界；confirmed 核销退 token 差额、不退尝试；未确认不退预留", async () => {
    await initialize();
    const first = await reserve(now);
    expect(first).toEqual({ ok: true, value: { day: "2026-10-31" } });
    const settled = await store.learning.settleLearningBudget({
      day: "2026-10-31",
      reservedInputTokens: 100,
      reservedOutputTokens: 50,
      confirmed: true,
      actualInputTokens: 40,
      actualOutputTokens: 10,
      now,
    });
    expect(settled).toEqual({ ok: true, value: { status: "settled" } });
    const raw = new DatabaseSync(dbPath);
    try {
      // 退差额：input 100→40（-60）、output 50→10（-40）；尝试数不退（失败计入）。
      expect(raw.prepare("select * from persona_learning_budget_day").get()).toEqual({
        day: "2026-10-31",
        attempts_used: 1,
        input_tokens_used: 40,
        output_tokens_used: 10,
        time_updated: now,
      });
    } finally {
      raw.close();
    }
    // 崩溃（confirmed=false）：预留保守不退。
    await reserve(now);
    await store.learning.settleLearningBudget({
      day: "2026-10-31",
      reservedInputTokens: 100,
      reservedOutputTokens: 50,
      confirmed: false,
      now,
    });
    const after = new DatabaseSync(dbPath);
    try {
      expect(after.prepare("select * from persona_learning_budget_day").get()).toMatchObject({
        attempts_used: 2,
        input_tokens_used: 140,
        output_tokens_used: 60,
      });
    } finally {
      after.close();
    }
  });

  it("日上界：第 11 次尝试、token 超界、单次超上界预留均 budget_exhausted 且不计数", async () => {
    await initialize();
    for (let index = 0; index < PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax; index += 1) {
      expect(await reserve(now)).toMatchObject({ ok: true });
    }
    expect(await reserve(now)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.budgetExhausted,
    });
    const raw = new DatabaseSync(dbPath);
    try {
      // 拒绝的预留不计数。
      expect(raw.prepare("select * from persona_learning_budget_day").get()).toMatchObject({
        attempts_used: PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax,
        input_tokens_used: 10 * 100,
        output_tokens_used: 10 * 50,
      });
    } finally {
      raw.close();
    }
  });

  it("输入/输出 token 上界独立生效；单次预留超过日上界直接拒绝", async () => {
    await initialize();
    const bigInput = await reserve(now, PERSONA_LEARNING_BUDGET.dailyInputTokensMax + 1, 0);
    expect(bigInput).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.budgetExhausted });
    const bigOutput = await reserve(now, 0, PERSONA_LEARNING_BUDGET.dailyOutputTokensMax + 1);
    expect(bigOutput).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.budgetExhausted });
    // 输入预算先耗尽时，尝试数还有余也拒绝（三界独立）。
    expect(
      await reserve(now, PERSONA_LEARNING_BUDGET.dailyInputTokensMax, 0),
    ).toMatchObject({ ok: true });
    expect(await reserve(now, 1, 0)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.budgetExhausted,
    });
  });

  it("UTC 日窗口：次日新窗口；时钟倒退落到既有 day 不补额度", async () => {
    await initialize();
    const dayMs = 24 * 60 * 60 * 1000;
    // 10-30 与 10-31 各自独立窗口。
    for (let index = 0; index < PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax; index += 1) {
      expect(await reserve(now - dayMs)).toMatchObject({ ok: true, value: { day: "2026-10-30" } });
    }
    expect(await reserve(now - dayMs)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.budgetExhausted,
    });
    expect(await reserve(now)).toMatchObject({ ok: true, value: { day: "2026-10-31" } });
    // 时钟倒退回 10-30：既有 day 行继续记账，不补额度（合同 §6）。
    expect(await reserve(now - dayMs)).toMatchObject({
      ok: false,
      code: PERSONA_ERROR_CODES.budgetExhausted,
    });
  });

  it("settle 未预留过的日拒绝（validation_failed）；非法参数拒绝", async () => {
    await initialize();
    expect(
      await store.learning.settleLearningBudget({
        day: "2026-10-31",
        reservedInputTokens: 10,
        reservedOutputTokens: 10,
        confirmed: true,
        now,
      }),
    ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
    expect(
      await reserve(now, -1, 0),
    ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
  });
});

describe("persona P1b 学习域仓储：0002→0003 迁移升级", () => {
  it("历史 policy/preference 行搬迁到加宽 schema；学习域五表就位且为空", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-persona-upgrade-"));
    const dbPath = join(root, "personas", "persona.sqlite");
    try {
      // 以真实 runner 建 0002 时代库并写入历史行，再经 openPersonaStore 应用 0003。
      await mkdir(dirname(dbPath), { recursive: true });
      const legacy = new DatabaseSync(dbPath);
      ensureSqliteSchemaMigrationTable(legacy);
      await sqliteMigrations.migrate(legacy, PERSONA_MIGRATIONS.slice(0, 2), {
        database: "persona",
        transactionOpen: false,
        appliedAtColumn: "time_applied",
        backupDirectories: [root],
      });
      legacy
        .exec(
          "insert into persona_authority (id, authority_id, persona_id, schema_version, time_created) values (1, 'authority-legacy', 'persona-legacy', 1, 100)",
        );
      legacy
        .exec(
          "insert into persona_core (id, core_revision, template_version, display_name, self_description, warmth, directness, humor, time_created, time_updated) values (1, 1, 1, 'Drora', '', 'balanced', 'direct', 'light', 100, 100)",
        );
      legacy
        .exec(
          "insert into persona_policy (id, use_preferences, policy_revision, policy_epoch, time_updated) values (1, 1, 1, 1, 100)",
        );
      legacy
        .exec(
          "insert into persona_preference (key, value, revision, key_generation, provenance_kind, epistemic_status, status, pinned, auto_suppressed, time_updated) values ('replyLanguage', 'zh-CN', 1, 1, 'settings', 'explicit', 'active', 1, 0, 100)",
        );
      legacy.close();

      const store = await openPersonaStore({ dbPath });
      try {
        const snapshot = await store.readSnapshot();
        if (snapshot.state !== "initialized") throw new Error("expected initialized");
        // 历史策略行保留；P1b 列按迁移默认填充（auto_learn=0、learning_generation=0）。
        expect(snapshot.policy).toEqual({
          usePreferences: true,
          autoLearn: false,
          learningGeneration: 0,
          policyRevision: 1,
          policyEpoch: 1,
          learningBudget: PERSONA_LEARNING_BUDGET,
        });
        // 历史偏好行保留；加宽词汇与新列读侧默认成立。
        expect(snapshot.preferences).toEqual([
          {
            key: "replyLanguage",
            value: "zh-CN",
            revision: 1,
            keyGeneration: 1,
            provenanceKind: "settings",
            epistemicStatus: "explicit",
            pinned: true,
            disputed: false,
            autoSuppressed: false,
            pendingCandidate: undefined,
            updatedAt: 100,
            status: "active",
          },
        ]);
        // 学习域五表就位且为空；学习接收在新 schema 上可用（U on 但 L off → unsupported）。
        const raw = new DatabaseSync(dbPath);
        try {
          for (const table of [
            "persona_learning_evidence",
            "persona_learning_work",
            "persona_learning_candidate",
            "persona_learning_source",
            "persona_learning_budget_day",
          ]) {
            expect(
              raw.prepare(`select count(*) as n from ${table}`).get(),
            ).toEqual({ n: 0 });
          }
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
