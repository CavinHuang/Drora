/**
 * P1b 有限学习运行时（specs/drora-persona-system.md §5/§8；合同 §3 acceptLearningSource
 * 「内部」、§6 来源/工作/预算）。从 PersonaAppServiceImpl 拆出以满足 max-file-lines：
 * 本文件是学习编排的唯一实现点（接收门序/工作循环/capture 读取侧复验），服务类只做
 * 组合与委托；进程组合层（persona-system）经 PersonaInternalLearning 绑定通知消费者。
 *
 * 边界：库访问一律经 deps.requireStore（惰性打开 owner 在服务类）；本文件不持有连接、
 * 不做迁移决策；不落个人正文（日志只记固定类别/ID/耗时）。
 */
import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@drora/contracts";
import {
  isPersonaStoreError,
  PersonaStoreError,
  type PersonaLearningBudgetUsage,
  type PersonaLearningWorkClaim,
  type PersonaStorePort,
  type PersonaStoreSnapshot,
} from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  PERSONA_LEARNING_BUDGET,
  type PersonaErrorCode,
  type PersonaManagementResult,
  type PersonaPreferenceFacts,
} from "@drora/shared";
import {
  PERSONA_LEARNING_PERMISSION_DESCRIPTION,
  PERSONA_LEARNING_SERVICE_DEFAULTS,
  PERSONA_LEARNING_TRUSTED_ORIGIN,
  decodePersonaLearningMessageBoundary,
  encodePersonaLearningMessageBoundary,
  type PersonaLearningAcceptanceOutcome,
  type PersonaLearningAcceptanceRequest,
  type PersonaLearningCounters,
  type PersonaLearningServiceOptions,
  type PersonaLearningSkipReason,
  type PersonaLearningSourceVerification,
} from "./learning-contract.js";
import {
  estimateLearningInputTokens,
  pausedPersonaLearningExtractor,
  validateExtractionDrafts,
  type PersonaLearningExtractionPort,
} from "./learning-extraction.js";

/** 服务类注入给学习运行时的共享依赖（连接与配置的所有者仍是 PersonaAppServiceImpl）。 */
export interface PersonaLearningRuntimeDeps {
  /** persona.sqlite 完整路径（错误对象携带用）。 */
  readonly dbPath: string;
  /** 业务时间（合同 §1：服务产生 UTC 时间）。 */
  readonly now: () => number;
  readonly logger: Logger | undefined;
  /** 学习装配（owner/extractor/租约/预算旋钮）；undefined＝全缺省（paused、无 owner）。 */
  readonly options: PersonaLearningServiceOptions | undefined;
  /** 进程内计数（所有者=服务类，测试可读）。 */
  readonly counters: PersonaLearningCounters;
  /** 惰性存储访问（打开/迁移/终态语义在服务类）。 */
  readonly requireStore: () => Promise<PersonaStorePort>;
}

export interface PersonaLearningRuntime {
  readonly acceptLearningSource: (
    request: PersonaLearningAcceptanceRequest,
  ) => Promise<PersonaLearningAcceptanceOutcome>;
  readonly processLearningWork: () => Promise<"idle" | "claimed">;
  readonly readVerifiedCaptureSnapshot: () => Promise<CaptureSnapshotWithPreferences>;
}

/** capture 注入集合选取结果：快照 + 本轮可注入槽位（含 inferred 复验过滤后）。 */
interface CaptureSnapshotWithPreferences {
  readonly snapshot: PersonaStoreSnapshot;
  readonly preferences: readonly PersonaPreferenceFacts[];
  readonly hasInferred: boolean;
}

/**
 * 注入相关状态的稳定指纹（合同 §4.2「再短事务确认上述版本未变，变更重试一次」）：
 * coreRevision + policyEpoch + 选中槽位的 key/revision。偏好正文不参与（同 revision 同值）。
 */
function injectionFingerprint(selection: CaptureSnapshotWithPreferences): string {
  if (selection.snapshot.state === "uninitialized") return "uninitialized";
  return canonicalJson({
    coreRevision: selection.snapshot.core.coreRevision,
    epoch: selection.snapshot.policy.policyEpoch,
    slots: selection.preferences.map((slot) => ({ key: slot.key, revision: slot.revision })),
  });
}

