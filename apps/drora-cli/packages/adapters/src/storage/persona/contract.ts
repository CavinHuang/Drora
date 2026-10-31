/**
 * cli-persona-store 对外契约（specs/drora-persona-system.md §4 模块表「adapters/persona
 * 独立库 worker、事务、迁移和来源适配」；存储/并发/幂等语义依据
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1/§2）。
 *
 * 边界：
 * - 库路径由调用方传入（可信存储根在服务层按 shared contracts 的 PERSONA_STORAGE_KEYS 解析），
 *   本模块不定路径规则，不接受 project config 的 storage.dir 或 cwd 推导（spec §4）。
 * - 业务时间（now）由服务产生 UTC 毫秒时间戳（合同 §1）；authorityId/personaId 由本模块在
 *   初始化事务内用 crypto.randomUUID 生成，不从昵称/cwd/用户文本推导。
 * - 字段校验（NFC/trim/控制字符/code point 上限）属服务层与 cli-persona-domain；本仓储只做
 *   存储层约束（SQL CHECK）与逐字段严格解码，解码失败按 schema_incompatible 停扩展。
 * - 结果复用 shared 的 PersonaManagementResult 与 PERSONA_ERROR_CODES 封闭枚举：业务终态
 *   （uninitialized / revision_conflict / mutation_conflict / storage_capacity 及 saved、
 *   unchanged、created 回放）以值返回；环境级故障（storage_unavailable、schema_incompatible、
 *   写超时 outcome_unknown）以 PersonaStoreError 抛出（合同 §3 错误枚举）。
 * - SQLite 位于异步 worker（合同 §2）：生产装配经 openWorkerPersonaStore——worker 线程
 *   持有 DatabaseSync（PersonaSqliteStore 是 worker 内唯一实现），主线程经消息传递调用
 *   同一 PersonaStorePort（persona-store-worker-client.ts / -main.ts / -protocol.ts）。
 *   openPersonaStore 是在程 engine（worker 内与测试直接使用）。worker 意外退出/崩溃以
 *   storage_unavailable 拒绝后续调用（扩展只停不崩进程），本层不自动重开。同实例事务
 *   先由仓储内的进程队列串行化（单连接重叠 begin 会被误分类为 storage_unavailable）。
 */
import type {
  PersonaAllowLearningInput,
  PersonaAllowLearningResult,
  PersonaCoreMutationResult,
  PersonaEditableCore,
  PersonaErrorCode,
  PersonaForgetPreferenceInput,
  PersonaForgetResult,
  PersonaManagementResult,
  PersonaPolicyFacts,
  PersonaPolicyMutationResult,
  PersonaPreferenceFacts,
  PersonaPreferenceMutationResult,
  PersonaSavePreferenceInput,
  PersonaSetPolicyInput,
} from "@drora/shared";
import type { PersonaLearningStorePort } from "./persona-learning-contract.js";

// ---------------------------------------------------------------------------
// 预算与容量默认值（合同 §2 初始值；正式阈值须经切片 D 性能实验验证后冻结）
// ---------------------------------------------------------------------------

export const PERSONA_STORE_DEFAULTS = {
  /** SQLite 连接级锁等待上限（合同 §2「锁等待上限初始 100ms」）。 */
  lockWaitTimeoutMs: 100,
  /** 单个管理请求总预算（合同 §2「管理请求总预算初始 5s」）。 */
  adminRequestBudgetMs: 5000,
  /**
   * capture 总预算（合同 §2「capture 总预算初始 250ms」、spec §6「运行中不能无限等
   * worker」）：打开库+迁移+读快照的整个捕获路径限时；超预算按 budget_exhausted 省略
   * 扩展、原任务继续（PM16）。默认值由服务层（PersonaAppService）消费，本仓储不使用。
   */
  captureBudgetMs: 250,
  /** mutation receipt 保留窗口（合同 §2「receipt 保留至少 7 天」）。 */
  receiptRetentionMs: 7 * 24 * 60 * 60 * 1000,
  /** mutation receipt 每 authority 正常上限（合同 §2「正常上限 4,096 条/authority」）。 */
  receiptMaxPerAuthority: 4096,
} as const;

export interface PersonaStoreOptions {
  /** persona.sqlite 完整路径；由调用方从可信存储根解析（PERSONA_STORAGE_KEYS）。 */
  readonly dbPath: string;
  readonly lockWaitTimeoutMs?: number;
  readonly adminRequestBudgetMs?: number;
  readonly receiptRetentionMs?: number;
  readonly receiptMaxPerAuthority?: number;
}

/** open 时解析完默认值后的选项（管理面与学习面共享；persona-store 与 learning-store 同源）。 */
export interface ResolvedPersonaStoreOptions {
  dbPath: string;
  lockWaitTimeoutMs: number;
  adminRequestBudgetMs: number;
  receiptRetentionMs: number;
  receiptMaxPerAuthority: number;
}

// ---------------------------------------------------------------------------
// 读取结果（authority/core 单例事实；字段集＝合同 §1 Authority/P0 与 Core/P0）
// ---------------------------------------------------------------------------

