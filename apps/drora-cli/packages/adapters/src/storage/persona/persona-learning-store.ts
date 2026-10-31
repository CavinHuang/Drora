/**
 * persona 学习域仓储实现（specs/drora-persona-system.md §8；存储合同
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1 Evidence/Candidate/Work 与
 * §6 来源/工作/预算）。行原语在 persona-learning-rows.ts；事务经 PersonaSqliteTxnRunner
 * 与管理面共享同一单连接队列（persona-store.ts 头注）。
 *
 * 语义清单（逐条对应合同 §6）：
 * - 接收幂等：evidenceId 唯一；同 ID 同内容 already_accepted，同 ID 异内容
 *   mutation_conflict；非终态工作满 PERSONA_LEARNING_BUDGET.nonTerminalWorksMaxPerAuthority
 *   拒绝（storage_capacity），单事务回滚不留半行。
 * - 队列：accepted → running（租约+fence）→ applied/no_change/rejected/retry_wait；
 *   每 authority 并发 1（存活租约即互斥）；过期可重领，fence 领取即递增，stale fence
 *   提交/settle 一律 revision_conflict 且不改工作状态；24 小时超龄、尝试耗尽在领取路径
 *   终态化；终态保留最小 id/reason 7 天（接收/领取路径顺带清理，清理先于幂等回放与
 *   策略门——U/L 关闭期间触达的调用同样清理，全程无调用的静默期顺延到下次调用）。
 * - 预算：调用前 DB 预留硬上界（尝试+输入+输出），失败计入不退尝试；confirmed 核销退
 *   token 差额，崩溃不退；UTC 日窗口按服务时间记账，时钟倒退落到既有 day 行继续记账。
 * - 提交：策略屏障（U/L、epoch）拒绝整个提交并把工作终态化（不靠预算重试复活）；
 *   候选逐条过屏障——抑制/generation 陈旧/结构非法丢弃且不留正文，pinned 走待确认
 *   建议，同值并源（≤4），异值置 disputed＋待确认候选。源复验发生在事务外（服务层），
 *   pinned 屏障已覆盖「显式保存不被覆盖」（显式保存恒 pinned），槽 revision 在同一
 *   事务内读改写，无跨事务 CAS 面。
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  PERSONA_ERROR_CODES,
  PERSONA_LEARNING_BUDGET,
  PERSONA_LEARNING_WORK_STATES,
  PERSONA_PREFERENCE_KEYS,
  type PersonaManagementResult,
} from "@drora/shared";
import type {
  PersonaLearningAcceptResult,
  PersonaLearningBudgetReserveInput,
  PersonaLearningBudgetReservation,
  PersonaLearningBudgetSettleInput,
  PersonaLearningBudgetSettleResult,
  PersonaLearningBudgetUsage,
  PersonaLearningClaimInput,
  PersonaLearningClaimResult,
  PersonaLearningCommitCandidate,
  PersonaLearningCommitInput,
  PersonaLearningCommitResult,
  PersonaLearningEvidenceInput,
  PersonaLearningSettleWorkInput,
  PersonaLearningSettleWorkResult,
  PersonaLearningSlotSourceBinding,
  PersonaLearningSourceHandle,
  PersonaLearningStorePort,
} from "./persona-learning-contract.js";
import {
  countNonTerminalWorkRows,
  decodeStoredSourceHandle,
  encodeKeyGenerations,
  mergeSlotSource,
  normalizeEvidenceRefs,
  normalizeKeyGenerations,
  normalizeSourceHandle,
  pruneTerminalWorks,
  readBudgetDayRow,
  readInferredSlotSourceBindings,
  readNextClaimableWorkRow,
  readWorkRowById,
  sha256Hex,
  stableStringify,
  upsertBudgetDayRow,
  upsertPendingCandidate,
  utcDayKey,
} from "./persona-learning-rows.js";
import {
  asInteger,
  asString,
  code,
  failCorruptRow,
  readAuthorityRow,
  readPreferenceSlotRow,
  readPolicyRow,
  toManagementResult,
  value,
} from "./persona-rows.js";
import type { PersonaSqliteTxnRunner } from "./persona-store-txn.js";
import type { ResolvedPersonaStoreOptions } from "./contract.js";

/** 领取/提交路径写回工作行的公共 SET 片段。 */
const WORK_LEASE_CLEAR = "lease_owner = null, lease_expires_at = null, time_updated = ?";