/** 键序无关的紧凑 JSON；requestDigest/指纹与对象键序解耦（app-service 复用同一实现）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** evidenceId/幂等摘要的稳定 SHA-256（输入先经 canonicalJson 规范化）。 */
function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}


/**
 * 学习运行时工厂：绑定共享依赖并返回内部学习面与 capture 读取侧复验入口。
 * 同进程串行（accept/process 共享一条链）；跨进程互斥由库事务/租约保证。
 */
export function createPersonaLearningRuntime(
  deps: PersonaLearningRuntimeDeps,
): PersonaLearningRuntime {
  const { dbPath, now, logger } = deps;
  const options = deps.options;
  const counters = deps.counters;
  const requireStore = deps.requireStore;
  const leaseOwner = `persona-learning-${process.pid}-${randomUUID()}`;
  const leaseDurationMs =
    options?.leaseDurationMs ?? PERSONA_LEARNING_SERVICE_DEFAULTS.leaseDurationMs;
  const outputReserveMax =
    options?.outputTokenReserveMax ?? PERSONA_LEARNING_SERVICE_DEFAULTS.outputTokenReserveMax;
  let chain: Promise<unknown> = Promise.resolve();

  /** 同进程学习面单飞：accept 与 process 串行（跨进程互斥由库事务/租约保证）。 */
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = chain.then(operation, operation);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }


/**
 * 接收门序（spec §5「E && Q && U && L && 预算 && 成功源证据」，任一不满足＝跳过并计数；
 * 合同 §6「缺证据即跳过，不补造旧字段」）：E → 结构校验 → 快照 → U&&L → owner 复验 →
 * 有界窗口+预算 → evidenceId 构造 → 单事务入库（U&&L/容量/authority 由库再屏障）。
 * Q（可信入口资格）由通知接缝的资格表冻结保证：本面只收普通成功轮通知。
 */
