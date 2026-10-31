/**
 * cli-persona-store 的 P1b 学习端口（specs/drora-persona-system.md §8；存储合同
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1 Evidence/Candidate/Work 与
 * §6 来源/工作/预算）。独立于 contract.ts 的管理端口：学习接收/领取/提交不是用户管理
 * 事务，没有 mutationId receipt；幂等键是 evidenceId，并发控制是租约/fencing，模型调用
 * 前置是预算台账预留（合同 §3「acceptLearningSource（内部）；外部 UI 不可调用」）。
 *
 * 边界（与 contract.ts 一致并加列）：
 * - sourceHandle 的语义字段（origin/分支/边界/校验值）由可信 owner（服务层）提供；本仓储
 *   只做结构完整性校验与规范序列化，不解释、不补造旧字段（合同 §6「缺证据即跳过」）。
 * - 源复验（消息 owner 只读验证）发生在事务外，属服务层；本仓储只在提交事务内复核
 *   policyEpoch/keyGeneration/pinned/fence 等库内屏障。
 * - 预算常量唯一出处是 shared contracts 的 PERSONA_LEARNING_BUDGET；本文件不另设数值。
 */
import type {
  PersonaLearningWorkState,
  PersonaManagementResult,
  PersonaPreferenceKey,
} from "@drora/shared";

// ---------------------------------------------------------------------------
// 接收（合同 §6：evidenceId 幂等；DB 非终态工作 ≤128/authority，满时拒绝接收）
// ---------------------------------------------------------------------------

/**
 * sourceHandle 最少字段（合同 §6 逐项）。productTurnId/sourceCommandId 至少一项；
 * policyEpoch/keyGenerations 不在 handle 内（作为接收屏障快照单独存储，见下）。
 * workspaceKey＝workspaceIdentity?.trim() || workspacePath（由服务层统一构造）。
 */
export interface PersonaLearningSourceHandle {
  readonly authorityId: string;
  readonly workspaceKey: string;
  readonly sessionId: string;
  readonly productTurnId?: string;
  readonly sourceCommandId?: string;
  /** 可信 origin（服务提供；模型不得自报 sourceRole/origin，合同 §6）。 */
  readonly origin: string;
  /** 源版本校验值（owner 提供的 snapshot/version 标识）。 */
  readonly sourceRevision: string;
  /** 原始消息边界定位（服务可读的定位描述，非正文）。 */
  readonly messageBoundary: string;
  /** 活动分支证据（owner 证明成功持久边界的凭据描述）。 */
  readonly branchEvidence: string;
  /** 合格执行许可描述（合同 §6「合格执行许可描述」；可选最小字段）。 */
  readonly permissionDescription?: string;
}

/** 接收输入：keyGenerations 为该次接收观察到的键屏障快照（缺省键按 0 对待）。 */
export interface PersonaLearningEvidenceInput {
  readonly evidenceId: string;
  readonly sourceHandle: PersonaLearningSourceHandle;
  readonly policyEpoch: number;
  readonly keyGenerations: Readonly<Record<string, number>>;
  readonly now: number;
}

export type PersonaLearningAcceptResult =
  | { readonly status: "accepted"; readonly workId: string }
  /**
   * already_accepted：同 ID 同内容的幂等回放。workId 在工作行仍在保留期内时返回；
   * 工作终态行已按合同 §6 保留上界（7 天）清理后，回放仍 already_accepted 但省略
   * workId（工作行已不存在）——evidence 作为来源定位/复验记录长期保留（合同 §6
   * 「证据清理独立」），不能按库损坏拒绝。
   */
  | { readonly status: "already_accepted"; readonly workId?: string };

// ---------------------------------------------------------------------------
// 工作队列（合同 §6：状态机/租约/fencing/并发 1/24 小时/最多 2 次尝试）
// ---------------------------------------------------------------------------

/** 领取输入：租约时长由调用方显式给出（服务层实验旋钮），本仓储不定默认值。 */
export interface PersonaLearningClaimInput {
  readonly leaseOwner: string;
  readonly leaseDurationMs: number;
  readonly now: number;
}

export interface PersonaLearningWorkClaim {
  readonly workId: string;
  readonly evidenceId: string;
  readonly fence: number;
  readonly attempts: number;
  readonly policyEpoch: number;
  readonly keyGenerations: Readonly<Record<string, number>>;
  readonly leaseExpiresAt: number;
  readonly sourceHandle: PersonaLearningSourceHandle;
}