export interface PersonaStoreAuthorityFacts {
  readonly authorityId: string;
  readonly personaId: string;
  readonly schemaVersion: number;
  /** UTC 毫秒；初始化事务写入的服务时间。 */
  readonly createdAt: number;
}

export interface PersonaStoreCoreFacts {
  readonly coreRevision: number;
  readonly templateVersion: number;
  readonly core: PersonaEditableCore;
  readonly updatedAt: number;
}

/** 未初始化是读取的成功答案（PM55）；写方法遇未初始化才表现为 uninitialized 错误码。 */
export type PersonaStoreSnapshot =
  | {
      readonly state: "initialized";
      readonly authority: PersonaStoreAuthorityFacts;
      readonly core: PersonaStoreCoreFacts;
      /**
       * 使用策略与偏好槽（P1a）：与 authority/core 同一短事务读取（合同 §4.2
       * 「capture 在短事务读取 core/policy/偏好版本」），构成该次捕获的资料 cutoff。
       * preferences 含 forgotten 屏障槽（value 空串、带 revision 供重设 CAS）；
       * U off 时为空数组（存储侧落实「新 capture 不读偏好」）；capture 消费方只应使用
       * status="active" 的槽。policy 行缺席时读侧返回默认值。
       */
      readonly policy: PersonaPolicyFacts;
      readonly preferences: readonly PersonaPreferenceFacts[];
    }
  | { readonly state: "uninitialized" };

// ---------------------------------------------------------------------------
// 变更输入/输出（receipt 幂等键＝(scope, mutationId)，requestDigest 由服务对规范输入计算；
// 合同 §2：同 ID 同摘要回放先前结果，同 ID 异摘要 mutation_conflict）
// ---------------------------------------------------------------------------

export interface PersonaStoreMutationBase {
  /** 每次用户提交新生成；重试必须复用同一 ID（PM53）。 */
  readonly mutationId: string;
  /** 规范请求内容摘要；只作内容一致性比对，不入核心正文（合同 §1 MutationReceipt/P0）。 */
  readonly requestDigest: string;
  /** 服务产生的 UTC 毫秒时间；receipt 保留窗口与时间戳都以此为准。 */
  readonly now: number;
}

/** 初始化输入：产品默认核心与 templateVersion 由服务（产品模板资产）提供，存储不定默认值。 */
export interface PersonaStoreInitializeInput extends PersonaStoreMutationBase {
  readonly initialCore: PersonaEditableCore;
  readonly templateVersion: number;
}

export interface PersonaStoreUpdateCoreInput extends PersonaStoreMutationBase {
  /** CAS 前置（合同 §2）；与当前 revision 不等返回 revision_conflict，不写 receipt。 */
  readonly expectedRevision: number;
  /** 完整五字段新内容；与当前内容全等返回 unchanged，不新增 revision。 */
  readonly next: PersonaEditableCore;
}

export interface PersonaStoreInitializedValue {
  readonly status: "created" | "unchanged";
  readonly snapshot: Extract<PersonaStoreSnapshot, { state: "initialized" }>;
}

/** updateCore 结果直接复用 shared 合同类型（saved 返回新 revision；unchanged 不新增 revision）。 */
export type PersonaStoreUpdateCoreResult = PersonaCoreMutationResult;

// ---------------------------------------------------------------------------
// P1a 策略/偏好/导出（合同 §1.2/§2/§4.2/§7）
// ---------------------------------------------------------------------------

/** 偏好值由服务层校验后传入完整规范化值（NFC/受控集合）；本仓储只做存储约束与严格解码。 */
export type PersonaStoreSavePreferenceInput = PersonaStoreMutationBase &
  PersonaSavePreferenceInput;

export type PersonaStoreForgetPreferenceInput = PersonaStoreMutationBase &
  PersonaForgetPreferenceInput;

/** allowLearningForKey 由服务层校验后传入；本仓储做 generation CAS 与抑制解除的单事务。 */
export type PersonaStoreAllowLearningInput = PersonaStoreMutationBase & PersonaAllowLearningInput;

export type PersonaStoreUpdatePolicyInput = PersonaStoreMutationBase & PersonaSetPolicyInput;

/**
 * 导出快照（合同 §7）：单事务冻结的全部未忘记且有效当前值——显式（settings）与 inferred
 * （extraction）槽一并携带（「只含未忘记且有效的当前值」）。inferred 槽的来源复验与
 * 「不可验证→省略」计数发生在事务外，属服务层（合同 §7 时序「仅复验 inferred 来源」）；
 * 仓储无法验证来源，不做预省略、不预先计数。
 */
export interface PersonaStoreExportSnapshot {
  readonly core: PersonaStoreCoreFacts;
  readonly policy: PersonaPolicyFacts;
  readonly preferences: readonly PersonaPreferenceFacts[];
}

// ---------------------------------------------------------------------------
// 端口与环境级错误
// ---------------------------------------------------------------------------