async function acceptLearningSourceInner(
  request: PersonaLearningAcceptanceRequest,
): Promise<PersonaLearningAcceptanceOutcome> {
  const skip = (reason: PersonaLearningSkipReason): PersonaLearningAcceptanceOutcome => {
    counters.acceptSkipped[reason] =
      (counters.acceptSkipped[reason] ?? 0) + 1;
    return { kind: "skipped", reason };
  };
  // E（执行许可）一票拒绝：E off 的 Runtime 不该有通知端口，防御性再验。
  if (!request.personaPermission) return skip("permission_not_granted");
  if (!isBoundedSourceId(request.workspaceKey) || !isBoundedSourceId(request.sessionId)) {
    return skip("invalid_source");
  }
  if (
    !isBoundedSourceId(request.turnId) ||
    !isBoundedSourceId(request.boundary.userMessageId) ||
    !isBoundedSourceId(request.boundary.boundaryMessageId)
  ) {
    return skip("invalid_source");
  }
  const owner = options?.sourceOwner;
  if (!owner) return skip("source_unverified");
  let snapshot: PersonaStoreSnapshot;
  try {
    snapshot = await requireStore().then((store) => store.readSnapshot());
  } catch (error) {
    return skip(learningStorageSkipReason(error));
  }
  if (snapshot.state === "uninitialized") return skip("uninitialized");
  if (!snapshot.policy.usePreferences || !snapshot.policy.autoLearn) {
    return skip("policy_disabled");
  }
  // 成功持久边界证明（合同 §6）：owner 只读复验；不可证明即跳过。
  let verification: PersonaLearningSourceVerification;
  try {
    verification = await owner.verifyLearningSource({
      boundary: request.boundary,
      sessionId: request.sessionId,
      workspaceKey: request.workspaceKey,
    });
  } catch {
    return skip("source_unverified");
  }
  if (verification.status !== "verified") return skip("source_unverified");
  // 有界窗口预读（≤8 条、≤8,000 code point）＋预算前置判定（spec §5「预算」；
  // 真正的硬上界预留发生在模型调用前，见 processClaim）。
  const messages = await owner
    .readTurnHumanMessages({ boundary: request.boundary, sessionId: request.sessionId })
    .catch(() => undefined);
  if (!messages) return skip("source_unverified");
  const bounded = boundLearningWindow(messages);
  if (bounded.length === 0) return skip("source_unverified");
  const estimatedInputTokens = estimateLearningInputTokens(bounded);
  try {
    const store = await requireStore();
    const budget: PersonaManagementResult<PersonaLearningBudgetUsage> =
      await store.learning.readLearningBudgetUsage(now());
    if (!budget.ok) return skip(learningStorageSkipReason(budget.code));
    const outputReserve = Math.min(
      outputReserveMax,
      PERSONA_LEARNING_BUDGET.dailyOutputTokensMax,
    );
    if (
      budget.value.attemptsUsed + 1 > PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax ||
      budget.value.inputTokensUsed + estimatedInputTokens >
        PERSONA_LEARNING_BUDGET.dailyInputTokensMax ||
      budget.value.outputTokensUsed + outputReserve >
        PERSONA_LEARNING_BUDGET.dailyOutputTokensMax
    ) {
      return skip("budget_exhausted");
    }
    // evidenceId 由服务对稳定源身份构造（合同 §6「不可由模型生成」）：同源身份同 ID，
    // 异源身份异 ID；origin 是装配层字面量，模型不得自报。
    const evidenceId = `pev-${sha256Canonical({
      authorityId: snapshot.authority.authorityId,
      boundary: encodePersonaLearningMessageBoundary(request.boundary),
      sessionId: request.sessionId,
      sourceRevision: verification.sourceRevision,
      turnId: request.turnId,
      workspaceKey: request.workspaceKey,
    })}`;
    const keyGenerations: Record<string, number> = {};
    for (const preference of snapshot.preferences) {
      keyGenerations[preference.key] = preference.keyGeneration;
    }
    const accepted = await store.learning.acceptLearningEvidence({
      evidenceId,
      keyGenerations,
      now: now(),
      policyEpoch: snapshot.policy.policyEpoch,
      sourceHandle: {
        authorityId: snapshot.authority.authorityId,
        branchEvidence: verification.branchEvidence,
        messageBoundary: encodePersonaLearningMessageBoundary(request.boundary),
        origin: PERSONA_LEARNING_TRUSTED_ORIGIN,
        permissionDescription: PERSONA_LEARNING_PERMISSION_DESCRIPTION,
        productTurnId: request.turnId,
        sessionId: request.sessionId,
        sourceRevision: verification.sourceRevision,
        workspaceKey: request.workspaceKey,
      },
    });
    if (!accepted.ok) {
      switch (accepted.code) {
        case PERSONA_ERROR_CODES.authorityMismatch:
          // 远端 authority 的输入不迁入本地个人域（合同 §6）。
          return skip("invalid_source");
        case PERSONA_ERROR_CODES.storageCapacity:
          return skip("storage_capacity");
        case PERSONA_ERROR_CODES.unsupported:
          return skip("policy_disabled");
        case PERSONA_ERROR_CODES.uninitialized:
          return skip("uninitialized");
        case PERSONA_ERROR_CODES.mutationConflict: {
          // 同 evidenceId 异内容：evidenceId 只由稳定源身份构造（合同 §6），内容差异只能
          // 来自接收时屏障快照（keyGenerations/epoch）随库状态演化。已存在 ⇒ 幂等重复
          // 通知（丢弃，不重建工作）；不存在 ⇒ 请求构造缺陷，按无效来源跳过。
          const known = await store.learning.hasLearningEvidence(evidenceId);
          if (known.ok && known.value) {
            counters.acceptAlreadyAccepted += 1;
            return { evidenceId, kind: "already_accepted" };
          }
          return skip("invalid_source");
        }
        default:
          return skip(learningStorageSkipReason(accepted.code));
      }
    }
    if (accepted.value.status === "already_accepted") {
      counters.acceptAlreadyAccepted += 1;
      return { kind: "already_accepted", evidenceId };
    }
    counters.acceptAccepted += 1;
    return { evidenceId, kind: "accepted", workId: accepted.value.workId };
  } catch (error) {
    return skip(learningStorageSkipReason(error));
  }
}