export class PersonaLearningSqliteStore implements PersonaLearningStorePort {
  constructor(
    private readonly db: DatabaseSync,
    private readonly txn: PersonaSqliteTxnRunner,
    private readonly options: ResolvedPersonaStoreOptions,
  ) {}

  // ---------------------------------------------------------------------------
  // 接收（evidenceId 幂等；非终态 128 上限）
  // ---------------------------------------------------------------------------

  async acceptLearningEvidence(
    input: PersonaLearningEvidenceInput,
  ): Promise<PersonaManagementResult<PersonaLearningAcceptResult>> {
    let normalizedHandle: PersonaLearningSourceHandle;
    let normalizedGenerations: Record<string, number>;
    try {
      if (typeof input.evidenceId !== "string" || input.evidenceId.trim().length === 0) {
        return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
      }
      if (
        typeof input.policyEpoch !== "number" ||
        !Number.isSafeInteger(input.policyEpoch) ||
        input.policyEpoch < 0
      ) {
        return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
      }
      normalizedHandle = normalizeSourceHandle(input.sourceHandle);
      normalizedGenerations = normalizeKeyGenerations(input.keyGenerations);
    } catch {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    // 同 evidenceId 的内容比较摘要：服务对稳定源身份构造 evidenceId，异内容同 ID 是
    // 构造缺陷，显式拒绝（合同 §6「evidenceId 幂等接收」）。
    const sourceDigest = sha256Hex(
      stableStringify({
        handle: normalizedHandle,
        keyGenerations: normalizedGenerations,
        policyEpoch: input.policyEpoch,
      }),
    );
    const outcome = await this.txn.withTxn(true, () => {
      const authority = readAuthorityRow(this.db);
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      // authority 一致性（合同 §2「权限/authority 校验先于 receipt 查询」、§6「远端
      // authority 的输入不迁入本地个人域」）：handle 声明的 authorityId 与本库 authority
      // 不一致即拒绝，先于幂等回放查询。
      if (normalizedHandle.authorityId !== authority.authorityId) {
        return code(PERSONA_ERROR_CODES.authorityMismatch);
      }
      // 终态 7 天保留（合同 §6「终态保留…最多 7 天」，保留上界无条件）：清理先于幂等
      // 回放与策略门——U/L 关闭期间与幂等回放触达的调用同样顺带清理过期终态行，
      // 关闭窗口内的过期行不再滞留到重开之后的首次接收/领取。
      pruneTerminalWorks(this.db, PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs, input.now);
      const existing = this.db
        .prepare(
          "select source_digest from persona_learning_evidence where evidence_id = ?",
        )
        .get(input.evidenceId) as Record<string, unknown> | undefined;
      if (existing) {
        if (asString(existing.source_digest) !== sourceDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        const work = this.db
          .prepare("select work_id from persona_learning_work where evidence_id = ?")
          .get(input.evidenceId) as Record<string, unknown> | undefined;
        // evidence 与 work 接收时同事务成对写入；此后 work 终态行按合同 §6 保留上界
        // （7 天）清理，而 evidence 是来源定位/复验记录（readInferredSlotSources 联读
        // 依赖，合同 §6「证据清理独立」）长期保留——「digest 匹配但 work 已清」＝已接收
        // 且工作已过保留期的幂等回放，不是库损坏；不带 workId 如实表达工作行已不存在。
        if (!work) {
          return value<PersonaLearningAcceptResult>({ status: "already_accepted" });
        }
        return value<PersonaLearningAcceptResult>({
          status: "already_accepted",
          workId: asString(work.work_id),
        });
      }
      // 学习接收前置（spec §5）的存储侧执行：U && L 任一关闭即停止新接收（幂等回放
      // 不受影响——已接收来源的幂等语义与策略无关）。E/Q/预算/成功源证据由服务层判定。
      const policy = readPolicyRow(this.db);
      if (!policy.usePreferences || !policy.autoLearn) {
        return code(PERSONA_ERROR_CODES.unsupported);
      }
      if (countNonTerminalWorkRows(this.db) >= PERSONA_LEARNING_BUDGET.nonTerminalWorksMaxPerAuthority) {
        return code(PERSONA_ERROR_CODES.storageCapacity);
      }
      const workId = randomUUID();
      this.db
        .prepare(
          `insert into persona_learning_evidence
             (evidence_id, source_handle, source_digest, workspace_key, session_id,
              policy_epoch, key_generations, time_created)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.evidenceId,
          JSON.stringify(normalizedHandle),
          sourceDigest,
          normalizedHandle.workspaceKey,
          normalizedHandle.sessionId,
          input.policyEpoch,
          encodeKeyGenerations(normalizedGenerations),
          input.now,
        );
      this.db
        .prepare(
          `insert into persona_learning_work
             (work_id, evidence_id, state, lease_owner, lease_expires_at, fence, attempts,
              policy_epoch, key_generations, fail_reason, time_created, time_updated)
           values (?, ?, 'accepted', null, null, 0, 0, ?, ?, null, ?, ?)`,
        )
        .run(
          workId,
          input.evidenceId,
          input.policyEpoch,
          encodeKeyGenerations(normalizedGenerations),
          input.now,
          input.now,
        );
      return value<PersonaLearningAcceptResult>({ status: "accepted", workId });
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // 领取（并发 1；过期重领；fence 单调；超龄/耗尽终态化）
  // ---------------------------------------------------------------------------

  async claimLearningWork(
    input: PersonaLearningClaimInput,
  ): Promise<PersonaManagementResult<PersonaLearningClaimResult>> {
    if (
      typeof input.leaseOwner !== "string" ||
      input.leaseOwner.trim().length === 0 ||
      typeof input.leaseDurationMs !== "number" ||
      !Number.isSafeInteger(input.leaseDurationMs) ||
      input.leaseDurationMs <= 0 ||
      typeof input.now !== "number" ||
      !Number.isSafeInteger(input.now)
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(true, () => {
      if (readAuthorityRow(this.db) === undefined) return code(PERSONA_ERROR_CODES.uninitialized);
      // 终态 7 天保留（合同 §6「终态保留…最多 7 天」，保留上界无条件）：清理先于策略门
      // ——U/L 关闭期间触达领取的调用同样顺带清理过期终态行，不靠重开策略自愈。
      pruneTerminalWorks(this.db, PERSONA_LEARNING_BUDGET.terminalWorkRetentionMs, input.now);
      // U/L 任一关闭不派发新工作（spec §5「关闭策略立即阻止新提交」；模型调用也不发生）。
      const policy = readPolicyRow(this.db);
      if (!policy.usePreferences || !policy.autoLearn) {
        return code(PERSONA_ERROR_CODES.unsupported);
      }
      // 每 authority 并发 1：存活租约互斥全部领取（合同 §6「worker 最多并发 1 个/authority」）。
      const activeLease = this.db
        .prepare(
          "select 1 as present from persona_learning_work where state = 'running' and lease_expires_at > ? limit 1",
        )
        .get(input.now) as Record<string, unknown> | undefined;
      if (activeLease) return value<PersonaLearningClaimResult>({ status: "lease_active" });
      // 24 小时有效期（合同 §6「最长工作有效期 24 小时」）：超龄未终态按 expired 终结。
      this.db
        .prepare(
          `update persona_learning_work
           set state = 'rejected', fail_reason = 'work_expired', ${WORK_LEASE_CLEAR}
           where state in ('accepted', 'running', 'retry_wait') and time_created <= ?`,
        )
        .run(input.now, input.now - PERSONA_LEARNING_BUDGET.workMaxAgeMs);
      // FIFO 领取；尝试耗尽的残留行（崩溃遗留）终态化后继续找下一行。
      for (;;) {
        const row = readNextClaimableWorkRow(this.db, input.now);
        if (!row) return value<PersonaLearningClaimResult>({ status: "empty" });
        if (row.attempts >= PERSONA_LEARNING_BUDGET.workMaxAttempts) {
          this.db
            .prepare(
              `update persona_learning_work
               set state = 'rejected', fail_reason = 'attempts_exhausted', ${WORK_LEASE_CLEAR}
               where work_id = ?`,
            )
            .run(input.now, row.workId);
          continue;
        }
        // fence 领取即递增；过期重领的新 fence 使旧持有者的提交/settle 全部失效。
        const fence = row.fence + 1;
        const leaseExpiresAt = input.now + input.leaseDurationMs;
        this.db
          .prepare(
            `update persona_learning_work
             set state = 'running', lease_owner = ?, lease_expires_at = ?, fence = ?,
                 attempts = attempts + 1, time_updated = ?
             where work_id = ?`,
          )
          .run(input.leaseOwner, leaseExpiresAt, fence, input.now, row.workId);
        const evidence = this.readEvidenceRow(row.evidenceId);
        if (!evidence) failCorruptRow();
        return value<PersonaLearningClaimResult>({
          status: "claimed",
          claim: {
            workId: row.workId,
            evidenceId: row.evidenceId,
            fence,
            attempts: row.attempts + 1,
            policyEpoch: row.policyEpoch,
            keyGenerations: row.keyGenerations,
            leaseExpiresAt,
            sourceHandle: decodeStoredSourceHandle(evidence!.sourceHandle),
          },
        });
      }
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // 提交（策略屏障拒全单；候选逐条屏障；applied/no_change 终态）
  // ---------------------------------------------------------------------------

  async commitLearningWork(
    input: PersonaLearningCommitInput,
  ): Promise<PersonaManagementResult<PersonaLearningCommitResult>> {
    if (
      typeof input.workId !== "string" ||
      input.workId.length === 0 ||
      typeof input.fence !== "number" ||
      !Number.isSafeInteger(input.fence) ||
      input.fence < 1 ||
      typeof input.now !== "number" ||
      !Number.isSafeInteger(input.now) ||
      !Array.isArray(input.candidates) ||
      input.candidates.length > PERSONA_LEARNING_BUDGET.candidatesMaxPerWork
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(true, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const work = readWorkRowById(this.db, input.workId);
      // 未知工作/非 running＝迟到或被级联清掉的提交；stale fence＝旧持有者。一律
      // revision_conflict；前两者不改工作状态（stale fence 也不改）。
      if (!work || work.state !== PERSONA_LEARNING_WORK_STATES.running) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (work.fence !== input.fence) return code(PERSONA_ERROR_CODES.revisionConflict);
      const policy = readPolicyRow(this.db);
      // 策略屏障（合同 §4.2/§6）：U/L 任一关闭或接收后 epoch 推进＝整个提交拒绝，
      // 工作终态化——用户关闭策略立即生效，不能靠预算重试复活。
      const learningEnabled = policy.usePreferences && policy.autoLearn;
      if (!learningEnabled || policy.policyEpoch !== work.policyEpoch) {
        this.db
          .prepare(
            `update persona_learning_work
             set state = 'rejected', fail_reason = 'policy_barrier', ${WORK_LEASE_CLEAR}
             where work_id = ?`,
          )
          .run(input.now, input.workId);
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      const evidence = this.readEvidenceRow(work.evidenceId);
      if (!evidence) failCorruptRow();
      const sourceSummary = stableStringify(decodeStoredSourceHandle(evidence!.sourceHandle));
      const outcomes: Array<PersonaLearningCommitResult["outcomes"][number]> = [];
      let hasEffect = false;
      for (const candidate of input.candidates) {
        const outcomeKind = this.applyCandidate(
          candidate,
          work.keyGenerations[candidate.key] ?? 0,
          work.evidenceId,
          sourceSummary,
          input.now,
        );
        outcomes.push({ key: candidate.key, outcome: outcomeKind });
        if (
          outcomeKind === "slot_written" ||
          outcomeKind === "source_merged" ||
          outcomeKind === "candidate_pending"
        ) {
          hasEffect = true;
        }
      }
      const terminalState = hasEffect
        ? PERSONA_LEARNING_WORK_STATES.applied
        : PERSONA_LEARNING_WORK_STATES.noChange;
      this.db
        .prepare(
          `update persona_learning_work set state = ?, ${WORK_LEASE_CLEAR} where work_id = ?`,
        )
        .run(terminalState, input.now, input.workId);
      return value<PersonaLearningCommitResult>({ status: terminalState, outcomes });
    });
    return toManagementResult(outcome);
  }

  /** 单候选屏障与写入；返回逐条结果（丢弃类不留任何正文，合同 §6「被拒候选不留正文」）。 */
  private applyCandidate(
    candidate: PersonaLearningCommitCandidate,
    snapshotGeneration: number,
    evidenceId: string,
    sourceSummary: string,
    now: number,
  ):
    | "slot_written"
    | "source_merged"
    | "source_known"
    | "candidate_pending"
    | "no_op_same_value"
    | "dropped_suppressed"
    | "dropped_stale_generation"
    | "dropped_invalid" {
    if (!(PERSONA_PREFERENCE_KEYS as Readonly<Record<string, string>>)[candidate.key]) {
      return "dropped_invalid";
    }
    if (typeof candidate.value !== "string" || candidate.value.length === 0) {
      return "dropped_invalid";
    }
    let evidenceRefs: string[];
    try {
      evidenceRefs = normalizeEvidenceRefs(candidate.evidenceRefs);
    } catch {
      return "dropped_invalid";
    }
    const slot = readPreferenceSlotRow(this.db, candidate.key);
    // 抑制键不开放自动学习（合同 §8「失败键不开放自动学习」；忘记设置 autoSuppressed）。
    if (slot?.autoSuppressed) return "dropped_suppressed";
    // generation 屏障（合同 §4.2）：forget/显式保存推进 generation 后，接收前快照过期。
    const currentGeneration = slot?.keyGeneration ?? 0;
    if (snapshotGeneration !== currentGeneration) return "dropped_stale_generation";
    if (slot?.status === "active" && slot.pinned) {
      if (slot.value === candidate.value) return "no_op_same_value";
      // pinned 不被自动覆盖（合同 §6）：不同值只进待确认建议，槽保持不动。
      upsertPendingCandidate(this.db, {
        key: candidate.key,
        proposedValue: candidate.value,
        evidenceId,
        evidenceRefs,
        expectedGeneration: snapshotGeneration,
        expectedRevision: slot.revision,
        now,
      });
      return "candidate_pending";
    }
    if (slot?.status === "active" && slot.value === candidate.value) {
      // 同值 inferred 合并有效来源（≤4；到上限后不再新增，值已成立）。
      const merged = mergeSlotSource(this.db, {
        key: candidate.key,
        evidenceId,
        sourceSummary,
        now,
      });
      return merged === "merged" ? "source_merged" : merged === "known" ? "source_known" : "no_op_same_value";
    }
    if (slot?.status === "active") {
      // 不同 inferred 值：槽置 disputed（下一轮停止注入），候选待确认（每键最多一项）。
      this.db
        .prepare(
          "update persona_preference set disputed = 1, time_updated = ? where key = ?",
        )
        .run(now, candidate.key);
      upsertPendingCandidate(this.db, {
        key: candidate.key,
        proposedValue: candidate.value,
        evidenceId,
        evidenceRefs,
        expectedGeneration: snapshotGeneration,
        expectedRevision: slot.revision,
        now,
      });
      return "candidate_pending";
    }
    // 无槽或 forgotten（未被抑制）槽：inferred 首写（extraction/inferred/unpinned）。
    // generation 不递增：并发工作依赖它发现同键冲突（disputed 语义，合同 §6）。
    const nextRevision = (slot?.revision ?? 0) + 1;
    this.db
      .prepare(
        `insert into persona_preference
           (key, value, revision, key_generation, provenance_kind, epistemic_status,
            status, pinned, auto_suppressed, disputed, time_updated)
         values (?, ?, ?, ?, 'extraction', 'inferred', 'active', 0, 0, 0, ?)
         on conflict(key) do update set value = excluded.value,
           revision = excluded.revision,
           provenance_kind = excluded.provenance_kind,
           epistemic_status = excluded.epistemic_status,
           status = excluded.status,
           pinned = excluded.pinned,
           disputed = excluded.disputed,
           time_updated = excluded.time_updated`,
      )
      .run(candidate.key, candidate.value, nextRevision, slot?.keyGeneration ?? 0, now);
    // 首写的来源即主来源：占用 ordinal 0（合并来源与首写共享 ≤4 上界）。
    mergeSlotSource(this.db, { key: candidate.key, evidenceId, sourceSummary, now });
    return "slot_written";
  }

  // ---------------------------------------------------------------------------
  // 工作终态/重试（stale fence 拒绝且不改状态）
  // ---------------------------------------------------------------------------

  async settleLearningWork(
    input: PersonaLearningSettleWorkInput,
  ): Promise<PersonaManagementResult<PersonaLearningSettleWorkResult>> {
    if (
      typeof input.workId !== "string" ||
      input.workId.length === 0 ||
      typeof input.fence !== "number" ||
      !Number.isSafeInteger(input.fence) ||
      input.fence < 1 ||
      typeof input.now !== "number" ||
      !Number.isSafeInteger(input.now) ||
      (input.reason !== undefined &&
        (typeof input.reason !== "string" || [...input.reason].length > 128))
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(true, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const work = readWorkRowById(this.db, input.workId);
      if (!work || work.state !== PERSONA_LEARNING_WORK_STATES.running) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (work.fence !== input.fence) return code(PERSONA_ERROR_CODES.revisionConflict);
      let state: PersonaLearningSettleWorkResult["state"];
      let failReason: string | null;
      if (input.outcome === "retry_wait") {
        if (work.attempts >= PERSONA_LEARNING_BUDGET.workMaxAttempts) {
          // 尝试耗尽不得再入等待（合同 §6「最多 2 次尝试」）。
          state = PERSONA_LEARNING_WORK_STATES.rejected;
          failReason = "attempts_exhausted";
        } else {
          state = PERSONA_LEARNING_WORK_STATES.retryWait;
          failReason = null;
        }
      } else {
        state = input.outcome;
        failReason = input.reason ?? null;
      }
      this.db
        .prepare(
          `update persona_learning_work set state = ?, fail_reason = ?, ${WORK_LEASE_CLEAR}
           where work_id = ?`,
        )
        .run(state, failReason, input.now, input.workId);
      return value<PersonaLearningSettleWorkResult>({ state });
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // 预算台账（调用前预留硬上界；失败计入；UTC 日窗口；倒退不补额度）
  // ---------------------------------------------------------------------------

  async reserveLearningBudget(
    input: PersonaLearningBudgetReserveInput,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetReservation>> {
    const { estimatedInputTokens, maxOutputTokens, now } = input;
    if (
      !isTokenCount(estimatedInputTokens) ||
      !isTokenCount(maxOutputTokens) ||
      typeof now !== "number" ||
      !Number.isSafeInteger(now)
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    // 单次预留超过日上界永远无法成立，直接拒绝（不计数）。
    if (
      estimatedInputTokens > PERSONA_LEARNING_BUDGET.dailyInputTokensMax ||
      maxOutputTokens > PERSONA_LEARNING_BUDGET.dailyOutputTokensMax
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.budgetExhausted };
    }
    const outcome = await this.txn.withTxn(true, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const day = utcDayKey(now);
      const row = readBudgetDayRow(this.db, day) ?? {
        day,
        attemptsUsed: 0,
        inputTokensUsed: 0,
        outputTokensUsed: 0,
      };
      if (
        row.attemptsUsed + 1 > PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax ||
        row.inputTokensUsed + estimatedInputTokens > PERSONA_LEARNING_BUDGET.dailyInputTokensMax ||
        row.outputTokensUsed + maxOutputTokens > PERSONA_LEARNING_BUDGET.dailyOutputTokensMax
      ) {
        return code(PERSONA_ERROR_CODES.budgetExhausted);
      }
      upsertBudgetDayRow(
        this.db,
        {
          day,
          attemptsUsed: row.attemptsUsed + 1,
          inputTokensUsed: row.inputTokensUsed + estimatedInputTokens,
          outputTokensUsed: row.outputTokensUsed + maxOutputTokens,
        },
        now,
      );
      return value<PersonaLearningBudgetReservation>({ day });
    });
    return toManagementResult(outcome);
  }

  async settleLearningBudget(
    input: PersonaLearningBudgetSettleInput,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetSettleResult>> {
    const { day, reservedInputTokens, reservedOutputTokens, confirmed } = input;
    if (
      typeof day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !isTokenCount(reservedInputTokens) ||
      !isTokenCount(reservedOutputTokens) ||
      (confirmed &&
        (input.actualInputTokens !== undefined && !isTokenCount(input.actualInputTokens) ||
          input.actualOutputTokens !== undefined && !isTokenCount(input.actualOutputTokens)))
    ) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(true, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const row = readBudgetDayRow(this.db, day);
      // 未预留过的日不允许核销（调用方契约破坏，显式拒绝）。
      if (!row) return code(PERSONA_ERROR_CODES.validationFailed);
      // 尝试数不退（失败计入，合同 §6）；confirmed=false（崩溃）保守不退预留。
      const actualInput = input.actualInputTokens ?? reservedInputTokens;
      const actualOutput = input.actualOutputTokens ?? reservedOutputTokens;
      const inputRefund = confirmed ? Math.max(0, reservedInputTokens - actualInput) : 0;
      const outputRefund = confirmed ? Math.max(0, reservedOutputTokens - actualOutput) : 0;
      upsertBudgetDayRow(
        this.db,
        {
          day,
          attemptsUsed: row.attemptsUsed,
          inputTokensUsed: Math.max(0, row.inputTokensUsed - inputRefund),
          outputTokensUsed: Math.max(0, row.outputTokensUsed - outputRefund),
        },
        input.now,
      );
      return value<PersonaLearningBudgetSettleResult>({ status: "settled" });
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // 只读观测（服务层接收前置的预算判定与 capture 读取侧复验）
  // ---------------------------------------------------------------------------

  async readLearningBudgetUsage(
    now: number,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetUsage>> {
    if (typeof now !== "number" || !Number.isSafeInteger(now)) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(false, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const day = utcDayKey(now);
      const row = readBudgetDayRow(this.db, day);
      return value<PersonaLearningBudgetUsage>({
        day,
        attemptsUsed: row?.attemptsUsed ?? 0,
        inputTokensUsed: row?.inputTokensUsed ?? 0,
        outputTokensUsed: row?.outputTokensUsed ?? 0,
      });
    });
    return toManagementResult(outcome);
  }

  async readInferredSlotSources(): Promise<
    PersonaManagementResult<readonly PersonaLearningSlotSourceBinding[]>
  > {
    const outcome = await this.txn.withTxn(false, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      return value(readInferredSlotSourceBindings(this.db));
    });
    return toManagementResult(outcome);
  }

  async hasLearningEvidence(evidenceId: string): Promise<PersonaManagementResult<boolean>> {
    if (typeof evidenceId !== "string" || evidenceId.length === 0) {
      return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
    }
    const outcome = await this.txn.withTxn(false, () => {
      if (!readAuthorityRow(this.db)) return code(PERSONA_ERROR_CODES.uninitialized);
      const row = this.db
        .prepare("select 1 as present from persona_learning_evidence where evidence_id = ?")
        .get(evidenceId) as Record<string, unknown> | undefined;
      return value(row !== undefined);
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // 行读取
  // ---------------------------------------------------------------------------

  private readEvidenceRow(evidenceId: string):
    | {
        sourceHandle: string;
        sourceDigest: string;
        workspaceKey: string;
        sessionId: string;
        policyEpoch: number;
        keyGenerationsText: string;
        timeCreated: number;
      }
    | undefined {
      const row = this.db
        .prepare(
          `select source_handle, source_digest, workspace_key, session_id, policy_epoch,
                  key_generations, time_created
           from persona_learning_evidence where evidence_id = ?`,
        )
        .get(evidenceId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        sourceHandle: asString(row.source_handle),
        sourceDigest: asString(row.source_digest),
        workspaceKey: asString(row.workspace_key),
        sessionId: asString(row.session_id),
        policyEpoch: asInteger(row.policy_epoch),
        keyGenerationsText: asString(row.key_generations),
        timeCreated: asInteger(row.time_created),
      };
    }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