export type PersonaLearningClaimResult =
  | { readonly status: "claimed"; readonly claim: PersonaLearningWorkClaim }
  | { readonly status: "lease_active" }
  | { readonly status: "empty" };

/** 候选：evidenceRefs 是有界引用定位/片段串（≤4 条、每条 ≤512 code point，合同 §6）。 */
export interface PersonaLearningCommitCandidate {
  readonly key: PersonaPreferenceKey;
  readonly value: string;
  readonly evidenceRefs: readonly string[];
}

export interface PersonaLearningCommitInput {
  readonly workId: string;
  readonly fence: number;
  readonly candidates: readonly PersonaLearningCommitCandidate[];
  readonly now: number;
}

/**
 * 单候选结果：slot_written＝新 inferred 值落槽；source_merged/source_known＝同值合并
 * 来源（新并入/已存在）；candidate_pending＝争议或 pinned 建议进入待确认候选（槽不动）；
 * no_op_same_value＝同值同源无事可写；dropped_*＝屏障/结构拒绝（一律不留正文）。
 */
export type PersonaLearningCandidateOutcome =
  | "slot_written"
  | "source_merged"
  | "source_known"
  | "candidate_pending"
  | "no_op_same_value"
  | "dropped_suppressed"
  | "dropped_stale_generation"
  | "dropped_invalid";

export interface PersonaLearningCommitOutcome {
  readonly key: PersonaPreferenceKey;
  readonly outcome: PersonaLearningCandidateOutcome;
}

export interface PersonaLearningCommitResult {
  readonly status: "applied" | "no_change";
  readonly outcomes: readonly PersonaLearningCommitOutcome[];
}

/** 工作 settle：retry_wait 在尝试耗尽时由仓储终态化为 rejected（合同 §6「最多 2 次尝试」）。 */
export interface PersonaLearningSettleWorkInput {
  readonly workId: string;
  readonly fence: number;
  readonly outcome: Extract<
    PersonaLearningWorkState,
    "applied" | "no_change" | "rejected" | "retry_wait"
  >;
  /** 终态最小原因（固定类别短语；仓储拒绝 >128 code point 的值，不收正文）。 */
  readonly reason?: string;
  readonly now: number;
}

export interface PersonaLearningSettleWorkResult {
  readonly state: PersonaLearningWorkState;
}

// ---------------------------------------------------------------------------
// 预算台账（合同 §6：调用前 DB 预留硬上界、失败计入、UTC 日窗口、时钟倒退不补额度）
// ---------------------------------------------------------------------------

export interface PersonaLearningBudgetReserveInput {
  /** 本次调用的输入 token 估计（预留值）。 */
  readonly estimatedInputTokens: number;
  /** 本次调用的输出 token 上界（预留值）。 */
  readonly maxOutputTokens: number;
  readonly now: number;
}

export interface PersonaLearningBudgetReservation {
  /** 预留所在的 UTC 日（YYYY-MM-DD）；settle 必须回落到该日。 */
  readonly day: string;
}

/**
 * 预算核销：confirmed=true 时按实际用量退还未消耗的 token 预留差额（尝试数不退——
 * 失败计入）；confirmed=false（崩溃无法确认用量）保守不退预留（合同 §6）。
 * reserved* 必须与 reserve 时的预留值一致，用于精确退差。
 */
export interface PersonaLearningBudgetSettleInput {
  readonly day: string;
  readonly reservedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly confirmed: boolean;
  readonly actualInputTokens?: number;
  readonly actualOutputTokens?: number;
  readonly now: number;
}

export interface PersonaLearningBudgetSettleResult {
  readonly status: "settled";
}

// ---------------------------------------------------------------------------
// 只读观测（P1b 服务层判定用；不改变任何屏障语义）
// ---------------------------------------------------------------------------

/** UTC 日预算台账观测行（当日无记账时 attempts/tokens 全为 0，day 仍返回当日键）。 */
export interface PersonaLearningBudgetUsage {
  readonly day: string;
  readonly attemptsUsed: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
}

/**
 * inferred 槽的合并来源定位（合同 §8「读取 inferred 前复验来源存在及有效分支」的读取侧
 * 依赖）：只含复验所需的定位/校验元数据，无聊天原文。行原语与 source_summary 解码失败
 * 按库内容损坏处理（schema_incompatible）。
 */