/** 一个工作循环（编排：领取→预算预留→抽取→候选校验→重验→提交/settle）。 */
async function processLearningWorkInner(): Promise<"idle" | "claimed"> {
  let store: PersonaStorePort;
  try {
    store = await requireStore();
  } catch (error) {
    logLearningStorageFailure("process.open_store", error);
    return "idle";
  }
  const claim = await store.learning.claimLearningWork({
    leaseDurationMs: leaseDurationMs,
    leaseOwner: leaseOwner,
    now: now(),
  });
  if (!claim.ok) {
    // unsupported＝U/L 任一关闭（停学期间不发生模型调用）；其余按环境故障记日志。
    if (claim.code !== PERSONA_ERROR_CODES.unsupported) {
      logLearningStorageFailure("process.claim", claim.code);
    }
    return "idle";
  }
  if (claim.value.status !== "claimed") return "idle";
  try {
    await processClaim(store, claim.value.claim);
  } catch (error) {
    counters.orchestrationErrors += 1;
    logger?.warn("persona learning work processing failed; settling for retry", {
      event: "persona.learning.work_failed",
      module: "drora-persona",
    });
    logger?.debug?.(error instanceof Error ? error.message : String(error));
    await settleLearningWork(store, claim.value.claim, "retry_wait", "orchestration_error");
  }
  return "claimed";
}

async function processClaim(
  store: PersonaStorePort,
  claim: PersonaLearningWorkClaim,
): Promise<void> {
  const handle = claim.sourceHandle;
  const boundary = decodePersonaLearningMessageBoundary(handle.messageBoundary);
  if (!boundary) {
    await rejectLearningWork(store, claim, "boundary_unreadable");
    return;
  }
  const owner = options?.sourceOwner;
  if (!owner) {
    await rejectLearningWork(store, claim, "source_owner_unavailable");
    return;
  }
  const messages = await owner
    .readTurnHumanMessages({ boundary, sessionId: handle.sessionId })
    .catch(() => undefined);
  if (!messages) {
    await rejectLearningWork(store, claim, "source_unavailable");
    return;
  }
  const bounded = boundLearningWindow(messages);
  if (bounded.length === 0) {
    await rejectLearningWork(store, claim, "input_unavailable");
    return;
  }
  // 生产默认＝paused（合同 §6「配置不可用暂停，不换模型绕过用户选择」）：不预留预算、
  // 零模型调用，工作 retry_wait；尝试上限内未恢复即被库终态化（24 小时/2 次）。
  const extractor: PersonaLearningExtractionPort =
    options?.extractor ?? pausedPersonaLearningExtractor;
  if (extractor.availability === "paused") {
    logger?.info("persona learning extraction paused; work set to retry_wait", {
      event: "persona.learning.extraction_paused",
      module: "drora-persona",
    });
    await settleLearningWork(store, claim, "retry_wait", "extraction_paused");
    return;
  }
  // 预算预留（合同 §6：调用前 DB 预留硬上界；失败计入；超界 budget_exhausted）。
  const estimatedInputTokens = estimateLearningInputTokens(bounded);
  const outputReserve = Math.min(
    outputReserveMax,
    PERSONA_LEARNING_BUDGET.dailyOutputTokensMax,
  );
  const reservation = await store.learning.reserveLearningBudget({
    estimatedInputTokens,
    maxOutputTokens: outputReserve,
    now: now(),
  });
  if (!reservation.ok) {
    if (reservation.code === PERSONA_ERROR_CODES.budgetExhausted) {
      logger?.info("persona learning budget exhausted; work set to retry_wait", {
        event: "persona.learning.budget_wait",
        module: "drora-persona",
      });
      await settleLearningWork(store, claim, "retry_wait", "budget_wait");
      return;
    }
    logLearningStorageFailure("process.reserve", reservation.code);
    await settleLearningWork(store, claim, "retry_wait", "budget_reserve_failed");
    return;
  }
  // 模型尝试（本轮测试/生产均为受控端口；真实模型调用属切片 D 授权后部分）。
  let extraction: Awaited<ReturnType<PersonaLearningExtractionPort["extract"]>>;
  try {
    extraction = await extractor.extract({
      evidenceId: claim.evidenceId,
      messages: bounded,
    });
  } catch {
    // 崩溃无法确认用量：保守不退预留（合同 §6）。
    await store.learning
      .settleLearningBudget({
        confirmed: false,
        day: reservation.value.day,
        now: now(),
        reservedInputTokens: estimatedInputTokens,
        reservedOutputTokens: outputReserve,
      })
      .catch(() => {});
    await settleLearningWork(store, claim, "retry_wait", "extraction_failed");
    return;
  }
  await store.learning
    .settleLearningBudget({
      actualInputTokens: extraction.usage?.inputTokens,
      actualOutputTokens: extraction.usage?.outputTokens,
      confirmed: true,
      day: reservation.value.day,
      now: now(),
      reservedInputTokens: estimatedInputTokens,
      reservedOutputTokens: outputReserve,
    })
    .catch(() => {});
  if (extraction.status === "no_candidates") {
    await settleLearningWorkTerminal(store, claim, "no_change", "no_eligible_candidate");
    return;
  }
  // 候选严格校验（独立校验器：受控键/受控值/全局范围/逐字引用/上界/不得自报身份）。
  const validation = validateExtractionDrafts({ drafts: extraction.drafts, messages: bounded });
  if (validation.status === "rejected") {
    logger?.warn("persona learning candidates rejected by validator", {
      event: "persona.learning.candidates_rejected",
      module: "drora-persona",
      rejectedCount: validation.rejectedCount,
      reason: validation.reason,
    });
    await settleLearningWorkTerminal(store, claim, "no_change", "candidates_rejected");
    return;
  }
  if (validation.candidates.length === 0) {
    await settleLearningWorkTerminal(store, claim, "no_change", "no_eligible_candidate");
    return;
  }
  // 源/revision 重验（合同 §6「model 返回后重验源…」；epoch/keyGeneration/pinned/
  // revision/fence 的库内屏障由提交事务复核）。重验失败不提交。
  const reverify = await owner
    .verifyLearningSource({
      boundary,
      expectedSourceRevision: handle.sourceRevision,
      sessionId: handle.sessionId,
      workspaceKey: handle.workspaceKey,
    })
    .catch(
      (): PersonaLearningSourceVerification => ({ status: "unavailable" }),
    );
  if (reverify.status !== "verified") {
    await rejectLearningWork(store, claim, "source_invalid");
    return;
  }
  const commit = await store.learning.commitLearningWork({
    candidates: validation.candidates,
    fence: claim.fence,
    now: now(),
    workId: claim.workId,
  });
  if (!commit.ok) {
    if (commit.code === PERSONA_ERROR_CODES.revisionConflict) {
      // 策略屏障（U/L 关闭、epoch 推进）或旧 fence：库已按语义终态化或留给新持有者。
      counters.workConflicts += 1;
      logger?.info("persona learning commit rejected by store barrier", {
        event: "persona.learning.commit_conflict",
        module: "drora-persona",
      });
      return;
    }
    logLearningStorageFailure("process.commit", commit.code);
    await settleLearningWork(store, claim, "retry_wait", "commit_failed");
    return;
  }
  if (commit.value.status === "applied") {
    counters.workApplied += 1;
  } else {
    counters.workNoChange += 1;
  }
  logger?.info("persona learning work committed", {
    event: "persona.learning.work_committed",
    module: "drora-persona",
    outcomes: commit.value.outcomes.map((outcome) => outcome.outcome).join(","),
    workResult: commit.value.status,
  });
}