/**
 * 环境级故障：open/迁移失败与读写过程中的传输错误。code 只取
 * storage_unavailable / schema_incompatible / outcome_unknown（写请求超预算时的对外语义，
 * 调用方凭 mutationId 查询/重试，不视为已确认失败或成功——合同 §2）。
 */
export class PersonaStoreError extends Error {
  readonly code: PersonaErrorCode;
  readonly dbPath?: string;

  constructor(
    message: string,
    options: { code: PersonaErrorCode; cause?: unknown; dbPath?: string },
  ) {
    super(message, { cause: options.cause });
    this.name = "PersonaStoreError";
    this.code = options.code;
    this.dbPath = options.dbPath;
  }
}

export function isPersonaStoreError(error: unknown): error is PersonaStoreError {
  return error instanceof PersonaStoreError;
}

/** P0 独立库仓储端口；PersonaAppService（服务层）是唯一预期消费方。 */
export interface PersonaStorePort {
  /** authority+core 单例事实的一致性快照；未初始化返回 state="uninitialized"。 */
  readSnapshot(): Promise<PersonaStoreSnapshot>;
  /** 显式初始化：单事务原子生成 authority+默认核心+receipt；并发/重放幂等（合同 §3）。 */
  initializeAuthority(
    input: PersonaStoreInitializeInput,
  ): Promise<PersonaManagementResult<PersonaStoreInitializedValue>>;
  /** CAS 核心更新：expectedRevision→revision_conflict；无内容变化→unchanged（合同 §2）。 */
  updateCore(
    input: PersonaStoreUpdateCoreInput,
  ): Promise<PersonaManagementResult<PersonaStoreUpdateCoreResult>>;
  /**
   * 使用策略 CAS（合同 §4.2）：内容变更＝policyRevision+1 且 policyEpoch+1（屏障）；
   * 无内容变化返回 unchanged 不推进。行缺席时 expectedPolicyRevision=0 创建。
   */
  updatePolicy(
    input: PersonaStoreUpdatePolicyInput,
  ): Promise<PersonaManagementResult<PersonaPolicyMutationResult>>;
  /**
   * 显式偏好保存（合同 §1.2/§4.2）：provenance=settings、explicit、pinned；清该键候选是
   * P1b 语义（P1a 无候选表，天然满足）；内容变化＝revision+1 且 keyGeneration+1（屏障）。
   * 槽缺席时 expectedRevision=0 创建。
   */
  savePreference(
    input: PersonaStoreSavePreferenceInput,
  ): Promise<PersonaManagementResult<PersonaPreferenceMutationResult>>;
  /**
   * 逻辑忘记（合同 §4.2/§9）：清应用持有 value/版本候选、status=forgotten、
   * keyGeneration+1、autoSuppressed；槽缺席（含从未设置）也建立屏障槽；结果携带新
   * revision（忘记并列于保存是解决路径，重设的 CAS 需要可观测的预期值）。只删应用可
   * 访问正文，不承诺介质擦除（界面文案不得宣称「所有地方彻底忘记」）。
   */
  forgetPreference(
    input: PersonaStoreForgetPreferenceInput,
  ): Promise<PersonaManagementResult<PersonaForgetResult>>;
  /** 全部偏好槽（含 forgotten 屏障槽及其 revision/value=空）；调用方按用途过滤（合同 §3）。 */
  listPreferences(): Promise<PersonaManagementResult<readonly PersonaPreferenceFacts[]>>;
  /**
   * 解除该键自动学习抑制（合同 §3 allowLearningForKey、§4.2）：CAS 前置是该键当前
   * generation（槽缺席按 0）；只清 autoSuppressed 并 generation++——status/value/disputed
   * 原样保留（争议仍由保存/忘记解决，两件事分开；「不恢复旧源/旧值」）。无抑制可解除
   * （槽缺席或未抑制）返回 unchanged 不推进；generation++ 使旧工作快照失效（合同 §4.2
   * 「只接受之后的新机会」），旧候选/工作不被此操作复活。
   */
  allowLearningForKey(
    input: PersonaStoreAllowLearningInput,
  ): Promise<PersonaManagementResult<PersonaAllowLearningResult>>;
  /** 导出快照：单事务冻结 authority 下的 core/policy/有效偏好与省略计数（合同 §7）。 */
  readExportSnapshot(): Promise<PersonaManagementResult<PersonaStoreExportSnapshot>>;
  /** 关闭连接；幂等。关闭后的调用以 PersonaStoreError(storage_unavailable) 拒绝。 */
  close(): Promise<void>;
  /**
   * P1b 学习面（合同 §1 Evidence/Candidate/Work 与 §6）：证据接收/工作队列（租约/fencing）/
   * 预算台账/候选提交，与管理面共享同一连接与事务队列（同一短事务互斥语义）。
   * 学习操作不是用户管理事务：无 mutationId receipt，幂等键是 evidenceId（合同 §3
   * 「acceptLearningSource（内部）；外部 UI 不可调用」）。
   */
  readonly learning: PersonaLearningStorePort;
}