export interface PersonaLearningSlotSourceBinding {
  readonly key: PersonaPreferenceKey;
  readonly evidenceId: string;
  readonly workspaceKey: string;
  readonly sessionId: string;
  /** owner 快照校验值（接收时的 sourceRevision，复验的期望值）。 */
  readonly sourceRevision: string;
  /** 原始消息边界定位串（服务层编码的结构化边界 JSON；本仓储不解释）。 */
  readonly messageBoundary: string;
}

// ---------------------------------------------------------------------------
// 学习端口（PersonaStorePort.learning 的形状；消费方为学习消费者，非管理 UI）
// ---------------------------------------------------------------------------

export interface PersonaLearningStorePort {
  /**
   * evidenceId 幂等接收（合同 §6）：同 ID 同内容 already_accepted（返回既有 workId），
   * 同 ID 异内容 mutation_conflict；sourceHandle 声明的 authorityId 与本库 authority 不
   * 一致拒绝（authority_mismatch——远端 authority 的输入不迁入本地个人域）；非终态工作
   * 满 128 拒绝（storage_capacity）。U/L 任一关闭时拒绝新接收（unsupported；spec §5
   * 学习接收前置的存储侧执行，幂等回放不受影响）。单事务完成 evidence 行 + accepted 工作行。
   */
  acceptLearningEvidence(
    input: PersonaLearningEvidenceInput,
  ): Promise<PersonaManagementResult<PersonaLearningAcceptResult>>;
  /**
   * 领取（合同 §6：每 authority 并发 1；过期租约可重领，fence 单调递增）。24 小时超龄
   * 与尝试耗尽的工作在此终态化（rejected）。U/L 任一关闭时拒绝派发（unsupported）——
   * 停学期间不发生模型调用。
   */
  claimLearningWork(
    input: PersonaLearningClaimInput,
  ): Promise<PersonaManagementResult<PersonaLearningClaimResult>>;
  /**
   * 单库提交（合同 §6「model 返回后重验源、epoch、keyGeneration、pinned、revision、fence，
   * 再单库提交」）：候选逐条过屏障（generation 陈旧/抑制/结构非法逐条丢弃不留正文；
   * pinned 走待确认建议；同值并源；异值置 disputed＋待确认候选）。策略屏障（U/L 关闭、
   * epoch 推进）拒绝整个提交并把工作终态化为 rejected——不靠预算重试复活。
   */
  commitLearningWork(
    input: PersonaLearningCommitInput,
  ): Promise<PersonaManagementResult<PersonaLearningCommitResult>>;
  /** 工作 settle：stale fence 拒绝（revision_conflict）且不改工作状态。 */
  settleLearningWork(
    input: PersonaLearningSettleWorkInput,
  ): Promise<PersonaManagementResult<PersonaLearningSettleWorkResult>>;
  /** 调用前预留：硬上界检查在 DB 内完成，超界 budget_exhausted（不预留不计数）。 */
  reserveLearningBudget(
    input: PersonaLearningBudgetReserveInput,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetReservation>>;
  /** 预留核销；confirmed=false 不退预留。 */
  settleLearningBudget(
    input: PersonaLearningBudgetSettleInput,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetSettleResult>>;
  /**
   * 只读：指定 UTC 时刻所在日的预算台账（服务层「学习接收前置＝…预算…」的判定依据，
   * spec §5）；跨进程一致（同一 DB 行），不用进程内缓存。
   */
  readLearningBudgetUsage(
    now: number,
  ): Promise<PersonaManagementResult<PersonaLearningBudgetUsage>>;
  /**
   * 只读：inferred 槽当前合并来源定位（capture 读取侧复验用，合同 §8）；来源行解码失败
   * 按损坏处理。不含 disputed/suppressed 过滤——注入资格判定属服务层。
   */
  readInferredSlotSources(): Promise<
    PersonaManagementResult<readonly PersonaLearningSlotSourceBinding[]>
  >;
  /**
   * 只读：evidenceId 是否已接收（幂等回放的消歧依据）。服务层在同 ID 异内容
   * （mutation_conflict）时用它区分「同一来源的屏障快照漂移」与真实构造缺陷：
   * 已存在 ⇒ already_accepted（丢弃重复通知），不存在 ⇒ 请求缺陷。
   */
  hasLearningEvidence(evidenceId: string): Promise<PersonaManagementResult<boolean>>;
}