async function settleLearningWork(
  store: PersonaStorePort,
  claim: PersonaLearningWorkClaim,
  outcome: "retry_wait",
  reason: string,
): Promise<void> {
  const result = await store.learning.settleLearningWork({
    fence: claim.fence,
    now: now(),
    outcome,
    workId: claim.workId,
  });
  if (!result.ok) {
    // stale fence/工作已消失＝竞争失败，如实计数，不改他人状态。
    counters.workConflicts += 1;
    return;
  }
  if (result.value.state === "rejected") {
    // 尝试耗尽由库终态化（合同 §6「最多 2 次尝试」）。
    counters.workRejected += 1;
    return;
  }
  counters.workRetryWait += 1;
  logger?.debug?.(`persona learning work retry_wait (${reason})`);
}

async function settleLearningWorkTerminal(
  store: PersonaStorePort,
  claim: PersonaLearningWorkClaim,
  outcome: "applied" | "no_change" | "rejected",
  reason: string,
): Promise<void> {
  const result = await store.learning.settleLearningWork({
    fence: claim.fence,
    now: now(),
    outcome,
    reason,
    workId: claim.workId,
  });
  if (!result.ok) {
    counters.workConflicts += 1;
    return;
  }
  if (outcome === "rejected") counters.workRejected += 1;
  else if (outcome === "no_change") counters.workNoChange += 1;
  else counters.workApplied += 1;
}

async function rejectLearningWork(
  store: PersonaStorePort,
  claim: PersonaLearningWorkClaim,
  reason: string,
): Promise<void> {
  await settleLearningWorkTerminal(store, claim, "rejected", reason);
  logger?.info("persona learning work rejected", {
    event: "persona.learning.work_rejected",
    module: "drora-persona",
    reason,
  });
}

function logLearningStorageFailure(operation: string, codeOrError: unknown): void {
  const code = typeof codeOrError === "string" ? codeOrError : learningErrorCode(codeOrError);
  logger?.warn("persona learning storage failure", {
    code,
    event: "persona.learning.storage_failed",
    module: "drora-persona",
    operation,
  });
}

function learningStorageSkipReason(error: unknown): PersonaLearningSkipReason {
  // 环境级存储故障（含 schema_incompatible 的进程内终态）统一按 storage_unavailable
  // 跳过接收：学习是可漏的扩展（spec §8「通知丢失/队列满允许漏学」），不中断轮次。
  logger?.debug?.(
    `persona learning accept skipped by storage failure (${learningErrorCode(error)})`,
  );
  return "storage_unavailable";
}

  // ---------------------------------------------------------------------------
  // capture 读取侧（合同 §4.2/§8）：注入集合选取与 inferred 来源复验
  // ---------------------------------------------------------------------------

/**
 * capture 读取（受 captureBudgetMs 总预算竞速包裹）：快照 + 注入集合。注入集合＝
 * active 且非 disputed 的显式槽 + 来源复验通过的 inferred 槽（spec §8「读取 inferred
 * 前复验来源存在及有效分支，复核新域 revision/epoch；冲突重读一次，再失败省略」）。
 * 源查询（owner 库）与 Persona 库没有跨库原子快照：复验一次后如实接受窗口——第二次
 * 选取结果与第一次不一致时再读一次，仍不一致按 snapshot_conflict 整份省略，不宣称
 * 跨库强线性一致（合同 §4.2）。
 */
async function readVerifiedCaptureSnapshot(): Promise<CaptureSnapshotWithPreferences> {
  const store = await requireStore();
  const first = await selectInjectablePreferenceSlots(store);
  if (!first.hasInferred) return first;
  const second = await selectInjectablePreferenceSlots(store);
  if (injectionFingerprint(first) === injectionFingerprint(second)) return second;
  const third = await selectInjectablePreferenceSlots(store);
  if (injectionFingerprint(second) !== injectionFingerprint(third)) {
    throw new PersonaStoreError("persona snapshot changed during inferred source verification", {
      code: PERSONA_ERROR_CODES.snapshotConflict,
      dbPath: dbPath,
    });
  }
  return third;
}

/** 单次选取：读快照并选出本轮可注入的偏好槽（显式＋复验通过的 inferred）。 */
async function selectInjectablePreferenceSlots(
  store: PersonaStorePort,
): Promise<CaptureSnapshotWithPreferences> {
  const snapshot = await store.readSnapshot();
  if (snapshot.state === "uninitialized" || !snapshot.policy.usePreferences) {
    return { snapshot, preferences: [], hasInferred: false };
  }
  // disputed 停止注入（合同 §6/§8：用户解决——显式保存/忘记——之后才恢复）。
  const active = snapshot.preferences.filter(
    (preference) => preference.status === "active" && !preference.disputed,
  );
  const explicit = active.filter((preference) => preference.provenanceKind === "settings");
  const inferred = active.filter((preference) => preference.provenanceKind !== "settings");
  if (inferred.length === 0) {
    return { snapshot, preferences: explicit, hasInferred: false };
  }
  const verifiedInferred = await verifyInferredSlots(inferred);
  return {
    snapshot,
    preferences: [...explicit, ...verifiedInferred],
    hasInferred: true,
  };
}

/**
 * inferred 槽来源复验：owner 端口逐一验证合并来源（存在/有效分支/域/revision）；
 * 任一来源验证成功即保留该键，全部失败或 owner 缺席＝不可验证，整键省略并计数。
 * owner 查询失败按不可验证降级（扩展省略），不抛出、不影响显式域。
 */
async function verifyInferredSlots(
  inferred: readonly PersonaPreferenceFacts[],
): Promise<readonly PersonaPreferenceFacts[]> {
  const owner = options?.sourceOwner;
  if (!owner) {
    countInferredOmitted(inferred.length, "source_owner_absent");
    return [];
  }
  let bindings: Awaited<ReturnType<PersonaStorePort["learning"]["readInferredSlotSources"]>>;
  try {
    bindings = await (await requireStore()).learning.readInferredSlotSources();
  } catch (error) {
    logger?.warn("persona capture inferred verification failed; omitting inferred slots", {
      code: isPersonaStoreError(error) ? error.code : PERSONA_ERROR_CODES.storageUnavailable,
      event: "persona.capture.inferred_unverified",
      module: "drora-persona",
    });
    countInferredOmitted(inferred.length, "source_lookup_failed");
    return [];
  }
  if (!bindings.ok) {
    countInferredOmitted(inferred.length, "source_lookup_failed");
    return [];
  }
  const sourcesByKey = new Map<string, typeof bindings.value>();
  for (const binding of bindings.value) {
    const existing = sourcesByKey.get(binding.key) ?? [];
    sourcesByKey.set(binding.key, [...existing, binding]);
  }
  const kept: PersonaPreferenceFacts[] = [];
  for (const slot of inferred) {
    const sources = sourcesByKey.get(slot.key) ?? [];
    let verified = false;
    for (const source of sources) {
      const boundary = decodePersonaLearningMessageBoundary(source.messageBoundary);
      if (!boundary) continue;
      const outcome = await owner
        .verifyLearningSource({
          boundary,
          expectedSourceRevision: source.sourceRevision,
          sessionId: source.sessionId,
          workspaceKey: source.workspaceKey,
        })
        .catch(() => undefined);
      if (outcome?.status === "verified") {
        verified = true;
        break;
      }
    }
    if (verified) {
      kept.push(slot);
    } else {
      counters.acceptSkipped["capture_inferred_unverifiable"] =
        (counters.acceptSkipped["capture_inferred_unverifiable"] ?? 0) + 1;
      logger?.info("persona capture omitted unverifiable inferred preference", {
        event: "persona.capture.inferred_unverified",
        key: slot.key,
        module: "drora-persona",
      });
    }
  }
  return kept;
}

function countInferredOmitted(count: number, reason: string): void {
  if (count <= 0) return;
  counters.acceptSkipped[`capture_inferred_${reason}`] =
    (counters.acceptSkipped[`capture_inferred_${reason}`] ?? 0) + count;
  logger?.info("persona capture omitted unverifiable inferred preferences", {
    count,
    event: "persona.capture.inferred_unverified",
    module: "drora-persona",
    reason,
  });
}

  return {
    acceptLearningSource: (request) => serialize(() => acceptLearningSourceInner(request)),
    processLearningWork: () => serialize(() => processLearningWorkInner()),
    readVerifiedCaptureSnapshot,
  };
}

/** sourceHandle 定位字段的结构上界：非空、≤256 code point、无控制字符。 */
function isBoundedSourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= 256 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 10) || (code >= 127 && code <= 159);
    })
  );
}

/**
 * 有界抽取窗口（合同 §6「最多 8 条相关原始人类消息、合计 8,000 code point」）：从最新
 * 往旧保留，跳过单条即超界的消息（不截断正文），合计到上界为止。数量与合计上界是服务
 * 层职责（owner 只提供原始窗口）。
 */
function boundLearningWindow(messages: readonly string[]): string[] {
  const kept: string[] = [];
  let total = 0;
  for (
    let index = messages.length - 1;
    index >= 0 && kept.length < PERSONA_LEARNING_BUDGET.extractionInputMessagesMax;
    index -= 1
  ) {
    const message = messages[index];
    if (typeof message !== "string") continue;
    const codePointCount = [...message].length;
    if (codePointCount > PERSONA_LEARNING_BUDGET.extractionInputCodePointsMax) continue;
    if (total + codePointCount > PERSONA_LEARNING_BUDGET.extractionInputCodePointsMax) continue;
    total += codePointCount;
    kept.unshift(message);
  }
  return kept;
}

/** 学习面环境故障的封闭错误码归类（未知一律 storage_unavailable，不落正文）。 */
function learningErrorCode(error: unknown): PersonaErrorCode {
  return isPersonaStoreError(error) ? error.code : PERSONA_ERROR_CODES.storageUnavailable;
}
